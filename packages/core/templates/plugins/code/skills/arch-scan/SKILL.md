---
name: arch-scan
description: >-
  Scan codebase architecture and generate a Mermaid architecture map using
  perspective-driven recursive analysis. Use when users ask for "scan
  architecture", "架构图", "架构扫描", "architecture diagram", "代码结构",
  "dependency map", or "how does this codebase work". Produces a persisted
  Mermaid document (.deeporca/prototypes/arch-<name>.md) whose diagrams render
  in the Knowledge panel — real nodes and edges, not a flat document.
  Methodology adopted from oh-my-mermaid (omm).
---

# arch-scan — Perspective-Based Architecture Scanner (Mermaid Renderer)

## Purpose

Analyze the codebase and generate an **architecture map of actual diagrams**
using **perspective-driven recursive analysis**.

- A **perspective** is a top-level view — a distinct way to look at the
  architecture (structure, data flow, dependencies, etc.).
- Each element in a perspective gets analyzed recursively. If it has internal
  structure, it becomes a **nested subgraph** (Mermaid `subgraph`). If not, it
  stays a **leaf node**.
- Output is ONE persisted **Mermaid document** per scan
  (`.deeporca/prototypes/arch-<name>.md`), saved via the `save_archmap` tool.
  A diagram must BE a diagram: nodes, edges, labeled relationships. Prose
  belongs in the short overview lines, never as a substitute for edges.

