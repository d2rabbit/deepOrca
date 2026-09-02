# 原型设计伴随模块（Prototype Companion）— 详细设计

> **状态**：**已合并 — 并入 [design-systems-advance](../design-systems-advance/design.md)（2026-09-02 合并定稿）**。
> 2026-08-31 拍板挂起并入 redesign；2026-09-02 redesign 方案（design-systems-advance）成为唯一方案——
> 本文的悬浮对话框 / 侧栏分轨由其 §5.6 承接；任务树落点与滚动审计两项**已由
> [task-tree-hub](../task-tree-hub/design.md) 实现关闭**（design-store 聚合呈现，无需 appendStep）。
> 本稿降级为历史输入归档保留，不再维护。
> **任务树更新（2026-09-01）**：挂起的「任务树精致化」已拍板并定稿 →
> [工作区任务树](../task-tree-hub/design.md)（工作区统一任务树；本文 §5.2 的落树矩阵
> 与 §9 P2 已按其回写）。
> **日期**：2026-08-31
> **需求来源**：[原型设计模块约束与问题记录](../../docs/research/2026-08-31-prototype-module-issues.md)（Issue 1–4）
> **前置**：[PM-Design V2](../pm-design-v2/design.md)（design-store / 两步原型流已落地）· [任务树](../archive/task-tree/design.md)（TaskTreeService / TaskTreePanel / TaskRecordPanel 已落地）
> **受众**：deepcodeUI 维护者；实现者需要熟悉 HubSheet 侧栏、ActionRun 通道、design-store 与 TaskTreeService。

---

## §0.0 拍板与挂起记录（2026-08-31）

| 项                                                      | 结论                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §5.1 sessionless 动作落 workspace 树活动分支            | **采纳**（redesign 时按此实施，仅限原型域动作）                                                                                                                                                                                                                                                            |
| §3.1 悬浮对话框 = 工作区内 DOM 浮层（非 BrowserWindow） | **采纳**                                                                                                                                                                                                                                                                                                   |
| §5.2 索引/审查后台 job 落树                             | **否决原案并后置**——代码审查、索引与知识等是**具备独立工作区的模块**（行为对齐索引库），不是 workspace 树的 step 来源；它们的记录归属随任务树精致化一起重设计（见下）                                                                                                                                      |
| 任务树精致化                                            | **已拍板并定稿（2026-09-01）→ [工作区任务树](../task-tree-hub/design.md)**：任务树 = 以工作区为根基的统一任务树（会话主任务/fork/索引构建/代码审查/原型 UI 全部并入），交互与索引库/审查同构（左工作区列表、右任务历史工作区）；TaskTree/TaskRecord 的侧栏挂载形态作废，TaskTreeService 保留为会话域数据源 |
| §6.4 侧栏滚动审计                                       | **随任务树重设计关闭**——新任务树面（task-tree-hub §6.5）按滚动契约实现并加 DOM 断言；其余既有视图的滚动审计仍随 redesign 执行                                                                                                                                                                              |

---

## §0 范围一句话

让原型设计成为**工作区内的伴随能力**：操作行为收进一个**工作区内悬浮对话框**（Issue 1），
执行**不碰主对话工作区**（Issue 2），每一次操作**落到既有任务树记录**（Issue 3），
需求文档与原型/UI 在左侧侧栏**分轨呈现并全程可滚动**（Issue 4）。

不在范围内：三管线（A2UI / OpenUI Lang / DeepDesign）的载体格式与渲染器、design-store
目录结构、TaskTreeService 存储格式——全部原样复用。

---

## §1 现状与差距矩阵

| Issue                      | 要求                                                        | 现状                                                                                                                                                                                                                                                             | 差距                                                                                                |
| -------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1 追随工作区 + 悬浮对话框  | 操作行为以工作区内悬浮对话框承载                            | 操作入口在左侧 Hub flyout 的 `PrototypeDesignPanel`；唯一"浮"的东西是独立 Electron 弹窗（`PrototypeWindow`，a2ui 预览 popout）                                                                                                                                   | 缺少工作区内 DOM 级悬浮对话框作为操作载体                                                           |
| 2 不占主工作区、无对话记录 | 模块运行不遮挡主对话，不产生主会话记录                      | `prototype.spec` / `prototype.materialize` 走 `ctx.runSubagent({ silent: true })` sessionless 通道，**已满足**                                                                                                                                                   | 只缺"不变量被固定下来"：无回归保护，未来改动可能悄悄破坏                                            |
| 3 操作落地任务记录         | 全部 agent 操作（索引/审查/原型）记录进既有 task 树         | `design.materialize` 已接入（`actions/design.ts:120-140`，**依赖会话绑定分支**）；`prototype.*` 两动作**完全没有任务树写入**；索引/审查后台任务只进 BuildConsolePanel                                                                                            | prototype 动作是 sessionless 的——design.ts 的接入模式不适用，需要 workspace 级落点；索引/审查未接入 |
| 4 侧栏分轨 + 滚动          | 原型/UI → design 面板；需求文档 → markdown 侧栏；全程可滚动 | prototype/design 两个面板已存在；需求文档（spec.md）目前打开在**右侧 companion**（`App.tsx:2322` StreamdownView），左侧没有 markdown 侧栏视图；12 个侧栏视图均声明了 `.ui-side-panel-body`（overflow-y:auto），但 Issue 记录"内容超出可视区无法滚动"未归档复现面 | 新增需求文档侧栏视图；滚动契约做一次全视图审计                                                      |

