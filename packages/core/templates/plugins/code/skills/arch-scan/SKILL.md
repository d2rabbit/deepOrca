---
name: arch-scan
description: >-
  Scan codebase architecture and generate an interactive A2UI architecture map
  using perspective-driven recursive analysis. Use when users ask for "scan
  architecture", "架构图", "架构扫描", "architecture diagram", "代码结构",
  "dependency map", or "how does this codebase work". Produces an A2UI Surface
  (nestable component tree) rendered via DeepOrca's DesignPreview — no external
  CLI, no Mermaid files. Methodology adopted from oh-my-mermaid (omm).
---

# arch-scan — Perspective-Based Architecture Scanner (A2UI Renderer)

## Purpose

Analyze the codebase and generate an **interactive A2UI architecture map** using
**perspective-driven recursive analysis**.

- A **perspective** is a top-level view — a distinct way to look at the
  architecture (structure, data flow, dependencies, etc.).
- Each element in a perspective gets analyzed recursively. If it has internal
  structure, it becomes a **nestable group** (click to expand in the A2UI
  preview). If not, it stays a **leaf node**.
- Output is an **A2UI Surface** (a tree of components), NOT Mermaid `.mmd` files.
  Each perspective = a tab card; each element = a heading text with metadata
  fields; groups = expandable nested surfaces.

