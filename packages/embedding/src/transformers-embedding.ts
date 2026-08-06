/**
 * TransformersEmbeddingService — local embedding via transformers.js + ONNX.
 *
 * Uses IBM Granite Embedding 97M multilingual R2 (384-dim, Apache 2.0, 200+
 * languages incl. Chinese) running through @huggingface/transformers
 * (pipelines) with onnxruntime-node as the native inference backend.
 *
 * Contract is intentionally identical to @deeporca/memory's
 * LocalEmbeddingService (node-llama-cpp variant): same state machine, same
 * fail-open semantics, same EmbeddingNotReadyError, so consumers
 * (conversation-search / l1-writer / auto-capture / …) need no changes.
 *
 * Model files are NOT downloaded at runtime — they are vendored at build
 * time (see scripts/vendor-granite.js) into the HF mirror directory layout:
 *   <modelDir>/<org>/<model>/onnx/model_quantized.onnx + tokenizer files
 */

import type { EmbeddingCallOptions, EmbeddingProviderInfo, EmbeddingService, Logger } from "./types.js";
import { EmbeddingNotReadyError } from "./types.js";

const TAG = "[embedding][transformers]";

/** Granite 97M R2 output dimensionality. */
const GRANITE_DIMENSIONS = 384;

/** Default HuggingFace model identifier (org/model). */
const DEFAULT_MODEL_ID = "ibm-granite/granite-embedding-97m-multilingual-r2";

/**
 * Granite task prefixes (model card convention).
 * Queries use "query: ", documents/passages use "passage: ". This asymmetric
 * encoding is the model card recommendation and produces better separation
 * (lower cosine for unrelated pairs) than symmetric passage-only encoding.
 */
const QUERY_PREFIX = "query: ";
const PASSAGE_PREFIX = "passage: ";

/**
 * Granite has a 32K token context. As a safe character-based heuristic we
 * cap at 2048 chars (≈ 700-1400 tokens for CJK / 500 tokens for Latin),
 * which covers memory fragments comfortably.
 */
const MAX_INPUT_CHARS = 2048;

/** Batch size for embedBatch — transformers.js supports true batched encode. */
const MAX_BATCH = 16;

// ============================
// Config
// ============================

export interface TransformersEmbeddingConfig {
  /**
   * Root directory of the HF mirror layout. transformers.js will look for
   * `<modelDir>/<modelId>/onnx/model_quantized.onnx` and tokenizer files.
   * In the desktop app this is the vendored path
   * (…/vendor/granite-embedding). For tests it can be a local download dir.
   */
  modelDir: string;
  /** Model identifier, defaults to Granite 97M R2. */
  modelId?: string;
  /**
   * Quantization dtype (transformers.js v4 uses `dtype`, not `quantized`).
   * Defaults to "q8" (model_quantized.onnx, int8). Use "fp32" for full
   * precision or "q4" for a smaller footprint.
   */
  dtype?: "q8" | "int8" | "fp16" | "fp32" | "q4";
  /** Logger (structured like console). Optional. */
  logger?: Logger;
}

// ============================
// Helpers (mirrors memory's embedding.ts)
// ============================

/**
 * Sanitize NaN/Inf values and L2-normalize the vector.
 * Copied verbatim from @deeporca/memory's sanitizeAndNormalize so that
 * sqlite-vec cosine distance behaves identically across providers.
 */
function sanitizeAndNormalize(vec: number[] | Float32Array): Float32Array {
  const arr = Array.from(vec).map((v) => (Number.isFinite(v) ? v : 0));
  const magnitude = Math.sqrt(arr.reduce((sum, v) => sum + v * v, 0));
  if (magnitude < 1e-10) {
    return new Float32Array(arr);
  }
  return new Float32Array(arr.map((v) => v / magnitude));
}

/**
 * Initialization state machine — identical states to LocalEmbeddingService.
 * - "idle":         not started yet
 * - "initializing": model load is in progress (background)
 * - "ready":        model is loaded and ready to serve
 * - "failed":       initialization failed (will retry on next startWarmup)
 */