---

## §2 设计原则与总体架构

三条原则，分别对应 Issue 1/2、3、4：

1. **伴随不占用**——原型模块的一切交互载体都悬浮或侧挂于工作区之上，永不成为主对话的模态或独占层；主会话的消息流、输入框、历史记录零写入。
2. **记录只走一套**——所有操作记录进既有 TaskTreeService（`specs/archive/task-tree/`），TaskTreePanel / TaskRecordPanel 是唯一阅读面；不新增第二套记录存储。
3. **呈现分轨**——产物类型决定呈现轨道：`spec`（需求文档）→ 左侧 markdown 侧栏；`openui`/`design`（原型与 UI 稿）→ design 面板 + 右侧 companion / 弹窗预览。

### 组件拓扑（新增 ▲，既有 ○）

```
Hub rail ──▶ ○PrototypeDesignPanel（design 面板：列表 + 管理 + 发起）
                 │  "发起需求" / 列表项"迭代"
                 ▼
             ▲PrototypeDialog（工作区悬浮对话框：Issue 1 的操作载体）
                 │  actionRun("prototype.spec" / "prototype.materialize")
                 ▼
             ○ActionRun / ActionProgress 通道（sessionless，不变）
                 │
                 ├─▶ ○runSubagent(silent) ─▶ ○design-store（.deeporca/designs/）
                 │
                 └─▶ ▲TaskTreeService.appendStep（workspace 级落点，§5）
                          │
                          ▼
             ○TaskTreePanel / ○TaskRecordPanel（唯一记录阅读面）

○PrototypeDesignPanel 列表点击 spec.md ──▶ ▲DesignDocSidebar（markdown 侧栏，Issue 4）
                                        └▶ ○openui/dd 产物 ──▶ ○右侧 companion / ○PrototypeWindow 弹窗
```

---

## §3 Issue 1 — 悬浮对话框 `PrototypeDialog`

### 3.1 定位与边界

- **DOM 级浮层**（`position: absolute` 挂在主区容器内），**不是** BrowserWindow——与
  `PrototypeWindow`（a2ui 预览 popout，独立窗口）是两种东西：对话框承载*操作*，弹窗承载*预览*。
  两者可同时存在，互不依赖。
- 追随工作区：跟随当前 projectRoot；切换工作区时关闭并按 workspace 恢复（§8）。
- 永不模态：不遮罩主区、不拦截主对话输入框焦点；`pointer-events` 只作用于卡片自身。

### 3.2 布局规格

```
┌──────────────────────────────────────────┐
│ ⛶ 原型设计            [— 收起] [× 关闭]  │  ← 拖拽把手 = 标题栏
├──────────────────────────────────────────┤
│ ① 需求                                   │
│ ┌──────────────────────────────────────┐ │
│ │ textarea（一句话或详细需求）           │ │
│ └──────────────────────────────────────┘ │
│ [生成需求文档]  ● 正在细化需求… 42%      │
│ ② 原型                                   │
│ [选择需求文档 ▾]  [生成原型图]           │
├──────────────────────────────────────────┤
│ 最近：✅ 登录页原型 · 打开 ▾             │  ← 产物快捷跳转
└──────────────────────────────────────────┘
默认 360×~300px；可拖拽（标题栏）、可调宽（右下角，320–520px）；
收起态 = 右下角胶囊按钮（复用 HubOrb 的视觉语言），显示进行中进度。
位置/尺寸/收起态持久化：localStorage，key = `deeporca.protoDialog.<projectCode>`。
```

### 3.3 状态机

```
idle ──生成需求文档──▶ spec-running ──成功──▶ spec-done ──生成原型图──▶ proto-running ──成功──▶ done
  ▲                      │失败                                   │失败
  └──────────────────────┴───────────────────────────────────────┘（错误内联展示，输入保留）
```

