# MemOS（Memory Operating System）技术预研报告

> 日期：2026-08-04
> 研究员：AI 记忆系统预研
> 资源：论文 [arXiv:2507.03724](https://arxiv.org/abs/2507.03724)（注：用户提供的 `2607.16621` 链接失效，实际论文为 2507.03724，另有短版 2505.22101）· 仓库 [MemTensor/MemOS](https://github.com/MemTensor/MemOS)（Apache 2.0）
> 关联模块：deepOrca `activity-frames`（行为记忆，`specs/archive/activity-frames/design.md`）

---

## 1. MemOS 是什么

### 一句话定位

MemOS 是一个**面向 LLM 与 AI Agent 的记忆操作系统**，把「记忆」从提示词策略 / RAG 插件提升为与算力、存储并列的**一级系统资源**，提供统一的「写入—检索—整合—遗忘」全生命周期管理。

由记忆张量（上海）科技联合上海交通大学、中国人民大学、同济大学、浙江大学等十多家机构于 2025-07-07 开源。截至 2026-05 已迭代至 **v2.0 "Stardust（星尘）"**，GitHub star 超 1.2 万（2026-05 媒体口径），部署超 8 万次，被 3000+ 企业用于 Agent 与个性化 AI 开发。

### 解决什么问题

当前 LLM 记忆依赖两类**短期记忆**，存在结构性缺陷：

| 痛点 | 原因 | 后果 |
|------|------|------|
| 上下文窗口瓶颈 | 即使 200 万 token 也装不下跨天/跨周历史 | 长程信息被截断 |
| 时序信息丢失 | 注意力机制对长距离时序脆弱 | 「张冠李戴」，记不住事件先后 |
| 跨任务记忆断裂 | 会话/任务之间记忆不互通 | 每次从零开始，无法积累经验 |
| 记忆不可控 | 无法编辑/删除/修正错误记忆 | 只能靠 prompt 覆盖，幻觉累积 |
| 安全隐私风险 | 全部存云端 | 数据泄露与滥用 |

传统 RAG 被其定位为「临时补丁」——只能被动检索外部文档，无法主动更新、演化、推理。MemOS 的核心主张是：**像 OS 管理磁盘一样管理记忆**——自动存取、版本控制、冷热分层、并发安全、统一调度。

---

## 2. 核心架构

### 2.1 记忆分层模型（Memory³）

MemOS 的分层有两个维度：**按物理形态分三层（Memory³）**，**按生命周期分三类**。

#### 维度一：Memory³ 三态（物理形态）

所有记忆被统一抽象为 **MemCube（记忆立方体）**，内部容纳三种可相互转换的形态：

```
        ┌─────────────────────────────────────────┐
        │              MemCube                     │
        │  ┌───────────┬───────────┬───────────┐  │
        │  │ plaintext │activation │parametric │  │
        │  │ 明文记忆   │ 激活记忆   │ 参数记忆   │  │
        │  └───────────┴───────────┴───────────┘  │
        └─────────────────────────────────────────┘
```

| 层 | 存什么 | 怎么存 | 容量 | 访问速度 | 典型载体 |
|----|--------|--------|------|----------|----------|
| **明文记忆 plaintext** | 原始文本、图像、音频、工具调用轨迹、对话原文 | 图数据库（Neo4j）+ 向量库（Qdrant/Milvus）+ KV（Redis） | 无限 | 慢 | 结构化树/图、可追溯 |
| **激活记忆 activation** | 模型推理中间状态（KV cache） | KV store（Redis / vLLM KV） | 小 | 最快 | 会话级热数据 |
| **参数记忆 parametric** | 从经验提炼的知识与技能 | LoRA / adapter 权重 | 中 | 高（一次学习终身使用） | 可迁移的技能 |

关键设计：三者可**按使用频率与重要性自动转换**——频繁访问的明文会被沉淀为激活记忆，稳定重要的模式会被蒸馏成参数记忆。

代码层印证：`BaseMemCube` 抽象基类定义了 4 个记忆槽位：
```python
class BaseMemCube(ABC):
    self.text_mem: BaseTextMemory      # 明文/文本
    self.act_mem: BaseActMemory        # 激活 (KV cache)
    self.para_mem: BaseParaMemory      # 参数 (LoRA)
    self.pref_mem: BaseTextMemory      # 偏好（独立子类型）
```

#### 维度二：按生命周期分三类（针对树形明文记忆 TreeTextMemory）

每个记忆节点 `TextualMemoryItem` 的 `metadata.memory_type` 字段：

- **WorkingMemory（工作记忆）**：当前会话上下文，常驻、可整体替换（`replace_working_memory()`），类比 RAM。
- **LongTermMemory（长时记忆）**：沉淀归档的事实/事件，类比磁盘。
- **UserMemory（用户记忆）**：用户偏好与画像，跨会话持久。

节点状态机：`status ∈ {activated, archived, deleted}`；可见性：`visibility ∈ {private, public, session}`。

> 注：MemOS 论文/文档的「三态」是物理形态（明文/激活/参数），而认知科学意义上的 procedural/episodic/semantic 分层并未作为顶层抽象——程序性记忆大致落在 parametric + skill memory（`mem_reader/read_skill_memory`），情景记忆落在带时间戳的 TreeTextMemory 节点，语义记忆落在偏好/事实抽取（`prefer_text_memory`）。

### 2.2 记忆操作原语（生命周期）

MemOS 把记忆的生命周期拆成**可编排的异步任务**，由 MemScheduler 调度。两层原语：

#### 层一：TreeTextMemory 的 CRUD 原语（数据层）

| 原语 | 方法 | 说明 |
|------|------|------|
| 写入 | `add(memories)` | 由 MemReader 抽取的结构化 `TextualMemoryItem` 入图，自动生成 embedding 与边 |
| 检索 | `search(query, top_k)` | **向量相似度 + 图遍历**混合检索，先向量命中再图跳数展开多跳 |
| 读取 | `get(id)` / `get_by_ids` / `get_all()` | 单条/批量/全图导出 |
| 更新 | `update(memory_id, new)` | 原地更新节点内容与元数据 |
| 删除 | `delete(ids)` / `delete_all()` | 软/硬删除 |
| 整合 | `replace_working_memory()` | 整体替换工作记忆区 |
| 备份/恢复 | `dump(dir)` / `load(dir)` / `drop(keep_last_n)` | 图序列化为 JSON，滚动备份 |

#### 层二：MemScheduler 的事件原语（编排层）

调度器通过带 `label` 的消息驱动，核心任务类型：

| Label | 含义 | 作用 |
|-------|------|------|
| `add` | 新记忆添加 | 写入并记录日志 |
| `query` | 用户查询 | 意图识别 → 触发检索 |
| `mem_update` | **记忆更新（核心）** | 提取关键词 → 检索相关记忆 → 替换工作记忆 |
| `mem_organize` | **记忆整合/合并** | 触发 merge、重组图结构 |
| `mem_read` | 深度导入 | 用 MemReader 解析文档/网页/多模态为记忆节点 |
| `pref_add` | 偏好抽取 | 提取用户偏好记忆 |
| `mem_feedback` | **反馈修正** | 自然语言反馈 → 修正/强化记忆 |
| `answer` | 回复记录 | 记录 AI 回复对话日志 |

统一消息结构 `ScheduleMessageItem` 字段：`item_id / user_id / mem_cube_id / label / content / session_id / trace_id / task_id / info`，支持全链路 trace。

**遗忘机制**：时序感知的混合检索 + 自定义**时间衰减函数**模拟「遗忘曲线」，近期事件优先，历史淡化；配合 `status` 字段归档。

### 2.3 系统架构（数据流）

```
                ┌─────────────────────────────────────────────┐
                │                  用户 / Agent / MCP 客户端    │
                └───────────────┬─────────────────────────────┘
                                │ REST API / MCP / Python SDK
                                ▼
   ┌────────────────────────────────────────────────────────────┐
   │                     API Layer (FastAPI)                     │
   │   routers/handlers/middleware  ·  memos.cli · mcp_serve     │
   └───────────────┬──────────────────────────┬─────────────────┘
                   │                          │
        ┌──────────▼──────────┐    ┌──────────▼──────────┐
        │     MemReader        │    │     MemScheduler    │  ← 异步事件驱动
        │  (抽取/分块/解析)     │    │  (路由/队列/调度)    │     Redis Stream
        │  chat/doc/web/多模态  │    │  query/update/      │     / Local Queue
        └──────────┬──────────┘    │  organize/feedback  │
                   │ Structured     └──────────┬──────────┘
                   │ Items                     │ 任务编排
                   ▼                           │
   ┌───────────────────────────────────────────▼──────────────┐
   │                       MemCube (记忆容器)                    │
   │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────┐ │
   │  │  TextMem    │ │  ActMem     │ │  ParaMem    │ │PrefM │ │
   │  │ TreeText    │ │ KV cache    │ │ LoRA        │ │ 偏好  │ │
   │  │ (Neo4j 图)  │ │ (Redis)     │ │ (weights)   │ │(Milvus)│
   │  └─────────────┘ └─────────────┘ └─────────────┘ └──────┘ │
   └────────────────────────────┬──────────────────────────────┘
                                │
   ┌────────────────────────────▼──────────────────────────────┐
   │              存储后端 (Storage Adapters)                    │
   │  向量库: Qdrant / Milvus    图库: Neo4j / PolarDB / Postgres│
   │  KV:     Redis             关系: MySQL (SQLAlchemy)         │
   └────────────────────────────────────────────────────────────┘
```

**端到端数据流**：
1. **写入**：用户消息 → MemReader 用 LLM 抽取结构化 `TextualMemoryItem`（带 entities/tags/embedding/source/confidence）→ `tree_memory.add()` 入 Neo4j 图 + 生成向量 → MemScheduler 异步触发 `mem_update` 更新工作记忆。
2. **检索**：`query` → MemScheduler 路由 → 向量相似度召回 top-k 节点 → 图遍历扩展多跳邻居 → 混合排序 → 注入工作记忆 → LLM 生成。
3. **整合/遗忘**：后台 `mem_organize` 任务合并相似节点、`mem_feedback` 按自然语言修正、时间衰减函数淡化旧记忆、高频明文沉淀为激活/参数记忆。

---

## 3. 技术实现

### 3.1 语言 / 框架 / 依赖

- **语言**：Python（`>=3.10,<4.0`），Poetry 管理；Python 包名 `MemoryOS`（PyPI），当前 **v2.0.23**。
- **核心依赖**（来自 `pyproject.toml`）：
  - Web/API：`fastapi[all]`、`fastmcp`（MCP 协议）、`uvicorn`
  - LLM：`openai`、`ollama`、`transformers`（HuggingFace/vLLM 集成）
  - 编排：`redis` + `pika`（RabbitMQ，MemScheduler 队列）
  - 检索：`scikit-learn`、`rank-bm25`、`jieba`、`sentence-transformers`
  - 工程：`sqlalchemy` + `pymysql`、`tenacity`（重试）、`prometheus-client`（监控）
- **构建/质量**：Poetry、Ruff（lint）、Pytest（async）、pre-commit。

### 3.2 核心模块（`src/memos/`）

| 模块 | 职责 | 备注 |
|------|------|------|
| `mem_os/` | 顶层编排入口（`core.py`/`main.py`），MOS = Memory-augmented OS | 即插即用 |
| `mem_cube/` | 统一记忆容器（4 槽位 text/act/para/pref） | `general.py` 标准实现 |
| `memories/` | 三态记忆实现：`textual/`(tree/preference) `activation/`(kv/vllmkv) `parametric/`(lora) | 工厂模式 |
| `mem_reader/` | 抽取层：`simple_struct` / `multi_modal_struct` / `read_pref_memory` / `read_skill_memory` | 文本/图/URL/文件→结构化 |
| `mem_scheduler/` | 异步调度核心：`general_scheduler` / `optimized_scheduler`，含 analyzer/monitors/orm/schemas | 生产关键路径 |
| `mem_agent/` | `deepsearch_agent` 记忆增强搜索 agent | |
| `mem_feedback/` | 自然语言反馈修正记忆 | 可审计 |
| `graph_dbs/` | 图库适配：Neo4j / PolarDB / Postgres / Nebula(社区) | 可插拔 |
| `vec_dbs/` | 向量库适配：Qdrant / Milvus | 可插拔 |
| `chunkers/` `parsers/` `embedders/` `reranker/` | 文本切分 / 多格式解析(markitdown) / 嵌入 / 重排 | factory 模式 |
| `plugins/` + `dream/` | 插件系统 + 「DREAM」记忆巩固/离线整理（社区插件入口） | 后台 consolidation |
| `api/` | REST server + MCP serve（`mcp_serve.py`） | 标准化 I/O |

### 3.3 API 设计

**三种接入形态**：
1. **Cloud API**（托管）：`POST /add/message`、`POST /search/memory`，Token 鉴权。
2. **Self-host REST**：`POST /create_cube`、`POST /add`、`POST /search`，按 cube 隔离。
3. **MCP**：标准化 `add_memory` / `search_memory` / `get_message` 工具，可被 Claude Desktop、Cursor、Coze 等直接加载。

统一 Python SDK 风格：`config.from_json_file()` → `Memory(config)` → `memory.add/search/get/update/delete`。

### 3.4 存储

- **图库**：Neo4j（tree-mem 主力）、PolarDB/Postgres（兼容）、Nebula（社区）
- **向量库**：Qdrant、Milvus（pref-mem）
- **KV / 队列**：Redis（激活记忆 + Scheduler Stream）
- **关系库**：MySQL（用户/会话/权限，via SQLAlchemy）
- **本地插件**（`memos-local-plugin`）：SQLite + FTS5（全文检索），100% 本地零云依赖

---

## 4. 与竞品对比

| 维度 | 传统 RAG | MemGPT / Letta | Mem0 | **MemOS** |
|------|----------|----------------|------|-----------|
| 核心抽象 | 文档块 + 向量 | OS 隐喻（core/external memory，分页） | 记忆条目 + 向量 | **OS 隐喻 + Memory³（明文/激活/参数）** |
| 记忆形态 | 仅明文 | 明文 + 提示词 | 明文（+偏好） | **明文 + KV cache + LoRA 参数，可互转** |
| 检索 | 纯向量 | 分页 + 检索 | 向量 + 摘要 | **向量 + 图遍历（多跳）+ 时序衰减** |
| 整合/遗忘 | 无 | 有限（被动） | 少量合并 | **主动 consolidate/organize + 遗忘曲线 + feedback 修正** |
| 调度 | 同步 | 同步 | 同步 | **异步事件驱动（Redis Stream），毫秒级** |
| 可解释性 | 黑盒嵌入 | 中 | 中 | **图结构可见可编辑，全链路 trace** |
| 工业化 | — | 中 | 高（托管） | **高（10w 并发、监控、多租户 cube 隔离）** |

**优势**：
- 真正的「记忆形态转换」——把高频明文沉淀为 LoRA 参数，这是 MemGPT/Mem0 完全没有的维度。
- 图结构 + 向量混合检索，多跳推理与可解释性显著优于纯向量。
- 异步 Scheduler + feedback，记忆可主动演化而非被动检索。

**劣势**：
- 系统重——依赖 Neo4j + 向量库 + Redis + LLM，自托管门槛高（docker-compose 起 3 个服务）。
- 强 Python 栈，与 JS/TS 生态（如 deepOrca）无原生契合。
- 参数记忆（LoRA）路径在多数实际部署中未充分启用，主要价值仍来自明文 + 激活层。
- 时序推理的 159% 提升依赖其特定衰减/图结构调优，泛化性待独立复现。

---

## 5. 评测

### 5.1 Benchmark

官方 `evaluation/` 覆盖 **LoCoMo / LongMemEval / PrefEval / PersonaMem**，并提供 mem0 / zep / memobase / supermemory / memu 的非官方对比实现。2026-07 新增 **OmniMemEval**（统一评测 14 款商用记忆产品 × 10 数据集）。

### 5.2 关键指标（v2.0，OmniMemEval 体系）

| Benchmark | MemOS 得分 | 说明 |
|-----------|-----------|------|
| **LoCoMo** | **88.83** | 长对话记忆，旗舰指标 |
| **LongMemEval** | **89.20** | 长期记忆评测 |
| PersonaMem v2 | 40.58 | 人设/偏好一致性 |
| HaluMem | 80.91 | 记忆幻觉控制 |
| BEAM-10M | 56.75 | 大规模记忆 |
| GDPVal | 62.07 | 政府数据价值 |
| LiveCodeBench | 64.96 | 代码任务（工具/技能记忆） |
| OmniMath | 61.00 | 数学推理 |
| SWE-Bench | 38.46 | 软件工程任务 |
| BrowseComp-Plus | 23.85 | 浏览/检索任务 |

**Agent 增量**：接入 MemOS 后，OpenClaw agent 在 5 项任务上平均完成率从 **36.63% → 50.87%**。

### 5.3 与 OpenAI 全局记忆对比（LoCoMo，论文 v1 口径）

| 类别 | MemOS | OpenAI | 提升 |
|------|-------|--------|------|
| 整体准确率 | **0.7331** | 0.5275 | **+38.97%** |
| Token 开销 | 0.39 | 1.00 | **-60.95%** |
| **时序推理** | **0.7321** | 0.2825 | **+159.15%** |
| 单跳推理 | 0.7844 | 0.6183 | +26.9% |
| 多跳推理 | 0.6430 | 0.6028 | +6.7% |
| 开放域 QA | 0.5521 | 0.3299 | +67.4% |

亮点：在「既准且省」的同时，**时序推理取得近 2.6 倍提升**——这是图结构 + 时间衰减函数的直接收益，也是 MemOS 最具差异化的能力。

---

## 6. 对 deepOrca activity-frames 的启示

### 6.1 当前 activity-frames 的局限

参照 `specs/archive/activity-frames/design.md`，当前设计是：

> 多源采集（nocta-recorder → SQLite：屏幕帧 + UI 事件 + 无障碍元素）→ sessionize 分段 → 实体识别 → 编译为 ActivityDocument/Frame → 6 个只读 MCP 工具（get_context / get_activity / get_steps / get_day_summary / get_patterns / get_communications）。

对照 MemOS 的记忆生命周期，activity-frames 的定位是**行为记忆的「采集 + 编译 + 即时查询」层**，存在以下结构性缺口：

| 维度 | 当前状态 | 缺口 |
|------|----------|------|
| **写入** | 只读 SQLite（`db.ts` node:sqlite 只读连接） | 无法写回提炼后的记忆，nocta-recorder 是唯一写入方 |
| **检索** | 按时间窗口 / day 线性扫描 + SQL GROUP BY | 无语义检索、无跨天关联、无多跳推理（「上次做类似任务时怎么操作的」答不出） |
| **整合** | 无 | 原始帧永远堆积，无摘要、无去重、无合并 |
| **遗忘** | 无 | 数据无限增长，旧帧与当前任务无关也不淡化 |
| **分层** | 单一原始帧层 | 无「原始事件 / 会话摘要 / 行为模式 / 用户偏好」之分层 |
| **生命周期** | 无 status/visibility | 所有帧同等对待，无 active/archived |
| **反馈** | 无 | Agent 用了某段行为记忆觉得不对，无法修正 |

一句话：**activity-frames 是「行为数据的 ETL + 查询」，还不是「行为记忆系统」**——它有 MemOS 的「读」，但没有 MemOS 的「写回 / 整合 / 遗忘 / 分层」。

### 6.2 可借鉴的设计

按投入产出比排序，MemOS 以下设计可直接迁移到 deepOrca：

#### A. 分层模型（最高价值）

把 activity-frames 的单一帧层升级为**行为记忆的三层**，与 deepOrca 已有的三层（TDAM 对话 / activity-frames 行为 / openwiki 知识）正交：

```
行为记忆内部再分层（借鉴 TreeTextMemory 的 memory_type）：
  L1 Trace（原始事件层）   ← 当前的 frames/ui_events，只增不改
  L2 Pattern（模式层）     ← get_patterns 的产出沉淀为可检索条目
  L3 Skill/Preference（技能/偏好层）← 高频重复操作蒸馏为「怎么做」的技能
```
这正是 MemOS `memos-local-plugin` 宣称的 **「L1 traces / L2 policies / L3 world models + Skills」** 分层，可直接对标。

#### B. 记忆操作原语（中等价值）

把当前 6 个只读工具扩展为完整 CRUD + 编排：
- **新增**：`add_behavior_memory`——把 Agent 推理出的行为摘要/模式写回（需要可写存储）。
- **检索升级**：`search_behavior`（语义 + 时间衰减），替代纯时间窗口扫描。MemOS 的「向量召回 + 图扩展」太重，但**向量召回 + 时间衰减**是轻量可行的。
- **整合**：`consolidate_behaviors`——离线/定时把原始帧压缩为日/周摘要（类比 MemOS 的 `mem_organize`）。
- **遗忘**：给帧/摘要加 `status`（active/archived）+ 时间衰减权重。
- **反馈**：`feedback_behavior`——Agent 标记某条行为记忆过时/错误。

#### C. 检索策略（高价值，低投入）

MemOS 最值得抄的一点：**时序感知的混合检索 + 遗忘曲线**。activity-frames 天然带时间戳，非常适合：
- 语义相似度（对 frame 摘要做 embedding）× 时间衰减函数（近期权重高）。
- 这能把「我上周做过类似的事吗」这种语义查询从无解变成可答。

#### D. MemCube 隔离思想（中长期）

MemOS 的 multi-cube 支持按 user/project/agent 隔离与受控共享。deepOrca 若做多项目/多 session 场景，可借鉴「行为记忆 cube」概念做隔离与组合。

#### 不建议照搬的部分

- **Memory³ 的激活/参数记忆层**——KV cache 与 LoRA 对 deepOrca 这种本地 TS Agent 过重，且无运行时 LLM 训练管线，投入产出极低。
- **Neo4j 图库**——deepOrca 坚持「零外部运行时依赖」，引入图数据库违反核心原则。activity-frames 用 SQLite/FTS5 + 可选向量即可。
- **MemScheduler 的 Redis/RabbitMQ 异步队列**——本地 MCP server 用进程内异步（已有的 InMemoryTransport + 节流）足够，无需外部队列。

### 6.3 落地建议

#### 短期（与当前 Phase 1-5 重写并行，低增量）

1. **存储可写化**：在 `db.ts` 之外新增一个独立的**派生记忆库**（SQLite，如 `~/.deeporca/behavior_mem.db`），不污染 nocta-recorder 的只读原始库。结构借鉴 TreeTextMemory 的 item：`id / summary / embedding / memory_type(L1/L2/L3) / status / confidence / created_at / source_refs[]`。
2. **给 ActivityFrame 加分层标签**：编译时打 `memory_type=trace`，模式识别产出打 `pattern`，为后续整合预留字段。
3. **新增 MCP 工具**（不改原有 6 个）：
   - `search_behavior(query, hours)` —— 语义检索行为记忆（先上 BM25/FTS5，向量后置）。
   - `add_behavior_memory(summary, refs)` —— 写回 Agent 提炼的摘要。

#### 中期（重写完成后，2-4 周量级）

4. **时间衰减检索**：实现 MemOS 风格的 `score = semantic_sim × decay(now - t)`，让 `get_context` / `get_patterns` 的结果按相关性+新鲜度排序而非纯时间。
5. **离线整合任务**：借鉴 `mem_organize`，加一个定时/启动时的「日摘要」生成器，把当天 frames 压缩成 1 条 L2 记忆写回派生库；旧 L1 帧标记 `archived`（不删，淡化权重）。
6. **L3 技能蒸馏**：对高频重复的操作序列（`get_patterns` 已能识别）用 LLM 抽成「操作技能」条目，供 Agent 复用。

#### 长期（架构演进，1-2 月量级）

7. **行为记忆 cube**：把派生记忆库抽象成可隔离/共享的 cube，支持多 project 切换，对齐 MemOS 的 multi-cube。
8. **与 TDAM/openwiki 联动**：行为记忆（做了什么）↔ 对话记忆（说了什么）↔ 知识记忆（项目是什么）三者的交叉检索，这是 deepOrca 区别于通用 MemOS 的差异化能力——MemOS 不具备跨「行为/对话/知识」三源的多模态关联。
9. **feedback 闭环**：Agent 用行为记忆后可回写修正，形成自我演化的行为记忆（对齐 MemOS `mem_feedback`）。

#### 优先级一句话总结

> 先做「可写派生库 + 语义检索 + 时间衰减」三件套（最高 ROI），这是把 activity-frames 从「ETL」升级为「记忆系统」的最小必要步；Memory³ 的激活/参数层、Neo4j 图库、Redis 队列均不适用 deepOrca 的零依赖本地化定位，明确放弃。

---

## 附：关键事实校验

- **论文链接**：用户提供 `arxiv.org/pdf/2607.16621` 失效；实际为 `arxiv.org/abs/2507.03724`（长版）与 `2505.22101`（短版）。引用 BibTeX 已在仓库 README 给出。
- **star 数**：官方仓库 README 未直接显示；2026-05 媒体报道「突破 1.2 万」，2026-07 仍活跃迭代（v2.0.23）。GitHub API 因本环境证书问题无法直连取数，建议手动复核。
- **license**：Apache 2.0（个人与商业无限制）。
- **语言**：Python 3.10+（核心服务）；本地插件 `memos-local-plugin` 为 Node.js/TS（适配 OpenClaw/Hermes agent）。
