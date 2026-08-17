# MCP SDK 迁移实施计划 — 手写 JSON-RPC → `@modelcontextprotocol/sdk`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 DeepOrca 的手写 MCP（客户端 462 行 + gitmcp 服务端 230 行）迁移到官方 `@modelcontextprotocol/sdk@1.22.0`，保留对外接口（`McpManager` / `createMcpSpawnSpec` / gitmcp 工具）不变。

**Architecture:** 客户端用 SDK `Client` + `StdioClientTransport`（`connect()` 自动握手）；gitmcp 服务端用 SDK `McpServer` + `StdioServerTransport` + `registerTool`（zod raw shape 自动转 JSON Schema）。`createMcpSpawnSpec` 跨平台 spawn 逻辑抽到独立文件保留，喂给 `StdioClientTransport`。core 对外接口零变化。

**Tech Stack:** TypeScript（ESM, strict, `verbatimModuleSyntax`）· `@modelcontextprotocol/sdk@^1.22.0`（Apache-2.0, zod v4 兼容, Node ≥18 stdio 路径免 crypto）· node:test + node:assert/strict

**Spec 依据:** `specs/mcp-sdk-migration/design.md`（设计草案）· `docs/research/2026-07-mcp-sdk-migration.md`（调研）

**架构关键事实（核实过，必须遵守）:**
- **目标 npm 1.22.0**（`latest` 标签实测，2026-07-30）。不是 GitHub `main`（那是 2.0-alpha monorepo）。**注意：之前调研误称 1.30.0，npm 上 1.30.0 不存在**——以 `^1.22.0` 为准。
- **必须用子路径导入**：`@modelcontextprotocol/sdk` 裸 specifier 的 exports 指向不存在的顶层 barrel，会 404。用 `@modelcontextprotocol/sdk/server/mcp.js`、`/client/index.js`、`/client/stdio.js`、`/server/stdio.js`、`/inMemory.js`、`/types.js`。
- **`connect()` 自动握手**（initialize + notifications/initialized）——manager 不再手写。
- **`McpServer` + `registerTool` 在 1.22.0 已存在**（实测 proto 上有 `registerTool`）。`server.tool()` 也有但建议用 `registerTool`。
- **通知 schema 名是单数 `ToolListChangedNotificationSchema`**（不是复数 `ToolsListChanged...`）——1.22.0 实测。
- **类型从 `/types.js` 导入**（`CallToolResult`/`Tool`/`ContentBlock`/`TextContent` 等都在；`ToolListChangedNotificationSchema` 也在那）。
- **stdio 路径无需 crypto polyfill**——SDK 请求 ID 是递增整数。
- `dist/` 被 gitignore，gitmcp server 从 `dist/gitmcp/server.js` 跑，SDK 经 `node_modules` 解析。
- `createMcpSpawnSpec` 是 transport-agnostic 跨平台逻辑（Windows PATHEXT/cmd.exe 转义），**SDK 不复制**，必须保留。

**测试运行:** `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/<file>.test.ts`

---

## 文件结构

**新增:**
- `packages/core/src/mcp/spawn-spec.ts` — 从 mcp-client.ts 抽出的 `createMcpSpawnSpec` + `McpSpawnSpec` + `quoteWindowsArgIfNeeded`。
- `packages/core/src/mcp/types.ts` — 外部消费类型的兼容别名（`McpToolDefinition` 等），重映射 SDK 类型。

**删除:**
- `packages/core/src/mcp/mcp-client.ts` — 被 SDK `Client` 替换。
- `packages/core/src/gitmcp/rpc.ts` — 被 SDK `StdioServerTransport` 替换。

**改写:**
- `packages/core/src/mcp/mcp-manager.ts` — `McpClient` → SDK `Client`。
- `packages/core/src/gitmcp/server.ts` — `buildServerHandlers` → `McpServer` + `registerTool`。
- `packages/core/src/gitmcp/tools.ts` — 工具 schema 改 zod raw shape。

**改 import 路径（不改逻辑）:**
- `packages/core/src/common/codegraph.ts`、`crg.ts` — `createMcpSpawnSpec` 改从 `../mcp/spawn-spec` 导入。
- `packages/core/src/index.ts` — 导出路径更新。
- `packages/core/package.json` — 加 SDK 依赖。

