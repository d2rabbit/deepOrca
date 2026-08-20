# Redesign 重构方案 v3 — Deck 内置于 desktop

> 2026-08-20 · **v3 架构决策**：Deck 交互层**直接写在 `packages/desktop` 内**，不拆独立包。
> 演进：v1（desktop 内加布局开关）→ v2（独立包 `packages/deck`，基座 copy）→ **v3（回到 desktop 内）**。v2 废弃原因：基座镜像带来同步漂移成本（需 CI diff 门禁）、双份构建链与 release 复杂度、vendor 树复用别扭——"避免问题"。v3 = v1 的落点 + 全程讨论收敛出的全部硬约束（设计稿六主题 / 兜底可回退 / 目录级隔离 / 分期门禁）。
>
> **定位**：这不是可抛弃的小实验，而是**一次大 redesign 重构**——终态是 Deck 替换现有交互层成为产品 UI。E0–E4 分期只是工程推进与风险控制方式（每期可验证、可回退），不代表终态可以停在中间。

## 0. 形态总览

```
packages/desktop/src/renderer/
├── main.tsx            ← 根调度：按布局开关挂载 <App/> 或 <DeckApp/>（改）
├── App.tsx             ← 经典交互层（兜底默认，一行不动）
├── components/ hooks/ ui/ ...   ← 经典层既有代码（不动）
├── ui.css / styles*.css          ← 经典层结构层 + 旧六主题（不动）
├── lib/appearance.ts   ← 经典层主题机制（不动）
└── deck/               ← **新增：Deck 交互层（唯一实质新写的部分）**
     ├── deck-app.tsx        根组件（React.lazy 独立 chunk）
     ├── deck.css            结构层，只消费 deck token
     ├── deck-tokens.css     token 单一事实源（提取自设计稿 Demo）
     ├── themes/             设计稿六主题样式表（liquid-glass / flat / glassmorphism /
     │                        neumorphism / claymorphism / vernacular-1997，各只绑 token）
     ├── lib/appearance.ts   主题热切换机制（照搬经典层机制，Theme 枚举换设计稿六主题）
     ├── components/ hooks/ ...
     └── ...
```

- **默认 = 经典**：`deeporca.layout`（localStorage，缺省 `"classic"`）；选 `"deck"` 才挂载 Deck。
- **可回退是硬约束**：见 §3，任何情况下用户都能回到经典，且不需要用户操作时系统也能自己回去。
- **core / preload / IPC 零改动**：Deck 消费同一个 `window.deeporca`（`shared/ipc.ts` 不动）。

## 1. 隔离红线（v1 教训的直接回应）

v1 当初被否的原因是"双布局加重 `App.tsx` 状态复合、下线不彻底"。v3 用目录级隔离解决：

1. **Deck 全部代码收在 `src/renderer/deck/` 一个目录 + `deck/` 内自带 CSS**；**不改** `App.tsx`、`ui.css`、既有 hooks/components。经典层的唯一例外是 §2 的两个挂点（各 ≤10 行）。
2. **token 双轨**：Deck 的 token 以设计稿为唯一标准（`deck-tokens.css`），**不往 `ui.css` 的 `--ui-*` 里加变量、不做新旧映射**——两套视觉语言互不污染，转正时删旧轨、下线时删新轨，都是净操作。
3. **主题双轨**：经典层旧六主题（aqua/metro/glass/fusion/line/orca）原样保留；Deck 用设计稿六主题，各自走各自的 `<link>` 热替换，互不可见。
4. **bundle 隔离**：Deck 走 `React.lazy` 独立 chunk，经典用户零加载成本；deck chunk 加载失败 = 自动回落经典。
5. **单文件行数上限 2000 行**（样式文件 .css 除外）：deck/ 下所有实现代码文件（.ts/.tsx）不得超过 2000 行，逼近即按职责拆分——经典层 `App.tsx`（1527 行）那种单文件膨胀正是本约束要防的。CI 挂行数检查脚本（对 `deck/**/*.{ts,tsx}` 断言 ≤2000），超限即红。