- 状态与输入草稿持久化在 §3.2 的 localStorage key 里；running 态跨 App 重启**不恢复**
  （ActionProgress 是会话内的，重启即视为中断，恢复为 idle 并提示）。
- `spec-done` 时 ② 的文档选择器自动选中刚生成的 spec；产物列表数据源与
  `PrototypeDesignPanel` 相同（`designList` + `event:designChanged`），不另建缓存。
- 运行中禁用"关闭"为直接关闭：改为二次确认（"正在生成，中断后本次进度作废"）。
  ActionRun 通道不支持中途取消（现状），中断 = 忽略后续结果，与侧栏面板行为一致。

### 3.4 入口

| 入口                                      | 行为                                             |
| ----------------------------------------- | ------------------------------------------------ |
| `PrototypeDesignPanel` 头部"发起需求"按钮 | 打开对话框，聚焦 ① 输入框                        |
| 面板列表项"迭代"（原型产物）              | 打开对话框，② 预选该原型，① 预填其来源 spec 摘要 |
| 快捷键 `⌘⇧P`（注册进现有快捷键表）        | 切换对话框显隐                                   |

侧栏面板**保留**：它继续承担产物列表、删除、导出等管理职责（Issue 4 的 design 面板）；
对话框只承载"发起与跟进"这一段操作行为。两者共享 ActionProgress 订阅，同一动作
在两处显示同一进度。

---

## §4 Issue 2 — 主工作区隔离不变量

### 4.1 机制现状（设计即文档化）

`prototype.spec` / `prototype.materialize` / `design.materialize` 全部经由
`ctx.runSubagent({ silent: true })` 在 sessionless 后台通道执行
（`session-manager-tasks.ts` 的 `runBackgroundLlmTask`）：无会话、无 JSONL 追加、
不进入 compaction、不污染主会话 usage 统计。`PrototypeDialog` 与两个面板的**所有**
交互都收敛在 `actionRun` 上——renderer 侧没有任何向主会话 `send-message` 的路径。

### 4.2 固化措施（防回归）

1. **渲染侧契约**：`PrototypeDialog` 只允许 import `actionRun` / `onActionProgress` /
   `designList` / `designRead` 四类 api；评审时以此为准（在组件头注释声明）。
2. **回归测试**（desktop tests）：对 `PrototypeDialog` 的渲染树做 api-surface 断言——
   mock `window.deeporca`，渲染并触发全部按钮，断言除上述四类外无其他通道被调用，
   尤其断言无 `session:send` 类调用。
3. **主进程侧**：不为原型模块开任何写主会话的新特权通道（本期 IPC 零新增，见 §7）。

---

## §5 Issue 3 — 操作记录统一落地任务树

### 5.1 核心矛盾与决策

`design.ts:120-140` 的既有接入依赖 `ctx.activeSessionId()` + `getSessionTaskRef()`
（会话绑定分支）。原型动作是 **sessionless** 的——没有会话，也就没有绑定分支。

**决策**：sessionless 的 design/prototype 动作落到**工作区树的当前活动分支**
（`tree.branches[activeBranch]`）。理由：

- Issue 1 已经定义原型设计"追随工作区"——workspace 级的工作落在 workspace 树的活动
  分支，语义诚实；design.ts 注释里"活动分支可能被别的会话移动"的顾虑只对*会话绑定*
  写入成立，对"伴随工作区的操作"反而正是想要的落点。
- 不新建分支、不改 TaskTreeService 存储格式（原则 2：不新建第二套系统）。

### 5.2 接入矩阵（已按 2026-08-31 拍板修正）

| 操作                            | 现状                           | 本期动作                                                                                          | 落点                                                 |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `prototype.spec`                | 无记录                         | **零写入**（拍板 2026-09-01：appendStep 方案作废）                                                | design-store 即记录源 → task-tree-hub 聚合域自动呈现 |
| `prototype.materialize`         | 无记录                         | 同上                                                                                              | 同上                                                 |
| `design.materialize`            | 仅会话绑定时记录               | **保留**既有会话绑定路径；无绑定时补 workspace 级落点（与 prototype 一致）                        | 绑定分支，否则活动分支                               |
| 索引与知识（index & knowledge） | 独立工作区模块（索引库形态）   | **不落 workspace 树** —— 记录归属已定稿：task-tree-hub 聚合域（含构建历史落盘 `.deeporca/jobs/`） | [task-tree-hub §4](../task-tree-hub/design.md)       |
| 代码审查（review）              | 独立工作区模块（与索引库同构） | **不落 workspace 树** —— 产物（`.deeporca/reviews/`）即记录源，由 task-tree-hub 聚合呈现          | [task-tree-hub §4](../task-tree-hub/design.md)       |