**测试改写:**
- `tests/mcp-client.test.ts`、`tests/gitmcp.test.ts`、`tests/session.test.ts`。

---

## Task 1: 加 SDK 依赖 + 抽 `createMcpSpawnSpec` 到独立文件

先把跨平台 spawn 逻辑抽出来（5 个测试原样保留，验证抽取无误），再加依赖。这是地基，后续都依赖它。

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/src/mcp/spawn-spec.ts`
- Modify: `packages/core/src/mcp/mcp-client.ts`（临时——Task 3 删除整个文件）
- Modify: `packages/core/src/tests/mcp-client.test.ts`

- [ ] **Step 1: 加 SDK 依赖**

Edit `packages/core/package.json`，在 `dependencies` 加：
```json
"@modelcontextprotocol/sdk": "^1.22.0"
```

Run（repo root）: `cd packages/core && npm install`
Expected: 安装成功，`node_modules/@modelcontextprotocol/sdk` 存在。

- [ ] **Step 2: 创建 spawn-spec.ts（从 mcp-client.ts 抽出）**

Create `packages/core/src/mcp/spawn-spec.ts`，把 `mcp-client.ts:99-104`（`McpSpawnSpec` 类型）+ `422-455`（`createMcpSpawnSpec`）+ `457-462`（`quoteWindowsArgIfNeeded`）整段搬过来：

```ts
import * as path from "path";

export type McpSpawnSpec = {
  command: string;
  args: string[];
  shell: boolean;
  windowsHide?: boolean;
};

export function createMcpSpawnSpec(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform
): McpSpawnSpec {
  // An absolute path (e.g. process.execPath, a vendored node binary, or a JS
  // entry resolved via require.resolve) can be spawned directly without a shell.
  // This avoids relying on cmd.exe (via ComSpec), which Electron's environment
  // may not expose correctly — causing `spawn cmd.exe ENOENT`. The shell path
  // below is only needed for bare command names (npx, …) that require PATHEXT
  // resolution.
  if (platform === "win32" && !path.isAbsolute(command)) {
    return {
      command: [command, ...args].map(quoteWindowsArgIfNeeded).join(" "),
      args: [],
      shell: true,
      windowsHide: true,
    };
  }

  return {
    command,
    args,
    shell: false,
    windowsHide: true,
  };
}

function quoteWindowsArgIfNeeded(arg: string): string {
  if (/[\s"&|<>^()]/.test(arg)) {
    return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/g, "$&$&")}"`;
  }
  return arg;
}
```

- [ ] **Step 3: 改 mcp-client.ts 重新导出（临时，保编译通过）**

在 `packages/core/src/mcp/mcp-client.ts` 顶部，把原来的 `createMcpSpawnSpec`/`McpSpawnSpec`/`quoteWindowsArgIfNeeded` 定义删掉，改为从新文件 re-export（保持现有 import 不破）：
```ts
export { createMcpSpawnSpec, type McpSpawnSpec } from "./spawn-spec";
```
（删掉 `import * as path from "path"` 如果 mcp-client 不再用——Task 3 会删整个文件，这里只是过渡。）

- [ ] **Step 4: 测试改 import 路径**

Edit `packages/core/src/tests/mcp-client.test.ts` 第 6 行：
```ts
import { createMcpSpawnSpec } from "../mcp/spawn-spec";
import { McpClient } from "../mcp/mcp-client";
```

- [ ] **Step 5: 跑测试确认 spawn-spec 5 测试仍绿**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/mcp-client.test.ts`
Expected: PASS（5 个 createMcpSpawnSpec 测试 + 跳过的 Windows spawn 测试）。McpClient 相关测试此刻仍跑旧实现。

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/package-lock.json packages/core/src/mcp/spawn-spec.ts packages/core/src/mcp/mcp-client.ts packages/core/src/tests/mcp-client.test.ts
git commit -m "refactor(mcp): extract createMcpSpawnSpec to spawn-spec.ts + add SDK dep"
```

---

## Task 2: 类型兼容层 `packages/core/src/mcp/types.ts`

外部消费者（executor、index.ts、gitmcp/tools.ts）依赖 `McpToolDefinition` 等类型。建兼容别名，迁移期间不破外部 import。

**Files:**
- Create: `packages/core/src/mcp/types.ts`

- [ ] **Step 1: 创建 types.ts（重映射 SDK 类型）**

Create `packages/core/src/mcp/types.ts`：
```ts
/**
 * MCP 类型兼容层。重映射官方 SDK 类型到 DeepOrca 历史名称，
 * 让 executor/index.ts 等外部消费者迁移期间 import 不破。
 * 类型来自 @modelcontextprotocol/sdk/types.js（1.22.0）。
 */
