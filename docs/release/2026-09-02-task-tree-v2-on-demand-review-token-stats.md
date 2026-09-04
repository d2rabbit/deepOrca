# 任务树 V2 + 按需审查 + 全局 Token 统计 — 变更说明

> 提交：`c95aa729`（feat/modern-ui-redesign）· 日期：2026-09-01 → 2026-09-02
> 设计依据：[specs/review-ing/task-tree-hub/design.md](../../specs/review-ing/task-tree-hub/design.md)（已拍板定稿）·
> [specs/review-ing/task-tree-hub/screen-task-tree.html](../../specs/review-ing/task-tree-hub/screen-task-tree.html)（HTML 设计稿 V2.1，用户验收通过）
> 参考：deepseek-ai/deepseek-harness 的 Session Event Log（事件溯源轨迹模型）
> 验证：typecheck 零错误 · 测试 377/377 · eslint/prettier 干净

---

## 一、任务树（Task Hub）— 全新重做

### 背景

原任务历史模块（TaskTreePanel/TaskRecordPanel 以会话树维度挂侧栏）的存在方式被拍板推翻
（见 prototype-companion §0.0）。任务树的正确本质：**以工作区为根基的统一任务树**——该
工作区的所有任务（会话主任务、fork、索引构建、代码审查、原型/UI 设计）全部并入，以树
展开；交互与索引库/代码审查同构：左侧工作区列表，右侧任务历史工作区。

### 1.1 数据层（main，零迁移聚合四套既有记录）

| 文件 | 职责 |
| --- | --- |
| `main/tools/task-hub.ts` | 聚合器：读四套既有存储归一化为 `UnifiedTaskNode[]`，按域分组、组内时间倒序；每域 fail-open |
| `main/tools/jobs-store.ts` | **新增唯一存储**：索引/知识构建历史落盘 `<root>/.deeporca/jobs/<id>.json`（cap 20，复用 review-store 纪律）。此前构建完成后零记录 |
| `main/index.ts` | `taskhub:list`（聚合树 + file-history git hash 读取）、`taskhub:trace`（会话轨迹）、`tokens:summary`（token 聚合）三个 handler |

四个数据域（**全部原地读既有存储，零迁移**）：

| 域 | 数据源 | 状态 |
| --- | --- | --- |
| 会话任务 | TaskTreeService（tree.json + nodes + 归档态） | 既有 |
| 索引与知识 | `.deeporca/jobs/`（本轮新增落盘） | 新存储 |
| 代码审查 | `.deeporca/reviews/*.json` | 既有 |
| 原型 / PM / UI 设计 | design-store（`.deeporca/designs/`） | 既有 |

### 1.2 UI（renderer）

- **侧栏 `TaskHubPanel`**（rail `taskhub`，替换退役的 `tasktree`）：工作区行列表——状态点、
  名称、「N 个任务 · 最近活动」meta、任务数、打开按钮。
- **主区 `TaskHubWorkspace` V2**（per-root 多 tab，review tab 同款机制）：按已验收 HTML
  设计稿实现——
  - **Git Graph 主视图**：84px 专属轨道列（物理隔离，连线永不压内容）。
    主干 = 会话主任务（●实心圆，进行中带呼吸光环）；伴随任务 = 域色菱形 +
    **前置 tag**（REVIEW / INDEX / PM-DESIGN / UI-DESIGN / FIX…）；
    域 pills 过滤 = 非选中域淡化（图保持完整拓扑）。
  - **常开轨迹**（无收起态）：会话任务节点下方直接展开完整任务轨迹
    （DeepSeek-harness session event log 形态）——用户指令卡 → 按 Turn 分组的
    agent 行为流：`thinking` / 工具调用（bash/read/write/edit/WebSearch/
    AskUserQuestion/UpdatePlan…，含 ✓/✗ 与耗时）/ **skill**（🧩 meta.skill 识别）/
    **subagent**（🤖 嵌套块）/ **MCP**（`mcp__server__tool` → `MCP · server` 徽章）/
    `assistant` 回复。长会话保留最近 3 Turn + 省略提示。
  - **Git 绑定**：会话树存在 file-history checkpoint（git 记录）时，节点行显示
    `⎇ 短hash` 绑定徽章；无 git 记录不显示。
  - **详情卡**：选中节点的状态/时间/范围 + 域内操作按钮（§1.3）。
