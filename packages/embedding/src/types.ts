/**
 * Embedding service types for @deeporca/embedding.
 *
 * These interfaces are structurally compatible with the `EmbeddingService`
 * interface defined in `@deeporca/memory` (tdai/core/store/embedding.ts).
 * We deliberately do NOT import from @deeporca/memory here to avoid a
 * workspace cycle (memory depends on embedding, not the reverse). The
 * consumer (memory factory) casts via `as unknown as IEmbeddingService`.
 *
 * If memory's EmbeddingService contract changes, update this file to match.
 */

// ============================
// Types
// ============================

export interface EmbeddingCallOptions {
  /** Override the default timeout for this call (milliseconds). */
  timeoutMs?: number;
}

export interface EmbeddingProviderInfo {
  /** Provider identifier (e.g. "local-onnx", "openai", "deepseek") */
  provider: string;
  /** Model identifier (e.g. "ibm-granite/granite-embedding-97m-multilingual-r2") */
  model: string;
}

export interface EmbeddingService {
  /** Get embedding for a single text */
  embed(text: string, options?: EmbeddingCallOptions): Promise<Float32Array>;
  /** Get embeddings for multiple texts (batched API call) */
  embedBatch(texts: string[], options?: EmbeddingCallOptions): Promise<Float32Array[]>;
  /** Return the configured vector dimensions */
  getDimensions(): number;
  /** Return provider + model identifiers for change detection */
  getProviderInfo(): EmbeddingProviderInfo;
  /**
   * Whether the service is ready to serve embed requests.
   * For local providers, true only after model load completes.
   */
  isReady(): boolean;
  /**
   * Start background warmup (model load).
   * Triggers async initialization without blocking. Safe to call multiple
   * times (idempotent); re-triggers after a failed initialization.
   */
  startWarmup(): void;
  /** Optional: release resources (model memory) on shutdown */
  close?(): void | Promise<void>;
}

/**
 * Error thrown when embed() / embedBatch() is called before the local
 * embedding model has finished loading.
 * Callers should catch this and fall back to keyword-only mode.
 *
 * Structurally compatible with @deeporca/memory's EmbeddingNotReadyError
 * (same name + message shape); consumers catch generically by try/catch
 * without instanceof checks.
 */
export class EmbeddingNotReadyError extends Error {
  constructor(message?: string) {
    super(message ?? "Local embedding model is not ready yet (still loading)");
    this.name = "EmbeddingNotReadyError";
  }
}

// ============================
// Logger interface
// ============================

export interface Logger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}
