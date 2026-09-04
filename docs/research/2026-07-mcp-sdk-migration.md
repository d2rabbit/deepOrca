# 官方 MCP SDK 迁移可行性调研报告

> 日期：2026-07-30 · 状态：调研完成 · **已采纳**
> 目的：评估 DeepOrca 手写 MCP 实现是否应迁移到官方 `@modelcontextprotocol/sdk`。
> 触发：A2UI 集成调研中确认「DeepOrca 没有 SDK 依赖、全手写」，质疑手写实现无法适配新特性。
> 结论先行：**应迁移，且定为最高优先级前置**（A2UI 深度依赖 MCP，先打 SDK 地基可省一次返工 + 一次兼容性回归）。详见 §六。

---

## 一、现状：DeepOrca 的 MCP 全是手写

DeepOrca **没有** `@modelcontextprotocol/sdk` 依赖。客户端和服务端都是手写 JSON-RPC：

| 文件 | 行数 | 角色 |
|------|------|------|
| `packages/core/src/mcp/mcp-client.ts` | 462 | 客户端：stdio spawn + JSON-RPC 收发 |
| `packages/core/src/mcp/mcp-manager.ts` | 525 | 生命周期、命名空间、重连 |
| `packages/core/src/gitmcp/rpc.ts` | 120 | 服务端：手写 stdio JSON-RPC 循环 |
| `packages/core/src/gitmcp/server.ts` | 115 | gitmcp MCP server handlers |
| `packages/core/src/gitmcp/tools.ts` | 175 | gitmcp 工具体 |
| **合计** | **1397** | |

**作者当初手写的理由**（`specs/gitmcp-local-module/design.md` 明说两处）：
1. 避免新依赖进 core
2. 避免 bundling 复杂度（gitmcp server 要 standalone bundle，见 `gitmcp/server.ts:13-17`）

> 不是 NIH——是刻意的「协议面小（5 个方法）、~100 行手写、避免新依赖」决策。但**这个决策是在 MCP 还很小的时候做的**，现在协议已大幅扩张。

---

## 二、能力差距矩阵（手写 vs 官方 SDK v1.30.0）

### 协议与传输

| 能力 | DeepOrca 现状 | 官方 SDK |
|------|--------------|----------|
| 协议版本 | `2025-03-26` + `2024-11-05` 硬编码，其它**拒绝** | 实现「full spec」，跟到最新 |
| stdio 传输 | ✅ | ✅ |
| SSE 传输 | ❌ | ✅（向后兼容） |
| **Streamable HTTP** | ❌ | ✅（远程服务器默认） |
| 批量请求（收） | ✅ 部分（解析但不发） | ✅ |

### server→client 请求（最大缺口）

| 能力 | 现状 | 说明 |
|------|------|------|
| `sampling/createMessage`（server 回问 LLM） | ❌ | 客户端声明 `capabilities: {}`，**且路由器静默丢弃所有 server 发起的带 id 请求**（`mcp-client.ts:383`） |
| `roots/list`（server 发现工作区根） | ❌ | 同上 |
| `elicitation/create`（2025-06-18，server 问用户） | ❌ | 同上 |

> **这是致命缺口**：因为客户端路由器把「不在 pending map 里的带 id 消息」当 no-op 丢弃，**任何需要回问宿主的 MCP server 都无法工作**。这是生态里增长最快的一类。

### 工具结果内容类型

| 类型 | 现状 |
|------|------|
| text | ✅ |
| image / audio / embedded resource | ❌（类型只有 `{type:string; text?:string}`，非 text 全丢） |
| structured content（`outputSchema`，2025-06-18） | ❌ |
| `_meta` 读取 | ❌（从不读不存） |

---

## 三、可行性：迁移的拦路虎基本不存在

官方 SDK 的几个常见摩擦点，在 DeepOrca **刚好都已被绕过**：

| 摩擦点 | 通常风险 | DeepOrca 情况 |
|--------|---------|---------------|
| `zod` 版本冲突 | SDK 要求 zod v3.25+，内部用 v4 | **已用 `zod ^4.4.3`**（core/package.json:37）→ **完全兼容** |
| `globalThis.crypto` polyfill | 老 Node/Electron 缺 WebCrypto | **Node 22 原生支持**（19+ 自带）→ 基本免 polyfill |
| 传输 | 远程 server 需 HTTP | 现仅 stdio → 迁移**免费拿到 Streamable HTTP** |
| 双向请求 | 手写难支持 sampling/roots | SDK 内建 → 迁移**免费拿到三大能力** |

**唯一真实成本**：gitmcp server 的 standalone bundle 会变大（引入 SDK 依赖）。但这是可控工程问题，且 desktop main bundle 已把 core 当 external（`build.mjs:111`），影响面有限。

---

## 四、工作量评估（blast radius）

