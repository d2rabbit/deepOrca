# 修复规则记忆 — 任务清单

> 对应设计：[design.md](./design.md)。上游调研：[EMG prestudy](../../../docs/research/2026-09-17-emg-experience-memory-graph-prestudy.md)（拍板：概念级移植，不引代码）。
> 粗估：P0 0.5 天 / P1 1 天 / P2 0.5 天（合计 2 天内，本计划周期）。

## P0 序列 diff（纯函数，零 LLM）

- [x] T0.1 新建 `core/actions/repair-diff.ts`：`extractToolSequence(transcript) → Array<{tool, argsDigest}>`（对齐单元 = 工具名 + 关键 args 摘要：command/path/query 首参截断）+ `diffSequences(parent, child) → { spine, deletedClusters, insertions }`（LCS 脊柱 → 删除簇/插入按公共锚归位） _Requirement: R1_
- [x] T0.2 单测 `repair-diff.test.ts`：黄金对（构造 parent「重复 take 失败→废弃」vs child「先放下再取→成功」transcript，断言删除簇含失败动作、插入含修复动作）；边界（序列近同→零删除簇；公共脊柱 <3 → no-signal；空 transcript） _Requirement: R1, R2_
- [x] T0.3 mutation-check 一次：临时破坏删除簇判定 → 测试红 → 恢复 _Requirement: R1_

## P1 动作三段接线

- [x] T1.1 配对挖掘（确定性）：遍历树 reflog fork 记录 → {parentBranch, childBranch, why}；过滤 parent outcome=abandoned 且 child 分支有绑定会话；经 sessionRef 取两侧 transcript → `extractToolSequence` → `diffSequences`；零合格对/零信号 → 空报告短路（不进 P1） _Requirement: R1, R2_
- [x] T1.2 规则措辞（单次结构化补全）：aux schema 契约（≤3 条双语、必带证据引用、与现有 AGENTS.md Repair rules 段去重）；违约重试一次后整轮失败 _Requirement: R3_
- [x] T1.3 审查回写：AskUserQuestion 逐条 accept/reject/skip；accepted → 受控回写指令（主会话 edit 通道写 `## Repair rules` 小节，每条带 tree id + fork why 一行溯源） _Requirement: R4, R5_
- [x] T1.4 动作注册 + 报告：`memory.mine-repairs` defineAction（三端自动承接）；自包含双语 HTML 报告（沿 memory-audit 形态：配对清单/编辑路径/规则提案/裁决结果）；i18n ×6 _Requirement: R4_
- [x] T1.5 复用件加性导出：memory-audit 的 aux schema 契约/审查循环/回写指令形状按需 export（不动其主体与已归档行为） _Requirement: R3, R4_

## P2 真机与收尾

- [x] T2.1 真机一轮：任一存在 abandoned fork 的真实树上跑全链（无树则先人工造一对：主分支跑废→fork 修复成功），核验 AGENTS.md 回写与溯源行 _Requirement: R5_
  - ✅ 2026-09-18 真机全链：真实仓库根 + 真实 LLM（step-3.7-flash 单次措辞调用）经动作入口 mineRepairsRun——P0 挖出唯一配对（deletedClusters=1，bash 插入）；P1 快照+双语 HTML 报告落盘 .deeporca/audits；P2 accept → 回写指令含 `## Repair rules` 段 + treeId + forkWhy 谱系行，AGENTS.md 副本应用验证通过；夹具树/会话/快照/rejections 全清理。
- [x] T2.2 门禁：`npm run check && npm test` 全绿；报告面走查（空报告/正常报告两形态） _Requirement: 门禁_
  - ✅ 2026-09-18：check/test 零失败；空报告（无 abandoned fork 树）与正常报告两形态均经真机脚本核验。

## 明确不做（见 design §4）

不引 EMG 代码 / 不做 FGW / 不做跨任务边聚合 / 不做 stuck 注入 / 不写记忆库 / 无人工 accept 不落盘。
