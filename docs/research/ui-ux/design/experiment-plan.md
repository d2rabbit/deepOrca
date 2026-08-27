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

**进度（2026-08-20）**：✅ E0 完成 · ✅ E1 完成 · ✅ E2 功能层完成 · ✅ E3 代码层完成（六主题已并入本期；评审点 #1/#2 待真机）· ✅ E4 完成（监控台第二窗评估后砍掉）· ✅ §6 度量基建交付 · ✅ E5 完成（核心路径补全 + 反馈层）· ✅ E6 完成（形态对齐批次）· ✅ E7 完成（工单交互层）· ✅ E8 完成（自适应工作面板 + 主区标签页完全体）· ✅ E9 完成（Studio 样板：action 目录工作台，deck 系列累计 72 用例）。已交付：`renderer/deck/` 全目录（引擎 hook / 目标带 / 模块坞 / 步骤板 / 待决卡 / Tape / 控制中心 / 13 个真实数据面板 + diff 焦点卡）、统一浮层栈 + ⌘K 命令层（真模糊评分 + › 前缀锁域 + 分组 + 会话搜索，与坞/快捷键表同源）、通知抽屉 + Toast 双通道（事件同源、toast 上限 5）、刹车双通道（Space 冻结/恢复，接 pausePrompt/resumePrompt）、六主题全量移植（token 表热切换 + 持久化）、设置（主题/语言/切回经典/实验度量）、快捷键表、编辑器浮层（文件树→编辑→保存，文件抽屉深链）、`.gi` 语义图标全量替换 emoji、待决卡决策点视觉锚（高危红呼吸/普通琥珀描边）、§6 度量基建、`lib/layout.ts` 开关与自动回落、i18n 六语言、`scripts/check-deck-size.js` 行数门禁、242 个 desktop 测试全绿（deck-layout 11 + deck-e3 15 + deck-e4 5 + deck-metrics 10 + deck-e5 6）。核心路径「提问→批准→看 diff」三步自此全部可在 Deck 内走完（漏斗 diff 步可由 Deck 触发）。已知留白：成本仪表无单价源显示 "—"；评审点 #1/#2 需真机使用产生数据后在 Deck 设置「实验度量」读数；自律度拨盘/闸门/工单起草页按 §4 引擎红线裁剪不做；license:check 存在 E0 前已有的 sharp-win32 扫描失败（与本方案无关，darwin 上通过）。

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

### E7 — 工单交互层（2026-08-20，用户授权：deck 侧复刻引擎红线项）

> 原红线「不接管引擎循环」的**落地方式更新**：经授权，自律度/闸门/起草页/划线四项在 **deck 侧复刻**——core 引擎循环零改动、经典层行为零影响，全部实现为「引擎之上的策略层」：
>
> - 自律度 = 权限询问的 **deck 侧自动放行策略**（批内全部 scope 命中档位白名单 → 自动 /continue 放行并 toast 留痕；否则照常出卡）
> - 闸门 = 步骤迁移观测 + **刹车 API 拦停**（`pausePrompt` 在循环检查点冻结 → 确认卡 → `resumePrompt` 放行），不侵入引擎调度
> - 起草页 = **结构化 prompt 下发**（标题 + 编号步骤清单 → 引擎经 UpdatePlan 采用 → 驱动真实步骤板）
> - 划线 = 会话级本地标注（划线步骤样式 + 其闸门停用；可恢复）

- **E7.1 自律度拨盘**：三档（全自动=仅 delete-\*/mutate-git 拦 / 关键确认=读类自动、写/网/MCP/高危拦 / 每步确认=全拦），⌥1/2/3 与拨盘点击切换，localStorage 持久化；自动放行走既有 /continue 协议（漏斗记账为 granted）。
- **E7.2 步骤闸门**：步骤板逐条可切 自动/完成时确认/开工前确认；闸门命中 → 自动刹车 + 确认卡（继续=恢复；保持冻结=只关卡）；触发按 会话+步骤+相位 去重；持久化按会话。
- **E7.3 工单起草页**：⌘N 打开；标题 + 步骤（增删改）+ 逐条闸门；「盖章下发」把工单编成结构化 prompt 发给引擎（引擎 UpdatePlan 采用后驱动步骤板），浮层关闭并 toast。
- **E7.4 步骤划线**：步骤条双按钮之一划线/恢复（line-through + 透明度），其闸门停用；纯本地标注不惊扰引擎。
- **验收**：deck-e7 用例（策略三档判定/自动放行与出卡分流/闸门迁移触发与去重/起草下发 prompt 断言/划线样式与闸门停用）；既有 249 测试全绿；`npm run check && npm test` 全绿；core 与经典层 diff 为零。

