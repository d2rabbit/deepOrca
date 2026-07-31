import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildA2uiServer,
  buildA2uiMcpServerConfig,
  setA2uiDisabled,
  isA2uiDisabled,
  persistSurfaces,
  restoreSurfaces,
  clearAllSurfaces,
} from "../mcp/a2ui-mcp";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

interface ToolResultLike {
  isError?: boolean;
  content: Array<Record<string, unknown>>;
}

function textOf(result: ToolResultLike): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => String(c.text))
    .join("");
}

/** Extract and parse the embedded `application/a2ui+json` resource. */
function a2uiMessagesOf(result: ToolResultLike): Array<Record<string, unknown>> {
  const block = result.content.find((c) => c.type === "resource");
  assert.ok(block, "expected an embedded resource block");
  const resource = block.resource as { uri: string; mimeType?: string; text?: string };
  assert.equal(resource.mimeType, "application/a2ui+json");
  assert.ok(resource.uri.startsWith("a2ui://surface/"));
  assert.equal(typeof resource.text, "string");
  return JSON.parse(resource.text as string) as Array<Record<string, unknown>>;
}

// ── Tool definition generation ───────────────────────────────────────────────

test("a2ui server registers all seven tools", async () => {
  const client = await connect(buildA2uiServer());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "a2ui_action",
    "close_surface",
    "list_templates",
    "navigate_to",
    "render_prototype",
    "render_surface",
    "update_surface",
  ]);
  const renderSurface = tools.find((t) => t.name === "render_surface");
  assert.ok(renderSurface?.description?.includes("A2UI Surface"));
  const props = renderSurface?.inputSchema?.properties as Record<string, unknown>;
  assert.deepEqual(Object.keys(props).sort(), ["components", "dataModel", "surfaceId", "title"]);
  await client.close();
});

test("buildA2uiMcpServerConfig returns an in-process marker config", () => {
  const config = buildA2uiMcpServerConfig();
  assert.ok(config);
  assert.equal(config._inProcess, true);
  assert.equal(typeof config.serverBuilder, "function");
});

// ── Disable flag ─────────────────────────────────────────────────────────────

test("setA2uiDisabled toggles per resolved project root", () => {
  const root = path.join(os.tmpdir(), "a2ui-flag-root");
  assert.equal(isA2uiDisabled(root), false);
  setA2uiDisabled(root, true);
  assert.equal(isA2uiDisabled(root), true);
  // Unnormalized path resolves to the same root.
  assert.equal(isA2uiDisabled(path.join(root, "sub", "..")), true);
  setA2uiDisabled(root, false);
  assert.equal(isA2uiDisabled(root), false);
});

// ── render_surface ───────────────────────────────────────────────────────────

test("render_surface emits createSurface/updateComponents/updateDataModel messages", async () => {
  const client = await connect(buildA2uiServer());
  const result = (await client.callTool({
    name: "render_surface",
    arguments: {
      surfaceId: "s1",
      title: "My Surface",
      components: [{ id: "root", type: "Column" }],
      dataModel: { count: 1 },
    },
  })) as ToolResultLike;
  assert.notEqual(result.isError, true);
  assert.ok(textOf(result).includes('Surface "My Surface" (id: s1) created with 1 components.'));
  const messages = a2uiMessagesOf(result);
  assert.equal(messages.length, 3);
  assert.deepEqual(messages[0], { type: "createSurface", surfaceId: "s1", title: "My Surface", catalog: "basic" });
  assert.deepEqual(messages[1], {
    type: "updateComponents",
    surfaceId: "s1",
    components: [{ id: "root", type: "Column" }],
  });
  assert.deepEqual(messages[2], { type: "updateDataModel", surfaceId: "s1", dataModel: { count: 1 } });
  await client.close();
});

test("render_surface with missing required args is rejected", async () => {
  const client = await connect(buildA2uiServer());
  const result = (await client.callTool({ name: "render_surface", arguments: {} })) as ToolResultLike;
  assert.equal(result.isError, true);
  await client.close();
});

// ── render_prototype / list_templates ────────────────────────────────────────

