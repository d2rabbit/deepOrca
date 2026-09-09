/**
 * KB MCP Server — the generic agent-facing read surface over a project's
 * generated knowledge base (user ask 2026-09-09: 知识库不能是孤岛).
 *
 * Before this server, deepwiki pages and archify architecture maps were only
 * reachable from the desktop knowledge dashboard and the design renderer's
 * design.* Query tools — the coding agent and the editor agent had no way to
 * explore them. This in-process MCP server (same wiring as vision/a2ui) is
 * connected for EVERY agent session, exposing:
 *
 * - kb_overview      — one-shot inventory ("what knowledge exists here?")
 * - kb_list_pages    — wiki pages with OKF frontmatter metadata (recursive)
 * - kb_read_page     — one page, offset/limit paging for long bodies
 * - kb_search_pages  — case-insensitive keyword search with line hits
 * - kb_list_diagrams — archify typed-IR architecture maps
 * - kb_read_diagram  — one diagram's IR (components/connections/views)
 *
 * All reads go through core's pure kb-store readers (escape-guarded, absent
 * stores resolve to empty — never an error wall). Injected at boot via
 * `configureKbServerBuilder(buildKbServer)`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v3";
import type { ZodRawShape } from "zod/v3";
import {
  kbOverview,
  listWikiPages,
  readWikiPage,
  searchWikiPages,
  listArchDiagrams,
  readArchDiagram,
} from "@deeporca/core";

const SERVER_INFO = { name: "deeporca-kb", version: "0.1.0" };

// The SDK's registerTool generics are stricter than we need; rebind loosely.
type RegisterToolLoose = (
  name: string,
  config: { description?: string; inputSchema?: ZodRawShape },
  cb: (args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>
) => unknown;

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function jsonResult(value: unknown): CallToolResult {
  return textResult(JSON.stringify(value, null, 2));
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: `❌ ${message}` }], isError: true };
}

export function buildKbServer(projectRoot: string): McpServer {
  const server = new McpServer(SERVER_INFO);
  const registerTool = server.registerTool.bind(server) as unknown as RegisterToolLoose;

  registerTool(
    "kb_overview",
    {
      description:
        "Knowledge-base inventory for this project: which deepwiki pages exist (with titles/types) and which " +
        "architecture diagrams were generated. Start here when you want to know what project knowledge is " +
        "available before calling kb_list_pages / kb_read_page / kb_list_diagrams / kb_read_diagram.",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonResult(kbOverview(projectRoot));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  registerTool(
    "kb_list_pages",
    {
      description:
        "List every deepwiki page under .deeporca/deepwiki/ (recursive — modules/ and workflows/ included) " +
        "with OKF frontmatter metadata (title / type / description / tags). Returns [] when no wiki has been generated.",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonResult(listWikiPages(projectRoot));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  registerTool(
    "kb_read_page",
    {
      description:
        "Read one deepwiki page by name (store-relative, e.g. 'architecture' or 'modules/auth'). Returns " +
        "frontmatter metadata + markdown body. Long pages page through offsets — check `truncated` and pass " +
        "`offset` to continue.",
      inputSchema: {
        name: z.string().describe("Page name without .md, relative to .deeporca/deepwiki/ (e.g. 'modules/auth')"),
        offset: z.number().optional().describe("Char offset into the body (default 0)"),
        limit: z.number().optional().describe("Max chars returned per call (default 60000)"),
      },
    },
    async (args) => {
      try {
        return jsonResult(
          readWikiPage(projectRoot, args.name as string, {
            offset: typeof args.offset === "number" ? args.offset : undefined,
            limit: typeof args.limit === "number" ? args.limit : undefined,
          })
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  registerTool(
    "kb_search_pages",
    {
      description:
        "Keyword search across all deepwiki pages (case-insensitive substring, titles and body lines). Returns " +
        "page + line-number + matched-line hits. Prefer specific keywords ('workflow', a module name) over questions.",
      inputSchema: {
        query: z.string().min(1).describe("Case-insensitive substring to search for"),
        maxHits: z.number().optional().describe("Cap on returned hits (default 40)"),
      },
    },
    async (args) => {
      try {
        return jsonResult(
          searchWikiPages(projectRoot, args.query as string, {
            maxHits: typeof args.maxHits === "number" ? args.maxHits : undefined,
          })
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  registerTool(
    "kb_list_diagrams",
    {
      description:
        "List the generated architecture maps (archify typed-IR artifacts under .deeporca/prototypes/) with " +
        "title, type (architecture/workflow/sequence/dataflow/lifecycle), component/connection counts and " +
        "whether the interactive HTML view was delivered.",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonResult(listArchDiagrams(projectRoot));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  registerTool(
    "kb_read_diagram",
    {
      description:
        "Read one architecture map's typed IR by name (from kb_list_diagrams): components, boundaries, " +
        "connections and the author-curated focus views. This is the machine-readable architecture knowledge — " +
        "the delivered .html sibling is the human-facing interactive view.",
      inputSchema: {
        name: z.string().describe("Artifact name without .json (e.g. 'arch-auth.architecture')"),
      },
    },
    async (args) => {
      try {
        return jsonResult(readArchDiagram(projectRoot, args.name as string));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  return server;
}
