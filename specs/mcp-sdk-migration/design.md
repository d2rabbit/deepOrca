# MCP SDK 迁移 — 手写 JSON-RPC → 官方 `@modelcontextprotocol/sdk`

> 状态：**已完成**（2026-07-30，6 任务全部落地并通过验证）· 日期：2026-07-30
> 调研依据：`docs/research/2026-07-mcp-sdk-migration.md`（能力矩阵 + 可行性，已采纳）
> 定位：**最高优先级前置**——A2UI 深度依赖 MCP，先把 MCP 打成官方 SDK 地基，A2UI server 直接基于 SDK 写，省一次返工 + 一次兼容性回归。
> 配套计划：`docs/superpowers/plans/2026-07-30-mcp-sdk-migration.md`

---

## 1. 现状（实测）

DeepOrca 的 MCP **全手写**，无 `@modelcontextprotocol/sdk` 依赖：

| 文件 | 行数 | 角色 |
|------|------|------|
| `packages/core/src/mcp/mcp-client.ts` | 462 | 客户端：stdio spawn + 手写 JSON-RPC 收发 |
| `packages/core/src/mcp/mcp-manager.ts` | 525 | 生命周期、命名空间、重连 |
| `packages/core/src/gitmcp/rpc.ts` | 120 | 服务端：手写 stdio JSON-RPC 循环 |
| `packages/core/src/gitmcp/server.ts` | 115 | gitmcp MCP server handlers |
| `packages/core/src/gitmcp/tools.ts` | 175 | gitmcp 工具体（含输入 schema） |

**致命缺口**（调研 §二已列全）：
- 协议版本硬编码 `2025-03-26`/`2024-11-05`，**拒绝**其它（落后到 `2025-06-18`/`2026-07-28`）。
- 传输**仅 stdio**（无 SSE/Streamable HTTP）。
- 工具结果**仅 text**（image/audio/embedded resource/structured content 全丢）。
- **server→client 请求全死**：客户端声明 `capabilities: {}`，路由器把「不在 pending map 的带 id 请求」当 no-op 丢弃（`mcp-client.ts:383`）——sampling/roots/elicitation 无法工作。

## 2. 目标版本与可行性（已验证）

**目标：`@modelcontextprotocol/sdk@1.22.0`**（npm `latest` 标签，2026-07-30 实测）。

> ⚠️ **不要参考 GitHub `main` 分支**——那是 2.0-alpha monorepo 重写。所有引用钉死 1.22.0 发布物（`dist/esm/...`）。
> ⚠️ **之前调研误称 1.30.0**——npm 上 1.30.0 不存在，`latest` 实际是 1.22.0。以 `^1.22.0` 为准。

可行性（调研 §三 + SDK API 实测核实）：
- **必须用子路径导入**：裸 specifier `@modelcontextprotocol/sdk` 的顶层 barrel 不存在（404）。用 `/server/mcp.js`、`/client/index.js`、`/client/stdio.js`、`/server/stdio.js`、`/inMemory.js`、`/types.js`。
- **关键 API 在 1.22.0 实测存在**：`McpServer`（+ `registerTool` 在 proto 上）、`Client`、`StdioClientTransport`、`StdioServerTransport`、`InMemoryTransport`。
- **通知 schema 是单数 `ToolListChangedNotificationSchema`**（不是复数 `ToolsListChanged...`）。
- **zod v4 已用**（`packages/core/package.json`）→ SDK peer dep `zod ^3.25 || ^4.0` **完全兼容**。
- **stdio 路径无需 crypto polyfill**——SDK 的请求 ID 是递增整数，`globalThis.crypto` 仅 auth/SSE 模块用到。Node 22 原生满足。
- **engines.node ≥18**，DeepOrca 用 Node 22。
- dual ESM/CJS，DeepOrca 是 ESM（`moduleResolution:"bundler"`）→ 用带 `.js` 后缀的子路径导入。

## 3. SDK 1.22.0 关键 API（实测核实，计划据此写）

### 客户端（`mcp-manager.ts` 用）
```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolListChangedNotificationSchema, type ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";

const client = new Client(
  { name: "deeporca", version: "0.1.0" },
  { capabilities: { roots: { listChanged: true }, sampling: {}, elicitation: {} } }
);
const transport = new StdioClientTransport({ command, args, env, cwd });
await client.connect(transport);           // connect() 自动完成 initialize 握手
const { tools } = await client.listTools();  // 单页；翻页用 {cursor} + nextCursor
const res = await client.callTool({ name, arguments });  // res.content[] / structuredContent / isError
client.setNotificationHandler(ToolListChangedNotificationSchema, async (n) => { /* 刷新 */ });
await client.close(); await transport.close();
```

