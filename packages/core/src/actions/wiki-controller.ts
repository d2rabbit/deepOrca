/**
 * WikiController — the Seam between core's action layer and the actual wiki
 * generation execution (OpenWiki CLI or future alternatives).
 *
 * Core defines this Interface; desktop injects a concrete Adapter
 * (`WikiCliController` that spawns the vendored openwiki CLI). This removes
 * all wiki-specific spawn code from core (same pattern as CodegraphController
 * and ReviewController).
 */

import type { ControllerProgress } from "./codegraph-controller";

export interface WikiResult {
  ok: boolean;
  model?: string;
  skipped?: boolean;
  /** Non-fatal outcome note (e.g. the CLI marker recorded status
   *  "interrupted" — pages exist but the landing page may be unfinalized;
   *  the next incremental build completes it). Surfaced to the build log. */
  warning?: string;
}

export interface WikiController {
  /** Full wiki generation (first time). */
  init(root: string, onProgress?: (p: ControllerProgress) => void): Promise<WikiResult>;
  /** Incremental wiki update (diff-based). */
  update(root: string, onProgress?: (p: ControllerProgress) => void): Promise<WikiResult>;
  /** True when the vendored openwiki CLI is available. */
  isAvailable(): boolean;
}

let controller: WikiController | null = null;

export function configureWikiController(c: WikiController | null): void {
  controller = c;
}

export function getWikiController(): WikiController | null {
  return controller;
}