import type {
  Tool as SdkTool,
  Prompt as SdkPrompt,
  Resource as SdkResource,
  PromptArgument as SdkPromptArgument,
  PromptMessage as SdkPromptMessage,
  TextResourceContents as SdkTextResourceContents,
  BlobResourceContents as SdkBlobResourceContents,
} from "@modelcontextprotocol/sdk/types.js";

/** DeepOrca 历史的 Tool 定义 shape（与 SDK Tool 字段对齐）。 */
export type McpToolDefinition = SdkTool;

export type McpPromptDefinition = SdkPrompt;
export type McpPromptArgument = SdkPromptArgument;
export type McpPromptMessage = SdkPromptMessage;
export type McpResourceDefinition = SdkResource;
export type McpResourceContent = SdkTextResourceContents | SdkBlobResourceContents;
```

> **核对**：SDK 1.22.0 的 `types.js` 导出 `Tool`/`Prompt`/`Resource`/`PromptArgument`/`PromptMessage`/`TextResourceContents`/`BlobResourceContents`（1.22.0 实测）。若 SDK 字段名与 DeepOrca 旧 shape 有差异（如 `Tool.inputSchema` 的 `additionalProperties` 可选性），以 SDK 为准——typecheck 会暴露，按报错修。`McpToolDefinition` 旧 shape 的 `inputSchema.type` 是 `"object"` 字面量，SDK `Tool.inputSchema` 是 `JSONObject`；若 tsc 报错，在 types.ts 包一层 `{ ...SdkTool; inputSchema: { type:"object"; properties:...; required?:...; additionalProperties?:... } }`。

- [ ] **Step 2: typecheck 确认类型解析无误**

Run: `cd packages/core && npx tsc --noEmit`
Expected: PASS（types.ts 仅声明，未被消费，不应报错。若有 SDK 类型名不存在，按实际导出修正。）

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/mcp/types.ts
git commit -m "feat(mcp): add SDK type compat layer (McpToolDefinition etc.)"
```

---

## Task 3: 改写 gitmcp 服务端到 SDK `McpServer`

服务端先迁（它被测试覆盖最直接，且是 gitmcp 的独立子系统）。先写测试（TDD），再改实现。

**Files:**
- Create: `packages/core/src/tests/gitmcp-server-sdk.test.ts`（新测试，针对 SDK server）
- Modify: `packages/core/src/gitmcp/server.ts`
- Modify: `packages/core/src/gitmcp/tools.ts`
- Delete: `packages/core/src/gitmcp/rpc.ts`

- [ ] **Step 1: 写新测试 — 用 SDK InMemoryTransport 连真 McpServer**

Create `packages/core/src/tests/gitmcp-server-sdk.test.ts`：
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildGitmcpServer } from "../gitmcp/server";
import { GitmcpStore } from "../gitmcp/store";
import { indexRepository } from "../gitmcp/indexer";
import type { FetchLike } from "../gitmcp/github";
import { createRequire } from "node:module";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const hasSqlite = (() => {
  try { createRequire(import.meta.url)("node:sqlite"); return true; } catch { return false; }
})();
const sqliteOnly = { skip: hasSqlite ? false : "node:sqlite unavailable" };

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitmcp-sdksrv-"));
  return path.join(dir, "index.db");
}

