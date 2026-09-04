# A2UI 集成调研报告

> 日期：2026-07-30 · 状态：调研完成
> 目的：评估 A2UI（Agent-to-UI）协议能否、以及如何贡献给 DeepOrca。用户直觉是「本项目有 webview，可用于原型设计」。
> 配套设计草案：`specs/archive/a2ui-integration/design.md`

---

## 一、A2UI 是什么

A2UI 是一套**协议 + 消息格式**，让 AI agent 通过**流式 JSON 消息**驱动客户端渲染器画出**声明式交互 UI**。核心三点：

| 原则 | 含义 |
|------|------|
| Streaming Messages | UI 更新以 JSON 消息序列从 agent 流向 client |
| Declarative Components | UI 用数据描述（adjacency list 扁平结构 + JSON Pointer 绑定状态），不是写代码 |
| Data Binding | UI 结构与状态分离，支持反应式增量更新 |

**消息类型**（v0.9 稳定）：`createSurface`（建区 + 组件目录）→ `updateComponents`（定义组件树）→ `updateDataModel`（注入状态）→ `deleteSurface`（销毁）。v1.0 candidate 新增 `actionResponse`（同步 RPC）。

**组件目录（Catalog）**：JSON Schema，定义 agent 可用的组件。官方 **Basic Catalog** 内置：布局（Row/Column/List/Card/Tabs/Modal/Divider）、内容（Text/Image/Icon/Video/AudioPlayer）、输入（Button/TextField/CheckBox/ChoicePicker/Slider/DateTimeInput）。可自定义扩展。

---

## 二、官方生态实测（推翻几个早期假设）

