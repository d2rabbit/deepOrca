# Agent 任务树（Task Tree）— 详细设计

> 日期：2026-08-14 · 状态：P0 已实现（2026-08-15，见文末"P0 落地记录"）；P1+ 设计中
>
> 灵感来源：git 对象模型（commit / branch / fork / merge / reflog）× DeepOrca L0–L3 记忆管道的"记忆驱动分支"
> 关联路线：feature-roadmap §十 引擎演进（Subagent）、§二 知识中心（记忆）、§十六 能力编排（defineAction）、PM-Design V2 工作台（`specs/pm-design-v2/design.md`）、会话持久化（`docs/session-persistence.md`）
> 前序调研：`docs/research/2026-08-14-openui-deep-dive.md`（PM-Design 工作台是任务树的第一消费方）
>
> 设计约束：
>
> 1. **core 无 UI 铁律**——树模型、存储、记忆触发判定落 core；树图、分支切换器、fork 提案 UI 落 desktop renderer。对齐近期「MCP server / A2UI / GitMCP 全部迁出 core、controller-seam 注入」的架构方向。
> 2. **不重写会话系统**——任务树是会话**之上**的编排层。Session 是叶子的"执行载体"：一个 task 节点可绑定一个 session，也可纯规划不绑定。`SessionManager` 零破坏，仅 session entry 扩展一个反向指针字段。
> 3. **fork 继承摘要而非全量**——分支不复制祖先消息流（会爆炸），复制"上下文摘要 + artifactRefs + memoryRefs"。摘要复用现有 compaction 机制。
> 4. **merge 是 cherry-pick，不是三方合并**——任务产出物是文件/原型/决策，不是行文本；不做 git 式内容合并，做 artifact 级挑选 + 人在回路确认。
> 5. **记忆驱动分支只提议、不自动执行**——人在回路。相似度再高也只产生"fork 提案"，用户批准才建分支。
> 6. **fail-open**——树服务任何异常不阻塞普通会话；树损坏时降级为线性会话。
> 7. **树操作是一等 Action**——`task.fork` / `task.switch` / `task.merge` / `task.list` 走 defineAction（§十六），LLM 工具 + IPC + UI 三表面同源。

---

## 一、问题与动机

当前会话模型是**线性流 + 全局记忆**，缺三种结构性能力：

| 缺失         | 现状的痛                                                    | 任务树给的解                                                  |
| ------------ | ----------------------------------------------------------- | ------------------------------------------------------------- |
| 探索性并行   | agent 试错只能 `/undo` 或重开会话；PM 的 A/B 方案对比无载体 | fork：任意节点分叉，平行推进                                  |
| 可回溯分支   | 放弃的尝试直接丢失，无法"回到当时那个岔路口"                | branch + reflog：岔路口永远在                                 |
| 记忆主动参与 | 记忆只被动召回；历史任务的"另一种选择"从未被结构化利用      | 记忆驱动 fork：相似历史的不同选择，主动提议成带记忆的平行分支 |

git 的对象模型是"可回溯并行工作"最成熟的抽象，直接借鉴其语义但**替换内容模型**（commit 存的是任务上下文而非文件快照）。同时该结构是 §十 未来 Subagent 的天然调度底座：**一个 subagent = 一个 branch 的执行者**。

---

## 二、核心模型（git 语义映射）

| git          | Task Tree        | 说明                                                  |
| ------------ | ---------------- | ----------------------------------------------------- |
| commit       | `TaskNode`       | 不可变节点：规划/步骤/分叉/合并事件                   |
| branch       | `TaskBranch`     | 命名指针 → head nodeId                                |
| HEAD         | `activeBranch`   | 当前执行上下文所在分支                                |
| working tree | 节点的进行中状态 | 绑定 session 的 messages / artifacts                  |
| fork         | `fork()`         | 从任意 node 建新 branch，可携带 memory snapshot       |
| merge        | `merge()`        | cherry-pick 式：挑选源分支 artifacts/决策摘要挂到目标 |
| reflog       | `reflog.jsonl`   | fork/switch/merge/abandon 操作流水                    |
| clone        | （不引入）       | 树随项目走，无跨项目 clone 语义                       |

### 2.1 TaskNode