test("gitmcp SDK server lists the four tools", async () => {
  const store = new GitmcpStore(tempDbPath());
  try {
    const server = buildGitmcpServer("owner/repo", store);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test", version: "1.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ["fetch_documentation", "fetch_url_content", "search_code", "search_documentation"]
    );

    await client.close();
  } finally {
    store.close();
  }
});

test("gitmcp SDK server search_documentation returns text content", sqliteOnly, async () => {
  const store = new GitmcpStore(tempDbPath());
  try {
    const markdown = "# Setup\n\nInstall with `brew install deepcode`.\n";
    const stubFetch: FetchLike = async (url) =>
      url.includes("llms.txt") ? new Response(markdown, { status: 200 }) : new Response("nf", { status: 404 });
    await indexRepository("owner/repo", store, stubFetch);

    const server = buildGitmcpServer("owner/repo", store);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "search_documentation", arguments: { query: "brew install" } });
    assert.equal(result.isError, false);
    const text = result.content.filter((c) => c.type === "text").map((c => c.type === "text" ? c.text : "")).join("");
    assert.ok(text.includes("Setup"));

    await client.close();
  } finally {
    store.close();
  }
});

test("gitmcp SDK server unknown tool returns isError", async () => {
  const store = new GitmcpStore(tempDbPath());
  try {
    const server = buildGitmcpServer("owner/repo", store);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "nope", arguments: {} });
    assert.equal(result.isError, true);

    await client.close();
  } finally {
    store.close();
  }
});
```

> **核对**：`InMemoryTransport` 的导入路径 `@modelcontextprotocol/sdk/inMemory.js`（核实报告 D1 的 `"./*"` 通配导出覆盖）。`indexRepository` 签名是 `(slug, store, fetch?)`——确认 `gitmcp/indexer.ts` 实际签名（gitmcp.test.ts 用了 `stubDocFetch`，三参）。

- [ ] **Step 2: 运行确认失败（buildGitmcpServer 不存在）**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/gitmcp-server-sdk.test.ts`
Expected: FAIL — `buildGitmcpServer is not exported` 或模块解析错。

- [ ] **Step 3: 改写 tools.ts — 工具 schema 改 zod raw shape**

Read `packages/core/src/gitmcp/tools.ts` 现有的 `buildToolDefinitions(slug)`（返回 `McpToolDefinition[]`，手写 JSON Schema）和 `callTool(store, slug, name, args)`。

保留 `callTool` 不变（它是纯逻辑，不碰协议）。新增一个返回「zod raw shape + handler」的结构，供 server.ts 的 `registerTool` 用：

在 `packages/core/src/gitmcp/tools.ts` 加（保留原有 `buildToolDefinitions`/`callTool`，先不删，gitmcp.test.ts 旧测试还在用）：
```ts
import { z } from "zod";

/** 每个 gitmcp 工具的 zod input shape + 注册元信息，供 SDK registerTool。 */
export type GitmcpToolRegistration = {
  name: string;
  description: string;
  inputShape: Record<string, z.ZodType>;
};

/** 返回 4 个工具的注册描述（inputSchema 用 zod raw shape，SDK 自动转 JSON Schema）。 */
export function buildGitmcpToolRegistrations(slug: string): GitmcpToolRegistration[] {
  return [
    {
      name: "fetch_documentation",
      description: `Fetch and cache the documentation of ${slug} (llms.txt → README → docs).`,
      inputShape: {},
    },
    {
      name: "search_documentation",
      description: `Full-text search (BM25) over the locally indexed documentation of ${slug}.`,
      inputShape: { query: z.string().describe("Search query (plain words)") },
    },
    {
      name: "search_code",
      description: `Search code snippets indexed for ${slug}.`,
      inputShape: { query: z.string() },
    },
    {
      name: "fetch_url_content",
      description: `Fetch raw content from a URL under ${slug}.`,
      inputShape: { url: z.string() },
    },
  ];
}
```

> **核对**：`description` 文本要对齐现有 `buildToolDefinitions` 里的描述（gitmcp.test.ts 旧测试只校验工具**名**，不校验描述文本，故描述可精简）。`inputShape` 的字段要从现有 `buildToolDefinitions` 的 JSON Schema `properties` 一一映射（`query`/`url` 等）。

