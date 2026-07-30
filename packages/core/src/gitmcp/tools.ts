// The MCP SDK (1.22.0) bundles zod ^3 and validates `inputSchema` via the v3
// internal `_parse`. The repo's top-level zod is v4 (whose ZodType lacks that
// API), so tool input shapes MUST be built with zod's v3 compatibility build —
// otherwise the SDK throws `keyValidator._parse is not a function` at call time.
import { z } from "zod/v3";
import type { FetchLike } from "./github";
import { fetchUrlContent, searchCode } from "./github";
import type { GitmcpStore } from "./store";
import { indexRepository } from "./indexer";

/**
 * The four gitmcp tools, semantically aligned with upstream git-mcp but with
 * fixed names — the AI distinguishes repositories via the server name
 * (`gitmcp:{owner}/{repo}`), not per-repo tool names.
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

/** The four tools as zod input shapes for SDK `registerTool` (auto-converted to JSON Schema). */
export function buildGitmcpToolRegistrations(slug: string): GitmcpToolRegistration[] {
  return [
    {
      name: "fetch_documentation",
      description: `Fetch and cache the documentation of ${slug} (llms.txt → README → docs).`,
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

async function fetchDocumentation(store: GitmcpStore, slug: string, fetchImpl: FetchLike): Promise<ToolCallResult> {
  try {
    const result = await indexRepository(slug, store, fetchImpl);
    const chunks = store.getRepoChunks(slug);
    const body = chunks.map((c) => (c.heading ? `## ${c.heading}\n${c.content}` : c.content)).join("\n\n");
    return text(`[source: ${result.docSource}, ${result.chunkCount} chunks indexed]\n\n${body}`);
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
  const meta = store.getRepoMeta(slug);
  if (!meta || meta.chunkCount === 0) {
    // Never indexed — fetch first so search works out of the box.
    try {
      await indexRepository(slug, store, fetchImpl);
    } catch (error) {
      return errorResult(error);
    }
  }
  const hits = store.search(slug, query, SEARCH_LIMIT);
  if (hits.length === 0) {
    return text(`No documentation matches for "${query}" in ${slug}.`);
  }
  const body = hits.map((hit, i) => `### ${i + 1}. ${hit.heading || "(document)"}\n${hit.content}`).join("\n\n---\n\n");
  return text(`${hits.length} match(es) for "${query}" in ${slug}:\n\n${body}`);
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
      default:
        return errorResult(new Error(`Unknown tool: ${name}`));
    }
  } catch (error) {
    return errorResult(error);
  }
}
