# docs/audit-archive/ — 已兑现的审计/评审/稳定化记录

> 收编日期：2026-08-18（文档债务整顿）。
> 收录口径：结论已全部兑现（修复在树、由后续评审/终判证实）的过程性记录，物理移出 docs/ 主目录减少导航噪音；**保留不删**（溯源价值）。活跃参考文档不在此列——组件清单、迁移状态、预生产记录仍留主目录（见 docs/README.md）。

## 清单

| 文档 | 主题 | 兑现状态 |
| --- | --- | --- |
| security-audit-2026-08-12.md | 全仓安全审计 issue 清单（8C/21H/17M） | ✅ 修复抽查在树（research 台账 `2026-08-05-audit-issues` 验收轮 + Mimosa 门禁持续在位） |
| security-audit-2026-08-15-deep-review.md | 深评审（12 提交全功能四层回归） | ✅ 缺陷修复全部落地（`docs/research/2026-08-15-full-regression-review.md` 闭环验收） |
| security-audit-2026-08-15-followup.md | 深评审跟进 | ✅ 同上 |
| review-2026-08-17-adversarial-4commits.md | 收官 4 提交对抗式评审 | ✅ 35 项发现全修 + 第三轮复审回归再修 + 第四轮验证 SHIP |
| review-2026-08-17-adversarial-privacy-webfetch.md | 隐私剔除 + WebFetch 评审 | ✅ 同上（收敛至零） |
| stabilization-2026-08-10.md | 数据丢失与测试套件稳定化记录 | ✅ 修复已固化（路径闸门/会话持久化纪律在树） |

维护规则：新审计/评审记录先在 docs/ 主目录落盘；结论兑现后（由 research 台账或终判证实）移入本目录并在本表登记一行。被引用的报告路径若有变化，引用方同步修复。
