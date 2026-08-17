import { pathToFileURL } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShape } from "zod/v3";
import { buildGitmcpToolRegistrations, callTool } from "./tools";
import { GitmcpStore, readGitmcpRepoMeta, removeGitmcpRepoIndex } from "./store";
import { indexRepository } from "./indexer";

/**
 * gitmcp server entry: a stdio MCP server bound to a single GitHub repository
 * given as argv (`server.js owner/repo`). Spawned with a sqlite-capable Node
 * runtime by the config produced in `./resolve.ts`.
 *
 * Note: this entry is bundled standalone (`dist/gitmcp/server.js`), so it must
 * not import `./resolve.ts` — that would drag the prompt/codegraph module
 * graph into the server bundle. The slug is already normalized by
 * `parseRepoSlug()` at registration time; only a sanity check happens here.
 */

const SERVER_INFO = { name: "deeporca-gitmcp", version: "0.1.0" };

/** Same character set `parseRepoSlug()` guarantees — a cheap argv sanity check. */
const SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Minimal view of the SDK `registerTool` call signature, pinned to concrete
 * zod raw shapes. `McpServer.registerTool`'s real signature infers a deep
 * `objectOutputType<InputArgs, ...>` generic over the input shape; passing an
 * open `Record<string, ZodType>` makes TypeScript complain "type instantiation
 * is excessively deep" (TS2589). Routing through this alias short-circuits the
 * inference while staying type-safe: names are strings, shapes are validated
 * zod fields, and the callback returns the SDK's `CallToolResult`.
 */
type RegisterToolLoose = (
  name: string,
  config: { description?: string; inputSchema?: ZodRawShape },
  cb: (args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>
) => unknown;

/**
 * Build the MCP server for one repository: registers the eight gitmcp tools,
 * each delegating to the pure `callTool` dispatcher. The returned server is
 * not yet connected — the caller connects it to a transport (in-memory for
 * tests, `StdioServerTransport` for the real process entry).
 */
export function buildGitmcpServer(slug: string, store: GitmcpStore = new GitmcpStore()): McpServer {
  const server = new McpServer(SERVER_INFO);
  const registerTool = server.registerTool.bind(server) as unknown as RegisterToolLoose;
  for (const reg of buildGitmcpToolRegistrations(slug)) {
    registerTool(reg.name, { description: reg.description, inputSchema: reg.inputShape }, async (args) =>
      callTool(store, slug, reg.name, args)
    );
  }
  return server;
}

/**
 * Maintenance subcommands for hosts whose own runtime lacks `node:sqlite`
 * (e.g. the Electron main process): they spawn this entry with the same
 * sqlite-capable runtime used for the MCP server and read JSON from stdout.
 * Exported so tests can drive it in-process without spawning.
 */
export async function runMaintenance(argv: string[]): Promise<{ code: number; payload: unknown }> {
  const [flag, slug = ""] = argv;
  try {
    if (flag === "--meta") {
      return { code: 0, payload: readGitmcpRepoMeta() };
    }
    if (!SLUG_PATTERN.test(slug)) {
      return { code: 1, payload: { ok: false, error: `invalid slug "${slug}"` } };
    }
    if (flag === "--remove-index") {
      removeGitmcpRepoIndex(slug);
      return { code: 0, payload: { ok: true } };
    }
    if (flag === "--reindex") {
      const store = new GitmcpStore();
      try {
        const result = await indexRepository(slug, store);
        return { code: 0, payload: { ok: true, chunkCount: result.chunkCount } };
      } finally {
        store.close();
      }
    }
    return { code: 1, payload: { ok: false, error: `unknown flag "${flag}"` } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 1, payload: { ok: false, error: message } };
  }
}

/** Validation capture: returns the argv slug only when it matches the
 * owner/repo shape — the tainted argv value never flows onward unchecked.
 * Misuse throws (uncaught at the entry point → stderr + exit 1); keeping the
 * rejection write-free keeps this function out of write-sink taint flows. */
function requireRepoSlug(argv: string[]): string {
  const raw = argv[0];
  if (typeof raw !== "string" || !SLUG_PATTERN.test(raw)) {
    throw new Error("gitmcp: expected a repository slug argument (owner/repo)");
  }
  return raw;
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv[0]?.startsWith("--")) {
    void runMaintenance(argv).then(({ code, payload }) => {
      process.stdout.write(JSON.stringify(payload) + "\n");
      process.exit(code);
    });
    return;
  }
  const slug = requireRepoSlug(argv);
  const server = buildGitmcpServer(slug);
  void server.connect(new StdioServerTransport());
}

// Only start the serve loop when executed as the process entry — tests import
// `buildGitmcpServer` from this module without spawning a process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
