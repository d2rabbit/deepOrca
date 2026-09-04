# 工作区任务树（Task Tree Hub）— 详细设计

> **日期**：2026-09-01
> **状态**：**主体已落地（2026-09-02 任务树 V2 提交：git graph + 常开轨迹 + git 绑定 + fork + 按需审查 + 全局 token 统计）；收尾与真机走查进行中**
> **审查归档（2026-09-03 用户拍板）**——移入 `specs/review-ing/` 待复核区；复核（收尾清单 + 真机走查）通过后转正式归档。
> **视觉稿**：[screen-task-tree.html](./screen-task-tree.html)（HTML 设计稿 V2.1，用户验收通过；自 `designs/task-tree-hub/` 随迁归档）
> **拍板来源**：用户拍板（2026-09-01）——现有任务历史模块（TaskTreePanel / TaskRecordPanel 以
> workspace 树维度挂侧栏）的形态**全部推翻**；任务树的本质重新定义为：**以同一个工作区（项目）
> 为根基的、该工作区所有任务的统一树**。本文即该重设计的设计稿，并关闭
> [prototype-companion](../../design-systems-advance/prototype-companion/design.md) §0.0 中挂起的「任务树精致化」议题。
> **前置**：[任务树](../../archive/task-tree/design.md)（TaskTreeService 已落地，本设计**复用不重写**）·
> [代码审查](../../archive/review-module/design.md)（review tab 交互范式）· 索引与知识（index-knowledge-rework）
> **受众**：desktop 维护者；实现者需要熟悉 review tab 的双栏结构、review-store / design-store /
> TaskTreeService 三套既有记录源。

---

## §0 拍板记录（2026-09-01）

| 项                                      | 结论                                                                                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 任务树的本质                            | **以工作区（项目）为根基的统一任务树**：该工作区的全部任务——会话主任务、主任务的 fork、索引库构建、代码审查、原型与 UI 设计等——**全部并入其中**，以树的方式展开                                        |
| 交互范式                                | 与索引知识库 / 代码审查模块**同构**：**左侧工作区列表，右侧是该工作区的任务历史工作区**（主区 tab）                                                                                                    |
| 现有任务历史模块                        | TaskTreePanel（rail `tasktree` 侧栏形态）+ TaskRecordPanel（独立单树时间线 tab）的**挂载形态与数据范围双双作废**；TaskTreeService（core 存储 + task.\* actions）**保留**，降级为「会话任务」域的数据源 |
| prototype-companion §5.2 的「原型落树」 | **原 appendStep 方案作废**——design-store 本身就是原型/UI 任务的记录源，聚合层自动呈现，无需再向 workspace 树写入 step（§4.3）                                                                          |
| prototype-companion §6.4 滚动审计       | 随本设计的新 UI 面一并按滚动契约实现（§6.5）                                                                                                                                                           |

---

## §1 范围一句话

给每个工作区一棵**完整的任务树**：会话、索引构建、代码审查、原型/UI 设计的所有任务
（历史的与进行中的）按域分组、按树展开，入口与索引库/代码审查一致——左侧选工作区，
右侧进该工作区的任务历史。

不在范围内：TaskTreeService 存储格式与 task.\* actions 的任何改动、review-store /
design-store 的目录结构、跨工作区的聚合视图、任务的操作类能力（fork/merge 等**仍在
会话域内部**，由 TaskTreeService 承载）。

---

## §2 现状与差距

| 模块                | 任务记录现状                                                                    | 记录在哪                       | 缺口                                                       |
| ------------------- | ------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| 会话任务（含 fork） | ✅ TaskTreeService 全量（tree.json + nodes + reflog + 归档）                    | `<root>/.deeporca/task-trees/` | 无存储缺口；缺**聚合呈现**（现在只挂侧栏，且无别的任务域） |
| 代码审查            | ✅ 每次 run 落盘（meta + findings + 产物 HTML）                                 | `<root>/.deeporca/reviews/`    | 无                                                         |
| 原型 / UI 设计      | ✅ 每个产物即一条记录（pipeline: spec / openui / design）                       | `<root>/.deeporca/designs/`    | 无                                                         |
| 索引与知识构建      | ❌ **只有进行时**：BuildJobManager 内存态 + BuildConsolePanel；**完成后零记录** | （无）                         | **补历史落盘**（§4.4）                                     |
| CRG 图谱构建        | ❌ 无独立记录（进度事件即逝）                                                   | （无）                         | 并入索引构建 job 落盘（同一 job 的一个 stage）             |

