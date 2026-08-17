# 预研：代码智能与 designer 双线外部对标 —— CodeBrain / MemBrain / hallmark / motionsites.ai

日期：2026-08-17 · 分支：`feat/sandbox-p0-path-gate` · 性质：预研（无代码变更）

## 命题映射（两条模块线，四个仓库）

| 模块线 | 仓库 | 在本线中的角色 |
| --- | --- | --- |
| **代码智能（索引和知识的加强）** | feelingai-team/CodeBrain | 代码索引对标（结论：反面参考 + 三个可移植模式） |
| **代码智能（索引和知识的加强）** | feelingai-team/MemBrain | 知识/记忆对标（结论：架构同构，查询侧可借鉴，许可受限） |
| **designer（ui-designer 模块的模板和风格强化）** | Nutlope/hallmark | 结构与纪律对标（宏结构词汇表 + 可计算多样性轴 + 门禁） |
| **designer（ui-designer 模块的模板和风格强化）** | xiiiabu/motionsites.ai | 动效词汇对标（命名揭示模式 + 时值/缓动阶梯；禁止 vendored） |

feelingai-team 复核定谳：该账号为 **User 而非 Organization**（`public_repos: 2`，含
fork 的全量列表即 MemBrain + CodeBrain，均 Python、均非 fork）——组织网页上的
"content failed to load" 报错未隐藏任何仓库。

## 调研方法（三轮递进）

1. **外部仓库逐文件核证**（zread MCP + GitHub raw/API；README 只作参考不作结论）。
2. **本仓侧代码走读复核**（`memory-manager.ts` / `tdai/core/hooks/auto-recall.ts` /
   `tdai/core/store/*` / `actions/{codegraph,design}.ts`）——修正初稿一处论断错误
   （RRF 已有，见 §2.3-1）。
3. **gh 恢复后浅克隆本地一手复核**（`gh repo clone --depth 1` 到 /tmp，本地
   `wc -l`/`grep` 取精确值）——六条承重论断无一翻案，精确数字替换估算值。

> **三次复核汇总**（全为一手取证）：① MemBrain 根目录 17 项**确无 LICENSE/NOTICE**；
> ② MemBrain 确为 **4 提交单作者**（Xinyu Pan，2026-02-05 → 04-13 压缩投放）；
> ③ CodeBrain `pyproject.toml` 硬依赖仅 `pydantic`+`lsprotocol`，extras 为
> tree-sitter 族 / fastmcp / watchfiles，**确无任何 LLM SDK**，本地 grep 全 src 对
> openai/anthropic/litellm/reasoning_effort/premature/stuck/compact **零命中**
> （agent-loop 不在仓库的证据链闭合）；④ CodeBrain README 路线图原文为
> `[x] Core module source code` + `[ ] Integration with popular agents - TBD`（初次
> 网页摘要把两行混读，本文采用正确读法）；⑤ Graphiti 移植一手并排比对成立——两边
> `blake2b(f"{seed}:{shingle}", digest_size=8)` 构造逐字符相同，熵/Jaccard/MinHash
> 机制同名同形（常数自硬编码移入 settings），MemBrain 文件**零署名**而 Graphiti
> 原文件带 `Copyright 2024, Zep Software, Inc.` Apache-2.0 头；⑥ 精确计量（本地
> `wc -l`）：CodeBrain **50 文件 / 7,611 LOC / 78 提交**（contributors 端点 64+5
> 是低估），MemBrain **69 文件 / 9,172 LOC / 4 提交**；`_RRF_K=60`
> （retrieval.py:56）、`EMBED_DIM=2560`（config.py:52）、`FactStatus.INVALIDATED`
> 仅声明从未赋值，均本地确认。

## TL;DR

| 项目 | 本质 | 成熟度 / 许可 | 建议继承方式 | 集成深度 | 与现有冲突 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| feelingai-team/CodeBrain | LSP + tree-sitter 的 MCP 工具服务器（11 工具） | 低：v0.1.0、78 提交、休眠 4 个月、无 CI、MIT | 只移植 3 个模式，**不引依赖** | **L3 模式移植** | 索引能力**弱于**本仓 CodeGraph 持久索引 | **不作索引参考对象**：可借的是降级三态、诊断分桶采样、编辑后校验闸门 |
| feelingai-team/MemBrain | Agent 长期记忆引擎（事实 + 实体切面树 + 六路混合检索） | 中：9.2k LOC 真实现、281★、4 提交、零测试、**无 LICENSE 文件** | 只读借鉴算法，**禁止拷贝代码** | **L3 思想移植（受许可限制）** | ParadeDB+Postgres 硬依赖 vs 本仓进程内；2560 维 vs Granite 97M | **架构同构、查询改写值得学**：固定角色多查询改写可直接用（RRF 本仓已有，§2.3-1） |
| Nutlope/hallmark | 纯 Markdown 的 anti-slop 设计技能（21 主题 × 21 宏结构 × 58 门禁 × 4 动词） | 高：25.4k★、3.5 个月 57 个 PR、MIT、**零代码** | 移植概念与门禁子集，**不整包装入** | **L0 知识层 + L3 思想移植** | 目标栈裸 HTML+`:root` vs 本仓 `.dd`+Tailwind / OpenUI DSL；字体禁令与模板默认值冲突 | **值得深度借鉴**：补齐 designer 最大缺口——宏结构词汇表与可计算的多样性轴 |
| xiiiabu/motionsites.ai | 65 条动效网站复刻 prompt（React+Tailwind+Framer Motion 精确规格） | 低：2026-04 一次性投放；**内容源自 motionsites.ai 付费画廊导出**（frontmatter 带 `License: Premium`） | **禁止 vendored**；只以自己的语言蒸馏动效编排词汇 | **L3 词汇级移植（只读灵感）** | 栈不匹配（React/Framer vs 自包含 HTML）；部分 prompt 恰是 hallmark 门禁要拦的 AI 味 | **有限借鉴**：动效词汇是本仓 taste 最薄弱一轴；纪律权威仍是 taste/hallmark |

集成深度定义（沿用 external-repos 预研）：L0 = 知识/提示词层；L1 = 用户可选外挂；
L2 = 内置 builtin；L3 = 源码级继承（移植模式或引纯函数库）。

**许可红线（最重要的单条结论）**：MemBrain README 挂 Apache-2.0 徽章但**仓库无
LICENSE 文件**（GitHub API `license: null`）——当前状态保留所有权利，**不能拷贝任何
代码**；且其 `entity_resolver.py` 是 Graphiti `dedup_helpers.py`（Apache-2.0，Zep
Software 版权头）的近乎逐行移植却零署名。本仓刚上线依赖树 license 合规门禁
（`npm run check`），立场须一致：MemBrain 只作只读灵感源；要做 MinHash/LSH 实体消解
直接从 Graphiti 取并正常署名。hallmark（MIT，纯 Markdown）与 CodeBrain（MIT）无此
问题；motionsites.ai prompt 库内容源自付费画廊导出，**禁止 vendored prompt 与视频**。

---