type InitState = "idle" | "initializing" | "ready" | "failed";

/**
 * Minimal shape of a transformers.js feature-extraction pipeline.
 * Kept loose (unknown) to avoid coupling to a specific library version's
 * exact types; we only call .() and read .tolist() / .data.
 */
interface FeatureExtractionPipeline {
  (
    input: string | string[],
    options?: {
      pooling?: "mean" | "max" | "cls";
      normalize?: boolean;
    }
  ): Promise<{ data: Float32Array | number[]; tolist?: () => number[][] }>;
  dispose?: () => void;
}

// ============================
// Service
// ============================

export class TransformersEmbeddingService implements EmbeddingService {
  private readonly modelDir: string;
  private readonly modelId: string;
  private readonly dtype: "q8" | "int8" | "fp16" | "fp32" | "q4";
  private readonly logger?: Logger;

  // Initialization state machine
  private initState: InitState = "idle";
  private initPromise: Promise<void> | null = null;
  private initError: Error | null = null;
  private extractor: FeatureExtractionPipeline | null = null;

  constructor(config: TransformersEmbeddingConfig) {
    this.modelDir = config.modelDir;
    this.modelId = config.modelId?.trim() || DEFAULT_MODEL_ID;
    this.dtype = config.dtype ?? "q8";
    this.logger = config.logger;
  }

  getDimensions(): number {
    return GRANITE_DIMENSIONS;
  }

  getProviderInfo(): EmbeddingProviderInfo {
    return { provider: "local-onnx", model: this.modelId };
  }

  /**
   * Whether the model is fully loaded and ready to serve requests.
   */
  isReady(): boolean {
    return this.initState === "ready" && this.extractor !== null;
  }

  /**
   * Start background warmup: load the ONNX model into memory via
   * transformers.js. Does NOT block the caller — returns immediately.
   * Safe to call multiple times (idempotent); re-triggers on "failed" state.
   */
  startWarmup(): void {
    if (this.initState === "initializing" || this.initState === "ready") {
      return; // already in progress or done
    }
    this.logger?.info(`${TAG} Starting background warmup for Granite embedding (model=${this.modelId})...`);
    this.initState = "initializing";
    this.initError = null;

    this.initPromise = this._doInitialize()
      .then(() => {
        this.initState = "ready";
        this.logger?.info(`${TAG} Background warmup complete — Granite embedding ready (dims=${GRANITE_DIMENSIONS})`);
      })
      .catch((err) => {
        this.initState = "failed";
        this.initError = err instanceof Error ? err : new Error(String(err));
        this.logger?.error(
          `${TAG} Background warmup failed: ${this.initError.message}. ` +
            `embed() calls will throw EmbeddingNotReadyError until retried.`
        );
      });
  }

  /**
   * Get embedding for a single text.
   * @throws {EmbeddingNotReadyError} if model is not yet ready.
   */
  async embed(text: string, _options?: EmbeddingCallOptions): Promise<Float32Array> {
    this.assertReady();
    const truncated = this.truncateInput(text);
    const output = await this.extractor!(PASSAGE_PREFIX + truncated, {
      pooling: "mean",
      normalize: true,
    });
    return sanitizeAndNormalize(output.data);
  }

  /**
   * Get embedding for a search query (uses "query:" prefix per Granite model card).
   * Use this for retrieval queries; use embed()/embedBatch() for documents/passages.
   * @throws {EmbeddingNotReadyError} if model is not yet ready.
   */
  async embedQuery(text: string, _options?: EmbeddingCallOptions): Promise<Float32Array> {
    this.assertReady();
    const truncated = this.truncateInput(text);
    const output = await this.extractor!(QUERY_PREFIX + truncated, {
      pooling: "mean",
      normalize: true,
    });
    return sanitizeAndNormalize(output.data);
  }

