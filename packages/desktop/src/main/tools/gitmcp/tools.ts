// The MCP SDK (1.22.0) bundles zod ^3 and validates `inputSchema` via the v3
// internal `_parse`. The repo's top-level zod is v4 (whose ZodType lacks that
// API), so tool input shapes MUST be built with zod's v3 compatibility build —
// otherwise the SDK throws `keyValidator._parse is not a function` at call time.
import { z } from "zod/v3";
import type { FetchLike } from "./github";
import { fetchRawText, fetchUrlContent, getRepoStructure, searchCode } from "./github";
import type { GitmcpStore } from "./store";
import { indexRepository } from "./indexer";

/**
 * The eight gitmcp tools, semantically aligned with upstream git-mcp (plus the
 * zread-inspired structure/read/outline/info tools) but with fixed names — the
 * AI distinguishes repositories via the server name (`gitmcp:{owner}/{repo}`),
 * not per-repo tool names.
 */

/** MCP `tools/call` result shape (subset used by our client). */
export type ToolCallResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const SEARCH_LIMIT = 8;

export type GitmcpToolRegistration = {
  name: string;
  description: string;
  inputShape: Record<string, z.ZodType>;
};

/** The eight tools as zod input shapes for SDK `registerTool` (auto-converted to JSON Schema). */
export function buildGitmcpToolRegistrations(slug: string): GitmcpToolRegistration[] {
  return [
    {
      name: "fetch_documentation",
      description: `Fetch and cache the documentation of ${slug} (llms.txt → README, plus docs/ files).`,
      inputShape: {},
    },
    {
      name: "search_documentation",
      description: `Full-text search (BM25) over the locally indexed documentation of ${slug}.`,
      inputShape: { query: z.string() },
    },
    {
      name: "search_code",
      description: `Search code snippets indexed for ${slug}.`,
      inputShape: { query: z.string(), page: z.number().optional() },
    },
    {
      name: "fetch_url_content",
      description: `Fetch raw content from a URL under ${slug}.`,
      inputShape: { url: z.string() },
    },
    {
      name: "get_repo_structure",
      description: `Directory tree of ${slug} via the GitHub trees API (dirs first, capped at 400 entries).`,
      inputShape: { path: z.string().optional(), depth: z.number().optional() },
    },
    {
      name: "read_file",
      description: `Read one raw text file of ${slug} (binary rejected, 256KB cap).`,
      inputShape: { path: z.string(), ref: z.string().optional() },
    },
    {
      name: "get_repo_info",
      description: `Index status of ${slug}: source, chunk count, and which doc files are indexed.`,
      inputShape: {},
    },
    {
      name: "outline",
      description: `Heading outline (h1–h3) of the indexed documentation of ${slug}.`,
      inputShape: { section: z.string().optional() },
    },
  ];
}

function text(value: string): ToolCallResult {
  return { content: [{ type: "text", text: value }] };
}

function errorResult(error: unknown): ToolCallResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/** Rebuild the cached document text from indexed chunks (offline fallback). */
function cachedDocumentText(store: GitmcpStore, slug: string): string | null {
  const meta = store.getRepoMeta(slug);
  const chunks = store.getRepoChunks(slug);
  if (!meta || chunks.length === 0) {
    return null;
  }
  const body = chunks.map((c) => (c.heading ? `## ${c.heading}\n${c.content}` : c.content)).join("\n\n");
  const fetchedAt = meta.fetchedAt ? new Date(meta.fetchedAt).toISOString() : "unknown";
  return `[cached copy of ${meta.docSource ?? "documentation"}, cached_at: ${fetchedAt}]\n\n${body}`;
}

/** Never indexed? Fetch once so store-backed tools work out of the box. */
async function ensureIndexed(store: GitmcpStore, slug: string, fetchImpl: FetchLike): Promise<void> {
  const meta = store.getRepoMeta(slug);
  if (!meta || meta.chunkCount === 0) {
    await indexRepository(slug, store, fetchImpl);
  }
}

async function fetchDocumentation(store: GitmcpStore, slug: string, fetchImpl: FetchLike): Promise<ToolCallResult> {
  try {
    const result = await indexRepository(slug, store, fetchImpl);
    const chunks = store.getRepoChunks(slug);
    const body = chunks.map((c) => (c.heading ? `## ${c.heading}\n${c.content}` : c.content)).join("\n\n");
    const files = result.files ? `, files: ${result.files.join(", ")}` : "";
    return text(`[source: ${result.docSource}, ${result.chunkCount} chunks indexed${files}]\n\n${body}`);
  } catch (error) {
    const cached = cachedDocumentText(store, slug);
    return cached ? text(cached) : errorResult(error);
  }
}

