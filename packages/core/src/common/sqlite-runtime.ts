/**
 * Node-runtime resolution for tools that need `node:sqlite` or a minimum Node
 * major version (e.g. GitMCP's stdio server, OpenWiki CLI).
 *
 * Extracted from `common/codegraph.ts` so that CodeGraph's tool-specific code
 * can migrate to desktop without breaking GitMCP, which shares this resolver.
 * This module is neutral infrastructure — no tool-specific knowledge.
 */

import { execFileSync } from "child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

/**
 * SECURITY (scan fix, CWE-78): node candidates may originate from env vars
 * (`process.env.NODE`) or PATH-lookup output. Before any candidate can reach a
 * child-process spawn it must be an existing absolute `node`/`node.exe`
 * binary with no traversal segments — spawns below stay argv-form with this
 * sanitizer between the external value and the sink.
 */
function isSafeNodeBinary(bin: string): boolean {
  if (!bin || !path.isAbsolute(bin)) return false;
  if (bin.split(/[\\/]/).includes("..")) return false;
  const base = path.basename(bin).toLowerCase();
  if (base !== "node" && base !== "node.exe") return false;
  try {
    return fs.existsSync(bin);
  } catch {
    return false;
  }
}

const moduleRequire = createRequire(import.meta.url);

/**
 * How to spawn a JS entry: the executable plus any args that must precede the
 * subcommand (e.g. the JS entry when running through Node), and extra env vars.
 */
export type CodegraphExecutable = {
  command: string;
  prefixArgs: string[];
  env?: Record<string, string>;
};

/**
 * Resolve a Node runtime capable of loading `node:sqlite` for a JS entry file.
 * Used by GitMCP's stdio MCP server (which uses node:sqlite internally).
 *
 * Resolution order:
 * 1. Electron's bundled Node (when ELECTRON_RUN_AS_NODE works + has node:sqlite)
 * 2. The current process's own Node (when it has node:sqlite)
 * 3. A system Node 22.5–24.x found on PATH / fixed locations / version managers
 *
 * Returns `null` when no suitable runtime exists.
 */
