# 预研：llm_wiki —— 自构建知识库对 deepOrca 知识栈的启发与增强

日期：2026-08-19 · 分支：`fix/test-baseline-ui-feedback` · 性质：预研（无代码变更）

## 命题映射

| 模块线 | 仓库 | 在本线中的角色 |
| --- | --- | --- |
| 知识库（索引和知识的加强） | nashsu/llm_wiki | 编译型个人知识库对标（结论：方法论与本仓缺口高度对位，模式可系统性借鉴；**GPL-3.0 禁止任何代码继承**） |

调研材料：`README_CN.md` 全文、`llm-wiki.md`（Karpathy 原始方法论，随仓库分发）、`LICENSE`
本体、仓库目录结构（zread 一手核证）；本仓侧依据代码走读（memory 管线 / OpenWiki /
knowledge 面板 / IPC 契约），关键结论均落到了 file:line。

## TL;DR

| 项目 | 本质 | 成熟度 / 许可 | 建议继承方式 | 集成深度 | 与现有冲突 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| nashsu/llm_wiki | Karpathy "编译型 Wiki" 方法论的完整桌面实现：LLM 读原始资料 → 增量构建互链 Markdown Wiki → 持续维护 | 中高：Tauri v2 + Rust 后端 + React 19，活跃开发，多语言 README，**GPL-3.0（LICENSE 本体核证，版权人 Yong Su）** | 只借鉴方法论与工程模式，**净室自研实现**；短期可经其 MCP Server 做 L1 外挂对接 | **L0/L1 + L3 净室模式移植（禁代码）** | 技术栈完全错位（Tauri/Rust vs Electron/TS）；许可传染 | **方向性对标**：它验证了本仓知识栈最大的空白 —— "用户资料 → 结构化互链知识"的编译层；摄入/检索/维护三段模式全部可移植 |

集成深度定义（沿用 2026-08-17 prestudy）：L0 = 知识/提示词层；L1 = 用户可选外挂；
L2 = 内置 builtin；L3 = 源码级继承（移植模式或引纯函数库）。

**许可红线（最重要的单条结论）**：llm_wiki 的 LICENSE 文件为完整的 **GNU GPL
v3.0**（`LLM Wiki — Copyright (C) 2024-2026 Yong Su`），与 README 声明一致。GPL
传染性意味着**不能 vendor、不能拷贝任何源码（含 mcp-server/、extension/）**，否则
整个 desktop 客户端面临 GPL 义务。所幸其技术栈（Tauri/Rust）本就不可复用，损失为零。
方法论与算法思想（两步摄入、四信号关联度、预算分配比例等）不受版权保护，净室实现
合法。另外 Karpathy 的 `llm-wiki.md` gist **无明确许可**——借鉴其思想、但 schema/
提示词文本须自研表述，不逐字拷贝。与本仓既有立场一致（依赖树 license 合规门禁）。

---

# Part I llm_wiki 是什么

## 1.1 方法论源头：Karpathy 的"编译型知识库"

核心论点直指 RAG 的结构性缺陷：**RAG 每次查询都从原始文档重新检索、重新推导知识，
没有积累**；要回答一个需要综合五份文档的问题，LLM 每次都得重新拼装。llm_wiki 的做法
是让 LLM **增量构建并维护一个持久的 Wiki**——知识"编译一次、持续更新"，而非每次
查询重新推导。Wiki 是**复利型资产**：交叉引用已建好、矛盾已标记、综述已反映全部已读
材料。人类负责 sourcing、提问、策展；LLM 负责全部簿记（总结、交叉引用、归档、一致性
维护）——"人类放弃 Wiki 是因为维护成本增长快于价值，而 LLM 不会无聊"。

三层架构 + 三个操作：

| 层/操作 | 内容 | 备注 |
| --- | --- | --- |
| 原始资料层 | 用户投喂的文档，**不可变**，LLM 只读 | 事实之源 |
| Wiki 层 | LLM 生成维护的互链 Markdown 页（摘要页/实体页/概念页/综述） | LLM 独占写权 |
| Schema 层 | 规则文档（页面类型、约定、工作流），人机共演化 | "让 LLM 成为有纪律的维护者而非聊天机器人"的关键 |
| **Ingest** | 读资料 → 写摘要页 → 更新实体/概念页 → 更新 index → 追加 log | 一份资料可触及 10–15 页 |
| **Query** | 先读 index 找页 → 读页 → 带引用综合作答；**好答案回填 Wiki** | 探索同样复利 |
| **Lint** | 定期健康检查：矛盾、被新资料取代的过时断言、孤儿页、缺页、缺交叉引用、可网搜补的数据空白 | 维护 Wiki 健康度 |