## 2. 挂点（经典层仅有的两处改动）

1. **`main.tsx`**：根渲染处分支——`resolveLayout()`（仿 `resolveTheme`，读 localStorage）为 `"deck"` 时 `React.lazy(() => import("./deck/deck-app"))` 挂载 `<DeckApp/>`，否则照常 `<App/>`。参照现成的 `?view=prototype` 平行根先例。deck chunk `import()` 失败时 catch 住、写回 `"classic"`、按经典启动。
2. **`SettingsPanel.tsx` 外观 tab**：加"界面布局"区——经典（默认）/ Orca Deck（实验徽标 + 一句话说明 + 可随时切回提示）。写 localStorage 后重挂载（`location.reload()` 或根状态 key 变更，实现取简单者）。

数据同源天然成立（同一个 App、同一份 localStorage 与 `~/.deeporca`），切换不丢会话。

## 3. 可回退机制（硬约束）

- **双向入口**：经典 → Deck 走 §2.2 设置项；Deck → 经典在 Deck 内设**固定且永远可达**的"切回经典"入口（目标带常驻 + Deck 设置内同位选项），⌘, 设置在任何浮层状态下可开。
- **防卡死**：deck chunk 加载失败 / 根组件挂载抛错 → 自动写回 `"classic"` 并按经典启动，下次启动 toast 告知。兜底层必须是"不需要用户操作也能回去"的。
- **验收硬指标**：双向切换十次无状态异常、不丢会话；人为制造 deck chunk 404 验证自动回落。

## 4. Deck 交互层（deck/）— 全新实现

以 `docs/research/ui-ux/design/` 的 vision/wireframes/coverage 为规格，Demo（index.html）为交互参照：

- **技术栈同源**：React 19 + TS + esbuild；primitive 从既有 `ui/` copy 打底再按需改（copy 进 deck/，不改原件）。
- **主题体系（设计稿六主题）**：Liquid Glass（主视觉，默认）/ Flat / Glassmorphism / Neumorphism / Claymorphism / Vernacular 1997：
  - token 从 `index.html` Demo 提取为 `deck-tokens.css` 单一事实源；desktop 的 `--ui-*` 仅作命名参考；
  - 六主题各一张样式表只绑 token，`<link>` 热替换零刷新；Liquid Glass 视觉基准帧看 `base-complete-design.html`；
  - token 缺口按 `wireframes.md`"token 增补"节补齐；亮暗变体沿用 `data-appearance` 机制；
  - Deck 的设置面板内主题选择在设计稿六主题内进行，不提供旧皮肤——这是 redesign，不是换肤。
- **对象模型映射真实数据源**：Goal=会话、Step=UpdatePlan 输出、Intervention=权限询问流、Tape=消息流、仪表=usage 记账。**不接管引擎循环**（自律度/刹车只做观测位，core 红线不动）。
- **布局本体**：40px 目标带 + 左缘模块坞（18 入口）+ 步骤板主区 + ⌘⇧O 控制中心 + 统一浮层栈（Esc 关最上层）+ ⌘K 命令层（真模糊评分，注册表全模块）。
- **覆盖门禁**：`coverage.md` 矩阵中每个模块的 Deck 落点全部可交互才算 E3 完成。
- **i18n**：Deck 新词条追加进 `i18n/messages.ts`（这是共享文件，允许追加、不允许改既有 key）。

## 5. 分期与验收

每期门禁：`npm run check && npm test` 全绿；经典布局回归无损（切回经典走查主流程一遍）。