**核心差距**：不是缺记录，而是**记录分散在四套存储里、没有统一的工作区级阅读面**。
现有 TaskTreePanel 只看得到会话域，且挂载形态（侧栏 rail）与各模块的既有交互范式
（索引库/审查的「侧栏工作区列表 → 主区工作区」）不一致。

---

## §3 目标形态

```
┌─ 侧栏 rail「任务」──────────┐   ┌─ 主区 tab「任务树 · GVGL」────────────────────────────┐
│ 任务树                       │   │ [全部] [会话任务] [索引与知识] [代码审查] [原型设计]   │ ← 域 pills
│ ┌──────────────────────────┐ │   ├──────────────────┬─────────────────────────────────┤
│ │ ● GVGL      12 个任务    │ │   │ ▾ 会话任务 (4)   │   选中节点详情                  │
│ │   2m 前 · 审查完成 3 项  │ │ → │ │  ├ 🗀 主任务 A…  │   ┌───────────────────────────┐ │
│ │ ┌──────────────────────┐ │ │   │ │  │   ├ ⑂ fork-B  │   │ ✅ 代码审查 · HEAD         │ │
│ │ │ [打开任务树]         │ │ │   │ │  │   └ ⑂ fork-C  │   │ 范围：单个提交 · 14:32     │ │
│ │ └──────────────────────┘ │ │   │ │  └ 🗀 主任务 B   │   │ 5 项意见 · 2 个文件        │ │
│ └──────────────────────────┘ │   │ ▸ 索引与知识 (6) │   │ [打开报告] [引用到对话]    │ │
│ │ ○ deepcode-cli  3 个任务 │ │   │ ▸ 代码审查 (3)   │   └───────────────────────────┘ │
│ │   20h 前                 │ │   │ ▸ 原型设计 (2)   │                                 │
│ └──────────────────────────┘ │   │                  │                                 │
└──────────────────────────────┘   └──────────────────┴─────────────────────────────────┘
     左：工作区列表（索引库/审查同款行范式）      右：任务历史工作区（域分组树 + 节点详情）
```

- **左侧**（侧栏 rail `tasks`，替换现 rail `tasktree` 的位置语义）：工作区行列表——
  状态点（有任务）、名称、最近任务相对时间 + 摘要、任务数徽标、「打开任务树」按钮。
  行组件与 CodeReviewPanel 的 `ui-ik-row` 范式一致。
- **右侧**（主区 `taskhub` tab，per-root 多 tab 并存，review tab 同款机制）：
  顶部域 pills 过滤（全部/各域），主体左窄树区（域分组可折叠 → 任务节点 → 子任务）+
  右详情卡（选中节点：状态、起止时间、范围/来源、产物按钮、域徽标）。
- 追随工作区：tab 以 root 为 key（`key={root}` 重挂载，review tab 的既定教训），
  切换工作区时列表与树随之刷新。

---

## §4 数据模型与聚合

### 4.1 统一任务节点（renderer 侧归一化形态）