- [ ] **Step 4: 改写 server.ts — buildGitmcpServer 用 SDK McpServer**

改写 `packages/core/src/gitmcp/server.ts`（保留 `runMaintenance` 不变，它是非 MCP 子命令）。新增 `buildGitmcpServer`，删除 `buildServerHandlers`（旧 RPC 版）：

```ts
import { pathToFileURL } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GitmcpStore, readGitmcpRepoMeta, removeGitmcpRepoIndex } from "./store";
import { indexRepository } from "./indexer";
import { buildGitmcpToolRegistrations } from "./tools";
import { callTool } from "./tools";

const SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * 构建一个绑定单个仓库的 gitmcp SDK MCP server。用 InMemoryTransport 测试，
 * 用 StdioServerTransport 生产。tool handler 复用既有 callTool 纯逻辑。
 */
export function buildGitmcpServer(slug: string, store: GitmcpStore = new GitmcpStore()): McpServer {
  const server = new McpServer({ name: "deeporca-gitmcp", version: "0.1.0" });
  for (const reg of buildGitmcpToolRegistrations(slug)) {
    server.registerTool(
      reg.name,
      { description: reg.description, inputSchema: reg.inputShape },
      async (args) => callTool(store, slug, reg.name, args as Record<string, unknown>)
    );
  }
  return server;
}

// runMaintenance 保留不变（迁移前的 runMaintenance 代码原样留下）。
// ... 保留现有 runMaintenance ...

function main(): void {
  const argv = process.argv.slice(2);
  if (argv[0]?.startsWith("--")) {
    void runMaintenance(argv).then(({ code, payload }) => {
      process.stdout.write(JSON.stringify(payload) + "\n");
      process.exit(code);
    });
    return;
  }
  const slug = argv[0] ?? "";
  if (!SLUG_PATTERN.test(slug)) {
    process.stderr.write(`gitmcp: expected a repository slug argument (owner/repo), got "${slug}"\n`);
    process.exit(1);
  }
  const server = buildGitmcpServer(slug);
  void server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
```

> **核对**：`callTool` 的签名是 `(store, slug, name, args)`——确认 tools.ts 现有签名（gitmcp.test.ts 调 `callTool(store, slug, name, args)`，四参）。`registerTool` 的 cb 第一个参数是解析后的 args 对象，cast 成 `Record<string, unknown>` 喂 callTool。

- [ ] **Step 5: 运行新测试确认通过**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/gitmcp-server-sdk.test.ts`
Expected: PASS（3 测试）。

- [ ] **Step 6: 删除 rpc.ts + 更新旧 gitmcp.test.ts**

Delete `packages/core/src/gitmcp/rpc.ts`。

旧 `gitmcp.test.ts` 里有用 `dispatchRpcMessage`+`buildServerHandlers` 的协议测试（约 5 个测试）。这些改为调 `buildGitmcpServer` 或直接删（已被 gitmcp-server-sdk.test.ts 覆盖）。读 `gitmcp.test.ts`，把 import `dispatchRpcMessage`/`buildServerHandlers` 的测试块删掉或重写用 SDK server。保留非协议测试（store/github/indexer/chunkMarkdown 等纯逻辑测试）。

- [ ] **Step 7: 跑全部 gitmcp 相关测试**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/gitmcp.test.ts packages/core/src/tests/gitmcp-server-sdk.test.ts`
Expected: 全 PASS。

- [ ] **Step 8: typecheck**

