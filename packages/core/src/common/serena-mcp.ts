/**
 * Serena MCP server integration — semantic code retrieval, editing, refactoring.
 *
 * Serena (oraios/serena) is an MCP server that provides IDE-grade symbol-level
 * operations: find symbol, find references, rename, replace symbol body, safe
 * delete — powered by its SolidLSP abstraction over 40+ language servers.
 *
 * It is the **symbol-editing layer** complementing DeepOrca's built-in
 * text-level read/edit tools: simple text changes use the built-in tools;
 * cross-file renames, reference lookups, and symbol-body replacements use Serena.
 *
 * Like CRG, Serena is Python-based and runs through the vendored `uv` binary
 * (shared with CRG). `uvx --python 3.13 serena-agent` auto-provisions an
 * isolated Python 3.13 environment with Serena installed — no host Python needed.
 *
 * Prerequisites: the vendored `uv` binary (or system `uv` on PATH). Individual
 * language servers (Pyright, TypeScript LS, RustAnalyzer, jdtls, etc.) are
 * auto-discovered by Serena's SolidLSP — if a specific LS is missing, that
 * language's tools simply aren't available, but others still work.
 *
 * Docs: https://oraios.github.io/serena/
 * Source: https://github.com/oraios/serena
 */

import { execSync } from "node:child_process";
import type { McpServerConfig } from "../settings";

export const SERENA_MCP_SERVER_NAME = "serena";

// ── Disable flag (host-managed, per project root) ────────────────────────────

import path from "node:path";

const disabledSerenaRoots = new Set<string>();

/** Enable or disable the built-in Serena MCP server for a project root. */
export function setSerenaDisabled(projectRoot: string, disabled: boolean): void {
  const key = path.resolve(projectRoot);
  if (disabled) {
    disabledSerenaRoots.add(key);
  } else {
    disabledSerenaRoots.delete(key);
  }
}

/** True when the built-in Serena MCP server has been disabled for a project root. */
export function isSerenaDisabled(projectRoot: string): boolean {
  return disabledSerenaRoots.has(path.resolve(projectRoot));
}

/** Shared uv binary resolver — reuses the same vendored uv as CRG. */
// We import lazily to avoid a hard dependency on crg.ts when Serena isn't used.
let uvResolver: (() => string | null) | null = null;

/**
 * Set the uv binary resolver. The desktop client calls this at boot, sharing
 * the same vendored uv that CRG uses (configureCrgVendorRoot points at the
 * same `packages/desktop/vendor/uv/` directory).
 */
export function configureSerenaUvResolver(resolver: (() => string | null) | null): void {
  uvResolver = resolver;
}

/** Cached availability check for Serena via uvx. */
let serenaChecked = false;
let serenaAvailable = false;

/**
 * Check whether Serena can be launched — i.e., a `uv` binary is available
 * (vendored or system). The actual Serena package is auto-installed by
 * `uvx` on first use, so we only need to verify uv exists.
 */
export function isSerenaAvailable(): boolean {
  if (serenaChecked) return serenaAvailable;
  serenaChecked = true;

  // 1. Shared uv resolver (set by desktop client, same vendored uv as CRG).
  if (uvResolver) {
    const uv = uvResolver();
    if (uv) {
      serenaAvailable = true;
      return true;
    }
  }

  // 2. System uv on PATH.
  try {
    execSync(process.platform === "win32" ? "where uv" : "which uv", {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    serenaAvailable = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the MCP server config for Serena.
 *
 * Uses `uvx` (uv's npx-equivalent) to run `serena-agent` in an isolated Python
 * 3.13 environment. The `--python 3.13` pin matches Serena's recommendation
 * (uv tool install -p 3.13 serena-agent). `--context ide-assistant` tells
 * Serena to disable its built-in file/search/shell tools (DeepOrca already
 * provides those), exposing only the semantic symbol tools.
 *
 * Returns null when no `uv` binary is available — the caller skips
 * registration so the absence is silent rather than a crash.
 */
export function buildSerenaMcpServerConfig(projectRoot: string): McpServerConfig | null {
  if (!isSerenaAvailable()) {
    return null;
  }

  // Resolve the uv binary path for the command (preferred), or fall back to
  // bare `uvx` (hopes system uv is on PATH).
  const uvBinary = uvResolver?.() ?? null;
  const command = uvBinary ?? "uvx";
  const prefixArgs = uvBinary
    ? ["tool", "run", "--python", "3.13", "serena-agent"]
    : ["--python", "3.13", "serena-agent"];

  return {
    command,
    args: [...prefixArgs, "start-mcp-server", "--context", "ide-assistant", "--project", projectRoot],
  };
}
