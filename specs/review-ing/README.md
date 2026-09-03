# specs/review-ing — 审查归档（待复核转正）

> **口径（2026-09-03 立）**：主体已落地、但存在**待复核项**（收尾清单 / 真实 LLM 对拍 / 真机走查）的 spec 暂入本区——不占活跃位，也未到 ✅ 收官标准。复核通过后 `git mv` 至 `specs/archive/<name>/` 并同步改写引用；复核发现重大缺口则移回 `specs/` 复工。
> 本区引用归档根用 `../archive/<name>/`，引用活 spec 用 `../../<name>/`。

| spec | 入区日期 | 待复核项 | 转正条件 |
| --- | --- | --- | --- |
| [task-tree-hub](./task-tree-hub/design.md) | 2026-09-03 | 收尾清单 + 真机走查（任务树 V2 已于 2026-09-02 提交） | 复核通过 → 移入 `specs/archive/task-tree-hub/` |
| [skill-eval](./skill-eval/design.md) | 2026-09-03 | T2.3 双引擎趋势对拍（待真实 LLM 花费，登记为预生产测试内容） | 对拍通过 + CI 首跑 → 移入 `specs/archive/skill-eval/` |
