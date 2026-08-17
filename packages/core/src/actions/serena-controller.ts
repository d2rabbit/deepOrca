/**
 * SerenaController — the Seam for Serena MCP server operations.
 *
 * Serena (oraios/serena) provides IDE-grade symbol-level semantic code operations
 * (find symbol, find references, rename, replace symbol body) via SolidLSP (40+ languages).
 *
 * Only the spawn/config logic (uv command assembly, SERENA_HOME management, version pinning)
 * is host-specific. Core calls this seam to get the MCP server spawn config; Desktop injects
 * SerenaCliController which knows how to assemble the uvx command.
 */

import type { McpServerConfig } from "../settings";

export interface SerenaController {
  /**
   * Build the MCP server spawn config for a project root.
   * Returns null when Serena is unavailable (no uv binary).
   */
  buildMcpServerConfig(root: string): McpServerConfig | null;

  /** Whether Serena (uv + serena-agent) is available on this system. */
  isAvailable(): boolean;
}

let controller: SerenaController | null = null;

export function configureSerenaController(c: SerenaController | null): void {
  controller = c;
}

export function getSerenaController(): SerenaController | null {
  return controller;
}