**模块边界原则（2026-08-31 拍板）**：代码审查、索引与知识等模块**具备独立的工作区**，
行为逻辑与索引库同构——各自管理各自的产物与记录，不是 workspace 任务树的 step 来源。
把它们塞进 workspace 活动分支的 P2 原案**作废**；"模块独立任务 ↔ 综合任务模块"的
联动修正已定稿为[工作区任务树](../task-tree-hub/design.md)（聚合域方案，任务历史
模块的推翻重造一并落地）。

### 5.3 appendStep 契约

```ts
svc.appendStep(ref.treeId, {
  title: `原型需求文档：${requirement.slice(0, 60)}`, // 或 "原型图：<spec 标题>"
  why: "prototype.spec produced a requirements document (workspace-level).",
  artifactRefs: [artifactId], // design-store 的 artifact id
  // 透传进 node.meta（TaskNode.meta 已是自由字段）：
  //   { createdBy: "agent", source: "prototype-companion", action: "prototype.spec" }
});
```

- `artifactRefs` 让 `TaskRecordPanel` 能渲染"打开产物"链接（复用 §6.3 的分轨打开逻辑），
  `TaskNode.meta.source/action` 让记录面板能标注"来自原型伴随模块"。
- **失败不落树**：只有成功的产物生成才产生 step；失败留在对话框/面板的内联错误里。
  与 design.ts 的"best-effort"一致——树写入失败不回滚产物、不使动作失败。
- `TaskTreeService` 实例获取：`ctx.taskTrees?.()` 已在 `ActionContext` 上
  （`actions/types.ts:131`），无新增注入。

### 5.4 呈现

零新 UI 面。`TaskTreePanel`（工作区历史 rail）自然出现这些 step；
`TaskRecordPanel` 节点详情补两个小渲染点：`meta.source === "prototype-companion"`
的来源徽标、`artifactRefs` 的"打开"按钮（走 §6.3 分轨打开）。

---

## §6 Issue 4 — 侧栏分轨与滚动

### 6.1 视图映射（分轨规则）

| 内容（artifact pipeline）            | 侧栏呈现                                                                | 说明     |
| ------------------------------------ | ----------------------------------------------------------------------- | -------- |
| `openui` / `design`（原型图、UI 稿） | 既有 **prototype / design 面板**（管理）+ 右侧 companion / 弹窗（预览） | 保持现状 |
| `spec`（需求文档 markdown）          | **新增 `designdoc` 侧栏视图**：纯 markdown 渲染，无表单无操作按钮       | 本期新增 |
| 无 artifact 的模块级入口             | prototype / design 面板                                                 | 保持现状 |

### 6.2 `DesignDocSidebar`（新组件，~120 行）

- 数据：`designList()` 过滤 `pipeline === "spec"` + `designRead(id, "spec.md")`；
  文档大（>200KB）时提示"在编辑器中打开"兜底。
- 渲染：直接复用 `StreamdownView`（静态模式，streaming=false）——代码井/高亮/链接安全
  策略与主对话一致，零新渲染管线。
- 结构：`.ui-side-panel` > head（标题 + 关闭）> `.ui-side-panel-body`（滚动契约，见 6.4）
  > `ui-md` 作用域的 markdown。
- 顶部一个文档切换下拉（同一工作区的多份 spec 间切换），不引入文档树。

### 6.3 打开链路改动

- `PrototypeDesignPanel` 列表项点击：`pipeline === "spec"` → `selectView("designdoc")`
  并携带 artifactId（经 App 层 state，模式与 `onOpenArtifact` 一致）；
  `openui`/`design` → 维持现有右侧 companion 打开。
- `TaskRecordPanel` 的 artifactRefs "打开"按钮：同一分轨函数（抽 `openDesignArtifactByPipeline`
  工具函数，三个调用方共用：面板、任务记录、对话框最近产物）。
- 右侧 companion 仍可手动打开 spec（不拆除既有能力），只是**默认**分轨到左侧。

### 6.4 滚动契约与审计（**挂起** — 随任务树精致化联动修正）

> 2026-08-31 拍板：先放着不动。侧栏滚动不只是样式问题——它牵动"每个模块的独立任务"
> 与规划中的综合任务模块的联动修正（侧栏该挂什么、跟谁滚动、记录从哪来），归入任务树
> 精致化轮一起处理。以下契约作为 redesign 输入保留。

