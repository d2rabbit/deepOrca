# A2UI 集成 — 声明式交互界面 + AI-native 原型模块（设计草案）

> 状态：**已实现（2026-08-18 终判回写）** · 日期：2026-07-30
> 落地事实：P0 原型模块 + A2UI over MCP 传输 + 自建 processor 渲染器 + IPC 全链路（`packages/desktop/src/main/tools/a2ui/a2ui-mcp.ts` 903 行：render_surface/render_prototype/update_surface/a2ui_action + `renderer/a2ui/processor.ts` + PrototypePanel/PrototypeWindow 挂载）。**既定方案偏差（2026-08-17 拍板）**：弃官方 `@a2ui/react` 改自建 processor；A2UI 锁定全域动态 UI，不介入 designer 模块（三层定位边界由 guard 测试锁死）；P1 场景面板由 a2ui-annotation/OpenUI 体系承接定位。
> 调研依据：[a2ui.org](https://a2ui.org/) · 官方仓库 [a2ui-project/a2ui](https://github.com/a2ui-project/a2ui)（Apache-2.0）
> 配套报告：`docs/research/2026-07-a2ui-integration.md`
> 定位：A2UI 在 DeepOrca 里承载**两类能力**——① 对话交互层升级（引擎演进，§十）；② 一个面向产品经理的 **AI-native 原型模块**（独立产品线，§六）。两者都不是 DeepDesign 的替代。复用既有 Electron + Agent loop + MCP 体系，**不引入 daemon、不引入 Python 运行时**。
> **优先级（用户拍板）**：MCP SDK 迁移（前置最高优先级，独立 spec）→ P0 原型模块（最核心卖点）→ P1 用户决策 + 持续状态监控 + 工作流（项目核心模块）→ P2 代码审查/git/wiki 富展示（待基础能力测完）。**核心原则：对话区不全替换，仅对特殊场景强化。**

---

## 1. 核心洞察：A2UI 到底是什么，承载两类能力

A2UI（Agent-to-UI）不是 UI 框架，而是**一套协议 + 消息格式**：Agent 发出**流式 JSON 消息**（`createSurface` / `updateComponents` / `updateDataModel` / `deleteSurface`），客户端渲染器消费这些消息画出**声明式组件树**（adjacency list 扁平结构 + JSON Pointer 绑定状态），用户交互再通过 `a2ui_action` 回流 Agent。

```
Agent ──createSurface/ updateComponents/ updateDataModel──▶ Surface（声明式 UI）
   ▲                                                              │
   └──────────── a2ui_action(用户点击/表单提交) ◀─────────────────┘
```

**A2UI 在 DeepOrca 承载两类能力（与 DeepDesign 三者并存，互不替代）**：

| 能力 | 受众 | 归属 | 一句话定位 |
|------|------|------|-----------|
| **AI-native 原型模块** | 产品经理 | §六 设计生成（独立产品线） | 自然语言驱动的原型设计，Surface 为载体，原生依赖 DeepOrca |
| **对话交互层升级** | 所有用户 | §十 引擎演进 | 对话区从纯文本升级为可交互富组件 |
| _（对比）DeepDesign_ | _设计师_ | _§六 设计生成_ | _品牌一致的设计交付件，HTML 为载体，可脱离宿主_ |

> 原型模块与 DeepDesign 的逐维对比见 §2.1。本节只点明：**原型 ≠ 设计**，A2UI 原型 ≠ DeepDesign 迭代。

> **结论**：A2UI 与 DeepDesign 是**两个不同的产品**，不是替代关系。DeepDesign 是「设计」（设计师向，产出可交付的设计件，类 OpenDesign/ClaudeDesign）。A2UI 在 DeepOrca 里承载的是**两类截然不同的能力**：
> - **对话交互层升级**（§2 场景 1/2/4）—— 把对话区从纯文本升级为可交互富组件。
> - **AI-native 原型模块**（§2 场景 3）—— 一个**独立的、面向产品经理**的原型设计产品，详见 §2.1。

## 2. 场景清单与优先级

A2UI 的独有价值在于三选一即可——**(a) 双向交互**（用户操作回流 agent）、**(b) 流式/增量更新**（agent 持续 patch 而非重写）、**(c) 结构化数据**（树/表/卡，markdown 表达差）。满足任一即「强匹配」；都不满足的，markdown 够用，A2UI 是过度设计。**核心原则：对话区不全替换，仅对特殊场景强化。**

### 2.0 优先级总览（用户拍板）

| 优先级 | 内容 | 理由 |
|--------|------|------|
| **前置（最高优先级）** | **MCP SDK 迁移**（独立 spec） | A2UI 深度依赖 MCP（`_meta`/embedded resource/`a2ui_action` 双向回流）。先打地基，避免 A2UI server 写完再返工 + 重复测试兼容性 |
| **P0（最核心卖点）** | **AI-native 原型模块**（§2.1） | DeepOrca 的差异化存在，类 v0/bolt 但以 Surface 为载体 |
| **P1（项目核心模块）** | 用户决策（§2.2）+ 持续状态监控（§2.3）+ 工作流（§2.4） | 每次会话都发生，markdown 做不到的「活面板」 |
| **P2（待基础能力测试完）** | 代码审查 / git / wiki 富展示（§2.5） | 依赖这些模块的成熟度，用户需先测完基础能力 |
| **边界** | §2.6 明确不做的 | 防止范围蔓延 |

### 2.1 P0 — AI-native 原型模块 ⭐ 最核心卖点

**这不是「DeepDesign 的迭代版本」，而是一个独立产品。** 必须明确区分：

| 维度 | **DeepDesign**（设计师向） | **AI-native 原型模块**（产品经理向） |
|------|----------------------------|--------------------------------------|
| **受众** | 设计师 / 追求设计交付件的开发者 | 产品经理 / 产品负责人 |
| **输入** | 设计系统（DESIGN.md 品牌契约）+ 模板组合 | **自然语言**（产品需求、流程描述、用户故事） |
| **产物本质** | 设计（视觉表现层，品牌一致） | 原型（结构与流程，交互逻辑验证） |
| **类比** | OpenDesign / Claude Design | v0/bolt 这类 AI 原型工具，但以 Surface 为载体 |
| **格式** | 自包含 HTML 文件（`.deeporca/designs/*.html`） | **声明式 Surface**（A2UI JSON，独特格式） |
| **能否脱离宿主** | ✅ 能（成品交付件，谁都能打开） | ❌ **不能**——原生依赖 DeepOrca 运行时 |
| **更新方式** | 重写整个 HTML 文件 | 自然语言对话 → `updateComponents` 增量 patch |
| **交互** | 死的 | `a2ui_action` 双向闭环（点击按钮、填表单、走流程） |
| **目标** | 产出可交付的设计稿 | 快速表达产品想法、验证交互流程、与开发对齐 |

**核心机制**：产品经理用**自然语言**描述需求（「做一个订单管理页面，左侧是订单列表，点开右侧显示详情和状态流转」），Agent 产出 A2UI Surface 原型。PM 继续用自然语言迭代（「把状态流转改成下拉」「加一个批量操作栏」），Agent 增量 patch Surface。PM 可以**点击原型跑通交互流程**验证逻辑。

**为什么必须依赖 DeepOrca**：原型是**声明式 Surface 数据**而非自包含代码，渲染依赖 `@a2ui/react` 运行时 + `MessageProcessor`；交互回流依赖 DeepOrca 的 agent loop + `a2ui_action`。这正是「AI-native」的含义——原型不是一份文件，而是一个**与 Agent 持续对话的活对象**。脱离 DeepOrca 即失去这些能力。

**独特格式**：A2UI Surface 的 adjacency-list 扁平结构 + JSON Pointer 数据绑定，与 DeepDesign 的 HTML/CSS 是**两种不同的格式体系**，互不通用、互不转换。

### 2.2 P1 — 用户决策与输入（agent 向用户要信息）

| # | 场景 | DeepOrca 锚点 | 现状痛点 | A2UI 形态 | 匹配 |
|---|------|--------------|---------|----------|------|
| 1 | **结构化表单输入** | `AskUserQuestion` | 只能单选/多选 | 带数据绑定的表单 Surface，状态回流 agent | 强 (a) |
| 2 | **权限请求卡片** | `AskPermissionRequest`（sideEffects） | "是否允许？" 纯文本，副作用不直观 | 操作说明卡（操作内容 + 影响范围 + 副作用标签如 `delete-in-cwd`/`network`），知情后批准/拒绝 | 强 (a)(c) |
| 3 | **Plan 审批面板** | Plan Mode `proposed_plan` | markdown 计划文本，逐项质疑不便 | 结构化计划审批（步骤列表 + 可逐项质疑/批准） | 中 (a) |
| 4 | **方案对比** | agent 给多方案时 | 利弊对比挤在文本 | 多列对比卡（方案 × 维度矩阵） | 中 (c) |

> 这组是 agent ↔ 用户交互的「门面」。权限卡片（#2）尤其值得 P1 首发——它是 DeepOrca 安全模型（AGENTS.md 权限系统）的用户触点，markdown 表达副作用标签很弱，Surface 能让用户真正「知情同意」。

### 2.3 P1 — 持续状态与监控（agent 维护持续更新的活面板）

这是 markdown **完全做不到**的域——需要「活」面板。

| # | 场景 | DeepOrca 锚点 | 现状痛点 | A2UI 形态 | 匹配 |
|---|------|--------------|---------|----------|------|
| 5 | **任务看板** | `UpdatePlan` | markdown TODO 纯文本，无实时刷新 | 可勾选、实时刷新进度的看板 Surface | 强 (a)(b) |
| 6 | **后台进程监控** | bash 后台任务（onProcessStart/Exit/Stdout） | ProcessStdout 文本流，无法管理 | 进程面板（PID/状态/输出流/停止按钮），可交互控制 | 强 (a)(b) |
| 7 | **长任务进度** | codegraph/CRG/wiki 索引（Progress 事件流） | 文本进度流 | 进度条 + 阶段指示器 Surface，实时更新 | 强 (b) |
| 8 | **会话导航** | 会话历史/压缩 | 会话列表纯文本 | 会话时间线 + 压缩摘要导航 | 中 (c) |

> 进程监控（#6）和长任务进度（#7）是 DeepOrca 每次会话都在发生的（索引、审查、构建），用户痛感最强，且双向/流式特性用得最充分——**可能比工具结果富展示更该进 P1 首发**。

### 2.4 P1 — 工作流编排（agent 引导用户走多步流程）

| # | 场景 | DeepOrca 锚点 | 现状痛点 | A2UI 形态 | 匹配 |
|---|------|--------------|---------|----------|------|
| 9 | **调试向导** | 系统化调试流程（假设→验证→结论） | 调试状态散在对话 | 分步调试面板（当前假设/已验证/下一步） | 中 (a)(b) |
| 10 | **重构步骤面板** | agent 执行多步重构 | 步骤散在对话，无回滚视图 | 重构步骤清单（可标记/回滚） | 中 (a) |

### 2.5 P2 — 工具结果富展示（待基础能力测试完）

> **P2 暂缓理由**（用户明确）：代码审查 / git / wiki 这些模块用户还未完整测试过基础能力，待测完再强化展示。先确保它们的核心功能稳，再谈 Surface 增强。

| # | 场景 | DeepOrca 锚点 | 现状痛点 | A2UI 形态 | 匹配 |
|---|------|--------------|---------|----------|------|
| 11 | **代码符号树** | codegraph（符号级导航） | 符号嵌套关系压成 markdown 缩进 | 可折叠/可搜索的符号树 Surface，点击展开 | 强 (c) |
| 12 | **Git 状态/历史** | `git status`/`log`/`diff` | 文件列表+提交日志+diff 全是文本 | 文件变更列表（可勾选 stage）+ 提交时间线 + 行内 diff 卡 | 强 (a)(c) |
| 13 | **代码审查结果** | ocr（ReviewComment: file/line/severity） | 审查评论按 severity 散落 | 按严重度分组的评论列表，点击跳转文件 | 强 (a)(c) |
| 14 | **代码审查图** | CRG（风险/影响/架构分析） | 图关系压成文本 | 风险热力卡 + 影响传播链 Surface | 强 (c) |
| 15 | **搜索结果** | WebSearch、gitmcp search | 链接+摘要纯文本流 | 结果卡片（来源/摘要/可点击展开） | 中 (c) |
| 16 | **Wiki/文档导航** | openwiki（WikiPageEntry） | 页面列表纯文本 | 可导航的 wiki 页面树 | 中 (c) |

### 2.6 明确不做的（边界，防范围蔓延）

| 场景 | 为什么不用 A2UI |
|------|----------------|
| **DeepDesign 成品交付** | 成品要脱离宿主，HTML 文件才是正解（§1 已定边界） |
| **Bento 演示文稿** | 同上，`.bento.html` 是交付件 |
| **agent 推理/thinking 展示** | 线性叙事，markdown 更合适，无需交互 |
| **纯文本对话本身** | 对话流是核心，不该 UI 化 |
| **代码编辑器** | Monaco 已是专业工具，A2UI 的 TextField 替代不了 |
| **一般性 chat 回复** | 强行加 Surface 反而打断阅读流 |

## 3. 技术选型（带依据，可质疑）

### 3.1 渲染器：官方 `@a2ui/react`（非自研）✅

**依据**：调研推翻了「只有 Angular」的早期印象。官方 React 渲染器 `@a2ui/react` v0.10.0 已 **✅ Stable**（v0.8 + v0.9.1）：

- `peerDeps`: `react ^18 || ^19` —— 与 DeepOrca React renderer 栈**直接兼容**。
- `license`: **Apache-2.0** —— 与本项目许可无冲突。
- Basic Catalog 组件齐全，四个场景所需组件**全部内置**：
  - 布局：`Row`/`Column`/`List`/`Card`/`Tabs`/`Modal`/`Divider`
  - 内容：`Text`/`Image`/`Icon`/`Video`/`AudioPlayer`
  - 输入：`Button`/`TextField`/`CheckBox`/`ChoicePicker`/`Slider`/`DateTimeInput`
- 提供 `MessageProcessor`（来自 `@a2ui/web_core`，框架无关核心）+ `<A2uiSurface>` React 组件，集成面收敛。
- 带 `visual-parity/` 视觉一致性测试，质量可信。

> ⚠️ 摩擦点：包用 **CSS Modules**（`.module.css`），需确认 DeepOrca 的 esbuild renderer 构建链（`packages/desktop/build.mjs`）能正确处理 `*.module.css`。这是落地第一件要验证的事（见 §9 风险 R1）。

### 3.2 传输形态：A2UI over MCP（非注入 `generate_a2ui` 工具）✅

DeepOrca 内置工具**刻意保持 7 个最小集**（AGENTS.md 硬约束），不会新增内置工具。而 DeepOrca **已有完整 MCP 客户端**（`McpManager`/`McpClient`，`tools/list` 缓存 + `tools/list changed` 通知刷新全部现成）。A2UI 官方的「A2UI over MCP」形态与之**天然契合**：

- A2UI JSON 包在 `CallToolResult` 的 `EmbeddedResource` 里，MIME `application/a2ui+json`。
- 双向交互的 `a2ui_action` 就是又一个 MCP 工具调用，走同一个 `ToolExecutor`，**零新机制**。
- capability 协商走 MCP `initialize` 的 `capabilities` 字段（声明支持哪些 catalog）。

### 3.3 Server：自研 Node MCP server（先用现有手写实现，迁移后换 SDK server）

**问题**：官方三个 MCP sample（`a2ui-over-mcp-recipe` / `a2ui-in-mcpapps` / `mcp-apps-calculator`）**全是 Python**（`server.py` + `pyproject.toml` + `uv.lock` + Starlette + uvicorn）。

**为什么不直接用**：
1. DeepOrca 的 MCP 生态**全是 Node**（CodeGraph 走系统 Node 22+ 二进制见 `codegraph.ts`；dart/serena/expo/harmonyos 全是 `npx` 或 Node MCP）。引入 Python server 破坏「纯 Node MCP」一致性，违背 `codegraph.ts` 既有的「系统 Node 22+ 二进制」模式。
2. `vendor-uv.js` 已为 OpenWiki 引入了 uv，但那是**只读文档索引**，可降级到 `npx` 兜底；A2UI 是**交互核心**，不能容忍 uv 缺失时的降级。
3. 读 `samples/mcp/a2ui-over-mcp-recipe/server.py` 发现：**A2UI JSON 是手写模板**（`recipe_a2ui.json`），server 逻辑极薄——`deep copy 模板 → 改 updateDataModel.value → 包成 EmbeddedResource`。Python 只用来跑 catalog **schema 校验**（`BasicCatalog.get_config` / `validator.validate`），并无硬性 Python 依赖。

**建议**：自研一个轻量 Node A2UI MCP server，**先用 DeepOrca 现有的手写 JSON-RPC 循环**（仿 `gitmcp/rpc.ts`，见配套实施计划 Task 2-5），catalog 校验在构建期离线做，运行时只做模板拼装。

> **关于「手写 vs 官方 `@modelcontextprotocol/sdk`」**：这是真实的架构债——DeepOrca 的 MCP 全手写，落后官方两个协议版本，且**致命缺口是 server→client 请求全死**（sampling/roots/elicitation，因客户端声明 `capabilities: {}` 且路由器丢弃带 id 的 server 请求）。但 SDK 迁移是横跨整个 MCP 子系统的独立工程（987+230 行 + ~10 测试 + 6 调用点），**不作为本 spec 的前置 P0**——理由：
> - A2UI 的 Surface 透传（`ToolExecutionResult.metadata` + MCP `_meta`）在**现有手写实现已能工作**，A2UI 不依赖 SDK；
> - 反过来，SDK 迁移会让 A2UI 的 server 任务（计划 Task 2/3/5/6/7/8）全部返工；
> - 两个捆一起会互相拖累。
>
> **正确顺序**：A2UI 用手写实现先落地（拿产品价值）→ SDK 迁移独立立项 → 迁移后 A2UI server 顺势从手写换成 SDK server，`_meta`/embedded resource 变协议原生。详见 `docs/research/2026-07-mcp-sdk-migration.md`。

### 3.4 渲染器位置：主窗口内 React 富消息 ✅（我选的「最佳/最稳定」方案）

用户委托我选渲染器位置。三个候选我选**主窗口内 React 组件**：

| 方案 | 评价 |
|------|------|
| **A. 主窗口内 React 富消息（选）** | Surface 作为对话消息的一种富类型插入（紧贴工具结果消息）。最集成、上下文不割裂、与现有 `Message.tsx` 一脉相承。复用 `@a2ui/react` 的 `<A2uiSurface>`。唯一成本：自研/绑定几个 DeepOrca 专属 catalog 组件（如符号树）。 |
| B. 独立 Electron 窗口/标签页 | 隔离干净，但割裂与对话的上下文，且要把 `a2ui_action` 跨窗口 IPC 回传，复杂。适合场景 3「原型设计」的「全屏预览」模式，可作为 P2 增量。 |
| C. 嵌入式 webview/iframe 跑外部渲染器 | 省去自研，但引入外部依赖、样式不统一、IPC 复杂、CSP 风险。**不选**。 |

**架构**：主窗口 React 内挂一个全局 `MessageProcessor`（单例），各 Surface 作为富消息渲染。场景 3 的全屏原型预览可在 P2 用独立窗口增量加（同一 processor，不同挂载点）。

## 4. 层规则（守住 AGENTS.md 红线）

- **core 必须 UI-free**：A2UI 的 JSON 生成与 MCP 传输放 **core**；`@a2ui/react` 渲染、`MessageProcessor` 宿主放 **desktop renderer**。core 只产出/转发 `application/a2ui+json` 负载，绝不 import react。
- **不新增内置工具**：A2UI 走 MCP server，不进 7 个内置工具之列。
- **IPC 契约单一来源**：`a2ui_action`/`a2ui_error` 的回流路径，新增通道写进 `packages/desktop/src/shared/ipc.ts`，两端同步，**不在 renderer 里 ad-hoc `ipcRenderer`**。
- **遵循 3-gate 模式**：新 MCP server（若自研）沿用 dart/serena/expo 的「项目检测 + 禁用标志 + 用户覆盖」三道门，UI 可在设置面板开关。

## 5. 架构总览

```
┌─ core (UI-free) ─────────────────────────────────────────────┐
│  mcp/a2ui-mcp.ts        新增 Node MCP server（stdio）          │
│   ├─ 注册工具: render_surface / update_surface / a2ui_action  │
│   ├─ catalog: Basic Catalog JSON（离线校验后内联）             │
│   └─ templates/: 场景 1-4 的手写 A2UI JSON 模板                │
│  tools/executor.ts      识别 EmbeddedResource + a2ui mime      │
│   └─ 结果序列化新增分支: { ok, name, a2ui: {surfaceId,...} }   │
│  common/openai-message-converter.ts  a2ui_action 作为工具调用  │
└───────────────────────────────────────────────────────────────┘
          ▲ MCP stdio (CallToolResult.EmbeddedResource)  ▼ a2ui_action
┌─ desktop ────────────────────────────────────────────────────┐
│  shared/ipc.ts          新增 A2uiAction / A2uiSurfaceEvent     │
│  main/session-bridge.ts 把 a2ui 负载事件转发给 renderer        │
│  renderer/                                              │
│   ├─ a2ui/  新增: 单例 MessageProcessor + Catalog 注册         │
│   ├─ components/A2uiMessage.tsx  富消息渲染 <A2uiSurface>      │
│   └─ components/Message.tsx    消息分支: type==='a2ui'         │
└───────────────────────────────────────────────────────────────┘
```

## 6. 关键改动点（按文件）

| 文件 | 改动 | 层 |
|------|------|----|
| `packages/core/src/mcp/a2ui-mcp.ts` | **新增** Node A2UI MCP server（模板拼装 + EmbeddedResource 返回） | core |
| `packages/core/src/index.ts` | 导出 server 注册函数 | core |
| `packages/core/src/tools/executor.ts` | `serializeToolResult` 识别 `application/a2ui+json`，加 `a2ui` 字段 | core |
| `packages/core/src/session.ts` | `augmentMcpServersWithBuiltins` 注册 a2ui server（3-gate） | core |
| `packages/core/templates/a2ui/` | **新增** catalog + 场景模板 JSON | core |
| `packages/core/templates/skills/bundled/a2ui-prototype/SKILL.md` | **新增** AI-native 原型模块的工作流 Skill（自然语言→Surface 原型→增量迭代，§2.1 场景 3 专属） | core |
| `packages/desktop/src/shared/ipc.ts` | 新增 `A2uiSurfaceRender` 事件 + `A2uiAction` 请求类型 | shared |
| `packages/desktop/src/main/session-bridge.ts` | a2ui 负载事件 → renderer；renderer action → core | desktop |
| `packages/desktop/src/renderer/a2ui/processor.ts` | **新增** 单例 `MessageProcessor` + basicCatalog + DeepOrca 自定义 catalog | renderer |
| `packages/desktop/src/renderer/components/A2uiMessage.tsx` | **新增** 富消息渲染（对话交互层：场景 1/2/4） | renderer |
| `packages/desktop/src/renderer/components/PrototypeSurface.tsx` | **新增** 原型模块渲染面（场景 3，可全屏，独立于对话流） | renderer |
| `packages/desktop/src/renderer/components/Message.tsx` | 消息分支 `type === "a2ui"` | renderer |
| `packages/desktop/build.mjs` | esbuild 配 CSS Modules（验证/配置） | build |

## 7. 实施阶段（用户拍板的优先级）

> **执行顺序的总纲**：先 MCP SDK 迁移（前置）→ 再 A2UI（基于 SDK，避免返工）。A2UI 内部按 P0 原型模块 → P1 决策/监控/工作流 → P2 工具结果富展示。

### 前置（最高优先级，独立 spec）— MCP SDK 迁移
- 把手写 MCP（客户端 + gitmcp 服务端）迁移到 `@modelcontextprotocol/sdk`。详见 `docs/research/2026-07-mcp-sdk-migration.md` + 独立 spec。
- **为什么是前置**：A2UI server 深度依赖 MCP（Surface 经 `_meta`/embedded resource 透传，`a2ui_action` 双向回流）。先把 MCP 打成 SDK 地基，A2UI server 直接基于 SDK server 写，**省一次返工 + 一次兼容性回归**。
- **此 spec 假定 SDK 迁移已完成**——下面的 Server 任务（§6）基于 SDK `Server` + `StdioServerTransport`，不再用 gitmcp 手写循环。

### A2UI P0.5 — 技术咽喉验证（迁移后第一件事）
- **R1 验证**：在 desktop renderer 构建链里跑通 `@a2ui/react` 的 CSS Modules（`.module.css`）。若 esbuild 不支持，配 `css-loader` modules 或用 `injectStyles`。**这是整个 A2UI 方案的技术咽喉**，必须先验证。

### A2UI P0 — AI-native 原型模块（最核心卖点，§2.1）
- 接入 `@a2ui/react` + `MessageProcessor`（单例），渲染 basicCatalog 的一个 hello Surface。
- 原型 Skill（`a2ui-prototype/SKILL.md`）：自然语言 → `render_prototype` → Surface 原型 → 同 surfaceId 增量迭代闭环。
- 打通 `a2ui_action` 全链路（renderer → IPC → core → agent → 增量 patch）。
- 这是 DeepOrca 的差异化存在，P0 首发即承载完整产品价值。

### A2UI P1 — 项目核心模块（决策 + 监控 + 工作流）
- **持续状态监控**（§2.3 #5-7）：UpdatePlan 看板、后台进程监控、长任务进度——这三者 markdown 完全做不到，用户痛感最强。
- **用户决策**（§2.2 #1-2）：结构化表单输入（AskUserQuestion 增强）、权限请求卡片（安全模型触点）。
- **工作流**（§2.4 #9-10）：调试向导、重构步骤面板。
- 全部复用 P0 已建好的 Surface 基础设施，边际成本低。

### A2UI P2 — 工具结果富展示（待基础能力测试完，§2.5）
- 代码审查（ocr）/ git / wiki / codegraph 等模块的富展示。
- **暂缓理由**：这些模块用户还未完整测过基础能力，待测稳后再 Surface 强化。先 P0/P1 拿到对话交互层的核心价值。

### A2UI P3 — 增强
- 原型模块独立窗口全屏预览模式。
- DeepOrca 自定义 catalog 组件（看板卡片、流程节点、符号树等）。
- 原型会话持久化。

## 8. 与既有规划的关系（roadmap 影响）

- **§六 设计生成**：DeepDesign 不变（静态 HTML 成品交付，用已规划的 `<webview>` 面板）。**新增「AI-native 原型模块」作为独立产品线**，与 DeepDesign 并列（设计 vs 原型，受众与格式都不同，见 §2.1）。
- **§十 引擎演进**：新增「A2UI 对话交互层」条目（场景 1/2/4），与 Plan Mode / UpdatePlan 并列。
- **不与 §八 浏览器**混：A2UI Surface 在主窗口 React 内，不走 bsk/webview。

## 9. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|------|------|------|
| R1 | esbuild 不支持 `.module.css` | 渲染器无法集成 | P0 先验证；退路：`injectStyles` 或 css-loader |
| R2 | `@a2ui/react` 体积/依赖（zod/markdown-it） | renderer bundle 膨胀 | 构建后量体积；必要时按需 import |
| R3 | Agent 产出 A2UI JSON 不可靠（若走方案 C 让 LLM 直出） | Surface 渲染失败 | 默认走 MCP server 模板拼装（方案 A），LLM 不直出 JSON；renderer 做 schema 校验 + 渲染失败降级到 TextContent（官方最佳实践） |
| R4 | 安全：恶意 agent 钓鱼/XSS/DoS | 欺骗用户 | 遵守官方安全条款——外部 agent 视为不可信，CSP + 输入消毒 + 限制 Surface 复杂度 |
| R5 | catalog 版本漂移（v0.9 → v1.0） | 渲染不兼容 | 锁定 `@a2ui/react@0.10`，关注 v1.0 `actionResponse` |
| R6 | A2UI 协议本身仍在演进（roadmap 标 v1.0 candidate） | 未来返工 | 限定在「富消息」域，不把核心 agent loop 绑死协议 |

## 10. 待确认（需用户拍板）

1. ~~**§3.3 Server 来源**~~：已定——自研 Node server，**先用现有手写实现**（仿 gitmcp/rpc.ts）。官方 Python sample 不用。SDK 迁移另立独立项（见 §3.3 末尾 + `docs/research/2026-07-mcp-sdk-migration.md`）。
2. **§7 P1 范围**：已定——原型模块 + 富工具结果（见实施计划 Task 13/14）。
3. **是否接受 `@a2ui/react` 作为新增运行时依赖**（带 zod/markdown-it 传递依赖进 renderer bundle）。
4. **SDK 迁移的定位与时机**：是否同意「独立立项、A2UI 落地后再做」？还是希望现在就启动 SDK 迁移（届时 A2UI 计划需相应调整）？