**进度（2026-08-20）**：✅ E0 完成 · ✅ E1 完成 · ✅ E2 功能层完成 · ✅ E3 代码层完成（六主题已并入本期；评审点 #1/#2 待真机）· ✅ E4 完成（监控台第二窗评估后砍掉）· ✅ §6 度量基建交付 · ✅ E5 完成（核心路径补全 + 反馈层）。已交付：`renderer/deck/` 全目录（引擎 hook / 目标带 / 模块坞 / 步骤板 / 待决卡 / Tape / 控制中心 / 13 个真实数据面板 + diff 焦点卡）、统一浮层栈 + ⌘K 命令层（真模糊评分 + › 前缀锁域 + 分组 + 会话搜索，与坞/快捷键表同源）、通知抽屉 + Toast 双通道（事件同源、toast 上限 5）、刹车双通道（Space 冻结/恢复，接 pausePrompt/resumePrompt）、六主题全量移植（token 表热切换 + 持久化）、设置（主题/语言/切回经典/实验度量）、快捷键表、编辑器浮层（文件树→编辑→保存，文件抽屉深链）、`.gi` 语义图标全量替换 emoji、待决卡决策点视觉锚（高危红呼吸/普通琥珀描边）、§6 度量基建、`lib/layout.ts` 开关与自动回落、i18n 六语言、`scripts/check-deck-size.js` 行数门禁、242 个 desktop 测试全绿（deck-layout 11 + deck-e3 15 + deck-e4 5 + deck-metrics 10 + deck-e5 6）。核心路径「提问→批准→看 diff」三步自此全部可在 Deck 内走完（漏斗 diff 步可由 Deck 触发）。已知留白：成本仪表无单价源显示 "—"；评审点 #1/#2 需真机使用产生数据后在 Deck 设置「实验度量」读数；自律度拨盘/闸门/工单起草页按 §4 引擎红线裁剪不做；license:check 存在 E0 前已有的 sharp-win32 扫描失败（与本方案无关，darwin 上通过）。

### E0 — 开关与骨架（最小可合入）✅ 已完成

- `deck/` 骨架：目标带 + 左缘模块坞（静态 18 入口）+ 空主区；`deck-tokens.css` + Liquid Glass 一张主题表先行。
- §2 两个挂点 + §3 回退机制（含 chunk 失败自动回落）。
- 行数检查脚本（§1.5）进 `npm run check`。
- **验收**：设置里切换布局热生效；双向切换十次无异常；人为 chunk 404 自动回落经典；Liquid Glass 下单页不破版；经典布局逐像素不变；bundle 分析确认 deck chunk 仅在选中时加载。

### E1 — 核心闭环 ✅ 已完成

- Tape 记录仪接真实消息流；步骤板接 UpdatePlan；指令输入走 `sendUserPrompt`；待决卡接权限询问流；⌘⇧O 控制中心雏形。
- **验收**：真实会话全流程（提问→流式→权限批准→计划更新）在 Deck 内完成，不需要切回经典。（代码级闭环 + 单测覆盖；真机走查待评审点 #1 一并进行）

### E2 — 控制中心 + 模块坞接线 + 六主题补齐 ✅ 已完成

- ✅ 控制中心（仪表四宫格接 usage / 指令留痕 / 状态观测流）；模块坞 13 个入口接真实面板数据（车间墙/文件/变更/进程/知识源/账本/任务树/插件/检查点/审查/资产 + Tape/控制中心）。
- ✅ 六主题移植并入 E3 交付（2026-08-20）。
- **验收**：评审点 #1——核心路径（提问→批准→看 diff）点击数/耗时对比经典布局，决定是否继续投入。（待真机进行）

### E3 — 浮层栈全模块 ✅ 代码层完成

- ✅ 统一浮层栈：全部浮层进一个有序栈（命令层/车间墙恒在面板之上；同层按打开顺序），Esc 关最上层、⌘⇧Esc 清栈。
- ✅ ⌘K 命令层：真模糊评分（前缀/连续/词首加权）、全模块注册表（与坞同源生成）、`›` 前缀锁域模块导航。
- ✅ 通知抽屉 ⌘⇧N：权限询问/状态迁移/MCP 变化归档（环形缓冲），坞角标未读、开即已读——错过≠丢失。
- ✅ 六主题移植：flat/glass/neu/clay/vern 五张 token 表从设计稿 Demo 提取，`data-deck-theme` 属性热切换零刷新，localStorage 持久化；主题面板 + 设置内同位选择。
- ✅ 设置 ⌘,（主题/语言/切回经典）、快捷键表 ⌘?（与命令注册表同源）、编辑器浮层（文件树→读取→编辑→⌘S 保存；文件抽屉点击深链）。
- **验收**：评审点 #2——按 §6 度量决定转正或下线。（待真机进行）

