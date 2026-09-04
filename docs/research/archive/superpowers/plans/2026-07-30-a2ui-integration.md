# A2UI 集成实施计划 — 声明式交互界面 + AI-native 原型模块

> ⚠️ **本计划已过时，待重写。** 基于手写 MCP（Task 2-8 仿 gitmcp/rpc.ts）。用户已决策 **MCP SDK 迁移为最高优先级前置**——A2UI server 须基于 `@modelcontextprotocol/sdk` 的 `Server` 重写，而非手写 JSON-RPC 循环。待 SDK 迁移 spec 定稿后，本计划 Task 2-8（server 部分）需基于 SDK 重写；renderer/IPC/Skill 任务（Task 1, 9-16）大致保留但优先级重排（见 spec §7）。**勿直接执行本计划，先做 SDK 迁移。** 详见 `docs/research/2026-07-mcp-sdk-migration.md` §六。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DeepOrca 中集成 A2UI（Agent-to-UI）协议，让 agent 能实时驱动声明式交互界面——落地 AI-native 原型模块（PM 向）+ 富交互工具结果两个 P1 场景。

**Architecture:** 自研 Node stdio MCP server（仿 `packages/core/src/gitmcp/` 三件套，复用手写 JSON-RPC 循环），把 A2UI Surface JSON 包进 MCP `CallToolResult` 的 `ToolExecutionResult.metadata.a2ui` 字段，经既有 `executor.ts` 序列化 → IPC → renderer 的单例 `MessageProcessor`（`@a2ui/web_core`）渲染为 `<A2uiSurface>`。`a2ui_action` 回流走标准 MCP 工具调用。**零新传输机制、零新内置工具、core 保持 UI-free。**

**Tech Stack:** TypeScript（ESM, strict, `verbatimModuleSyntax`）· Node ≥22 · `@a2ui/react@^0.10` + `@a2ui/web_core@^0.10`（Apache-2.0, React 18/19 peer）· node:test + node:assert/strict · esbuild（renderer bundle）

**Spec 依据:** `specs/archive/a2ui-integration/design.md`（设计草案）· `docs/research/2026-07-a2ui-integration.md`（调研）

**架构关键事实（来自代码探查，必须遵守）:**
- DeepOrca **没有** `@modelcontextprotocol/sdk` 依赖；所有自建 MCP server 用 `packages/core/src/gitmcp/rpc.ts` 的手写 ~100 行 JSON-RPC 循环。
- 每个内置 MCP server 是**独立 stdio 子进程**，由 `McpClient` spawn——A2UI server 也必须如此，不能 in-process。
- `ToolExecutionResult`（`packages/core/src/common/tool-types.ts:82`）有 `metadata?: Record<string, unknown>` 字段——A2UI Surface 负载走这里，**无需改类型签名**。
- 内置 server 注册走 `SessionManager.augmentMcpServersWithBuiltins()`（`session.ts:536-626`）的 3-gate 模式：项目检测 + `!isXxxDisabled()` + `hasOwnProperty` 用户覆盖。
- renderer 当前是单个 sandboxed `BrowserWindow`，**无 webview/iframe**；消息渲染在 `packages/desktop/src/renderer/components/Message.tsx`。
- core 源码相对导入**不写扩展名**（`scripts/rewrite-esm-imports.js` 构建期补 `.js`）。

**关键技术决策（采用推荐默认）:**
- 数据流：**复用 `ToolExecutionResult.metadata.a2ui`** 通道（不新增流式 IPC，守「零新机制」）。
- Server：**自研 Node server**（仿 gitmcp/，保持纯 Node MCP 一致性）。
- P1 首发场景：**AI-native 原型模块 + 富交互工具结果**（产品价值最高，共享 Surface 基础设施）。

---

## 文件结构

**新增文件（core, UI-free）:**
- `packages/core/src/a2ui/rpc.ts` — 从 gitmcp/rpc.ts 复制的手写 JSON-RPC 循环（通用，复用）。
- `packages/core/src/a2ui/server.ts` — MCP server 入口：`buildServerHandlers()` + `main()` 自启动守卫。
- `packages/core/src/a2ui/tools.ts` — 工具定义（`render_prototype` / `render_surface` / `a2ui_action` / `a2ui_error`）+ `callTool()` 派发。
- `packages/core/src/a2ui/catalog.ts` — Basic Catalog JSON（内联，构建期离线校验过的常量）。
- `packages/core/src/a2ui/templates.ts` — 原型/符号树等场景的 A2UI JSON 模板 + `assemblePrototype()` 拼装。
- `packages/core/src/common/a2ui-mcp.ts` — `A2UI_MCP_SERVER_NAME` + 3-gate（`hasA2uiProject`/`setA2uiDisabled`/`isA2uiDisabled`）+ `buildA2uiMcpServerConfig()`。
- `packages/core/templates/skills/bundled/a2ui-prototype/SKILL.md` — PM 原型工作流 Skill。
- `packages/core/src/tests/a2ui.test.ts` — core 测试（RPC 派发 / 工具拼装 / metadata 形状）。

**新增文件（renderer）:**
- `packages/desktop/src/renderer/a2ui/processor.ts` — 单例 `MessageProcessor` + basicCatalog 注册。
- `packages/desktop/src/renderer/components/A2uiSurfaceView.tsx` — 消息内嵌 `<A2uiSurface>` 渲染。

**修改文件:**
- `packages/core/src/index.ts` — 导出 a2ui 公共 API（server name / gate 函数）。
- `packages/core/src/session.ts` — `augmentMcpServersWithBuiltins()` 加 A2UI 3-gate 块。
- `packages/core/src/tools/executor.ts` — `formatToolResult()` 把 `result.metadata.a2ui` 透传（已天然支持，仅需确认）。
- `packages/desktop/src/shared/ipc.ts` — 新增 `IpcRequest.A2uiAction` + `IpcEvent.A2uiSurface` 类型。
- `packages/desktop/src/preload/index.ts`（或 preload 文件）— 暴露 `window.deeporca.a2uiAction`。
- `packages/desktop/src/main/session-bridge.ts` — 处理 `a2ui:action` invoke + 转发 Surface 事件。
- `packages/desktop/src/renderer/components/Message.tsx` — 消息分支：`metadata.a2ui` → `<A2uiSurfaceView>`。
- `packages/desktop/build.mjs` — esbuild 配 CSS Modules（`.module.css`）。
- `packages/desktop/package.json` + `packages/core/package.json` — 加 `@a2ui/react`、`@a2ui/web_core`、`zod` 依赖。
- `packages/core/templates/builtin-plugins.json` — 注册 a2ui 内置组（供设置面板开关）。

**测试运行:** `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/<file>.test.ts`

---

## Task 1: P0 验证 — esbuild 能否处理 `@a2ui/react` 的 CSS Modules

这是整个方案的技术咽喉（spec §9 R1）。先验证再写代码，失败则整个方案要换退路。

**Files:**
- Modify: `packages/desktop/build.mjs`
- Modify: `packages/desktop/package.json`

- [ ] **Step 1: 安装依赖到 desktop**

Run（在 repo root）:
```bash
cd packages/desktop && npm install @a2ui/react@^0.10 @a2ui/web_core@^0.10 zod@^3.23.8 --save
```

- [ ] **Step 2: 验证包能否被 esbuild 打包**

