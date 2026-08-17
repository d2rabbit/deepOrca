# 预研：dembrandt / graph-engineering / ruflo 对 deepOrca 的集成价值

日期：2026-08-17 · 分支：`feat/sandbox-p0-path-gate` · 性质：预研（无代码变更）

调研方法：三个仓库均由原始源码逐文件核证（README 只作参考不作结论），本仓库侧由
actions/MCP/routing/session/sandbox 各模块的代码走读支撑。zread 未收录 dembrandt 与
graph-engineering，均通过 GitHub raw/API 兜底核验。

## TL;DR

| 项目 | 本质 | 成熟度 / 许可 | 建议继承方式 | 集成深度 | 与现有冲突 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| dembrandt/dembrandt | 网站 design-token 提取引擎（TS + Playwright + MCP） | 高：2.9k★、周更、v0.28、MIT | builtin MCP + `design.*` action；纯函数库直接引用 | **L2 运行时集成** | 与 browser-skill 各带一套 Playwright（体积重叠） | **值得集成**：补齐 design 链路缺失的"品牌摄入"环节 |
| codejunkie99/graph-engineering | 纯 Markdown 知识图谱方法论（Claude skill，零代码） | 内容扎实但仅 1 commit；MIT | 复制为 bundled skill + 摘取设计思想 | **L0 知识层 + L3 思想移植** | 无（技术上不可能冲突） | **零成本纳入**：skill 直接装，方法论喂给 CRG / memory / task-tree |
| ruvnet/ruflo | claude-flow 改名版，Claude-Code 中心的多智能体编排层 | 代码量巨大但质量参差、churn 极高；MIT | 不引代码：仅作可选外挂 MCP + 模式移植 | **L1 外挂 + L3 模式移植** | 与 session loop / plan mode / 存储位置 / 依赖治理全面冲突 | **不引入依赖**：把 durable-workflow 模式移植进 task-tree 强化现有编排 |

集成深度定义（本报告自用）：L0 = 知识/提示词层；L1 = 用户可选外挂；L2 = 内置
builtin（vendored / builtin MCP + action 接线）；L3 = 源码级继承（移植模式或引纯函数库）。

---

## 1. dembrandt —— 网站设计系统 → token 提取引擎

### 1.1 它是什么（核证事实）

- 给一个 URL，用真实 Chromium/Firefox（Playwright）渲染页面，逆向提取整套设计系统：
  品牌色（含语义角色、hover/focus 态、LCH/OKLCH 标注）、字体比例、间距/栅格推断、
  圆角/边框/阴影/渐变、动效（时长/缓动/上下文）、组件计算样式、真实 CSS 断点、logo
  检测、WCAG 对比度审计、深色模式与移动视口提取。
- 输出：schema 版本化的 JSON、**W3C DTCG tokens**、**Tailwind v4 `@theme` CSS**、
  面向 AI agent 的 `DESIGN.md`、PDF/HTML 品牌手册；另有 **drift 对比引擎**（Lab ΔE
  色差数学 + 分类加权 0–100 评分）可当 CI 门禁用。
- 工程面：TS/ESM、Node ≥18（本仓 Node ≥22 兼容）、MIT、~19K LOC、50+ 测试文件、
  v0.28.0（2026-08-13 发布，9 个月 59 个版本）。`onnxruntime-node` 仅作可选依赖
  （928 字节的品牌色分类器，缺模型时优雅降级——与本仓 embedding-loader 哲学同构）。
- 三个入口：CLI（`dembrandt <url> --json-only`）、**MCP server**（`dembrandt-mcp`，
  13 个工具，带并发=2 的异步 job 队列）、npm 库（`drift`/`findings`/`dtcg`/
  `markdown` 等纯函数子模块**零浏览器/原生依赖**，可单独引用）。

### 1.2 启发

1. **Design 链路缺的这一环**："照着某网站的品牌做 UI"——本仓已有 browser-skill（操作
   浏览器）、bento/tailwind（UI 生成）、DesignPanel/DesignPreview（预览）、
   `design.materialize` action，但没有"把目标品牌变成结构化约束"的摄入器。
   dembrandt 的 URL → DTCG/`@theme`/DESIGN.md 正是该环节。