# Part I 代码智能线 —— 索引和知识的加强

## 1. CodeBrain —— 代码索引的"反面参考"

### 1.1 核证事实（含两处重要反转）

- **README 路线图里 "Core module source code" 是已勾选的，代码确实完整**：50 个
  Python 模块 7,611 LOC（本地 `wc -l` 精确值），无 `NotImplementedError`、无 stub。
- **但 README 主打的 agent-loop 层根本不在这个仓库里。** 提前停止恢复、动态推理强度、
  工具调用格式纠正、卡死检测、上下文压缩（早期消息 pin 住）、per-model 提示词定制
  ——**七项全部缺失**，不是没找到而是代码不存在。证据链闭合：`src/codebrain/` 顶层
  仅 `core/ fallback/ lsp/ mcp/ search/ skills/ tools/`（本地 `ls` 确认），无
  `agent/ loop/ harness/ prompt/ model/ compaction/ context/`；硬依赖只有 `pydantic`
  和 `lsprotocol`，**没有任何 LLM SDK**，本地 grep 全 src 对 openai / anthropic /
  litellm / reasoning_effort / premature / stuck / compact 零命中。`src/codebrain/skills/`
  是同名陷阱——它是 5 个薄 LSP 组合辅助函数（最小的 `contextual_diagnostics.py`
  只有 22 行）。
  → **那个 72.3% Terminal-Bench 成绩背后的工程没有开源；开源的是 agent 调用的工具服务器。**
- 实际是**双引擎**（推翻"索引完全交给 LSP"的说法）：诊断/定义/引用/hover/调用层级/
  重命名走 LSP（pyright-langserver / gopls / typescript-language-server / clangd）；
  符号搜索与 repomap 走**自研 tree-sitter**（`search/symbol.py` 手写 6 语言节点类型表，
  `search/repomap.py` 手写 `pagerank(damping=0.85, iterations=20)`）。
- **无 embedding、无向量库、无持久索引**（这部分说法成立）。`SymbolIndex` 明确是
  in-memory，每次 `Workspace.start()` 全量 `build()`，不落盘不序列化。
- FallbackChain 三态降级：`active → degraded → unavailable`。降级态下
  `get_context()` 只返回裸诊断（无定义/hover/引用/quick-fix），并把这个事实**以
  header/footer 形式写进工具输出**告诉模型，附带补救提示与 `check_health()` 指引。
- 诊断后处理是真功夫：severity 过滤（无法识别的名字 fail-open 返回全部）+
  `MAX_DIAGNOSTIC_TYPES=5 × MAX_SAMPLES_PER_TYPE=5` 按 error code 分桶采样并保留计数
  （500 个错误 → ≤25 个具体样例 + "…and N more of this type"）+ 每条诊断 5 次 LSP
  往返取上下文 + 引用采集是带预算的 BFS（`reference_depth=2, reference_limit=8`，
  截断时诚实输出 `_(truncated, limit=8)_`）。
- `bootstrap.py` 生成一个 Claude Code `PostToolUse` hook：每次编辑后 shell 注入
  "You just edited $FILE. Run validate(file_path=...) NOW"；另生成含两个 SOP 的
  `CLAUDE.md`。这是该仓唯一的"让 agent 做对事"机制，且在 agent 之外。
- 工程信号：MIT；v0.1.0；**78 提交**（gh 精确计数；contributors 端点 64+5 低估）；
  单团队；创建 2026-02-10，最后 push 2026-04-07，**休眠约 4 个月**；158★；0 open
  issue；无 `.github/` 即无 CI；25 个测试文件但无覆盖率工具。两个 console script
  （`codebrain` / `codebrain-mcp`）指向同一入口函数。
- 第三轮补读（子代理此前未核验的）`tools/navigation.py`：`_get_lsp_reporter` 对
  FallbackChain / MultiLanguageReporter 有递归解包 + duck-typing 兜底，函数本身稳健；
  "consolidated.py 跨模块私导入它"的批评成立，但属风格问题非正确性问题。

### 1.2 关键判断：它不是我们索引层的参考对象

本仓已有 CodeGraph（vendored，`.codegraph` 项目目录承载**持久索引**——
`hasCodegraphProject` 即查此目录，`codegraph_explore` 一次调用返回按文件分组的符号
源码 + 调用路径）、CRG（review 风险合成）、serena（LSP 语义工具，经 uv）。逐项对比，
CodeBrain 在索引上**落后于我们**：

| 维度 | CodeBrain | 本仓 |
| --- | --- | --- |
| 索引持久化 | 无，每次启动全量重建 | CodeGraph `.codegraph/` 持久 |
| 符号搜索 | **每次调用重新遍历+重新解析整个工作区**，已建好的 `SymbolIndex` 完全不用 | 走持久索引 |
| 图边质量 | 纯名字匹配，"文件内每个定义连向每个同名目标"，不是调用图；node key `file:name` 同文件同名互相覆盖 | CodeGraph 真调用关系 |
| 语义召回 | 无 embedding | Granite 97M + SkillRouter/ToolRouter |

另有若干已核实的缺陷，可当"别这么干"清单：所有文件共用**一个** `asyncio.Event` 等
诊断，任一文件的 `publishDiagnostics` 都会置位，批量 `validate` 可能返回空或过期
结果，而超时被静默吞掉返回 `[]`——与"文件干净"不可区分；两个文件遍历器不一致
（`parser.py` 跳过 25 个目录，`repomap.py` 裸 `rglob` 不跳，冷路径会去解析
`node_modules` 和 `.venv`）；`docs/guide.md` 的 Python SDK 示例每一条都跑不起来
（一律把 `Workspace` 传给要 reporter 或 root path 的函数）；N 个子项目 → N 套
language server，无池化无淘汰。

### 1.3 值得移植的三个模式（L3，不引依赖）

1. **降级状态入带（P0）。** 我们的 fail-open 哲学已经到位（router 失败置 null 走全量
   候选、dembrandt `guardExtractor` 故障隔离）。复查修正：降级**并非完全静默**——
   已有 `codegraph.status` 查询（`actions/codegraph.ts:46`，返回 `{root, label,
   initialized}` 并提示 `initialized=false → reindex`）。缺的是 **per-call 降级入带**：
   每次 `explore`/`crg`/`serena` 调用不回传自身降级态，模型要主动调 status 才能知道。
   CodeBrain 的做法值得抄：给分析层 action 的结果加
   `status: active | degraded | unavailable`，并在输出上加一句人话说明 + 补救指引。
2. **诊断/错误输出的分桶采样（P0）。** 按错误码分桶 → 桶按出现次数降序 → 取前 5 类 ×
   每类前 5 条 → 保留"还有 N 条同类"的计数。这套 token 预算机制可直接用在
   `review.*`、`arch-scan` 的输出，以及 bash 工具的长输出截断上——比无脑截断保留的
   信息多得多。
3. **编辑后校验闸门（P1）。** 用 hook 在 `edit`/`write` 之后提示对改动文件跑类型检查。
   我们有 `npm run check`（全量），缺的是**单文件粒度**的即时反馈。

