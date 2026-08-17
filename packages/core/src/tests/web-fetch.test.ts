/**
 * WebFetch tool tests (offline — fetch and the host fetcher are mocked).
 *
 * Locks in:
 *   - SSRF gate on EVERY engine path (loopback/private/reserved rejected
 *     before any fetcher or network call runs);
 *   - injected rendered fetcher is preferred and its result formatted;
 *   - static fallback: HTML → title/text/links extraction, block-aware tag
 *     stripping, content-type rejection, redirect-followed final URL,
 *     truncation marker;
 *   - output shape and activity start/exit pairing.
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ToolExecutionContext, ToolExecutionResult } from "../tools/executor";
import type { WebFetchPage } from "../common/tool-types";
import { handleWebFetchTool } from "../tools/web-fetch-handler";

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;
const fetchCalls: Array<{ url: string | URL; init?: RequestInit }> = [];

function mockFetch(respond: (url: string) => Response): void {
  fetchCalls.length = 0;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    fetchCalls.push({ url: input, init });
    return respond(String(input));
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createContext(options: { fetchWebPage?: ToolExecutionContext["fetchWebPage"] } = {}): ToolExecutionContext {
  return {
    sessionId: "web-fetch-test",
    projectRoot: makeRoot(),
    toolCall: { id: "c1", type: "function", function: { name: "WebFetch", arguments: "{}" } },
    fetchWebPage: options.fetchWebPage,
  };
}

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "web-fetch-test-"));
  tempDirs.push(dir);
  return dir;
}

const PAGE_HTML = `<!DOCTYPE html>
<html><head><title>Node &amp; Releases</title><style>body{color:red}</style></head>
<body>
  <h1>Node.js Releases</h1>
  <p>Current: <b>v24</b></p>
  <script>document.write('never visible')</script>
  <a href="https://nodejs.org/en/about">About Node</a>
  <a href="/relative">skipped</a>
</body></html>`;

// ── SSRF gate (every path) ──────────────────────────────────────────────────

test("rejects non-public targets before anything is fetched (rendered path too)", async () => {
  mockFetch(() => new Response("", { status: 200 }));
  let fetcherCalls = 0;
  const fetcher = async (): Promise<WebFetchPage> => {
    fetcherCalls += 1;
    throw new Error("fetcher must not run");
  };
  for (const bad of [
    "http://localhost/x",
    "http://127.0.0.1:8080/",
    "http://10.1.2.3/",
    "http://192.168.0.9/",
    "http://[fd00::1]/",
    "file:///etc/passwd",
    "ftp://example.com/",
  ]) {
    const result = await handleWebFetchTool({ url: bad }, createContext({ fetchWebPage: fetcher }));
    assert.equal(result.ok, false, `must reject ${bad}`);
  }
  assert.equal(fetchCalls.length, 0, "no network call may run for rejected URLs");
  assert.equal(fetcherCalls, 0, "host fetcher must not run for rejected URLs");
});

test("missing url is a structured error", async () => {
  const result = await handleWebFetchTool({}, createContext());
  assert.equal(result.ok, false);
  assert.match(String(result.error), /Missing required/);
});

test("SSRF hardening: trailing-dot hosts, IPv4-mapped IPv6, and :: are rejected; fd-domains are NOT", async () => {
  mockFetch(() => new Response("", { status: 200 }));
  for (const bad of [
    "http://localhost./x",
    "http://foo.localhost./x",
    "http://192.168.1.1./x",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[::]/",
  ]) {
    const result = await handleWebFetchTool({ url: bad }, createContext());
    assert.equal(result.ok, false, `must reject ${bad}`);
  }
  // fd-prefixed ORDINARY DOMAINS are fine (IPv6 checks only run on literals).
  const fdroid = await handleWebFetchTool({ url: "https://fdroid.org" }, createContext());
  assert.equal(fdroid.ok, true, "fdroid.org must not be treated as IPv6 ULA");
});

test("static engine refuses a redirect whose target is non-public", async () => {
  mockFetch((url) => {
    if (url === "https://public.example/start") {
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    }
    return new Response("<html><body>never</body></html>", { status: 200 });
  });
  const result = await handleWebFetchTool({ url: "https://public.example/start" }, createContext());
  assert.equal(result.ok, false);
  assert.match(String(result.error), /redirect to non-public target refused/);
});

test("static engine follows SAFE redirects and reports the final URL", async () => {
  mockFetch((url) => {
    if (url === "https://public.example/start") {
      return new Response(null, { status: 302, headers: { location: "https://other.example/real" } });
    }
    return new Response("<html><head><title>Real</title></head><body><p>content</p></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  });
  const result = await handleWebFetchTool({ url: "https://public.example/start" }, createContext());
  assert.equal(result.ok, true);
  assert.equal(result.metadata?.url, "https://other.example/real");
  assert.match(result.output ?? "", /# Real/);
});

// ── injected rendered fetcher (preferred engine) ────────────────────────────

test("uses the injected rendered fetcher and formats its page", async () => {
  const starts: Array<string | number> = [];
  const exits: Array<string | number> = [];
  const result = await handleWebFetchTool(
    { url: "https://example.com/post" },
    {
      ...createContext(),
      onProcessStart: (id) => starts.push(id),
      onProcessExit: (id) => exits.push(id),
      fetchWebPage: async (url) => ({
        url: "https://example.com/post/1", // redirect-followed
        title: "A Post",
        text: "Rendered body text",
        links: [{ title: "Next", url: "https://example.com/next" }],
        engine: "rendered",
        truncated: false,
      }),
    }
  );
  assert.equal(result.ok, true);
  assert.match(result.output ?? "", /^# A Post/);
  assert.match(result.output ?? "", /URL: https:\/\/example\.com\/post\/1/);
  assert.match(result.output ?? "", /Rendered body text/);
  assert.match(result.output ?? "", /\[Next\]\(https:\/\/example\.com\/next\)/);
  assert.doesNotMatch(result.output ?? "", /static/);
  assert.equal(result.metadata?.engine, "rendered");
  assert.equal(result.metadata?.url, "https://example.com/post/1");
  assert.deepEqual(exits, starts, "activity start/exit must pair");
});

test("rendered fetcher failure surfaces as a structured error", async () => {
  const result = await handleWebFetchTool(
    { url: "https://example.com/down" },
    createContext({
      fetchWebPage: async () => {
        throw new Error("page load failed (-3): timed out");
      },
    })
  );
  assert.equal(result.ok, false);
  assert.match(String(result.error), /page load failed/);
});

// ── static fallback (no injected fetcher) ───────────────────────────────────

test("static fallback: extracts title/text/links, strips script/style, decodes entities", async () => {
  mockFetch(
    () =>
      new Response(PAGE_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", url: "https://nodejs.org/en/final" },
      })
  );
  const result = await handleWebFetchTool({ url: "https://nodejs.org/en" }, createContext());
  assert.equal(result.ok, true);
  assert.equal(result.metadata?.engine, "static");
  assert.match(result.output ?? "", /# Node & Releases/);
  assert.match(result.output ?? "", /Current: v24/);
  assert.match(result.output ?? "", /\[About Node\]\(https:\/\/nodejs\.org\/en\/about\)/);
  assert.doesNotMatch(result.output ?? "", /never visible/);
  assert.doesNotMatch(result.output ?? "", /color:red/);
  assert.doesNotMatch(result.output ?? "", /relative/);
  // The static engine identifies itself in the output.
  assert.match(result.output ?? "", /fetched without JS rendering/);
});

test("static fallback: non-HTML content-type is rejected", async () => {
  mockFetch(() => new Response("binary", { status: 200, headers: { "content-type": "application/octet-stream" } }));
  const result = await handleWebFetchTool({ url: "https://example.com/blob" }, createContext());
  assert.equal(result.ok, false);
  assert.match(String(result.error), /content-type/);
});

test("static fallback: HTTP error status surfaces", async () => {
  mockFetch(() => new Response("nope", { status: 404 }));
  const result = await handleWebFetchTool({ url: "https://example.com/missing" }, createContext());
  assert.equal(result.ok, false);
  assert.match(String(result.error), /HTTP 404/);
});
