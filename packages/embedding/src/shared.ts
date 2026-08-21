/**
 * Process-wide shared embedding registry (Phase 3 / T3.1,
 * specs/memory-remediation).
 *
 * Two consumers used to each construct their own TransformersEmbeddingService
 * against the SAME vendored Granite model: core's semantic routing
 * (routing/embedding-loader.ts) and the memory pipeline's sqlite store
 * (tdai/core/store/factory.ts). That meant two onnxruntime InferenceSessions
 * (double native memory, double warmup) and the same user prompt getting
 * embedded twice on a session's first turn. Both live in different packages
 * and must not depend on each other — so the singleton lives HERE, in the
 * leaf package they already share.
 *
 * Semantics:
 * - Keyed by the resolved modelDir: same dir → same underlying service.
 *   Different dirs (e.g. a misconfigured host) get separate services rather
 *   than a wrong-model share.
 * - Reference counting: each acquire() returns a handle whose close()
 *   decrements; the underlying service is only closed when the last holder
 *   releases. close() on a handle is idempotent.
 * - The registry deliberately does NOT create services eagerly — callers
 *   keep their own fail-open try/catch around acquire.
 * - Construction is synchronous and side-effect free (model files are only
 *   touched on startWarmup()/first embed), so acquire is sync.
 */

import * as path from "node:path";
import { TransformersEmbeddingService } from "./transformers-embedding.js";
import type { EmbeddingCallOptions, EmbeddingProviderInfo, Logger } from "./types.js";

interface RegistryEntry {
  service: TransformersEmbeddingService;
  refs: number;
}

const registry = new Map<string, RegistryEntry>();

/**
 * A reference-counted handle onto the shared TransformersEmbeddingService.
 * Every acquire() returns its OWN handle — closing one holder's handle never
 * affects another's (each close() drops exactly one reference).
 */
export class SharedEmbeddingRef {
  private released = false;

  constructor(
    private readonly service: TransformersEmbeddingService,
    private readonly key: string
  ) {}

  getDimensions(): number {
    return this.service.getDimensions();
  }

  getProviderInfo(): EmbeddingProviderInfo {
    return this.service.getProviderInfo();
  }

  isReady(): boolean {
    return this.service.isReady();
  }

  startWarmup(): void {
    this.service.startWarmup();
  }

  async embed(text: string, options?: EmbeddingCallOptions): Promise<Float32Array> {
    return this.service.embed(text, options);
  }

  async embedQuery(text: string, options?: EmbeddingCallOptions): Promise<Float32Array> {
    return this.service.embedQuery(text, options);
  }

  async embedBatch(texts: string[], options?: EmbeddingCallOptions): Promise<Float32Array[]> {
    return this.service.embedBatch(texts, options);
  }

  async waitForReady(): Promise<void> {
    return this.service.waitForReady();
  }

  /**
   * Release this reference. The underlying service (ONNX session) is closed
   * only when the last holder releases. Safe to call more than once.
   */
  async close(): Promise<void> {
    if (this.released) return;
    this.released = true;
    await releaseSharedEmbeddingService(this.key);
  }
}

/**
 * Acquire a shared handle for the model at `modelDir`. Throws iff service
 * construction throws — callers fail-open exactly as they did with direct
 * construction. The first acquirer's logger is kept for the service's
 * lifetime.
 */
export function acquireSharedEmbeddingService(opts: { modelDir: string; logger?: Logger }): SharedEmbeddingRef {
  const key = path.resolve(opts.modelDir);
  const existing = registry.get(key);
  if (existing) {
    existing.refs += 1;
    return new SharedEmbeddingRef(existing.service, key);
  }
  const service = new TransformersEmbeddingService({ modelDir: opts.modelDir, logger: opts.logger });
  registry.set(key, { service, refs: 1 });
  return new SharedEmbeddingRef(service, key);
}

/** Drop one reference; close the underlying service at zero. */
async function releaseSharedEmbeddingService(key: string): Promise<void> {
  const entry = registry.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  registry.delete(key);
  try {
    await entry.service.close();
  } catch {
    // Closing a failed/never-initialized service — nothing to reclaim.
  }
}

/** @internal Clear the registry WITHOUT closing services (test isolation). */
export function __resetSharedEmbeddingRegistryForTests(): void {
  registry.clear();
}
