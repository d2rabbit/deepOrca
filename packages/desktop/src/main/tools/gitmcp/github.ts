/**
 * GitHub access layer for the gitmcp server. All functions take an injectable
 * `fetch` so tests can stub the network. Only global `fetch` (Node ≥18) is
 * used — no HTTP client dependency.
 */

/** Which repository document ended up being indexed. */
export type DocSource = "llms.txt" | "llms-full.txt" | "readme";

export type RepoDocument = {
  source: DocSource;
  /** The concrete file the content came from, e.g. "llms.txt" or "README.md". */
  file: string;
  /** The branch candidate that served the file ("HEAD" | "main" | "master"). */
  ref: string;
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
            return { source, file, ref: branch, content };
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

// ── Repository tree (C1: get_repo_structure) ───────────────────────────────

/** One entry of a recursive repository tree listing. */
export type RepoTreeEntry = {
  path: string;
  type: "blob" | "tree";
  /** Blob size in bytes when the API reports it (absent for trees). */
  size?: number;
};

/** Recursive tree listing plus the ref (branch candidate) that resolved. */
export type RepoTree = { ref: string; entries: RepoTreeEntry[] };

function githubApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": USER_AGENT,
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * List a repository's tree via `GET /repos/{slug}/git/trees/{ref}?recursive=1`,
 * probing HEAD/main/master like the raw-file fetches. Throws when no candidate
 * resolves (offline, private repository, rate limited).
 */
export async function fetchRepoTree(slug: string, fetchImpl: FetchLike = fetch): Promise<RepoTree> {
  for (const branch of BRANCH_CANDIDATES) {
    const url = `https://api.github.com/repos/${slug}/git/trees/${branch}?recursive=1`;
    const response = await fetchImpl(url, { headers: githubApiHeaders() });
    if (!response.ok) {
      continue;
    }
    const data = (await response.json()) as { tree?: Array<{ path?: string; type?: string; size?: number }> };
    const entries: RepoTreeEntry[] = [];
    for (const entry of data.tree ?? []) {
      if (typeof entry.path !== "string" || (entry.type !== "blob" && entry.type !== "tree")) {
        continue;
      }
      entries.push({ path: entry.path, type: entry.type, size: entry.size });
    }
    if (entries.length > 0) {
      return { ref: branch, entries };
    }
  }
  throw new Error(`Unable to fetch repository tree for ${slug} (tried HEAD, main, master)`);
}

/** Entry cap for the rendered structure tree — a token-budget bound. */
export const STRUCTURE_ENTRY_LIMIT = 400;

/** Byte cap for raw file reads (`read_file`) and doc-file indexing. */
export const RAW_FILE_LIMIT = 256 * 1024;

export type StructureOptions = {
  /** Restrict the tree to the subdirectory rooted at this path. */
  path?: string;
  /** Maximum directory levels shown (1 = direct children only). */
  depth?: number;
};

type StructureNode = { name: string; isDir: boolean; children: StructureNode[] };

function sortStructureTree(node: StructureNode): void {
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
  for (const child of node.children) {
    sortStructureTree(child);
  }
}

/** Build the nested tree from flat entries, optionally rooted at `prefix`. */
function buildStructureTree(entries: RepoTreeEntry[], prefix: string): StructureNode {
  const matching = entries.filter((e) => !prefix || e.path === prefix || e.path.startsWith(`${prefix}/`));
  if (matching.length === 0) {
    throw new Error(`path "${prefix}" not found in repository`);
  }
  const root: StructureNode = { name: "", isDir: true, children: [] };
  const dirs = new Map<string, StructureNode>([["", root]]);
  const ensureDir = (dir: string): StructureNode => {
    const existing = dirs.get(dir);
    if (existing) {
      return existing;
    }
    const slash = dir.lastIndexOf("/");
    const parent = ensureDir(slash === -1 ? "" : dir.slice(0, slash));
    const node: StructureNode = { name: dir.slice(slash + 1), isDir: true, children: [] };
    parent.children.push(node);
    dirs.set(dir, node);
    return node;
  };
  for (const entry of matching) {
    const rel = prefix ? entry.path.slice(prefix.length + 1) : entry.path;
    if (!rel) {
      continue; // The prefix entry itself — its children are the subtree.
    }
    const slash = rel.lastIndexOf("/");
    const parent = ensureDir(slash === -1 ? "" : rel.slice(0, slash));
    const node: StructureNode = { name: rel.slice(slash + 1), isDir: entry.type === "tree", children: [] };
    parent.children.push(node);
    if (node.isDir) {
      dirs.set(rel, node); // Explicit tree entries are the parents of their children.
    }
  }
  sortStructureTree(root);
  return root;
}

function countStructureEntries(node: StructureNode, levels: number): number {
  if (levels <= 0) {
    return 0;
  }
  let count = node.children.length;
  for (const child of node.children) {
    if (child.isDir) {
      count += countStructureEntries(child, levels - 1);
    }
  }
  return count;
}

function emitStructureEntries(
  node: StructureNode,
  level: number,
  depth: number,
  budget: { remaining: number },
  lines: string[]
): void {
  if (level >= depth) {
    return;
  }
  for (const child of node.children) {
    if (budget.remaining <= 0) {
      return;
    }
    budget.remaining -= 1;
    if (child.isDir) {
      lines.push(`${"  ".repeat(level)}${child.name}/ (${child.children.length})`);
      emitStructureEntries(child, level + 1, depth, budget, lines);
    } else {
      lines.push(`${"  ".repeat(level)}${child.name}`);
    }
  }
}

/**
 * Render the repository tree as an indented listing — directories first with
 * direct-child counts, then files — limited to `depth` levels and at most
 * {@link STRUCTURE_ENTRY_LIMIT} entries with a `… (+N more)` truncation note.
 */
export async function getRepoStructure(
  slug: string,
  options: StructureOptions,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const tree = await fetchRepoTree(slug, fetchImpl);
  const prefix = options.path ? assertRepoRelativePath(options.path) : "";
  const depth = options.depth == null ? Infinity : Math.min(Math.max(Math.floor(options.depth), 1), 10);
  const exact = prefix ? tree.entries.find((e) => e.path === prefix) : undefined;
  if (exact && exact.type === "blob") {
    return `${slug}/${prefix} @ ${tree.ref} (file)`;
  }
  const root = buildStructureTree(tree.entries, prefix);
  const total = countStructureEntries(root, depth);
  const lines: string[] = [];
  emitStructureEntries(root, 0, depth, { remaining: STRUCTURE_ENTRY_LIMIT }, lines);
  const header = `${slug}${prefix ? `/${prefix}` : ""} @ ${tree.ref} (${total} entries)`;
  const note = lines.length < total ? `\n\n… (+${total - lines.length} more)` : "";
  return `${[header, ...lines].join("\n")}${note}`;
}

// ── Raw file reads (C2: read_file) ─────────────────────────────────────────

export type RawFile = { content: string; ref: string };

/**
 * Validate a user-supplied path as repository-relative: no URLs (scheme or
 * `//` prefix), no absolute/drive paths, no `..` or empty segments. Returns the
 * normalized POSIX-style path. Raw URLs are always constructed from slug+ref
 * +path — a full URL from tool input must never be accepted.
 */
export function assertRepoRelativePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("`path` is required");
  }
  if (trimmed.includes("://") || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) {
    throw new Error(`\`path\` must be a repository-relative path, not a URL: ${input}`);
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized.split("/").some((segment) => segment === ".." || segment === "")) {
    throw new Error(`\`path\` must not contain \`..\` or empty segments: ${input}`);
  }
  return normalized;
}