**E7 交付记录（2026-08-20）**：✅ 全部完成——自律度三档（⌥1/2/3 + 拨盘，批内全命中即自动 /continue 放行并 toast 留痕；默认档修复为「关键确认」，此前 `Number(null)=0` 会把未设置读成全自动）；步骤闸门（自动/开工前确认/完成时确认，迁移侦测纯函数 + pausePrompt 拦停 + 确认卡恢复——确认直发 resumePrompt，规避暂停未落地时 brake 误判；会话+步骤+相位去重）；工单起草页（⌘N，标题+步骤+逐条闸门 → 结构化 prompt 盖章下发，引擎 UpdatePlan 采用后驱动步骤板）；步骤划线（本地标注 line-through，划线步骤闸门停用）。desktop 257 测试全绿（deck 系列累计 62 用例）。实现期发现并修复测试基建问题：断言 actual 为 jsdom DOM 节点时 node:test 的错误 diff 会遍历 DOM 卡死（表现为超时假象），deck 测试统一改为布尔/文本断言。

### E8 — 自适应工作面板 + 主区标签页完全体（2026-08-20，用户授权：设计稿仅作参考）

> 口径：设计稿（`orca-deck-v3_change.html`）是参考而非终态——尺寸全部走自适应；交互层本体是单一工作面板，凡适合「载入第二 tab」的模块给完全体，浮层保留缩略。设计稿中的任务树/知识源/审查只是缩略展示，完全体落在主区标签页。

- **E8.1 自适应尺寸**：浮层 460/720px 定宽 → `clamp(340px,44vw,560px)` / `clamp(540px,62vw,920px)`；抽屉 320/420 → `clamp()`；控制中心 300 → `clamp(260px,24vw,360px)`；主区栏 860 → `min(1060px,100%)`；新增 ≤1024px 窄窗媒体查询（浮层 94vw、抽屉/CC 收 vw 上限、画布与审查台栅格落单列）。
- **E8.2 主区标签页**：工单为固定首签（待决/闸门挂起时 urgent 脉冲，与 CC 拉手同语义）；模块完全体（任务树/知识源/审查）经浮层头 ⇱「在标签页打开」或 ⌘K「· 在标签页打开」命令载入，可切换可关闭；Esc 在栈空时退标签页（退栈语义延伸）；标签页内容区 `min(1240px,100%)` 比工单栏更宽。
- **E8.3 任务树完全体**：分支车道画布（纯函数 `tree-layout`：活跃分支主线 + 按分叉点缩进挂道），节点状态字形（完成=合并实点/进行=当前环/放弃=死点），why 叙事内联 + 悬停；节点详情卡（why/工件数/快照恢复接 `taskTreeSnapshotRestore`）；分支操作全接真实 IPC——切换/放弃/合并/分叉（why 必填）；reflog 操作日志可开合；归档/取消归档。
- **E8.4 知识库/索引完全体**：六源卡片墙（状态点/计数/上次同步）+ CRG 索引库卡（crgList 真实图状态）；就绪度 tag + 全部重建（codegraphReindex/wikiUpdate/crgReindex 三路扇出）+ 重建期三通道进度流（onCodegraphProgress/onWikiProgress/onCrgProgress 尾行）；详情页 kv 统计栅格 + 工作区清单 + **wiki 页内联阅读**（wikiListPages→wikiReadPage 三级）；memory L0–L3 管线计数。
- **E8.5 代码审查完全体**：**修复死通道**——旧浮层走 `review:run` IPC，主进程无处理器（必失败）；改走活路径 `actionRun("review.check-available")` / `actionRun("review.full")` + `onActionProgress` 统一进度流。结构化发现渲染（path:startLine + 建议代码折叠 + statusNote + CRG 变更节点数）；每条发现可「转为介入」（接 `engine.send`，引擎忙时禁用并提示）；本次会话运行历史（诚实口径：仅当前 app 会话，上限 20 条），标签页全量含历史侧栏、浮层缩略只留最新一次。
- **验收**：deck-e8 6 用例（标签页开合切换/Esc 退页/树车道与 switch·fork IPC/卡片墙·重建扇出·wiki 阅读/审查活路径·介入·历史/浮层缩略无历史栏）；desktop 263 测试全绿（deck 系列累计 68 用例）；`npm run check && npm test` 全绿；core 与经典层 diff 为零。

