/**
 * Embedding loader — lazily creates a shared TransformersEmbeddingService.
 *
 * @deeporca/embedding (transformers.js + onnxruntime-node) is a heavy
 * dependency. We load it via dynamic import so that:
 *   1. Core's module load stays fast when routing is disabled.
 *   2. A missing/broken embedding package degrades gracefully (fail-open).
 *
 * The model directory is resolved from the vendored path in the desktop app,
 * or from settings/env for development.
 */

import type { RoutingEmbeddingService } from "./types";

let shared: RoutingEmbeddingService | null = null;
let loadAttempted = false;
let loadError: string | null = null;

export interface EmbeddingLoaderOptions {
  /** HF mirror layout root (e.g. …/vendor/granite-embedding). */
  modelDir: string;
}

/**
 * Get the shared embedding service, creating it on first call.
 * Returns null if the package is unavailable or failed to load — callers
 * must fail-open (return full candidate sets).
 */
export async function getEmbeddingService(opts: EmbeddingLoaderOptions): Promise<RoutingEmbeddingService | null> {
  if (shared) return shared;
  if (loadAttempted) return null; // Don't retry after a failure (restart resets).

  loadAttempted = true;
  try {
    const mod = await import("@deeporca/embedding");
    shared = new mod.TransformersEmbeddingService({
      modelDir: opts.modelDir,
    }) as unknown as RoutingEmbeddingService;
    shared.startWarmup();
    return shared;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    return null;
  }
}

/** Whether the last load attempt failed (for diagnostics). */
export function getEmbeddingLoadError(): string | null {
  return loadError;
}

/** Reset state (for tests). */
export function resetEmbeddingLoader(): void {
  shared = null;
  loadAttempted = false;
  loadError = null;
}