在 `packages/desktop/src/renderer/` 临时建一个探针文件 `a2ui-probe.tsx`:
```tsx
import { A2uiSurface, basicCatalog } from "@a2ui/react/v0_9";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
export const probe = { A2uiSurface, basicCatalog, MessageProcessor };
```

Run: `npm run desktop:build 2>&1 | tail -30`
Expected: 构建成功，或报 `.module.css` 相关错误。

- [ ] **Step 3: 若 Step 2 报 CSS Modules 错误，配置 esbuild loader**

读 `packages/desktop/build.mjs`，找到 renderer bundle 的 esbuild 配置（搜 `esbuild.build` 或 `cssLoader`）。在 loader 配置里加 CSS Modules 处理（esbuild 原生支持 `.module.css` 当作 CSS，但需确认 `<A2uiSurface>` 的 `injectStyles` 路径）。

若 esbuild 无法正确处理，退路：用 `@a2ui/react/v0_9` 的 `injectStyles()`（README 提到的样式注入函数）替代 CSS Modules——在 renderer 入口调用一次。

- [ ] **Step 4: 删除探针文件，确认基础构建仍通过**

```bash
rm packages/desktop/src/renderer/a2ui-probe.tsx
npm run desktop:build
```
Expected: 构建成功。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/package.json packages/desktop/package-lock.json packages/desktop/build.mjs
git commit -m "build(a2ui): add @a2ui/react deps, verify esbuild CSS Modules support"
```

---

## Task 2: 复制通用 JSON-RPC 循环到 `packages/core/src/a2ui/rpc.ts`

`packages/core/src/gitmcp/rpc.ts` 是通用且可复用的，逐字复制。它不含任何 gitmcp 业务逻辑。

**Files:**
- Create: `packages/core/src/a2ui/rpc.ts`
- Test: `packages/core/src/tests/a2ui.test.ts`

- [ ] **Step 1: 写第一个失败测试 — RPC 派发**

Create `packages/core/src/tests/a2ui.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchRpcMessage, METHOD_NOT_FOUND, PARSE_ERROR } from "../a2ui/rpc";

test("dispatchRpcMessage returns result for known method", async () => {
  const handlers = { ping: () => ({ pong: true }) };
  const res = await dispatchRpcMessage(handlers, { jsonrpc: "2.0", id: 1, method: "ping" });
  assert.equal(res?.id, 1);
  assert.deepEqual(res?.result, { pong: true });
});

test("dispatchRpcMessage returns METHOD_NOT_FOUND for unknown method", async () => {
  const res = await dispatchRpcMessage({}, { jsonrpc: "2.0", id: 2, method: "nope" });
  assert.equal(res?.error?.code, METHOD_NOT_FOUND);
});

test("dispatchRpcMessage returns PARSE_ERROR-shaped invalid request", async () => {
  const res = await dispatchRpcMessage({}, { jsonrpc: "2.0", id: null, method: "x", params: "notobj" });
  // 非法 params 不阻断；非法 message 顶层才返回 INVALID_REQUEST
  assert.ok(res === null || typeof res === "object");
});

test("dispatchRpcMessage returns null for notifications (no id)", async () => {
  const res = await dispatchRpcMessage({ n: () => "v" }, { jsonrpc: "2.0", method: "n" });
  assert.equal(res, null);
});
```

- [ ] **Step 2: 运行测试确认失败（模块不存在）**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/a2ui.test.ts`
Expected: FAIL — `Cannot find module '../a2ui/rpc'`

- [ ] **Step 3: 创建 rpc.ts — 逐字复制 gitmcp/rpc.ts**

Create `packages/core/src/a2ui/rpc.ts`，内容与 `packages/core/src/gitmcp/rpc.ts` **完全一致**（导出 `PARSE_ERROR`/`INVALID_REQUEST`/`METHOD_NOT_FOUND`/`INTERNAL_ERROR`/`RpcError`/`RpcHandler`/`RpcHandlers`/`dispatchRpcMessage`/`serveStdio`）。注释头部改为「A2UI MCP server 用的 stdio JSON-RPC 循环」。

> 复制后把 gitmcp 那份保留不动（DRY 在此让位于隔离——两个 server 独立演进，避免 gitmcp 改动误伤 a2ui）。

- [ ] **Step 4: 运行测试确认通过**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/a2ui.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/a2ui/rpc.ts packages/core/src/tests/a2ui.test.ts
git commit -m "feat(a2ui): add stdio JSON-RPC loop (mirror gitmcp/rpc)"
```

---

## Task 3: A2UI 工具定义与 `callTool()` 派发

定义三个工具：`render_prototype`（PM 原型）、`render_surface`（通用 Surface，供工具结果用）、`a2ui_action`（交互回流）、`a2ui_error`（渲染失败上报）。

**Files:**
- Create: `packages/core/src/a2ui/tools.ts`
- Test: `packages/core/src/tests/a2ui.test.ts`（追加）

- [ ] **Step 1: 写失败测试 — 工具定义与 callTool 返回形状**

追加到 `packages/core/src/tests/a2ui.test.ts`:
```ts
import { buildToolDefinitions, callTool } from "../a2ui/tools";

test("buildToolDefinitions exposes render_prototype, render_surface, a2ui_action, a2ui_error", () => {
  const defs = buildToolDefinitions();
  const names = defs.map((d) => d.name);
  assert.ok(names.includes("render_prototype"));
  assert.ok(names.includes("render_surface"));
  assert.ok(names.includes("a2ui_action"));
  assert.ok(names.includes("a2ui_error"));
});

test("callTool render_prototype returns metadata.a2ui with surfaceId + messages", async () => {
  const result = await callTool("render_prototype", { title: "登录页", sections: ["用户名", "密码"] });
  assert.equal(result.ok, true);
  assert.equal(result.name, "render_prototype");
  assert.ok(result.metadata?.a2ui, "metadata.a2ui must be present");
  const a2ui = result.metadata!.a2ui as { surfaceId: string; messages: unknown[] };
  assert.equal(typeof a2ui.surfaceId, "string");
  assert.ok(a2ui.messages.length >= 1, "must emit at least createSurface");
});

test("callTool a2ui_action echoes name + context as output text", async () => {
  const result = await callTool("a2ui_action", { name: "submit", context: { foo: "bar" } });
  assert.equal(result.ok, true);
  assert.match(result.output!, /submit/);
});