```ts
interface TaskNode {
  id: string; // 内容寻址短 hash（parentId+payload 摘要）
  treeId: string;
  parentId: string | null; // root 为 null
  kind: "root" | "step" | "fork" | "merge" | "memory-spawn";
  title: string;
  prompt?: string; // 该节点的任务描述
  contextSummary?: string; // fork 继承的祖先上下文摘要（compaction 产物）
  sessionRef?: string; // 绑定的 session id（执行载体，可选）
  artifactRefs: string[]; // 产出物：designs/、文件快照、原型 surface
  memoryRefs: string[]; // 注入/产出的记忆单元 id
  status: "planned" | "running" | "done" | "abandoned";
  meta: {
    createdBy: "user" | "agent" | "memory";
    memorySeed?: { unitIds: string[]; similarity: number; sourceTaskId: string };
    at: number;
  };
}
```

`kind: "memory-spawn"` 是本设计的签名节点——标记"这条分支诞生于一段记忆的提议"。

### 2.2 TaskBranch / Tree

```ts
interface TaskBranch {
  name: string;
  headId: string;
  createdAt: number;
  abandoned?: boolean;
}
interface TaskTree {
  id: string;
  rootId: string;
  branches: Record<string, TaskBranch>;
  activeBranch: string;
  nodes: Record<string, TaskNode>; // 存储上分片为 nodes/<id>.json
}
```

---

## 三、Fork 语义

### 3.1 显式 fork

- 用户/agent 在任意 node 上 `fork(name?, memorySnapshot?)` → 新 branch，head 指向新 fork 节点
- **继承物**（轻量）：`contextSummary`（祖先链 compaction 摘要）+ `artifactRefs`（引用不复制）+ `memoryRefs`
- **不继承**：消息流、工具调用历史——避免存储与上下文窗口双爆炸
- fork 后 `switch` 到新分支，后续 `appendStep` 落在新 head

### 3.2 记忆驱动 fork（创新核心）

触发 → 召回 → 分歧检测 → 提议 → 播种 → 回收，六步闭环：

1. **决策点埋点**（core）：Plan Mode 提案批准前、`AskUserQuestion` 前、agent 自报"方案分岔"时，产生 `DecisionPoint` 事件
2. **召回**：用当前任务摘要查 L2（情景记忆：历史 session 摘要）/ L3（语义向量）→ top-k 历史任务，带它们**当时的选择与结果**
3. **分歧检测**：历史任务的 choice 摘要与当前倾向不同（结构化字段对比优先，LLM 判断兜底）
4. **提议**：AskUserQuestion 呈现——"相似历史任务 X 当时选了 B，结果是……；要 fork 一条带该记忆的分支试试吗？"（**只提议，不自动 fork**）
5. **播种**：用户批准 → `fork(memorySnapshot: unitIds)` → `memory-spawn` 节点，新分支的 system context 注入该记忆单元（走现有 skill/memory 注入通道）
6. **回收**：分支完成时写回 L2，带 **fork 谱系标记**（sourceTaskId + 选择 + 结果）——记忆系统从此学会"分岔的代价与收益"，下次召回更准

这条闭环让记忆从"被动回忆"升级为"主动提供平行宇宙"。

---

## 四、Merge 语义（cherry-pick 式）

- `merge(srcBranch, picks: NodeId[])`：从源分支挑选节点，生成 `merge` 节点挂到目标 head
- 合并内容 = 被挑节点的 `artifactRefs`（引用转移）+ 决策摘要文本
- **冲突策略**：artifact 级 last-write-wins + 人工确认清单（UI 列出同名/同路径 artifact 的双版本供选择）；不做文本级三方合并
- merge 节点记录 `picks` 与来源 branch，可完整回溯
- `abandon(branch)`：标记 abandoned，节点归档不删除（reflog 可查），UI 灰显

---

## 五、存储与持久化

```
.deeporca/task-trees/<treeId>/
├── tree.json          # branches + activeBranch + reflog 摘要（轻量索引）
├── nodes/<nodeId>.json
└── reflog.jsonl       # 操作流水（append-only）
```

- 沿用 sessions-index 的教训（**读优先 pending、写 debounce + 终端操作 flush**）：树服务单写者，`tree.json` 走同一模式；reflog 纯 append 无并发问题
- **session 反向指针**：session entry 增加可选 `taskRef: { treeId, nodeId }`——sessions-index 结构不破坏，仅扩展；`/resume` 语义 P1 起可扩展为 branch 级
- **artifact 快照**（可选，P2）：node 的 artifactRefs 快照复用 file-history 的轻量 git 机制，实现"branch 切换 = 文件快照切换"的完整 git 体验；P0/P1 只切上下文不切文件

---

## 六、Core API（UI-free）与 Action 表面

