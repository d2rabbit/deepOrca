# PI-SDK (pi-agent) 作为派生 Agent 的可行性调研

> 日期：2026-08-14 · 分支：fix/stabilize-data-loss-and-test-suite
> 调研对象：[earendil-works/pi-mono](https://github.com/earendil-works/pi-mono)（原 `badlogic/pi-mono`，Mario Zechner；npm `@earendil-works/pi-*`），官方文档 pi.dev/docs
> 对照面：DeepOrca `packages/core` 的 SessionManager / ToolExecutor / 权限 / 记忆 / 路由各集成接缝
> 结论先行：**可行，且建议以「派生子 agent」方案切入**——pi-agent-core 的许可（MIT）、UI-free 分层、注入式设计与 deeporca 架构哲学高度相容；真正的成本不在「能不能跑」，而在权限桥、MCP 工具桥、双引擎行为一致性三处。**不建议替换核心循环**（会丢弃 session-index 不变量、权限体系、compaction 调优等独占资产）。

---

## 一、调研对象确认

"PI-SDK / pi-agent" 即 Pi agent harness，npm 上以 `@earendil-works/pi-*` 命名空间发布：

| 包 | 角色 | 与 deeporca 的对位 |
| --- | --- | --- |
| `@earendil-works/pi-ai` | 统一多 provider LLM API（OpenAI / Anthropic / Google / 自定义 provider） | `CreateOpenAIClient` 工厂 + `settings.ts` 端点预设 |
| `@earendil-works/pi-agent-core` | **agent 运行时**：有状态 agent loop、工具执行、事件流 | `SessionManager` + `ToolExecutor` |
| `@earendil-works/pi-coding-agent` | 完整 CLI（含编程式 SDK `createAgentSession()`、扩展、技能、RPC 模式） | 整个 deeporca desktop+core |
| `@earendil-works/pi-tui` | 终端 UI | 不需要（我们用 Electron） |

### 基本面

- **协议**：MIT ✅
- **版本**：`pi-agent-core` 当前 0.84.1（0.x，迭代极快，约半个月 0.74→0.84）
- **运行时**：Node ≥ 20（本仓库要求 22 ✅）；ESM ✅
- **依赖**：克制——`typebox`、`pi-ai`、`pi-telemetry`、`diff`/`yaml`/`ignore`
- **社区**：热度极高，但**官方对新贡献者的 issue/PR 默认自动关闭**——上游支持通道有限，要有 fork/vendor 自理的准备

### pi-agent-core 核心 API

```ts
new Agent({
  initialState,      // systemPrompt, model, tools, messages
  streamFn,          // 必需，绑自 pi-ai models.streamSimple
  convertToLlm,      // 自定义消息类型 → LLM 消息
  transformContext,  // 对位 deeporca compaction
  beforeToolCall / afterToolCall,  // 可阻断执行 —— 权限桥接缝
  toolExecution: "parallel" | "sequential",
});
```

- 事件流 `agent.subscribe()`：`agent_start / turn_start / message_update（含 text_delta）/ tool_execution_* / turn_end / agent_end`
- 控制面：`prompt() / steer() / followUp() / abort() / waitForIdle() / reset()`
- 工具：TypeBox schema + `execute(toolCallId, params, signal, onUpdate)`

### pi 没有的东西（重要）

- **无内建权限沙箱**——官方建议用 `beforeToolCall` 钩子自建
- **无内建 sub-agent API**——需自行再开 Agent 实例
- session 持久化默认 JSONL 树结构（支持 branch/fork），SQLite 后端是独立包

## 二、与本仓库架构的匹配度

### ✅ 匹配良好的点

1. **分层规则兼容**：pi-agent-core 本身 UI-free（TUI 是独立包），满足「core 不得依赖 UI」的硬约束。
2. **Provider 兼容**：deeporca 调优对象是 DeepSeek（OpenAI 兼容端点），pi-ai 原生支持 OpenAI-compatible + 自定义 provider，接入 DeepSeek 无障碍，还能顺带获得多 provider 能力。
3. **宿主注入模式一致**：pi 的 `streamFn`、`getApiKey`、自定义 provider 都是注入式，与 deeporca「vendored 路径/日志器宿主注入」的哲学同构。
4. **现成的派生接缝**：deeporca 已有 `SessionManager.runSubagent()`（`packages/core/src/session.ts:805`）+ `ActionRegistry`（`packages/core/src/actions/`）这套「定义一次、处处可用」的委派原语，外部 agent loop 可以作为一个 action 落地，无需动核心循环。

### ⚠️ 需要桥接/权衡的点

1. **功能高度重叠**——agent loop、工具执行、流式事件、compaction（pi 叫 `transformContext`）、session 持久化两边都有。**引入 pi 不是补空白，而是「第二引擎」**，本质是 replace/derive 决策，要警惕双引擎长期行为分叉（prompt 布局、tool result 格式都是针对 DeepSeek 调过的）。
2. **权限体系是 deeporca 独占资产**：`computeToolCallPermissions`（sideEffects 声明、Plan Mode 强制 ask，`packages/core/src/common/permissions.ts:152`）在 pi 侧只能靠 `beforeToolCall` 钩子重建——可行且桥接点干净，但属于必做项。
3. **扩展模型不同**：deeporca 是 MCP-centric（7 个极简内建工具 + MCP）；pi 是 TypeScript 扩展模块 + skills。派生 agent 若要复用现有 MCP server，需写 pi AgentTool ↔ MCP 工具桥（含 TypeBox schema 转换）。
4. **MemoryProvider / 语义路由**（L0–L3 记忆、SkillRouter/ToolRouter）需通过 pi 的 `transformContext` / 系统提示注入重新挂接，工作量中等。
5. **风险项**：
   - 0.x 快速 churn + 上游 issue 自闭 → 建议**锁版本 + vendor/fork 策略**，对齐本仓库既有 vendor 机制（`scripts/vendor-*`）。
   - 0.84 新增 `pi-telemetry` 依赖、pi-ai 有远端模型目录拉取（可用 `PI_OFFLINE` 关闭）——需审计外呼行为。
   - 事件模型差异即机会：deeporca 目前**没有逐 token 文本 delta 回调**（只有整消息 `onAssistantMessage` + token 估算 `onLlmStreamProgress`），pi 有原生 `text_delta`，派生管线可顺带升级流式体验。

## 三、三种集成方案对比

| 方案 | 做法 | 工作量 | 风险 | 评价 |
| --- | --- | --- | --- | --- |
| **A. 派生子 agent**（推荐试点） | pi loop 作为 `runSubagent`/`ActionRegistry` 背后的隔离运行时，事件映射回 `SessionMessage` 流，权限走 `beforeToolCall`→`computeToolCallPermissions` | 小-中 | 低 | 不动核心循环，可灰度、可回退，最契合现有委派原语 |
| **B. 适配器引擎** | 实现 `SessionManagerOptions` 五回调契约（`onAssistantMessage` 等），pi 引擎与现有引擎并列，由 SessionBridge 无感切换 | 中 | 中 | 需完整桥接工具/权限/记忆/MCP，但契约边界清晰 |
| **C. 替换核心循环** | pi-agent-core 取代 SessionManager agent loop | 大 | **高** | 会丢弃 AGENTS.md 明示的 session-index 不变量、debounce 语义、权限体系、compaction 调优——**不建议** |

## 四、结论与建议

**可行，以方案 A（派生子 agent）切入最稳妥。**

建议的验证 spike（仍属调研性质，不写产品代码）：

1. 用 pi-ai 直连 DeepSeek 端点跑通 streaming + tool calling（验证 provider 兼容）；
2. 写一个 `beforeToolCall` → `computeToolCallPermissions` 的最小桥接 PoC（验证权限 parity）；
3. 评估 pi 事件 → 现有五个 IPC 事件（`event:assistantMessage` 等，`packages/desktop/src/shared/ipc.ts`）的映射保真度，顺带评估引入 `text_delta` 的收益；
4. 确定版本锁定与 vendoring 方案（`vendor-src/` + 编译进 `packages/desktop/vendor/`，复用现有 `scripts/vendor-*` 机制）。

## 附：调研信息来源

- pi.dev/docs/latest（含 /sdk、/extensions 子页）——SDK、Agent API、扩展模型
- npm registry `@earendil-works/pi-agent-core`——版本、依赖、engines、协议
- github.com/earendil-works/pi-mono——monorepo 结构、维护策略（issue 自闭）、供应链加固（依赖锁版本）
- 本仓库 `packages/core/src/session.ts` / `tools/executor.ts` / `common/permissions.ts` / `actions/types.ts` 集成面盘点