test("callTool unknown tool returns ok:false", async () => {
  const result = await callTool("bogus", {});
  assert.equal(result.ok, false);
  assert.match(result.error!, /Unknown tool/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/a2ui.test.ts`
Expected: FAIL — `Cannot find module '../a2ui/tools'`

- [ ] **Step 3: 实现 tools.ts**

Create `packages/core/src/a2ui/tools.ts`:
```ts
import type { McpToolDefinition } from "../mcp/mcp-client";
import type { ToolExecutionResult } from "../common/tool-types";
import { assemblePrototype, assembleSurface } from "./templates";

/**
 * A2UI MCP server 暴露的工具。Surface JSON 经 ToolExecutionResult.metadata.a2ui
 * 透传到 renderer（executor.formatToolResult 天然支持 metadata）。
 * action/error 回流就是普通工具调用，走同一个 ToolExecutor。
 */

export function buildToolDefinitions(): McpToolDefinition[] {
  return [
    {
      name: "render_prototype",
      description:
        "Render an AI-native prototype Surface for a product manager. Describe the page/flow in natural " +
        "language (title + sections); returns an A2UI declarative Surface that renders interactively in " +
        "DeepOrca. Use for rapid product prototyping, not for design deliverables (use deep-design for those).",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Prototype page title" },
          sections: {
            type: "array",
            items: { type: "string" },
            description: "Ordered list of sections/components to include (e.g. ['header','form','cta'])",
          },
          surfaceId: { type: "string", description: "Optional existing surfaceId to update (incremental patch)" },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
    {
      name: "render_surface",
      description:
        "Render a generic A2UI Surface (for rich tool results: symbol trees, repo structure, task boards). " +
        "Provide raw A2UI component definitions; returns them as an interactive Surface.",
      inputSchema: {
        type: "object",
        properties: {
          surfaceId: { type: "string" },
          components: {
            type: "array",
            description: "A2UI component definitions (adjacency-list flat structure)",
            items: { type: "object" },
          },
          data: { type: "object", description: "Initial data model for the surface" },
        },
        required: ["surfaceId"],
        additionalProperties: false,
      },
    },
    {
      name: "a2ui_action",
      description: "Handle a user interaction from a rendered A2UI Surface (button click, form submit). " +
        "Called by the client when the user interacts; the agent should respond with the next Surface update.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Action event name" },
          context: { type: "object", description: "Resolved data bindings from the surface state" },
          surfaceId: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "a2ui_error",
      description: "Report a rendering failure back to the agent for fallback handling.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          surfaceId: { type: "string" },
        },
        required: ["code", "message"],
        additionalProperties: false,
      },
    },
  ];
}

export async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  switch (name) {
    case "render_prototype": {
      const title = String(args.title ?? "Untitled");
      const sections = Array.isArray(args.sections) ? (args.sections as string[]) : [];
      const surfaceId = typeof args.surfaceId === "string" ? args.surfaceId : `proto-${Date.now()}`;
      const messages = assemblePrototype(surfaceId, title, sections);
      return {
        ok: true,
        name,
        output: `Rendered prototype "${title}" (surface ${surfaceId}, ${sections.length} sections).`,
        metadata: { a2ui: { surfaceId, messages } },
      };
    }
    case "render_surface": {
      const surfaceId = String(args.surfaceId ?? `surf-${Date.now()}`);
      const components = Array.isArray(args.components) ? args.components : [];
      const data = (args.data as Record<string, unknown>) ?? {};
      const messages = assembleSurface(surfaceId, components, data);
      return {
        ok: true,
        name,
        output: `Rendered surface ${surfaceId} (${components.length} components).`,
        metadata: { a2ui: { surfaceId, messages } },
      };
    }
    case "a2ui_action": {
      const actionName = String(args.name ?? "");
      const ctx = args.context ?? {};
      return {
        ok: true,
        name,
        output: `Received action "${actionName}" with context ${JSON.stringify(ctx)}. Respond with the next render_prototype/render_surface call.`,
      };
    }
    case "a2ui_error": {
      const code = String(args.code ?? "unknown");
      const message = String(args.message ?? "");
      return { ok: true, name, output: `Acknowledged render error [${code}]: ${message}` };
    }
    default:
      return { ok: false, name, error: `Unknown tool: ${name}` };
  }
}
```

- [ ] **Step 4: 运行确认失败（templates 不存在）**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/a2ui.test.ts`
Expected: FAIL — `Cannot find module './templates'`

- [ ] **Step 5: Commit（templates 在 Task 4 实现）**

暂不 commit；先做 Task 4。

---

## Task 4: A2UI 模板拼装（`templates.ts`）

把 PM 的自然语言意图（title + sections）拼成合法的 A2UI v0.9 消息序列。

**Files:**
- Create: `packages/core/src/a2ui/templates.ts`
- Test: `packages/core/src/tests/a2ui.test.ts`（追加）

- [ ] **Step 1: 写失败测试 — 模板拼装形状**

追加到 `packages/core/src/tests/a2ui.test.ts`:
```ts
import { assemblePrototype, assembleSurface } from "../a2ui/templates";

test("assemblePrototype emits createSurface + updateComponents + updateDataModel", () => {
  const msgs = assemblePrototype("s1", "登录页", ["用户名", "密码"]);
  assert.equal(msgs.length, 3);
  assert.ok("createSurface" in msgs[0]);
  assert.ok("updateComponents" in msgs[1]);
  assert.ok("updateDataModel" in msgs[2]);
  assert.equal((msgs[0] as { createSurface: { surfaceId: string } }).createSurface.surfaceId, "s1");
});

test("assemblePrototype components reference /title and /sections via JSON Pointer", () => {
  const msgs = assemblePrototype("s1", "Test", ["a", "b"]);
  const comp = (msgs[1] as { updateComponents: { components: Array<{ component: string; text?: { path: string } }> } }).updateComponents.components;
  const texts = comp.filter((c) => c.component === "Text");
  assert.ok(texts.some((t) => t.text?.path === "/title"), "must bind a Text to /title");
});

test("assembleSurface with empty components still emits createSurface", () => {
  const msgs = assembleSurface("s2", [], {});
  assert.equal(msgs.length, 1);
  assert.ok("createSurface" in msgs[0]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/a2ui.test.ts`
Expected: FAIL — `Cannot find module '../a2ui/templates'`

- [ ] **Step 3: 实现 templates.ts**

Create `packages/core/src/a2ui/templates.ts`:
```ts
import { BASIC_CATALOG_ID } from "./catalog";

/**
 * 拼装 A2UI v0.9 消息序列。这里不依赖 @a2ui/web_core（那是 renderer 的）；
 * core 只产出 JSON 结构，renderer 的 MessageProcessor 消费它。
 *
 * v0.9 消息格式参考：
 *   { version:"v0.9", createSurface:{ surfaceId, catalogId } }
 *   { version:"v0.9", updateComponents:{ surfaceId, components:[{id,component,...}] } }
 *   { version:"v0.9", updateDataModel:{ surfaceId, path:"/", value:{...} } }
 */

type A2uiMessage = Record<string, unknown>;

export function assemblePrototype(surfaceId: string, title: string, sections: string[]): A2uiMessage[] {
  // 构建一个 Column：标题 Text + 每个 section 一个 Text（绑定到 /sections/<i>）。
  const childIds = sections.map((_, i) => `sec-${i}`);
  const components: Record<string, unknown>[] = [
    { id: "root", component: "Column", children: ["title", ...childIds] },
    { id: "title", component: "Text", text: { path: "/title" } },
    ...childIds.map((id, i) => ({
      id,
      component: "Text",
      text: { path: `/sections/${i}` },
    })),
  ];

  return [
    { version: "v0.9", createSurface: { surfaceId, catalogId: BASIC_CATALOG_ID } },
    { version: "v0.9", updateComponents: { surfaceId, components } },
    {
      version: "v0.9",
      updateDataModel: { surfaceId, path: "/", value: { title, sections } },
    },
  ];
}

export function assembleSurface(
  surfaceId: string,
  components: Record<string, unknown>[],
  data: Record<string, unknown>
): A2uiMessage[] {
  const msgs: A2uiMessage[] = [{ version: "v0.9", createSurface: { surfaceId, catalogId: BASIC_CATALOG_ID } }];
  if (components.length > 0) {
    msgs.push({ version: "v0.9", updateComponents: { surfaceId, components } });
    msgs.push({ version: "v0.9", updateDataModel: { surfaceId, path: "/", value: data } });
  }
  return msgs;
}
```

