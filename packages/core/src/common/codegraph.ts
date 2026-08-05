import { execFileSync, execSync, spawn, type ChildProcess, type SpawnOptions } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "node:module";
import { createMcpSpawnSpec } from "../mcp/spawn-spec";
import type { McpServerConfig } from "../settings";

// CommonJS-style require bound to this module — works in both the ESM dist
// (loaded from node_modules) and bundled outputs, unlike a bare `require`
// which only exists when an esbuild banner injects it.
const moduleRequire = createRequire(import.meta.url);

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
 * Absolute path of the vendored CodeGraph directory, or `null` when unset. The
 * desktop client sets this at boot to the copy it ships; other hosts leave it unset
 * and rely on the npx fallback.
 */
let configuredVendorRoot: string | null = null;

/** Point the resolver at a vendored CodeGraph directory (or clear it with `null`). */
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

/**
 * Resolve the prebuilt CodeGraph binary for the current platform inside the
 * configured vendor root. The prebuilt binary is self-contained (bundled Node
 * 24 + sqlite + app), so it can be executed directly without a host Node runtime.
 *
 * Layout (after vendor-codegraph.js download):
 *   <vendorRoot>/<platform>-<arch>/bin/codegraph      (unix)
 *   <vendorRoot>/<platform>-<arch>/bin/codegraph.exe  (windows)
 *
 * Fallback for legacy source-build vendoring:
 *   <vendorRoot>/dist/bin/codegraph.js  (needs Node runtime — see below)
 */
function resolveVendorExecutable(): CodegraphExecutable | null {
  if (!configuredVendorRoot) return null;

  // 1. Try prebuilt binary (new direct-download approach).
  const platformArch = getPlatformArch();
  if (platformArch) {
    const binaryName = process.platform === "win32" ? "codegraph.exe" : "codegraph";
    // Try several layouts: <root>/<plat>/bin/codegraph, <root>/<plat>/codegraph
    const candidates = [
      path.join(configuredVendorRoot, platformArch, "bin", binaryName),
      path.join(configuredVendorRoot, platformArch, binaryName),
      path.join(configuredVendorRoot, "bin", binaryName),
    ];
    for (const candidate of candidates) {
      try {
        if (fs.statSync(candidate).isFile()) {
          return { command: candidate, prefixArgs: [] };
        }
      } catch {
        // try next
      }
    }
  }

  // 2. Fallback: legacy source-build entry (needs Node + sqlite runtime).
  const legacyEntry = path.join(configuredVendorRoot, CODEGRAPH_VENDOR_ENTRY);
  try {
    if (fs.statSync(legacyEntry).isFile()) {
      const runtime = resolveSqliteRuntimeForEntry(legacyEntry);
      if (runtime) return runtime;
    }
  } catch {
    // not found
  }

  return null;
}

/** Map host platform/arch to CodeGraph's platform-arch identifier. */
function getPlatformArch(): string | null {
  const plat = process.platform;
  const arch = process.arch;
  let platformName: string;
  let archName: string;
  if (plat === "darwin") platformName = "darwin";
  else if (plat === "linux") platformName = "linux";
  else if (plat === "win32") platformName = "win32";
  else return null;
  if (arch === "arm64") archName = "arm64";
  else if (arch === "x64") archName = "x64";
  else return null;
  return `${platformName}-${archName}`;
}

/**
 * Decide how to invoke CodeGraph. Resolution order:
 * 1. npm package (preferred): @colbymchenry/codegraph installed as a
 *    dependency. The npm-shim.js auto-selects the platform binary from
 *    optionalDependencies and runs it on bundled Node 24 (with sqlite).
 * 2. Vendored prebuilt binary (from GitHub Releases download).
 * 3. Legacy source-build entry (needs Node + sqlite runtime).
 * 4. npx fallback (last resort).
 */
export function resolveCodegraphExecutable(): CodegraphExecutable {
  // 1. Try npm package first (like OCR: require.resolve → shim → platform binary).
  // The npm-shim.js is NOT in @colbymchenry/codegraph's `exports` map (only "."
  // and "./package.json" are), so resolving the subpath directly throws
  // ERR_PACKAGE_PATH_NOT_EXPORTED. Resolve the package.json instead — which IS
  // exported — and derive npm-shim.js from its directory.
  try {
    const pkgJsonPath = moduleRequire.resolve("@colbymchenry/codegraph/package.json");
    const shimEntry = path.join(path.dirname(pkgJsonPath), "npm-shim.js");
    if (fs.existsSync(shimEntry)) {
      return {
        command: process.execPath,
        prefixArgs: [shimEntry],
        env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : undefined,
      };
    }
  } catch {
    // npm package not installed — try vendored binary.
  }

  // 2. Vendored prebuilt binary.
  const vendored = resolveVendorExecutable();
  if (vendored) return vendored;

  // 3. npx fallback.
  return { command: "npx", prefixArgs: ["-y", CODEGRAPH_PACKAGE] };
}