不建议做的：不引 `codebrain` 依赖（v0.1.0 + 休眠 4 个月 + 索引弱于现状 + 与 serena
功能重叠）。它的 11 工具"刻意收敛"与本仓"内置工具刻意最小化"规则同源，可作后续
action 面设计的参照。

## 2. MemBrain —— 与本仓 memory 高度同构的知识/记忆对标物

### 2.1 核证事实

- **引擎是真开源的**（与 CodeBrain 相反）：69 个文件 9,172 LOC（本地 `wc -l` 精确值）
  真实现，14 个 LLM 提示词以纯文本提交在 `manifests/*/`，`infra/db.py` 含字面 DDL
  （HNSW + BM25 `CREATE INDEX`）。三层切分：`*/core` 纯逻辑（只依赖 numpy，不碰
  DB）、`*/application` 编排、`infra/` SQLAlchemy + HTTP 客户端。
- **记忆模型只有一种记录类型**：原子自然语言事实字符串，`facts` 表上**没有**
  type/kind/category 字段。分层靠三张表：`facts`（原子事实，文本内嵌 `[Entity]` 与
  `[raw::resolved]` 时间标记）、`session_summaries`（每会话一条叙事摘要 → 输出时挂
  `## Relevant Episodes`）、`entities.desc`（≤50 token 身份陈述）+ 每实体切面树。
- **没有知识图谱**，且是明确设计选择（`docs/tech_blog.md`："triples 常常割裂信息"）。
  取而代之：实体↔事实多对多二部映射（`fact_refs`）+ **每实体层级切面树**
  （`entity_tree_nodes`，`node_type ∈ {root, aspect, leaf}`）。树算法是三仓中最有
  原创性的部分：自顶向下余弦路由（aspect 得分 = 0.5·sim(desc) + 0.5·sim(子树质心)）、
  增量质心更新、结构债调度（`debt = uncertainty + W_WIDTH·超宽 + W_DEPTH·超深`，
  `D_max(n) = round(2 + 1.3·ln n)`）、预算化 LLM 审计（GROUP / PROMOTE / RELOCATE，
  每实体每批最多 5 节点）+ 纯代码 `auto_dissolve()`。
- **检索是六路混合 + 两种融合**：4 次 LLM 查询改写（关键词 / 事件向 / HyDE 陈述句 /
  BM25 布尔式）→ 6 路候选（ParadeDB BM25 ×2、pgvector HNSW ×3、实体树 beam search）
  → **RRF（默认，`_RRF_K = 60`，retrieval.py:56）或 cross-encoder rerank（互斥，
  无分数融合）** → 切面去重（每叶切面≤3、每中层切面≤8）→ token 预算打包（事实
  4500 + 会话 1500，按分数贪心填充**再按时间重排**）。
- 存储：ParadeDB 0.21.11（**不是原生 Postgres**）、`HALFVEC(2560)` + HNSW
  `halfvec_ip_ops`（`EMBED_DIM=2560`，config.py:52）、按任务物理 schema 隔离
  `task_{pk}__{run_tag}`。
- **没有巩固、没有冲突消解、没有失效、没有遗忘。** `FactStatus.INVALIDATED` 声明了
  但全仓从未被赋值（本地 grep 仅 models/memory.py:29 一处）；`invalidate_facts` 全仓
  只出现在 `docs/concurrency.md:133` 流程图里，而该函数**不存在**。事实严格
  append-only，矛盾推给回答端 LLM（"两条事实冲突时相信更近的那条"）。实体更新是
  破坏性原地覆盖，而 `docs/tech_blog.md:41` 声称"创建新版本并保留早期状态"——无
  version 列、无历史表，**文档与代码矛盾**。
- 时间建模三套并存但都不是有效区间：文本内 `[raw::resolved]` 标记（ISO 8601，**只到
  源精度**，提示词明确禁止补零造成假精度，`/` 区间语法支持）、`time_annotations`
  侧表（`time_resolved` 是 `String(64)` 不是时间类型，无法做 SQL 时间过滤）、
  `facts.fact_ts`（说这句话的会话时间）。**无 `valid_from`/`valid_to`，无双时态**
  ——与 Graphiti/Zep 最尖锐的架构差异。
- 工程信号：**无 LICENSE 文件**（README 有 Apache-2.0 徽章，两个链接都 404，API 报
  `license: null`）；**4 提交**（单作者 Xinyu Pan，2026-04-07 是压缩代码投放）；
  **零测试、无 CI**；最后 push 2026-04-13，约 4 个月未动；281★。Ruff 只开
  `select = ["I"]`（仅 import 排序）。
- 榜单成绩**只以 4 张 LFS PNG 存在**，`evaluation/exps/.gitignore` 是 `*`，仓库内零
  机读结果。已转录：LoCoMo overall MemBrain 93.25 vs EverMemOS 93.05（**+0.20 pt，
  且 Multi Hop 反而更低**）；LongMemEval 85.60 vs 83.00；PersonaMem-V2 55.72 vs
  53.25；KnowMe-Bench 只报 7 任务里的 2 个，且基线是 GPT-5-mini 而 MemBrain 自己的
  backbone 未说明。**不应把这些数字当质量标杆。**

### 2.2 与本仓 memory 的对应关系

本仓 `packages/memory` 是 TDAI Core 完整自包含 fork（~17k LOC，MIT，见
`memory/src/NOTICE.md`），进程内 L0–L3：L0 原始对话 → L1 原子事实 → L2 场景切片 →
L3 用户人格；BM25 走 `@tencentdb-agent-memory/tcvdb-text`（静态导入、默认开启），
向量走 `@deeporca/embedding`（Granite 97M）。

对应关系相当整齐：**L1 原子事实 ≈ MemBrain `facts`；L2 场景切片 ≈
`session_summaries`；L3 人格 ≈ `entities.desc` + 切面树。** 即 MemBrain 是我们
L0–L3 的直接同侪。**复查修正（第二轮代码走读）**：检索骨架上"混合两路 + RRF"我们
**已有**（见 §2.3-1），MemBrain 真正领先的是**查询侧**（多查询改写）与**打包侧**
（token 预算）。

### 2.3 建议借鉴什么（只读借鉴，禁止拷贝代码）

> 本节经第二轮本仓侧代码走读复核（`memory-manager.ts` /
> `tdai/core/hooks/auto-recall.ts` / `tdai/core/store/{sqlite,factory,bm25-local}.ts`），
> 修正初稿一处论断错误。

1. **~~RRF 融合~~ —— 已具备，无需引入（复查修正）。** 初稿误判"我们只有两路、缺融合"。
   实际：`auto-recall.ts:316` 注释即写明 "hybrid: merge both results with **RRF**
   (Reciprocal Rank Fusion)"，`:655` `const RRF_K = 60`，`:664/:677` 双路
   `1/(RRF_K+rank+1)` 求和——**与 MemBrain 的 `_RRF_K=60` 同构同值**；且
   `memory-manager.ts:48` 默认 `strategy: "hybrid"`、`:51` BM25 默认开启；本地后端
   （`store/factory.ts` 默认 sqlite + sqlite-vec + FTS5，jieba 分词、
   `bm25RankToScore` 归一化 0-1）早已是进程内混合检索。这条从建议清单撤销。
