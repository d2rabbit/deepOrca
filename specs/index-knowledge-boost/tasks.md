# 索引与知识增强（K 线）— 实现计划

> 日期：2026-08-20 · 状态：**规划中（`next/*` 版本窗口启动；冻结期不实现）**
> 依据：[design.md](./design.md)
> 前置调研：`docs/research/quality/2026-08-20-pr-af-adversarial-review-prestudy.md` · `docs/research/agent-harness/2026-08-20-fastcode-iterative-retrieval-prestudy.md`
> 口径：本文件是正式实现计划（spec 级）；净室红线（design.md §4）对所有任务生效。

---

## K1 · 对抗证伪审查（review.challenge）

- [ ] **K1.1 `review.challenge` action 定义**（`packages/core/src/actions/review.ts`；复用 review.full 的 findings 产出与 status 惯例）
  - 输入：findings + crgRisk；执行逐条证伪挑战（四维度自研措辞：预存在/惯例/夸大/证据）；输出三态 verdict（upheld/downgraded/refuted）。
  - 确定性合并（无 LLM）；LLM 会话异常 → findings 原样 + `challenge: "skipped"`（fail-open）。
  - 验收：mock LLM 单测过（verdict 合并确定性 + fail-open 两用例）。
- [ ] **K1.2 产品接线**（CodeReviewPanel"对抗复核"开关默认关；smart-code-review skill 增补 challenge 步骤）
  - 验收：面板开启开关后 findings 带 verdict 徽标（refuted 折叠、downgraded 降级标注）。
- [ ] **K1.3 eval 与流程挂接**
  - smart-code-review 正/反 eval 用例加对抗 pass 断言（rule_based）；F4 真机烟雾用例扩展（下一版走查）。
  - 验收：`node scripts/run-skill-evals.mjs --package code` PR 模式跑通。
- [ ] **K1.4 K1 出口检查**：设计 §1.3 影响清单逐项核（时延实测、测试、流程）；开放问题 1/2 拍板并回写 design.md。

## K2a · 检索预算显式化

- [ ] **K2a.1 观测记账 P0（零行为变更）**（`packages/core/src/session.ts`；读代码行数累计 / 连续增益 / 预算占用三指标）
  - 指标随 session 状态暴露到桌面观测位（复用 usage 面板体系）；命名与 usage 记账对齐。
  - 验收：记账单测过；全量 `npm test` 无任何行为差异（零行为变更是硬约束）。
- [ ] **K2a.2 基线采集与拍板**：真实会话跑 ≥1 周，产出预算分布基线 → 拍板 P1 是否做、干预强度（软提示 vs 硬停；不做静默截断/丢弃）。
  - 验收：基线数据 + 拍板结论回写 design.md §2.2（开放问题 3 闭环）。
- [ ] **K2a.3 P1 干预实现**（条件任务：K2a.2 拍板"做"才启动）

## K2b · 粒度感知上下文选择（P2 设计先行，不排实现）

- [ ] **K2b.1 设计备忘**：三档粒度策略 + 与 doc-wiki 检索管线归并方案（开放问题 4）——产出设计节回写 design.md §3，实现另行立项。

---

## 依赖与并行关系

| 事项 | 说明 |
| --- | --- |
| 与 next/* 主线 A/B/C | 无代码冲突：K1 改 `core/actions/`、K2a 改 `core/session.ts` 记账——与 E1 埋点（registry.execute 单点）改不同文件；与 B1（core/modules）、C-M1（desktop main）正交。K2a 观测位接线建议避让 M1 dispatch 抽取窗口。 |
| 与 doc-wiki spec | K2b 归并方案等 doc-wiki 合流后定；repo overview 路由思想已记入 doc-wiki 对照，不在本 spec。 |
| 触发条件 | 元提示规划等"不采纳清单"重启评估的唯一触发：K1 上线后漏报集中在特定维度。 |

## 风险继承（design.md §1.3/§2.3）

- K1 时延 ×2 → 开关默认关 + budget 模型先行（开放问题 1）。
- K2a 静默干预 → P0 只观测不干预是红线；P1 强度待数据拍板。
