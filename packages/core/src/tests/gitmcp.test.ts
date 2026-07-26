import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createRequire } from "node:module";
import {
  GITMCP_SERVER_PREFIX,
  gitmcpServerNameForSlug,
  gitmcpSlugFromServerName,
  isGitmcpPlaceholderConfig,
  isGitmcpServerName,
  buildGitmcpPlaceholderConfig,
  parseRepoSlug,
} from "../gitmcp/resolve";
import { GitmcpStore, readGitmcpRepoMeta, removeGitmcpRepoIndex, toFtsQuery } from "../gitmcp/store";
import { chunkMarkdown, indexRepository } from "../gitmcp/indexer";
import { extractTextFromHtml } from "../gitmcp/github";
import type { FetchLike } from "../gitmcp/github";
import { dispatchRpcMessage, METHOD_NOT_FOUND, PARSE_ERROR } from "../gitmcp/rpc";
import { buildServerHandlers, runMaintenance } from "../gitmcp/server";

const tempDirs: string[] = [];

// Store tests need node:sqlite (Node ≥22, per .nvmrc). Skip them — instead of
// failing — when the test runtime lacks it, mirroring how the feature itself
// degrades on sqlite-less hosts.
const hasSqlite = (() => {
  try {
    createRequire(import.meta.url)("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();
const sqliteOnly = { skip: hasSqlite ? false : "node:sqlite unavailable in this runtime" };

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitmcp-test-"));
  tempDirs.push(dir);
  return path.join(dir, "index.db");
}

/** Stub fetch that serves a fixed llms.txt for any raw.githubusercontent URL. */
function stubDocFetch(markdown: string): FetchLike {
  return async (url: string) => {
    if (url.includes("raw.githubusercontent.com") && url.endsWith("/llms.txt")) {
      return new Response(markdown, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

// --- resolve: slug parsing and server naming -------------------------------

test("parseRepoSlug normalizes all accepted input forms", () => {
  assert.equal(parseRepoSlug("idosal/git-mcp"), "idosal/git-mcp");
  assert.equal(parseRepoSlug("  idosal/git-mcp  "), "idosal/git-mcp");
  assert.equal(parseRepoSlug("https://github.com/idosal/git-mcp"), "idosal/git-mcp");
  assert.equal(parseRepoSlug("https://github.com/idosal/git-mcp.git"), "idosal/git-mcp");
  assert.equal(parseRepoSlug("https://github.com/idosal/git-mcp/tree/main/src"), "idosal/git-mcp");
  assert.equal(parseRepoSlug("github.com/idosal/git-mcp"), "idosal/git-mcp");
  assert.equal(parseRepoSlug("git@github.com:idosal/git-mcp.git"), "idosal/git-mcp");
});

test("parseRepoSlug rejects inputs that are not a GitHub repository", () => {
  assert.equal(parseRepoSlug(""), null);
  assert.equal(parseRepoSlug("just-a-name"), null);
  assert.equal(parseRepoSlug("a/b/c"), null);
  assert.equal(parseRepoSlug("https://gitlab.com/group/project"), null);
  assert.equal(parseRepoSlug("owner/repo name"), null);
  assert.equal(parseRepoSlug("https://github.com/onlyowner"), null);
});

test("gitmcp server names round-trip through prefix helpers", () => {
  const name = gitmcpServerNameForSlug("owner/repo");
  assert.equal(name, `${GITMCP_SERVER_PREFIX}owner/repo`);
  assert.equal(isGitmcpServerName(name), true);
  assert.equal(isGitmcpServerName("codegraph"), false);
  assert.equal(gitmcpSlugFromServerName(name), "owner/repo");
});

test("placeholder config is recognized and carries the slug", () => {
  const config = buildGitmcpPlaceholderConfig("owner/repo");
  assert.equal(isGitmcpPlaceholderConfig(config), true);
  assert.deepEqual(config.args, ["owner/repo"]);
  assert.equal(isGitmcpPlaceholderConfig({ command: "/usr/bin/node", args: [] }), false);
});

// --- indexer: markdown chunking ---------------------------------------------

test("chunkMarkdown tracks heading paths and respects the size window", () => {
  const markdown = [
    "intro before any heading",
    "# Install",
    "install text",
    "## macOS",
    "brew install deepcode",
    "## Linux",
    "apt install deepcode",
    "# Usage",
    "x".repeat(4000),
  ].join("\n\n");
  const chunks = chunkMarkdown(markdown);

  assert.equal(chunks[0].heading, "");
  assert.equal(chunks[0].content, "intro before any heading");
  assert.ok(chunks.some((c) => c.heading === "Install > macOS" && c.content.includes("brew install")));
  assert.ok(chunks.some((c) => c.heading === "Install > Linux"));
  // The 4000-char paragraph must be split into multiple chunks ≤1500 chars.
  const usage = chunks.filter((c) => c.heading === "Usage");
  assert.ok(usage.length >= 3);
  for (const chunk of chunks) {
    assert.ok(chunk.content.length <= 1500, `chunk exceeds cap: ${chunk.content.length}`);
  }
});

test("chunkMarkdown ignores headings inside code fences", () => {
  const markdown = ["# Real", "```", "# not a heading", "```", "after fence"].join("\n");
  const chunks = chunkMarkdown(markdown);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].heading, "Real");
  assert.ok(chunks[0].content.includes("# not a heading"));
});

// --- store: FTS5 index, search, removal -------------------------------------

test("store indexes, searches with bm25, and removes repositories", sqliteOnly, () => {
  const store = new GitmcpStore(tempDbPath());
  try {
    store.upsertRepoDocument("owner/repo", "llms.txt", [
      { heading: "Install", content: "run brew install deepcode on macOS" },
      { heading: "Usage", content: "start the cli with deepcode command" },
    ]);

    const meta = store.getRepoMeta("owner/repo");
    assert.ok(meta);
    assert.equal(meta.docSource, "llms.txt");
    assert.equal(meta.chunkCount, 2);

    const hits = store.search("owner/repo", "brew install");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].heading, "Install");

    // Reindex replaces chunks; stale content must disappear from FTS.
    store.upsertRepoDocument("owner/repo", "readme", [{ heading: "New", content: "completely different words" }]);
    assert.equal(store.search("owner/repo", "brew").length, 0);
    assert.equal(store.search("owner/repo", "different words").length, 1);

    store.removeRepo("owner/repo");
    assert.equal(store.getRepoMeta("owner/repo"), null);
    assert.deepEqual(store.getRepoChunks("owner/repo"), []);
  } finally {
    store.close();
  }
});

test("store scopes search per repository slug", sqliteOnly, () => {
  const store = new GitmcpStore(tempDbPath());
  try {
    store.upsertRepoDocument("a/one", "readme", [{ heading: "", content: "alpha specific words" }]);
    store.upsertRepoDocument("b/two", "readme", [{ heading: "", content: "beta specific words" }]);
    assert.equal(store.search("a/one", "alpha").length, 1);
    assert.equal(store.search("a/one", "beta").length, 0);
    assert.equal(store.listRepoMeta().length, 2);
  } finally {
    store.close();
  }
});

test("toFtsQuery quotes tokens so raw input cannot break the MATCH syntax", () => {
  assert.equal(toFtsQuery('drop "table" OR *'), '"drop" "table" "OR"');
  assert.equal(toFtsQuery("!!!"), "");
});

test("readGitmcpRepoMeta and removeGitmcpRepoIndex tolerate a missing db", () => {
  const missing = path.join(os.tmpdir(), "gitmcp-does-not-exist", "index.db");
  assert.deepEqual(readGitmcpRepoMeta(missing), []);
  removeGitmcpRepoIndex("owner/repo", missing); // must not throw
});

// --- rpc + server: in-process protocol round-trip ----------------------------

test("server speaks the MCP handshake and lists the four tools", async () => {
  const store = new GitmcpStore(tempDbPath());
  try {
    const handlers = buildServerHandlers("owner/repo", store);

    const init = await dispatchRpcMessage(handlers, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "deepcode-cli" } },
    });
    assert.ok(init);
    const initResult = init.result as { protocolVersion: string; serverInfo: { name: string } };
    assert.equal(initResult.protocolVersion, "2025-03-26");
    assert.equal(initResult.serverInfo.name, "deepcode-gitmcp");

    // Notification (no id) → no response written back.
    assert.equal(await dispatchRpcMessage(handlers, { jsonrpc: "2.0", method: "notifications/initialized" }), null);

    const list = await dispatchRpcMessage(handlers, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = (list?.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    assert.deepEqual(tools, ["fetch_documentation", "search_documentation", "search_code", "fetch_url_content"]);

    // prompts/list is probed by the client and must yield method-not-found.
    const prompts = await dispatchRpcMessage(handlers, { jsonrpc: "2.0", id: 3, method: "prompts/list" });
    assert.equal(prompts?.error?.code, METHOD_NOT_FOUND);
  } finally {
    store.close();
  }
});

test("dispatchRpcMessage rejects malformed messages", async () => {
  const response = await dispatchRpcMessage({}, "not an object");
  assert.ok(response?.error);
  assert.notEqual(response.error.code, PARSE_ERROR); // parse errors happen a layer above
});

test("search_documentation auto-indexes then searches via the store", sqliteOnly, async () => {
  const store = new GitmcpStore(tempDbPath());
  try {
    const markdown = "# Setup\n\nInstall with `brew install deepcode` on macOS.\n\n# Other\n\nUnrelated section.";
    await indexRepository("owner/repo", store, stubDocFetch(markdown));
    const handlers = buildServerHandlers("owner/repo", store);

    const response = await dispatchRpcMessage(handlers, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "search_documentation", arguments: { query: "brew install" } },
    });
    const result = response?.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes("Setup"));
    assert.ok(result.content[0].text.includes("brew install"));
  } finally {
    store.close();
  }
});