2. **固定角色的多查询改写（P0，真差距）。** 复核确认本仓 recall 是**单查询直用**
   （全库无 rewrite / multi-query / HyDE 痕迹），FTS 与向量两路吃同一个原始 query。
   MemBrain 的价值不在"生成 3 个查询"，而在三个**形状被指定**的查询：事件向（对
   时间类问题主动丢掉时间维度）、HyDE 陈述句（"这条记忆里会逐字出现的那句话"）、
   BM25 关键词剥离式。而且每一路失败都退回原问题，不阻塞主链路。落点就是
   `auto-recall.ts` 的 hybrid 分支：两路检索前生成查询变体、各走各路、进同一个
   RRF 合并——与现有代码形状完全兼容。
3. **token 预算打包（P2，降级——收益存疑）。** MemBrain 按分数贪心填满固定 token
   预算，**发给模型前再按时间顺序重排**。复核发现本仓 `formatMemoryLine` 的时间语义
   **比它更结构化**（点时间 `timestamp` + 段时间 `activity_start/end_time` 三字段，
   行内渲染"活动时间: A ~ B"），且记忆行短、现有 `maxResults` 条数截断可能已够用；
   缺的只是 token 视角。降为 P2，待记忆注入量实际变大再考虑。（反面细节照旧：它
   声明了 `tiktoken` 依赖却用 `len//4+1` 估算 token，我们没必要退化到这一步。）
4. **源精度内联时间标记（P1）。** `[raw::resolved]` 只精确到源信息的精度，提示词明确
   禁止把 `2023-10` 补成 `2023-10-01`，"最近""某天"这类不确定表达**不加标记**。这是
   纯提示词层技巧，L1 抽取可以直接采纳，零 schema 变更。
5. **用输出校验器而不是提示词祈祷来约束抽取（P1）。** `@agent.output_validator` 在事实
   引用了不在冻结实体表里的名字时抛 `ModelRetry`；模型级校验器要求每条事实至少含一个
   `[entity]`、时间标记必须匹配 ISO 正则；反复失败则无约束重试**再过滤**违规事实。
   我们的 L1 抽取应当同构。
6. **实体切面树作为知识图谱的替代（P2，如果 L3 要走向结构化）。** 它对"为什么不用三元组"
   给了可信理由和可运行的替代方案。若我们希望 L3 人格从平铺走向结构化，这是现成的
   算法蓝本（路由 / 附着 / 审计 / 溶解 / 质心传播五件套）。

### 2.4 明确不要继承的部分

- **append-only 且无冲突消解的记忆语义。** 对编码 agent 的长期记忆来说，这不是"暂缺
  功能"而是随时间恶化的负债：用户三个月前的偏好与今天的冲突时，把裁决全部推给回答端
  提示词，规模一大必然失效。这是最该避开的设计。
- **ParadeDB + Postgres 硬依赖。** `create_engine` 在模块级执行，任何 import 都会拉起
  连接；BM25 走 ParadeDB 专有的 `USING bm25` / `pdb.parse` / `@@@`。我们 memory 明确是
  **进程内**（这正是 fork TDAI + 用 tcvdb-text 的理由），照搬存储层会直接违背桌面端
  无服务器约束。**取算法，不取存储。**
- **2560 维 embedding（Qwen3-Embedding-4B）。** DDL 把 `EMBED_DIM=2560` 焊死（且因为
  pgvector HNSW 对 `vector` 限 2000 维，必须用 `HALFVEC`）。我们安装包里已经有 118MB
  的 Granite，再塞一个 4B 嵌入模型不可能。
- **按榜单调参的做法。** per-benchmark manifests、`PersonaMemIngestWorkflow` 把实体表
  硬编码成 `["User"]`、给颜色/品牌/宠物物种写"细节保留检查清单"——这些说明系统是按
  benchmark 塑形的，任意领域的开箱质量很可能显著低于表格数字。

---

# Part II designer 线 —— ui-designer 模块的模板和风格强化

## 3. hallmark —— 结构与纪律的对标物

### 3.1 它是什么（核证事实）

- **零可执行代码。** `skills/hallmark/` 下 30 个条目全是 Markdown：`SKILL.md`
  68,608 B（约 1,100 行）+ `references/` 约 420 KB（24 个根文件 + 77 个子目录文件）。
  `package.json` 无 `dependencies`、无 `bin`，唯一脚本是 `python3 -m http.server`。
  仓库里唯一手写 JS 是营销站的 `site/js/main.js`（48 KB），与技能无关。
- **四个动词**：默认（生成）、`audit <target>`（打分出清单，**不改代码**）、
  `redesign <target>`（在既有实现边界内换视觉层，保留路由/文案意图/信息架构）、
  `study <screenshot|URL>`（提取设计 DNA）。
- **21 主题 × 21 宏结构**（两个 21 是巧合，互不相关）。主题 = OKLCH 色板 + 字体栈 +
  字阶 + 间距节奏 + 圆角/阴影；宏结构 = 页面骨架指纹（标题落位、分隔语言、按钮口吻、
  图像处理、揭示方式），如 Bento Grid / Long Document / Manifesto / Type Specimen。
- **58 条门禁**（`references/slop-test.md`，31 KB，编号 1–57 加一条 `38a`）。全部写成
  "正确答案是 no" 的问句，按 17 个主题分类，带 per-gate 的 genre 例外。**无任何自动
  检查器**——纯 LLM 自检指令，仓库无 CI、无测试框架。
- **两段式评审**：生成前 6 轴自评（Philosophy/Hierarchy/Execution/Specificity/
  Restraint/Variety，各 1–5，**任一轴 <3 触发重做**），生成后跑 58 门禁。
- **六层懒加载策略**，并明确写出理由："over-eager loading is the largest avoidable
  cost of running Hallmark"、"Pre-loading slop-test.md costs ~7K tokens for nothing"、
  "Never load the whole index plus more than one per-macro file in a single build"。
- **可计算的多样性轴**：连续两次生成必须在三轴之一不同——纸面明度带（dark L<30% /
  mid 30–85% / light >85%）、display 字型（10 种枚举）、强调色相（warm 10–60° /
  cool 200–300° / neutral / chromatic-other）。文档给了合法与非法的对照示例。
- **产物契约**是框架自适应的，不是"一个自包含 HTML"：token 进 `:root` 或项目已有的
  `tokens.css`；"An existing global stylesheet is **append-only**"，明确警告静默删掉
  `@tailwind` 指令会让整个应用失去样式。必须产出的机读物是 CSS 图章
  （`/* Hallmark · genre · theme · states · contrast: pass (46–50) */`）。
- 工程信号：MIT；创建 2026-04-27，最后提交 2026-08-06；25,438★ / 1,293 fork；
  PR 编号已到 #57（有外部贡献者）。`site/_tests/` 是自举样例（13 个 build，每个带
  `brief.md` 记录 Steps 0→6 的完整轨迹），`README.md` 兼当门禁列表的变更日志。

