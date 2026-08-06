/**
 * @deeporca/embedding — local embedding for DeepOrca.
 *
 * transformers.js + onnxruntime-node, default model IBM Granite Embedding
 * 97M multilingual R2 (384-dim). Structurally compatible with
 * @deeporca/memory's EmbeddingService contract.
 */

export { TransformersEmbeddingService } from "./transformers-embedding.js";
export type { TransformersEmbeddingConfig } from "./transformers-embedding.js";

export {
  EmbeddingNotReadyError,
  type EmbeddingCallOptions,
  type EmbeddingProviderInfo,
  type EmbeddingService,
  type Logger,
} from "./types.js";
