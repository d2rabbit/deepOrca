/**
 * GitHub access layer for the gitmcp server. All functions take an injectable
 * `fetch` so tests can stub the network. Only global `fetch` (Node ≥18) is
 * used — no HTTP client dependency.
 */

/** Which repository document ended up being indexed. */
export type DocSource = "llms.txt" | "llms-full.txt" | "readme";

export type RepoDocument = {
  source: DocSource;
  content: string;
};

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Documents probed in priority order, mirroring upstream git-mcp semantics. */
const DOC_CANDIDATES: Array<{ file: string; source: DocSource }> = [
  { file: "llms.txt", source: "llms.txt" },
  { file: "llms-full.txt", source: "llms-full.txt" },
  { file: "README.md", source: "readme" },
];

// `HEAD` resolves to the default branch on raw.githubusercontent.com; the
// explicit branches cover repositories where HEAD resolution misbehaves.
const BRANCH_CANDIDATES = ["HEAD", "main", "master"];

const USER_AGENT = "deeporca-gitmcp";

/** Response size cap for `fetch_url_content` (post-extraction). */
export const URL_CONTENT_LIMIT = 100 * 1024;

/**
 * Fetch a repository's primary documentation: `llms.txt` → `llms-full.txt` →
 * `README.md`, probing HEAD/main/master. Throws when nothing is reachable
 * (offline or repository without docs) — callers fall back to the local cache.
 */
export async function fetchRepoDocumentation(slug: string, fetchImpl: FetchLike = fetch): Promise<RepoDocument> {
  let lastError: unknown = null;
  for (const { file, source } of DOC_CANDIDATES) {
    for (const branch of BRANCH_CANDIDATES) {
      const url = `https://raw.githubusercontent.com/${slug}/${branch}/${file}`;
      try {
        const response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });
        if (response.ok) {
          const content = await response.text();
          if (content.trim()) {
            return { source, content };
          }
        }
      } catch (error) {
        lastError = error;
      }
    }
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`Unable to fetch documentation for ${slug} (tried llms.txt, llms-full.txt, README.md)${detail}`);
}

/**
 * Search code in the repository via the GitHub code-search API. Sends
 * `Authorization` when `GITHUB_TOKEN` is set (unauthenticated code search is
 * heavily rate-limited). Returns a human-readable result list.
 */
export async function searchCode(slug: string, query: string, page = 1, fetchImpl: FetchLike = fetch): Promise<string> {
  const q = encodeURIComponent(`${query} repo:${slug}`);
  const url = `https://api.github.com/search/code?q=${q}&per_page=10&page=${Math.max(1, page)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": USER_AGENT,
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub code search failed (HTTP ${response.status})${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  const data = (await response.json()) as {
    total_count?: number;
    items?: Array<{ name?: string; path?: string; html_url?: string }>;
  };
  const items = data.items ?? [];
  if (items.length === 0) {
    return `No code results for "${query}" in ${slug}.`;
  }
  const lines = items.map((item, i) => `${i + 1}. ${item.path ?? item.name ?? "(unknown)"}\n   ${item.html_url ?? ""}`);
  return [`${data.total_count ?? items.length} result(s) for "${query}" in ${slug} (page ${page}):`, ...lines].join(
    "\n"
  );
}

/**
 * Fetch an arbitrary URL and return its content as plain text. HTML is
 * reduced with a lightweight heuristic (no html-to-markdown dependency);
 * output is capped at {@link URL_CONTENT_LIMIT} characters.
 */
export async function fetchUrlContent(url: string, fetchImpl: FetchLike = fetch): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  const response = await fetchImpl(parsed.toString(), { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (HTTP ${response.status})`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  const text = contentType.includes("text/html") ? extractTextFromHtml(raw) : raw;
  return text.length > URL_CONTENT_LIMIT ? `${text.slice(0, URL_CONTENT_LIMIT)}\n\n[content truncated]` : text;
}

/** Strip an HTML document down to readable plain text. */
export function extractTextFromHtml(html: string): string {
  return (
    html
      // Drop non-content blocks entirely.
      .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      // Keep block boundaries as line breaks before removing tags.
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, "\n")
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      // Minimal entity decoding for the common cases.
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      // Collapse whitespace while preserving paragraph breaks.
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