**E8 交付记录（2026-08-20）**：✅ 全部完成。新增 `tree-canvas.tsx` / `sources-dashboard.tsx` / `review-workbench.tsx` / `lib/tree-layout.ts`；`overlay.tsx` 加 ⇱ expand；`command-registry` 加 tab 命令组（与坞同源）；i18n 六语言 +43 键；`deck.css` 1826 行（门禁 2000 内）。设计稿增量稿中"召回测试/查看日志"按无真实数据源不做（诚实原则），监控台第二窗维持 E4 砍单结论。

### E9 — Studio 样板：action 目录工作台（2026-08-21，用户授权：除 agent 外核心能力打包成 action 浮出水面）

> 口径：**除 agent 会话循环外，核心能力已全部注册为 defineAction**（review/index/design/tasks/browser/work/system 七类约 30 个）——E9 不新增任何后端通道，把 ActionRegistry（LLM 工具面/IPC/MCP 同源单实例）原样浮成 Deck 实验区的 Studio 样板，是 H 线 Studio 基座（`specs/studio-base-boost/`）的先行交互验证；只动 deck/ 与 i18n，经典层零触碰。

- **E9.1 action 目录**：坞第 19 入口（⚡ Studio）→ 宽浮层缩略 / ⇱ 载入主区标签页完全体；`actionList()` 载荷含完整 ActionDefinition（parameters/sideEffects，渲染层本地扩型读取，**IPC 契约零改动**）；按 category canonical 序分组（审查/索引与知识/设计/任务树/浏览器/工作/系统），id 描边字 + 描述 + sideEffects 标签；搜索按 id+描述过滤。
- **E9.2 参数表单自动生成**：按 action 的 JSON schema 渲染——string→文本、number→数字、boolean→勾选、enum→下拉；required 未填禁运行；可选空值自动剔除（`assembleInput` 纯函数）。
- **E9.3 运行与结果**：`actionRun(id, input)` + `onActionProgress` 统一进度流（按 actionId 过滤）；结果结构化渲染（comments 数组走发现行，其余 pretty JSON，错误显 code+error）；本次会话运行历史（上限 20，诚实口径），标签页全量含历史侧栏（点击跳回源 action），浮层缩略只在 runner 下显最近一次。
- **验收**：deck-e9 4 用例（分组/搜索/schema 表单与必填门禁/枚举下拉与失败面/历史侧栏跳源）；既有 deck-layout 坞计数断言 18→19 同步；desktop 267 测试全绿（deck 系列累计 72 用例）；`npm run check && npm test` 全绿；core/preload/IPC/经典层 diff 为零。

**E9 交付记录（2026-08-21）**：✅ 全部完成。新增 `studio-panel.tsx`；坞/类型/标签页/命令层/宽浮层接线；i18n 六语言 +16 键；`deck.css` 1875 行（门禁 2000 内）。已知留白：action 无取消按钮（registry 有 CANCELLED 错误面但 IPC 未暴露取消句柄，待 H 线 module-system 阶段一并）；history 仅会话内存不落盘（与 E8.5 同口径）。

### E10–E14 — 交互层补全 + 视觉对拍对齐 + 引擎深度集成（2026-08-22，`7efb951`）

> 本批后 Deck 的设计稿 27 帧承诺全部落地；交付明细以该提交信息为台账，此处仅存目。