### E4 — 提案增量（来自 orca-deck-v3_change.html）✅ 完成

- ✅ `.gi` 语义图标类全量替换 emoji：`GiIcon` 组件（12/17px 描边 SVG，随主题 token 变色）接入通知类别、资产类型、待决卡标题；知识源状态改为语义 CSS 圆点。
- ✅ 决策点视觉锚：待决卡为唯一即时决策面——普通批次琥珀静态描边，高危批次（delete-\*/mutate-git-log）红色呼吸边框（urgent-pulse 移植自增量稿）。
- ❌ 独立监控台第二窗：**评估后砍掉**（2026-08-20）。理由：需新增主进程 BrowserWindow 工厂 + 新 IPC + BroadcastChannel 状态同步（Deck 引擎状态仅在渲染进程内存，需整链路序列化），故障面显著扩大；评审点 #2 尚未给出转正信号，观测需求已由控制中心（⌘⇧O）+ 通知抽屉（⌘⇧N）双落点覆盖。转正后若度量显示观测遮挡是真实痛点，再按本条另立 spec。
- **验收**：deck-e4 5 用例（图标替换/状态点/高危与普通锚）全绿；check/test 门禁通过。

### E5 — 核心路径补全 + 反馈层（2026-08-20 设计稿比对缺口批次）

> 比对结论：E0–E4 交付完整，但对照 `orca-deck-v3_change.html` 终态仍有缺口。本批只取**不触碰引擎红线的四个**（自律度拨盘/闸门/起草页/划线等仍按 §4 裁剪，不做）：

- **E5.1 diff 焦点卡**：变更面板逐文件接 `gitDiff`（unified diff 解析渲染：hunk/增/删/行号；二进制与空 diff 诚实提示）——补齐评审点 #1 核心路径「提问→批准→看 diff」的第三步，此前 Deck 内无任何 diff 入口。
- **E5.2 刹车双通道**：接 core 已有的 `pausePrompt`/`resumePrompt`（冻结/恢复、现场保留，非 interrupt 销毁）；Space 触发（非输入态），舞台控制行按钮同位。
- **E5.3 Toast 反馈层**：右上 3.5s、上限 5 条，与通知抽屉同源事件（引擎状态迁移即时可见）——补齐 demo 的「toast 落档」双通道。
- **E5.4 命令层分组 + 会话搜索**：结果按 工单/视图/主题/动作 分组显示；注册表纳入当前工作区会话（按标题模糊搜索，回车切换工单）。
- **验收**：deck-e5 测试（diff 渲染/刹车两向/toast 上限/分组与会话搜索）；`npm run check && npm test` 全绿；核心路径三步全部可在 Deck 内走完（漏斗 diff 步自此可由 Deck 触发）。

### E6 — 形态对齐批次（2026-08-20，设计稿形态差距收口）

> 授权口径：本分支内允许较大改动；红线不变——core/preload/IPC 零改动、经典层零触碰。引擎红线项（自律度拨盘/闸门/工单起草页/步骤划线）继续不做。

