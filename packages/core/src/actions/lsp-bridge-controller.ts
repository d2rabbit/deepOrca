/**
 * LspBridgeController — the seam for the LSP diagnostics bridge (specs/
 * lsp-diagnostics P0-1, mirrored on SerenaController).
 *
 * The bridge hosts real language servers (typescript-language-server first)
 * behind ONE MCP tool, `get_diagnostics`, so the post-edit diagnostics loop
 * gains type-level coverage alongside Serena's syntax/symbol level.
 *
 * Only the spawn/config decision is host-specific: whether the bundled bridge
 * server entry exists, whether language servers can be resolved, and whether
 * the user enabled `lspDiagnostics` in settings (default OFF — trusted
 * projects only, fail-open to Serena-only). Core reads the seam; Desktop
 * injects the implementation.
 */

import type { McpServerConfig } from "../settings";

export interface LspBridgeController {
  /**
   * Build the MCP server spawn config for a project root.
   * Returns null when the bridge is unavailable OR disabled in settings
   * (`lspDiagnostics.enabled` defaults to false).
   */
  buildMcpServerConfig(root: string): McpServerConfig | null;

  /** Whether the bridge server entry + a language-server runtime resolve. */
  isAvailable(): boolean;
}

let controller: LspBridgeController | null = null;

export function configureLspBridgeController(c: LspBridgeController | null): void {
  controller = c;
}

export function getLspBridgeController(): LspBridgeController | null {
  return controller;
}
