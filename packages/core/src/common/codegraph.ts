import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { createMcpSpawnSpec } from "../mcp/mcp-client";
import type { McpServerConfig } from "../settings";

/**
 * CodeGraph integration.
 *
 * CodeGraph (https://github.com/colbymchenry/codegraph) is a local-first code
 * knowledge graph. It stores its index in a project-local `.codegraph/` directory
 * and exposes an MCP server (`codegraph serve --mcp`) plus an incremental index
 * updater (`codegraph sync <path>`).
 *
 * CodeGraph ships as a Node/TypeScript package: its CLI entry compiles to
 * `dist/bin/codegraph.js` and runs on plain Node (tree-sitter via WASM), so it can
 * be *vendored* — checked out from source and compiled alongside our own build —
 * and then invoked directly instead of relying on a host-global install. The
 * desktop client vendors CodeGraph under its package (see `scripts/vendor-codegraph.js`)
 * and points the resolver at it via {@link configureCodegraphVendorRoot}. When no
 * vendored build is present we fall back to `npx @colbymchenry/codegraph`, so the
 * feature degrades gracefully rather than breaking.
 *
 * The integration is deliberately *project-scoped*: nothing is registered as a
 * host-global binary or environment variable, and a project only participates when
 * it already contains a `.codegraph/` directory (created once via `codegraph init`),
 * so the index and knowledge base always follow the project.
 */

/** npm package that provides the `codegraph` CLI + MCP server. Used for the npx fallback. */
export const CODEGRAPH_PACKAGE = "@colbymchenry/codegraph";

/** Name under which the CodeGraph MCP server is registered. */
export const CODEGRAPH_MCP_SERVER_NAME = "codegraph";

/** Project-local directory that holds the CodeGraph index (SQLite + FTS5). */
export const CODEGRAPH_DIR_NAME = ".codegraph";

/** Relative path, inside a vendored CodeGraph checkout, to the compiled CLI entry. */
export const CODEGRAPH_VENDOR_ENTRY = path.join("dist", "bin", "codegraph.js");

/**
 * Absolute path of the vendored CodeGraph checkout, or `null` when unset. The
 * desktop client sets this at boot to the copy it ships; other hosts leave it unset
 * and rely on the npx fallback.
 */
let configuredVendorRoot: string | null = null;

/** Point the resolver at a vendored CodeGraph checkout (or clear it with `null`). */
export function configureCodegraphVendorRoot(root: string | null): void {
  configuredVendorRoot = root ? path.resolve(root) : null;
}

/** The currently configured vendored CodeGraph root, if any. */
export function getCodegraphVendorRoot(): string | null {
  return configuredVendorRoot;
}

/**
 * How to spawn CodeGraph: the executable plus any args that must precede the
 * subcommand (e.g. the JS entry when running through Node), and extra env vars.
 */
export type CodegraphExecutable = {
  command: string;
  prefixArgs: string[];
  env?: Record<string, string>;
};

/** Resolve the compiled CLI entry inside the configured vendor root, if it exists. */
function resolveVendorEntry(): string | null {
  if (!configuredVendorRoot) {
    return null;
  }
  const entry = path.join(configuredVendorRoot, CODEGRAPH_VENDOR_ENTRY);
  try {
    return fs.statSync(entry).isFile() ? entry : null;
  } catch {
    return null;
  }
}

/**
 * Decide how to invoke CodeGraph. Prefers the vendored build (run through the
 * current Node/Electron binary); otherwise falls back to `npx`, which resolves the
 * published package from the registry / local cache without a global install.
 *
 * NOTE: In Electron, `process.execPath` is the Electron binary. Even with
 * ELECTRON_RUN_AS_NODE=1, Electron does NOT insert the script path into argv[1]
 * the way plain Node does — the script path ends up as a positional argument,
 * causing commander to report "unknown command <path>". We therefore skip the
 * vendored path when running inside Electron and fall back to npx (or a system
 * node if available).
 */
export function resolveCodegraphExecutable(): CodegraphExecutable {
  const entry = resolveVendorEntry();
  if (entry && !process.versions.electron) {
    return { command: process.execPath, prefixArgs: [entry] };
  }
  if (entry && process.versions.electron) {
    // In Electron, try to find a system node to run the vendored entry.
    // `process.env.NODE` is sometimes set in dev; otherwise fall through to npx.
    const systemNode = process.env.NODE || findSystemNode();
    if (systemNode) {
      return { command: systemNode, prefixArgs: [entry] };
    }
  }
  return { command: "npx", prefixArgs: ["-y", CODEGRAPH_PACKAGE] };
}