Run: `cd packages/core && npx tsc --noEmit`
Expected: PASS（确认 server.ts/tools.ts 无残留对 rpc.ts 的引用）。

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/gitmcp/ packages/core/src/tests/gitmcp.test.ts packages/core/src/tests/gitmcp-server-sdk.test.ts
git rm packages/core/src/gitmcp/rpc.ts
git commit -m "refactor(gitmcp): migrate server to SDK McpServer + registerTool (delete rpc.ts)"
```

---

## Task 4: 改写客户端到 SDK `Client` + `StdioClientTransport`

核心迁移。`mcp-client.ts` 删除，`mcp-manager.ts` 改用 SDK。先确认 manager 的公共接口不变（executor/session 依赖它）。

**Files:**
- Modify: `packages/core/src/mcp/mcp-manager.ts`
- Delete: `packages/core/src/mcp/mcp-client.ts`
- Modify: `packages/core/src/tests/mcp-client.test.ts`

- [ ] **Step 1: 读 manager 公共接口契约**

确认 `mcp-manager.ts` 这些方法签名迁移后不变（executor.ts/session.ts 依赖）：
`prepare`/`initialize`/`reconnect`/`getStatus`/`getMcpToolDefinitions`/`isMcpTool`/`executeMcpTool`/`getMcpPrompt`/`readMcpResource`/`disconnect`/`setOnToolsListChanged`/`setOnStatusChanged`。
以及类型 `McpServerStatus`。**这些签名迁移后一字不改。**

- [ ] **Step 2: 改 mcp-manager.ts — McpClient 替换为 SDK Client**

Edit `packages/core/src/mcp/mcp-manager.ts`：
- 顶部 import 改为：
```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolListChangedNotificationSchema, type Tool, type Prompt, type Resource } from "@modelcontextprotocol/sdk/types.js";
import { createMcpSpawnSpec } from "./spawn-spec";
import type { McpServerConfig } from "../settings";
import { getEnvVar } from "../common/app-dirs";
import { createHash } from "crypto";
```
- `McpToolEntry.client` 类型从 `McpClient` 改为 `Client`（SDK）。同理 prompts/resources 的 `client`。
- `connectServer` 里 `new McpClient(...)` 块替换为：
```ts
const spawnSpec = createMcpSpawnSpec(config.command, config.args ?? []);
// SDK StdioClientTransport 用 cross-spawn，不直接吃我们的 spawnSpec；
// 我们把 spawnSpec 还原成 command/args/env，shell 语义靠 cross-spawn 处理。
const transport = new StdioClientTransport({
  command: spawnSpec.command,
  args: spawnSpec.args,
  env: { ...process.env, ...(config.env ?? {}) },
  cwd: config.cwd,
  stderr: "pipe",  // 收集 stderr 用于错误信息
});
const client = new Client(
  { name: "deeporca", version: "0.1.0" },
  { capabilities: { roots: { listChanged: true }, sampling: {}, elicitation: {} } }
);
client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
  this.refreshServerTools(name, client).catch(() => {});
});
// 超时：SDK connect 无内置超时，用 race
await Promise.race([
  client.connect(transport),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`MCP server "${name}" connect timeout`)), MCP_STARTUP_TIMEOUT_MS)
  ),
]);
```

> **关键核对**：
> 1. **`createMcpSpawnSpec` 的 shell 语义**：现状 Windows 下把 command+args join 成字符串 + `shell:true`。SDK `StdioClientTransport` 用 `cross-spawn`，它自己处理 Windows PATHEXT。**最稳做法**：直接把原始 `config.command`/`config.args` 传给 `StdioClientTransport`，让 cross-spawn 处理，**绕过 createMcpSpawnSpec**。但这会改变 Windows 行为——需保留 createMcpSpawnSpec 的转义逻辑。**决策**：先按上面写法（spawnSpec.command/args），若 Windows 测试失败（Task 5 端到端），退路是直接传原始 command/args 给 StdioClientTransport。这是 Task 5 的重点验证项。
> 2. **stderr 收集**：现状 mcp-client 收集 stderr 拼 error 信息。SDK `StdioClientTransport` 的 `stderr:"pipe"` 后，需监听 child stderr——SDK 不直接暴露。**退路**：接受丢失 stderr 细节，error 信息用 SDK 的 close 事件 + transport 状态。
> 3. **disconnect**：`McpClient.disconnect()` → `await client.close()` + `await transport.close()`。manager 的 `disconnect()` 是 sync 的——改为 fire-and-forget `void client.close()`。
> 4. **isConnected()**：SDK 无直接等价。manager 里 `this.clients.filter(c => c.isConnected())` 改为维护一个 `Set<string>` 记录已连接 server 名，close 时移除。

- [ ] **Step 3: listTools/callTool/listPrompts 等换 SDK 方法**

manager 里所有 `client.listTools(timeout)` → `client.listTools()`（SDK 无超时参数；超时用 Promise.race 包，或接受默认）。分页：现状手写翻页循环，SDK `listTools()` 单页返回 `{tools, nextCursor}`——**保留翻页循环**，传 `{cursor}`：
```ts
async listAllTools(client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const res = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...res.tools);
    cursor = res.nextCursor;
    if (!cursor) return tools;
  }
  throw new Error("too many tools/list pages");
}
```
同理 listPrompts/listResources。callTool：`client.callTool({ name, arguments })` 返回 `{content, isError, structuredContent}`。executeMcpTool 提取 text 逻辑保留。

- [ ] **Step 4: 删除 mcp-client.ts**

`git rm packages/core/src/mcp/mcp-client.ts`。

- [ ] **Step 5: 改 mcp-client.test.ts — 删 McpClient 测试，保留 spawn-spec**

`tests/mcp-client.test.ts` 里：
- 保留前 5 个 `createMcpSpawnSpec` 测试（Task 1 已改 import 路径）。
- 删最后那个 `McpClient starts a PATH-resolved cmd MCP server` 测试（依赖已删的 McpClient）。或改为用 SDK Client spawn 同一个 probe server（见 Step 6）。
- 重命名文件为 `mcp-spawn-spec.test.ts`（可选，反映内容）。

- [ ] **Step 6: （可选）加 SDK 客户端 spawn 测试**

在 `tests/mcp-client.test.ts`（或新文件）加一个用 SDK Client 连 probe server 的测试，验证 spawn + 握手 + listTools：
```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// ... probe server setup 同旧测试 ...
const client = new Client({ name: "test", version: "1.0" }, { capabilities: {} });
await client.connect(new StdioClientTransport({ command: "mcp-probe", args: [] }));
const { tools } = await client.listTools();
assert.equal(tools[0].name, "probe_tool");
await client.close();
```

- [ ] **Step 7: typecheck + 跑测试**

Run: `cd packages/core && npx tsc --noEmit && node src/tests/run-tests.mjs src/tests/mcp-client.test.ts`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git rm packages/core/src/mcp/mcp-client.ts
git add packages/core/src/mcp/mcp-manager.ts packages/core/src/tests/mcp-client.test.ts
git commit -m "refactor(mcp): migrate client to SDK Client + StdioClientTransport (delete mcp-client.ts)"
```