两个特殊文件：`index.md`（内容目录，LLM 查询时的第一导航入口——Karpathy 注明在
~100 份资料 / 数百页规模下**不需要 embedding 基建**即可工作）和 `log.md`（可解析的
时序操作记录，`## [日期] 操作 | 标题` 前缀使其可被 grep/tail 直接消费）。

## 1.2 工程实现盘点（README 核证的 19 组增强）

llm_wiki 在方法论之上补齐的产品工程，按与本仓相关度分组：

**摄入侧**
- **两步思维链摄入**：第一步 LLM 只做分析（实体/概念/论点、与现有 Wiki 的关联与
  矛盾、结构建议），第二步基于分析生成 Wiki 文件——相比单步"边读边写"显著提质。
- **SHA256 增量缓存**：摄入前比对源文件内容哈希，未变更自动跳过（省 token）。
- **持久化串行队列**：串行防并发 LLM 调用、队列落盘、崩溃恢复、失败重试 ≤3、
  进度可视化、可取消。
- **来源可追溯**：每个 Wiki 页 frontmatter 带 `sources: []` 回链贡献的原始资料。
- **保证摘要页兜底**：即使 LLM 遗漏也强制生成资料摘要页；`overview.md` 每次摄入后
  自动重生成；文件夹导入把路径作为分类上下文；`raw/sources/` 外部变更自动监听。
- **多格式解析**：PDF（内置 + 可选 MinerU 云/本地）、DOCX/PPTX/XLSX（Rust 库）、
  EPUB/MOBI、图片（视觉模型生成事实描述）、网页剪藏（Readability + Turndown）。

**检索侧**
- **四阶段管线**：① 分词搜索（中文 CJK 二元组，标题加分，同时搜 wiki 和 raw）→
  ② 可选向量检索（LanceDB，结果"增强已有匹配 + 补充新发现"两路合并）→
  ③ 图谱扩展（搜索结果作种子，四信号关联度 2 跳带衰减）→ ④ 预算控制 + 编号引用
  上下文组装。
- **四信号关联度模型**：直接链接 ×3.0、来源重叠（共享 sources[]）×4.0、
  Adamic-Adar ×1.5、类型亲和 ×1.0。
- **上下文预算比例分配**：4K–1M token 滑块，按 60%（Wiki 页）/ 20%（聊天历史）/
  5%（索引）/ 15%（系统提示）分配。
- 基准数据点：开启向量检索后整体召回率 58.2% → 71.4%。

**图谱与洞察**
- sigma.js 可视化 + **Louvain 社区检测**（自动聚类，内聚度 = 社区内实际边/可能边，
  <0.15 警告）。
- **图谱洞察**：惊奇连接（跨社区边等，复合惊奇度排序，可消除）；知识空白 = 孤立页
  （度 ≤1）+ 稀疏社区 + 桥接节点（连 3+ 集群）→ 一键触发 Deep Research。

**人机协作与生态**
- **purpose.md**：定义这个 Wiki"为什么存在"（目标、关键问题、研究范围、演进论点），
  每次摄入和查询都注入；LLM 可按使用模式建议更新。与 schema（结构规则）正交。
- **异步审核队列**：LLM 摄入时标记需人工判断项，**预定义操作**（建页/深研/跳过）
  + 预生成搜索查询，用户方便时处理、不阻塞摄入。
- **Deep Research**：从图谱洞察触发时 LLM 读 overview + purpose 生成领域精准研究
  主题（可编辑确认）→ 多查询网搜（Tavily/SerpApi/SearXNG）→ 综合成 Wiki 研究页 →
  **自动进入两步摄入**。
- **查询回填**：有价值的回答归档到 `wiki/queries/` 再自动摄入提取实体/概念。
- **本地 HTTP API（127.0.0.1:19828，Token 鉴权）+ MCP Server + agent skill
  三件套**：外部 Agent（Claude Code/Codex）可直接 hybrid 检索、读文件、遍历图谱、
  触发重扫；`npx skills add` 一行接入。
