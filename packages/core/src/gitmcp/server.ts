import { pathToFileURL } from "url";
import type { RpcHandlers } from "./rpc";
import { RpcError, INVALID_REQUEST, serveStdio } from "./rpc";
import { buildToolDefinitions, callTool } from "./tools";
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

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

const SERVER_INFO = { name: "deepcode-gitmcp", version: "0.1.0" };

/** Same character set `parseRepoSlug()` guarantees — a cheap argv sanity check. */
const SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Build the JSON-RPC method handlers for one repository. Exported so tests
 * can drive the full protocol in-process via `dispatchRpcMessage()`.
 */
export function buildServerHandlers(slug: string, store: GitmcpStore = new GitmcpStore()): RpcHandlers {
  return {
    initialize: (params) => {
      const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
      return {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };
    },
    "notifications/initialized": () => ({}),
    ping: () => ({}),
    "tools/list": () => ({ tools: buildToolDefinitions(slug) }),
    "tools/call": async (params) => {
      const name = typeof params?.name === "string" ? params.name : "";
      if (!name) {
        throw new RpcError(INVALID_REQUEST, "tools/call requires a tool name");
      }
      const args =
        typeof params?.arguments === "object" && params.arguments !== null
          ? (params.arguments as Record<string, unknown>)
          : {};
      return callTool(store, slug, name, args);
    },
  };
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

function main(): void {
  const argv = process.argv.slice(2);
  if (argv[0]?.startsWith("--")) {
    void runMaintenance(argv).then(({ code, payload }) => {
      process.stdout.write(JSON.stringify(payload) + "\n");
      process.exit(code);
    });
    return;
  }
  const slug = argv[0] ?? "";
  if (!SLUG_PATTERN.test(slug)) {
    process.stderr.write(`gitmcp: expected a repository slug argument (owner/repo), got "${slug}"\n`);
    process.exit(1);
  }
  serveStdio(buildServerHandlers(slug));
}

// Only start the serve loop when executed as the process entry — tests import
// `buildServerHandlers` from this module without spawning a process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