2. **Drift 门禁是一种新的 review 维度**：本仓 `review.*` 已有 CRG 风险合成
   （`mergeReviewWithCrgRisk`）；"agent 重新生成页面后用 ΔE 评分验证没有偏离品牌
   基线"是确定性、无 LLM 的验收门禁，可复制 ocr+crg 的组合模式。
3. 可借鉴的工程模式：MCP 长任务**异步 job-id 轮询**；17 个 extractor 并行且
   `guardExtractor` 故障隔离（失败记入 `meta.errors`、标记 degraded 而非中断）；
   schema 版本化 + `$extensions` 溯源块的输出契约。

### 1.3 继承方式与集成程度（建议 L2）

按本仓"新增外部能力"的标准配方（见 §4 配方）：

1. **P0（半天级）**：`augmentMcpServersWithBuiltins`
   （`packages/core/src/session.ts:1536`）注册 builtin MCP `dembrandt`
   （`npx -y --package dembrandt@<pin> dembrandt-mcp`，同 serena 的禁用开关模式：
   core 只留 disable-gate，spawn 配置由 desktop 注入）。13 个工具自动进 LLM 工具表，
   受 G2 tool-router 的 token 预算与权限体系管辖。
2. **P1**：desktop 适配器 `src/main/tools/dembrandt-cli.ts` + core 新增
   `actions/design.ts` 扩展（`design.extract` / `design.drift`），走 `ctx.spawner`
   调 CLI `--json-only`，输出落 `design-store.ts`（已存在，正好是它的持久层）。
   产物供 `bento.create` / OpenUI renderer 消费为生成约束。
3. **P2（可选）**：直接依赖其纯函数子包（drift/findings）在 desktop 侧实现
   `review` 的新维度 `design-drift`，无需浏览器运行时。

### 1.4 提供的能力 / 加强的模块

| 能力 | 加强的现有模块 |
| --- | --- |
| URL → DTCG/Tailwind @theme/DESIGN.md | `templates/plugins/design`（design 插件获得输入端）、`bento.create`、OpenUI `tool-provider.tsx`、DesignPanel |
| 品牌基线 drift 评分 + findings 审计 | `review.*` actions（新增确定性维度）、`crg-query.ts` 的合成模式可类比复用 |
| MCP 异步 job 模式、故障隔离 extractor 模式 | 参考 `mcp-manager.ts` 与后续长任务 action 设计 |

### 1.5 冲突与处置

- **与 browser-skill 的浏览器栈重叠**（两份 Playwright/Chromium，~150MB 量级，堪比
  Granite 的 118MB 先例）→ 不各带一份：dembrandt 走 MCP/npx 时浏览器按需下载；
  若 vendor，则复用 browser-skill 的浏览器二进制或共享下载缓存（vendor-download.js
  已有代理回退与版本校验基建）。
- **写文件过沙箱门**：dembrandt 会在 cwd 写 `output/<domain>/`。作为 action 集成时，
  输出目录必须经 `gateWrite`/`PathGrant`（`common/path-boundary.ts`）授权，spawn 进
  `sandbox/backend` 的 `wrapShell()`，事件入 audit bus（`sandbox/audit.ts` 的
  `file_write`/`process_start`）。MCP 直出模式下其写入不受本仓门控——须在权限
  sideEffects 声明中如实标注 `write-in-cwd`。
- **对外抓取任意 URL**：若未来自研包装层发起网络请求，必须遵守本仓约束——仅
  http/https、发起前校验 host、拒绝 localhost/环回/私有/保留地址（SSRF 防线）；
  dembrandt 产物（URL、字体源等）视为不可信输入。

---

## 2. graph-engineering —— 知识图谱方法论 skill（零代码）

### 2.1 它是什么（核证事实）

- **不是软件项目**：7 个文件、36KB、全部是 Markdown；`dist/*.skill` 是 ZIP 包着的
  SKILL.md + references。MIT、414★、仅 1 个 commit（2026-07-23），一次性内容投放。
- 内容两半：**知识图谱九段流水线**（scope → 表示选型 → 本体 → 实体/关系/事件抽取 →
  质量门 → 融合 → 服务化 LLM，蒸馏自东南大学研究生课程）+ **任务图编排模式**
  （DAG、假边删除、"菱形"并行-独立验证-单一合并、停止规则、人审门）。