- **级联删除**：删资料时三重匹配找关联页；共享实体只从其 `sources[]` 移除该资料而
  非删页；同步清理 index 与失效 wikilink。

---

# Part II 对照本仓知识栈现状

本仓 `knowledge:status` 六源（codegraph / openwiki / serena / agents / memory /
routing）与 llm_wiki 的能力对位：

| 能力维度 | llm_wiki | 本仓现状 | 差距判断 |
| --- | --- | --- | --- |
| 对话→记忆 | —（聊天历史仅作上下文） | **强**：L0–L3 管线（TDAI fork），L1 原子事实/persona，调度器异步抽取 | 本仓领先 |
| 资料→知识 | **核心**：两步摄入编译成互链 Wiki | **空白**：无"用户导入文档 → 结构化知识条目"路径；`book-distill` 技能产出的是 Agent Skill 不是知识条目 | **最大缺口，也是本次预研的主题** |
| 代码→文档 | — | **强**：OpenWiki（OKF 格式）+ 编辑后自动增量同步（`wikiDirtySessions` → `maybeSyncWikiIndex`） | 本仓已有"编译型"子系统，但只对代码生效 |
| 混合检索 | 分词 + 向量 + 图扩展 | **部分**：FTS5 BM25（zh）+ sqlite-vec 余弦 + RRF 融合 + 查询变体（`hooks/query-variants.ts`）；**无图扩展阶段** | 差一个"结果→图邻居"阶段 |
| 知识互链/溯源 | [[wikilink]] + frontmatter `sources[]` | L1 record 已有 `source_message_ids` / `scene_name`（溯源思想雏形），但无页间互链 | 模式同构，扩展自然 |
| 上下文预算 | 4K–1M 滑块 + 60/20/5/15 比例 | recall 的 `prependContext` 无 token 预算；compaction 是被动阈值触发 | 缺预算化装配 |
| 人审 | 异步审核队列（预定义操作 + 预生成查询） | `AskUserQuestion` 仅阻塞式、会话内 | 缺跨会话异步审核 |
| 健康检查 | Lint 操作（矛盾/孤儿/缺页） | 无对应物 | 空白 |
| 研究闭环 | 洞察 → Deep Research → 自动摄入 | 有 WebSearch/WebFetch 内置工具，**但无知识空白检测触发** | 闭环缺前半段；后半段本仓原生 |
| 对外暴露 | HTTP API + MCP Server + skill | 本仓是 MCP **client** 强者，无反向暴露 | 空白（差异化机会） |

本仓已有的可复用地基（做同样事情的边际成本远低于从零）：

- **`WikiController` seam**（`packages/core/src/actions/wiki-controller.ts:19-26`：
  `init(root, onProgress)` / `update` / `isAvailable` + 单例注入）——接口就是为可替换
  实现设计的，加第二种 controller 类型（doc-wiki）不用动 core 架构。
- **`wiki.*` actions**（init/update/list-pages/read-page，frontmatter 解析已有）与
  `index.build-all` 三阶段编排（`packages/core/src/actions/index-build.ts`）。
- **embedding 共享包**（Granite 97M/384 维，`@deeporca/embedding`，routing 与 memory
  各自持有实例）+ memory 侧 sqlite-vec/FTS5 存储抽象（`IMemoryStore`）。
- **LLM runner 与调度基建**：`DeepOrcaHostAdapter` 的 LLM 工厂 +
  `MemoryPipelineManager` 的计数/空闲/互斥调度语义（串行、可提前、防并发）——llm_wiki
  的"持久化串行摄入队列"所需语义大半已在。
- **知识面板 UI**（`IndexLibraryPanel.tsx` 六源卡片 + build-all + memory 搜索）与
  `KnowledgeStatusResponse` 聚合协议——加第七源卡是纯增量。
- **WebSearch/WebFetch（含 offscreen Chromium 渲染抓取）**——Deep Research 闭环与
  网页剪藏的技术前提本仓原生具备。

---

# Part III 启发与增强点（按优先级）

## P0-1 编译型知识层（doc-wiki）：补齐"资料 → 互链知识"的写入路径