export function resolveSqliteRuntimeForEntry(entry: string): CodegraphExecutable | null {
  if (process.versions.electron && selfNodeHasSqlite()) {
    return { command: process.execPath, prefixArgs: [entry], env: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  if (!process.versions.electron && selfNodeHasSqlite()) {
    return { command: process.execPath, prefixArgs: [entry] };
  }
  const systemNode = resolveSqliteCapableNode();
  if (systemNode) {
    const exe: CodegraphExecutable = { command: systemNode.bin, prefixArgs: [entry] };
    if (systemNode.needsFlag) {
      exe.env = { NODE_OPTIONS: "--experimental-sqlite" };
    }
    return exe;
  }
  return null;
}

function selfNodeHasSqlite(): boolean {
  try {
    moduleRequire("node:sqlite");
    return parseInt(process.versions.node, 10) < 25;
  } catch {
    return false;
  }
}

type SqliteCapableNode = { bin: string; needsFlag: boolean };

let cachedSqliteNode: SqliteCapableNode | null | undefined;

function resolveSqliteCapableNode(): SqliteCapableNode | null {
  if (cachedSqliteNode === undefined) {
    cachedSqliteNode = findSqliteCapableNode();
  }
  return cachedSqliteNode;
}

function findSqliteCapableNode(): SqliteCapableNode | null {
  for (const bin of listNodeCandidates()) {
    const support = probeNodeSqlite(bin);
    if (support) {
      return { bin, needsFlag: support === "flag" };
    }
  }
  return null;
}

function listNodeCandidates(): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (bin: string | undefined | null): void => {
    if (!bin || seen.has(bin)) return;
    // SECURITY (scan fix): validate env/PATH-derived executables before they
    // become spawn candidates (see isSafeNodeBinary).
    if (!isSafeNodeBinary(bin)) return;
    seen.add(bin);
    candidates.push(bin);
  };

  push(process.env.NODE);

  try {
    // argv-form PATH lookup — no shell string is assembled from external data.
    const result =
      process.platform === "win32"
        ? execFileSync("where", ["node"], {
            encoding: "utf8",
            timeout: 3000,
            stdio: ["ignore", "pipe", "ignore"],
          })
        : execFileSync("which", ["-a", "node"], {
            encoding: "utf8",
            timeout: 3000,
            stdio: ["ignore", "pipe", "ignore"],
          });
    for (const line of result.trim().split("\n")) {
      push(line.trim());
    }
  } catch {
    // PATH lookup failed.
  }

  if (process.platform !== "win32") {
    const home = process.env.HOME || "";
    push("/opt/homebrew/bin/node");
    push("/usr/local/bin/node");
    push("/usr/bin/node");
    if (home) push(path.join(home, ".volta", "bin", "node"));
  }

  for (const bin of listVersionManagerNodes()) {
    push(bin);
  }
  return candidates;
}

function listVersionManagerNodes(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const isWin = process.platform === "win32";
  const nodeBin = isWin ? "node.exe" : "node";

  const searchDirs: { dir: string; binPath: (entry: string) => string }[] = [];
  if (isWin) {
    const appData = process.env.APPDATA || "";
    if (appData) {
      searchDirs.push({ dir: path.join(appData, "nvm"), binPath: (e) => path.join(e, nodeBin) });
    }
    const localAppData = process.env.LOCALAPPDATA || "";
    if (localAppData) {
      searchDirs.push({
        dir: path.join(localAppData, "fnm", "node-versions"),
        binPath: (e) => path.join(e, "installation", nodeBin),
      });
    }
  } else {
    if (home) {
      searchDirs.push({
        dir: path.join(home, ".nvm", "versions", "node"),
        binPath: (e) => path.join(e, "bin", nodeBin),
      });
    }
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
      // Directory doesn't exist.
    }
  }
  return found;
}

const cachedModernNodes = new Map<number, string | null>();

/**
 * Locate a runtime for vendored Node CLIs that need a minimum Node major
 * (e.g. OpenWiki needs Node 22+ for its ESM/CJS interop support).
 * In Electron we always use the bundled Node (≥43 ships Node 24+).
 */
export function resolveModernNode(minMajor: number): string | null {
  if (process.versions.electron && parseInt(process.versions.node, 10) >= minMajor) {
    return process.execPath;
  }
  if (!process.versions.electron && parseInt(process.versions.node, 10) >= minMajor) {
    return process.execPath;
  }
  const cached = cachedModernNodes.get(minMajor);
  if (cached !== undefined) {
    return cached;
  }
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

function probeNodeMajor(bin: string): number {
  // SECURITY (scan fix): re-validate right before the argv-form spawn — only
  // allowlisted node binaries are ever executed.
  if (!isSafeNodeBinary(bin)) {
    return -1;
  }
  try {
    // Reviewed (security scan): `bin` is validated by isSafeNodeBinary above —
    // an absolute existing node/node.exe with no traversal segments — and the
    // remaining argv is a literal. No shell is involved.
    const out = execFileSync(bin, ["-e", "process.stdout.write(process.version)"], {
      // mimosa-ignore
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

function probeNodeSqlite(bin: string): "ok" | "flag" | null {
  // SECURITY (scan fix): re-validate right before the argv-form spawn — only
  // allowlisted node binaries are ever executed.
  if (!isSafeNodeBinary(bin)) {
    return null;
  }
  const attempt = (args: string[]): boolean => {
    try {
      const out = execFileSync(bin, [...args, "-e", "require('node:sqlite');process.stdout.write(process.version)"], {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const major = parseInt(out.replace(/^v/, ""), 10);
      return Number.isFinite(major) && major < 25;
    } catch {
      return false;
    }
  };
  if (attempt([])) return "ok";
  if (attempt(["--experimental-sqlite"])) return "flag";
  return null;
}
