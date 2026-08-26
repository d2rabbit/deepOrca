---
name: arch-scan
description: >-
  Scan codebase architecture and generate a Mermaid architecture map using
  perspective-driven recursive analysis, then run an evidence-based
  architecture review (analysis findings + prioritized optimization advice).
  Use when users ask for "scan architecture", "架构图", "架构扫描", "架构评审",
  "架构分析", "architecture diagram", "architecture review", "代码结构",
  "dependency map", or "how does this codebase work". Produces a persisted
  Mermaid document (.deeporca/prototypes/arch-<name>.md) whose diagrams render
  in the Knowledge panel — real nodes and edges, not a flat document — plus a
  layered HTML overview board. Methodology adopted from oh-my-mermaid (omm).
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
>
> **Layered board methodology**: the horizontal capability-layer composition
> (entry → interface → service → data → infrastructure → external) draws on
> the 五层面/C4/业务-应用-数据-技术 domain layering used by
> [product-architecture-diagrams](https://github.com/shangbianai/product-architecture-diagrams)
> (shangbianai). **Quality contracts & loop engineering**: the count-based
> budgets, the "evaluate, don't assert" verification loop, and the bounded
> correction passes are adapted from
> [fireworks-tech-graph](https://github.com/yizhiyanhua-ai/fireworks-tech-graph)
> (yizhiyanhua-ai, MIT). **Editable-source discipline** (plain-text,
> diff-friendly artifacts over opaque binaries) echoes
> [drawio-generator](https://github.com/pmlaowangba-lab/drawio-generator)
> (pmlaowangba-lab, MIT) — with thanks to all three.
>
> **五阶段管线**（架构风格识别 → 结构化抽取 → 图生成 → 架构师评审 →
> 文档融合）：方法论对标 showapi「软件架构图生成器」skill（showapi.com
> 商业云服务；仅方法论对标，未采用其代码与云渲染依赖）。DeepOrca 版本的
> 差异：输入是代码与索引证据而非说明书文本，评审必须证据驱动，渲染全部
> 本地完成。

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

**优先消费已构建的索引**，而非从零读文件。arch-scan 通常在 `index.build-all` 的第三步执行，此时 CodeGraph 符号索引（Step 1）和 OpenWiki 文档（Step 2）已经构建完成。直接复用它们的产出，避免重复分析。用户请求中随附的说明文本（需求摘录、设计文档片段）是补充输入：用于理解意图与聚焦重点，但事实以代码与索引证据为准——冲突时修正的是理解，不是证据。

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

## Step 1.5: Identify Architecture Style（架构风格识别）

在选视角之前，先从已收集的证据中**显式识别架构风格**——它是视角选择、
总览措辞和评审维度（Step 3.6）的共同输入。风格从证据推断（目录结构、
依赖图、进程拓扑、框架特征），不要照抄 README 的自称。

常见风格（可并存，全部列出；混合架构是常态而非例外）：

| 风格                   | 证据特征                                    | 强相关视角                            |
| ---------------------- | ------------------------------------------- | ------------------------------------- |
| 单体分层               | 单进程 + controller/service/dao 式分层目录  | overall / dependency-map              |
| 前后端分离（B/S）      | 独立前端工程 + HTTP API 契约                | request-lifecycle / route-page-map    |
| 桌面客户端（Electron） | 主进程 + 渲染进程 + IPC 桥                  | request-lifecycle（IPC 生命周期）     |
| 微服务                 | 多进程/多部署单元 + 服务间调用              | orchestration / external-integrations |
| 事件驱动               | MQ / 事件总线 / 发布订阅拓扑                | orchestration / state-transitions     |
| 插件化                 | 运行时加载的扩展点 / 注册表                 | extension-points                      |
| monorepo 多包          | workspaces + 包间依赖方向                   | dependency-map                        |
| 数据/ML 流水线         | stage 化处理链                              | pipeline                              |
| CLI 工具               | 命令分发入口                                | command-surface                       |

- 风格结论写进文档总览段（Step 3 骨架），一行写明："本系统为 X + Y 构成的
  Z 风格架构"。
- 自称与证据冲突（如 README 称微服务、实为共享库堆叠的分布式单体）→
  不改风格结论，而是记入 Step 3.6 评审发现。

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

<一句话定位：这是什么系统、由哪几块组成。>
<架构风格：Step 1.5 的结论，一行（多风格并存时全部写出）。>

## <视角一标题>

<0-2 句该视角的要点。>

```mermaid
<diagram>
```

## <视角二标题>
...

## 架构分析

<Step 3.6 的评审发现，每条带证据。>

## 优化建议

<Step 3.6 的改进计划，问题 → 建议 → 优先级。>
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

## Step 3.5: 分层架构总览板（HTML Board）

> 思想来源：product-architecture-diagrams 的分层产品架构图方法论（用户体验五层面 /
> C4 / 业务-应用-数据-技术四域分层）。mermaid 图集擅长**关系与流程**，但"整个产品
> 从上到下由哪几层构成"这种**分层全景**，横向色带式的 HTML 板表达力远胜节点连线图。
> 两者互补：图集回答"怎么流动"，总览板回答"怎么堆叠"。

在生成 mermaid 图集（Step 3）**之后**，再产出一份 `arch-<name>.html` —— 分层架构
总览板，通过 `save_archmap({ name, format: "html", html })` 保存。硬性契约：

### 板结构（标准层序，自上而下）

1. **入口层**（Channels）— CLI / 桌面端 / Web / API 等触点
2. **接口层**（Interface）— 路由 / IPC / 协议适配
3. **业务服务层**（Services）— 核心领域服务与编排
4. **数据与智能层**（Data & Intelligence）— 存储 / 索引 / 模型 / 检索
5. **基础设施层**（Infrastructure）— 运行时 / 构建 / 进程间通信
6. **外部依赖**（External）— 代码库之外的第三方服务（虚线边框右移或独立带）

按项目实际裁剪层数（4-6 层），但**层序不得颠倒**，层名用上述双语格式。

### 技术契约（渲染环境是沙箱 iframe，违反即不可渲染）

- **完全自包含**：零外部资源 —— 禁 CDN、禁外链字体、禁图片、禁 JavaScript（纯 CSS）
- **亮暗自适应**：用 `prefers-color-scheme` 媒体查询提供两套 CSS 变量
- **语义配色**：组件 chip 按 kind 着色，色值与渲染端一致 ——
  entry `#3b82f6` / frontend `#22d3ee` / backend `#2dd4bf` / store `#a78bfa` /
  bus `#fbbf24` / cloud `#818cf8` / concern `#ef4444` / external 灰虚线；
  暗色模式用对应 300 级色（`#60a5fa/#22d3ee/#2dd4bf/#a78bfa/#fbbf24/#818cf8/#fb7185`）
- **层带构图**：每层 = 全宽横向色带（左侧竖排层名 + 右侧组件 chip 流式排布），
  层带背景用该层主导 kind 的 6-8% 透明色；组件 chip = 圆角胶囊（名称 + 3-8 字职责）
- **预算**：每层 2-8 个组件，全板 ≤ 30 个；底部图例条列出全部 kind 色样
- **标题头**：项目名 + 一句话定位 + 生成日期

## Step 3.6: 架构评审 — 分析与优化建议（证据驱动）

图集回答"系统长什么样"，评审回答"系统健不健康"。两个收尾章节
（`## 架构分析` / `## 优化建议`）**只消费扫描过程中已经拿到的证据**
（CodeGraph 调用链与 impact、依赖方向、目录形态、AGENTS.md 红线、
concern 候选），不为此重新通读代码。

### 评审维度（按 Step 1.5 识别的风格选 3-5 个）

| 风格           | 重点维度                                 |
| -------------- | ---------------------------------------- |
| 单体/分层      | 层间耦合、依赖方向违规、模块边界         |
| 前后端分离     | 接口契约稳定性、请求链路延迟点、错误传播 |
| 微服务         | 服务解耦度、数据一致性、故障隔离         |
| 事件驱动       | 消息可靠性、背压/积压、消费幂等          |
| 插件化         | 扩展点稳定性、版本兼容、权限边界         |
| monorepo       | 包边界、公共依赖提取、循环依赖           |
| 通用（都查）   | 高可用、可扩展、性能瓶颈、安全边界       |

### `## 架构分析` 条目格式

每条发现一行，**必须带证据**（`file.ts:符号`、调用链或 CodeGraph 查询结论）：

- **<风险/现状标题>**：<现象一句话> — 证据：`session.ts updateSessionEntry 17×/轮`；影响：<不修复的后果>

没有代码证据、只有推断的条目必须标注"待验证"，且每章最多 1 条。

### `## 优化建议` 条目格式

与分析发现**一一呼应**（不引入无对应问题的新建议），按优先级排序：

- **P0/P1/P2 <建议一句话>**：针对"<分析发现标题>"；预期<收益一句话>

### 纪律

- 两个章节各 **3-6 条**，宁缺毋滥；禁止"建议引入最佳实践"式空话
- **concern 联动**：图中的 `concern` 节点必须在`架构分析`有对应条目；
  分析中的 P0 发现也应体现在某张图的 `concern` 节点上——图与文互为索引
- AGENTS.md / docs 声明的架构红线（如 core UI-free）被违反 → 自动成为 P0 发现
- 优化建议**不得**虚构扫描中未见的技术栈（"建议引入 Redis"仅当存储瓶颈有证据）

## Step 3.9: 成稿验证环（Loop Engineering — evaluate, don't assert）

> 思想来源：fireworks-tech-graph 的 Loop Engineering。**完成度由清点证据支撑，
> 不由"看起来没问题"的断言支撑。** 保存前必须执行以下确定性检查，并把数字写进
> 最终汇报；不合格项允许最多两轮定点修正（只改被诊断的问题，不全量重写）：

1. **图集预算清点**：逐张 mermaid 图数出 节点数 / 边数 / subgraph 数，
   对照区间（6-12 节点、6-12 边、flowchart ≥2 subgraph）——超限拆分，不足下钻
2. **图例一致性检查**：每张 flowchart 结尾是否原样携带标准 classDef 块；
   kind 指派是否只用了标准 9 类
3. **语法纪律抽查**：含特殊字符的节点文本是否加引号；是否有裸箭头；
   是否误用 `end`/`graph` 关键字作 id
4. **总览板契约检查**：层序正确 / 零外部资源 / 零 JavaScript /
   prefers-color-scheme 双主题 / 每层 2-8 组件
5. **评审证据检查**：`架构分析`/`优化建议` 是否各 3-6 条且逐条带证据
   （或标注"待验证"）；concern 节点与分析条目是否一一对应
6. **汇报格式**（必须带数字）：
   `图集: N 张(节点数序列 [a,b,c…]) · 总览板: M 层/K 组件 · 评审: A 项发现/B 条建议 · 验证: 通过/经 X 轮修正`

## Step 4: Save and Summarize

1. Call `save_archmap` ONCE with the complete mermaid document:
   `save_archmap({ name: "<project-slug>", markdown: "<full document>" })`.
2. Call `save_archmap` ONCE with the layered board:
   `save_archmap({ name: "<project-slug>", format: "html", html: "<full board>" })`.
   Both land under `.deeporca/prototypes/` and appear in the Knowledge
   panel's 架构图 tab immediately (board renders on a sandboxed canvas).
3. Report to the user (Step 3.9 format, with numbers): which perspectives
   were generated, per-diagram node/edge counts, board layer/component
   counts, review finding/advice counts, and anything that hit a budget
   and was split or drilled.

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