```ts
// packages/core/src/tasks/（新增）
interface TaskTreeService {
  createTree(rootPrompt: string): string;
  appendStep(treeId: string, node: Partial<TaskNode>): string;
  fork(treeId: string, nodeId: string, opts?: { name?: string; memorySnapshot?: string[] }): string;
  switchBranch(treeId: string, branch: string): void;
  merge(treeId: string, srcBranch: string, picks: string[]): string;
  abandon(treeId: string, branch: string): void;
  recallAtDecision(treeId: string, nodeId: string): MemoryForkCandidate[]; // 记忆驱动 fork 候选
  on(event: "forked" | "merged" | "switched" | "decision-point", cb): void;
}
```

- desktop 经 controller-seam 注入适配器（IPC + 面板），对齐 A2UI/GitMCP 迁出 core 的既定方向
- defineAction 注册：`task.fork` / `task.switch` / `task.merge` / `task.list` / `task.abandon`——agent 在会话里可直接 fork 自己（"这个方案我先开条分支试"）

---

## 七、UI（desktop renderer）

- 新 SidebarView `"tasks"` rail（PM-Design V2 诊断里"设计是唯一无工作区的模块"，任务树同理需要自己的家）：
  - 树列表：缩进节点 + 分支色条（简化 git graph，不做完整 DAG 画布，P0）
  - branch 切换器（类 git checkout 下拉）
  - 节点操作：fork / merge / abandon；记忆种子节点带 ✦ 徽章 + 相似度 tooltip
- **与 PM-Design 工作台整合**：一次 `design.materialize` = 一个 branch 的产出；A/B 方案对比 = 两个 branch 的 artifact 并排预览——任务树让 PM-Design 的"需求变更"从"重跑管线"变成"fork 一条分支"
- 独立窗口：复用 `?view=prototype` 通道（P2）

---

## 八、与现有能力的关系

| 能力            | 关系                                                                                |
| --------------- | ----------------------------------------------------------------------------------- |
| Plan Mode       | plan 步骤可物化为 step 节点（`UpdatePlan` ↔ `appendStep` 双向映射，P1）             |
| Subagent（§十） | subagent = branch + 独立执行 session；任务树是 subagent 调度的数据结构前置          |
| PM-Design V2    | 第一消费方；需求变更 fork 而非重跑                                                  |
| 会话持久化      | session entry 扩展 `taskRef`；`/resume` 扩展 branch 级（P1）                        |
| 记忆管道        | L2 增加 fork 谱系字段；recall API 增加谱系过滤；决策点埋点消费 `DecisionPoint` 事件 |
| compaction      | fork 的 `contextSummary` 直接复用压缩器                                             |

---

## 九、阶段规划

| 阶段 | 内容                                                                                                                   | 验收                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| P0   | core TaskTreeService（create/append/fork/switch/abandon + 存储 + reflog）；defineAction 暴露；最小面板（列表式，无图） | agent 会话内可 `task.fork`；面板可见双分支；重启后树恢复 |
| P1   | merge + 冲突确认清单；session 绑定（`taskRef`）；Plan Mode 步骤物化；`/resume` branch 级                               | A/B 分支产出可 merge 回主线；plan 与树同步               |
| P2   | 记忆驱动 fork 全闭环（埋点→召回→分歧→提议→播种→回收）；树图 UI；PM-Design 整合；artifact 快照切换                      | 相似历史任务触发 fork 提案；批准后分支带记忆运行         |
| P3   | subagent 执行模型对接（branch = subagent 载体）                                                                        | 并行 subagent 各占一 branch，结果 merge 回主线           |

---

## 十、风险与开放问题

| 风险                        | 缓解                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------- |
| 分支爆炸                    | abandon 归档 + 树剪枝策略（abandoned > N 天折叠）；UI 默认只显示 active + 最近 5 分支 |
| fork 摘要质量差导致分支漂移 | 摘要可手动补充（节点编辑）；P2 评估"摘要 + 关键消息指针"混合继承                      |
| 树与 session 双写一致性     | 单写者（树服务）+ session 侧只存反向指针只读                                          |
| 记忆相似度误触发            | 只提议不自动 fork；相似度阈值可配；谱系回收让阈值自学习                               |
| 存储膨胀                    | nodes 分片 + artifact 引用不复制 + abandoned 归档压缩                                 |

**开放问题**：

1. merge 冲突 UI 的最终形态（并排 vs 清单）——P1 实现前出交互稿
2. branch 切换是否切工作区文件——P0/P1 不切（只切上下文），P2 用 file-history 快照评估完整体验
3. 一棵树 vs 每需求一棵树——PM-Design 默认"每需求一棵树"，自由会话默认"每会话一棵树"，可配置

---

## 十一、P0 落地记录（2026-08-15）