### 3.2 与本仓 designer 的差距（逐项对照）

本仓现状：`templates/design/systems/` 9 套设计系统（editorial / swiss-international /
modern-minimal / brutalist-contrast / warm-handcrafted / dark-tech / soft-neumorphic /
terminal-mono / glass-morphism）；`taste` 技能 11 条 P0 + 8 项自检 + 五维自评
（层级/节奏/对比/克制/工艺，各 ≥3 且总分 ≥20）；`deep-design`（`.dd` = YAML
front-matter + HTML body + section markers）；`pm-designer-openui`（OpenUI Lang DSL）；
刚落地的 dembrandt（真实 Chromium via CDP → DESIGN.md 品牌契约）。

| 维度 | 本仓 | hallmark | 差距判定 |
| --- | --- | --- | --- |
| 视觉主题 | 9 套 systems | 21 主题，每个带轴声明 | 数量差距**不是重点**，见 §3.3-1 |
| **页面骨架词汇表** | **无** | 21 宏结构，各有独立文件 | **最大缺口** |
| 多样性规则 | taste #11："布局骨架与色板都要不同" | 三轴可计算（明度带/字型/色相角） | 我们的规则**不可判定** |
| 门禁数量与组织 | 11 P0 + 8 自检 ≈ 19 | 58 条 / 17 类 / 带 genre 例外 | 量级差 3 倍 |
| 评审时序 | 渲染后五维自评 | 生成前 6 轴 + 生成后 58 门禁 | 两段式已对齐，轴不同 |
| 动词 | 仅生成 | 生成 / audit / redesign / study | 缺 audit 与 redesign |
| 品牌摄入 | dembrandt（真渲染，**更强**） | study（仅 WebFetch，无浏览器） | **我们更强**，但缺拒绝策略 |
| 加载预算 | 依赖 SkillRouter 向量召回 | 显式六层规则 + token 成本注释 | 粒度不同，可互补 |
| 产物图章/轮换日志 | `.deeporca/designs/` 目录 | CSS 图章 + `.hallmark/log.json` | 缺结构化记录 |

### 3.3 建议继承什么（按价值排序）

1. **宏结构词汇表（P0，最高价值）。** 我们把"设计系统"和"页面骨架"混在了一起——9 套
   systems 描述的是视觉调性，没有一个枚举出来的骨架词汇。这直接导致 taste #11 的
   anti-slop 规则**无法执行**：要求"布局骨架必须不同"，却没有骨架可选。建议在
   `templates/design/` 新增 `macrostructures/`，先取 hallmark 前十个（vague brief 时
   它自己也只从前十挑）落成 10 个文件，每文件约 30 行。这是骨架层面的结构描述，与
   `.dd`/Tailwind/OpenUI 全部无关，**跨栈可迁移**。
2. **把 taste #11 换成三轴可计算判据（P0，改动最小）。** 现在的"两个轴都要不同"是
   氛围规则；换成明度带 + 字型族 + 强调色相角之后，可以在 `.dd` front-matter 的
   `tokens` 上机器校验，甚至进 eval case。这是单条规则改写，收益/成本比最高。
3. **移动端与栅格门禁子集（P1）。** hallmark 门禁 50–57 是从一次真实响应式 bug hunt
   回填的，与 CSS 写法无关而是布局数学，例如"含图栅格轨道必须 `minmax(0, 1fr)` 而非
   `1fr`"、"全大写 display 标题 `line-height` 下限 1.0（推荐 1.02–1.08），否则换行时
   字冒碰撞"。这些是真 bug，值得逐条进 taste。**不要整包搬 58 条**：其中相当一部分
   （`transition-all`、中性色零 chroma、`:root` 外临时造 token）只对 `.dd`/HTML 路径
   有效，对 OpenUI 这种组件 DSL 无意义，硬塞会白烧 token。
4. **`audit` 动词（P1）。** "读目标 → 按 anti-pattern 打分 → 出排序清单 → **不改代码**"
   与本仓 `review.*` actions 的形态完全一致，可作为 review 的新维度 `design-audit`，
   复用 CRG 风险合成（`mergeReviewWithCrgRisk`）已经验证的组合模式。
5. **图章 + 轮换日志（P2）。** `.dd` 已有 YAML front-matter，天然适合放
   `genre/theme/axes/gate-results`；再加一个轮换日志，anti-slop 多样性就从"凭感觉"
   变成可验证。
6. **六层懒加载策略作为 `references/` 的加载分级约定（P2）。** 我们的 SkillRouter 在
   *技能* 粒度做向量召回，hallmark 在 *参考文件* 粒度用显式规则；book-distill 已经在用
   `references/` 结构，可以为每个 reference 声明加载层级。两者互补，不冲突。
7. **study 的拒绝清单与 provenance（P2，安全向）。** 我们的 dembrandt 提取能力强于
   hallmark（真 Chromium vs WebFetch），但 hallmark 有一层我们没有的策略：在 fetch 之前
   就按域名拒绝付费模板市场（themeforest / templatemonster / framer templates / webflow
   templates / gumroad / dribbble shots / behance gallery），并把"打包成可移植设计系统"
   的门槛设得比"出诊断报告"更高（需要用户声明来源归属）。dembrandt 的 SSRF 防线已在
   上一批提交落地，这里补的是**版权与伦理侧**的门。

### 3.4 冲突与处置（务必先读）

- **字体禁令与我们自己的模板直接冲突（已核实）。** hallmark 门禁 1 auto-fail 的字体
  清单是 Inter / Roboto / Open Sans / Poppins / Lato / 系统默认；而
  `deep-design/SKILL.md` 的 `.dd` 示例里 `fontDisplay` 和 `fontBody` **都写着
  `Inter, sans-serif`**。若要引入门禁 1，必须同时改我们的模板默认值，否则每次生成都会
  自己踩自己的红线。
- **不要盲目把 9 套 systems 扩到 21。** hallmark 的主题轮换之所以能跑，是因为每个主题
  都带 genre 归属 + 三轴声明；只加主题不加轴元数据，多样性规则就无法执行。正确顺序是
  先给现有 9 套补齐轴声明，再考虑扩容。
- **产物契约的 append-only 警告要采纳。** hallmark 明确写了静默重写全局样式表会删掉
  `@tailwind` 指令导致整个应用掉样式。我们的 tailwind 是 vendored 的，同样的坑同样存在。
- **上游有分支漂移，取用要挑对分支。** `master` 停留在 20 主题，`main` 才是 21（Grid
  是 2026-08-06 才加的第 21 个）；zread 默认给的是 `master`。另外
  `package.json` 的 `files: ["skills"]` **不包含** `site/css/tokens.css`，而 shipped
  skill 用相对路径引用它作为主题 token 的唯一权威源——即 `npx skills add` 装出来的副本
  链接是断的。要取 token 必须从 `main` 分支的 `site/css/tokens.css` 拿。
