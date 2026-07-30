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
  try {
    createRequire(import.meta.url)("node:sqlite");
    return true;
  } catch {
    return false;
  }
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
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "fetch_documentation",
      "fetch_url_content",
      "search_code",
      "search_documentation",
    ]);
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
    // A successful CallToolResult omits `isError` (undefined) per MCP — only
    // failures set it to `true`. Asserting the call did NOT error.
    assert.notEqual(result.isError, true);
    const text = result.content
      .filter((c) => c.type === "text")
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("");
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