```ts
type TaskDomain = "session" | "index" | "review" | "prototype";

interface UnifiedTaskNode {
  /** 域内唯一 id；全局 id = `${domain}:${id}`（树渲染 key）。 */
  id: string;
  domain: TaskDomain;
  title: string;
  status: "running" | "done" | "warning" | "error" | "archived";
  startedAt: string; // ISO
  endedAt?: string;
  /** 树关系：父节点 id（域内）；顶层任务父为 null（域分组即父）。 */
  parentId: string | null;
  /** 源定位——详情/跳转按钮按它分发（§6.3）。 */
  source:
    | { kind: "session-tree"; treeId: string; nodeIds: string[] } // 会话域：整棵 TaskTree 压缩为一个节点组
    | { kind: "review-report"; reportId: string }
    | { kind: "design-artifact"; artifactId: string }
    | { kind: "index-job"; jobId: string };
  /** 产物跳转（打开报告 / 打开原型 / 打开会话 …），详情卡渲染。 */
  actions: Array<{ labelKey: string; kind: "open-review" | "open-design" | "open-session" | "open-console" }>;
  meta?: Record<string, unknown>; // 域特定（审查的意见数、原型的 pipeline、构建的 stages…）
}
```

**树的层级语义**（三层，简单且诚实）：

```
工作区（虚根，不渲染为节点）
└─ 域分组（会话任务 / 索引与知识 / 代码审查 / 原型设计 —— 可折叠分组头，非任务节点）
   └─ 顶层任务（一次审查 run、一个构建 job、一份原型产物、一棵会话树）
      └─ 子任务（仅会话域有：主任务下的 fork/branch 子树；其余域无子层）
```

- **不跨域挂接**：审查即便由某会话发起也不挂到会话节点下——域分组就是父层；
  触发溯源放 `meta.trigger`（如 `triggerSessionId`）在详情卡展示，不进树结构。
  理由：跨域父子会让"域 pills 过滤"与折叠语义变复杂，收益只是溯源展示——溯源用
  meta 足够。

### 4.2 聚合器（main 侧，`task-hub.ts`）

- `buildTaskHub(root): WorkspaceTaskHub` —— 纯读四套既有存储，归一化为
  `UnifiedTaskNode[]`，按域分组、组内按 `startedAt` 倒序。**零新存储、零迁移**，
  各源原地读（与 generated-paths 的「主进程 adopt、读端直读」惯例一致）。
- 会话域：读 TaskTreeService 的树列表（`tasktree:list` 已有的读取路径复用），
  **每棵树 = 一个顶层节点**（title = 根 prompt 摘要，status = 树内活跃分支状态，
  子节点 = 分支头节点）；归档树 → `status: "archived"` 进归档折叠组。
- 审查域：`listReviewReports(root)`（已存在）直映。
- 原型域：`designList(root)`（已存在）直映；`pipeline` 映射进 `meta`。
- 索引域：`listIndexJobs(root)`（**新增读取**，§4.4 的落盘）。

### 4.3 prototype-companion §5.2 的消解

原「prototype 动作 appendStep 落 workspace 树活动分支」方案**作废**：design-store
的每个 artifact 本身就是一条任务记录，聚合后自然出现在原型设计域——不需要第二套
写入。`meta.source === "prototype-companion"` 的来源徽标诉求由 `DesignArtifactMeta`
的既有字段（pipeline）覆盖，无需 TaskNode.meta。

### 4.4 索引构建历史落盘（唯一的新存储，最小面）

- 位置：`<root>/.deeporca/jobs/<jobId>.json`（复用 review-store 的「cap + prune」
  范式，KEEP = 20）。
- 时机：BuildJobManager 的 job **settle 时**（done/error）写一次（stage 明细 + 起止
  时间 + 触发来源 `trigger: "panel" | "chat" | "action"`）；进行中不写。
- jobId 形状同 review-store 的 `isSafeReportId` 校验范式（防穿越）。
- CRG 图谱构建若是索引 job 的一个 stage（现状是独立动作），落为独立 job 记录，
  `meta.kind: "crg"`，域仍归「索引与知识」。

---

## §5 IPC 契约

**新增一个通道**，其余全复用：