**这是本次预研的核心结论。** 本仓知识栈六源里没有任何一源消费"用户的资料"（PDF/
DOCX/MD/网页）；memory 只吃对话，OpenWiki 只吃代码。llm_wiki 证明了这条路径的完整
形态，且其每一环都能映射到本仓现成 seam：

| llm_wiki 环节 | 本仓落地方式 |
| --- | --- |
| 三层布局（raw 不可变 / wiki LLM 写 / schema 规则） | `.deeporca/kb/{raw-sources, wiki}/`，项目隔离对齐 memory 的 `getUserConfigRoot()/memory/<projectCode>` 惯例 |
| 两步思维链摄入（分析→生成） | 两次 LLM 调用走 `DeepOrcaHostAdapter` 的 LLM 工厂（flash 级模型即可，摄入是后台任务）；提示词自研，**不拷贝 GPL 文本** |
| SHA256 增量缓存 | 源文件哈希存 `.deeporca/kb/.metadata/`，未变更跳过 |
| 持久化串行队列（崩溃恢复/重试） | 复用 `MemoryPipelineManager` 的调度语义 + 队列状态落盘 |
| sources[] 溯源 + 级联删除 | frontmatter `sources: []`（可在 OKF frontmatter 上扩展字段，与 OpenWiki 页面格式统一）；删除走三重匹配 + 共享实体保护 |
| index.md / log.md | 照搬约定（含 `## [日期] 操作 | 标题` 可解析前缀）；Obsidian 兼容 = 免费的人工浏览面 |
| UI 暴露 | `knowledge:status` 第七源卡 + `index.build-all` 追加一个阶段；`wiki.list-pages/read-page` 泛化为两种 controller 共用 |

风险：两步摄入使 LLM 调用 ×2（SHA256 缓存 + flash 模型可压成本）；wiki 页面的
Agent 消费入口需要设计（对齐 OpenWiki 的"读 wiki 省 token"逻辑——资料编译层的目的
同样是让 agent 优先读编译产物）。

## P0-2 检索管线补"图扩展"阶段

本仓 recall 已有 BM25 + 向量 + RRF + 查询变体，恰好缺 llm_wiki 管线的第③阶段：以
检索结果为种子做**图邻居扩展**。对 doc-wiki 而言边是现成的（`[[wikilink]]` +
`sources[]` 重叠），甚至可以先做两信号简化版（直接链接 + 来源重叠，即权重最大的
3.0/4.0 两项），Adamic-Adar 与类型亲和后置。llm_wiki 的 58.2%→71.4% 召回数据点同时
支持"默认开启向量"的既有方向。落地位置：`hooks/auto-recall.ts` 的
`performAutoRecall` 之后、`RecallResult` 组装之前，作为可选增强阶段。

## P0-3 purpose.md：知识库的"为什么"

一行配置级的增强：`.deeporca/` 下增加知识意图文件（目标、关键问题、范围、演进中的
论点），在 recall 时经 `MemoryProvider.appendSystemContext` 注入、在摄入时作为第二步
生成的上下文。本仓 AGENTS.md 回答"如何行为"，purpose 回答"这个项目的知识为何存在
/哪些问题重要"——两者正交，注入成本极低，对召回相关性与摄入取舍都有直接收益。

## P1-4 查询回填：探索复利

"好答案不应消失在聊天历史里"。本仓每轮 turn 结束已有 `maybeCaptureMemory` 钩子
（fire-and-forget），可平行增加一条轻路径：把高价值回答（用户显式保存或 LLM 自判）
归档为 `wiki/queries/` 页面并走摄入提取实体/概念。与 L1 原子事实记忆互补：L1 是
碎片，回填页是结构化综述。

## P1-5 异步审核队列

本仓 `AskUserQuestion` 是阻塞式、会话内的；记忆/摄入管线全自动、无人审入口。
llm_wiki 的模式更优：**LLM 在后台处理时标记需人工判断项，附带预定义操作（建页/
深研/跳过）和预生成的搜索查询，用户方便时处理，完全不阻塞管线**。落地为审核队列
存储 + 知识面板一个 tab；L1 抽取的"向量冲突去重"命中的矛盾项正是天然候选。

## P1-6 知识空白检测 + Deep Research 闭环