- 上游自身的一致性瑕疵（供采纳时避坑）：`slop-test.md` 标题写 58 而编号只到 57（靠
  `38a` 补齐）；Grid 主题有 token 却没有 `references/themes/grid.md`，且门禁 57 里
  硬编码的主题名单仍是 20 个不含 Grid。

## 4. motionsites.ai prompt 库 —— 动效词汇的补充对标

### 4.1 它是什么（核证事实）

- **不是代码库，是 65 条 prompt 的语料库。** 仓库全部内容 = `prompts/`（65 个
  `.md`，各 1.8–11.4 KB）+ `assets/videos/`（85 个 mp4，共 780 MB，仓库体积的大头）
  + `assets/images/`（8 张缩略图）+ README/LICENSE。无任何可执行代码，无 CI。
- 每条 prompt 是一份**精确到 px/毫秒的自然语言实现规格**，目标栈 React + Vite +
  Tailwind + TypeScript（重的加 Framer Motion `motion/react`、hls.js）。footer 统一
  标注 *"Generated by MotionSites Export Tool"*——即由 motionsites.ai 产品的导出工具
  机器生成，本质是"把一个已生成的动效网站逆向成规格书"。
- **规格质量分层明显。** 小的（`New_Era_Bold_Hero`，1.9 KB）就是常规视频背景 hero；
  大的（`Investor_Deck`，11.4 KB）是完整的演示文稿编排：5 slide 全部常驻挂载（HLS
  后台预载）、切换走 opacity 0.35s easeInOut + zIndex/pointerEvents 管理、键盘导航、
  `key={activationCount}` 重挂载以重触发动画而视频保持挂载——这是一个真实工程决策
  （动画重触发 vs 视频预载的矛盾）的解法，不是套话。
- **最有价值的部分是命名揭示模式词汇**（Investor_Deck 中成体系）：
  `SlideUpLine`（clip-reveal：overflow-hidden + y:100%→0%，0.7s）、
  `WordByWordReveal`（逐词 stagger 0.035s、duration 0.55s、词距 mr-[0.27em]）、
  `BlurReveal`（blur(8px)→0 + opacity，0.9s）；统一缓动
  `cubic-bezier(0.25, 0.1, 0.25, 1)`；延迟阶梯 0.05/0.1/0.15/0.3/0.4/0.6s。
  配 clamp 排版（`clamp(48px, 10vw, 140px)`、`leading-[0.9]`）与 % 栏距
  （`px-[5%] pt-[3.5%]`）。这套时值/缓动/命名模式就是"动效编排词汇表"。
- **provenance 已核证为付费画廊导出**：每条 frontmatter 自带 `License: Premium` 或
  `License: Free`（Investor_Deck、New_Era_Bold_Hero 均为 Premium）；视频引用
  `stream.mux.com`（他人付费 Mux 账号）与 `d8j0ntlcm91z4.cloudfront.net/user_…`
  （用户级生成产物桶）；README 自述视频是从 HLS m3u8 转码归档的。仓库虽挂 MIT，
  但那是转载者（Aayush Soam）的 license，**不能代表其重新发布的 Premium 内容的
  权利**。仓库形态也佐证：2026-04-04 创建、最后 push 2026-04-03、单次投放，
  91 fork > 72 star（病毒式 prompt 转储的典型比例）。

### 4.2 对本仓 designer 的价值与边界

价值：**动效纪律是 `taste` 六个规范段里最薄的一段**（Animation discipline 仅 6 行：
时长区间、缓动、hover 反馈、禁 layout thrash），而 `.dd` 生成恰恰以"静态页面 + 轻动效"
为主，模型缺一份可引用的动效模式词汇。上述揭示模式全部可以**翻译成纯 CSS**
（clip-reveal = overflow hidden + transform 关键帧；逐词 stagger = 每词 span +
animation-delay 阶梯；blur reveal = filter 关键帧），与 `.dd` 的自包含 HTML 契约兼容，
不需要 React/Framer。

边界（三条，都硬）：

1. **禁止 vendored prompt 或视频**（§4.1 provenance；与本仓 license 门禁立场冲突）。
   可行做法是以自己的语言写一份 `motion-patterns` 参考——时值、缓动、命名模式与
   编排思想不受版权保护，如同看片学类型惯例。
2. **这个语料本身带 AI 味，不能当 taste 权威。** 样本 prompt 里赫然写着
   `hover:scale-105` 与 `transition-all duration-300`——分别正是 hallmark 门禁 11
   （跨元素统一 hover 缩放）与门禁 10（`transition-all`）要拦的模式。它是
   "当前 AI 生成网站长什么样"的语料，用来**扩充动效词汇**，不用来**定纪律**；
   纪律权威仍是本仓 taste（必要时叠加 hallmark 门禁子集）。
3. **视频背景 hero 与 `.dd` 契约有张力**：自包含 HTML 可以内嵌
   `<video autoplay muted loop playsinline>`，但外部 URL 违反 .dd 无外部依赖的
   契约，本地质产又涉及资产管理——短期不纳入，只吸收渐变遮罩/z 轴分层/循环淡入
   淡出这些**不依赖视频资产**的编排手法。

### 4.3 建议动作

一项，并入 §5 落地表：为 taste（或 deep-design references）新增 `motion-patterns`
参考文件——8–12 个命名模式（clip-reveal / 逐词 stagger / blur-in / 延迟阶梯 /
数字滚动 / marquee / 滚动联动揭示），每个给纯 CSS 实现骨架 + 推荐时值/缓动 +
reduced-motion 回退。来源标注"灵感源自公开动效语料的通例模式，自行重述"。

---

## 5. 落地建议（按模块线分组，前三项最值得开工）

### 代码智能线（索引和知识的加强）

| # | 事项 | 目标模块 | 成本 | 依据 |
| --- | --- | --- | --- | --- |
| 1 | memory hybrid 分支接**固定角色多查询改写**（事件向 / HyDE / BM25 剥离式，各失败退回原 query） | memory（`auto-recall.ts` hybrid 分支） | 1 天 | §2.3-2；**RRF 复查确认已有**（`auto-recall.ts:655-677`，k=60 与 MemBrain 同值），真差距仅查询改写；token 预算打包降 P2 |
| 2 | 分析层 action 补 `status` 三态 per-call 入带（现仅有主动 `codegraph.status` 查询）；错误输出改分桶采样 | actions / review | 半天 | §1.3-1/2；降级非完全静默但模型不可见 |
| 3 | L1 抽取加输出校验器 + 源精度时间标记 | memory | 1 天 | §2.3-4/5 |

### designer 线（ui-designer 模板的模板和风格强化）

