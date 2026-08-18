# docs/ 目录索引

> 一句话地图：**看路线与现状 → `features/feature-roadmap.md`（§0 总览为权威）；看某功能的实现方案 → `../specs/<name>/`；看调研背景 → `research/`（仅供参考）；其余为用户手册与历史审计记录。**

## 权威层级（谁说了算）

| 关注点 | 权威文档 | 说明 |
| --- | --- | --- |
| **产品路线与现状** | [features/feature-roadmap.md](./features/feature-roadmap.md) | §0 当前状态总览（逐 spec 终判）+ 功能域规划；版本历史在文末附录 |
| **某功能的实现依据** | [../specs/](../specs/) | 正式实现方案以 spec 为准（design.md + tasks.md） |
| **调研与预研** | [research/](./research/) + [research/README.md](./research/README.md) 台账 | **仅供参考，不作为实现依据**（2026-08-17 总口径） |
| **本版本收尾范围** | [../specs/pre-production/tasks.md](../specs/pre-production/tasks.md) | 冻结期唯一范围清单（"闭环"项白名单） |
| 用户手册 | 本目录各专题文档 | architecture / session-persistence / permission / mcp / plan-mode / agent-skills 等（`*_en.md` 为英文孪生） |

## 本目录内容

| 类别 | 文档 |
| --- | --- |
| **功能路线** | features/feature-roadmap.md（唯一） |
| **用户手册** | quickstart、architecture、configuration、session-persistence、permission、mcp、plan-mode、agent-skills、agents-md、notify、statusline（各配 `*_en` 孪生） |
| **组件清单** | builtin-inventory（内置插件/技能/MCP 清单）、external-capability-components、external-deps-migration（外部依赖 controller-seam 迁移状态） |
| **预生产记录**（2026-08-17/18，历史性质） | pre-production-capability-scan（F1-F3+F6 扫描）、pre-production-spec-final-audit（F5 逐 spec 终判，19 项） |
| **审计与评审记录**（历史归档，结论已兑现） | security-audit-2026-08-12、security-audit-2026-08-15-deep-review、security-audit-2026-08-15-followup、review-2026-08-17-adversarial-{4commits,privacy-webfetch}、stabilization-2026-08-10 |

## 维护规则

- 路线图**只在状态变化时**更新 §0 与对应功能域段落；详细变更写 CHANGELOG，不再向路线图头部堆版本日志（历史版本段落统一放路线图文末附录）。
- spec 落地后回写自身 tasks.md 勾选与状态行；**不要再新建**平行的状态跟踪文档（现状类问题改既有文档，而不是再加一份）。
- 调研文档按 research/README.md 的登记/回写规则维护；整篇作废划线保留不删。