孤立页（度 ≤1）、稀疏社区（内聚 <0.15）、桥接节点（连 3+ 集群）→ LLM 读
overview + purpose 生成研究主题（可编辑确认）→ 网搜 → 结果自动摄入。llm_wiki 需要
外接 Tavily/SerpApi/SearXNG，**本仓 WebSearch/WebFetch 原生内置，闭环后半段成本
为零**——这是本仓做同样功能反而更顺的地方。

## P1-7 Lint 操作

矛盾、过时断言、孤儿页、缺页、缺交叉引用。**零基建起步**：先做成一个 skill（LLM
驱动，读 wiki 目录产出报告），验证有价值后再固化为 `wiki.lint` action。与本仓
skills 体系（三个内置技能 + knowledge 插件技能）完全同构。

## P2-8 反向 MCP Server（生态位差异）

llm_wiki 用"HTTP API + MCP Server + agent skill 三件套"证明了需求：**外部 agent 想
查你的知识库**。本仓是 MCP client 强者（`McpManager`/`McpClient` 全套），把
memory+wiki 的 hybrid 检索反向暴露为 MCP server，等于把本仓积累的项目知识变成团队
级资产（Claude Code/Codex 直接查）。短期还有一条零成本路径：**用户自装 llm_wiki，
把它注册为本仓 MCP server**——本仓 MCP 配置直接支持，配套一个内置 skill 教 agent
用它的检索工具即可（进程间协议交互，无许可问题）。

## P2-9 上下文预算比例分配

`getMemoryPrompt` 装配 recall 上下文时按比例预算（Wiki 页/会话历史/索引/系统提示）
而非无上限拼接；比例可配置。与既有 compaction（被动阈值）互补，主动控制注入量。

## P2-10 级联删除 + 共享实体保护

本仓 `clearProjectMemory` 是核弹式清除。doc-wiki 落地后按 llm_wiki 的三重匹配 +
`sources[]` 移除（而非删共享页）+ index/wikilink 清理来做源级删除。

## P2-11 多格式摄入与网页剪藏

PDF/DOCX/EPUB 解析 + 网页剪藏是 doc-wiki 的输入面扩展。剪藏技术上本仓已通
（offscreen Chromium provider 即 Readability 的替代），优先级随 doc-wiki 需求排。

---

# Part IV 分阶段路线图（建议）

| 阶段 | 内容 | 依托 | 量级 |
| --- | --- | --- | --- |
| Phase 0 零基建 | ① `wiki-lint` skill（先服务 OpenWiki 页）② purpose 文件注入 recall ③ recall 预算控制 | skills 体系 / `MemoryProvider` 现成接口 | 小（各 1–2 天） |
| Phase 1 编译层 MVP | doc-wiki：两步摄入 + SHA256 缓存 + 串行队列 + sources[] + index/log + 第七源卡 | `WikiController` seam / `wiki.*` actions / 调度器 | 中（独立 feature 分支） |
| Phase 2 图与闭环 | wikilink 图构建 + 图扩展检索阶段（两信号起步）+ 空白检测 + Deep Research 闭环 + 审核队列 | recall 管线 / WebSearch | 中大 |
| Phase 3 生态 | 反向 MCP Server 暴露 memory+wiki；剪藏/多格式摄入扩面 | `McpManager` 经验 / offscreen provider | 大 |

## 不借鉴项

- **一切代码**（GPL-3.0 + Rust/Tauri 栈双重不可行）。
- 桌面壳层（三栏布局/托盘/i18n/Milkdown 编辑器/Chrome 扩展本体）——本仓渲染与桌面
  栈已有等价物。
- LanceDB 引入——本仓 sqlite-vec 已是既定路线，不引入第二个向量库。

## 结论

llm_wiki 对本仓的价值不在代码（拿不到）也不在产品形态（重叠有限），而在**验证了
知识栈的缺口与补法**：本仓已经很好地回答了"对话如何变成记忆"和"代码如何变成文档"，
唯独没有回答"**资料如何变成知识**"。Karpathy 方法论的"编译一次、持续维护、探索
回填"三原则，配上本仓现成的 controller seam、调度器、混合检索与内置网搜，做一个
净室的 doc-wiki 编译层是当前知识模块性价比最高的增强方向。