- 质量高于一般 prompt 内容：融合细节（blocking → 分层匹配 → 可逆合并策略
  `merged_from`）、抽取失败模式表、每节点/边强制溯源（source/extracted_at/confidence）
  都是真实工程指导，不是链接农场。

### 2.2 启发（对本仓最有"性价比"的一类：只花阅读成本）

可直接摘取强化现有模块的思想：

1. **CRG/CodeGraph 查询层**（`actions/crg-query.ts` 纯 SQL 读图）：
   - "取两实体间的**路径**而非各自邻域"是多跳检索更贴合 LLM 上下文的形态，当前
     CRG 只有 impact-radius BFS 邻域式查询——可加 `paths-between` 查询模式；
   - 三元组序列化格式 `(head)-[REL {source}]->(tail)` 按 head 分组喂 LLM，可改进
     `formatCrgContextForOcr` 的渲染；
   - "k>2 跳不做重排就是噪音"作为查询深度护栏。
2. **图融合纪律 → CodeGraph 索引**：重复符号/定义节点的规范形规则 + 可逆合并
   （`merged_from`）；边上带溯源+时间戳服务于图新鲜度（incremental sync 已有，缺
   溯源语义）。
3. **memory L0–L3**：graph-as-memory 循环（增量抽取→融合→取子图不取全图；矛盾
   事实双存并带时间+溯源、偏新）几乎 1:1 映射 memory pipeline 的关切。
4. **task-tree P3 子代理编排**：菱形模式（并行 worker → 各自独立上下文的 verifier →
   单一 owner 合并）、spawn 上限、"不可逆边必须过人审门"——最后一条与本仓权限体系
   的 delete/git-mutate force-ask 同构，可直接写进 P3 设计的验收规则。
5. **知识图谱 skill 本身**：本仓有 code-graph 和向量召回，但没有"对任意文档建知识
   图谱"的方法论内容。装上后 agent 用现有 7 个内建工具（bash/read/write/edit）即可
   像样地执行"从我的文档建 KG"。

### 2.3 继承方式与集成程度（L0 + L3）

- **L0**：复制 `graph-engineering/` 目录进 bundled skills 槽位（与
  `karpathy-guidelines`、`deeporca-self-refer` 同级；本仓 skill 加载器就是
  SKILL.md + YAML frontmatter 格式，完全兼容）。零依赖、零运行时、零冲突。
  建议入库前做一次裁剪（保留 SKILL.md + references，WORKFLOWS.md 的九个 prompt
  块可与本仓 slash-command 习惯对齐后收录），并保留 MIT 归属（NOTICE 一行）。
- **L3**：§2.2 的五条思想分别落到 crg-query / codegraph 索引 / memory / task-tree
  P3 的设计文档与实现，注明思想来源。

### 2.4 冲突

**无**——不含代码、不含运行时、不触碰 node:sqlite 存储与 ONNX 单例，不存在依赖面。
唯一注意点：skill 描述要写清楚"这是方法论，不要诱导 agent 去装 Neo4j"；它文本里
提到的 Neo4j/Kùzu/NetworkX 只是讨论选项。

---

## 3. ruflo（原 claude-flow）—— 多智能体编排层

### 3.1 它是什么（核证事实）

- Claude-Code 中心的"元 harness"：100+ agent 人设、swarm 协调、向量记忆
  （agentdb/HNSW）、自学习模型路由、跨机 federation、35 插件市场；npm 包名仍是
  `claude-flow@3.34.0`。~68k★、1600+ release（一天多更）、MIT、量级数十万行 TS。
- 编排三层并存：MCP `workflow_*` 面（11 工具，单 JSON 文件存状态，**parallel/loop
  步骤未实现**——代码自己注释"如实标 skipped 而非假装完成"）；v3 DDD 引擎
  （拓扑排序 + 顺序执行 + 反序 `onRollback` 补偿，状态在内存 Map）；Claude Code
  原生 Workflow JS（`agent()`/`parallel()`/`pipeline()` 四钩子 + **按 run journal
  缓存未变步骤的恢复语义**——全仓最有价值的 durable-execution 思想）。