调研 [a2ui-project/a2ui](https://github.com/a2ui-project/a2ui)（Apache-2.0）仓库后的关键事实：

### 1. React 渲染器存在且 Stable ✅
此前印象「只有 Angular」是错的。`renderers/react/` 即 `@a2ui/react` v0.10.0：
- 标记 **✅ Stable**（支持 v0.8 + v0.9.1）
- `peerDeps`: `react ^18 || ^19` —— 与 DeepOrca renderer 栈直接兼容
- `license`: Apache-2.0 —— 与本项目无冲突
- 带 `visual-parity/` 视觉一致性测试

官方另有：Angular（Stable）、Lit/Web Components（Stable）、Flutter GenUI（Stable）；社区有 Vercel `json-render`（React）、A2UI-Android（Compose）、a2ui-react-native 等。**无 Electron 专用渲染器**，但 React 渲染器可直接嵌。

### 2. 三个 MCP sample 全是 Python ⚠️
`samples/mcp/` 下三个实现（`a2ui-over-mcp-recipe` / `a2ui-in-mcpapps` / `mcp-apps-calculator`）**全是 Python**（`server.py` + `pyproject.toml` + Starlette + uvicorn + `uv run`）。

读 `a2ui-over-mcp-recipe/server.py` 发现：**A2UI JSON 是手写模板**（`recipe_a2ui.json`），server 逻辑极薄——`deep copy 模板 → 改 updateDataModel.value → 包成 EmbeddedResource`。Python 只用来跑 catalog schema 校验，**无硬性 Python 依赖**，可移植到 Node。

### 3. A2UI over MCP 的精确机制
- 动态 UI 走 **MCP 工具**：server 在 `CallToolResult` 里返回 `EmbeddedResource`，MIME `application/a2ui+json`。
- 静态 UI 走 **MCP Resource**：`a2ui://...` URI。
- 双向交互走**标准工具**：`a2ui_action`（用户交互回流，入参 `name` + `context`）、`a2ui_error`（渲染失败上报）。
- capability 协商：有状态在 `initialize.capabilities`，无状态在每次 `_meta`。

### 4. 与 AG-UI runtime 的关系
官方「Use with Any Harness」指南假设你跑在 CopilotKit/AG-UI runtime 上（注入 `generate_a2ui` 工具）。**DeepOrca 不是**——它是自研 session loop，内置工具刻意保持 7 个最小集。但 DeepOrca **已有完整 MCP 客户端**，故应走「A2UI over MCP」而非注入工具。

---

## 三、DeepOrca 现状（实测）

子 agent 探查确认 **DeepOrca 当前没有任何嵌入式渲染面**：

- renderer 是单个 sandboxed `BrowserWindow`，`webPreferences` 里**无 `webviewTag`**，无 `<webview>`/`<iframe>`/BrowserView/WebContentsView。
- 两个 HTML 生成 skill（`deep-design`、`bento-slides`）产物写磁盘 `.deeporca/designs/*.html` / `.bento.html`，**告诉用户自己去外部浏览器打开**。`write` 工具对 `.html` 与任意文本一视同仁，无渲染钩子。
- IPC 契约（`ipc.ts`，633 行）**无任何 `design:*`/`preview:*`/`webview` 通道**。
- DeepDesign spec（`specs/archive/deep-design/design.md`，2026-07-29）规划的 `DesignStudioPanel`（`<webview src="file://.../*.html">`）**未实现**，roadmap 列 Phase 3。

> 生成侧（SKILL.md + seed.html + 3 个 DESIGN.md）已就位，渲染侧完全空白。用户「本项目本身存在 webview」的直觉，对应的是 spec 里**计划要建但尚未存在**的 webview。

---

## 四、关键判断：A2UI 承载两类能力，都不是 DeepDesign 的替代

这是本次调研最重要的结论。A2UI 在 DeepOrca 里承载**两类能力**，且都与 DeepDesign 三者并存、互不替代：

| 能力 | 受众 | 归属 | 一句话定位 |
|------|------|------|-----------|
| **AI-native 原型模块** | 产品经理 | §六 设计生成（独立产品线） | 自然语言驱动的原型设计，Surface 为载体，**原生依赖 DeepOrca** |
| **对话交互层升级** | 所有用户 | §十 引擎演进 | 对话区从纯文本升级为可交互富组件 |
| _（对比）DeepDesign_ | _设计师_ | _§六 设计生成_ | _品牌一致的设计交付件，HTML 为载体，可脱离宿主_ |

**原型 ≠ 设计**——这是核心区分。原型模块与 DeepDesign 的逐维对比：

| 维度 | **DeepDesign**（设计师向） | **AI-native 原型模块**（产品经理向） |
|------|----------------------------|--------------------------------------|
| 受众 | 设计师 / 追求设计交付件的开发者 | 产品经理 / 产品负责人 |
| 输入 | 设计系统（DESIGN.md 品牌契约）+ 模板组合 | **自然语言**（产品需求、流程描述、用户故事） |
| 产物本质 | 设计（视觉表现层，品牌一致） | 原型（结构与流程，交互逻辑验证） |
| 类比 | OpenDesign / Claude Design | v0/bolt 这类 AI 原型工具，但以 Surface 为载体 |
| 格式 | 自包含 HTML 文件（`.deeporca/designs/*.html`） | **声明式 Surface**（A2UI JSON，独特格式） |
| 能否脱离宿主 | ✅ 能（成品交付件） | ❌ **不能**——原生依赖 DeepOrca 运行时 |
| 更新方式 | 重写整个 HTML 文件 | 自然语言对话 → 增量 patch |
| 交互 | 死的 | `a2ui_action` 双向闭环（点击、填表、走流程） |
| 目标 | 产出可交付的设计稿 | 快速表达产品想法、验证交互流程、与开发对齐 |

> 「不能脱离宿主」正是「AI-native」的含义——原型不是一份文件，而是一个**与 Agent 持续对话的活对象**，渲染依赖 `@a2ui/react` 运行时，交互回流依赖 agent loop + `a2ui_action`。

---

## 五、A2UI 能贡献的四个场景

| # | 场景 | 归属域 | 现状痛点 | A2UI 形态 |
|---|------|--------|---------|----------|
| 1 | 富交互工具结果 | §十 | codegraph 符号树/gitmcp 结构只能挤进 markdown | 工具结果携带 Surface，渲染成可折叠树/表格 |
| 2 | 结构化输入面板 | §十 | AskUserQuestion 只能多选 | Agent 产出表单 Surface，状态回流 |
| 3 | **AI-native 原型模块** | **§六**（独立产品） | 见 §四 | 自然语言→Surface 原型→增量迭代→交互验证 |
| 4 | Plan/任务看板 | §十 | UpdatePlan 是纯文本 | 可勾选、实时刷新进度的看板 |

Basic Catalog 组件**四个场景全部覆盖**，无需自研即可起步（原型模块的 DeepOrca 专属组件可 P2 增量加）。

---

## 六、技术选型（带依据）

| 维度 | 选型 | 依据 |
|------|------|------|
| 渲染器 | 官方 `@a2ui/react` | Stable、React 18/19 兼容、Apache-2.0、Basic Catalog 齐全、带 visual-parity 测试 |
| 传输 | A2UI over MCP | 复用既有 MCP 客户端；双向 `a2ui_action` 就是工具调用；不违反「7 工具最小集」 |
| Server | 自研 Node server（草案建议） | 官方 sample 全 Python，破坏「纯 Node MCP」一致性；Python 仅做 schema 校验，可 Node 化 |
| 位置 | 主窗口内 React 富消息 | 最集成、上下文不割裂、与 `Message.tsx` 一脉相承 |

> 详细层规则、改动点、风险见 `specs/archive/a2ui-integration/design.md`。

---

## 七、结论

- **用户直觉对**：A2UI 在 DeepOrca 的核心价值之一正是「AI-native 原型模块」——但它是**独立产品**（PM 向、自然语言驱动、Surface 载体、不可脱离宿主），**不是 DeepDesign 的替代或迭代**。这是与 DeepDesign（设计师向、设计交付件、HTML 载体、可脱离宿主）的本质区分。A2UI 另承载「对话交互层升级」（场景 1/2/4）。
- **技术咽喉只有一处**：DeepOrca 的 esbuild renderer 构建链能否处理 `@a2ui/react` 的 CSS Modules（`.module.css`）。P0 必须先验证。
- **与现有架构高度契合**：React 渲染器现成、MCP 体系现成、`a2ui_action` 就是工具调用。零新机制，工作量集中在「MCP server 模板拼装」+「富消息渲染分支」+「原型模块 Skill」+「action 回流 IPC」。
- **不破坏层规则**：core 只产出/转发 `application/a2ui+json` 负载（UI-free），渲染在 desktop renderer。

---

## 参考来源

- [A2UI 概览](https://a2ui.org/concepts/overview/)
- [A2UI over MCP 指南](https://a2ui.org/guides/a2ui_over_mcp/)
- [Catalogs 概念](https://a2ui.org/concepts/catalogs/)
- [Renderers 参考](https://a2ui.org/reference/renderers/)
- [官方仓库 a2ui-project/a2ui](https://github.com/a2ui-project/a2ui)（Apache-2.0）
- [Use A2UI with Any Harness](https://a2ui.org/guides/a2ui-with-any-agent-framework/)
- [ADK 集成（佐证协议无关）](https://adk.dev/integrations/a2ui/)