> **Methodology**: The perspective catalog and recursive drill-down approach are
> adopted from [oh-my-mermaid](https://github.com/oh-my-mermaid/oh-my-mermaid)
> (omm). DeepOrca replaces omm's Mermaid + CLI + `.omm/` file tree with A2UI
> component trees rendered in-app. See
> `docs/research/2026-08-06-oh-my-mermaid-research.md`.
>
> **Editorial design discipline**: The density target (4/10), complexity budgets
> (max 9 nodes / 12 edges), remove test, accent-color discipline, and the
> "semantic pattern first, visual type second" routing methodology are adopted
> from [diagram-design](https://github.com/cathrynlavery/diagram-design)
> (MIT, by Cathryn Lavery) — with thanks. DeepOrca adapts these editorial
> principles to A2UI component trees instead of self-contained HTML/SVG files.
> Planned integration detail: `docs/research/2026-08-11-knowledge-memory-materialization-design.md` §改造 4。

## 归属：工作区索引模块

本技能属于 DeepOrca 的**工作区索引**能力域，与 CodeGraph（符号级索引）、OpenWiki（文档级索引）构成三件套：

| 索引层 | 工具                              | 粒度             | 输出                              |
| ------ | --------------------------------- | ---------------- | --------------------------------- |
| 符号级 | **CodeGraph** (`codegraph index`) | 函数/类/调用链   | `.codegraph/` 知识图谱 + MCP 查询 |
| 文档级 | **OpenWiki**                      | 项目文档/wiki    | 文档索引 + MCP 查询               |
| 架构级 | **arch-scan**（本技能）           | 模块/数据流/依赖 | A2UI Surface 架构图               |

**同步构建**：在桌面端左侧「构建索引」按钮中，三者顺序自动执行：**索引（CodeGraph index）→ Wiki（OpenWiki）→ 架构图（arch-scan）**。单独使用本 skill 时（如对话中输入 `/arch-scan`）只执行架构图扫描本身，不触发前两步。架构图与符号索引互补 —— CodeGraph 回答"这个符号在哪/谁调用了它"，arch-scan 回答"整个系统的架构长什么样/数据怎么流动"。

**增量更新**：代码变更后 `codegraph sync` 增量更新符号索引；架构变更较大时重新运行 `arch-scan` 刷新架构图（架构图不每轮自动同步，因为需要 LLM 分析，成本较高）。

**索引消费**：arch-scan 优先消费 CodeGraph（符号级调用图谱）和 OpenWiki（文档级架构概述）的已构建产出，而非从零读文件。三个索引层级形成数据流：CodeGraph 提供调用关系 → OpenWiki 生成文档 → arch-scan 基于前两者生成可视化架构图。

---

## Step 0: Detect Language

Ask the user or infer from the project's primary language. Write all field
content (description, context, concern, etc.) in the detected language
(Chinese for DeepOrca's default). Element IDs and component keys are always
English kebab-case.

## 设计原则（编辑级质量纪律）

> 以下原则采纳自 [diagram-design](https://github.com/cathrynlavery/diagram-design)（MIT，Cathryn Lavery）。

### 密度目标 4/10

"最高质量的操作通常是删除。"每个节点都要有存在的理由。宁可少画，不要塞满。

### 复杂度预算（硬约束）

- 单图最多 **9 个节点**
- 单图最多 **12 条边**
- 最多 **2 个强调元素**（focal elements，如 `concern` 类型节点）
- **超出预算 → 递归下钻**，把子结构折叠为嵌套图，不要在一张图里塞 30 个节点

### 删除测试（成稿前必做）

自问：能合并或删除任何节点/边/标签吗？如果能，就删。特别检查：

- 只有一个子节点的分组 → 提升为叶子
- 语义重复的边（A→B 和 B→A 表达同一关系）→ 合并为双向
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
- Serena 可用？→ 检查 MCP 工具列表中是否有 `find_symbol` 等工具

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

### 视角 → 最优图表类型

采纳 diagram-design 的**"先选语义模式，再选视觉类型"**方法论。不要所有视角都用
`card` + `text` —— 选择最贴合语义的布局方式：

| 视角                    | 语义本质    | A2UI 组件                  | 理由               |
| ----------------------- | ----------- | -------------------------- | ------------------ |
| `overall-architecture`  | 模块 + 连接 | `card` + `text` tree       | 层级关系           |
| `data-flow`             | 有向管道    | `column` 流式卡片          | 线性流动，箭头冗余 |
| `dependency-map`        | 层级依赖    | `card` + 缩进 `text`       | 树状结构，自上而下 |
| `request-lifecycle`     | 时序步骤    | `list` 编号                | 顺序执行，无分支   |
| `state-transitions`     | 状态机      | `List` + `Text`            | 状态 + 触发条件    |
| `external-integrations` | 信任边界    | `Card` 分组 + `Text` 标注  | 内外区分是重点     |
| `storage`               | 分层存储    | `column` 堆叠卡片          | 层次而非网状       |
| `command-surface`       | 命令树      | `list` + `text`            | 层级分发           |
| `extension-points`      | 注册表      | `list` + `card`            | 枚举式，无拓扑     |
| `route-page-map`        | 导航树      | `list` + `text`            | 页面层级           |
| `pipeline`              | 阶段拓扑    | `column` 流式卡片          | 线性阶段           |
| `orchestration`         | 发布订阅    | `Card` + `Text` 标注       | 多对多拓扑         |

## Step 3: Generate the A2UI Surface (Recursive)

Build the A2UI Surface using the A2UI tools. The surface speaks the OFFICIAL
A2UI v0.9 protocol — a FLAT adjacency list of components where containers
reference children FORWARD by id, and exactly one component has `id: "root"`.

### Official component vocabulary (basicCatalog — nothing else exists)

- **Layout**: `Row`, `Column`, `List` (take `children: [ids]`), `Card`
  (takes ONE `child` id — wrap multiple children in a `Column` first),
  `Tabs` (ONE tab: `{component: "Tabs", title, child}` — sibling Tabs under
  the same container render as a tab bar), `Divider`
- **Content**: `Text` (`text` + `variant: h1|h2|h3|h4|h5|body|caption`),
  `Image`, `Icon` (Material-Symbols names only), `Video`, `AudioPlayer`
- **Input**: `Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`,
  `DateTimeInput`

There is NO `panel`, `graph`, `badge`, `flowstep`, `metriccard` or
`kanbancard` — compose from the list above. Every property value is a
literal, or `{path: "/data/key"}` bound to the dataModel.

### Structural model

- **Root**: `id: "root"` — a `Card` with the project name + overview.
- **Perspective**: one `Tabs` entry per perspective (title =
  "Overall Architecture" / "Data Flow" / …) whose `child` is that
  perspective's content `Column`.
- **Element**: a `Card` (via inner `Column` if it has multiple fields) with
  `Text` fields: name (`h4`), file path (`caption`), description (`body`),
  optional context/constraint/concern/todo/note lines.
- **Group** (element with internal structure): the element card's inner
  `Column` holds child element cards — recurse as deep as needed.
- **Edge** (relationship): a `caption` `Text` line under the source element
  (`→ IPC invoke/on → Main Process`) — there is no graph rendering.

### 3a. Build the root surface

**Surface IDs MUST use the `arch-` prefix** (`arch-root`, `arch-overall`, …) —
the runtime flushes and displays architecture maps by this prefix, and it keeps
them out of the design prototype preview.

```
render_surface({
  surfaceId: "arch-root",
  title: "<Project Name> Architecture",
  components: [
    { id: "root", component: "Card", child: "root-inner" },
    { id: "root-inner", component: "Column", children: ["overview", "tabs-overall", "tabs-dataflow"] },
    { id: "overview", component: "Text", text: "Monorepo: Electron desktop + shared core engine", variant: "body" },
    { id: "tabs-overall", component: "Tabs", title: "Overall Architecture", child: "content-overall" },
    { id: "tabs-dataflow", component: "Tabs", title: "Data Flow", child: "content-dataflow" }
  ],
  dataModel: {}
})
```

### 3b. Fill a perspective with its element tree

Static literals are fine (arch maps are read-only). Use indentation via
nested Columns to imply hierarchy — there is no graph/node/edge rendering:

```
update_surface({
  surfaceId: "arch-root",
  components: [
    { id: "root", component: "Card", child: "root-inner" },
    { id: "root-inner", component: "Column", children: ["tabs-overall"] },
    { id: "tabs-overall", component: "Tabs", title: "Overall Architecture", child: "content-overall" },
    { id: "content-overall", component: "Column", children: ["node-renderer", "node-main", "node-store"] },
    { id: "node-renderer", component: "Text", text: "▸ Renderer (src/renderer/)", variant: "h4" },
    { id: "edge-r-to-m", component: "Text", text: "  → IPC invoke/on → Main Process", variant: "caption" },
    { id: "node-main", component: "Text", text: "▸ Main Process (src/main/)", variant: "h4" },
    { id: "edge-m-to-s", component: "Text", text: "  → read/write JSON → Data Store", variant: "caption" },
    { id: "node-store", component: "Text", text: "▸ Data Store", variant: "h4" }
  ]
})
```

`update_surface` takes the COMPLETE component list (full snapshot): same-id
components are replaced, ids dropped from a `children` list vanish from the
tree. Copy the previous list and edit it — don't resend from scratch memory.

### Node kinds (for color coding)

| Kind       | Rendering hint                          | When to use                                 |
| ---------- | --------------------------------------- | ------------------------------------------- |
| `entry`    | `Text` variant `h4` + "◉" prefix        | Entry points (HTTP handler, CLI, main)      |
| `store`    | `Text` variant `h4` + "▣" prefix        | Persistent storage (DB, cache, file system) |
| `external` | `Text` variant `body` + "◇" prefix      | Third-party services outside the codebase   |
| `concern`  | `Text` variant `caption` + "⚠" prefix   | Known risk or bottleneck                    |
| `default`  | `Text` variant `h4` + "▸" prefix        | Regular module/component                    |

### 3c. Recursive drill-down — analyze every element

**For every element (node) in the perspective tree:**

1. **Analyze** the code it represents (`read` the relevant files/directories).

2. **Add a detail card** to the element with at least a `description` `Text`.
   Optionally add context/constraint/concern/todo/note `Text` lines.

3. **Decide leaf or group:**
   - **Distinct internal components found** → the element card's inner
     `Column` gains child element cards — recurse deeper.
   - **No meaningful sub-components** (single file, trivial wrapper, external
     system) → leaf node, just fill in the metadata fields.

4. **If group** — add the nested element cards and repeat step 3c for each.

### Example recursion

```
overall-architecture (perspective)
  elements: renderer, main-process, engine-system, data-store

  → analyze renderer (src/renderer/)
    → finds: App.tsx, components/, hooks/, stores/
    → GROUP → inner Column gains child cards: components, stores, hooks
      → analyze components → 15 files, no sub-structure → LEAF
      → analyze stores → 4 stores → LEAF

  → analyze data-store (src/store.ts)
    → single file → LEAF
```

## Step 4: Summarize

Report to the user:

- Which perspectives were generated
- How many elements / groups / leaves
- Suggest viewing in the A2UI preview pane (the surface renders automatically)

## Edge Rules

- Every edge must have a meaningful label: `A --"why this connection exists"--> B`
  rendered as a `caption` `Text` line under the source element.
- More elements in one perspective → recurse deeper (don't cram 30 nodes in one view).

## General Rules

- **Use the A2UI tools (`render_surface` / `update_surface`) only** — do NOT
  write Mermaid `.mmd` files, do NOT call any external CLI, do NOT create
  `.omm/` directories.
- Always keep exactly one `id: "root"` component; keep the list FLAT
  (children by id reference, never nested objects).
- Do not re-analyze elements that haven't changed (incremental updates).
- Do not create circular references — a child element must never reference its parent.
- Write all human-readable fields in the detected language (Chinese by default).
