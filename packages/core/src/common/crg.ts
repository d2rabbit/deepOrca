import * as fs from "fs";
import * as path from "path";
import { resolveUvBinary } from "./uv";
import { spawnTracked } from "./spawn-tracked";

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
// (Retired 2026-08-23: CRG's MCP surface was folded into the plugin-MCP view;
// analysis queries now go through the crg-query action / direct SQLite reads.
// buildCrgMcpServerConfig and the analysis-tool allowlist were removed.)

// ── Subprocess execution ─────────────────────────────────────────────────────

/**
 * Hard cap on one CRG build/update/visualize run; override with
 * DEEPORCA_CRG_TIMEOUT_MS (milliseconds). A wedged uv-managed Python child
 * must never spin the UI forever (the index-knowledge failure class).
 */
const CRG_TIMEOUT_MS = Number(process.env.DEEPORCA_CRG_TIMEOUT_MS ?? "") || 20 * 60 * 1000;

/**
 * Build (or rebuild) the CRG graph with live output: runs `code-review-graph
 * build` through spawnTracked (exit-authoritative settlement + hard timeout +
 * heartbeat) and invokes `onOutput` for each line. Resolves with the exit
 * code — always settles, even on timeout/spawn failure (code 1 + an error
 * line), so UI progress streams always get a terminal event.
 */
function runCrgBuildWithOutput(
  projectRoot: string,
  onOutput: (chunk: string, stream: "stdout" | "stderr") => void
): Promise<number> {
  return (async (): Promise<number> => {
    const exe = resolveCrgExecutable();
    if (!exe) {
      onOutput("\n[Error] uv binary not available — cannot run code-review-graph\n", "stderr");
      return 1;
    }
    try {
      const result = await spawnTracked({
        label: "CRG build",
        command: exe.command,
        args: [...exe.prefixArgs, "build"],
        cwd: projectRoot,
        env: exe.env,
        timeoutMs: CRG_TIMEOUT_MS,
        heartbeatMs: 20_000,
        onHeartbeat: ({ elapsedSecs }) => {
          onOutput(`CRG: 运行中 ${elapsedSecs}s（图谱构建无进度流，请耐心等待）\n`, "stdout");
          return null;
        },
        onStdoutLine: (line) => onOutput(`${line}\n`, "stdout"),
        onStderrLine: (line) => onOutput(`${line}\n`, "stderr"),
      });
      if (result.forcedOk || result.code === 0) return 0;
      return result.code ?? 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onOutput(`\n[Error] code-review-graph build failed: ${message}\n`, "stderr");
      return 1;
    }
  })();
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
 * Returns the HTML content as a string, or null on failure/timeout.
 *
 * The visualize command writes a self-contained HTML file (D3.js force-directed
 * graph with community detection, hub/bridge nodes, search). We capture its
 * stdout to get the HTML content directly.
 */
export async function runCrgVisualize(projectRoot: string): Promise<string | null> {
  const exe = resolveCrgExecutable();
  if (!exe) return null;
  try {
    const result = await spawnTracked({
      label: "CRG visualize",
      command: exe.command,
      args: [...exe.prefixArgs, "visualize"],
      cwd: projectRoot,
      env: exe.env,
      timeoutMs: CRG_TIMEOUT_MS,
    });
    if ((result.forcedOk || result.code === 0) && result.stdout.trim()) return result.stdout;
    return null;
  } catch {
    return null;
  }
}
