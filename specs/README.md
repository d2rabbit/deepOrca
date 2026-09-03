# specs/ — 功能规格目录

> 结构定稿：2026-09-03（全量核对 + 归档整理）。上游权威口径：`docs/features/feature-roadmap.md` §0（逐 spec 终判）；本文只描述 specs/ 目录自身的组织方式与流转规则。

## 目录结构

| 位置 | 含义 | 现有内容 |
| --- | --- | --- |
| `specs/<name>/` | **活跃 spec**（当前版本实施中，或独立设计阶段，且不属于下一版规划区） | [design-systems-advance](./design-systems-advance/design.md)（含并入的 pm-design-v2 工件）· [model-fleet-adaptation](./model-fleet-adaptation/design.md) · [sandbox-next](./sandbox-next/design.md) · android-dev-kit · cad-3d-generation · content-translation · desktop-pet · in-process-multi-driver · ts-native-migration |
| `specs/next-version/` | **第二阶段（下一版）规划区**：已被 [`docs/features/next-version-plan.md`](../docs/features/next-version-plan.md) 主线承接的规划 spec，冻结期后随 `next/*` 启动 | [module-system](./next-version/module-system/design.md)（主线 B）· [doc-wiki](./next-version/doc-wiki/design.md)（主线 D）· [zg-semantic-search](./next-version/zg-semantic-search/design.md)（主线 E） |
| `specs/archive/` | **收官归档**：终判 ✅ 且无未决项，原样保留作为实现依据与历史记录 | 见 [archive/README.md](./archive/README.md)（15 项） |
| `specs/archive/review/` | **审查归档**：主体落地但带待复核项，复核通过后移入 archive/ 根转正 | task-tree-hub · skill-eval |
| `specs/archive/branch-implemented/` | **分支实现归档**：已在未合并的 `next/*` 分支实现，合并后转正式归档 | coord-chain（OC1–OC2 @ `next/coord-chain`） |
| `specs/archive/deprecated/` | **废弃归档**：拍板废弃/失效，保留供溯源 | pre-production（2026-09-03 出口门槛毙掉） |

## 流转口径（2026-09-02 立归档原则，2026-09-03 扩展）

1. **收官归档**：终判 ✅ 且无未决项。2026-09-03 起口径：人工走查类待办（真机手测 / 实机验证 / 打包实测）统一**移交预生产测试清单**后即可归档，不再挡归档。
2. **审查归档**：主体落地但存在待复核项（收尾清单、真实 LLM 对拍、真机走查）→ 先入 `archive/review/`，复核通过转正。
3. **分支实现归档**：实现发生在未合并的 `next/*` 分支 → 入 `archive/branch-implemented/`，分支合并后转正。
4. **废弃归档**：拍板废弃 / 计划失效 → 入 `archive/deprecated/`，保留溯源。
5. **延伸立项**：spec 主体收官但剩余项构成独立工作面时（先例：sandbox → sandbox-next），剩余项移出新 spec，原 spec 收官归档。
6. **合并**：方向被后继方案吸收时（先例：prototype-companion → design-systems-advance；pm-design-v2 → design-systems-advance），以存续方为主，被并方文件作为工件保留在其目录内。
7. 移动一律 `git mv`，specs 内引用同步改写；引用约定：活 spec → 归档件 `../archive/<name>/`，归档件 → 活 spec 按层级 `../../`（archive 根）/ `../../../`（review、branch-implemented、deprecated），next-version 归 archive 同理。

## 根目录废弃候选（已判定废弃，处理方式待拍板）

以下三项 design.md 状态行均已标 ❌，暂留根目录，待定移入 `archive/deprecated/` 或物理删除：

- **behavior-memory**（2026-08-17 作废，由 `@deeporca/memory` 承接）
- **harmonyos-dev-kit**（曾落地后整体下线 `f680c14`）
- **prototype-companion**（2026-09-02 并入 design-systems-advance）
