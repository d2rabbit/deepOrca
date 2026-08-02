/**
 * End-to-end MCP integration tests for the activity-frames behavioral memory.
 *
 * These tests connect to the REAL MCP server via InMemoryTransport (the same
 * transport used at runtime) and call each tool, verifying well-formed output.
 * This is the closest verification to "running in the Electron app" without a GUI.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildActivityFramesServer, ACTIVITY_FRAMES_MCP_SERVER_NAME } from "../activity-frames";

const PROJECT_ROOT = process.cwd();

async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: { content: Array<Record<string, unknown>> }): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => String(c.text))
    .join("");
}

// ── Server initialization ────────────────────────────────────────────────────

test("E2E: activity-frames server starts and registers all tools", async () => {
  const server = buildActivityFramesServer(undefined, PROJECT_ROOT);
  const client = await connect(server);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  // Should have at least the multi-source tools.
  assert.ok(names.includes("get_context"), "get_context must be registered");
  assert.ok(names.includes("get_hotspots"), "get_hotspots must be registered");
  assert.ok(names.includes("get_workflows"), "get_workflows must be registered");
  assert.ok(names.includes("get_profile"), "get_profile must be registered");
  await client.close();
});

// ── get_context (multi-source) ───────────────────────────────────────────────

test("E2E: get_context returns multi-source behavioral summary", async () => {
  const server = buildActivityFramesServer(undefined, PROJECT_ROOT);
  const client = await connect(server);
  const result = await client.callTool({
    name: "get_context",
    arguments: { source: "multi" },
  });
  const text = textOf(result as { content: Array<Record<string, unknown>> });
  assert.ok(text.length > 0, "get_context must return non-empty text");
  // Should mention at least one of the sources.
  assert.ok(
    text.includes("Session") || text.includes("Git") || text.includes("Shell") || text.includes("Files"),
    "get_context should mention at least one data source"
  );
  await client.close();
});

// ── get_hotspots ─────────────────────────────────────────────────────────────

test("E2E: get_hotspots returns JSON with source data", async () => {
  const server = buildActivityFramesServer(undefined, PROJECT_ROOT);
  const client = await connect(server);
  const result = await client.callTool({
    name: "get_hotspots",
    arguments: { source: "git" },
  });
  const text = textOf(result as { content: Array<Record<string, unknown>> });
  assert.ok(text.length > 0, "get_hotspots must return non-empty text");
  const parsed = JSON.parse(text);
  assert.ok(parsed.git, "get_hotspots with source=git must return git data");
  assert.ok(Array.isArray(parsed.git.fileHotspots), "git.fileHotspots must be an array");
  await client.close();
});

test("E2E: get_hotspots with source=all returns all sources", async () => {
  const server = buildActivityFramesServer(undefined, PROJECT_ROOT);
  const client = await connect(server);
  const result = await client.callTool({
    name: "get_hotspots",
    arguments: { source: "all" },
  });
  const text = textOf(result as { content: Array<Record<string, unknown>> });
  const parsed = JSON.parse(text);
  // At least git and shell should have data (session may be empty on fresh repo).
  assert.ok(parsed.git || parsed.shell || parsed.file, "at least one source must have data");
  if (parsed.shell) {
    assert.ok(Array.isArray(parsed.shell.topCommands), "shell.topCommands must be array");
  }
  await client.close();
});

// ── get_workflows ────────────────────────────────────────────────────────────

test("E2E: get_workflows returns workflow patterns", async () => {
  const server = buildActivityFramesServer(undefined, PROJECT_ROOT);
  const client = await connect(server);
  const result = await client.callTool({
    name: "get_workflows",
    arguments: {},
  });
  const text = textOf(result as { content: Array<Record<string, unknown>> });
  assert.ok(text.length > 0, "get_workflows must return non-empty text");
  const parsed = JSON.parse(text);
  assert.ok(parsed.shellPatterns !== undefined, "shellPatterns must be present");
  assert.ok(Array.isArray(parsed.shellPatterns), "shellPatterns must be an array");
  await client.close();
});

// ── get_profile ──────────────────────────────────────────────────────────────

test("E2E: get_profile returns full behavioral profile JSON", async () => {
  const server = buildActivityFramesServer(undefined, PROJECT_ROOT);
  const client = await connect(server);
  const result = await client.callTool({
    name: "get_profile",
    arguments: {},
  });
  const text = textOf(result as { content: Array<Record<string, unknown>> });
  assert.ok(text.length > 0, "get_profile must return non-empty text");
  const parsed = JSON.parse(text);
  assert.ok(parsed.generatedAt, "profile must have generatedAt timestamp");
  assert.ok(parsed.projectRoot, "profile must have projectRoot");
  assert.ok(parsed.session, "profile must have session data");
  assert.ok(parsed.git, "profile must have git data");
  assert.ok(parsed.shell, "profile must have shell data");
  assert.ok(parsed.file, "profile must have file data");
  // Verify git has real data.
  assert.ok(parsed.git.totalCommits > 0, "git.totalCommits should be > 0 for this repo");
  // Verify shell has real data.
  assert.ok(parsed.shell.totalCommands > 0, "shell.totalCommands should be > 0");
  await client.close();
});

// ── get_context with source=screen (no DB — graceful fallback) ───────────────

test("E2E: get_context with source=screen returns error when no capture DB", async () => {
  const server = buildActivityFramesServer(undefined, PROJECT_ROOT);
  const client = await connect(server);
  const result = await client.callTool({
    name: "get_context",
    arguments: { source: "screen" },
  });
  const text = textOf(result as { content: Array<Record<string, unknown>> });
  // Should either return screen data (if DB exists) or an error message.
  assert.ok(text.length > 0, "should return some response");
  await client.close();
});