| # | 事项 | 目标模块 | 成本 | 依据 |
| --- | --- | --- | --- | --- |
| 4 | 新增 `templates/design/macrostructures/`（先 10 个）+ 把 taste #11 改写成三轴可计算判据 | design | 半天 | §3.3-1/2；当前 anti-slop 规则不可判定 |
| 5 | taste 补移动端/栅格门禁子集（源自真实 bug 的 8 条） | design | 半天 | §3.3-3 |
| 6 | `review.*` 增 `design-audit` 维度（hallmark audit 动词） | review | 1 天 | §3.3-4 |
| 7 | dembrandt 补版权拒绝清单 + DESIGN.md provenance 块 | design | 半天 | §3.3-7 |
| 8 | 新增 `motion-patterns` 参考文件（8–12 个命名动效模式，纯 CSS 骨架 + 时值/缓动 + reduced-motion 回退） | design（taste / deep-design references） | 半天 | §4.3；taste 动效纪律最薄，词汇可蒸馏且不引版权 |

**开工前必须先处理的一件事（designer 线）**：`deep-design/SKILL.md` 的 `.dd` 示例把
`fontDisplay` 和 `fontBody` 都设成 `Inter, sans-serif`——如果采纳 hallmark 的字体
禁令，这个默认值必须同时改掉，否则我们的模板会稳定违反自己的门禁（§3.4 第一条）。

**许可动作**：hallmark（MIT，纯 Markdown）可以 vendored 并在 NOTICE 署名，注意从
`main` 分支取且 token 在 `site/css/tokens.css`（不在 npm 包内）。CodeBrain（MIT）只
移植模式不引依赖，无需处理。**MemBrain 无 LICENSE，禁止拷贝代码**；若实现 MinHash/LSH
实体消解，从 Graphiti（Apache-2.0）直接取并在 NOTICE 正常署名。**motionsites.ai
prompt 库禁止 vendored prompt 与视频**（内容源自付费画廊导出，仓库 MIT 不能代表内容
权利），只做词汇级蒸馏并自行重述（§4.2-1）。

---

# §6 落地开发计划（2026-08-17 同日强化 — 本文 §5 的工程化展开）

> **执行状态（同日收尾）**：F0 + #1–#8 全部落地，分四个主题提交。一处复查修正：
> #1 原计划的第二变体 `keepContentWords`（BM25 剥离式）经代码走读发现与
> `buildFtsQuery` 内置的 jieba 分词 + ZH 停用词过滤**重叠**（`store/sqlite.ts:239`
> 已在查询侧做关键词剥离），撤销该变体，只保留真差距的**事件向**变体
> （`stripTimeExpressions`——停用词表全是功能词，时间词会原样漏进 FTS）。
> 与 §2.3-1 RRF 复查修正同款处置。

> 执行日与预研同日（封板期后追加批次，项目所有者指示）。§5 的 8 项建议在此细化为
> 落点文件 / 实现要点 / 验收标准 / 测试；全部走既有门禁（typecheck + eslint +
> prettier + license + 对应 workspace 测试）。
>
> **实施顺序**（依赖与风险排序）：前置 F0 → designer 线（#4 → #5 → #8）→ 代码
> 智能线（#1 → #2）→ design 动作线（#7 → #6）→ #3。分四个主题提交：
> ①审查+文档（F 线回写/本 §6/prettier 修复）②designer 模板线 ③memory 检索线
> ④design action 线。

## F0 前置（§3.4 第一条，必须最先）

- **落点**：`packages/core/templates/plugins/design/skills/deep-design/SKILL.md`
  `.dd` 示例 front-matter 的 `fontDisplay`/`fontBody`（现为 `Inter, sans-serif`，
  正是 hallmark 门禁 1 的 auto-fail 项）。
- **做法**：示例字体改为非禁令搭配（display 用衬线/几何无衬线栈、body 用系统栈），
  与所选 `dark-tech` 系统的字体叙事一致；同步扫 `templates/design/systems/*.md`
  内 Inter/Roboto/Open Sans/Poppins/Lato 出现处，有则一并替换。
- **验收**：`grep -ri "inter\|roboto\|open sans\|poppins\|lato" templates/…design/`
  零命中（注释性文字除外）。

## #4 宏结构词汇表 + taste #11 三轴化（§3.3-1/2，P0）

- **落点**：
  - 新目录 `packages/core/templates/design/macrostructures/`，10 个骨架文件
    （Bento Grid / Long Document / Manifesto / Type Specimen / Editorial Spread /
    Dashboard Cockpit / Product Gallery / Pricing Table / Documentation Hub /
    Landing Flow），每文件 ≈30 行：骨架指纹（标题落位/分隔语言/按钮口吻/图像处理/
    揭示方式）+ 适用场景 + 与视觉 token 无关的结构约束（跨栈可迁移）。
    **用自己的语言重述**（hallmark MIT 允许引用，但本仓选择重述以保持单一句径）。
  - `taste/SKILL.md` 第 11 条改写为三轴可计算判据：**纸面明度带**（bg 相对亮度
    L<30% dark / 30–85% mid / >85% light）、**display 字型族**（serif / geometric
    sans / humanist sans / grotesque / mono / slab 等 10 类枚举）、**强调色相角**
    （warm 10–60° / cool 200–300° / neutral / chromatic-other）——连续两次生成
    必须三轴至少一轴不同；判据落在 `.dd` front-matter tokens 上可机检（#6 消费）。
  - `deep-design/SKILL.md` Step 2 增加一句：页面骨架从 `templates/design/
    macrostructures/` 选取并在 front-matter 记 `macrostructure:`（与 §3.3-5 图章
    呼应，暂不建轮换日志——列入 #6 后续）。
- **验收**：10 文件齐；taste #11 引用三轴且给了合法/非法对照示例；macrostructure
  字段在 deep-design 文档中出现。

## #5 taste 移动端/栅格门禁子集（§3.3-3，P1）

- **落点**：`taste/SKILL.md` P0 清单续编 12–19（8 条，全部源自 hallmark 50–57 的
  布局数学，与 CSS 写法无关）：含图栅格轨道 `minmax(0,1fr)`、全大写 display
  line-height ≥1.0、触达目标 ≥44px、横向溢出守卫、sticky 元素高度预算、
  viewport meta、字号下限、flex 收缩溢出（`min-width:0`）。
- **验收**：8 条各带"正确答案是否定的"判据句式（与 hallmark 门禁同形，便于 #6
  机检扩展）；不动 OpenUI 路径无意义的条目（`transition-all` 等留给 taste 原有
  动效纪律段）。

## #8 motion-patterns 参考文件（§4.3，P1）

- **落点**：`taste/references/motion-patterns.md`（taste 首个 references/，沿用
  book-distill 已验证的 references 结构 + §3.3-6 加载分级：SKILL.md 内声明
  "仅在产出含动效的 .dd 时读取"）。
- **内容**：10 个命名模式（ClipReveal / WordStagger / BlurIn / DelayLadder /
    CountUp / Marquee / ScrollReveal / RiseFall / CrossFade / HoverLift），每个：
    纯 CSS 骨架（关键帧 + 类名）+ 推荐时值/缓动 + `prefers-reduced-motion` 回退。
    来源标注"灵感源自公开动效语料的通例模式，自行重述"；不引 motionsites.ai
    原文（§4.2-1 红线）。
- **验收**：taste SKILL.md 动效纪律段增加指向该文件的懒加载引用；模式骨架全部
  无 JS、无外部资产。

