/**
 * First-party web-search provider tests (offline — fetch is mocked).
 *
 * Locks in:
 *   - normalizeWebSearchProvider fallback for unknown/empty values;
 *   - DuckDuckGo Lite HTML parsing (attribute-order-proof, entity decoding,
 *     uddg-redirect unwrap, non-http/ad filtering, hit cap);
 *   - Brave / Tavily request shapes (headers, key requirement) and response
 *     mapping — with the privacy contract asserted: no machine identifier,
 *     no Token/Authorization header, the body carries only the query;
 *   - formatWebSearchHits rendering.
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  formatWebSearchHits,
  normalizeWebSearchProvider,
  parseDuckDuckGoLite,
  searchWeb,
} from "../tools/web-search-providers";

const originalFetch = globalThis.fetch;
const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

function mockFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  fetchCalls.length = 0;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, init });
    return respond(url, init);
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── provider id normalization ────────────────────────────────────────────────

test("normalizeWebSearchProvider: known ids pass, everything else falls back to duckduckgo", () => {
  assert.equal(normalizeWebSearchProvider("brave"), "brave");
  assert.equal(normalizeWebSearchProvider("Tavily"), "tavily");
  assert.equal(normalizeWebSearchProvider("google"), "duckduckgo");
  assert.equal(normalizeWebSearchProvider(undefined), "duckduckgo");
  assert.equal(normalizeWebSearchProvider("  "), "duckduckgo");
});

// ── DuckDuckGo Lite parsing ──────────────────────────────────────────────────

test("parseDuckDuckGoLite: order-independent attributes, entity decoding, uddg unwrap", () => {
  const html = [
    `<a rel="nofollow" href="https://nodejs.org/en/blog" class="result-link">Node.js <b>Blog</b> &amp; Notes</a>`,
    `<td class="result-snippet">Release notes &amp; announcements</td>`,
    `<a class='result-link' rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fv8.dev%2Fdocs">V8 &lt;docs&gt;</a>`,
    `<td class="result-snippet">V8 documentation</td>`,
    `<a rel="nofollow" href="/help" class="result-link">Internal</a>`, // non-http → dropped
    `<td class="result-snippet">ignored</td>`,
  ].join("\n");
  const hits = parseDuckDuckGoLite(html);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], {
    title: "Node.js Blog & Notes",
    url: "https://nodejs.org/en/blog",
    snippet: "Release notes & announcements",
  });
  assert.deepEqual(hits[1], { title: "V8 <docs>", url: "https://v8.dev/docs", snippet: "V8 documentation" });
});

test("parseDuckDuckGoLite: caps at 8 hits", () => {
  const html = Array.from(
    { length: 12 },
    (_, i) =>
      `<a rel="nofollow" href="https://example.com/${i}" class="result-link">Result ${i}</a>` +
      `<td class="result-snippet">s${i}</td>`
  ).join("\n");
  assert.equal(parseDuckDuckGoLite(html).length, 8);
});

// ── live request shapes (fetch mocked) ──────────────────────────────────────

test("duckduckgo: POSTs only the query — no key, no machine identifier", async () => {
  mockFetch(
    () =>
      new Response(
        `<a rel="nofollow" href="https://nodejs.org/en/blog" class="result-link">Node.js Blog</a>` +
          `<td class="result-snippet">notes</td>`,
        { status: 200 }
      )
  );
  const result = await searchWeb("node releases");
  assert.equal(result.provider, "duckduckgo");
  assert.equal(result.hits.length, 1);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "https://lite.duckduckgo.com/lite/");
  assert.equal(fetchCalls[0].init?.method, "POST");
  assert.equal(fetchCalls[0].init?.body, new URLSearchParams({ q: "node releases" }).toString());
  const headers = fetchCalls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Token, undefined, "no machine-id token may be sent");
  assert.equal(headers.Authorization, undefined);
});

test("brave: sends X-Subscription-Token, maps web.results", async () => {
  mockFetch(() =>
    Response.json({
      web: { results: [{ title: "Brave result", url: "https://brave.example/x", description: "d" }] },
    })
  );
  const result = await searchWeb("q", { provider: "brave", apiKey: "bsa" + "-key" });
  assert.equal(result.provider, "brave");
  assert.deepEqual(result.hits[0], { title: "Brave result", url: "https://brave.example/x", snippet: "d" });
  assert.ok(fetchCalls[0].url.startsWith("https://api.search.brave.com/res/v1/web/search?"));
  assert.ok(fetchCalls[0].url.includes("q=q"));
  const headers = fetchCalls[0].init?.headers as Record<string, string>;
  assert.equal(headers["X-Subscription-Token"], "bsa" + "-key");
});

test("brave/tavily without a key: clear configuration error, no request sent", async () => {
  mockFetch(() => new Response("{}", { status: 200 }));
  await assert.rejects(searchWeb("q", { provider: "brave" }), /API-key configuration is currently disabled/);
  await assert.rejects(searchWeb("q", { provider: "tavily" }), /duckduckgo/);
  assert.equal(fetchCalls.length, 0);
});

test("tavily: Bearer auth, maps results array", async () => {
  mockFetch(() => Response.json({ results: [{ title: "T", url: "https://t.example/a", content: "c" }] }));
  const result = await searchWeb("q", { provider: "tavily", apiKey: "tvly" + "-key" });
  assert.equal(result.provider, "tavily");
  assert.deepEqual(result.hits[0], { title: "T", url: "https://t.example/a", snippet: "c" });
  assert.equal(fetchCalls[0].url, "https://api.tavily.com/search");
  const headers = fetchCalls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer " + "tvly" + "-key");
  assert.deepEqual(JSON.parse(String(fetchCalls[0].init?.body)), { query: "q", max_results: 8 });
});

test("non-200 provider response: surfaces the status", async () => {
  mockFetch(() => new Response("nope", { status: 503 }));
  await assert.rejects(searchWeb("q"), /HTTP 503/);
});

// ── rendering ────────────────────────────────────────────────────────────────

test("formatWebSearchHits: numbered markdown list, empty → explicit no-results", () => {
  assert.equal(formatWebSearchHits([]), "No results found.");
  const text = formatWebSearchHits([{ title: "A & B", url: "https://a.example", snippet: "sn" }]);
  assert.equal(text, "1. [A & B](https://a.example)\n   sn");
});
