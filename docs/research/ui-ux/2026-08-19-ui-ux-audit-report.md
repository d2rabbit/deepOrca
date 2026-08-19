# DeepOrca 桌面端 UI/UX 现状审计报告

> 日期：2026-08-19 · 审计范围：`packages/desktop/src/renderer/`（约 40 个组件、8904 行 `ui.css`、6 套主题）
> 配套文档：[[2026-08-19-ui-ux-redesign-vision]]（设计愿景）、[[2026-08-19-ui-ux-redesign-wireframes]]（设计稿）
> 方法：全量代码走查（布局 / 交互流 / 视觉系统 / 快捷键 / 反馈机制），所有结论附 `文件:行号` 证据。

---

## 0. TL;DR

DeepOrca 的 UI 底子很好——性能意识（流式节流、懒加载、渲染缓存）和 agent 细节（上下文仪表条、权限三色分级）都是一线水准。**问题不在做工，在结构**：功能面膨胀（11 个侧栏视图 + 8 个 rail 动作 + 8 类浮层）但没有信息架构来承载，导致导航过载、入口割裂、状态复合，并已经滋生出一个疑似真实缺陷（右侧预览面板无 grid 归属，核心卖点功能可能渲染出窗口外）。

一句话诊断：**一个工程师思维的功能清单，缺一层用户心智的收纳设计。**

---

## 1. 现状结构总览

### 1.1 Shell 网格

`.ui-shell` 是一个 4 轨 CSS Grid（`App.tsx:1156-1158`, `ui.css:135-197`）：

```
┌──────────────────────────────────────────────────┐
│ rail(52px) │        TopBar(48px, 兼窗口标题栏)     │
│            ├──────────────┬───────────┬──────────┤
│  19 个按钮  │ 侧栏 280px    │ 主区聊天流  │ 右栏 0px │
│            │ (200–480 可拖)│ + 悬浮输入 │ (疑似坏) │
└──────────────────────────────────────────────────┘
```

- 左侧 rail：**19 个按钮**挤在 52px 竖条（`App.tsx:1160-1297`），无分组、无滚动兜底、无溢出菜单。
- 顶栏 48px 内同时承担：红绿灯/窗口控制、项目分支 pill、流式状态、**双模型选择器**、token 迷你面板（`TopBar.tsx:116-364`）。
- 视图状态是**两套正交系统**：`sidebarView`（11 个，`use-panel-layout.ts:4-15`）× `mainView`（chat/settings/plugins，`App.tsx:170`），再叠加任务树 tab、两个预览面板、8 类浮层。

### 1.2 功能面清单

| 类别 | 数量 | 明细 |
|---|---|---|
| 侧栏视图 | 11 | explorer / git / tasks / tokens / index / review / design / tasktree / gitmcp / editor / plugins |
| rail 动作 | 8 | 新会话、命令面板、推理模式、主题×2、撤销、设置等 |
| 浮层/模态 | 8 | palette、undo、shortcuts、trust、分支冲突、DiffOverlay、EditorOverlay、preview |
| slash 命令 | 17 | 其中近半是 `/pm-design` 一家的别名（`/prototype`、`/openui`、`/pm-design-openui`） |
| 主题 | 6 | aqua / metro / glass / fusion / line / orca（默认 line） |
| 设置 tab | 7 | endpoints / model / appearance / memory / permissions / actions / about |

---

## 2. P0：疑似缺陷（建议优先真机验证）

### P0-1 右侧预览面板丢失 grid 归属，可能被挤出窗口

- `.ui-preview-panel`（`App.tsx:1500、1544`）是 `.ui-shell` 的直接子元素，但 `ui.css:8717-8726` 只定义了宽度/边框/动画，**没有任何 `grid-area` / `grid-column` 规则**。Grid 自动摆放会把它放进第 4 轨道（`rightpanel` 单元格），而该轨道宽度恒为 0——480px 宽的面板将向右溢出容器。
- 佐证：`.ui-shell.right-open`（第 4 列 340px）与 `.ui-rightpanel` 组件类（`ui.css:191-197、201-212`）在全部 TSX 中**零引用**，是改版后遗留的死代码——右侧 dock 机制改过版但接线丢了。
- 影响面：PM-Design / DeepDesign 预览是本产品的差异化卖点，若真的不可见属于发布阻断级问题。
- 附带：`previewOpen` 与 `graphHtml` 两个面板可同时挂载（`App.tsx:1499、1543`），无互斥逻辑。

### P0-2 Rail 条件显隐导致布局跳动

`tasks` 按钮仅当会话有计划时才出现（`App.tsx:1181-1190`）。按钮的出现/消失会让其下方所有 rail 按钮位移，破坏肌肉记忆，也让"任务"这个核心概念的发现性完全依赖偶然。

---

## 3. P1：结构性问题（信息架构层）

### P1-1 导航过载：19 个平级按钮，无组织

11 个面板视图 + 8 个动作混排在一根 52px 竖条里，没有分组、没有层级、没有滚动兜底（窗口过矮时底部按钮直接被裁）。对比成熟产品的惯例（VS Code 6 个、Cursor 4 个），超出 2–3 倍。

### P1-2 视图状态过度复合，已是 bug 温床

`sidebarView × mainView × taskTabs × preview × 浮层` 的状态组合耦合出实际缺陷：主区内联编辑器要求 `sidebarView === "editor" && editorFile` 同时成立（`App.tsx:1411`）——从 Git 面板点"打开编辑器"只设置了 `editorFile`，若不手动切到 editor 视图，主区毫无反应。这类"状态组合空格"会随功能增加持续产生 bug。

### P1-3 功能入口割裂、发现性差