---

## Task 5: 修 session.test.ts 的 stub + 外部 import 路径

**Files:**
- Modify: `packages/core/src/tests/session.test.ts`
- Modify: `packages/core/src/common/codegraph.ts`、`crg.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 跑 session.test.ts 看失败点**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/session.test.ts`
Expected: 可能 FAIL——session.test.ts 的 stub（746/833/952）手写 JSON-RPC，SDK Client 能消费（仍说 JSON-RPC），但 protocolVersion `2024-11-05` + capabilities 形状可能需调。按实际报错修。

- [ ] **Step 2: 修 stub 的 protocolVersion/capabilities**

session.test.ts 的 3 处 stub 里，把：
```ts
result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } }
```
保持不变（SDK Client 接受多版本）。若 SDK 拒绝旧版本，改成 `LATEST_PROTOCOL_VERSION`（从 `@modelcontextprotocol/sdk/types.js` 导入）。stub 的 serverInfo 字段补全（SDK 可能要求）：
```ts
result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1.0" } }
```

- [ ] **Step 3: 改 codegraph.ts/crg.ts 的 createMcpSpawnSpec import**

在 `packages/core/src/common/codegraph.ts` 和 `crg.ts`，把：
```ts
import { createMcpSpawnSpec } from "../mcp/mcp-client";
```
改为：
```ts
import { createMcpSpawnSpec } from "../mcp/spawn-spec";
```
（grep 确认所有引用点：`grep -rn "mcp/mcp-client" packages/core/src/`）

- [ ] **Step 4: 改 index.ts 导出**

`packages/core/src/index.ts` 里：
- 删 `export { McpClient }` / `export type { ... } from "./mcp/mcp-client"`（若有）。
- 加 `export { createMcpSpawnSpec, type McpSpawnSpec } from "./mcp/spawn-spec"`。
- `McpManager`/`McpServerStatus` 导出路径不变（从 `./mcp/mcp-manager`）。

