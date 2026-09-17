# 架构图视觉回读闭环 — 任务清单

> 对应设计：[design.md](./design.md)。上游调研：[fireworks-tech-graph prestudy](../../../docs/research/2026-09-17-fireworks-tech-graph-prestudy.md)（不引代码，吸收「评估而非断言」三件套）。
> 粗估：P0 0.5 天 / P1 1 天 / P2 0.5 天（合计 2 天内，本计划周期）。

## P0 门① 布局契约（确定性，零渲染成本）

- [x] T0.1 新建 `desktop/main/tools/archify-layout-check.ts`：消费 `archify validate <type> --layout-json` 输出 → `checkLayoutContract(layout) → { violations: Array<{kind, nodes, detail}> }`；检查项：节点 bbox 两两重叠（1px 容差）、节点越出画布边界；无 layout-json 的图类型返回 `{ skipped: true }` 如实标注 _Requirement: R1_
- [x] T0.2 单测 `archify-layout-check.test.ts`：黄金用例（构造重叠对/越界/干净三种 layout-json）+ skipped 路径；mutation-check 一次（破坏重叠判定 → 红 → 恢复） _Requirement: R1, 门禁_

## P1 门②③ 编排 + 修订循环

- [x] T1.1 门②：arch-scan verify 阶段 spawn vendored `visual-check.mjs`（宿主 Chrome 解析对齐上游 `ARCHIFY_CHROME`/内置探测；超时与失败按 skipped 透传）→ parse receipt JSON（containment.status + 截图清单 + 联系表路径） _Requirement: R1_
- [x] T1.2 门③：containment pass 后取 1 视口 × 双主题两张截图 → `runStandaloneChatCompletion`（vision client + image parts）执行四问契约；aux schema 强制（每问 pass/fail + 证据行），违约重试一次后 `inconclusive` _Requirement: R1, R3_
- [x] T1.3 诚实跳过：visionModel 未配置（createVisionClient null）→ 报告标 `visual review skipped`，门①② 照跑呈现；Chrome 不可用 → 门② 上游 skipped 透传 _Requirement: R2_
- [x] T1.4 修订循环：任一 fail → 反馈包（失败问答 + contactSheet/截图路径 + 「改 IR 不重写」指令）回灌 agent；≤2 轮；超限交付照常、报告标注未收敛项 _Requirement: R4_
- [x] T1.5 SKILL.md 增补：回读反馈消费动词 + 语义箭头词汇表（同步/异步/读写/双向 → IR link type + 标签动词，V3 最小吸收）；i18n ×6（报告面新文案） _Requirement: R4, V3_
- [x] T1.6 验收报告扩展：三门状态/修订轮次/skipped 项全呈现；零管线验证（`git diff packages/desktop/vendor/` 为空） _Requirement: R4, R5_

## P2 真机与收尾

- [ ] T2.1 真机两态：vision 配置态全链（故意产出含缺陷 IR 一轮验证修订回路收敛）+ 未配置态（skipped 呈现） _Requirement: R2, R4_
- [ ] T2.2 门禁：`npm run check && npm test` 全绿；报告面走查 _Requirement: 门禁_

## 明确不做（见 design §4）

不做审美评估 / 不改 vendored 任何文件 / 不做 golden 像素对拍 / 不新增 skill 名与 IPC / 视觉回读不进 deliver 门禁。