- [ ] **Step 4: 实现 catalog.ts（最小常量）**

Create `packages/core/src/a2ui/catalog.ts`:
```ts
/**
 * A2UI Basic Catalog 标识符。core 只需这个 ID（填进 createSurface.catalogId）；
 * 实际的 catalog 定义由 renderer 的 @a2ui/react basicCatalog 提供。
 *
 * 构建期应离线校验 templates.ts 产出的 JSON 是否符合 v0.9 Basic Catalog schema
 * （见 spec §3.3）。当前先用常量，校验脚本作为 P2 增强。
 */
export const BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/basic_catalog.json";
export const A2UI_MIME_TYPE = "application/a2ui+json";
export const A2UI_PROTOCOL_VERSION = "v0.9";
```

- [ ] **Step 5: 运行全部 a2ui 测试确认通过**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/a2ui.test.ts`
Expected: PASS（11 tests: rpc 4 + tools 4 + templates 3）

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/a2ui/tools.ts packages/core/src/a2ui/templates.ts packages/core/src/a2ui/catalog.ts packages/core/src/tests/a2ui.test.ts
git commit -m "feat(a2ui): tool definitions + prototype/surface template assembly"
```

---

## Task 5: A2UI MCP server 入口（`server.ts`）

仿 `packages/core/src/gitmcp/server.ts`，把 handlers 接到 RPC 循环。

**Files:**
- Create: `packages/core/src/a2ui/server.ts`
- Test: `packages/core/src/tests/a2ui.test.ts`（追加）

- [ ] **Step 1: 写失败测试 — handlers 形状**

追加到 `packages/core/src/tests/a2ui.test.ts`:
```ts
import { buildServerHandlers } from "../a2ui/server";

test("buildServerHandlers exposes initialize, tools/list, tools/call", async () => {
  const handlers = buildServerHandlers();
  assert.ok(handlers.initialize, "must have initialize");
  assert.ok(handlers["tools/list"], "must have tools/list");
  assert.ok(handlers["tools/call"], "must have tools/call");
  const init = (await handlers.initialize({})) as { capabilities: { tools: unknown } };
  assert.ok(init.capabilities?.tools, "initialize must advertise tools capability");
});

test("server tools/list returns the 4 a2ui tools", async () => {
  const handlers = buildServerHandlers();
  const res = (await handlers["tools/list"]({})) as { tools: { name: string }[] };
  const names = res.tools.map((t) => t.name);
  assert.equal(names.length, 4);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/a2ui.test.ts`
Expected: FAIL — `Cannot find module '../a2ui/server'`

- [ ] **Step 3: 实现 server.ts**

Create `packages/core/src/a2ui/server.ts`:
```ts
import { pathToFileURL } from "node:url";
import { serveStdio, type RpcHandlers } from "./rpc";
import { buildToolDefinitions, callTool } from "./tools";

/**
 * A2UI MCP server 入口。独立 stdio 子进程，由 McpClient spawn。
 * 与 gitmcp/server.ts 同构：initialize → tools/list → tools/call。
 * 不要 import resolve/a2ui-mcp（保持 server bundle 精简，与 gitmcp 约定一致）。
 */

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-03-26", "2024-11-05"];

export function buildServerHandlers(): RpcHandlers {
  return {
    initialize: (params) => {
      const requested = (params as { protocolVersion?: string } | undefined)?.protocolVersion;
      const protocolVersion = requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : "2025-03-26";
      return {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "a2ui", version: "0.1.0" },
      };
    },
    "notifications/initialized": () => undefined,
    ping: () => ({}),
    "tools/list": () => ({ tools: buildToolDefinitions() }),
    "tools/call": async (params) => {
      const { name, arguments: args } = (params ?? {}) as { name: string; arguments?: Record<string, unknown> };
      const result = await callTool(name, args ?? {});
      // MCP CallToolResult：成功用 text + isError=false；a2ui Surface 经 _meta（MCP 规范字段）透传。
      const textContent = result.output ?? (result.ok ? "ok" : result.error ?? "error");
      return {
        content: [{ type: "text", text: textContent }],
        isError: result.ok ? false : true,
        // 用 MCP 规范字段 _meta 携带 a2ui Surface，McpClient 读 _meta.a2ui（见 Task 8）。
        _meta: result.metadata?.a2ui ? { a2ui: result.metadata.a2ui } : undefined,
      };
    },
  };
}

function main(): void {
  serveStdio(buildServerHandlers());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/a2ui.test.ts`
Expected: PASS（13 tests）

> **注意 — MCP metadata 透传验证**：上一步把 Surface 放进 `CallToolResult._a2ui`。需确认 `McpClient.executeMcpTool()`（`packages/core/src/mcp/mcp-client.ts`）会把非标准 `_a2ui` 字段透传到 `ToolExecutionResult.metadata`。若 McpClient 丢弃了未知字段，需在 `executeMcpTool` 里加一行 `metadata: callResult._a2ui ? { a2ui: callResult._a2ui } : undefined`。这是 Task 8 的检查项。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/a2ui/server.ts packages/core/src/tests/a2ui.test.ts
git commit -m "feat(a2ui): stdio MCP server entry (initialize/tools-list/tools-call)"
```

---

## Task 6: 注册器 `packages/core/src/common/a2ui-mcp.ts`（3-gate + buildConfig）

仿 `expo-mcp.ts` 的 gate 模式 + gitmcp `resolve.ts` 的 runtime 解析。A2UI 不需要 sqlite，故用简单 Node runtime（Electron bundled Node 或 host node）。

**Files:**
- Create: `packages/core/src/common/a2ui-mcp.ts`
- Test: `packages/core/src/tests/a2ui.test.ts`（追加）

- [ ] **Step 1: 写失败测试 — gate 与 config 构造**

追加到 `packages/core/src/tests/a2ui.test.ts`:
```ts
import {
  A2UI_MCP_SERVER_NAME,
  setA2uiDisabled,
  isA2uiDisabled,
  buildA2uiMcpServerConfig,
} from "../common/a2ui-mcp";
import * as path from "node:path";

test("disable gate is per-project-root and toggles", () => {
  const root = path.resolve("/tmp/proj-a");
  setA2uiDisabled(root, true);
  assert.equal(isA2uiDisabled(root), true);
  setA2uiDisabled(root, false);
  assert.equal(isA2uiDisabled(root), false);
});

test("buildA2uiMcpServerConfig returns command + args pointing at dist entry, or null when missing", () => {
  const cfg = buildA2uiMcpServerConfig(path.resolve("/tmp/proj-a"));
  // 在测试环境 dist 可能不存在；接受 null 或合法 config。
  if (cfg) {
    assert.equal(typeof cfg.command, "string");
    assert.ok(Array.isArray(cfg.args));
    assert.ok(cfg.args.some((a) => String(a).includes("a2ui") || String(a).includes("server")));
  }
});