- **TaskTreePanel 退役删除**；TaskRecordPanel 保留为内嵌时间线组件（详情卡
  「打开时间线」入口）；TaskTreeService 与 task.* actions 原样保留（会话域数据源
  + 操作系统）。

### 1.3 会话任务的 fork / 切换分支

详情卡（会话域）新增：
- **⑂ fork 分支**：inline 表单（分支名可选 + why 必填——保持 TaskTreeService 的
  叙事契约），走既有 `task.fork` action，成功后树刷新并出现新分支；
- **切换分支**：`task.switch`；**打开时间线**：复用 TaskRecordPanel 的单树视图。

---

## 二、风险图谱修复（两条用户报告）

### 2.1 空间利用：堆积 + 大片空白

布局器从固定 1180px 画布改为**按面板实测尺寸摊开**（`layoutBoard(groups, {width, height})`）：
- RiskGraphView 用 ResizeObserver 实测面板宽高传入；
- 节点槽宽随面板宽弹性（100→150px），块内网格列数随可用宽度增加
  （19 节点组在宽面板 = 2 行宽排，而非 4 行窄列）；
- 面板高于内容时，剩余高度按比例摊入层带间距/块行间距/层内边距——
  三层带撑满面板，不再左上堆积 + 右下留白；
- SVG 1:1 渲染（viewBox = 布局尺寸，不再等比缩放产生 letterbox）。

### 2.2 报告 ↔ 图谱定位断裂（有 CRG 节点却不可点）

根因：**绑定集 = 图谱展示集 = top-60**。CRG enriched 的意见若其函数排名 61+，
绑定节点集里没有 → 意见 chip 不可点。三层修复：
1. 绑定集加深：`BINDING_LIMIT = 200`（core 上限），与展示的 60 分离
   （overview 缓存键加 limit 防串）；
2. core 新查询：`getRiskNodesByNames`（按 qn 取完整节点：路径/行区间/社区/风险）、
   `getEdgesForNodes`（节点集内 CALLS 边）；
3. 按需补节点：`reviewRiskGraph(root, focusQns)`——点击「定位」时目标不在展示集
   则自动带 qn 重拉数据，图谱把该节点补进对应分层再跳转。

---

## 三、按需审查（审查与活动区彻底解耦）

用户报告「deepcode-cli 无法审查」且明确审查是**按需**的，不该切根。调研确认
review.full 的 ctx 依赖只有 `ctx.projectRoot` + emit（语义审查走外部 OCR CLI 控制器、
结构 enrich 走 CRG 控制器，不碰 SessionManager），因此：

- **core**：`ReviewFullInput.root`（绝对路径，缺省回落 registry 根）；内部 23 处
  root 引用与 per-root 串行队列键全部改用目标 root。**刻意不暴露给 LLM 参数
  schema**（additionalProperties:false 拦截）——root 只走受信桌面 IPC 面。
- **main**：`git.listBranches` / `gitLog` 支持显式 root（gitService 本就是按 cwd 执行）。
- **UI**：范围选择并入工作区行（每行自己的记忆范围 + refs 下拉按行拉取各自
  工作区的分支/提交），「一键代码审查」文本按钮换为 **SVG icon 按钮**（运行中显示
  百分比/spinner）。任意行可直接审查，活动区无关。
- **进度隔离修复**：`ActionProgressEvent` 增加 `root` 戳（action-ipc 注入
  `getRoot()`）；面板运行态改 per-root Map；**常驻订阅 + terminal `data.done`
  事件复位**——修复两个真实 bug：审查完成后进度条残留（重挂载后无人复位
  running 态）、跨工作区进度串写。

---

## 四、会话内 wiki / 审查报告引用渲染