- **任务树有两套 UI**：侧栏视图（rail 🌳）和主区 tab（只能从会话徽章进入，`App.tsx:1421-1444`）——后者几乎不可能被发现。
- `$` 命令菜单、`⌘O/⌘J` 进程面板、会话 badge 点击行为均无可见提示。
- 设置/插件详情**整页替换聊天区**（无侧吸、无分屏），返回依赖显式 Back，打断心流。

### P1-4 命令面板名不副实

注释自称 "fuzzy-ish" 实际只是 `includes` 子串匹配（`ui/command-palette.tsx:45-51`）；**仅注册 11 条命令**（`App.tsx:957-1041`），对 11 面板 × 6 主题 × 17 slash 命令的功能面覆盖率极低。快捷键表、slash 菜单、命令面板三份能力清单各自为政、互不重合。

### P1-5 权限流打断性强且状态隐晦

权限卡是逐 scope 单项问答（`PermissionCard.tsx:20-48`），scope 多时需要多轮点击；其间 composer 整体禁用（`App.tsx:1120`）。更隐晦的是 deny 后的 `pendingPermissionReply` 会静默合并进下一次 prompt（`App.tsx:697-724`）——用户无从感知自己的拒绝决定去了哪里。

---

## 4. P2：体验层问题

| # | 问题 | 证据 |
|---|---|---|
| P2-1 | **视觉语言断裂**：37 个统一 SVG 描边图标中，design/tasktree 用 emoji 🎯🌳，内嵌 tab 用 ✦◈✕ | `App.tsx:1236、1244、1427、1507-1547` vs `ui/icons.tsx` |
| P2-2 | **快捷键冗余/冲突**：`⌘O` 与 `⌘J` 绑定同一动作；`⌘O` 与系统"打开"惯例冲突；无 `⌘1-9` 视图切换；无全局 Esc 浮层栈 | `use-global-shortcuts.ts:28-61` |
| P2-3 | **浮层各自为政**：8 类浮层独立管理关闭逻辑，无统一 Esc 栈 | §1.2 |
| P2-4 | **主题入口分散**：设置面板下拉 + rail glass 开关 + punk 开关三处，且按主题条件显隐 | `App.tsx:1266-1285` |
| P2-5 | **i18n 残留**：6 语言框架规范，但 slash 描述、"N messages"、预览 tab、"Loading…" 等硬编码英文 | `Composer.tsx:49-83`, `MessageList.tsx:180-182` |
| P2-6 | **tooltip 不统一**：rail 用 `data-tip` CSS 自定义，其余混用原生 `title` | `ui/rail.tsx:30-44` vs `ui/feedback.tsx` |
| P2-7 | **命名不一致**：App 名 DeepOrca vs 仓库 deepcode-cli；"index"实为知识仪表盘；"gitmcp"暴露实现名 | `i18n/messages.ts:660` |
| P2-8 | **onboarding 薄弱**：首开仅 trust dialog + 4 张欢迎卡，11 个面板、6 套主题无导览 | `MessageList.tsx:133-170` |
| P2-9 | 设置内 `actions` tab 是开发者调试面（defineAction 注册表），对普通用户是噪音 | `SettingsPanel.tsx:24-33`, `ActionsPanel.tsx:6-15` |
| P2-10 | 小腐化：`use-panel-layout.ts:3` 注释 "ten views" 实为 11 | — |

---

## 5. 值得保留的亮点（重设计时的资产）

重设计不是推翻，以下做得好的部分应原样继承：

1. **性能纪律**：流式事件 250ms 节流（`App.tsx:441-478`）、Monaco/重面板懒加载（注释估算延后 5MB+，`App.tsx:39-51`）、markdown 渲染缓存、`React.memo` + 稳定回调。
2. **消息列表吸底/未读逻辑**：80px 阈值、未读计数、jump-to-latest pill（`MessageList.tsx:76-131`）——教科书级实现。
3. **上下文透明度**：ContextProgress 仪表条（`ContextProgress.tsx`）、顶栏 token pill、compacting 横幅——agent 客户端的差异化细节。
4. **权限三色风险分级**（`lib/permissions.ts:106-118`）。
5. **主题 token 架构**：`ui.css` 独占结构、主题文件只绑 `--ui-*` 语义 token、运行时零刷新换肤——这套架构为重设计提供了完美的地基。
6. **A2UI / RichToolResult 富结果渲染**：symbol-tree、review-comments 等 6 种结构化工具结果（`RichToolResult.tsx:20-46`）。

---

## 6. 量化一览

| 指标 | 数值 | 健康参考 |
|---|---|---|
| rail 按钮数 | 19（平级） | ≤ 7±2，且应分组 |
| 侧栏视图 | 11 | 宜收编为 4–5 个区 |
| 并存的浮层类型 | 8 | 需统一栈管理 |
| 命令面板覆盖率 | 11 条命令 / 40+ 功能点 | 应 100% 覆盖 |
| `ui.css` 体量 | 8904 行 | 建议随重设计做组件化拆分 |
| 主区条件渲染分支 | 5 路嵌套（`App.tsx:1392-1496`） | 宜改为声明式 view router |
| 死代码 | `.ui-rightpanel` / `.ui-shell.right-open` 零引用 | 应清理或接线 |

---

## 7. 结论与建议路径

按"先止损、再重构、后差异化"三步走（详细设计见配套文档）：

- **P0 止损**：验证并修复右侧预览面板 grid 归属；消除 rail 条件显隐。
- **P1 重构**：导航从 19 平级收编为 5 区；引入统一浮层栈与全量命令面板；权限改批量队列。
- **P2 差异化**：以「阶段指挥舱」重构消息流（见设计愿景），把上下文透明度、任务树、主题系统三个已有资产抬成核心竞争力。