- 质量参差有据：`--json` stdout 污染（#2909）、npx 安装损坏（#2805/#2858）、MCP
  记忆面不可靠到官方建议用 CLI one-shot 绕过；营销口径（"323 工具/89% 路由准确率"）
  与核证代码相去甚远。其 `agent_execute` 是**单发 prompt→文本，无工具循环**，能力
  弱于本仓 session agent。

### 3.2 冲突清单（为什么不能引依赖）

1. **第二个编排大脑**：它围绕 Claude Code 的 hooks/`.claude/`/插件市场构建；引入即
   与本仓 session loop + plan mode + task-tree 形成竞争性双脑。
2. **人审门重复**：其 approval gates 与本仓 `ask_permission`/`AskUserQuestion`/
   plan-mode force-ask 语义重叠，双门需要单一裁决权威。
3. **存储位置冲突**：硬编码项目 cwd 下 `.claude-flow/` vs 本仓
   `~/.deeporca/projects/<code>/` + crash-safe session index。
4. **依赖治理**：alpha 版 `@claude-flow/*`、better-sqlite3/RuVector 原生与 WASM
   件、1630 release 的 churn——进 UI-free 的 core 不可接受；直接 import 也违反
   本仓"外部能力走 MCP/actions、内建工具保持 7 个"的规矩。
5. **license 门禁**：本分支刚落了依赖树 license 合规门禁（34209fc），alpha 传递
   依赖树审计成本高。

### 3.3 在现有基础上的强化（L1 + L3，"参考强化"的正解）

**L1 外挂（零代码）**：高级用户可经现有 `McpManager` 自行 attach
（`npx ruflo mcp start`）。不内置、不宣传为默认；其工具自动受 G2 tool-routing
token 预算约束（323 个工具必然触发路由）与本仓权限 scopes 管辖。注意其
`.claude-flow/` 写入与 daemon 进程：sideEffects 如实声明，沙箱侧按
`process_start`/`file_write` 审计口径对待。

**L3 模式移植**（进 `specs/task-tree/design.md` 的 P3 与 session 层）：

| ruflo 的模式 | 强化本仓的落点 |
| --- | --- |
| 工作流状态机 `created→running↔paused→completed/failed/cancelled` + 每步后持久化 + `{{stepId.output}}` 绑定 | task-tree `task.*` actions：把 JSONL session 持久化扩为步骤 journal 形态 |
| `resumeFromRunId`：输入哈希未变的步骤命中 journal 缓存直接跳过 | task-tree P3 子代理的**可恢复长任务**机制（分支=子代理载体语义下的断点续跑） |
| 拓扑任务树 + 反序 `onRollback` 补偿 | action 控制器级补偿：写侧工具用现成的 file-history/.git undo 作回滚原语 |
| 可重试错误正则（429/5xx/timeout/ECONNRESET）+ 预算封顶的模型降级链 | `common/openai-client.ts`：本仓有 usagePerModel 记账但无调用级重试/降级策略 |
| 缓存感知调度（270s 心跳刻意压在 5min prompt-cache TTL 之下）+ `cache_control` 断点 | DeepSeek 前缀缓存字节稳定性已有（工具表确定性排序），此思想可进未来的定时任务/长驻会话特性 |
| 每步事件日志 + 耗时快照 | 已有 `sandbox/audit.ts` SHA-256 链式审计可扩展承载，不要另起日志系统 |

即：**ruflo 的编排壳有价值、核没有价值；把壳的语义移植进 task-tree，而不是把
ruflo 装进来。**

---

## 4. 与本仓架构约束的对账（三个项目通用）

新增任何能力都必须过这五道闸（出自 AGENTS.md + 本分支沙箱规约）：

1. **分层**：core UI-free；dembrandt 的 spawn 配置/desktop 适配器/设计产物存储全部
   在 desktop 侧，core 只留 seam（`configure*`/`get*` 对 + disable gate）。