### 代码改动
- `mcp-client.ts`（462 行）→ 删除/替换为 SDK `Client` + `StdioClientTransport`
- `mcp-manager.ts`（525 行）→ 大部分（命名空间/重连/transport-agnostic 逻辑）**保留**，仅 `new McpClient` → SDK `Client`，及 connect/listTools/callTool 调用替换
- `gitmcp/rpc.ts`（120 行）→ 删除，换 SDK `Server` + `StdioServerTransport`
- `gitmcp/server.ts` + `tools.ts` → 重写 handlers 对 SDK API
- `createMcpSpawnSpec()`（`mcp-client.ts:422-462`）→ **保留**（纯 spawn 逻辑），但要从 client 模块抽出到独立文件，4 个调用点（codegraph/crg 各 2）解耦

### 测试改动（真正的工作量）
- `tests/gitmcp.test.ts`——直接驱动 `dispatchRpcMessage()`，**重写**（针对 SDK server API）
- `tests/mcp-client.test.ts`——spawn 真实 server 跑协议，重写
- `tests/session.test.ts`——4 处手写 JSON-RPC frame 的 stub，重写
- `tests/codegraph.test.ts:168`——`createMcpSpawnSpec` 行为引用
- 共 **~10 个测试文件**受影响

### 类型重映射
`McpToolDefinition` / `McpPromptDefinition` / `McpResourceDefinition` 等被外部消费，需重映射到 SDK 类型（或保留兼容别名）。

---

## 五、迁移收益

1. **追上协议**：从 `2025-03-26` 一跃到最新（含 2025-06-18 elicitation / structured output）。
2. **解锁远程 server**：免费拿到 Streamable HTTP 传输——对接任何远程/托管 MCP server。
3. **解锁 server→client 能力**：sampling / roots / elicitation 三大能力内建，DeepOrca 能接入「需要回问宿主」的整个 server 类别。
4. **富内容结果**：image/audio/embedded resource/structured content 全支持。
5. **降低维护负担**：协议演进由上游负责，不再手动追赶。
6. **A2UI 受益**：迁移后 A2UI server 顺势从手写换 SDK server，`_meta`/embedded resource 是协议原生支持，A2UI 计划的 Task 8（透传链）简化。

---

## 六、决策：SDK 迁移为最高优先级前置（用户拍板）

> **决策更新（2026-07-30）**：原调研倾向「独立立项、A2UI 先落地」。**用户推翻此判断**，定为最高优先级前置——理由更稳：A2UI 深度依赖 MCP（`_meta`/embedded resource/`a2ui_action` 双向回流），先打 SDK 地基可**省一次 server 返工 + 一次兼容性回归**。下表为两种路径的取舍，最终采纳「前置」。

| 维度 | 「前置：SDK 先迁移」（✅ 用户采纳） | 「并行：A2UI 先用手写」（原调研倾向，已否决） |
|------|----------------------------------|---------------------------------------------|
| 返工成本 | 一次写对（A2UI server 直接基于 SDK） | A2UI server 写两遍（手写 → SDK），Task 2/3/5/6/7/8 全返工 |
| 兼容性测试 | 一次（迁移时） | 两次（手写时 + 迁移后） |
| 风险隔离 | 迁移风险先暴露，与 A2UI 解耦 | 迁移风险与 A2UI 价值交付耦合 |
| 产品价值时间线 | A2UI 稍晚启动 | A2UI 更早出 demo（但建立在将被替换的地基上） |

**采纳路径**：
1. **SDK 迁移先行**（最高优先级，独立 spec + plan）——把客户端 + gitmcp 服务端换成 `@modelcontextprotocol/sdk`。
2. **A2UI 基于迁移后的 SDK 地基启动**——A2UI server 直接用 SDK `Server` 写，`_meta`/embedded resource 是协议原生，`a2ui_action` 走 SDK 的双向请求能力。
3. A2UI 实施 spec（`specs/archive/a2ui-integration/design.md`）已假定 SDK 迁移完成；其基于手写的实施计划（`docs/superpowers/plans/2026-07-30-a2ui-integration.md` Task 2-8）**待 SDK spec 定稿后基于 SDK 重写**。

---

## 七、下一步

SDK 迁移作为最高优先级，需产出**独立的 spec + plan**（与 A2UI 平行）。该 spec 应覆盖：
- 客户端迁移（mcp-client.ts 462 行 → SDK `Client` + `StdioClientTransport`）
- 服务端迁移（gitmcp/rpc.ts + server.ts → SDK `Server` + `StdioServerTransport`）
- 类型重映射（McpToolDefinition 等 → SDK 类型）
- 测试改造（~10 个测试文件）
- `createMcpSpawnSpec` 抽离（4 调用点解耦）
- 回归验证策略

待用户确认后即可开写。

---

## 参考来源

- [官方 SDK npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) v1.30.0
- [MCP 规范索引](https://modelcontextprotocol.io/specification)
- DeepOrca 现状：`packages/core/src/mcp/mcp-client.ts` / `mcp-manager.ts` / `gitmcp/rpc.ts`
- 作者手写理由：`specs/gitmcp-local-module/design.md:48,160`
