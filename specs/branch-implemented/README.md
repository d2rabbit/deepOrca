# specs/branch-implemented — 分支实现归档（未合并）

> **历史说明（2026-09-10）**：本区保留未合并 `next/*` 分支的 spec 与实现留痕；tasks 勾选状态不要求与分支同步。**coord-chain 特例**：该快照是 pre-v6 OC1–OC2 技术参考，当前 active spec 已废止“分支合并后转正”路径；它不表示当前分支已实现，也不是当前 UI、共享、数据根、空间治理或 Work Item 要求的来源。
> 本区引用归档根用 `../archive/<name>/`，引用活 spec 用 `../../<name>/`。

| spec | 入区日期 | 分支 | 已实现范围 | 转正条件 |
| --- | --- | --- | --- | --- |
| [coord-chain](./coord-chain/design.md) | 2026-09-03 | `next/coord-chain` | pre-v6 OC1–OC2：Ed25519/X25519+AES-GCM 协议核心、ws 加密传输、ChainNode 建链/重放、mDNS 发现+邀请码、SQLite 视图接线、双节点 e2e | 仅作历史技术参考；active spec 为 `specs/coord-chain/` v7 |