2. **能力入口**：不新增内建工具；一律 MCP builtin / action / bundled skill。
3. **权限与沙箱**：action 声明 `sideEffects`（喂桌面权限门）；写文件过
   `PathGrant`/`gateWrite`（`common/path-boundary.ts`）；spawn 走
   `sandbox/backend` 的 `wrapShell()` 并入 audit bus；plan mode 下 write/delete/
   git-mutate 照旧 force-ask。
4. **工具表预算**：builtin MCP 每加一个 server 都推高 G2 tool-router 的
   `mcpTokenBudget` 压力——dembrandt 13 工具可整服务注入；ruflo 323 工具必须走
   外挂+路由，绝无内置可能。
5. **License 门禁**：三者皆 MIT（dembrandt "thevangelist 2025"、graph-engineering
   "codejunkie99 2026"、ruflo "ruvnet 2024-2026"），过门禁无障碍；vendored skill
   与移植代码段在 NOTICE 中归属。

另：自研任何发 URL 请求的包装层时，遵守安全约束——仅 http/https、请求前校验
host、拒绝 localhost/环回/私有/保留地址。

## 5. 建议路线（优先级排序）

| # | 动作 | 成本 | 收益 |
| --- | --- | --- | --- |
| P0 | graph-engineering 裁剪后收为 bundled skill（含 NOTICE 归属） | ~0.5 天 | 立即获得 KG 方法论；为 memory/CRG 提供统一话语 |
| P0 | dembrandt 以 pinned npx builtin MCP 接入（disable 开关 + 权限声明） | ~1 天 | design 链路闭环：URL→tokens→bento/OpenUI 生成 |
| P1 | `design.extract`/`design.drift` action + desktop CLI 适配器 + design-store 持久化；drift 作为 review 新维度 | ~2–3 天 | 品牌漂移门禁（确定性、无 LLM 成本） |
| P1 | task-tree P3 设计文档吸收 ruflo 的 journal/断点恢复/补偿三模式（注明来源） | 设计文档级 | 长任务可恢复语义提前定型，避免返工 |
| P2 | crg-query 增加 paths-between 查询 + 三元组渲染改进；codegraph 融合加 `merged_from` 可逆合并 | ~2 天 | 图检索的 LLM 上下文效率 |
| P2 | openai-client 增加预算封顶的重试/降级链 | ~1 天 | 多模型韧性，配 usagePerModel |
| 不做 | npm 依赖 `@claude-flow/*`；vendor ruflo；为 dembrandt 单独带一份 Chromium | — | 避免双脑、依赖污染、体积翻倍 |

## 6. 证据与指针

- 本仓扩展点：`actions/registry.ts`、`actions/types.ts:139`（Spawner seam）、
  `session.ts:843-905`（27 个 action 注册）、`session.ts:1536`
  （`augmentMcpServersWithBuiltins`）、`session.ts:1637-1682`（in-process 连接）、
  `desktop/src/main/tools/*`（六个适配器范本）、`main/index.ts:178-307`（boot 接线）、
  `routing/tool-router.ts`（G2 预算路由）、`sandbox/path-boundary.ts` /
  `sandbox/audit.ts` / `sandbox/backend/interface.ts`、`specs/task-tree/design.md`
  （P3 子代理方向）、`docs/research/2026-08-11-tool-orchestration-design.md`。
- dembrandt：v0.28.0 `package.json`/`index.ts`/`mcp-server.ts`/`lib/drift.ts`/
  `lib/extractors/index.ts`（guardExtractor :779-799）/`docs/type-model.mermaid.md`；
  GitHub API 元数据（2026-08-13 pushed_at）。
- graph-engineering：全 7 文件通读（README/WORKFLOWS/SKILL.md/5×references/LICENSE），
  `dist/*.skill` 魔数核验为 ZIP；上游课程 `npubird/KnowledgeGraphCourse`（4.4k★）。
- ruflo：`README.md`/`package.json`/`LICENSE`/`docs/STATUS.md`/
  `v3/@claude-flow/cli/src/mcp-tools/workflow-tools.ts`（"parallel/loop deferred"
  注释）、`agent-execute-core.ts`（重试/降级/路由）、`v3/src/task-execution/`
  （Task.ts/WorkflowEngine.ts 补偿）、`plugins/ruflo-workflows/docs/adrs/0002-*.md`
  （journal 缓存恢复）。