- [ ] **Step 5: typecheck + 全部测试**

Run: `npm run typecheck && npm test`
Expected: 全 PASS（core 所有测试）。session.test.ts 的 3 处 stub 应绿。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tests/session.test.ts packages/core/src/common/codegraph.ts packages/core/src/common/crg.ts packages/core/src/index.ts
git commit -m "refactor(mcp): fix session stubs + repoint createMcpSpawnSpec imports to spawn-spec"
```

---

## Task 6: 端到端验证 + 构建产物检查 + 文档收尾

**Files:**
- Verify: 全量
- Modify: `specs/mcp-sdk-migration/design.md`（标完成）

- [ ] **Step 1: 全量 check + test**

Run: `npm run check && npm test`
Expected: 全 PASS（typecheck + lint + format + 所有 workspace 测试）。

- [ ] **Step 2: 端到端冒烟（gitmcp server）**

Run: `npm run build`（core tsc → dist/）。
确认 `dist/gitmcp/server.js` 生成。
启动 desktop app（`npm run desktop:start`），加一个 GitHub repo（如 `microsoft/typescript`），触发 `search_documentation`，确认正常返回。这验证 stdio 子进程 spawn + SDK 握手 + 工具调用全链路。

- [ ] **Step 3: 端到端冒烟（外部 MCP server）**

在设置里启用任一外部 MCP（dart/serena/expo），确认 listTools + callTool 正常。重点验证 **Windows spawn**（Task 4 Step 2 的 spawnSpec 决策）——若外部 server 启动失败，退路：直接传原始 command/args 给 StdioClientTransport。

- [ ] **Step 4: 构建产物依赖树检查**

确认 gitmcp server 产物未拖入 HTTP/SSE/auth 依赖。检查方式：
```bash
node -e "import('@modelcontextprotocol/sdk/server/mcp.js').then(() => console.log('server/mcp loads clean'))"
```
若担心 bundle 体积，临时用 esbuild bundle `gitmcp/server.ts` 看大小：
```bash
cd packages/core && npx esbuild src/gitmcp/server.ts --bundle --platform=node --format=esm --outfile=/tmp/gitmcp-bundle.js && ls -lh /tmp/gitmcp-bundle.js
```
确认无 express/hono/jose/eventsource。若体积异常大，检查 import 是否只引了 `/server/mcp.js`+`/server/stdio.js`+`/types.js`。

- [ ] **Step 5: 更新 spec 状态**

把 `specs/mcp-sdk-migration/design.md` 顶部状态改为「已完成」，勾选 §8 验收标准。

- [ ] **Step 6: 最终 commit**

```bash
git add specs/mcp-sdk-migration/design.md
git commit -m "docs(mcp): mark SDK migration complete (verified end-to-end)"
```

---

## 风险与备选

- **R1（Task 4 Step 2）Windows spawn 语义**：createMcpSpawnSpec 的 shell 转义 vs SDK cross-spawn。Task 6 Step 3 重点验证；退路直传原始 command/args。
- **R2（Task 4 Step 3）超时语义变化**：SDK connect/callTool 无内置超时。manager 用 Promise.race 包 MCP_*_TIMEOUT_MS。
- **R3（Task 4 Step 2）isConnected() 无 SDK 等价**：维护 `Set<string>` 已连接 server 名。
- **R4（Task 2）类型 shape 差异**：SDK Tool.inputSchema 是 JSONObject，DeepOrca 旧 shape 是字面量。types.ts 包兼容层，typecheck 暴露即修。
- **R5（Task 6 Step 4）bundle 体积**：只引 server 子路径；esbuild tree-shake HTTP/SSE。

## 不在本计划范围
- sampling/roots/elicitation handler 的**业务实现**（迁移只声明 capabilities + 留 handler 注册点，具体 handler 逻辑随 A2UI/后续特性做）。
- Streamable HTTP transport 接入（迁移让 SDK 就位，HTTP 接入是独立特性）。
- 迁移到 SDK 2.0（当前钉 1.22.0，2.0 稳定后单独评估）。
