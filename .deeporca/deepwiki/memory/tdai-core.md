---
type: package
title: vendored TDAI Core fork
description: memory/src/tdai/ 是完全自包含的 TDAI Core fork（约 1.7 万行，MIT），不 import 上游 npm 包；本页说明其结构、集成点与依赖边界。
tags: [tdai, vendored, memory, notice]
---

# vendored TDAI Core fork

`packages/memory/src/tdai/` 是 **TDAI Core（TencentDB Agent Memory）的完全自包含 fork**：约 1.7 万行，MIT 协议，版权归属见 `memory/src/NOTICE.md`（上游 TencentDB 团队致谢）。**它不 import 上游 npm 包**——保持 fork 自包含是防止上游发布漂移的关键决策。

## 依赖边界（重要）

- `@tencentdb-agent-memory/tcvdb-text` 是**不同的包**，是活运行时依赖（BM25，静态 import 且默认开启）——**不可移除**（AGENTS.md 明确）。
- `sqlite-vec`（0.1.7-alpha.2）：向量存储。
- `@node-rs/jieba`：中文分词（BM25 zh）。
- `js-tiktoken`：token 计数。
- `json5`、`yaml`、`zod`：配置与解析。

## 目录结构

| 路径 | 内容 |
| --- | --- |
| `tdai/core/` | `tdai-core.ts`（TdaiCore 门面）、`types.ts`（HostAdapter/LLMRunner/RecallResult/CaptureResult/CompletedTurn 等抽象）、流水线核心 |
| `tdai/config.ts`（27.8KB） | `parseConfig` 官方配置解析器（所有必填子字段带校验默认） |
| `tdai/types/` | 领域类型 |
| `tdai/utils/` | `memory-cleaner.js`（保留清理）、best-effort、其他工具 |
| `tdai/NOTICE.md` | 上游版权与归属 |

## 集成点（memory 包外部）

- `MemoryManager`（[overview](overview.md)）构造 `new TdaiCore({ hostAdapter, config, graniteModelDir })` → `initialize()`。
- `DeepOrcaHostAdapter` 实现 `HostAdapter`/`LLMRunner`（LLM 调用桥 + embedding 桥 + runner 工具）。
- `LocalMemoryCleaner` 从 `tdai/utils/memory-cleaner.js` 导入（保留策略）。
- 配置装配必须走 `parseConfig`——早期手拼部分对象并 `as unknown as MemoryTdaiConfig` 导致 pipeline/store 读到 undefined timeouts/embedding dimensions/dedup 设置，可能产生 NaN 延迟或紧循环（memory-manager.ts 注释明确此教训）。

## 修改指南

- 优先改 `memory-manager.ts`/`adapter.ts` 外壳，少动 fork 内部；需要修 fork 时保持与上游 API 形状兼容（`TdaiCore`/`parseConfig`/store 接口）。
- fork 内部改动需在 `memory/src/NOTICE.md` 或提交信息中保留归属说明（license 门禁：`npm run license:check`）。
- 文件级归属：13 个上游继承引擎文件已补 `Portions Copyright` 头（commit 09758230）。

## 聚焦测试

- `store-cache.test.ts`、`capture.test.ts`、`runner-toolloop.test.ts`（TdaiCore 行为经 MemoryManager 透测）。
- 全量：`node packages/memory/src/tests/run-tests.mjs`。