test("A2UI_MCP_SERVER_NAME is the fixed builtin server name", () => {
  assert.equal(A2UI_MCP_SERVER_NAME, "a2ui");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/a2ui.test.ts`
Expected: FAIL — `Cannot find module '../common/a2ui-mcp'`

- [ ] **Step 3: 实现 a2ui-mcp.ts**

Create `packages/core/src/common/a2ui-mcp.ts`:
```ts
import { existsSync } from "node:fs";
import path from "node:path";
import { ELECTRON_NODE_RUNTIME, resolveSqliteRuntimeForEntry } from "./codegraph";
import type { McpServerConfig } from "../settings";

export const A2UI_MCP_SERVER_NAME = "a2ui";

// ── Disable flag (host-managed, per project root) ────────────────────────────

const disabledA2uiRoots = new Set<string>();

export function setA2uiDisabled(projectRoot: string, disabled: boolean): void {
  const key = path.resolve(projectRoot);
  if (disabled) disabledA2uiRoots.add(key);
  else disabledA2uiRoots.delete(key);
}

export function isA2uiDisabled(projectRoot: string): boolean {
  return disabledA2uiRoots.has(path.resolve(projectRoot));
}

// ── Server entry resolution ──────────────────────────────────────────────────

/**
 * 定位编译后的 A2UI server 入口（dist/a2ui/server.js）。
 * 与 gitmcp/resolve.ts 的 resolveGitmcpServerEntry 同构。
 */
export function resolveA2uiServerEntry(): string | null {
  // __dirname 在 ESM 下经 tsc 编译后可用（core target ES2022）。
  const candidates = [
    path.join(__dirname, "..", "a2ui", "server.js"), // dist/common/ → dist/a2ui/
    path.join(__dirname, "a2ui", "server.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * 构造 spawn 配置。A2UI server 不需要 sqlite，但复用 codegraph 的 runtime
 * 解析（ELECTRON_RUN_AS_NODE 优先，保证 Electron 环境也能 spawn node 子进程）。
 */
export function buildA2uiMcpServerConfig(_projectRoot: string): McpServerConfig | null {
  const entry = resolveA2uiServerEntry();
  if (!entry) return null;
  // resolveSqliteRuntimeForEntry 返回带 node bin 的 runtime；对 A2UI 同样适用。
  const runtime = resolveSqliteRuntimeForEntry(entry) ?? ELECTRON_NODE_RUNTIME();
  if (!runtime) return null;
  const config: McpServerConfig = {
    command: runtime.command,
    args: [...(runtime.prefixArgs ?? []), entry],
  };
  if (runtime.env) config.env = runtime.env;
  return config;
}
```

> **依赖确认**：`ELECTRON_NODE_RUNTIME` 与 `resolveSqliteRuntimeForEntry` 是否从 `./codegraph` 导出，需在实现时核对。若导出名不同（探查报告显示是 `resolveSqliteRuntimeForEntry` 在 `codegraph.ts:126-146`），按实际导出调整 import。若 codegraph 未导出通用 runtime helper，则改为内联最小解析：`{ command: process.execPath, args: [entry], env: process.env.ELECTRON_RUN_AS_NODE ? { ELECTRON_RUN_AS_NODE: "1" } : undefined }`。

- [ ] **Step 4: 运行确认通过**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/a2ui.test.ts`
Expected: PASS（16 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/common/a2ui-mcp.ts packages/core/src/tests/a2ui.test.ts
git commit -m "feat(a2ui): 3-gate registration + server-entry resolver (mirror expo/gitmcp)"
```

---

## Task 7: 在 session.ts 注册 A2UI server（3-gate 块）

把 A2UI server 接进 `augmentMcpServersWithBuiltins()`，与 codegraph/dart/serena/expo 并列。**始终启用**（不依赖项目检测——A2UI 是通用交互层，所有项目都可用），仅受 disable flag + 用户覆盖约束。

**Files:**
- Modify: `packages/core/src/session.ts`（imports + `augmentMcpServersWithBuiltins`）

- [ ] **Step 1: 加 import**

在 `packages/core/src/session.ts` 顶部，expo import 附近（~line 30）加：
```ts
import {
  A2UI_MCP_SERVER_NAME,
  buildA2uiMcpServerConfig,
  isA2uiDisabled,
} from "./common/a2ui-mcp";
```

- [ ] **Step 2: 在 augmentMcpServersWithBuiltins 末尾加 3-gate 块**

在 `session.ts` 的 `augmentMcpServersWithBuiltins()`（探查报告定位 ~line 536-626）里，expo 块之后、函数 return 之前加：
```ts
    // A2UI (interactive declarative UI + AI-native prototype module).
    // 始终可用（通用交互层，不依赖项目类型），仅受 disable flag + 用户覆盖约束。
    if (!isA2uiDisabled(this.projectRoot)) {
      if (!(result && Object.prototype.hasOwnProperty.call(result, A2UI_MCP_SERVER_NAME))) {
        const a2uiConfig = buildA2uiMcpServerConfig(this.projectRoot);
        if (a2uiConfig) {
          result = {
            ...(result ?? {}),
            [A2UI_MCP_SERVER_NAME]: a2uiConfig,
          };
        }
      }
    }
```

- [ ] **Step 3: 在 core index 导出公共 API**

在 `packages/core/src/index.ts`，gitmcp 导出块附近（~line 212-229）加：
```ts
// ── A2UI (interactive declarative UI) ──────────────────────────────────────
export { A2UI_MCP_SERVER_NAME, setA2uiDisabled, isA2uiDisabled } from "./common/a2ui-mcp";
export { buildServerHandlers as buildA2uiServerHandlers } from "./a2ui/server";
```

- [ ] **Step 4: typecheck 通过**

Run: `npm run typecheck`
Expected: PASS。若 `resolveSqliteRuntimeForEntry` import 不存在，按 Task 6 Step 3 的退路修正。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session.ts packages/core/src/index.ts
git commit -m "feat(a2ui): register server in augmentMcpServersWithBuiltins (always-on 3-gate)"
```

---

## Task 8: 验证 MCP metadata 透传链（`_a2ui` → `ToolExecutionResult.metadata`）

确认 `McpClient.executeMcpTool()` 把 server 返回的 `_a2ui` 字段透传成 `ToolExecutionResult.metadata.a2ui`。这是 Surface 负载到达 renderer 的关键一环。

**Files:**
- Read: `packages/core/src/mcp/mcp-client.ts`（`executeMcpTool` 方法）
- Modify（可能）: `packages/core/src/mcp/mcp-client.ts`

- [ ] **Step 1: 读 executeMcpTool，确认 metadata 透传**

读 `packages/core/src/mcp/mcp-client.ts`，定位 `executeMcpTool()`（构造 `CallToolResult` → 返回 `ToolExecutionResult` 的地方）。

确认逻辑：标准 MCP `CallToolResult` 有 `content`/`isError`/`_meta`；A2UI server 在 Task 5 用 `_meta.a2ui` 携带 Surface。需确认 McpClient 是否读取 `_meta`——多数实现会丢弃未知字段。

- [ ] **Step 2: 若 `_meta` 被丢弃，加透传逻辑**

在 `executeMcpTool` 构造返回值处，把 `_meta.a2ui` 提到 `metadata`：
```ts
const meta = callResult._meta as { a2ui?: unknown } | undefined;
const metadata = meta?.a2ui ? { a2ui: meta.a2ui } : undefined;
return {
  ok: !callResult.isError,
  name: toolName,
  output: textContent,        // 已有的文本拼接逻辑
  metadata,
};
```
（用 MCP 规范字段 `_meta`，不自造字段名。）

- [ ] **Step 3: 写透传测试（追加到 mcp-client.test.ts 或 a2ui.test.ts）**

在 `packages/core/src/tests/a2ui.test.ts` 追加一个契约测试（用 mock McpClient 结果，避免起子进程）：
```ts
import type { ToolExecutionResult } from "../common/tool-types";

test("CallToolResult._meta.a2ui maps to ToolExecutionResult.metadata.a2ui", () => {
  // 模拟 McpClient 的映射逻辑（实际逻辑在 mcp-client.ts；此处仅契约断言）。
  const callResult = { content: [{ type: "text", text: "ok" }], isError: false, _meta: { a2ui: { surfaceId: "x", messages: [] } } };
  const metadata = callResult._meta?.a2ui ? { a2ui: callResult._meta.a2ui } : undefined;
  const toolResult: ToolExecutionResult = { ok: true, name: "render_prototype", output: "ok", metadata };
  assert.deepEqual(toolResult.metadata?.a2ui, { surfaceId: "x", messages: [] });
});
```

- [ ] **Step 4: 运行测试 + typecheck**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/a2ui.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp/mcp-client.ts packages/core/src/tests/a2ui.test.ts
git commit -m "feat(a2ui): thread Surface payload via CallToolResult._meta -> metadata.a2ui"
```

---

## Task 9: IPC 契约 — `A2uiAction` 请求 + `A2uiSurface` 事件类型

在 `shared/ipc.ts`（type-only，双向可 bundle）加 A2UI 通道。

**Files:**
- Modify: `packages/desktop/src/shared/ipc.ts`

- [ ] **Step 1: 加 IPC request 常量**

在 `IpcRequest`（~line 25-141）的 Editor/Memory 块之后加：
```ts
  // A2UI (declarative interactive UI)
  A2uiAction: "a2ui:action",
```

- [ ] **Step 2: 加 IPC event 常量**

在 `IpcEvent`（~line 144-156）加：
```ts
  A2uiSurface: "event:a2uiSurface",
```

- [ ] **Step 3: 加 payload 类型**

在 `ipc.ts` 类型定义区（与 `ReviewProgressEvent` 同区）加：
```ts
/** A2UI Surface payload carried from core tool result to the renderer. */
export type A2uiSurfacePayload = {
  surfaceId: string;
  /** A2UI v0.9 messages (createSurface/updateComponents/updateDataModel). */
  messages: Array<Record<string, unknown>>;
};

/** A user interaction dispatched from a rendered Surface back to the agent. */
export type A2uiActionRequest = {
  name: string;
  context?: Record<string, unknown>;
  surfaceId?: string;
  /** The session the action belongs to, so main can route it to the right session loop. */
  sessionId: string;
};
```

- [ ] **Step 4: 加 DesktopApi 方法签名**

在 `DesktopApi`（~line 432-610）的 Editor 块之后加：
```ts
  // ── A2UI (declarative interactive UI) ─────────────────────────────────
  /** Send a user interaction from a rendered Surface back to the agent session. */
  a2uiAction(req: A2uiActionRequest): Promise<{ ok: boolean; error?: string }>;
  /** Subscribe to A2UI Surface updates emitted from the session. Returns unsubscribe fn. */
  onA2uiSurface(cb: (payload: A2uiSurfacePayload) => void): () => void;
```

并在文件末尾 `export type { ... }` 处加 `A2uiSurfacePayload, A2uiActionRequest`。

- [ ] **Step 5: typecheck 通过**

Run: `cd packages/desktop && npx tsc --noEmit`
Expected: PASS（preload/main/renderer 引用 ipc.ts 的地方会报缺方法实现——那是 Task 10/11 的事；先确认类型本身无误。若报错来自 ipc.ts 自身，修正之。）

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/shared/ipc.ts
git commit -m "feat(a2ui): add IPC contract (A2uiAction request + A2uiSurface event + DesktopApi)"
```

---

## Task 10: preload + main — 实现 `a2uiAction` invoke 与 Surface 事件转发

把 IPC 契约两端接通。

**Files:**
- Modify: `packages/desktop/src/preload/index.ts`（或当前 preload 文件名——实现时确认）
- Modify: `packages/desktop/src/main/session-bridge.ts`

- [ ] **Step 1: preload 暴露 a2uiAction + onA2uiSurface**

在 preload（contextIsolation，`window.deeporca` 暴露处），仿既有 `editorReadFile`/`onReviewProgress` 模式加：
```ts
a2uiAction: (req) => ipcRenderer.invoke(IpcRequest.A2uiAction, req),
onA2uiSurface: (cb) => {
  const listener = (_e: unknown, payload: A2uiSurfacePayload) => cb(payload);
  ipcRenderer.on(IpcEvent.A2uiSurface, listener);
  return () => ipcRenderer.off(IpcEvent.A2uiSurface, listener);
},
```

- [ ] **Step 2: main 注册 A2uiAction handler**

在 `session-bridge.ts`，仿其他 invoke handler（如 `GitmcpAdd`）加：
```ts
ipcMain.handle(IpcRequest.A2uiAction, async (_e, req: A2uiActionRequest) => {
  // 把用户的 action 作为一条新的用户消息注入对应 session，
  // 让 agent 在下一轮循环里调用 render_prototype/render_surface/a2ui_action。
  // 复用既有的 sendPrompt 通道，把 action 包装成结构化提示。
  return sessionManager.injectA2uiAction(req.sessionId, req.name, req.context, req.surfaceId);
});
```

> **依赖**：`sessionManager.injectA2uiAction` 需在 core 的 `SessionManager` 加一个 public 方法。若不想动 core，退路：main 直接调 `sessionManager.replySession(sessionId, { type: "text", text: \`[a2ui_action] name=${name} context=${JSON.stringify(context)}\` })`，让 agent 自然处理。**优先用退路**（零 core 改动）。

- [ ] **Step 3: main 转发 Surface 事件到 renderer**

在 session-bridge.ts 里，监听 assistant 消息流（已有 `onAssistantMessage` 链路）。当消息的 tool result 含 `metadata.a2ui` 时，发 `IpcEvent.A2uiSurface`：
```ts
// 在既有 onAssistantMessage 处理器里（或新增钩子），检测 metadata.a2ui：
function maybeEmitA2uiSurface(sessionId: string, message: SessionMessage) {
  for (const tr of message.toolResults ?? []) {
    const a2ui = (tr.metadata as { a2ui?: A2uiSurfacePayload } | undefined)?.a2ui;
    if (a2ui) {
      mainWindow.webContents.send(IpcEvent.A2uiSurface, a2ui);
    }
  }
}
```

> **确认**：`SessionMessage.toolResults` 的形状需核对（`@deeporca/core` 导出的 `SessionMessage` 类型）。若 tool result metadata 不在消息里直接可见，退路：在 core session 的 `onToolResult` hook 里发事件。

- [ ] **Step 4: typecheck 通过**

Run: `cd packages/desktop && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/preload/ packages/desktop/src/main/session-bridge.ts
git commit -m "feat(a2ui): wire preload a2uiAction + main Surface event forwarding"
```

---

## Task 11: renderer — 单例 MessageProcessor + A2uiSurfaceView

接入 `@a2ui/react`，渲染 Surface。

**Files:**
- Create: `packages/desktop/src/renderer/a2ui/processor.ts`
- Create: `packages/desktop/src/renderer/components/A2uiSurfaceView.tsx`

- [ ] **Step 1: 创建单例 processor**

Create `packages/desktop/src/renderer/a2ui/processor.ts`:
```ts
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { basicCatalog } from "@a2ui/react/v0_9";

/**
 * 单例 MessageProcessor，全 renderer 共享。Surface 以 surfaceId 区分，
 * 由 A2uiSurfaceView 按需渲染。
 */
let processorSingleton: MessageProcessor | null = null;

export function getA2uiProcessor(): MessageProcessor {
  if (!processorSingleton) {
    processorSingleton = new MessageProcessor([basicCatalog]);
  }
  return processorSingleton;
}

/** 把 core 来的 A2UI 消息序列喂给 processor（触发 createSurface/updateComponents 等）。 */
export function feedA2uiMessages(messages: Array<Record<string, unknown>>): void {
  const p = getA2uiProcessor();
  // processMessages 接受 v0.9 消息数组；每条含 version:"v0.9" + createSurface/updateComponents/...
  p.processMessages(messages as never);
}
```

- [ ] **Step 2: 创建 Surface 渲染组件**

Create `packages/desktop/src/renderer/components/A2uiSurfaceView.tsx`:
```tsx
import { useEffect, useState } from "react";
import { A2uiSurface } from "@a2ui/react/v0_9";
import { getA2uiProcessor, feedA2uiMessages } from "../a2ui/processor";
import type { A2uiSurfacePayload } from "@deeporca/desktop/shared/ipc";

/**
 * 渲染一个 A2UI Surface。props 传入 core 来的 payload（surfaceId + messages）。
 * 喂消息进 processor 后，订阅 surfaces 变化，渲染对应 surface。
 */
export function A2uiSurfaceView({ payload }: { payload: A2uiSurfacePayload }) {
  const processor = getA2uiProcessor();

  // 喂消息（增量 patch 也走这里——同 surfaceId 的 updateComponents 会更新既有 surface）。
  useEffect(() => {
    feedA2uiMessages(payload.messages);
  }, [payload]);

  // 订阅该 surface 存在性。
  const [exists, setExists] = useState(() =>
    Boolean(processor.model.surfacesMap.get(payload.surfaceId))
  );
  useEffect(() => {
    const sync = () => setExists(Boolean(processor.model.surfacesMap.get(payload.surfaceId)));
    const c = processor.onSurfaceCreated(sync);
    const d = processor.onSurfaceDeleted(sync);
    return () => {
      c.unsubscribe();
      d.unsubscribe();
    };
  }, [processor, payload.surfaceId]);

  if (!exists) return <div>Rendering surface…</div>;
  const surface = processor.model.surfacesMap.get(payload.surfaceId)!;
  return (
    <div className="a2ui-surface-container">
      <A2uiSurface surface={surface} />
    </div>
  );
}
```

> **确认**：`processor.model.surfacesMap` / `onSurfaceCreated`/`onSurfaceDeleted` 的 API 名取自 `@a2ui/react` README（Task 文献）。实现时若 API 名不同，按实际包导出调整。

- [ ] **Step 3: 在 Message.tsx 加 a2ui 分支**

读 `packages/desktop/src/renderer/components/Message.tsx`，找到 tool result 渲染处。当 `metadata.a2ui` 存在时，渲染 `<A2uiSurfaceView>`：
```tsx
import { A2uiSurfaceView } from "./A2uiSurfaceView";
// ...
{a2uiPayload ? (
  <A2uiSurfaceView payload={a2uiPayload} />
) : (
  /* 既有文本渲染 */
)}
```
（具体提取 `a2uiPayload` 的逻辑取决于 Message.tsx 如何拿 tool result metadata——实现时按现有 diff_preview 的取值路径对照。）

- [ ] **Step 4: 构建 + 手动冒烟**

Run: `npm run desktop:build`
Expected: 构建成功。启动 app，触发一次 `render_prototype`（在对话里让 agent 调用，或临时硬编码一条 Surface 消息测试 processor）。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/a2ui/ packages/desktop/src/renderer/components/
git commit -m "feat(a2ui): singleton MessageProcessor + A2uiSurfaceView rendering in Message.tsx"
```

---

## Task 12: `a2ui_action` 回流闭环（用户点击 → agent 下一轮）

接通交互回流，让原型「活」起来。

**Files:**
- Modify: `packages/desktop/src/renderer/components/A2uiSurfaceView.tsx`
- Modify: `packages/desktop/src/main/session-bridge.ts`（已在 Task 10 处理 action 注入；此处确认）

- [ ] **Step 1: 在 A2uiSurfaceView 绑定 action 派发**

A2UI 的 `Action` 组件点击会触发 catalog 注入的回调。在 processor 初始化时，需把 action 派发到 DeepOrca。更新 `processor.ts` 让 action 走 `window.deeporca.a2uiAction`：
```ts
// 在 getA2uiProcessor 初始化后，或在 A2uiSurfaceView 里捕获 onAction。
// @a2ui/react v0.9 的 createComponentImplementation 会把 Action 解析成 () => void；
// 触发时需调用 window.deeporca.a2uiAction({ name, context, surfaceId, sessionId })。
```
具体接线取决于 `@a2ui/react` 的 action 回调暴露点（`A2uiSurface` 的 onAction prop，或 processor 级监听）。实现时查包的 API。

- [ ] **Step 2: 确认 main 把 action 注入了 session（Task 10 退路）**

确认 `session-bridge.ts` 的 `A2uiAction` handler 用 `replySession` 把 action 作为消息注入对应 session，agent 看到 `[a2ui_action] name=...` 后自然调用 `render_prototype`（增量 patch 同 surfaceId）。

- [ ] **Step 3: 端到端冒烟**

启动 app，让 agent 渲染一个带按钮的 Surface，点击按钮，确认 agent 收到 action 并更新 Surface。

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/
git commit -m "feat(a2ui): close a2ui_action loop (user interaction -> agent -> surface update)"
```

---

## Task 13: PM 原型工作流 Skill（`a2ui-prototype/SKILL.md`）

教 agent 用自然语言驱动原型模块（场景 3 的「产品」门面）。

**Files:**
- Create: `packages/core/templates/skills/bundled/a2ui-prototype/SKILL.md`

- [ ] **Step 1: 写 SKILL.md（YAML frontmatter + 工作流）**

Create `packages/core/templates/skills/bundled/a2ui-prototype/SKILL.md`:
```markdown
---
name: a2ui-prototype
description: AI-native 原型模块。用自然语言驱动声明式 A2UI Surface 原型，供产品经理快速表达想法、验证交互流程。调用 render_prototype 工具产出可交互原型；用户反馈后用相同 surfaceId 增量迭代。
---

# AI-native 原型模块

## 何时使用
- 用户想「快速画一个原型/界面/流程」验证产品想法（非设计交付件——设计交付用 deep-design）。
- 用户描述了页面结构、表单、流程、看板等交互逻辑。

## 工作流
1. **理解意图**：从自然语言提取页面标题 + 主要 sections（顺序列表）。
2. **首版渲染**：调用 `render_prototype`（title + sections），产出可交互 Surface。
3. **迭代**：用户说「把 X 改成 Y」「加一个 Z」时，**用相同的 surfaceId** 再次调用 `render_prototype`——renderer 会增量 patch，不重建整个 Surface。
4. **交互验证**：用户点击原型按钮/填表单会触发 `a2ui_action`；你收到后理解意图，继续 `render_prototype` 更新。

## 输出契约
- 调用 `render_prototype` 后，简述你画了什么（一句话）。**不要把 Surface JSON 贴进对话**——它已渲染。
- 不要用 `write` 写 HTML 文件（那是 deep-design 的事）。原型是 Surface，不是文件。

## 示例
用户：「做一个订单管理页，左侧订单列表，右侧详情和状态」
→ render_prototype(title="订单管理", sections=["订单列表", "详情面板", "状态流转"])
```

- [ ] **Step 2: 确认 skill 被 session.ts 发现**

DeepOrca 从 `./.deeporca/skills/` → `~/.deeporca/skills/` → bundled 扫描（AGENTS.md「Skills discovery」）。bundled 目录是 `packages/core/templates/skills/bundled/`（既有 `deep-design`、`bento-slides` 在此）。新建的 `a2ui-prototype/` 会自动被发现。

Run: `npm run build`（core tsc 不会编译 .md，但确认 templates 目录被打包——若 build 有 copy 步骤，确认 SKILL.md 进 dist）。

- [ ] **Step 3: Commit**

```bash
git add packages/core/templates/skills/bundled/a2ui-prototype/SKILL.md
git commit -m "feat(a2ui): PM prototype workflow skill (natural-language -> render_prototype)"
```

---

## Task 14: 富交互工具结果（场景 1）— codegraph 符号树作为 Surface

让 codegraph 等工具结果可选携带 Surface（P1 第二场景）。

**Files:**
- Modify: `packages/core/src/gitmcp/tools.ts`（或 codegraph 的工具结果处——作为示范，先在 gitmcp 的 search 结果附带可选 Surface）

> **注意**：这是「可选增强」，不破坏既有文本结果。核心改动是：当工具结果适合 Surface 展示时，额外填 `metadata.a2ui`。renderer 优先用 Surface，否则降级文本（Task 11 已处理）。

- [ ] **Step 1: 选一个工具结果加 Surface 负载**

以 gitmcp `search_documentation` 为例：结果目前是纯文本。改造为额外返回一个把命中项渲染成 `List`/`Card` 的 Surface。在 `packages/core/src/gitmcp/tools.ts` 的 `callTool` 里，`search_documentation` 分支返回时附加：
```ts
// 既有 text 结果之外，附加 a2ui Surface（命中项 → Card 列表）
const a2uiMessages = buildSearchResultSurface(surfaceId, hits); // 用 a2ui/templates 的 assembleSurface
return {
  ...textResult,
  metadata: { ...textResult.metadata, a2ui: { surfaceId, messages: a2uiMessages } },
};
```

- [ ] **Step 2: 在 a2ui/templates 加 buildSearchResultSurface helper**

在 `packages/core/src/a2ui/templates.ts` 加一个把 `Array<{title, snippet}>` 拼成 `List` of `Card` 的 helper，复用 `assembleSurface`。

- [ ] **Step 3: 测试 + 冒烟**

Run: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/gitmcp.test.ts`
Expected: PASS（既有测试不应被破坏；Surface 是附加 metadata）。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/gitmcp/tools.ts packages/core/src/a2ui/templates.ts
git commit -m "feat(a2ui): codegraph/gitmcp results optionally carry interactive Surface"
```

---

## Task 15: 内置插件组注册 + 设置面板开关

把 A2UI 注册进 `builtin-plugins.json`，让用户能在设置面板开关（3-gate 的 UI 入口）。

**Files:**
- Modify: `packages/core/templates/builtin-plugins.json`
- Modify: `packages/desktop/src/main/session-bridge.ts`（initMcp 同步 disable 状态，仿 codegraph/dart/serena）

- [ ] **Step 1: 在 builtin-plugins.json 加 a2ui 组**

读 `packages/core/templates/builtin-plugins.json`，仿既有组（如 browser/expo）加一个 a2ui 组：
```json
{
  "name": "a2ui",
  "title": "A2UI 交互界面",
  "description": "Agent 驱动的声明式交互界面 + AI-native 原型模块",
  "type": "group",
  "skills": ["a2ui-prototype"],
  "mcpServers": ["a2ui"],
  "builtin": true
}
```

- [ ] **Step 2: session-bridge initMcp 同步 disable**

在 `session-bridge.ts` 的 `initMcp()`（已有 codegraph/dart/serena 的 disable 同步），加：
```ts
setA2uiDisabled(projectRoot, !isA2uiEnabledFromSettings);
```
（具体 enable 状态读取仿 codegraph 既有逻辑。）

- [ ] **Step 3: typecheck + 构建**

Run: `npm run typecheck && npm run desktop:build`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/core/templates/builtin-plugins.json packages/desktop/src/main/session-bridge.ts
git commit -m "feat(a2ui): register builtin plugin group + settings panel enable/disable sync"
```

---

## Task 16: 全量验证 + 文档收尾

**Files:**
- Modify: `specs/archive/a2ui-integration/design.md`（标记已实现的任务）

- [ ] **Step 1: 全量 check + test**

Run: `npm run check && npm test`
Expected: 全 PASS（typecheck + lint + format + 所有 workspace 测试）。

- [ ] **Step 2: 端到端冒烟（4 场景）**

启动 app，验证：
1. PM 原型：对话「画一个登录页原型」→ Surface 渲染 → 说「加一个忘记密码链接」→ 增量 patch。
2. 工具结果：触发 gitmcp 搜索 → 结果以 Card 列表 Surface 渲染。
3. 交互回流：点击原型按钮 → agent 收到 `a2ui_action` → 更新 Surface。
4. 设置开关：设置面板关掉 a2ui → server 不再注册。

- [ ] **Step 3: 更新 spec 状态**

把 `specs/archive/a2ui-integration/design.md` 顶部状态从「设计草案」改为对应实现状态；勾选 §7 已完成的阶段。

- [ ] **Step 4: 最终 commit**

```bash
git add specs/archive/a2ui-integration/design.md
git commit -m "docs(a2ui): mark P1 implementation complete (prototype module + rich tool results)"
```

---

## 风险与备选

- **R1（Task 1）**：esbuild 不支持 `.module.css` → 退路 `injectStyles()`。已在 Task 1 Step 3 处理。
- **R2（Task 6/7）**：`resolveSqliteRuntimeForEntry` 未从 codegraph 导出 → 退路内联最小 runtime 解析（Task 6 Step 3 注释）。
- **R3（Task 8）**：MCP `_meta` 字段透传需 McpClient 支持 → 用标准 `_meta`（规范字段）而非自造名。
- **R4（Task 10）**：`SessionMessage.toolResults` 形状不确定 → 实现时核对 core 导出类型；退路用 core 的 onToolResult hook。
- **R5（Task 11/12）**：`@a2ui/react` 的 `model.surfacesMap`/`onSurfaceCreated`/action 回调 API 名 → 实现时查包实际导出。

## P2（后续，不在本计划范围）
- 场景 2（结构化输入面板，AskUserQuestion 增强）、场景 4（任务看板）。
- 原型模块独立窗口全屏预览。
- DeepOrca 自定义 catalog 组件（符号树、看板卡片）。
- catalog schema 构建期离线校验脚本。
