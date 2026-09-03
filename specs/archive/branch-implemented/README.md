# specs/archive/branch-implemented — 分支实现归档（未合并）

> **口径（2026-09-03 立）**：实现已发生在**未合并的 `next/*` 分支**上的 spec 入本区——spec 文档（requirements/design/tasks）归档留痕，实现进度以分支为准；tasks 勾选状态不要求与分支同步，合并时以分支实况回写。分支合并回主线后 `git mv` 至 `specs/archive/<name>/` 转正式归档。
> 本区引用归档根用 `../<name>/`，引用活 spec 用 `../../../<name>/`。

| spec | 入区日期 | 分支 | 已实现范围 | 转正条件 |
| --- | --- | --- | --- | --- |
| [coord-chain](./coord-chain/design.md) | 2026-09-03 | `next/coord-chain` | OC1–OC2：Ed25519/X25519+AES-GCM 协议核心、ws 加密传输、ChainNode 建链/重放、mDNS 发现+邀请码、SQLite 视图接线、双节点 e2e | 分支合并主线 → 移入 `specs/archive/coord-chain/` |
