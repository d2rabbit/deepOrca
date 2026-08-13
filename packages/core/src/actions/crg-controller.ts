/**
 * CrgController — the Seam for CRG build operations.
 *
 * Only the BUILD step (tree-sitter parsing + graph algorithms) needs Python.
 * Queries go through CrgGraphQuery (Node.js direct SQLite read).
 *
 * Desktop injects CrgCliController (spawns `uv tool run code-review-graph build`).
 */

import type { ControllerProgress } from "./codegraph-controller";

export interface CrgController {
  /** Full rebuild: delete .code-review-graph/ + build from scratch. */
  reindex(root: string, onProgress?: (p: ControllerProgress) => void): Promise<void>;
  /** Incremental sync (only changed files). */
  sync(root: string): Promise<void>;
  /** True when .code-review-graph/ exists. */
  hasProject(root: string): boolean;
}

let controller: CrgController | null = null;

export function configureCrgController(c: CrgController | null): void {
  controller = c;
}

export function getCrgController(): CrgController | null {
  return controller;
}