test("unknown tool returns an isError result, not a protocol error", async () => {
  const store = new GitmcpStore(tempDbPath());
  try {
    const handlers = buildServerHandlers("owner/repo", store);
    const response = await dispatchRpcMessage(handlers, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "nope", arguments: {} },
    });
    const result = response?.result as { isError?: boolean };
    assert.equal(result.isError, true);
    assert.equal(response?.error, undefined);
  } finally {
    store.close();
  }
});

// --- github: html extraction --------------------------------------------------

test("extractTextFromHtml strips markup and keeps readable text", () => {
  const html =
    "<html><head><title>t</title><style>.x{}</style></head>" +
    "<body><script>var x=1;</script><h1>Title</h1><p>Hello &amp; welcome</p></body></html>";
  const text = extractTextFromHtml(html);
  assert.ok(text.includes("Title"));
  assert.ok(text.includes("Hello & welcome"));
  assert.ok(!text.includes("var x"));
  assert.ok(!text.includes("<p>"));
});

// --- server: maintenance subcommands (sqlite-less host support) ---------------

test("runMaintenance rejects an invalid slug with code 1", async () => {
  const { code, payload } = await runMaintenance(["--remove-index", "not a slug"]);
  assert.equal(code, 1);
  const result = payload as { ok: boolean; error: string };
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("invalid slug"));
});

test("runMaintenance rejects an unknown flag with code 1", async () => {
  const { code, payload } = await runMaintenance(["--frobnicate", "owner/repo"]);
  assert.equal(code, 1);
  const result = payload as { ok: boolean; error: string };
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("unknown flag"));
});

test("runMaintenance --meta returns the repo metadata array", sqliteOnly, async () => {
  const { code, payload } = await runMaintenance(["--meta"]);
  assert.equal(code, 0);
  assert.ok(Array.isArray(payload));
});