async function searchDocumentation(
  store: GitmcpStore,
  slug: string,
  query: string,
  fetchImpl: FetchLike
): Promise<ToolCallResult> {
  try {
    await ensureIndexed(store, slug, fetchImpl);
  } catch (error) {
    return errorResult(error);
  }
  const hits = store.search(slug, query, SEARCH_LIMIT);
  if (hits.length === 0) {
    return text(`No documentation matches for "${query}" in ${slug}.`);
  }
  const body = hits.map((hit, i) => `### ${i + 1}. ${hit.heading || "(document)"}\n${hit.content}`).join("\n\n---\n\n");
  return text(`${hits.length} match(es) for "${query}" in ${slug}:\n\n${body}`);
}

// ── outline (C4) ────────────────────────────────────────────────────────────

const OUTLINE_MAX_LEVELS = 3;
const OUTLINE_MAX_LINES = 200;

type OutlineNode = { name: string; children: Map<string, OutlineNode> };

function insertOutlinePath(root: OutlineNode, segments: string[]): void {
  let node = root;
  for (const segment of segments) {
    let child = node.children.get(segment);
    if (!child) {
      child = { name: segment, children: new Map() };
      node.children.set(segment, child);
    }
    node = child;
  }
}

function countOutlineNodes(node: OutlineNode): number {
  let count = node.children.size;
  for (const child of node.children.values()) {
    count += countOutlineNodes(child);
  }
  return count;
}

function emitOutlineNodes(node: OutlineNode, level: number, budget: { remaining: number }, lines: string[]): void {
  for (const child of node.children.values()) {
    if (budget.remaining <= 0) {
      return;
    }
    budget.remaining -= 1;
    lines.push(`${"  ".repeat(level)}- ${child.name}`);
    emitOutlineNodes(child, level + 1, budget, lines);
  }
}

/**
 * Aggregate the indexed chunks' heading paths into a hierarchical outline
 * (h1–h3; deeper heading paths fold into the third level). Purely store-backed
 * — the network is only touched to lazily index an empty store.
 */
async function outlineTool(
  store: GitmcpStore,
  slug: string,
  section: string | undefined,
  fetchImpl: FetchLike
): Promise<ToolCallResult> {
  let meta = store.getRepoMeta(slug);
  if (!meta || meta.chunkCount === 0) {
    try {
      await indexRepository(slug, store, fetchImpl);
    } catch (error) {
      return errorResult(error);
    }
    meta = store.getRepoMeta(slug);
  }
  const chunks = store.getRepoChunks(slug);
  const headingPaths: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (!chunk.heading || seen.has(chunk.heading)) {
      continue;
    }
    seen.add(chunk.heading);
    headingPaths.push(chunk.heading);
  }
  const header = `Outline of ${slug} (source: ${meta?.docSource ?? "documentation"}, ${chunks.length} chunks${
    section?.trim() ? `, matching "${section.trim()}"` : ""
  }):`;
  if (headingPaths.length === 0) {
    return text(`${header}\n\n(no headings — the indexed document has no ATX headings)`);
  }
  const needle = (section ?? "").trim().toLowerCase();
  const filtered = needle ? headingPaths.filter((p) => p.toLowerCase().includes(needle)) : headingPaths;
  if (filtered.length === 0) {
    return text(`No outline headings of ${slug} match "${section?.trim()}".`);
  }
  const root: OutlineNode = { name: "", children: new Map() };
  for (const headingPath of filtered) {
    const segments = headingPath.split(" > ");
    if (segments.length > OUTLINE_MAX_LEVELS) {
      segments.splice(OUTLINE_MAX_LEVELS - 1, segments.length, segments.slice(OUTLINE_MAX_LEVELS - 1).join(" > "));
    }
    insertOutlinePath(root, segments);
  }
  const lines: string[] = [];
  const total = countOutlineNodes(root);
  emitOutlineNodes(root, 0, { remaining: OUTLINE_MAX_LINES }, lines);
  const note = lines.length < total ? `\n\n… (+${total - lines.length} more headings)` : "";
  return text(`${header}\n\n${lines.join("\n")}${note}`);
}

