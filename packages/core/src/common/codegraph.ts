/**
 * CodeGraph MCP config + project predicates.
 *
 * All subprocess spawn code (runCodegraphInit/Sync/Reset/etc.) has been
 * migrated to desktop's `SdkCodegraphController` (imports @colbymchenry/codegraph
 * SDK directly). The runtime-resolution helpers (resolveSqliteRuntimeForEntry,
 * resolveModernNode) live in `sqlite-runtime.ts`.
 *
 * What remains here: the MCP server config builder (still needed because the
 * SDK's MCPServer doesn't expose connect(transport) for in-process bridging)
 * and pure project-state predicates.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { createMcpSpawnSpec } from "../mcp/spawn-spec";
import type { McpServerConfig } from "../settings";

const moduleRequire = createRequire(import.meta.url);

export const CODEGRAPH_PACKAGE = "@colbymchenry/codegraph";
export const CODEGRAPH_MCP_SERVER_NAME = "codegraph";
export const CODEGRAPH_DIR_NAME = ".codegraph";

/**
 * How to spawn CodeGraph: the executable plus any args that must precede the
 * subcommand, and extra env vars.
 */
export type CodegraphExecutable = {
  command: string;
  prefixArgs: string[];
  env?: Record<string, string>;
};

/**
 * Resolve how to run the CodeGraph CLI for MCP mode.
 *
 * Resolution order:
 * 1. npm package `@colbymchenry/codegraph` via `npm-shim.js` → run through
 *    `process.execPath` with `ELECTRON_RUN_AS_NODE` (primary path).
 * 2. npx fallback `{ command: "npx", prefixArgs: ["-y", CODEGRAPH_PACKAGE] }`.
 *
 * Returns the executable spec, or null when neither path is available.
 */
export function resolveCodegraphExecutable(): CodegraphExecutable {
  // 1. npm package (the primary path — installed as a desktop dependency).
  try {
    moduleRequire.resolve("@colbymchenry/codegraph/package.json");
    return {
      command: process.execPath,
      prefixArgs: [
        path.join(path.dirname(moduleRequire.resolve("@colbymchenry/codegraph/package.json")), "npm-shim.js"),
      ],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
  } catch {
    // npm package not installed — try npx.
  }

  // 2. npx fallback.
  return {
    command: "npx",
    prefixArgs: ["-y", CODEGRAPH_PACKAGE],
  };
}

// ── Per-project disable state ────────────────────────────────────────────────

const disabledCodegraphRoots = new Set<string>();

export function setCodegraphDisabled(projectRoot: string, disabled: boolean): void {
  const key = path.resolve(projectRoot);
  if (disabled) {
    disabledCodegraphRoots.add(key);
  } else {
    disabledCodegraphRoots.delete(key);
  }
}

export function isCodegraphDisabled(projectRoot: string): boolean {
  return disabledCodegraphRoots.has(path.resolve(projectRoot));
}

// ── Project detection ────────────────────────────────────────────────────────

export function hasCodegraphProject(projectRoot: string): boolean {
  try {
    return fs.statSync(path.join(projectRoot, CODEGRAPH_DIR_NAME)).isDirectory();
  } catch {
    return false;
  }
}

// ── MCP config builder ───────────────────────────────────────────────────────

/**
 * Build the MCP server spawn config for CodeGraph. The config is consumed by
 * the MCP manager's stdio transport — it spawns `codegraph serve --mcp` as
 * a subprocess.
 *
 * Note: index/sync operations go through SdkCodegraphController (in-process SDK).
 * MCP tool queries (codegraph_explore etc.) still use this subprocess config
 * because the SDK's MCPServer doesn't expose connect(transport) for in-process
 * bridging yet.
 */
export function buildCodegraphMcpServerConfig(projectRoot: string): McpServerConfig {
  const exe = resolveCodegraphExecutable();
  const spec = createMcpSpawnSpec(exe.command, [...exe.prefixArgs, "serve", "--mcp"]);
  const config: McpServerConfig = {
    command: spec.command,
    args: spec.args,
    cwd: projectRoot,
  };
  if (exe.env && Object.keys(exe.env).length > 0) {
    config.env = exe.env;
  }
  return config;
}