/**
 * Resolve how to run a JS entry that needs `node:sqlite` (CodeGraph, the gitmcp
 * server, …). Internal plugins must NEVER depend on the host's external
 * Node/npm/PATH — they run on the runtime that ships inside the app:
 *
 *   1. Electron's bundled Node via ELECTRON_RUN_AS_NODE=1 (Electron ≥43 ships
 *      Node 24+, which has node:sqlite without a flag). This is the primary
 *      path in the desktop app and needs nothing from the host.
 *   2. The host process itself, when running as plain Node with node:sqlite
 *      (the CLI/dev scenario).
 *   3. A sqlite-capable system Node, only as a last-resort fallback for the
 *      plain-Node CLI when the host Node is too old.
 *
 * Returns `null` when no suitable runtime exists.
 */
export function resolveSqliteRuntimeForEntry(entry: string): CodegraphExecutable | null {
  // Electron: always prefer the bundled Node (self-contained, no host dependency).
  if (process.versions.electron && selfNodeHasSqlite()) {
    return { command: process.execPath, prefixArgs: [entry], env: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  // Plain Node host that already has node:sqlite.
  if (!process.versions.electron && selfNodeHasSqlite()) {
    return { command: process.execPath, prefixArgs: [entry] };
  }
  // Last-resort fallback (CLI-only): a sqlite-capable system Node on the host.
  const systemNode = resolveSqliteCapableNode();
  if (systemNode) {
    const exe: CodegraphExecutable = { command: systemNode.bin, prefixArgs: [entry] };
    if (systemNode.needsFlag) {
      // Node 22.5–22.12 ships node:sqlite behind --experimental-sqlite.
      exe.env = { NODE_OPTIONS: "--experimental-sqlite" };
    }
    return exe;
  }
  return null;
}

/** True when the current process's own Node runtime can run CodeGraph
 * (node:sqlite present and below the Node 25+ range CodeGraph hard-blocks). */
function selfNodeHasSqlite(): boolean {
  try {
    moduleRequire("node:sqlite");
    return parseInt(process.versions.node, 10) < 25;
  } catch {
    return false;
  }
}

type SqliteCapableNode = { bin: string; needsFlag: boolean };

/** Cached result of the (relatively expensive) system Node probe. `undefined` = not probed yet. */
let cachedSqliteNode: SqliteCapableNode | null | undefined;

/** Locate (and cache) a system Node binary that can load node:sqlite. */
function resolveSqliteCapableNode(): SqliteCapableNode | null {
  if (cachedSqliteNode === undefined) {
    cachedSqliteNode = findSqliteCapableNode();
  }
  return cachedSqliteNode;
}

/** Probe every candidate Node binary until one proves it can load node:sqlite. */
function findSqliteCapableNode(): SqliteCapableNode | null {
  for (const bin of listNodeCandidates()) {
    const support = probeNodeSqlite(bin);
    if (support) {
      return { bin, needsFlag: support === "flag" };
    }
  }
  return null;
}

/** Collect candidate Node binaries: explicit override, PATH, fixed locations, version managers. */
function listNodeCandidates(): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (bin: string | undefined | null): void => {
    if (!bin || seen.has(bin)) return;
    seen.add(bin);
    try {
      if (fs.existsSync(bin)) candidates.push(bin);
    } catch {
      // Unreadable path — skip.
    }
  };

  // 0. Explicit override (sometimes set in dev environments).
  push(process.env.NODE);

  // 1. Every node on PATH (`which -a` lists all entries, not just the first).
  try {
    const result = execSync(process.platform === "win32" ? "where node" : "which -a node", {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of result.trim().split("\n")) {
      push(line.trim());
    }
  } catch {
    // PATH lookup failed — continue with fixed locations.
  }

  // 2. Common install locations a GUI app's minimal PATH may miss.
  if (process.platform !== "win32") {
    const home = process.env.HOME || "";
    push("/opt/homebrew/bin/node");
    push("/usr/local/bin/node");
    push("/usr/bin/node");
    if (home) push(path.join(home, ".volta", "bin", "node"));
  }

  // 3. Version manager directories (nvm/fnm), newest first.
  for (const bin of listVersionManagerNodes()) {
    push(bin);
  }
  return candidates;
}

/** Scan common Node version manager directories for Node 22+ binaries (newest first). */
function listVersionManagerNodes(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const isWin = process.platform === "win32";
  const nodeBin = isWin ? "node.exe" : "node";

  // Build platform-specific search directories.
  const searchDirs: { dir: string; binPath: (entry: string) => string }[] = [];
  if (isWin) {
    // nvm-windows: %APPDATA%\nvm\v22.x.x\node.exe
    const appData = process.env.APPDATA || "";
    if (appData) {
      searchDirs.push({ dir: path.join(appData, "nvm"), binPath: (e) => path.join(e, nodeBin) });
    }
    // fnm (Windows): %LOCALAPPDATA%\fnm\node-versions\v22.x.x\installation\node.exe
    const localAppData = process.env.LOCALAPPDATA || "";
    if (localAppData) {
      searchDirs.push({
        dir: path.join(localAppData, "fnm", "node-versions"),
        binPath: (e) => path.join(e, "installation", nodeBin),
      });
    }
  } else {
    // nvm: ~/.nvm/versions/node/v22.x.x/bin/node
    if (home) {
      searchDirs.push({
        dir: path.join(home, ".nvm", "versions", "node"),
        binPath: (e) => path.join(e, "bin", nodeBin),
      });
    }
    // fnm: ~/.local/share/fnm/node-versions/v22.x.x/installation/bin/node
    if (home) {
      searchDirs.push({
        dir: path.join(home, ".local", "share", "fnm", "node-versions"),
        binPath: (e) => path.join(e, "installation", "bin", nodeBin),
      });
    }
  }

  const found: string[] = [];
  for (const { dir, binPath } of searchDirs) {
    try {
      const entries = fs
        .readdirSync(dir)
        .filter((d) => {
          const major = parseInt(d.replace(/^v/, ""), 10);
          return Number.isFinite(major) && major >= 22;
        })
        .sort()
        .reverse();
      for (const entry of entries) {
        const bin = binPath(path.join(dir, entry));
        if (fs.existsSync(bin)) {
          found.push(bin);
        }
      }
    } catch {
      // Directory doesn't exist — skip.
    }
  }
  return found;
}

/** Cached results of the generic modern-Node probe, keyed by minimum major. */
const cachedModernNodes = new Map<number, string | null>();

/**
 * Locate a runtime for vendored Node CLIs that need a minimum Node major
 * (e.g. OpenWiki requires Node 22+ for require(esm) in its dependencies).
 * Internal plugins must stay self-contained: in Electron we always use the
 * bundled Node (Electron ≥43 ships Node 24+), never the host's Node.
 * The system-Node probe is only a last-resort fallback for the plain-Node CLI.
 * Returns the binary path, or null when none found.
 */
export function resolveModernNode(minMajor: number): string | null {
  // Electron: always use the bundled Node (self-contained, no host dependency).
  if (process.versions.electron && parseInt(process.versions.node, 10) >= minMajor) {
    return process.execPath;
  }
  // Plain Node host that is already new enough.
  if (!process.versions.electron && parseInt(process.versions.node, 10) >= minMajor) {
    return process.execPath;
  }
  const cached = cachedModernNodes.get(minMajor);
  if (cached !== undefined) {
    return cached;
  }
  // Last-resort fallback (CLI-only): a sufficiently new system Node on the host.
  let found: string | null = null;
  for (const bin of listNodeCandidates()) {
    if (probeNodeMajor(bin) >= minMajor) {
      found = bin;
      break;
    }
  }
  cachedModernNodes.set(minMajor, found);
  return found;
}

/** Return the major version of a Node binary, or -1 when probing fails. */
function probeNodeMajor(bin: string): number {
  try {
    const out = execFileSync(bin, ["-e", "process.stdout.write(process.version)"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const major = parseInt(out.replace(/^v/, ""), 10);
    return Number.isFinite(major) ? major : -1;
  } catch {
    return -1;
  }
}

/**
 * Verify a Node binary is usable for CodeGraph, instead of trusting version
 * numbers alone: it must load node:sqlite AND be below Node 25 — CodeGraph
 * hard-blocks 25+ (V8 turboshaft WASM JIT Zone allocator bug crashes tree-sitter
 * grammar compilation). "ok" = loads directly, "flag" = needs
 * --experimental-sqlite (22.5–22.12), null = unsupported.
 * Uses execFileSync to avoid shell injection via crafted paths.
 */
function probeNodeSqlite(bin: string): "ok" | "flag" | null {
  const attempt = (args: string[]): boolean => {
    try {
      const out = execFileSync(bin, [...args, "-e", "require('node:sqlite');process.stdout.write(process.version)"], {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const major = parseInt(out.replace(/^v/, ""), 10);
      // CodeGraph's own bootstrap rejects Node >= 25 (WASM JIT OOM crash).
      return Number.isFinite(major) && major < 25;
    } catch {
      return false;
    }
  };
  if (attempt([])) return "ok";
  if (attempt(["--experimental-sqlite"])) return "flag";
  return null;
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
  once(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
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
    child.once("exit", clear);
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
      cp.on("error", (err) => {
        onOutput(`\n[Error] Failed to spawn codegraph: ${err.message}\n`, "stderr");
        resolve(1);
      });
      cp.on("close", (code) => resolve(code ?? 0));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onOutput(`\n[Error] Failed to start codegraph: ${message}\n`, "stderr");
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