// ── get_repo_info (C3 companion: index status) ─────────────────────────────

/** Source files represented in a chunk list (multi-file headings prefix the path). */
function indexedSourceFiles(chunks: Array<{ heading: string }>): string[] {
  const files: string[] = [];
  for (const chunk of chunks) {
    const first = chunk.heading.split(" > ")[0];
    if (!/\.(md|markdown|txt)$/i.test(first) || files.includes(first)) {
      continue;
    }
    files.push(first);
  }
  return files;
}

async function repoInfo(store: GitmcpStore, slug: string, fetchImpl: FetchLike): Promise<ToolCallResult> {
  let meta = store.getRepoMeta(slug);
  if (!meta || meta.chunkCount === 0) {
    // Cold store — index once so the report is meaningful; failure just reports "no".
    try {
      await indexRepository(slug, store, fetchImpl);
      meta = store.getRepoMeta(slug);
    } catch {
      // Unreachable — fall through and report the empty state.
    }
  }
  if (!meta || meta.chunkCount === 0) {
    return text(`${slug}: not indexed (no cached copy and indexing is currently unavailable).`);
  }
  const files = indexedSourceFiles(store.getRepoChunks(slug));
  const fetchedAt = meta.fetchedAt ? new Date(meta.fetchedAt).toISOString() : "unknown";
  const lines = [
    `${slug}:`,
    `  indexed: yes`,
    `  source: ${meta.docSource ?? "unknown"}`,
    `  fetched_at: ${fetchedAt}`,
    `  chunks: ${meta.chunkCount}`,
  ];
  if (files.length > 0) {
    lines.push(`  files (${files.length}):`, ...files.map((file) => `    - ${file}`));
  } else {
    lines.push(`  files: single-source index (no per-file headings recorded)`);
  }
  return text(lines.join("\n"));
}

/**
 * Execute one tool call against a repository. Errors are returned as
 * `isError` results (per MCP), never thrown as protocol errors.
 */
export async function callTool(
  store: GitmcpStore,
  slug: string,
  name: string,
  args: Record<string, unknown>,
  fetchImpl: FetchLike = fetch
): Promise<ToolCallResult> {
  try {
    switch (name) {
      case "fetch_documentation":
        return await fetchDocumentation(store, slug, fetchImpl);
      case "search_documentation": {
        const query = typeof args.query === "string" ? args.query : "";
        if (!query.trim()) {
          return errorResult(new Error("`query` is required"));
        }
        return await searchDocumentation(store, slug, query, fetchImpl);
      }
      case "search_code": {
        const query = typeof args.query === "string" ? args.query : "";
        if (!query.trim()) {
          return errorResult(new Error("`query` is required"));
        }
        const page = typeof args.page === "number" && Number.isFinite(args.page) ? Math.floor(args.page) : 1;
        return text(await searchCode(slug, query, page, fetchImpl));
      }
      case "fetch_url_content": {
        const url = typeof args.url === "string" ? args.url : "";
        if (!url.trim()) {
          return errorResult(new Error("`url` is required"));
        }
        return text(await fetchUrlContent(url, fetchImpl));
      }
      case "get_repo_structure": {
        const path = typeof args.path === "string" ? args.path : "";
        const depth = typeof args.depth === "number" && Number.isFinite(args.depth) ? args.depth : undefined;
        return text(await getRepoStructure(slug, { path: path || undefined, depth }, fetchImpl));
      }
      case "read_file": {
        const path = typeof args.path === "string" ? args.path : "";
        if (!path.trim()) {
          return errorResult(new Error("`path` is required"));
        }
        const ref = typeof args.ref === "string" && args.ref.trim() ? args.ref.trim() : undefined;
        const file = await fetchRawText(slug, path, { ref }, fetchImpl);
        return text(`[${path} @ ${file.ref}]\n\n${file.content}`);
      }
      case "get_repo_info":
        return await repoInfo(store, slug, fetchImpl);
      case "outline": {
        const section = typeof args.section === "string" ? args.section : undefined;
        return await outlineTool(store, slug, section, fetchImpl);
      }
      default:
        return errorResult(new Error(`Unknown tool: ${name}`));
    }
  } catch (error) {
    return errorResult(error);
  }
}