- **E10 交互层补全**：步骤板完全体、AskUserQuestion 决策块（修复 deck 无法作答导致 `waiting_for_user` 卡死）、zen 专注模式 ⌘.、j/k 步骤导航、onboarding 自律度三选、空态 CTA。
- **E11 模块深化**：账本按模型分段 + meter 条、上下文拆解焦点卡、插件二级页、资产 designRead 详情。
- **E12 视觉对拍对齐**（Playwright + stub 截图核验）：深玻璃基底补齐、浮层锚定与单 scrim、`:where()` 按钮零优先级重置等。
- **E13/E14 引擎深度集成**：中央区回归设计稿形态（指令统一走控制中心，@文件引用 / ✨提示词增强 / Plan 芯片），技能菜单与 chips 下发、工具事件进观测流、审查 overlay⇨tab 运行记录连续。测试 267/267 绿。

## 8. 并线批次 — modern-ui-redesign 合并基座（2026-08-26）

冻结线 `feat/modern-ui-redesign`（潮汐舞台/枢纽重构等 100 提交）已并入本分支作为演进基座。合并带来的契约演进的 deck 侧适配：

1. **知识源域拆分**：核心四源留在 `knowledgeStatus()`（新增 archmaps），memory/routing/serena 移入独立 `MemoryRoutingStatus()`——`sources-dashboard.tsx` 并双源为一张七卡墙，archmaps 详情补文件清单。
2. **渲染管线统一**：经典层的 marked+DOMPurify 字符串管线已被 Streamdown 取代，deck `tape.tsx` 同步迁移至共享 `StreamdownView`（XSS 边界同源）。注意 Streamdown 粗体输出为 `span[data-streamdown=strong]`。
3. **测试口径同步**：全量去 emoji 后徽标图标为 SVG，字形断言改结构断言；tape 测试补 Suspense flush。合并后全仓 `npm test` 682+337+14+57 全绿。

与冻结线的经典层改动互不污染的隔离红线继续有效；后续冻结线新能力（如 compactTokenThreshold 自定义、doc-wiki D 线落地后的第七知识源卡）在 deck 侧按需复刻。

## 9. E15 — 控制中心模型/思考热切换 + 压缩阈值对齐（2026-08-27）

> 口径：E13 把指令统一收进控制中心后，模型与思考档位仍要去经典层顶栏才能切——这是布局内最大的交互缺口；同时冻结线把压缩阈值做成用户可配，deck 的上下文水位若不读取就会虚高/虚低。本批零新后端通道，全部走既有 IPC。

- **E15.1 模型/思考胶囊行**（CC 仪表格与指令区之间）：`use-deck-settings` 读 `getSettings()` 快照；模型下拉来自 endpoint 注册表（同经典 TopBar 数据源），思考下拉按当前模型家族真实档位派生（`@deeporca/core/capabilities` 的 `familyThinkLevels`/`resolveModelSpec`/`lib/model-utils` 同源复用）；切换走 `setModel` / `setThinkingMode` 热路径并整包采用回传 summary；引擎忙时禁用。
- **E15.2 压缩阈值对齐**：上下文焦点卡的水位与阈值改传 `settings.compactTokenThreshold` override——与经典层 ContextProgress 完全同口径，用户自定义阈值在 deck 生效。
- **实现说明**：`hooks/use-deck-settings.ts` 对 summary 做形状守卫（stub/半残载荷一律落 null，消费端必须空保护）；`components/model-capsule.tsx` 自持组件+`deck.css` 胶囊行样式；i18n 六语言 +2 键（tooltip）。
- **验收**：deck-model-capsule 4 用例（注册表渲染与激活键/setModel 能力感知载荷/setThinkingMode 热补丁/override 阈值生效）；desktop 全量 341 用例绿；typecheck/lint/format 全过。

**已知留白**：会话管理三操作（重命名/删除/导出）尚未进车间墙卡——需先拍板卡片动作的密度口径；archmaps 详情可进一步接 `knowledgeReadArchmap` 内联预览（HTML/Mermaid 双形态）。

## 10. E16 — 车间墙会话操作簇 + archmaps 内联预览（2026-08-27）

> 口径：上节两项留白落地。导出（exportSession）暂缓——写盘结果需要 toast 呈现路径，与 deck 现有静默 best-effort 操作语言不一致，待通知面拍板后一并。