| 通道                                                                                              | 方向 | 用途                                                                        |
| ------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------- |
| `taskhub:list` (root) → `WorkspaceTaskHub`                                                        | 新增 | 一次性拉取该工作区的聚合树（数据量 = 各源 meta JSON，KB 级）                |
| `tasktree:list/get`                                                                               | 复用 | 会话域详情（TaskRecordPanel 内嵌时按需读单树）                              |
| `review:listReports` / `design:list`                                                              | 复用 | 详情卡的产物读取（跳转前的元信息已在聚合里）                                |
| `event:actionProgress` / `event:designChanged` / `event:crgProgress` / `event:projectRootChanged` | 复用 | 树的增量刷新信号：审查/构建 settle → 重拉；产物增删 → 重拉；切工作区 → 重拉 |

`WorkspaceTaskHub` 载荷：`{ root, generatedAt, groups: Array<{ domain, nodes: UnifiedTaskNode[] }>, archivedNodes }`。

---

## §6 UI 设计

### 6.1 侧栏 `TaskHubPanel`（rail `tasks`，替换 `tasktree` rail 的位置）

- 结构：`.ui-side-panel` > head（标题 + 刷新）> body（滚动契约）> 工作区行列表。
- 行（`ui-ik-row` 范式）：状态点（有任务 = 主题色）、名称、meta 行（最近任务相对
  时间 + 最新任务类型摘要）、右侧任务数徽标 + 「打开任务树」按钮。
- 点击行/按钮 → `onOpenTaskHub(root)`（App 层打开 `taskhub` tab，机制同
  `reviewTabs`：per-root 数组、多 tab 并存、`key={root}`）。

### 6.2 主区 `TaskHubWorkspace`（新组件，review tab 同构）

- 顶部域 pills（复用 `ui-knowledge-subtab` 视觉语言；「全部」+ 每域 + 计数）。
- 主体左右分栏：
  - **左窄栏（树区）**：域分组头（可折叠，带计数）→ 任务节点行（状态图标 +
    标题 + 相对时间；会话域节点可再展开 fork 子层，缩进 + 分支色条沿用
    TaskRecordPanel 的视觉语言）。点击节点 → 右侧详情。
  - **右栏（详情卡）**：选中节点的完整信息——域徽标、状态、起止时间、范围/来源
    （审查的范围 label、构建的 stage 明细、原型的 pipeline）、产物按钮区（§6.3）、
    触发溯源（`meta.triggerSessionId` 有则显示）。
- 空态：无任何任务 → 「该工作区暂无任务记录」（`review.noReports` 范式）；
  单域无任务 → pills 计数 0、分组头折叠置灰。
- 归档会话树：树区底部「已归档」折叠组（置灰可展开），沿用现有归档语义。

### 6.3 产物跳转（详情卡按钮 → 各模块既有面）

| 节点域     | 按钮       | 跳转                                                                                                                     |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| 代码审查   | 打开报告   | 复用 `reviewTabs` 机制带 `reportId` 打开 review tab 并定位该报告（既有 `initialReportId` 通路）                          |
| 代码审查   | 引用到对话 | 复用已落地的 `handleQuoteReviewToChat`（@-mention JSON）                                                                 |
| 原型设计   | 打开产物   | 分轨规则（prototype-companion §6.3）：spec → designdoc 侧栏（若已实施）/ openui·design → 右侧 companion                  |
| 会话任务   | 打开会话   | 切到该工作区并 resume 对应 session（`taskRef`/sessionId 已有通路）；单树内 fork 节点 → 内嵌 TaskRecordPanel 的时间线视图 |
| 索引与知识 | 打开索引   | 切到 knowledge tab（进行中 job → BuildConsolePanel 状态可见）                                                            |

### 6.4 与现有组件的关系