/** Best-effort lookup for a system `node` binary (used in Electron). */
function findSystemNode(): string | null {
  try {
    const { execSync } = require("child_process") as typeof import("child_process");
    const result = execSync(process.platform === "win32" ? "where node" : "which node", {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const first = result.trim().split("\n")[0];
    return first || null;
  } catch {
    return null;
  }
}

/**
 * Per-root opt-out for the built-in CodeGraph MCP server. Hosts (e.g. the desktop
 * plugin module) may disable the built-in without uninstalling it; the disabled
 * flag is consulted by the session's builtin augmentation so a disabled root never
 * auto-registers CodeGraph. Persistence, if any, is the host's concern.
 */
const disabledCodegraphRoots = new Set<string>();

/** Enable or disable the built-in CodeGraph MCP server for a project root. */
export function setCodegraphDisabled(projectRoot: string, disabled: boolean): void {
  const key = path.resolve(projectRoot);
  if (disabled) {
    disabledCodegraphRoots.add(key);
  } else {
    disabledCodegraphRoots.delete(key);
  }
}

/** True when the built-in CodeGraph MCP server has been disabled for a project root. */
export function isCodegraphDisabled(projectRoot: string): boolean {
  return disabledCodegraphRoots.has(path.resolve(projectRoot));
}

/**
 * True when the given project root has been initialized with CodeGraph
 * (i.e. it contains a `.codegraph/` directory). This is the gate that keeps the
 * integration project-scoped — projects opt in by running `codegraph init`.
 */
export function hasCodegraphProject(projectRoot: string): boolean {
  try {
    return fs.statSync(path.join(projectRoot, CODEGRAPH_DIR_NAME)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Build the MCP server configuration for CodeGraph. The command comes from
 * {@link resolveCodegraphExecutable} (vendored build or npx fallback). The `cwd` is
 * pinned to the project root so the server always targets the right project's
 * `.codegraph/` index, even when the host process (e.g. Electron main) runs from a
 * different working directory.
 */
export function buildCodegraphMcpServerConfig(projectRoot: string): McpServerConfig {
  const exe = resolveCodegraphExecutable();
  const config: McpServerConfig = {
    command: exe.command,
    args: [...exe.prefixArgs, "serve", "--mcp"],
    cwd: projectRoot,
  };
  if (exe.env && Object.keys(exe.env).length > 0) {
    config.env = exe.env;
  }
  return config;
}

type CodegraphChild = {
  once(event: string, listener: (error: NodeJS.ErrnoException) => void): unknown;
  unref(): void;
};

type CodegraphSpawn = (
  command: string,
  args: string[],
  options: Pick<SpawnOptions, "cwd" | "detached" | "env" | "stdio" | "shell" | "windowsHide">
) => CodegraphChild;

/** Spawn a CodeGraph subcommand as a detached, output-ignoring child. Throws on spawn failure. */
function spawnCodegraph(projectRoot: string, subcommand: string[], spawnProcess: CodegraphSpawn): CodegraphChild {
  const exe = resolveCodegraphExecutable();
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
 * Run an arbitrary CodeGraph subcommand (e.g. `["init"]`) as a fire-and-forget
 * subprocess. Failures are swallowed — a missing/broken CodeGraph install must never
 * break the session loop.
 */
export function runCodegraphCommand(
  projectRoot: string,
  subcommand: string[],
  spawnProcess: CodegraphSpawn = spawn as unknown as CodegraphSpawn
): void {
  try {
    const child = spawnCodegraph(projectRoot, subcommand, spawnProcess);
    child.once("error", () => {
      // Ignore — best-effort background command.
    });
    child.unref();
  } catch {
    // Ignore spawn failures.
  }
}

/**
 * Run `codegraph init` for a project as a fire-and-forget subprocess. `init` creates
 * the `.codegraph/` directory and builds the full graph.
 */
export function runCodegraphInit(
  projectRoot: string,
  spawnProcess: CodegraphSpawn = spawn as unknown as CodegraphSpawn
): void {
  runCodegraphCommand(projectRoot, ["init"], spawnProcess);
}

/**
 * Run `codegraph sync <projectRoot>` as a fire-and-forget subprocess to update the
 * incremental index after code changes. No-ops when the project is not CodeGraph
 * enabled, and coalesces overlapping syncs per project so at most one runs at a
 * time. Failures are swallowed.
 */
export function runCodegraphSync(
  projectRoot: string,
  spawnProcess: CodegraphSpawn = spawn as unknown as CodegraphSpawn
): void {
  if (!hasCodegraphProject(projectRoot)) {
    return;
  }
  const key = path.resolve(projectRoot);
  if (inFlightSyncs.has(key)) {
    return;
  }

  try {
    inFlightSyncs.add(key);
    const child = spawnCodegraph(projectRoot, ["sync", projectRoot], spawnProcess);
    const clear = () => inFlightSyncs.delete(key);
    child.once("error", clear);
    // Best-effort cleanup once the process settles; ignore if unsupported.
    (child as unknown as { once?: (event: string, cb: () => void) => void }).once?.("exit", clear);
    child.unref();
  } catch {
    inFlightSyncs.delete(key);
    // Ignore sync failures.
  }
}

const inFlightSyncs = new Set<string>();

/**
 * Same as runCodegraphInit but returns a Promise that resolves once the child
 * process exits (success or error). The desktop UI uses this so the "reindex"
 * button can await completion before refreshing the list.
 */
export function runCodegraphInitAsync(projectRoot: string): Promise<void> {
  return runCodegraphCommandAsync(projectRoot, ["init"]);
}

/**
 * Same as runCodegraphSync but returns a Promise that resolves once the child
 * process exits (success or error).
 */
export function runCodegraphSyncAsync(projectRoot: string): Promise<void> {
  if (!hasCodegraphProject(projectRoot)) {
    return Promise.resolve();
  }
  const key = path.resolve(projectRoot);
  if (inFlightSyncs.has(key)) {
    return Promise.resolve();
  }
  inFlightSyncs.add(key);
  return runCodegraphCommandAsync(projectRoot, ["sync", projectRoot]).finally(() => {
    inFlightSyncs.delete(key);
  });
}

/**
 * True reset: remove the `.codegraph/` directory entirely, then run a fresh
 * `codegraph init` to rebuild the index from scratch. The desktop "Reset index"
 * button uses this so the user always gets a clean rebuild regardless of the
 * previous index state or any in-flight syncs.
 */
export async function runCodegraphResetAsync(projectRoot: string): Promise<void> {
  const dir = path.join(projectRoot, CODEGRAPH_DIR_NAME);
  // Clear any in-flight sync guard for this root so the subsequent init is not blocked.
  inFlightSyncs.delete(path.resolve(projectRoot));
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Directory may not exist — that's fine, init will create it.
  }
  await runCodegraphCommandAsync(projectRoot, ["init"]);
}

/**
 * Spawn a CodeGraph subcommand with piped stdio so the caller can capture
 * stdout/stderr output (e.g. for progress visualization in the desktop UI).
 * Returns the ChildProcess directly — the caller is responsible for handling
 * output and waiting for exit.
 */
export function spawnCodegraphPiped(projectRoot: string, subcommand: string[]): ChildProcess {
  const exe = resolveCodegraphExecutable();
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
 * Reset with live output: removes `.codegraph/`, spawns `codegraph init` with
 * piped stdio, and invokes `onOutput` for each chunk of stdout/stderr. Resolves
 * when the process exits. Used by the desktop UI to visualize indexing progress.
 */
export function runCodegraphResetWithOutput(
  projectRoot: string,
  onOutput: (chunk: string, stream: "stdout" | "stderr") => void
): Promise<number> {
  const dir = path.join(projectRoot, CODEGRAPH_DIR_NAME);
  inFlightSyncs.delete(path.resolve(projectRoot));
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Directory may not exist.
  }
  return new Promise<number>((resolve) => {
    try {
      const cp = spawnCodegraphPiped(projectRoot, ["init"]);
      cp.stdout?.on("data", (d: Buffer) => onOutput(d.toString(), "stdout"));
      cp.stderr?.on("data", (d: Buffer) => onOutput(d.toString(), "stderr"));
      cp.on("error", () => resolve(1));
      cp.on("close", (code) => resolve(code ?? 0));
    } catch {
      resolve(1);
    }
  });
}

/** Fire-and-forget never waited for exit. Async version that does. */
async function runCodegraphCommandAsync(projectRoot: string, subcommand: string[]): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      const cp = spawnCodegraph(projectRoot, subcommand, spawn as unknown as CodegraphSpawn) as unknown as ChildProcess;
      const done = () => resolve();
      cp.on("error", done);
      cp.on("close", done);
    } catch {
      resolve();
    }
  });
}
