# @deeporca/embedding

Local text embedding for DeepOrca, powered by **transformers.js** + **onnxruntime-node**.

Default model: **IBM Granite Embedding 97M multilingual R2** (384-dim, Apache 2.0,
200+ languages incl. Chinese). Structurally compatible with `@deeporca/memory`'s
`EmbeddingService` contract — the memory package consumes it via dynamic import
when `embedding.provider = "local-onnx"`.

## Quick start

```bash
# 1. Vendor the model (build time; uses hf-mirror fallback)
node scripts/vendor-granite.js

# 2. Smoke test
node scripts/test-embedding.mjs

# 3. Wire into memory recall
#    Pass to MemoryManager: { embedding: { provider: "local-onnx" }, graniteModelDir: "<vendor path>" }
```

## Architecture

- `TransformersEmbeddingService` mirrors `@deeporca/memory`'s
  `LocalEmbeddingService` contract: same state machine (`idle → initializing →
  ready | failed`), same `EmbeddingNotReadyError`, same fail-open semantics.
  Consumers (conversation-search, l1-writer, auto-capture) need no changes.
- Model files are **vendored at build time** (`scripts/vendor-granite.js` →
  `packages/desktop/vendor/granite-embedding/`), NOT downloaded at runtime.
- `startWarmup()` is idempotent and non-blocking; `embed()` throws
  `EmbeddingNotReadyError` until ready (caught by all callers → BM25/FTS fallback).

## Tests

```bash
# Contract + fail-open (no model needed, always runs)
node src/tests/run-tests.mjs

# Real model smoke (requires vendored model, CI skips)
DEEPORCA_TEST_EMBEDDING=1 \
DEEPORCA_EMBEDDING_MODEL_DIR=../../packages/desktop/vendor/granite-embedding \
node --import tsx --test src/tests/transformers-embedding.test.ts
```

## Notes

- Granite's absolute cosine values are naturally high; the recall system uses
  RRF ranking + topK, not absolute thresholds, so this is fine.
- The vendored ONNX is `model_quint8_avx2.onnx` (98MB) renamed to
  `model_quantized.onnx` for transformers.js `dtype: "q8"` compatibility.
