/**
 * Unit tests for the gitmcp tool surface (Workstream C: 8 tools).
 *
 * Everything runs offline: all GitHub access goes through an injectable fake
 * `FetchLike` that records requested URLs, and the store runs on a temp sqlite
 * database. Coverage follows specs/pre-production/tasks.md C1–C5:
 *   - get_repo_structure: dirs-first rendering, path/depth filters, 400-entry
 *     truncation with a `… (+N more)` note
 *   - read_file: raw host pinning, binary/size/URL/traversal guards
 *   - docs/ multi-file indexing + backward compat with old-shaped stores
 *   - outline: heading aggregation, section filter, lazy indexing
 *   - the 8-tool registration shape incl. the zod/v3 `_parse` contract
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { FetchLike } from "../main/tools/gitmcp/github.js";
import { GitmcpStore } from "../main/tools/gitmcp/store.js";
import { indexRepository } from "../main/tools/gitmcp/indexer.js";
import { buildGitmcpToolRegistrations, callTool } from "../main/tools/gitmcp/tools.js";

// ── fake network ────────────────────────────────────────────────────────────

type FakeFetch = FetchLike & { calls: string[] };

function fakeFetch(handler: (url: URL) => Response | Promise<Response>): FakeFetch {
  const calls: string[] = [];
  const impl = async (url: string, _init?: RequestInit): Promise<Response> => {
    calls.push(url);
    return handler(new URL(url));
  };
  return Object.assign(impl, { calls });
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
}

function textResponse(body: string, contentType = "text/plain; charset=utf-8"): Response {
  return new Response(body, { headers: { "content-type": contentType } });
}

function bytesResponse(bytes: Uint8Array<ArrayBuffer>, contentType?: string): Response {
  return new Response(bytes, contentType ? { headers: { "content-type": contentType } } : {});
}

function notFound(): Response {
  return new Response("404: Not Found", { status: 404 });
}

function deadFetch(): FakeFetch {
  return fakeFetch(() => notFound());
}

// ── temp store ──────────────────────────────────────────────────────────────

function tempStore(): { store: GitmcpStore; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitmcp-test-"));
  const store = new GitmcpStore(path.join(dir, "index.db"));
  return {
    store,
    cleanup: () => {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ── fixture repository ──────────────────────────────────────────────────────

const SLUG = "example/docs-repo";

const TREE = {
  sha: "f" + "0".repeat(40),
  truncated: false,
  tree: [
    { path: "docs", type: "tree" },
    { path: "docs/guide.md", type: "blob", size: 30 },
    { path: "docs/api.md", type: "blob", size: 40 },
    { path: "docs/sub/deep.md", type: "blob", size: 25 },
    { path: "src", type: "tree" },
    { path: "src/index.ts", type: "blob", size: 120 },
    { path: "llms.txt", type: "blob", size: 90 },
    { path: "README.md", type: "blob", size: 60 },
  ],
};

const LLMS =
  "# Example\n\n## Docs\n\n- [Guide](docs/guide.md): usage guide\n- [Ext](https://example.com/x.md): remote\n";
const GUIDE = "# Guide\n\nInstall the widget first.\n";
const API_DOC = "# API\n\nThe endpoint list lives here.\n";
const DEEP = "# Deep\n\nNested documentation page.\n";

/** Fixture fetch for SLUG: trees API on HEAD + raw files on HEAD. */
function repoFetch(): FakeFetch {
  return fakeFetch((url) => {
    if (url.hostname === "api.github.com") {
      return url.pathname === `/repos/${SLUG}/git/trees/HEAD` ? jsonResponse(TREE) : notFound();
    }
    if (url.hostname === "raw.githubusercontent.com") {
      const parts = url.pathname.split("/"); // ["", owner, repo, ref, ...path]
      const file = decodeURIComponent(parts.slice(4).join("/"));
      switch (file) {
        case "llms.txt":
          return textResponse(LLMS);
        case "llms-full.txt":
          return notFound();
        case "README.md":
          return textResponse("# Readme\n\nRoot readme body.\n");
        case "docs/guide.md":
          return textResponse(GUIDE);
        case "docs/api.md":
          return textResponse(API_DOC);
        case "docs/sub/deep.md":
          return textResponse(DEEP);
        default:
          return notFound();
      }
    }
    return notFound();
  });
}

// ── registrations shape (C5) ────────────────────────────────────────────────

