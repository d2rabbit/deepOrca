import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { createMcpSpawnSpec } from "../mcp/spawn-spec";
import type { McpServerConfig } from "../settings";
import { resolveUvBinary } from "./uv";

/**
 * code-review-graph (CRG) integration.
 *
 * CRG (https://github.com/tirth8205/code-review-graph) is a Python-based code
 * intelligence graph that provides *analysis-layer* capabilities (risk scoring,
 * impact radius, community detection, architecture overview) complementing
 * CodeGraph's *navigation-layer* (symbol retrieval, call chains).
 *
 * Unlike CodeGraph (which is Node/TypeScript and can be vendored as a JS entry),
 * CRG is Python and needs a Python runtime. We solve this via `uv` — a single-
 * file static binary from astral-sh/uv that auto-provisions an isolated Python
 * environment. The desktop client vendors `uv` under `packages/desktop/vendor/uv/`
 * (see `scripts/vendor-uv.js`), and `uvx code-review-graph` handles the rest:
 * downloading Python 3.12, installing CRG, and running it in isolation — all
 * invisible to the user and requiring no host Python.
 *
 * The integration is *project-scoped*: a project participates only when it
 * contains a `.code-review-graph/` directory (created via `code-review-graph build`).
 * The MCP server exposes only analysis-layer tools (filtered via `--tools`),
 * avoiding overlap with CodeGraph's navigation tools.
 */

/** PyPI package for code-review-graph. */
export const CRG_PACKAGE = "code-review-graph";

// ── Version pinning (vendor-managed) ─────────────────────────────────────────

let configuredCrgVersionRoot: string | null = null;

/** Point the resolver at the vendor dir containing `.vendored-crg-version`. */
export function configureCrgVersionRoot(root: string | null): void {
  configuredCrgVersionRoot = root ? path.resolve(root) : null;
}

/** Read the pinned CRG version from the vendor marker, or null if not vendored. */
function readCrgPinnedVersion(): string | null {
  if (!configuredCrgVersionRoot) return null;
  try {
    const ver = fs.readFileSync(path.join(configuredCrgVersionRoot, ".vendored-crg-version"), "utf8").trim();
    return ver || null;
  } catch {
    return null;
  }
}

/** Name under which the CRG MCP server is registered. */
export const CRG_MCP_SERVER_NAME = "code-review-graph";

/** Project-local directory that holds the CRG graph (SQLite + FTS5). */
export const CRG_DIR_NAME = ".code-review-graph";

/**
 * Only expose analysis-layer tools (10/30) to avoid overlap with CodeGraph's
 * navigation tools. These are the tools CodeGraph does NOT have:
 * risk scoring, impact radius, community detection, hub/bridge analysis, etc.
 */
export const CRG_ANALYSIS_TOOLS = [
  "detect_changes_tool",
  "get_impact_radius_tool",
  "get_review_context_tool",
  "get_hub_nodes_tool",
  "get_bridge_nodes_tool",
  "get_surprising_connections_tool",
  "get_knowledge_gaps_tool",
  "get_architecture_overview_tool",
  "list_communities_tool",
  "get_suggested_questions_tool",
].join(",");

/**
 * How to spawn CRG: the executable (uv binary) plus args that must precede the
 * subcommand, and extra env vars.
 */
type CrgExecutable = {
  command: string;
  prefixArgs: string[];
  env?: Record<string, string>;
};

/**
 * Decide how to invoke CRG via uv. Returns the uv binary path + args to run
 * `code-review-graph` in an isolated environment. Returns `null` when no uv
 * binary is available (neither vendored nor on PATH).
 *
 * Uses `uv tool run` (alias `uvx`) which:
 *   - Downloads a standalone Python 3.12 build if no Python is available
 *   - Installs code-review-graph into an isolated environment
 *   - Runs the specified command
 *
 * This means the user needs NO Python installed — uv handles everything.
 */
export function resolveCrgExecutable(): CrgExecutable | null {
  const uvBin = resolveUvBinary();
  if (!uvBin) {
    // No vendored uv and not on PATH — CRG cannot run.
    return null;
  }
  // `uv tool run` (stable form) runs a tool in an isolated env.
  // `--from code-review-graph==<version>` pins the package for reproducibility.
  const pinnedVersion = readCrgPinnedVersion();
  const pkgSpec = pinnedVersion ? `${CRG_PACKAGE}==${pinnedVersion}` : CRG_PACKAGE;
  return {
    command: uvBin,
    prefixArgs: ["tool", "run", "--from", pkgSpec, "code-review-graph"],
  };
}

// ── Disable flag (host-managed, per project root) ────────────────────────────

const disabledCrgRoots = new Set<string>();

/** Enable or disable the built-in CRG MCP server for a project root. */
export function setCrgDisabled(projectRoot: string, disabled: boolean): void {
  const key = path.resolve(projectRoot);
  if (disabled) {
    disabledCrgRoots.add(key);
  } else {
    disabledCrgRoots.delete(key);
  }
}

