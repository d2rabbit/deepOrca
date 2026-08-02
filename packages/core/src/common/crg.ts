import { execSync, spawn, type ChildProcess, type SpawnOptions } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { createMcpSpawnSpec } from "../mcp/spawn-spec";
import type { McpServerConfig } from "../settings";

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
 * Absolute path of the vendored uv checkout, or `null` when unset. The desktop
 * client sets this at boot to the copy it ships; other hosts leave it unset and
 * rely on a system `uv`/`uvx` on PATH.
 */
let configuredUvVendorRoot: string | null = null;

/** Point the resolver at a vendored uv directory (or clear it with `null`). */
export function configureCrgVendorRoot(root: string | null): void {
  configuredUvVendorRoot = root ? path.resolve(root) : null;
}

/** The currently configured vendored uv root, if any. */
export function getCrgVendorRoot(): string | null {
  return configuredUvVendorRoot;
}

/**
 * How to spawn CRG: the executable (uv binary) plus args that must precede the
 * subcommand, and extra env vars.
 */
export type CrgExecutable = {
  command: string;
  prefixArgs: string[];
  env?: Record<string, string>;
};

/**
 * Resolve the uv binary for the current platform. Prefers the vendored binary;
 * falls back to `uvx` on PATH (system uv install); last resort `uvx` bare
 * (hopes it's on PATH).
 */
export function resolveUvBinary(): string | null {
  // 1. Vendored uv binary.
  if (configuredUvVendorRoot) {
    const uvPath = resolveVendoredUvPath(configuredUvVendorRoot);
    if (uvPath) {
      return uvPath;
    }
  }
  // 2. System uv on PATH.
  try {
    const found = execSync(process.platform === "win32" ? "where uv" : "which uv", {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (found) {
      return found.split("\n")[0].trim();
    }
  } catch {
    // uv not on PATH.
  }
  return null;
}

/** Locate the vendored uv binary inside the vendor root for the current platform. */
function resolveVendoredUvPath(vendorRoot: string): string | null {
  const { platform, arch } = process;
  let target: string;
  if (platform === "darwin") {
    target = arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  } else if (platform === "linux") {
    target = arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  } else if (platform === "win32") {
    target = arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  } else {
    return null;
  }

  const binaryName = platform === "win32" ? "uv.exe" : "uv";

  // uv release archives extract to uv-<target>/uv<ext>, then our vendor layout
  // places that under vendor/uv/<target>/. The tarball nests under uv-<target>/.
  // Actual layout: vendor/uv/<target>/uv-<target>/uv
  const candidates = [
    path.join(vendorRoot, target, `uv-${target}`, binaryName),
    path.join(vendorRoot, target, "uv", binaryName),
    path.join(vendorRoot, target, binaryName),
    path.join(vendorRoot, `uv-${target}`, binaryName),
    path.join(vendorRoot, binaryName),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Not found — try next candidate.
    }
  }
  return null;
}

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
  // `--from code-review-graph` pins the package providing the entry point.
  return {
    command: uvBin,
    prefixArgs: ["tool", "run", "--from", CRG_PACKAGE, "code-review-graph"],
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

type CrgChild = {
  once(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  unref(): void;
};

type CrgSpawn = (
  command: string,
  args: string[],
  options: Pick<SpawnOptions, "cwd" | "detached" | "env" | "stdio" | "shell" | "windowsHide">
) => CrgChild;

/** Spawn a CRG subcommand as a detached, output-ignoring child. Throws on spawn failure. */
function spawnCrg(projectRoot: string, subcommand: string[], spawnProcess: CrgSpawn): CrgChild {
  const exe = resolveCrgExecutable();
  if (!exe) {
    throw new Error("uv binary not available — cannot spawn code-review-graph");
  }
  const spec = createMcpSpawnSpec(exe.command, [...exe.prefixArgs, ...subcommand]);
  const env = exe.env && Object.keys(exe.env).length > 0 ? { ...process.env, ...exe.env } : process.env;
  const options = {
    cwd: projectRoot,
    detached: process.platform !== "win32",
    env,
    stdio: "ignore" as const,
    shell: spec.shell,
    windowsHide: spec.windowsHide,
  };
  return spawnProcess(spec.command, spec.args, options);
}

/**
 * Run `code-review-graph build` for a project as a fire-and-forget subprocess.
 * `build` creates the `.code-review-graph/` directory and constructs the graph.
 */
export function runCrgBuild(projectRoot: string, spawnProcess: CrgSpawn = spawn as unknown as CrgSpawn): void {
  try {
    const child = spawnCrg(projectRoot, ["build"], spawnProcess);
    child.once("error", () => {
      // Ignore — best-effort background command.
    });
    child.unref();
  } catch {
    // Ignore spawn failures.
  }
}

/** Spawn a CRG subcommand with piped stdio for output capture. */
export function spawnCrgPiped(projectRoot: string, subcommand: string[]): ChildProcess | null {
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
export function runCrgBuildWithOutput(
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

// ── Incremental sync (fire-and-forget) ───────────────────────────────────────

const inFlightSyncs = new Set<string>();

/**
 * Run `code-review-graph build` (incremental) as a fire-and-forget subprocess
 * to refresh the graph after code changes. No-ops when the project is not
 * CRG-enabled, and coalesces overlapping syncs per project. Failures swallowed.
 */
export function runCrgSync(projectRoot: string, spawnProcess: CrgSpawn = spawn as unknown as CrgSpawn): void {
  if (!hasCrgProject(projectRoot)) {
    return;
  }
  const key = path.resolve(projectRoot);
  if (inFlightSyncs.has(key)) {
    return;
  }
  try {
    inFlightSyncs.add(key);
    const child = spawnCrg(projectRoot, ["build"], spawnProcess);
    const clear = () => inFlightSyncs.delete(key);
    child.once("error", clear);
    child.once("exit", clear);
    child.unref();
  } catch {
    inFlightSyncs.delete(key);
    // Ignore sync failures.
  }
}
