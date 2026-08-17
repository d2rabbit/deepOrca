/**
 * Serena MCP server — disable gate (pure state, stays in core).
 *
 * All spawn/config logic has been migrated to the desktop adapter
 * (SerenaCliController in packages/desktop/src/main/tools/serena-cli.ts).
 * Core accesses it through the SerenaController seam
 * (packages/core/src/actions/serena-controller.ts).
 *
 * This file retains only the server-name constant and the per-project
 * disable flag — the same pattern as setCrgDisabled in crg.ts.
 */

import path from "node:path";

export const SERENA_MCP_SERVER_NAME = "serena";

// ── Disable flag (host-managed, per project root) ────────────────────────────

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