  /**
   * Get embeddings for multiple texts (batched, MAX_BATCH per call).
   * @throws {EmbeddingNotReadyError} if model is not yet ready.
   */
  async embedBatch(texts: string[], _options?: EmbeddingCallOptions): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    this.assertReady();

    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const chunk = texts.slice(i, i + MAX_BATCH).map((t) => PASSAGE_PREFIX + this.truncateInput(t));
      const output = await this.extractor!(chunk, { pooling: "mean", normalize: true });
      // transformers.js returns a 2-D tensor; tolist() gives number[][].
      if (typeof output.tolist === "function") {
        for (const vec of output.tolist()) {
          results.push(sanitizeAndNormalize(vec));
        }
      } else {
        // Fallback: flat data array, reshape by GRANITE_DIMENSIONS.
        const flat = Array.from(output.data);
        for (let j = 0; j < chunk.length; j++) {
          const start = j * GRANITE_DIMENSIONS;
          results.push(sanitizeAndNormalize(flat.slice(start, start + GRANITE_DIMENSIONS)));
        }
      }
    }
    return results;
  }

  /**
   * Release the ONNX model resources. Safe to call multiple times (idempotent).
   * Resets the state machine to "idle" so the instance can be warmed up again.
   */
  close(): void {
    if (this.extractor) {
      try {
        this.extractor.dispose?.();
      } catch {
        // best-effort cleanup
      }
      this.extractor = null;
      this.initPromise = null;
      this.initState = "idle";
      this.initError = null;
      this.logger?.info(`${TAG} Granite embedding resources released`);
    } else if (this.initState !== "idle") {
      // Also reset state when init failed (extractor never set).
      this.initPromise = null;
      this.initState = "idle";
      this.initError = null;
    }
  }

  /**
   * Wait for ongoing warmup to complete (used internally by tests).
   * Returns immediately if already ready or idle.
   */
  async waitForReady(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  // ============================
  // Internals
  // ============================

  /**
   * Assert the model is ready. Throws EmbeddingNotReadyError if not.
   * Message variants match LocalEmbeddingService for consumer parity.
   */
  private assertReady(): void {
    if (this.initState === "ready" && this.extractor) {
      return;
    }
    if (this.initState === "failed") {
      throw new EmbeddingNotReadyError(
        `Local embedding model initialization failed: ${this.initError?.message ?? "unknown error"}. ` +
          `Call startWarmup() to retry.`
      );
    }
    if (this.initState === "initializing") {
      throw new EmbeddingNotReadyError(
        "Local embedding model is still loading (model initialization in progress). Please try again later."
      );
    }
    // "idle" — startWarmup() was never called
    throw new EmbeddingNotReadyError("Local embedding model warmup has not been started. Call startWarmup() first.");
  }

  /**
   * Truncate input text to stay within a safe context window.
   * Granite has a 32K token limit; we use a character-based heuristic.
   */
  private truncateInput(text: string): string {
    if (text.length <= MAX_INPUT_CHARS) return text;
    this.logger?.debug?.(
      `${TAG} Input truncated from ${text.length} to ${MAX_INPUT_CHARS} chars (model context limit)`
    );
    return text.slice(0, MAX_INPUT_CHARS);
  }

  /**
   * Internal: load the ONNX model via transformers.js.
   * Called by startWarmup(), runs in background.
   */
  private async _doInitialize(): Promise<void> {
    this.logger?.debug?.(`${TAG} Loading transformers.js (dynamic import)...`);
    // Dynamic import — keeps transformers.js + onnxruntime-node out of the
    // load path when the local-onnx provider is not used.
    const { pipeline, env } = await import("@huggingface/transformers");

    // Point transformers.js at our vendored model directory and disable
    // remote fetching — model files are bundled at build time.
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = this.modelDir;
    env.useFS = true;

    this.logger?.debug?.(
      `${TAG} Creating feature-extraction pipeline (model=${this.modelId}, modelDir=${this.modelDir}, dtype=${this.dtype})...`
    );

    this.extractor = (await pipeline("feature-extraction", this.modelId, {
      dtype: this.dtype,
      local_files_only: true,
    })) as unknown as FeatureExtractionPipeline;
  }
}