/** Content types that can be decoded as text; anything else is binary. */
function isTextContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct.startsWith("text/") || /(json|xml|yaml|javascript|markdown|csv|svg)/.test(ct);
}

/** Reject a raw buffer as binary: content-type says so, or it embeds NUL bytes. */
function rejectBinary(filePath: string, bytes: Uint8Array, contentType: string): void {
  const textual = contentType === "" || isTextContentType(contentType);
  const hasNul = textual && bytes.subarray(0, 8192).includes(0);
  if (!textual || hasNul) {
    throw new Error(`${filePath}: binary or non-UTF-8 file`);
  }
}

/**
 * Read one file from `https://raw.githubusercontent.com/{slug}/{ref}/{path}`.
 * `options.ref` pins one ref (no fallback — a typo must surface); `options.refHint`
 * is tried first with the usual candidates as fallback; with neither, HEAD/main/
 * master are probed like the doc fetches. Binary content (content-type, NUL-byte
 * sniff, strict UTF-8 decode) and files above {@link RAW_FILE_LIMIT} are rejected.
 */
export async function fetchRawText(
  slug: string,
  path: string,
  options: { ref?: string; refHint?: string } = {},
  fetchImpl: FetchLike = fetch
): Promise<RawFile> {
  const filePath = assertRepoRelativePath(path);
  const refs = options.ref
    ? [options.ref]
    : options.refHint
      ? [options.refHint, ...BRANCH_CANDIDATES.filter((b) => b !== options.refHint)]
      : [...BRANCH_CANDIDATES];
  let lastStatus = 0;
  for (const ref of refs) {
    const encoded = filePath.split("/").map(encodeURIComponent).join("/");
    const url = `https://raw.githubusercontent.com/${slug}/${encodeURIComponent(ref)}/${encoded}`;
    const response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) {
      lastStatus = response.status;
      continue;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > RAW_FILE_LIMIT) {
      throw new Error(`${filePath} exceeds the 256KB limit (${bytes.byteLength} bytes)`);
    }
    rejectBinary(filePath, bytes, response.headers.get("content-type") ?? "");
    try {
      return { content: new TextDecoder("utf-8", { fatal: true }).decode(bytes), ref };
    } catch {
      throw new Error(`${filePath}: binary or non-UTF-8 file`);
    }
  }
  throw new Error(`Failed to fetch ${filePath} from ${slug} (HTTP ${lastStatus || "error"})`);
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