test("render_prototype generates a surface from a known template", async () => {
  const client = await connect(buildA2uiServer());
  const result = (await client.callTool({
    name: "render_prototype",
    arguments: {
      template: "login-form",
      surfaceId: "p1",
      title: "Login",
      params: { fields: ["Email", "Password"] },
    },
  })) as ToolResultLike;
  assert.notEqual(result.isError, true);
  assert.ok(textOf(result).includes('created from template "login-form"'));
  const messages = a2uiMessagesOf(result);
  assert.equal(messages[0].type, "createSurface");
  assert.equal(messages[1].type, "updateComponents");
  assert.ok((messages[1].components as unknown[]).length > 0);
  assert.equal(messages[2].type, "updateDataModel");
  await client.close();
});

test("render_prototype with unknown template returns isError listing templates", async () => {
  const client = await connect(buildA2uiServer());
  const result = (await client.callTool({
    name: "render_prototype",
    arguments: { template: "nope", surfaceId: "p2", title: "X", params: {} },
  })) as ToolResultLike;
  assert.equal(result.isError, true);
  const text = textOf(result);
  assert.ok(text.includes('Unknown template "nope"'));
  assert.ok(text.includes("login-form"));
  await client.close();
});

test("list_templates returns names and params for every template", async () => {
  const client = await connect(buildA2uiServer());
  const result = (await client.callTool({ name: "list_templates", arguments: {} })) as ToolResultLike;
  assert.notEqual(result.isError, true);
  const text = textOf(result);
  for (const name of ["login-form", "dashboard", "list-detail", "wizard", "kanban", "data-table"]) {
    assert.ok(text.includes(name), `missing template ${name}`);
  }
  await client.close();
});

// ── update_surface ───────────────────────────────────────────────────────────

test("update_surface returns the full message history and merges dataModelPatch", async () => {
  const client = await connect(buildA2uiServer());
  await client.callTool({
    name: "render_surface",
    arguments: { surfaceId: "u1", title: "Before", components: [], dataModel: { a: 1 } },
  });
  const result = (await client.callTool({
    name: "update_surface",
    arguments: {
      surfaceId: "u1",
      title: "After",
      components: [{ id: "root", type: "Text" }],
      dataModelPatch: { b: 2 },
    },
  })) as ToolResultLike;
  assert.notEqual(result.isError, true);
  assert.ok(textOf(result).includes('Surface "After" updated: 2 message(s).'));
  // Full history: 3 initial + 2 update messages, so a fresh renderer can hydrate.
  const messages = a2uiMessagesOf(result);
  assert.equal(messages.length, 5);
  assert.equal(messages[0].type, "createSurface");
  const last = messages[4];
  assert.equal(last.type, "updateDataModel");
  assert.deepEqual(last.dataModel, { a: 1, b: 2 });
  await client.close();
});

test("update_surface on an unknown surface returns isError", async () => {
  const client = await connect(buildA2uiServer());
  const result = (await client.callTool({
    name: "update_surface",
    arguments: { surfaceId: "ghost", components: [], dataModelPatch: {} },
  })) as ToolResultLike;
  assert.equal(result.isError, true);
  assert.ok(textOf(result).includes('Surface "ghost" not found'));
  await client.close();
});

// ── close_surface ────────────────────────────────────────────────────────────

test("close_surface emits deleteSurface and forgets the surface", async () => {
  const client = await connect(buildA2uiServer());
  await client.callTool({
    name: "render_surface",
    arguments: { surfaceId: "c1", title: "T", components: [], dataModel: {} },
  });
  const result = (await client.callTool({ name: "close_surface", arguments: { surfaceId: "c1" } })) as ToolResultLike;
  assert.notEqual(result.isError, true);
  const messages = a2uiMessagesOf(result);
  assert.deepEqual(messages, [{ type: "deleteSurface", surfaceId: "c1" }]);
  // Second close: surface is gone; reported without isError.
  const again = (await client.callTool({ name: "close_surface", arguments: { surfaceId: "c1" } })) as ToolResultLike;
  assert.notEqual(again.isError, true);
  assert.ok(textOf(again).includes("not found"));
  await client.close();
});

// ── a2ui_action ──────────────────────────────────────────────────────────────

test("a2ui_action echoes plain actions with their context", async () => {
  const client = await connect(buildA2uiServer());
  const result = (await client.callTool({
    name: "a2ui_action",
    arguments: { surfaceId: "s1", actionName: "submit", context: { form: "login" } },
  })) as ToolResultLike;
  assert.notEqual(result.isError, true);
  const text = textOf(result);
  assert.ok(text.includes('Action "submit" received from Surface "s1"'));
  assert.ok(text.includes('{"form":"login"}'));
  await client.close();
});