test("buildGitmcpToolRegistrations exposes the 8 tools with zod/v3 input shapes", () => {
  const regs = buildGitmcpToolRegistrations(SLUG);
  assert.deepEqual(
    regs.map((r) => r.name),
    [
      "fetch_documentation",
      "search_documentation",
      "search_code",
      "fetch_url_content",
      "get_repo_structure",
      "read_file",
      "get_repo_info",
      "outline",
    ]
  );
  for (const reg of regs) {
    assert.ok(reg.description.length > 0 && reg.description.includes(SLUG), `${reg.name} has a description`);
    for (const [key, shape] of Object.entries(reg.inputShape)) {
      // The SDK (1.22) validates via the zod v3 internal `_parse` — the exact
      // contract from the tools.ts header comment.
      assert.equal(typeof (shape as { _parse?: unknown })._parse, "function", `${reg.name}.${key} is zod/v3`);
    }
  }
});

test("callTool returns an error result for unknown tools", async () => {
  const { store, cleanup } = tempStore();
  try {
    const out = await callTool(store, SLUG, "nope", {}, deadFetch());
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /Unknown tool: nope/);
  } finally {
    cleanup();
  }
});

// ── get_repo_structure (C1) ─────────────────────────────────────────────────

test("get_repo_structure renders dirs first with per-directory counts", async () => {
  const { store, cleanup } = tempStore();
  try {
    const out = await callTool(store, SLUG, "get_repo_structure", {}, repoFetch());
    const body = out.content[0].text;
    assert.ok(!out.isError, body);
    assert.ok(body.startsWith(`${SLUG} @ HEAD (9 entries)`), body);
    assert.ok(body.includes("docs/ (3)"), body);
    assert.ok(body.includes("src/ (1)"), body);
    assert.ok(body.includes("  sub/ (1)"), body);
    assert.ok(body.includes("    deep.md"), body);
    assert.ok(body.includes("README.md"), body);
    // Directories sort before files at the root level.
    assert.ok(body.indexOf("docs/") < body.indexOf("README.md"), body);
  } finally {
    cleanup();
  }
});

test("get_repo_structure filters by path and depth", async () => {
  const { store, cleanup } = tempStore();
  try {
    const out = await callTool(store, SLUG, "get_repo_structure", { path: "docs", depth: 1 }, repoFetch());
    const body = out.content[0].text;
    assert.ok(body.startsWith(`${SLUG}/docs @ HEAD (3 entries)`), body);
    assert.ok(body.includes("api.md") && body.includes("guide.md") && body.includes("sub/ (1)"), body);
    assert.ok(!body.includes("deep.md"), "depth 1 hides nested files");
  } finally {
    cleanup();
  }
});

test("get_repo_structure truncates past 400 entries with a +N more note", async () => {
  const tree = {
    truncated: false,
    tree: Array.from({ length: 401 }, (_, i) => ({
      path: `f${String(i + 1).padStart(3, "0")}.txt`,
      type: "blob",
    })),
  };
  const fetchImpl = fakeFetch((url) =>
    url.hostname === "api.github.com" && url.pathname.endsWith("/git/trees/HEAD") ? jsonResponse(tree) : notFound()
  );
  const { store, cleanup } = tempStore();
  try {
    const out = await callTool(store, "example/big", "get_repo_structure", {}, fetchImpl);
    const body = out.content[0].text;
    assert.ok(body.includes("(401 entries)"), body);
    assert.ok(body.trimEnd().endsWith("… (+1 more)"), body);
    assert.ok(body.includes("f400.txt"), body);
    assert.ok(!body.includes("f401.txt"), body);
  } finally {
    cleanup();
  }
});

test("get_repo_structure rejects URL-ish paths and unknown paths without fetching", async () => {
  const { store, cleanup } = tempStore();
  try {
    const fetchImpl = deadFetch();
    const evil = await callTool(store, SLUG, "get_repo_structure", { path: "https://evil.example.com" }, fetchImpl);
    assert.equal(evil.isError, true);
    const missing = await callTool(store, SLUG, "get_repo_structure", { path: "nope" }, repoFetch());
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /not found/);
  } finally {
    cleanup();
  }
});

// ── read_file (C2) ──────────────────────────────────────────────────────────

