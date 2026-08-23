---
type: package
title: "@deeporca/embedding 本地嵌入"
description: transformers.js + onnxruntime-node 的本地嵌入服务（IBM Granite 97M R2，384 维），共享单例生命周期与 EmbeddingService 契约。
tags: [embedding, onnx, granite, transformers]
---

# "@deeporca/embedding" 本地嵌入

`@deeporca/embedding` 提供本地嵌入能力：**transformers.js + onnxruntime-node**，默认模型 IBM Granite Embedding 97M multilingual R2（384 维）。被 core 的语义路由（[core/routing](../core/routing.md)）与 memory 的向量召回（`local-onnx` provider）消费。

## 入口与导出

- `src/index.ts`：`TransformersEmbeddingService`、`acquireSharedEmbeddingService`/`SharedEmbeddingRef`、类型（`EmbeddingService`/`EmbeddingCallOptions`/`EmbeddingNotReadyError` 等）。
- `src/transformers-embedding.ts`（13.3KB）：transformers.js 实现。
- `src/shared.ts`（4.5KB）：共享单例注册表。
- `src/types.ts`（3.2KB）：`EmbeddingService` 契约——与 `@deeporca/memory` 的 EmbeddingService 契约结构兼容。

## EmbeddingService 契约（`types.ts`）

```ts
interface EmbeddingService {
  embed(texts: string[], options?: EmbeddingCallOptions): Promise<Float32Array[]>;
  getProviderInfo(): EmbeddingProviderInfo;
  // …
}
```

- 模型未就绪时抛 `EmbeddingNotReadyError`（调用方 fail-open）。
- `Logger` 接口：宿主注入日志（core 的 `configureRoutingLogger` 模式）。

## 共享单例（`shared.ts`）

- `acquireSharedEmbeddingService(config)`：进程级单例注册表，返回 `SharedEmbeddingRef`（**引用计数**：同 modelDir 多次 acquire 共享一个底层服务，每次 release 减一；**最后一次 release 才真正关闭**，每个句柄 `close()` 幂等；**不同 modelDir 永不共享**——`shared-registry.test.ts` 断言）。
- **为什么需要共享**：onnxruntime-node 持有原生句柄；core 的 embedding-loader 与 memory 的向量存储若各建一个实例，会重复加载 ~118MB Granite 模型并持有两份原生资源。core 关闭时 `closeEmbeddingService()` 释放（[core/routing](../core/routing.md)）。
- 不做急切创建：调用方保持 fail-open try/catch。

## 生命周期与加载

- **初始化状态机**：`idle → initializing → ready | failed`；`startWarmup` 幂等；`close()` 复位 failed → idle 以便再次 warmup 重试；初始化中 `close()` 不会让迟到的 init「复活」到 ready（`transformers-embedding.test.ts` 断言）。
- **非对称任务前缀**：query 用 `query: `、passage 用 `passage: `（检索/索引区分）；`MAX_INPUT_CHARS = 2048`、`MAX_BATCH = 16`。
- **量化模型**：dtype `"q8"` 映射到 vendored `onnx/model_quantized.onnx`（由 `vendor-granite.js` 从 `model_quint8_avx2.onnx` 重命名）。
- **`sanitizeAndNormalize`**：NaN/Inf → 0，L2 归一化（与 memory provider 的 sqlite-vec 余弦一致）。
- 惰性加载：core 经动态 `import()`（`routing/embedding-loader.ts`）——core 模块加载保持快速，模型缺失/损坏优雅降级。
- 模型目录解析：`DEEPORCA_ROUTING_MODEL_DIR` env → `configureRoutingModelDir()`（宿主注入）→ 仓库相对回退；warmup 是 fire-and-forget。
- 桌面端：vendored `packages/desktop/vendor/granite-embedding/`（HF mirror 布局，~118MB，经 `vendor-granite.js`）。

## 聚焦测试

- `transformers-embedding.test.ts`（7.6KB）：嵌入正确性/维度/错误路径。
- `shared-registry.test.ts`（2.9KB）：单例注册表生命周期（获取/释放/幂等）。
- 运行：`node packages/embedding/src/tests/run-tests.mjs`。

## 相关页面

- [core/routing](../core/routing.md)（消费方）
- [memory/overview](../memory/overview.md)（local-onnx provider）
- [desktop/build-and-vendoring](../desktop/build-and-vendoring.md)（vendor-granite.js）