P0 已落地：`packages/core/src/tasks/`（types + TaskTreeService，单写者 + pendingIndex→flush 纪律 + reflog append-only + fail-open）+ 6 个 Action（task.create/step/fork/switch/abandon/list，经 RegistryHost 注入服务）+ desktop 只读面板（`TaskTreePanel.tsx`，rail "tasktree"🌳，6 语言）。每个节点携带 **`why` 叙事字段**（fork 强制非空）——人类视角的产品本体。测试 6 用例（fork 双分支/重启恢复/reflog 顺序/损坏树 fail-open/id 形状与防穿越/分支名净化）。

### P1 落地记录（2026-08-15，同日完成）

merge（cherry-pick + 冲突报告不自动裁决）、session 绑定（taskRef 反向指针 + 分支头 sessionRef 单次绑定）、branch 级 resume、Plan Mode 单向物化（标题去重 + 幂等）均已实现并测试（task-tree.test.ts 11 用例）。行为记忆 boot 注入（`settings.behaviorContext`，默认关）同批落地。memory 谱系 L2 增量规格见 `memory-lineage.md`（实现列 P2）。

### P2 落地记录（2026-08-15）

记忆驱动 fork 以**最小可用环**落地（六步全通，但召回用任务树自身持久 + token-Jaccard 而非 L2 谱系字段——谱系回收走"隐藏 <task-lineage> 消息 + 现有记忆 capture"通道，memory 包零改动；memory-lineage.md 的 L2 字段降级为可选增强）。树图 UI 升级为泳道画布（每分支一列、冲突清单 ⚠ 渲染）。PM-Design 整合：materialize 产出 → 绑定分支 step。快照切换已于 2026-08-18 收尾批落地：tree 级 file-history 仓库（`<treeDir>/file-history`，分支名派生 ref）——appendStep/merge 自动 checkpoint 可解析产物文件并 stamp `meta.snapshot`，面板 ⏪ 显式恢复，switchBranch 出向安全 checkpoint + 入向最近快照恢复（全 fail-open）。真机验收通过：rail 挂载、task.create/step/fork/recall 经真实 IPC 全链路、磁盘持久化与 reflog 流水核验。

### P1 收尾：session 绑定可见化 + 整树归档联动（2026-08-18，冻结前完善）

P1 落地的 session 绑定（taskRef/sessionRef）此前已持久化但 UI 零消费，本批补齐消费面并补"整树归档"语义（均为既有 spec 承诺的收尾，非新能力）：

- **会话侧第二入口（交叉引用）**：Sidebar 会话行渲染任务徽标（数据源 `entry.taskRef`，已随 SerializableSessionEntry 到达 renderer）；点击在**工作区主区以新 tab** 打开对应树（`TaskTreePanel` 增加 `treeId` 单树模式——隐藏列表/建树表单，仅渲染分支 chips + 时间线 + reflog + 归档横幅），多 tab 可并存、可关闭；跨工作区徽标走既有切根流程（pendingTaskTabRef，pendingSelectRef 同款时序）。
- **整树归档（永不删除）**：`TaskTreeIndex` 增加 `sessionIds`（bindSession 台账累计，删除会话时 removeSessionBinding 清除 id；节点级 sessionRef 不可变保留）与 `archived/archivedAt`；reflog op 扩展 `archive|unarchive`。级联判定（用户拍板 2026-08-18）：**归档或真删除会话时，仅当其余绑定会话全部不活跃（在 archive sidecar 中）才归档树**；恢复会话不自动恢复树（面板手动 ⤺）；树文件/reflog 永不因会话清理而删除。归档树从任务面板主列表隐藏，进入底部"已归档"折叠区（置灰可查看、可恢复），旧格式 tree.json 读取时规范化补默认值。
- main 侧级联落点：SessionArchive（载荷扩展 workspaceRoot，支持跨工作区归档级联）与 SessionDelete（删前捕获 taskRef）handler；新增 `tasktree:archive/unarchive` IPC（带可选 workspaceRoot）。

### 消歧规则：Plan Mode ↔ 树是单向只读物化

UpdatePlan（LLM 拥有）→ appendStep（树服务拥有）为**单向物化**：plan 步骤可投影为 step 节点，但树**永不回写** plan——两者谁是 source of truth 无歧义（plan 是）。双向映射的提案一律拒绝，直到出现 plan 无法表达的树结构需求。

### 与受众定位的关系

本树是**给人类看的任务轨迹**；activity-frames 是**给 agent 看的行为记忆**——受众相反的两个产品，仅共享原始事实源（见 `docs/research/2026-08-15-trajectory-design-exploration.md`）。
