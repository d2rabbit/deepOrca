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
let configuredModelDir: string | null = null;

/**
 * Point the loader at the vendored embedding model directory.
 *
 * Same host-injection pattern as configureCodegraphVendorRoot /
 * configureCrgVendorRoot / configureSerenaUvResolver: only the host knows its own
 * layout (repo checkout vs packaged `Resources/app/vendor`), so core does not try
 * to derive it from `__dirname`. The desktop main process calls this at boot.
 */
export function configureRoutingModelDir(dir: string | null): void {
  configuredModelDir = dir;
}

/** The model directory injected by the host, if any. */
export function getConfiguredRoutingModelDir(): string | null {
  return configuredModelDir;
}

// Optional host logger. Core never calls console.* directly (it must stay
// UI-agnostic), so the host injects one — same pattern as
// configureSkillSpectorLogger.
let logger: ((message: string, detail?: unknown) => void) | null = null;

/** Inject a host logger for routing/embedding diagnostics. */
export function configureRoutingLogger(log: ((message: string, detail?: unknown) => void) | null): void {
  logger = log;
}

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
      // Forward the host logger into the service. This is where a wrong/missing
      // model dir actually shows up: the constructor succeeds and startWarmup()
      // is fire-and-forget, so the failure lands in the service's async warmup
      // (initState="failed") and would otherwise be invisible — which is exactly
      // how a broken vendored path went unnoticed while routing was enabled.
      logger: {
        info: (message: string) => logger?.(message),
        warn: (message: string) => logger?.(message),
        error: (message: string) => logger?.(message),
      },
    }) as unknown as RoutingEmbeddingService;
    shared.startWarmup();
    return shared;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    // Routing fails open by design, but silence made a missing package
    // indistinguishable from "routing is off".
    logger?.(`embedding service unavailable — semantic routing disabled (modelDir: ${opts.modelDir})`, loadError);
    return null;
  }
}

/** Whether the last load attempt failed (for diagnostics). */
export function getEmbeddingLoadError(): string | null {
  return loadError;
}

/**
 * Close the shared embedding service and allow a later reload.
 *
 * The service wraps an onnxruntime-node InferenceSession, which holds native
 * handles and worker threads — without this, they live until the process exits
 * (and keep the event loop alive). The host calls this on app teardown; it is
 * deliberately not called from SessionManager.dispose(), because the service is
 * shared across managers.
 */
export async function closeEmbeddingService(): Promise<void> {
  const service = shared;
  shared = null;
  loadAttempted = false;
  loadError = null;
  if (!service?.close) return;
  try {
    await service.close();
  } catch (err) {
    logger?.("failed to close embedding service", err instanceof Error ? err.message : String(err));
  }
}

/** Reset state (for tests) — including the host-injected model dir, so one test
 *  cannot leak its configuration into the next through this module-level state. */
export function resetEmbeddingLoader(): void {
  shared = null;
  loadAttempted = false;
  loadError = null;
  configuredModelDir = null;
}