test("a2ui_action navigate:<page> updates the nav data model", async () => {
  const client = await connect(buildA2uiServer());
  await client.callTool({
    name: "render_surface",
    arguments: { surfaceId: "n1", title: "App", components: [], dataModel: {} },
  });
  const result = (await client.callTool({
    name: "a2ui_action",
    arguments: { surfaceId: "n1", actionName: "navigate:settings", context: {} },
  })) as ToolResultLike;
  assert.notEqual(result.isError, true);
  assert.ok(textOf(result).includes('Navigated to page "settings"'));
  const messages = a2uiMessagesOf(result);
  assert.equal(messages.length, 1);
  const dataModel = messages[0].dataModel as Record<string, unknown>;
  assert.equal(dataModel["nav.currentPage"], "Settings");
  assert.equal(dataModel["nav.currentPageId"], "settings");
  await client.close();
});

// ── navigate_to ──────────────────────────────────────────────────────────────

test("navigate_to switches the page with defaults for title and content", async () => {
  const client = await connect(buildA2uiServer());
  await client.callTool({
    name: "render_surface",
    arguments: { surfaceId: "n2", title: "App", components: [], dataModel: {} },
  });
  const result = (await client.callTool({
    name: "navigate_to",
    arguments: { surfaceId: "n2", pageName: "profile" },
  })) as ToolResultLike;
  assert.notEqual(result.isError, true);
  const messages = a2uiMessagesOf(result);
  const dataModel = messages[0].dataModel as Record<string, unknown>;
  assert.equal(dataModel["nav.currentPage"], "profile");
  assert.equal(dataModel["nav.currentPageId"], "profile");
  assert.ok(String(dataModel["nav.currentPageContent"]).includes("profile"));
  await client.close();
});

test("navigate_to on an unknown surface returns isError", async () => {
  const client = await connect(buildA2uiServer());
  const result = (await client.callTool({
    name: "navigate_to",
    arguments: { surfaceId: "ghost", pageName: "home" },
  })) as ToolResultLike;
  assert.equal(result.isError, true);
  await client.close();
});

// ── Persistence round-trip ───────────────────────────────────────────────────

test("persistSurfaces/restoreSurfaces round-trips across server rebuilds", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-persist-"));
  try {
    const client = await connect(buildA2uiServer());
    await client.callTool({
      name: "render_surface",
      arguments: { surfaceId: "keep-1", title: "Kept", components: [], dataModel: { v: 42 } },
    });
    persistSurfaces(projectRoot);
    await client.close();
    const file = path.join(projectRoot, ".deeporca", "prototypes", "keep-1.json");
    assert.ok(fs.existsSync(file));

    // Rebuild clears in-memory surfaces: the surface must be gone…
    const client2 = await connect(buildA2uiServer());
    const missing = (await client2.callTool({
      name: "update_surface",
      arguments: { surfaceId: "keep-1", components: [], dataModelPatch: {} },
    })) as ToolResultLike;
    assert.equal(missing.isError, true);

    // …until restoreSurfaces loads it back, skipping malformed files.
    fs.writeFileSync(path.join(projectRoot, ".deeporca", "prototypes", "broken.json"), "{not json", "utf8");
    restoreSurfaces(projectRoot);
    const restored = (await client2.callTool({
      name: "update_surface",
      arguments: { surfaceId: "keep-1", components: [], dataModelPatch: { extra: true } },
    })) as ToolResultLike;
    assert.notEqual(restored.isError, true);
    assert.ok(textOf(restored).includes('Surface "Kept" updated'));

    // clearAllSurfaces wipes memory and disk.
    clearAllSurfaces(projectRoot);
    assert.equal(fs.existsSync(path.join(projectRoot, ".deeporca", "prototypes")), false);
    const cleared = (await client2.callTool({
      name: "update_surface",
      arguments: { surfaceId: "keep-1", components: [], dataModelPatch: {} },
    })) as ToolResultLike;
    assert.equal(cleared.isError, true);
    await client2.close();
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("restoreSurfaces is a no-op for a missing prototypes dir", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-nodir-"));
  try {
    assert.doesNotThrow(() => restoreSurfaces(projectRoot));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