> **Methodology**: The perspective catalog and recursive drill-down approach are
> adopted from [oh-my-mermaid](https://github.com/oh-my-mermaid/oh-my-mermaid)
> (omm). DeepOrca renders the diagrams in-app via Mermaid instead of omm's CLI
> + `.omm/` file tree. See
> `docs/research/2026-08-06-oh-my-mermaid-research.md`.
>
> **Editorial design discipline**: The density target (4/10), complexity budgets
> (max 9 nodes / 12 edges per diagram), remove test, accent-color discipline, and
> the "semantic pattern first, visual type second" routing methodology are adopted
> from [diagram-design](https://github.com/cathrynlavery/diagram-design)
> (MIT, by Cathryn Lavery) — with thanks.
>
> **Semantic component palette**: the per-kind fixed-hue component typing
> (frontend / backend / store / bus / cloud / external / concern) is adopted
> from [Cocoon-AI/architecture-diagram-generator]
> (https://github.com/Cocoon-AI/architecture-diagram-generator) (MIT, by
> Cocoon AI). DeepOrca keeps its Mermaid pipeline (auto-layout instead of
> hand-positioned SVG) and paints the kinds theme-adaptively in the
> renderer instead of Cocoon's fixed dark palette.

## 归属：工作区索引模块

本技能属于 DeepOrca 的**工作区索引**能力域，与 CodeGraph（符号级索引）、OpenWiki（文档级索引）构成三件套：

| 索引层 | 工具                              | 粒度             | 输出                              |
| ------ | --------------------------------- | ---------------- | --------------------------------- |
| 符号级 | **CodeGraph** (`codegraph index`) | 函数/类/调用链   | `.codegraph/` 知识图谱 + MCP 查询 |
| 文档级 | **OpenWiki**                      | 项目文档/wiki    | 文档索引 + MCP 查询               |
| 架构级 | **arch-scan**（本技能）           | 模块/数据流/依赖 | Mermaid 架构图（arch-*.md）       |

**同步构建**：在桌面端「构建索引」中，三者顺序自动执行：**索引（CodeGraph index）→ Wiki（OpenWiki）→ 架构图（arch-scan）**。单独使用本 skill 时（如对话中输入 `/arch-scan`）只执行架构图扫描本身，不触发前两步。架构图与符号索引互补 —— CodeGraph 回答"这个符号在哪/谁调用了它"，arch-scan 回答"整个系统的架构长什么样/数据怎么流动"。

**增量更新**：代码变更后 `codegraph sync` 增量更新符号索引；架构变更较大时重新运行 `arch-scan` 刷新架构图（架构图不每轮自动同步，因为需要 LLM 分析，成本较高）。

**索引消费**：arch-scan 优先消费 CodeGraph（符号级调用图谱）和 OpenWiki（文档级架构概述）的已构建产出，而非从零读文件。三个索引层级形成数据流：CodeGraph 提供调用关系 → OpenWiki 生成文档 → arch-scan 基于前两者生成可视化架构图。

---

## Step 0: Detect Language

Ask the user or infer from the project's primary language. Write all node
labels, edge labels and prose (description, overview) in the detected language
(Chinese for DeepOrca's default). Node ids may be ASCII slugs.

## 设计原则（编辑级质量纪律）

> 以下原则采纳自 [diagram-design](https://github.com/cathrynlavery/diagram-design)（MIT，Cathryn Lavery）。

### 密度目标 4/10

"最高质量的操作通常是删除。"每个节点都要有存在的理由。宁可少画，不要塞满。

### 复杂度预算（硬约束——注意是"区间"，不是只有上限）

每张图的规模必须落在统一区间内，让整套架构图的**尺寸与密度保持一致**（渲染端按卡片排版，稀疏图与稠密图混排会显得杂乱）：

- 每张图 **6-12 个节点**、**6-12 条边**
- flowchart 类图至少 **2 个 `subgraph` 分组**（有分组才有结构感）
- 最多 **2 个强调元素**（`concern` 类节点）
- **少于 6 个节点 → 必须下钻一层补足**：把其中某个节点展开为 `subgraph`（其内部组件成为子节点）。禁止输出 3-4 个节点的稀疏小图——它们在渲染端尺寸失控、信息量不足
- **多于 12 个节点 → 上浮或拆分**：把子结构折叠为 `subgraph`，或拆成独立小图，不要在一张图里塞 30 个节点
- `overall-architecture` 是首页总览，取区间上限：**8-12 节点 + 2-4 个 subgraph**

### 标签与尺寸纪律（所有图统一）

- 节点标签 **4-14 个字符**（过短无信息，过长换行会让节点卡片高低参差）
- subgraph 标题 2-8 个字符，纯名称
- 边标签 2-10 个字符，动词短语（"写 JSON"、"IPC invoke"），禁止裸箭头
- 同一份文档内不要混用中英文标签；全文遵循 Step 0 检测的语言
- 相同语义用相同形状（见下方节点类型表），不同图之间保持编码一致——读者不应为每张图重新学习图例

### 删除测试（成稿前必做）

自问：能合并或删除任何节点/边/标签吗？如果能，就删。特别检查：

- 只有一个子节点的 subgraph → 提升为叶子
- 语义重复的边（A→B 和 B→A 表达同一关系）→ 合并为双向 `A <--> B`
- 无信息量的标签（"uses"、"calls"）→ 换成具体动作或删除

### 强调色纪律

1 个强调色（`concern` 红），1-2 个焦点元素。第二个强调色会抹除焦点信号。

### 何时不画图

如果一段好文字比这张图传达更多信息，就写文字。**不要**为以下内容画图：

- 简单列表（用 markdown 列表）
- 前后对比（用表格）
- 单一概念（用一句话）

自问："读者从这张图学到的，是否比从一段写得好的文字里学到的更多？"

## Step 1: Gather Knowledge from Existing Indices

**优先消费已构建的索引**，而非从零读文件。arch-scan 通常在 `index.build-all` 的第三步执行，此时 CodeGraph 符号索引（Step 1）和 OpenWiki 文档（Step 2）已经构建完成。直接复用它们的产出，避免重复分析。

### 知识获取优先级（从高到低）

#### 1. OpenWiki 文档（`openwiki/` 目录）——最高效的结构化来源

如果 `openwiki/` 存在，先读这些文件获取已有架构理解：

- `read openwiki/architecture.md` — **已有的架构概述**，可能已经描述了模块划分和依赖关系
- `read openwiki/modules/*.md` — **已有的模块文档**，每个模块的职责和接口
- `read openwiki/workflows/*.md` — **已有的工作流文档**，数据流和请求生命周期

这些文档是 LLM 生成的结构化内容，直接消费比重新从代码推理高效得多。

#### 2. CodeGraph 图谱（MCP 工具）——符号级调用关系

如果 CodeGraph 工具可用（`codegraph_*` 系列），用它获取精准的调用关系：

- `codegraph_explore` — 探索项目结构和符号
- `codegraph_callers` / `codegraph_callees` — **直接获取调用关系**（比手动 grep 精准）
- `codegraph_impact` — 分析依赖方向，判断哪些是核心模块

这直接为架构图的**边（edges）**提供数据：谁调用了谁，数据从哪流向哪。

#### 3. Serena 符号结构（MCP 工具）——LSP 级模块大纲

如果 Serena 工具可用（`find_symbol` / `get_symbols_overview` 等）：

- `get_symbols_overview` — 获取文件的符号大纲，快速了解模块内部结构
- `find_symbol` — 精准定位入口函数/类定义

#### 4. 原始文件读取（仅补充索引未覆盖的细节）

当以上索引不存在或未覆盖某些细节时，才回退到原始文件：

- `read package.json` / `pyproject.toml` / `go.mod` — 项目元信息
- `bash ls` / `find` — 目录结构（仅当 CodeGraph/OpenWiki 未提供时）
- `read` 入口文件 — 仅当 OpenWiki modules/\*.md 未覆盖时
- `read AGENTS.md` — 项目编码指南

### 判断索引是否可用

- CodeGraph 可用？→ 尝试调用 `codegraph_explore`，如果返回结果则可用
- OpenWiki 可用？→ 尝试 `read openwiki/architecture.md`，如果文件存在则可用
- Serena 可用？→ 检查 MCP 工具列表中是否有 `find_symbol` 等

## Step 2: Select Perspectives

From the catalog below, choose which perspectives are meaningful for this
codebase. **Always** include `overall-architecture`.

### Perspective Catalog

| Perspective             | When to create                          | What it answers                                   |
| ----------------------- | --------------------------------------- | ------------------------------------------------- |
| `overall-architecture`  | **Always**                              | What exists and how pieces relate                 |
| `request-lifecycle`     | Any server/API                          | How a request enters and gets handled end-to-end  |
| `data-flow`             | Any data processing, DB usage           | Where data comes from, transforms, and lands      |
| `dependency-map`        | Complex module graph                    | What depends on what, what's shared               |
| `external-integrations` | External APIs/services                  | What the system connects to and why               |
| `state-transitions`     | Stateful features (frontend or backend) | How state changes and what triggers it            |
| `route-page-map`        | Frontend with routing                   | Page structure and navigation flow                |
| `command-surface`       | CLI tools                               | Command hierarchy and dispatch                    |
| `extension-points`      | Plugin/extension systems                | Extension architecture and registry               |
| `pipeline`              | ML/data pipelines                       | Stage topology and data flow                      |
| `orchestration`         | Event-driven/queue systems              | Publisher, subscriber, broker topology            |
| `storage`               | 2+ storage systems                      | Storage topology (DB, cache, queue, object store) |

Don't force perspectives that don't exist in the code.

### 视角 → Mermaid 图类型（语义先行）

采纳 diagram-design 的**"先选语义模式，再选视觉类型"**方法论：

| 视角                    | 语义本质 | Mermaid 图类型                        |
| ----------------------- | -------- | ------------------------------------- |
| `overall-architecture`  | 模块+连接 | `flowchart TD` + `subgraph` 分组      |
| `data-flow`             | 有向管道 | `flowchart LR`                        |
| `dependency-map`        | 层级依赖 | `flowchart TD`（依赖方向自上而下）     |
| `request-lifecycle`     | 时序步骤 | `sequenceDiagram`                     |
| `state-transitions`     | 状态机   | `stateDiagram-v2`                     |
| `external-integrations` | 信任边界 | `flowchart LR` + 内外 `subgraph` 区分 |
| `storage`               | 分层存储 | `flowchart TD` 分层 `subgraph`        |
| `command-surface`       | 命令树   | `flowchart TD`                        |
| `extension-points`      | 注册表   | `flowchart LR`（注册中心为中枢节点）   |
| `route-page-map`        | 导航树   | `flowchart TD`                        |
| `pipeline`              | 阶段拓扑 | `flowchart LR`                        |
| `orchestration`         | 发布订阅 | `flowchart LR`（broker 为中枢节点）    |

## Step 3: Generate the Mermaid document

Write ONE markdown document and save it via `save_archmap`. Layout contract:

````markdown
# <Project Name> 架构

<一句话总览：这是什么系统、由哪几块组成。>

## <视角一标题>

<0-2 句该视角的要点。>

```mermaid
<diagram>
```

## <视角二标题>
...
````

### Mermaid 语法纪律（LLM 高频错误防线）

- 节点文本含 `(){}[]:#|` 或中文标点时**必须加引号**：`R["渲染进程 (renderer)"]`
- 边标签用 `-->|"写 JSON"| S` 或 `-- "写 JSON" -->` 形式；标签内的引号要转义或改用单引号
- **禁止**把 `end`、`graph`、`subgraph` 等关键字用作节点 id 或裸文本
- `sequenceDiagram` 的参与者名含空格用 `participant SM as Session Manager`
- 一张图只讲一个视角；标题用 `##`，图前最多两句话

### 节点类型（语义 kind —— 全套文档统一图例）

渲染端把 mermaid 配色接入应用主题（明/暗自适应），并**按语义 kind 固定色相**：
同一 kind 在所有图里颜色一致，读者只需学一次图例。**图的语义编码不得依赖颜色填充**
——不要在 classDef 里写 `fill`，kind 语义交给下面的标准 classDef 描述（描边/虚线），
颜色由渲染端按主题绘制：

| Kind       | classDef 编码                                   | When to use                          | 渲染色相   |
| ---------- | ----------------------------------------------- | ------------------------------------ | ---------- |
| `entry`    | `stroke:#3b82f6,stroke-width:2.5px`             | 入口（HTTP handler、CLI、main）       | 蓝（加粗） |
| `frontend` | `stroke:#22d3ee`                                | UI/前端层                             | 青         |
| `backend`  | `stroke:#2dd4bf`                                | 服务/业务逻辑层                       | 绿         |
| `store`    | 圆柱形状 `ID[("标签")]` + `stroke:#a78bfa`      | 持久存储（DB、缓存、文件系统）        | 紫         |
| `bus`      | `stroke:#fbbf24`                                | 消息/事件总线（Kafka、MQ）            | 琥珀       |
| `cloud`    | `stroke:#818cf8`                                | 云服务/运行时平台                     | 靛         |
| `external` | `stroke-dasharray: 4 3`                         | 代码库之外的第三方服务                | 灰（虚线） |
| `concern`  | `stroke:#ef4444,stroke-width:2px`（每图≤2 个）  | 已知风险或瓶颈                        | 玫红       |
| `default`  | （不加 class）                                   | 普通模块/组件                        | 自动循环色 |

### 标准图例块（每张 flowchart 必须原样携带）

为了让整套架构图的**图例完全一致**，每张 flowchart 的**结尾必须原样附上**下面这段
classDef（用到的 kind 才写 `class` 指派）：

```
  classDef entry stroke:#3b82f6,stroke-width:2.5px
  classDef frontend stroke:#22d3ee
  classDef backend stroke:#2dd4bf
  classDef store stroke:#a78bfa
  classDef bus stroke:#fbbf24
  classDef cloud stroke:#818cf8
  classDef external stroke-dasharray: 4 3
  classDef concern stroke:#ef4444,stroke-width:2px
```

禁止自创其他 classDef、禁止 `fill:` 填充色、禁止改变这些描边值——
渲染端按 kind 名称映射固定色相，命名一致才能全套统一。
`sequenceDiagram`/`stateDiagram-v2` 不适用此块（形状语义由图类型自带）。

示例（flowchart TD）：

```
flowchart TD
  subgraph Desktop["Electron 桌面端"]
    R["Renderer (React)"]
    M["Main Process"]
  end
  subgraph Engine["@deeporca/core"]
    E["Session 引擎"]
    T["工具执行器"]
  end
  FS[("文件系统")]

  R -->|"IPC invoke"| M
  M -->|"会话循环"| E
  E -->|"工具调用"| T
  T -->|"read/write"| FS

  classDef entry stroke:#3b82f6,stroke-width:2.5px
  classDef frontend stroke:#22d3ee
  classDef backend stroke:#2dd4bf
  classDef store stroke:#a78bfa
  classDef bus stroke:#fbbf24
  classDef cloud stroke:#818cf8
  classDef external stroke-dasharray: 4 3
  classDef concern stroke:#ef4444,stroke-width:2px
  class R frontend
  class M,E,T backend
  class FS store
```

### 3c. Recursive drill-down — analyze every element

**For every element (node) in the perspective tree:**

1. **Analyze** the code it represents (`read` the relevant files/directories).

2. **Decide leaf or group:**
   - **Distinct internal components found** → the node becomes a `subgraph`
     holding child nodes — recurse deeper (respect the 9-node budget per
     DIAGRAM; deeper structure goes into a separate perspective section).
   - **No meaningful sub-components** (single file, trivial wrapper, external
     system) → leaf node with a concise label.

3. **Label discipline**: node label = 名称 +（可选）一句话职责；细节放 prose，不塞进图。

### Example recursion

```
overall-architecture (perspective)
  elements: renderer, main-process, engine, data-store

  → analyze renderer (src/renderer/)
    → finds: App.tsx, components/, hooks/, stores/
    → GROUP → subgraph "Renderer" containing app / components / state
      → analyze components → 15 files, no sub-structure → LEAF
      → analyze stores → 4 stores → LEAF

  → analyze data-store (src/store.ts)
    → single file → LEAF
```

## Step 4: Save and Summarize

1. Call `save_archmap` ONCE with the complete document:
   `save_archmap({ name: "<project-slug>", markdown: "<full document>" })`.
   The file lands at `.deeporca/prototypes/arch-<project-slug>.md` and appears
   in the Knowledge panel's 架构图 tab immediately.
2. Report to the user: which perspectives were generated, how many
   nodes/subgraphs/edges, and anything that hit the complexity budget and was
   split into its own section.

## Edge Rules

- Every edge must have a meaningful label: `A -->|"为什么存在这条连接"| B` —
  never bare arrows between unrelated boxes.
- Edges come from evidence (CodeGraph callers/callees, OpenWiki workflows),
  not vibes. If you cannot say what flows across an edge, delete the edge.
- More elements in one perspective → recurse into subgraphs or split sections
  (don't cram 30 nodes into one diagram).

## General Rules

- **Persist via `save_archmap` only** — do NOT write the file yourself, do NOT
  call any external CLI, do NOT create `.omm/` directories, do NOT use
  `render_surface`/`update_surface` for architecture maps (the A2UI shape is
  the legacy format and renders as a flat document, not a graph).
- Re-running a scan replaces the previous `arch-<name>.md` (full document,
  full replacement).
- Do not re-analyze elements that haven't changed (incremental updates).
- Write all human-readable labels and prose in the detected language (Chinese
  by default).