test("read_file reads raw content with a [path @ ref] header", async () => {
  const { store, cleanup } = tempStore();
  try {
    const fetchImpl = repoFetch();
    const out = await callTool(store, SLUG, "read_file", { path: "docs/guide.md" }, fetchImpl);
    assert.ok(!out.isError, out.content[0].text);
    assert.match(out.content[0].text, /^\[docs\/guide\.md @ HEAD\]\n\n# Guide/);
    assert.ok(
      fetchImpl.calls.every((url) => url.startsWith("https://raw.githubusercontent.com/")),
      fetchImpl.calls.join("\n")
    );
  } finally {
    cleanup();
  }
});

test("read_file uses an explicit ref verbatim without branch fallback", async () => {
  const { store, cleanup } = tempStore();
  try {
    const fetchImpl = fakeFetch((url) =>
      url.hostname === "raw.githubusercontent.com" && url.pathname.endsWith("/v1.0/docs/guide.md")
        ? textResponse(GUIDE)
        : notFound()
    );
    const out = await callTool(store, SLUG, "read_file", { path: "docs/guide.md", ref: "v1.0" }, fetchImpl);
    assert.ok(!out.isError, out.content[0].text);
    assert.match(out.content[0].text, /^\[docs\/guide\.md @ v1\.0\]/);
    assert.deepEqual(fetchImpl.calls, [`https://raw.githubusercontent.com/${SLUG}/v1.0/docs/guide.md`]);
  } finally {
    cleanup();
  }
});

test("read_file rejects binary files (NUL bytes / binary content-type)", async () => {
  const { store, cleanup } = tempStore();
  try {
    const nul = fakeFetch(() => bytesResponse(new Uint8Array([0x68, 0x00, 0x69])));
    const out = await callTool(store, SLUG, "read_file", { path: "logo.png" }, nul);
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /binary or non-UTF-8 file/);

    const octet = fakeFetch(() => bytesResponse(new Uint8Array([1, 2, 3]), "application/octet-stream"));
    const out2 = await callTool(store, SLUG, "read_file", { path: "data.bin" }, octet);
    assert.equal(out2.isError, true);
    assert.match(out2.content[0].text, /binary or non-UTF-8 file/);
  } finally {
    cleanup();
  }
});

test("read_file rejects invalid UTF-8 even with a text content-type", async () => {
  const { store, cleanup } = tempStore();
  try {
    // 0xc3 0x28 is an invalid UTF-8 sequence (lone continuation byte follows).
    const invalid = fakeFetch(() => bytesResponse(new Uint8Array([0x61, 0xc3, 0x28, 0x62])));
    const out = await callTool(store, SLUG, "read_file", { path: "weird.md" }, invalid);
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /binary or non-UTF-8 file/);
  } finally {
    cleanup();
  }
});

test("read_file rejects files above the 256KB cap", async () => {
  const { store, cleanup } = tempStore();
  try {
    const big = fakeFetch(() => textResponse("x".repeat(256 * 1024 + 1)));
    const out = await callTool(store, SLUG, "read_file", { path: "huge.txt" }, big);
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /exceeds the 256KB limit/);
  } finally {
    cleanup();
  }
});

test("read_file never accepts full URLs or traversal paths", async () => {
  const { store, cleanup } = tempStore();
  try {
    const fetchImpl = deadFetch();
    const evil = await callTool(store, SLUG, "read_file", { path: "https://evil.example.com/a.md" }, fetchImpl);
    assert.equal(evil.isError, true);
    assert.match(evil.content[0].text, /repository-relative path, not a URL/);
    const traversal = await callTool(store, SLUG, "read_file", { path: "../../etc/passwd" }, fetchImpl);
    assert.equal(traversal.isError, true);
    const missing = await callTool(store, SLUG, "read_file", { path: "" }, fetchImpl);
    assert.equal(missing.isError, true);
    assert.equal(fetchImpl.calls.length, 0, "guards must reject before any network access");
  } finally {
    cleanup();
  }
});

// ── docs/ multi-file indexing (C3) + backward compat ───────────────────────

test("indexRepository indexes docs/ files with path-prefixed chunk headings", async () => {
  const { store, cleanup } = tempStore();
  try {
    const result = await indexRepository(SLUG, store, repoFetch());
    assert.equal(result.docSource, "llms.txt");
    assert.deepEqual(result.files, ["llms.txt", "docs/api.md", "docs/guide.md", "docs/sub/deep.md"]);
    const chunks = store.getRepoChunks(SLUG);
    assert.equal(chunks.length, result.chunkCount);
    assert.ok(chunks.some((c) => c.heading === "docs/api.md > API"));
    assert.ok(chunks.some((c) => c.heading === "docs/guide.md > Guide"));
    assert.ok(chunks.some((c) => c.heading === "llms.txt > Example > Docs"));
    const meta = store.getRepoMeta(SLUG);
    assert.equal(meta?.docSource, "llms.txt + 3 docs file(s)");
    assert.equal(meta?.chunkCount, chunks.length);
  } finally {
    cleanup();
  }
});