/** True when the built-in CRG MCP server has been disabled for a project root. */
export function isCrgDisabled(projectRoot: string): boolean {
  return disabledCrgRoots.has(path.resolve(projectRoot));
}

// ── Project detection ────────────────────────────────────────────────────────

/**
 * True when the given project root has been initialized with CRG
 * (i.e. it contains a `.code-review-graph/` directory).
 */
export function hasCrgProject(projectRoot: string): boolean {
  try {
    return fs.statSync(path.join(projectRoot, CRG_DIR_NAME)).isDirectory();
  } catch {
    return false;
  }
}

// ── MCP server config ────────────────────────────────────────────────────────

/**
 * Build the MCP server configuration for CRG. The command comes from
 * {@link resolveCrgExecutable} (vendored uv or system uvx). The `cwd` is pinned
 * to the project root so the server targets the right project's graph.
 * Only analysis-layer tools are exposed (via `--tools`) to avoid overlap with
 * CodeGraph's navigation tools.
 */
export function buildCrgMcpServerConfig(projectRoot: string): McpServerConfig | null {
  const exe = resolveCrgExecutable();
  if (!exe) {
    return null;
  }
  const config: McpServerConfig = {
    command: exe.command,
    args: [...exe.prefixArgs, "serve", "--tools", CRG_ANALYSIS_TOOLS],
    cwd: projectRoot,
  };
  if (exe.env && Object.keys(exe.env).length > 0) {
    config.env = exe.env;
  }
  return config;
}

// ── Subprocess execution ─────────────────────────────────────────────────────

/** Spawn a CRG subcommand with piped stdio for output capture. */
function spawnCrgPiped(projectRoot: string, subcommand: string[]): ChildProcess | null {
  const exe = resolveCrgExecutable();
  if (!exe) {
    return null;
  }
  const spec = createMcpSpawnSpec(exe.command, [...exe.prefixArgs, ...subcommand]);
  const env = exe.env && Object.keys(exe.env).length > 0 ? { ...process.env, ...exe.env } : process.env;
  return spawn(spec.command, spec.args, {
    cwd: projectRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: spec.shell,
    windowsHide: spec.windowsHide,
  });
}

/**
 * Build (or rebuild) the CRG graph with live output: spawns `code-review-graph
 * build` with piped stdio and invokes `onOutput` for each chunk. Resolves with
 * the exit code. Used by the desktop UI to visualize indexing progress.
 */
function runCrgBuildWithOutput(
  projectRoot: string,
  onOutput: (chunk: string, stream: "stdout" | "stderr") => void
): Promise<number> {
  return new Promise<number>((resolve) => {
    try {
      const cp = spawnCrgPiped(projectRoot, ["build"]);
      if (!cp) {
        onOutput("\n[Error] uv binary not available — cannot run code-review-graph\n", "stderr");
        resolve(1);
        return;
      }
      cp.stdout?.on("data", (d: Buffer) => onOutput(d.toString(), "stdout"));
      cp.stderr?.on("data", (d: Buffer) => onOutput(d.toString(), "stderr"));
      cp.on("error", (err) => {
        onOutput(`\n[Error] Failed to spawn code-review-graph: ${err.message}\n`, "stderr");
        resolve(1);
      });
      cp.on("close", (code) => resolve(code ?? 0));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onOutput(`\n[Error] Failed to start code-review-graph: ${message}\n`, "stderr");
      resolve(1);
    }
  });
}

/**
 * Reset the CRG graph: remove `.code-review-graph/`, then run a fresh build
 * with piped stdio. Resolves with the exit code.
 */
export async function runCrgResetWithOutput(
  projectRoot: string,
  onOutput: (chunk: string, stream: "stdout" | "stderr") => void
): Promise<number> {
  const dir = path.join(projectRoot, CRG_DIR_NAME);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Directory may not exist.
  }
  return runCrgBuildWithOutput(projectRoot, onOutput);
}

/**
 * Run `code-review-graph visualize` to generate a D3.js interactive HTML graph.
 * Returns the HTML content as a string, or null on failure.
 *
 * The visualize command writes a self-contained HTML file (D3.js force-directed
 * graph with community detection, hub/bridge nodes, search). We capture its
 * stdout to get the HTML content directly.
 */
export function runCrgVisualize(projectRoot: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    try {
      const cp = spawnCrgPiped(projectRoot, ["visualize"]);
      if (!cp) {
        resolve(null);
        return;
      }
      let output = "";
      cp.stdout?.on("data", (d: Buffer) => {
        output += d.toString();
      });
      cp.stderr?.on("data", () => {
        // Ignore stderr — visualize may print progress messages.
      });
      cp.on("error", () => resolve(null));
      cp.on("close", (code) => {
        if (code === 0 && output.trim()) {
          resolve(output);
        } else {
          resolve(null);
        }
      });
    } catch {
      resolve(null);
    }
  });
}

// ── Incremental sync (fire-and-forget) ───────────────────────────────────────