- **E6.1 抽屉边缘停靠**：files/changes 停左缘、notifications 停右缘、processes 停右缘（宽型）——侧边停靠无 scrim，可与中心浮层共存；抽屉互斥（开一个收其他）；Esc 仍从栈顶关（中心浮层先关、抽屉最后收，与 demo 语义一致）。
- **E6.2 车间墙卡片化**：行列表升格为 3 列工单卡片（状态色 tag + 标题 + 时间 + active 描边）——迷你步骤等无真实数据源的装饰不做（诚实原则）。
- **E6.3 知识源二级详情页**：列表 → 详情（各源真实统计 + 重建动作接 codegraphReindex/wikiUpdate/crgReindex）；插件/审查详情因无真实数据源不做。
- **E6.4 Onboarding 三步导览**：首次进入 Deck 显示导览模态（⌘K 命令层 / 工单可改 / Space 刹车），localStorage 记忆不再打扰——coverage §5「三步导览卡」落点。
- **E6.5 控制中心常驻化**：右缘居中小浮窗常驻 + 收起后右缘竖排拉手（未读角标 + 待决 urgent 脉冲）；⌘⇧O 切换开合；不再走浮层栈。
- **验收**：既有 deck 测试全绿（选择器兼容）+ deck-e6 新用例（抽屉停靠与互斥/卡片墙/知识源详情/导览一次性/CC 开合）；`npm run check && npm test` 全绿。

**E6 交付记录（2026-08-20）**：✅ 全部完成——抽屉停靠（DrawerShell 左右缘无 scrim、互斥、存在即 toggle）、车间墙 3 列卡片（状态色 tag + active 描边，无假数据装饰）、知识源列表→详情（真实统计 + codegraph 重建 / wiki 更新动作）、Onboarding 三步导览（⌘K/工单可改/Space 刹车，localStorage 一次性）、控制中心常驻（右缘浮窗 + 收起拉手带未读角标与待决 urgent 脉冲，⌘⇧O 切换，收起状态持久化）。desktop 249 测试全绿（deck 系列累计 54 用例）。

## 6. 度量与退出

- **度量基建已交付（2026-08-20）**：`renderer/lib/core-path-metrics.ts` 在共享 api 桥上透明代理采集（双布局单点，经典层组件零触碰，隔离红线不破）——核心路径漏斗（提问→批准→diff，含点击数/耗时/批准结果/未完走标记）、布局启动与切换记账（开启率/7 日留存原始数据），localStorage 环形缓冲、全程 fail-open；Deck 设置面板内置「实验度量」读数区。评审点 #1/#2 自此可执行：真机使用后在设置面板直接读数比对。
- **采用**：Deck 开启率、7 日留存（切走后未切回）；**效能**：核心路径点击数/耗时 vs 经典；**健康**：Deck 专属 bug 量、六主题破版报告。
- **下线（仅兜底）**：删 `deck/` 目录 + 回退 §2 两处挂点（各 ≤10 行）+ messages.ts 追加词条，即净身退出——隔离红线保证经典层全程无感。
- **转正（默认预期）**：Deck 设为默认布局，经典层进入弃用倒计时后退役（删 App.tsx 旧交互层与旧六主题，`--ui-*` 轨并入 deck token 轨）——这一步另立 spec 执行。

## 7. 与 v1/v2 的关系

- **v1**（desktop 内加开关）：落点被 v3 继承；"双布局污染经典层"的原始担忧由 §1 目录级隔离 + §3 自动回落解决。
- **v2**（独立包 `packages/deck`）：废弃——基座镜像漂移、双构建链、release 复杂度，"避免问题"。其讨论产出（设计稿六主题切割、稳定兜底、数据流映射、度量框架）全部继承进 v3。

## 附录：前端技术栈实测（2026-08-20）

React 19 + TS，esbuild（`splitting:true`，React.lazy 独立 chunk）；无状态库（`App.tsx` 1527 行 + 11 领域 hooks）；8591 行 `ui.css`（`--ui-*` token）+ 旧六主题样式表 `<link>` 热替换；UI 偏好走 localStorage（`deeporca.theme` 等）；设置 UI 在 `SettingsPanel.tsx` 外观 tab；视图复合 `sidebarView(11) × mainView(3)`；全仓库无既有 feature-flag 机制（本方案建立最小模式）；Electron 依赖仅 6 文件（主进程壳 + 薄桥 + 两处隐藏 Chromium），与本方案正交。