| 组件                             | 处置                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskTreeService`（core）        | **原样保留**：仍是会话/fork 的记录与操作系统；task.\* actions 不动；在本设计里降级为「会话任务」域的数据源                                                        |
| `TaskTreePanel`（rail 侧栏面板） | **退役**：rail `tasktree` 移除，位置语义由 rail `tasks`（TaskHubPanel）接管；其「列表 + 建树表单」能力由会话域自然承担（树由会话/agent 创建，不需要手工建树入口） |
| `TaskRecordPanel`（单树时间线）  | **保留为内嵌组件**：TaskHub 详情卡在会话域节点上内嵌它渲染单树时间线/泳道（现有 517 行组件不改结构，仅入口变化）                                                  |
| Sidebar 会话行任务徽标           | 保留：点击行为改为打开 taskhub tab 并定位该树（替代原 tasktree tab 直开）                                                                                         |

### 6.5 滚动契约

侧栏面板与主区 tab 全部按既定不变量实现：`flex 列布局 + 每级 min-height: 0 +
内容滚动收敛在唯一滚动层`（侧栏 = `.ui-side-panel-body`；主区 = 树区与详情卡各自
`overflow-y: auto`）。实现时以 DOM 断言测试固定（父链 `min-height: 0` +
滚动层 `overflow-y: auto`），关闭 prototype-companion §6.4 的挂起项。

---

## §7 边界情况

| 场景                          | 行为                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| 工作区无任何任务              | 侧栏行照常显示（计数 0）；右侧空态文案                                                     |
| 某域存储读取失败（如树损坏）  | 聚合器 fail-open：该域节点缺失 + `meta.error` 标注，其余域照常（TaskTreeService 同款纪律） |
| 大工作区（几十棵树/几百产物） | 一次性拉取 meta 级 JSON（KB 级）无压力；树区虚拟化留待 P2 按需                             |
| 审查/构建进行中               | `status: "running"` 节点实时态来自既有进度事件（触发重拉）；不新做进行时通道               |
| 多个 taskhub tab 并存         | per-root 多 tab（review tab 同款），互不共享滚动/选中态                                    |
| App 重启                      | 全部落盘数据原地恢复；running 态节点回落为上次终态（与 review-run-state 同哲学）           |

---

## §8 分期实施与验收

### P0 — 聚合 + 双栏只读树

- main：`task-hub.ts` 聚合器 + `taskhub:list` IPC + 索引 job 落盘（§4.4）
- renderer：`TaskHubPanel`（侧栏）+ `TaskHubWorkspace`（主区 tab）+ rail 切换 +
  TaskTreePanel 退役
- **验收**：左侧选工作区，右侧看到该工作区四域任务分组的树；审查/构建 settle 后
  树自动刷新；最大化窗口滚动行为符合契约

### P1 — 详情卡 + 产物跳转

- 详情卡全量字段 + §6.3 跳转矩阵 + 内嵌 TaskRecordPanel（会话域）
- prototype-companion §5.1 的 sessionless 落点按 §4.3 关闭（不再落树）
- **验收**：从任务树可达审查报告/原型产物/会话时间线，全程不离开任务树上下文

### P2 — 体验增强（按需）

- 树区虚拟化、按状态/时间筛选、`meta.trigger` 溯源可视化、archived 组搜索

---

## §9 明确不做

- 不重写 TaskTreeService 存储、不迁移任何历史数据（四套源原地读）。
- 不做跨工作区聚合视图（任务树永远以单一工作区为根）。
- 不把 fork/merge 等操作能力搬进任务树 UI——操作仍在会话域内由既有 task.\* 承载，
  任务树是**阅读面**，不是第二操作台。
- 不为「任务树」新建独立窗口/弹窗。
- 不新增第二套进度通道——进行中状态全部复用既有事件。

---

## §10 与 prototype-companion 设计的回写

本文定稿后，[prototype-companion/design.md](../../design-systems-advance/prototype-companion/design.md) 做以下
同步（已随本稿一并更新）：

1. §0.0 表格：`任务树精致化` 行由「挂起」改为「已拍板 → 见 task-tree-hub」。
2. §5.2 矩阵：`索引与知识` / `代码审查` 两行的「redesign 待定」落点改为
   「task-tree-hub 聚合域」；`prototype.spec` / `prototype.materialize` 行的落点
   由「workspace 树活动分支」改为「design-store 即记录源（task-tree-hub §4.3）」，
   appendStep 方案作废。
3. §9 P2 描述更新为指向本设计的 P0/P1。
