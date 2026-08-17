/**
 * First-party web search providers — our own built-in implementation.
 *
 * Replaces the historical default that proxied queries (plus a machine
 * identifier) through the upstream project's endpoint. Privacy contract:
 * the query goes to the configured search engine with a standard browser
 * User-Agent that names the product (DeepOrca) — but NO machine identifier,
 * no analytics, no third-party proxy. (The product-name UA token is honest
 * self-identification so engines can tell agent traffic apart; it is uniform
 * across all installs and carries nothing per-user.) Keyless
 * DuckDuckGo Lite is the out-of-box default; Brave / Tavily are opt-in
 * with the user's own API key.
 *
 * Zero new dependencies: fetch + regex parsing only, best-effort graceful
 * degradation (a provider layout change surfaces as a parse error, never a
 * crash).
 */

export type WebSearchProviderId = "duckduckgo" | "brave" | "tavily";

export const DEFAULT_WEB_SEARCH_PROVIDER: WebSearchProviderId = "duckduckgo";
export const WEB_SEARCH_PROVIDERS: readonly WebSearchProviderId[] = ["duckduckgo", "brave", "tavily"];

export interface WebSearchHit {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface WebSearchOptions {
  /** Defaults to duckduckgo (keyless, works out of the box). */
  readonly provider?: WebSearchProviderId;
  /** Required for brave / tavily; ignored by duckduckgo. */
  readonly apiKey?: string;
  /** Request timeout. Default 10s. */
  readonly timeoutMs?: number;
}

export interface WebSearchResult {
  readonly provider: WebSearchProviderId;
  readonly hits: readonly WebSearchHit[];
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_HITS = 8;
/** Honest UA: a browser-compatible string plus the product name. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 DeepOrca";

/** Parse a normalized provider id; unknown values fall back to the default. */
export function normalizeWebSearchProvider(raw: string | undefined): WebSearchProviderId {
  const lowered = raw?.trim().toLowerCase();
  return WEB_SEARCH_PROVIDERS.includes(lowered as WebSearchProviderId)
    ? (lowered as WebSearchProviderId)
    : DEFAULT_WEB_SEARCH_PROVIDER;
}

/** Run a web search through the configured provider. Throws on provider errors. */
export async function searchWeb(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult> {
  const provider = options.provider ?? DEFAULT_WEB_SEARCH_PROVIDER;
  switch (provider) {
    case "duckduckgo":
      return { provider, hits: await searchDuckDuckGoLite(query, options.timeoutMs) };
    case "brave":
      return { provider, hits: await searchBrave(query, options.apiKey, options.timeoutMs) };
    case "tavily":
      return { provider, hits: await searchTavily(query, options.apiKey, options.timeoutMs) };
  }
}

/**
 * Timeout spans the WHOLE operation — headers AND the body read. Clearing the
 * timer when fetch() resolves (the earlier shape) left text()/json() unbounded:
 * a headers-then-stall server would hang the tool forever (adversarial review
 * round 2). Aborting mid-body rejects the pending read as well.
 */
async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number | undefined = DEFAULT_TIMEOUT_MS
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number | undefined = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── DuckDuckGo Lite (keyless default) ───────────────────────────────────────

const DDG_LITE_URL = "https://lite.duckduckgo.com/lite/";

async function searchDuckDuckGoLite(
  query: string,
  timeoutMs: number | undefined = DEFAULT_TIMEOUT_MS
): Promise<WebSearchHit[]> {
  const html = await fetchTextWithTimeout(
    DDG_LITE_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        "Accept-Language": "en,zh;q=0.8",
      },
      body: new URLSearchParams({ q: query }).toString(),
    },
    timeoutMs
  );
  return parseDuckDuckGoLite(html);
}

/**
 * Parse the DuckDuckGo Lite results table. The page is deliberately minimal:
 * each result is an `<a class="result-link" href>` followed by a
 * `<td class="result-snippet">`. Attribute order on the anchor varies by
 * build, so class and href are matched independently. Links may be direct or
 * wrapped in duckduckgo.com/l/?uddg=<encoded> redirects (ads).
 */
export function parseDuckDuckGoLite(html: string): WebSearchHit[] {
  const anchors = [...html.matchAll(/<a\b([^>]*\bclass=['"]result-link['"][^>]*)>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)];

  const hits: WebSearchHit[] = [];
  for (let i = 0; i < anchors.length && hits.length < MAX_HITS; i++) {
    const attr = anchors[i][1];
    const hrefMatch = /href=['"]([^'"]+)['"]/.exec(attr);
    if (!hrefMatch) {
      continue;
    }
    const url = unwrapDdgRedirect(decodeHtmlEntities(hrefMatch[1]));
    if (!/^https?:\/\//i.test(url)) {
      continue; // ads / internal links we cannot use
    }
    const title = stripHtml(anchors[i][2]).trim();
    const snippet = i < snippets.length ? stripHtml(snippets[i][1]).trim() : "";
    if (!title) {
      continue;
    }
    hits.push({ title, url, snippet });
  }
  return hits;
}

function unwrapDdgRedirect(href: string): string {
  const match = href.match(/[?&]uddg=([^&]+)/);
  if (!match) {
    return href;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return href;
  }
}

// ── Brave Search API (opt-in, user's key) ───────────────────────────────────

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

async function searchBrave(
  query: string,
  apiKey: string | undefined,
  timeoutMs: number | undefined
): Promise<WebSearchHit[]> {
  const key = requireApiKey("brave", apiKey);
  const payload = (await fetchJsonWithTimeout(
    `${BRAVE_SEARCH_URL}?${new URLSearchParams({ q: query, count: String(MAX_HITS) })}`,
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
    },
    timeoutMs
  )) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  return (payload.web?.results ?? [])
    .filter((r) => typeof r.url === "string" && /^https?:\/\//i.test(r.url))
    .slice(0, MAX_HITS)
    .map((r) => ({
      title: typeof r.title === "string" ? r.title : (r.url ?? ""),
      url: r.url as string,
      snippet: typeof r.description === "string" ? r.description : "",
    }));
}

// ── Tavily Search API (opt-in, user's key) ──────────────────────────────────

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

async function searchTavily(
  query: string,
  apiKey: string | undefined,
  timeoutMs: number | undefined
): Promise<WebSearchHit[]> {
  const key = requireApiKey("tavily", apiKey);
  const payload = (await fetchJsonWithTimeout(
    TAVILY_SEARCH_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ query, max_results: MAX_HITS }),
    },
    timeoutMs
  )) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (
    (payload.results ?? [])
      .filter((r) => typeof r.url === "string" && /^https?:\/\//i.test(r.url))
      // Client-side cap too (B7 lesson): never trust the server-side max_results.
      .slice(0, MAX_HITS)
      .map((r) => ({
        title: typeof r.title === "string" ? r.title : (r.url ?? ""),
        url: r.url as string,
        snippet: typeof r.content === "string" ? r.content : "",
      }))
  );
}

function requireApiKey(provider: WebSearchProviderId, apiKey: string | undefined): string {
  const key = apiKey?.trim();
  if (!key) {
    throw new Error(
      `The "${provider}" web search provider requires an API key — API-key configuration is currently ` +
        `disabled in DeepOrca settings; switch "webSearchProvider" to "duckduckgo" (the keyless built-in default).`
    );
  }
  return key;
}

// ── Small HTML helpers (regex-level, no parser dependency) ──────────────────

function stripHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ""));
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Render hits as a numbered markdown list for the model. */
export function formatWebSearchHits(hits: readonly WebSearchHit[]): string {
  if (hits.length === 0) {
    return "No results found.";
  }
  return hits
    .map((hit, index) => {
      const snippet = hit.snippet ? `\n   ${hit.snippet}` : "";
      return `${index + 1}. [${hit.title}](${hit.url})${snippet}`;
    })
    .join("\n");
}