引用桥（知识库「引用到对话」/ 审查「引用到对话」）往草稿插入 `@…/.deeporca/…`
绝对路径，此前在消息流里渲染为裸路径文本。现于 UserBubble 识别两类规范引用，
渲染为**引用卡 chip**：📖 Wiki（页面名，蓝）/ 🛡 审查报告（日期时间，绿），
两行结构（类型 + 标题）、悬停显示完整路径，其余文本照常 pre-wrap。

---

## 五、多会话并发：per-session 工作区（第一步：存储隔离）

用户诉求：一个工作区要能**并发多个会话**，每个会话有独立的会话工作区，放在
`.deeporca/` 下。本轮落地存储地基：

- `SessionEntry.workspaceDir?: string`（root 相对路径 `.deeporca/sessions/<id>/`，
  可迁移）；
- `createSession` 时递归创建目录（fail-open），每个会话（并发或恢复）都拥有
  隔离的会话级产物目录。

**运行时并发**（多个会话同时流式执行）需要 bridge 层从单活动会话改为多路复用
（MCP/embedding 等进程级单例的生命周期拆分），作为后续独立任务，不在本提交。

---

## 六、展示层改名（仅 i18n，6 语言，底层 id/目录不动）

| 旧 | 新 |
| --- | --- |
| 索引库 / Index Library | 知识库 / Knowledge Base |
| 索引与知识 / Index & Knowledge | 知识库 / Knowledge Base |
| 索引关系图 / Index Graph | 符号关系图 / Symbol Graph |

---

## 七、新增/变更文件速览

**新增**：`main/tools/task-hub.ts`（聚合器）· `main/tools/jobs-store.ts`（构建历史）·
`main/tools/session-trace.ts`（轨迹归一化）· `main/tools/tokens-summary.ts`（token 聚合）·
`renderer/components/TaskHubPanel.tsx` · `renderer/components/TaskHubWorkspace.tsx`（V2）·
`renderer/components/task-hub-format.ts` · `renderer/lib/risk-board.ts`（弹性布局）·
`renderer/ui-css/task-hub.css` · `renderer/ui-css/risk-board.css` ·
`renderer/lib/generated-paths.ts` 的 `reviewStorePath` · specs/task-tree-hub/design.md ·
specs/review-ing/task-tree-hub/screen-task-tree.html · 测试 ×5
（task-hub / jobs-store / session-trace / tokens-summary / generated-paths）。

**删除**：`renderer/components/TaskTreePanel.tsx`（rail 形态退役）。

**关键修改**：`shared/ipc.ts`（RiskGraphData / TaskHub* / TaskTrace* /
WorkspaceTokenSummary 类型 + root 戳 + per-root git refs）、`main/action-ipc.ts`
（事件带 root + getRoot 注入）、`main/build-job-manager.ts`（settle 落盘）、
`main/tools/crg-risk-graph.ts`（HTML 渲染器 → 数据构建器 + BINDING_LIMIT + focus
补节点）、`core/actions/review.ts`（root 参数）、`core/actions/crg-query.ts`（两个
新查询）、`core/session-*`（workspaceDir）、`App.tsx`（taskhubTabs + 引桥 + rail）。

---

## 八、验证

- `npx tsc --noEmit`（core + desktop）零错误；
- `npm test --workspace @deeporca/desktop`：**377/377 通过**（本轮新增
  session-trace ×3、tokens-summary ×3、task-hub ×4、jobs-store ×2、generated-paths ×2
  等 14+ 用例）；
- eslint 0 error 0 warning · prettier 干净；
- 风险图谱/任务树均经 Playwright 真渲染截图验证（浅/深主题、真实规模
  60 节点/41 边/8 组数据）。

## 九、已知边界与后续

- **并发会话运行**（bridge 多路复用）为后续任务，本轮交付存储隔离地基；
- OCR 外部 CLI 的 API 消耗不经引擎，不在 token 聚合范围（本地 embedding
  零 token）；
- 任务树为只读面：fork/merge 等操作仍在会话域由 task.* 承载；
- 轨迹长会话策略：最近 3 Turn 常开 + 完整记录走「打开时间线」。