test("fetch_documentation lists the indexed files and search spans docs/ files", async () => {
  const { store, cleanup } = tempStore();
  try {
    await indexRepository(SLUG, store, repoFetch());
    const doc = await callTool(store, SLUG, "fetch_documentation", {}, repoFetch());
    assert.ok(!doc.isError, doc.content[0].text);
    assert.match(
      doc.content[0].text,
      /\[source: llms\.txt, \d+ chunks indexed, files: llms\.txt, docs\/api\.md, docs\/guide\.md, docs\/sub\/deep\.md\]/
    );
    // Search is store-backed: no network needed once indexed.
    const searchFetch = deadFetch();
    const search = await callTool(store, SLUG, "search_documentation", { query: "endpoint list" }, searchFetch);
    assert.ok(!search.isError, search.content[0].text);
    assert.match(search.content[0].text, /docs\/api\.md > API/);
    assert.match(search.content[0].text, /endpoint list lives here/);
    assert.equal(searchFetch.calls.length, 0);
  } finally {
    cleanup();
  }
});

test("indexRepository without docs/ keeps the legacy single-source shape", async () => {
  const readmeOnly = fakeFetch((url) => {
    if (url.hostname === "raw.githubusercontent.com" && url.pathname.endsWith("/README.md")) {
      return textResponse("# Readme\n\nBody text.\n");
    }
    return notFound();
  });
  const { store, cleanup } = tempStore();
  try {
    const result = await indexRepository("example/readme-only", store, readmeOnly);
    assert.equal(result.docSource, "readme");
    assert.equal(result.files, undefined);
    const chunks = store.getRepoChunks("example/readme-only");
    assert.ok(
      chunks.some((c) => c.heading === "Readme"),
      JSON.stringify(chunks)
    );
    assert.equal(store.getRepoMeta("example/readme-only")?.docSource, "readme");
  } finally {
    cleanup();
  }
});