**不变量**：任何 Hub flyout 视图必须满足
`flex 列布局 + 每级 min-height: 0 + 内容滚动收敛在 .ui-side-panel-body`。
（`shell.css` 的 `.ui-hub-flyout/.ui-hub-body` 已 bounded；`vscode.css:36` 的 body 已
`overflow-y: auto`。）

Issue 记录的"无法滚动"未归档复现面，本期做一次**审计 + 修复**而非猜测性改 CSS：

1. 逐个打开 12 个视图灌入超长内容（脚本化：临时代码注入 200 条列表项），记录滚动
   是否生效，失效视图定位到具体样式冲突后修复（审计产物以注释形式留在本 spec 的
   落地记录里）。
2. `DesignDocSidebar` 与 `PrototypeDialog` 按同一契约实现并在测试里断言
   （DOM 断言 `overflow-y: auto` 且父链 `min-height: 0`）。

---

## §7 IPC 与数据契约

**零新增 IPC 通道。** 全部复用：

| 复用                                                  | 用途                           |
| ----------------------------------------------------- | ------------------------------ |
| `action:run` / `event:actionProgress`                 | 对话框与面板的执行通道（现有） |
| `design:list` / `design:read` / `event:designChanged` | 产物列表与读取（现有）         |
| `tasktree:list/get`                                   | 记录阅读面（现有）             |

数据侧唯一扩展：`TaskNode.meta` 新增约定字段 `source` / `action`（自由字段，无 schema
变更）；`DesignArtifactMeta.pipeline` 已有 `"spec"` 枚举，无需改动。

---

## §8 边界情况

| 场景                                      | 行为                                                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工作区切换                                | 对话框关闭；侧栏视图随 Hub 机制自然切到新 workspace 的数据（designList 按 projectRoot 天然隔离）；对话框位置/草稿按 workspace key 恢复                            |
| 同一动作双入口并发（对话框 + 面板同时点） | ActionProgress 按 actionId 广播，两处显示同一进度；按钮禁用条件用同一份 running 状态（App 层提升，或经 zustand store 共享——实现时按现有状态管理惯例定，倾向后者） |
| 运行中删除产物（列表两段式删除）          | 删除面板已有确认；若删除的是 ② 当前选中的 spec，对话框选择器回落到空并禁用 ②                                                                                      |
| App 重启                                  | running 态全部回落 idle（§3.3）；产物与任务树记录持久在磁盘，无损                                                                                                 |
| 任务树不存在 / TaskTreeService 为 null    | `ctx.taskTrees?.()` 返回 null，跳过落树（与 design.ts 一致的 fail-open），动作本身照常成功                                                                        |
| 主会话处于 Plan Mode                      | 原型动作不经主会话权限系统（sessionless），但 `write-in-cwd` 的 sideEffects 声明保持——ActionRun 通道自身的权限语义不变                                            |

---

## §9 分期实施与验收

### P0 — 悬浮对话框 + 隔离固化（Issue 1 + 2）

- `PrototypeDialog` 组件 + App 挂载 + 快捷键 + 三个入口
- §4.2 回归测试
- **验收**：主对话零打扰（消息流/输入框/历史无痕）；对话框拖拽/收起/持久化；同一进度双处显示

### P1 — 任务记录接入 + 侧栏分轨（Issue 3 原型域 + Issue 4）

- `prototype.spec` / `prototype.materialize` / `design.materialize`（无绑定时）落树
- `DesignDocSidebar` + 列表点击分轨 + `TaskRecordPanel` 来源徽标与产物链接
- **验收**：跑一轮两步原型流后，TaskTreePanel 出现两条 step，TaskRecordPanel 能从 step 打开产物；spec 默认进左侧 markdown 侧栏

### P2 — 滚动审计 + 后台 job 落树（**已由 task-tree-hub 承接，本期不实施**）

- §6.4 全视图滚动审计与修复 → 新任务树面按契约实现（task-tree-hub §6.5），其余视图随 redesign
- index & knowledge / code review 的记录化 → **已定稿**：task-tree-hub 聚合域，无需本文任何写入
- **验收**：见 [task-tree-hub §8](../task-tree-hub/design.md)

---

## §10 明确不做

- 不把 `PrototypeWindow`（预览弹窗）改成应用内浮层——弹窗承载预览的定位不变。
- 不给对话框加"在对话框里继续对话"的能力——它不是聊天窗口，迭代走 ①/② 重跑与
  右侧 companion 的既有 mini composer。
- 不新建任何记录存储、记录面板、渲染管线。
- 不在本期给 ActionRun 增加取消能力（中断 = 忽略结果，现状语义）。
- 不动三管线载体格式与 design-store 目录结构。