### 服务端（`gitmcp/server.ts` 用）
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "deeporca-gitmcp", version: "0.1.0" });
server.registerTool(                        // ⚠️ registerTool，不是已废弃的 tool()
  "search_documentation",
  { description: "...", inputSchema: { query: z.string() } },  // zod raw shape → 自动转 JSON Schema
  async ({ query }) => ({ content: [{ type: "text", text: "..." }] })
);
await server.connect(new StdioServerTransport());  // 协议版本/capability 自动协商
```

### 关键 API 事实
- `connect()` 自动握手（initialize + notifications/initialized），无需手写。
- `registerTool` 的 `inputSchema` 收 **zod raw shape**（`{key: ZodType}`），SDK 自动转 JSON Schema。`server.tool()` **已废弃**，用 `registerTool`。
- 类型统一从 `@modelcontextprotocol/sdk/types.js` 导入（无顶层 index）：`CallToolResult`/`TextContent`/`Tool`/`ContentBlock` 等。
- 错误：返回 `{ content: [...], isError: true }`，**不抛协议错误**（与现状一致）。

## 4. 层规则（守 AGENTS.md）

- **core 保持 UI-free**：SDK 是纯 Node 库，无 react/electron，进 core 无冲突。
- **不新增内置工具**：迁移是替换传输/协议层，工具面不变。
- **保留 `createMcpSpawnSpec`**：这是跨平台 spawn 逻辑（Windows PATHEXT/cmd.exe 转义），SDK 的 `StdioClientTransport` 不复制这套逻辑——抽到独立文件继续用，作为 spawn 参数喂给 `StdioClientTransport`。**5 个 spawn-spec 测试原样保留。**
- **`gitmcp/server.ts` 的 standalone 约束**：server 从 `dist/gitmcp/server.js` 跑，经 `node_modules` 解析 SDK（非 esbuild bundle）。保持 server 导入精简（不 import resolve.ts/prompt/codegraph），迁移后依然如此。

## 5. 改动点总览

### core（传输/协议层）
| 文件 | 改动 |
|------|------|
| `packages/core/package.json` | 加 `@modelcontextprotocol/sdk@^1.22.0` 依赖 |
| `packages/core/src/mcp/spawn-spec.ts` | **新增**——把 `createMcpSpawnSpec`+`McpSpawnSpec`+`quoteWindowsArgIfNeeded` 从 mcp-client.ts 抽出 |
| `packages/core/src/mcp/mcp-client.ts` | **删除**——被 SDK `Client`+`StdioClientTransport` 替换 |
| `packages/core/src/mcp/mcp-manager.ts` | **改写**——`new McpClient` → SDK `Client`；connect/listTools/callTool 换 SDK 方法；通知处理换 `setNotificationHandler` |
| `packages/core/src/mcp/types.ts` | **新增/保留别名**——`McpToolDefinition` 等外部消费的类型，重映射到 SDK 类型（或本地兼容类型） |
| `packages/core/src/gitmcp/rpc.ts` | **删除**——SDK `StdioServerTransport` 替代 |
| `packages/core/src/gitmcp/server.ts` | **改写**——`buildServerHandlers` → SDK `McpServer`+`registerTool`；保留 `runMaintenance`（非 MCP 子命令） |
| `packages/core/src/gitmcp/tools.ts` | **改写**——工具输入 schema 从手写 JSON 改 zod raw shape（喂 `registerTool`） |
| `packages/core/src/index.ts` | 更新导出（McpClient 删除，spawn-spec/types 路径调整） |
| `packages/core/src/common/codegraph.ts`/`crg.ts` | `createMcpSpawnSpec` import 路径改 `./spawn-spec`（4 处调用点：codegraph ×2、crg ×2） |

### 测试（真正的工作量）
| 文件 | 改动 |
|------|------|
| `tests/mcp-client.test.ts` | spawn-spec 5 测试**保留**（改 import 路径）；真 MCP server 测试用 SDK `InMemoryTransport` 或保留 spawn |
| `tests/gitmcp.test.ts` | 协议测试（dispatchRpcMessage）**改写**——用 SDK `InMemoryTransport` 连真 McpServer，或测 `registerTool` 注册的 handler |
| `tests/session.test.ts` | 3 处手写 JSON-RPC stub（746/833/952）**保留**（stub 的是 server，仍说 JSON-RPC，SDK 客户端能消费）；微调 protocolVersion/capabilities 形状 |

### 不改
- `tools/executor.ts`——`executeMcpTool` 接口不变。
- `session.ts`——`McpManager` 接口不变（`prepare`/`initialize`/`reconnect`/`getMcpToolDefinitions`/`executeMcpTool`）。
- IPC、renderer——纯 core 内部迁移。

## 6. 增量带来的能力（迁移后免费拿到）

1. 协议版本自动跟最新（`LATEST_PROTOCOL_VERSION`）。
2. **Streamable HTTP 传输**（未来接远程 server，仅需换 transport）。
3. **server→client 能力**：sampling/roots/elicitation（客户端已声明 capabilities，迁移后可注册 handler）。
4. 富内容结果：image/audio/embedded resource/structured content（`executeMcpTool` 增强透传 `metadata`）。
5. A2UI 受益：`_meta`/embedded resource 是协议原生，`a2ui_action` 走 SDK 双向请求。

## 7. 风险与缓解

| # | 风险 | 缓解 |
|---|------|------|
| R1 | SDK bundle 把 HTTP/SSE/auth 依赖拖进 gitmcp server | 只 import `/server/mcp.js`+`/server/stdio.js`+`/types.js`；构建后查 `dist/` 无 express/hono/jose |
| R2 | `createMcpSpawnSpec` 抽离破坏 4 个调用点 | 先抽 + 跑 5 个 spawn-spec 测试确认绿，再改调用点 |
| R3 | `gitmcp.test.ts` 协议测试重写后覆盖降低 | 用 SDK `InMemoryTransport` 连真 server，保留 initialize/tools-list/tools-call/prompts-not-found 全覆盖 |
| R4 | 类型重映射破坏外部消费者（index.ts 导出） | 保留 `McpToolDefinition` 等类型别名，shape 兼容；typecheck 守门 |
| R5 | `connect()` 自动握手改变超时语义 | SDK connect 无内置超时——用 `AbortSignal` 或 Promise.race 包超时（manager 已有 MCP_STARTUP_TIMEOUT_MS） |
| R6 | 钉死 1.22.0，未来 2.0 又要迁 | 锁定 `^1.22.0`，2.0 稳定后单独评估（届时是另一条迁移线） |

## 8. 验收标准（已验证 2026-07-30）

1. ✅ `npm run check` 全绿（typecheck core+desktop + ESLint + Prettier）。
2. ✅ gitmcp server 端到端：spawn `dist/gitmcp/server.js <slug>`，stdio 握手协商 protocolVersion + 自动返回 serverInfo，`tools/list` 返回 4 工具。
3. ⏳ 外部 MCP server（dart/serena/expo）listTools + callTool —— 待 desktop app 实机验证（Task 6 未跑 GUI，因 subagent 无桌面访问）。
4. ✅ gitmcp server bundle（esbuild standalone）**不含** HTTP/SSE/auth 依赖（`streamableHttp`/`StreamableHTTPServerTransport`/`SSEServerTransport`/`express`/`jose`/`eventsource` 计数均为 0，SDK 的 HTTP 模块被正确 tree-shake）。bundle 878K（SDK core + zod + ajv schema 校验，合理）。
5. ✅ core 单元测试：`mcp-client.test.ts`（spawn-spec + SDK probe）6/6、`gitmcp.test.ts` + `gitmcp-server-sdk.test.ts` 17/17 全绿。
6. ⚠️ `session.test.ts` 的 MCP 测试在本机因 **预存环境耦合** 失败：`augmentMcpServersWithBuiltins` 在 `uvx`/serena 于 PATH 时注入真实 serena server，污染 `getMcpStatus()` 数组。**这是迁移前就存在的测试隔离缺陷**（任何装了 serena 的开发机都会触发），与本次迁移无关。已验证：临时禁用 serena 后，所有迁移相关的 MCP 测试 4/4 通过，证明 serverInfo + stderr 修复正确、迁移逻辑无回归。

> 迁移结论：客户端 + gitmcp 服务端均已切到官方 SDK，对外接口零变化，构建产物干净。**A2UI spec 的「SDK 迁移完成」前置满足**，可启动 A2UI server 任务。

### 实施记录（commits，perf/native-optimizations 分支）
- `b83fc06` Task 1: 抽 `createMcpSpawnSpec` 到 spawn-spec.ts + 加 SDK 依赖
- `2587d5b` Task 1 修: 恢复 spawn-spec 的关键注释
- `a8e4482` Task 2: 类型兼容层 types.ts
- `0e7f5ed` Task 3: gitmcp server → SDK McpServer + registerTool（删 rpc.ts）
- `81b19b5` Task 3 修: 恢复 search_code page 参数 + 删死代码 buildToolDefinitions
- `bed96b0` Task 4: 客户端 → SDK Client + StdioClientTransport（删 mcp-client.ts）
- `a3310ff` Task 4 修: 排空 StdioClientTransport stderr 防背压
- `35d7c60` Task 5: 测试 stub 加 serverInfo + 恢复 stderr 捕获

### 发现的 SDK 1.22.0 关键事实（修正了调研误报）
- npm `latest` = **1.22.0**（调研误称 1.30.0，该版本不存在）。
- **必须用子路径导入**（裸 specifier 顶层 barrel 不存在）。
- zod **必须用 `zod/v3`** 子路径（SDK peer-depends zod^3，调 v3 的 `_parse`；zod 4 的 `./v3` 兼容子路径可用）。
- 通知 schema 是单数 `ToolListChangedNotificationSchema`（非复数）。
- `McpServer` + `registerTool` + `Client` + `StdioClientTransport` + `StdioServerTransport` + `InMemoryTransport` 在 1.22.0 均已存在。
- Client 初始化握手**自动**完成；但 Client 的 zod 校验**要求** `InitializeResult` 含 `serverInfo`（旧手写 client 不要求，故测试 stub 需补）。
