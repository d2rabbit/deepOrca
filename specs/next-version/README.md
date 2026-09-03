# specs/next-version — 第二阶段（下一版）规划区

> **口径（2026-09-03 立）**：已被 [`docs/features/next-version-plan.md`](../../docs/features/next-version-plan.md) 主线承接的规划 spec 集中本区——**不是废弃**，是"设计定稿、待下一版启动"的 staging 区。冻结期后随 `next/*` 分支开工；开工时 `git mv` 回 `specs/<name>/` 转为活跃 spec。启动顺序与前置（预生产收尾、OC 王牌路线优先）见该计划文档。
> 本区引用归档件用 `../archive/<name>/`，引用活 spec 用 `../../<name>/`。

| spec | 主线 | 分期 |
| --- | --- | --- |
| [module-system](./module-system/design.md) | B：action → Studio 基座（超大版本） | B1 冷插拔（P0）+ B2 热激活/隔离（P1）；B3-B5 紧随其后一版 |
| [doc-wiki](./doc-wiki/design.md) | D：知识编译 | D0 零基建 → D1 编译层 MVP → D2 检索/图谱/研究闭环 |
| [zg-semantic-search](./zg-semantic-search/design.md) | E：工作区语义检索（zvec-grep） | M0 P0 Windows 验证门槛（一票否决）→ M1 core → M2 desktop → M3 产品面 |