- **E16.1 车间墙操作簇**：非激活卡片 hover 显现三操作——改名（行内编辑器，Enter 提交走 `renameSession`，Esc 取消，失焦即提交）、归档（原 ✕ 语义不变）、删除（图标升级为 trash SVG；两步就地确认——首击 armed 态、再击执行 `deleteSession`，点击卡外/其它操作自动解除）。激活会话不出操作簇。删除二步确认对齐经典层"删除二次确认"UX 规则。
- **E16.2 archmaps 内联预览**：详情页文件清单可点开，`knowledgeReadArchmap` 按形态分派——HTML 板进 `sandbox=""` 全沙箱 iframe（无同源无脚本，工件无法触及外壳）；Mermaid 文档走共享 `MermaidDiagram` 管线；遗留 A2UI surface JSON 降级 pretty JSON 文本展示。错误态诚实显示 `deck.opFailed`。
- **实现说明**：`icons.tsx` 补 trash 图标 id；死样式 `.deck-wo-archive` 清除；i18n 六语言 +3 键（rename/delete/deleteConfirm）。
- **验收**：deck-e16-ops 3 用例（改名载荷/删除两步确认与解锁/archmap iframe sandbox 与读取载荷）；desktop 全量 344 用例绿；`npm run check` 全过（deck-size 门禁含）。

**仍留白**：exportSession 车间墙入口（见口径）；action 取消句柄（等 H 线 module-system）；CC 上下文仪表加水位色带（低价值观察项）。

## 11. E17 — 车间墙导出（toast 反馈通路）+ CC 水位色阶（2026-08-27）

> 口径：上节两项留白落地。导出反馈沿用 deck 既有的 app 层 toast 回调模式（`useDeckToasts` 所有权在 deck-app，`useWorkOrder` 同款回调下发），不引入新反馈基建——"静默 best-effort 与 loud 操作分层"就此定型：改结果可见的操作走 `onNotify`，其余维持安静。

- **E17.1 车间墙导出**：操作簇第四项（export SVG 图标），`exportSession` 结果三分支——成功 `ok` toast 带目标路径；失败 `bad` toast 带 error；用户取消保存对话框（ok 无 path）保持沉默。dcok-app 将 `toasts.push` 以 `onNotify` 注入 FloorPanel。
- **E17.2 CC 上下文水位色阶**：仪表值相对压缩阈值 ≥85% 变 warn 色、≥95% 变 bad 色——阈值读取与焦点卡同源（用户 override 优先生效）。此前只有裸 token 数，逼近压缩时无任何视觉提示。
- **实现说明**：icons 补 export 图标 id；i18n 六语言 +2 键（floor.export / floor.exported）。
- **验收**：新增 3 用例（导出成功通知含路径/失败 bad + 取消静默/CC 色阶 warn·bad 两档）；desktop 全量 347 用例绿；`npm run check` 全过。

**仍留白**：action 取消句柄（等 H 线 module-system）；history 会话内存落盘口径（E8.5/E9 同源议题）；doc-wiki D 线实施后的第七知识源卡复刻。

## 12. E18 — 知识模块深度对齐（AGENTS 就地读 / 符号检索）+ 落档通路（2026-08-27）

> 口径：合并后的经典知识模块（index-knowledge-rework R2）拥有 deck 未复刻的三块能力中可零通道复刻的两块——AGENTS.md 就地阅读与符号检索（第三块符号关系图依赖画布交互，留待知识源浮层宽窗化一并做）。

- **E18.1 AGENTS.md 就地读**：agents 源详情页直接渲染 `knowledgeReadAgents` 文档全文（root 取首个已初始化工作区），失败诚实呈现；"agents 源即这份文档"的语义就此闭合。
- **E18.2 符号检索**：codegraph 详情页新增检索行，250ms 防抖走 `knowledgeListSymbols(root, query)`，结果行 kind 标签 + 名称 + `file:line`；空查询不发起请求。
- **E18.3 loud 操作落档**：`useDeckNotifications` 暴露 `archive(level, text)`——deck-app 的 onNotify 中继升级为双通道（瞬时 toast + 抽屉落档），"错过 ≠ 丢失"从此覆盖用户主动操作（导出结果等），不再仅限引擎事件。
- **实现说明**：i18n 六语言 +2 键（symbolHint / noResults）；工作区清单渲染收窄回 codegraph 详情自身。
- **验收**：deck-e18 3 用例（agents 读取载荷与文档渲染/符号检索防抖与 kind·file:line 行/archive 触发 toast 孪生并落入环形缓冲）；desktop 全量 350 用例绿；`npm run check` 全过。

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