test("old-shaped stores keep working: cached fallback and offline search", async () => {
  const { store, cleanup } = tempStore();
  try {
    store.upsertRepoDocument("example/old", "readme", [
      { heading: "Install", content: "Run npm install example now." },
      { heading: "Install > Windows", content: "Use winget setup." },
    ]);
    // Network is dead: fetch_documentation must fall back to the cached copy.
    const doc = await callTool(store, "example/old", "fetch_documentation", {}, deadFetch());
    assert.ok(!doc.isError, doc.content[0].text);
    assert.match(doc.content[0].text, /\[cached copy of readme/);
    assert.match(doc.content[0].text, /## Install/);
    // Search over the old store makes no network calls.
    const searchFetch = deadFetch();
    const search = await callTool(store, "example/old", "search_documentation", { query: "winget" }, searchFetch);
    assert.ok(!search.isError, search.content[0].text);
    assert.match(search.content[0].text, /Install > Windows/);
    assert.equal(searchFetch.calls.length, 0);
  } finally {
    cleanup();
  }
});

// ── outline (C4) ────────────────────────────────────────────────────────────

test("outline aggregates chunk headings into a hierarchy, folding past h3", async () => {
  const { store, cleanup } = tempStore();
  try {
    store.upsertRepoDocument(SLUG, "readme", [
      { heading: "Install", content: "a" },
      { heading: "Install > macOS", content: "b" },
      { heading: "Install > Linux", content: "c" },
      { heading: "API", content: "d" },
      { heading: "Deep > A > B > C > D", content: "e" },
    ]);
    const offline = deadFetch();
    const out = await callTool(store, SLUG, "outline", {}, offline);
    const body = out.content[0].text;
    assert.ok(!out.isError, body);
    assert.match(body, /Outline of example\/docs-repo \(source: readme, 5 chunks\):/);
    assert.match(body, /- Install\n {2}- macOS\n {2}- Linux\n- API\n- Deep\n {2}- A\n {4}- B > C > D/);
    assert.equal(offline.calls.length, 0, "indexed store — no network");
  } finally {
    cleanup();
  }
});

test("outline filters by section (case-insensitive)", async () => {
  const { store, cleanup } = tempStore();
  try {
    store.upsertRepoDocument(SLUG, "readme", [
      { heading: "Install", content: "a" },
      { heading: "Install > macOS", content: "b" },
      { heading: "Install > Linux", content: "c" },
    ]);
    const out = await callTool(store, SLUG, "outline", { section: "LINUX" }, deadFetch());
    const body = out.content[0].text;
    assert.ok(!out.isError, body);
    assert.match(body, /- Install\n {2}- Linux/);
    assert.ok(!body.includes("macOS"), body);

    const none = await callTool(store, SLUG, "outline", { section: "nope" }, deadFetch());
    assert.match(none.content[0].text, /No outline headings .* match "nope"/);
  } finally {
    cleanup();
  }
});

test("outline lazily indexes an empty store before aggregating", async () => {
  const readmeOnly = fakeFetch((url) => {
    if (url.hostname === "raw.githubusercontent.com" && url.pathname.endsWith("/README.md")) {
      return textResponse("# Readme\n\n## Usage\n\nDo things.\n");
    }
    return notFound();
  });
  const { store, cleanup } = tempStore();
  try {
    const out = await callTool(store, "example/readme-only", "outline", {}, readmeOnly);
    const body = out.content[0].text;
    assert.ok(!out.isError, body);
    assert.match(body, /- Readme\n {2}- Usage/);
  } finally {
    cleanup();
  }
});

test("outline reports an error when indexing is unavailable and nothing is cached", async () => {
  const { store, cleanup } = tempStore();
  try {
    const out = await callTool(store, "example/ghost", "outline", {}, deadFetch());
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /Unable to fetch documentation/);
  } finally {
    cleanup();
  }
});

// ── get_repo_info (C3 companion) ────────────────────────────────────────────

test("get_repo_info lazily indexes and lists the indexed files", async () => {
  const { store, cleanup } = tempStore();
  try {
    const out = await callTool(store, SLUG, "get_repo_info", {}, repoFetch());
    const body = out.content[0].text;
    assert.ok(!out.isError, body);
    assert.match(body, /^example\/docs-repo:$/m);
    assert.match(body, / {2}indexed: yes/);
    assert.match(body, / {2}source: llms\.txt \+ 3 docs file\(s\)/);
    assert.match(body, / {2}files \(4\):/);
    assert.match(body, / {4}- docs\/api\.md/);
    assert.match(body, / {4}- llms\.txt/);
  } finally {
    cleanup();
  }
});

test("get_repo_info degrades for old stores and unreachable repositories", async () => {
  const { store, cleanup } = tempStore();
  try {
    store.upsertRepoDocument("example/old", "readme", [{ heading: "Install", content: "a" }]);
    const old = await callTool(store, "example/old", "get_repo_info", {}, deadFetch());
    assert.match(old.content[0].text, /single-source index/);

    const ghost = await callTool(store, "example/ghost", "get_repo_info", {}, deadFetch());
    assert.match(ghost.content[0].text, /not indexed/);
  } finally {
    cleanup();
  }
});

// ── legacy tools still routed (8/8 via callTool) ────────────────────────────

test("search_code and fetch_url_content keep working through callTool", async () => {
  const { store, cleanup } = tempStore();
  try {
    const codeFetch = fakeFetch((url) => {
      if (url.hostname === "api.github.com" && url.pathname.startsWith("/search/code")) {
        return jsonResponse({
          total_count: 1,
          items: [{ name: "a.ts", path: "src/a.ts", html_url: `https://github.com/${SLUG}/blob/HEAD/src/a.ts` }],
        });
      }
      return notFound();
    });
    const code = await callTool(store, SLUG, "search_code", { query: "widget" }, codeFetch);
    assert.ok(!code.isError, code.content[0].text);
    assert.match(code.content[0].text, /src\/a\.ts/);
    assert.match(code.content[0].text, /1 result\(s\)/);

    const urlFetch = fakeFetch((url) =>
      url.hostname === "example.com" ? textResponse("<p>Hello docs</p>", "text/html") : notFound()
    );
    const page = await callTool(store, SLUG, "fetch_url_content", { url: "https://example.com/about" }, urlFetch);
    assert.ok(!page.isError, page.content[0].text);
    assert.match(page.content[0].text, /Hello docs/);
  } finally {
    cleanup();
  }
});