## #1 memory hybrid 多查询改写（§2.3-2，P0）

- **落点**：新文件 `packages/memory/src/tdai/core/hooks/query-variants.ts` +
  `auto-recall.ts` `searchHybrid`（SQLite 回退路径；TCVDB nativeHybrid 短路
  路径不动——服务端单查询契约，改它需要服务端 API 演进）。
- **实现**：recall 路径无 LLM，改写全部**确定性**（复查修正后单一事件向变体）：
  - `stripTimeExpressions(q)`（事件向）：剥离显式时间表达（ISO/中文日期、"昨天/
    上周/最近"等相对词、"3 days ago/两周前"偏移量）——时间锚定的问题主动丢掉
    时间维度；停用词表全为功能词，时间词原样漏进 FTS 会与无关记忆行匹配。
    ~~`keepContentWords(q)`（BM25 剥离式）~~ —— 撤销：`buildFtsQuery` 已内置
    jieba cutForSearch + ZH 停用词过滤（`store/sqlite.ts:239`），重复造轮子。
  - FTS 腿跑 原 query + 事件向变体（各自经 `buildFtsQuery`，无效即弃），多列表
    RRF（k=60，与现有同值）经 `fuseByRrf` 融合成一个 keyword 腿名次；embedding
    腿保持原 query（自然语言对嵌入最优，不多花 embed 调用）。变体失败/空 → 自然
    退回原查询，主链路零新增阻塞点。TCVDB nativeHybrid 短路路径不动（服务端单
    查询契约）。
- **测试**：`packages/memory/src/tests/query-variants.test.ts`——中文/英文剥离
  真值表、空结果回退、RRF 融合次序、无重复计数。

## #2 分析层 status 三态入带 + 分桶采样（§1.3-1/2，P0）

- **落点**：
  - 新 `packages/core/src/common/analysis-status.ts`：`type BackendStatus =
    "active" | "degraded" | "unavailable"` + `describeBackendStatus()`（人话
    说明 + 补救指引，如 "codegraph index missing — run codegraph.reindex"）。
  - 接线：`codegraph.reindex/list`、`crg.reindex/visualize`、`review.full`
    输出加 `status` 字段（list：active/degraded（未初始化）；reindex：
    成功=active、controller 缺=unavailable；review.full：综合 ocr 可用性与
    CRG graphBuilt）。arch-scan 已有 pending 结构，补 status 语义对齐。
  - 新 `packages/core/src/common/bucket-sample.ts`：按 key 分桶→桶按计数降序
    →前 5 桶 × 每桶前 5 条→保留 "…and N more of this type" 计数；纯函数。
    消费点：design.audit（#6）findings 聚合与 dembrandt tokensJson 截断的
    替代（保持既有 cap 不变，聚合场景用）。
- **测试**：core `src/tests/` 新增两套件（三态真值表 + 分桶采样 500→25+计数）。

## #7 dembrandt 版权拒绝清单 + provenance（§3.3-7，P1）

- **落点**：`packages/core/src/common/dembrandt.ts` + `actions/design.ts`。
- **实现**：
  - `validateDembrandtTargetUrl` 增第二道门：付费模板市场/画廊域名拒绝清单
    （themeforest.net、templatemonster.com、framer.com/marketplace、
    webflow.com/templates、gumroad.com、dribbble.com、behance.net 及其
    www 变体）——拒绝消息说明理由（版权/伦理）并指向"从品牌自有站点摄取"。
    与 SSRF 校验同层、先于一切 spawn。
  - `design.extract` 的 instruction 增 provenance 块要求：DESIGN.md 必须带
    `## Provenance`（来源 URL、抓取日期、工具=dembrandt@pinned、许可备注、
    "仅内部设计参考，勿原样复刻受版权保护的视觉资产"）。
- **测试**：`design-dembrandt.test.ts` 增拒绝清单矩阵（含 www/子域变体）+
  instruction 含 provenance 要求。

## #3 L1 抽取输出校验器 + 源精度时间（§2.3-4/5，P1）

- **落点**：`packages/memory/src/tdai/core/prompts/l1-extraction.ts` +
  `record/l1-extractor.ts`。
- **实现**：
  - prompt 增两条硬规则：①时间保真——保留源消息的时间精度（"2025年3月"不得
    写成"2025-03-01"），源里没有的时间不得编造，模糊表达（"最近/某天"）保持
    模糊；②原子性——一条记忆一个事实，复合句拆分。
  - 校验器（`parseExtractionResult` 后、写入前，全部确定性）：
    a. `source_message_ids` ⊆ 已知消息 id 集（未知引用重置为 []——MemBrain
       "冻结实体表外名字抛 ModelRetry" 的零 LLM 等价）；
    b. content 长度 1–500、非纯标点、批内去重（精确重复丢弃）；
    c. 软校验：content 中出现的完整日期未在源消息文本中出现 → logger.warn
       可观测不丢弃（召回安全优先，fabrication 先可见再谈强制）。
- **测试**：memory tests 增用例：未知 id 重置、超长/纯标点/重复过滤、
  fabricated 日期告警路径、prompt 规则在 SYSTEM_PROMPT 字符串中断言存在。

## #6 design.audit 维度（§3.3-4，P1）

- **落点**：新 `packages/core/src/actions/design-audit.ts`（注册
  `design.audit`，category design）+ registry 接线。
- **实现**：hallmark `audit` 动词的确定性零 LLM 等价——读 `.deeporca/designs/`
  下指定 `.dd`（或最新 N 个），front-matter 用既有依赖 `gray-matter` 解析：
  - 三轴多样性机检（#4 的判据落地）：与最近 3 个产物的明度带/字型族/强调色相
    逐一比对，三轴全同 → high finding；
  - taste 门禁子集机检：禁令字体（Inter/Roboto/Open Sans/Poppins/Lato）出现
    在 fontDisplay/fontBody → auto-fail；accent 无/多 accent；`.dd` HTML 体
    外链 `<img src="http…">`；`transition-all`；全大写无 line-height；
    `1fr` 含图轨道无 `minmax(0,` 前缀（#5 条目）；section markers 缺失。
  - 输出：`{ok, target, axes, findings[]}`，findings 按 severity 排序
    （auto-fail > high > medium > low），**不改代码**（audit-only，与 hallmark
    同契约）；>N 条走 #2 分桶采样。
- **测试**：core 新 `design-audit.test.ts`：三轴比对真值表、字体禁令、
  img/transition-all/1fr 检出、合法产物零 finding。

## 明确不做（本批）

- 不 vendor hallmark 整包 / 不建 `.hallmark/log.json` 轮换日志（#4 验收后下批议）；
- 不动 TCVDB nativeHybrid 服务端契约；不做 token 预算打包（§2.3-3 已降 P2）；
- 不做 MemBrain 任何代码拷贝（许可红线）；不做 motionsites.ai prompt 引用；
- 不扩 9 套 systems 到 21（§3.4 第二条：先轴元数据后扩容——轴元数据由 #4/#6
  打底，扩容留待真实使用反馈）。
