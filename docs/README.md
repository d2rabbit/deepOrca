# docs/ 目录索引

> 一句话地图：**看路线与现状 → `features/feature-roadmap.md`（§0 当前状态总览为权威）；看某功能的实现方案 → `../specs/<name>/`（规划中的另有 `tasks.md` 阶段指引）；看调研背景 → `research/`（仅供参考）；历史审计/评审记录 → `audit-archive/`；其余为用户手册。**

## 权威层级（谁说了算）

| 关注点               | 权威文档                                                                   | 说明                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **产品路线与现状**   | [features/feature-roadmap.md](./features/feature-roadmap.md)               | §0 当前状态总览（逐 spec 终判）+ 功能域规划；版本历史在文末附录                                                                                                                                                         |
| **某功能的实现依据** | [../specs/](../specs/)                                                     | 正式实现方案以 spec 为准（design.md + tasks.md）。**已实现/部分实现的 spec 在 design.md 状态行有终判回写（2026-08-18 整顿）；规划中的 spec 一律三层齐备：design.md（预研+设计）+ tasks.md（任务指引，含开工前置条件）** |
| **调研与预研**       | [research/](./research/) + [research/README.md](./research/README.md) 台账 | **仅供参考，不作为实现依据**（2026-08-17 总口径）；作废/整合件物理收进 [research/archive/](./research/archive/)                                                                                                         |
| **本版本收尾范围**   | [../specs/pre-production/tasks.md](../specs/pre-production/tasks.md)       | 冻结期唯一范围清单（"闭环"项白名单）                                                                                                                                                                                    |
| 用户手册             | 本目录各专题文档                                                           | architecture / session-persistence / permission / mcp / plan-mode / agent-skills 等（`*_en.md` 为英文孪生）                                                                                                             |

## 本目录内容

| 类别                                      | 文档                                                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **功能路线**                              | features/feature-roadmap.md（当前版本路线与现状）、features/next-version-plan.md（下一版本规划：自进化引擎/Studio 基座/远程访问，2026-08-18 立）、features/coord-chain-plan.md（**王牌专属路线 OC · AI 协调工作链，优先级高于 next-version**，2026-08-27 立） |
| **用户手册**                              | quickstart、architecture、configuration、session-persistence、permission、mcp、plan-mode、agent-skills、agents-md、notify、statusline（各配 `*_en` 孪生）                                 |
| **组件清单**                              | builtin-inventory（2026-08-03 历史快照，含时效说明）、external-capability-components、external-deps-migration（外部依赖 controller-seam 迁移状态）                                        |
| **预生产记录**（2026-08-17/18，历史性质） | pre-production-capability-scan（F1-F3+F6 扫描）、pre-production-spec-final-audit（F5 逐 spec 终判，19 项）                                                                                |
| **收尾台账**（活文档，闭合即回流 specs）  | spec-open-items-status（specs 19 项未收尾逐项确认，2026-08-18）、pre-production-manual-test（余 7 项人工收尾执行手册：F4 走查/gitmcp 手测/外部 server/能力矩阵/T2.3 对拍/B3 演练/H 切换） |
| **审计/评审/稳定化记录**                  | 全部收进 [audit-archive/](./audit-archive/)（6 份：结论已兑现，保留溯源；登记见其中 README）                                                                                              |

## 维护规则

- 路线图**只在状态变化时**更新 §0 与对应功能域段落；详细变更写 CHANGELOG，不再向路线图头部堆版本日志（历史版本段落统一放路线图文末附录）。
- spec 落地后回写自身 design.md 状态行 + tasks.md 勾选；**不要再新建**平行的状态跟踪文档（现状类问题改既有文档，而不是再加一份）。
- 调研文档按 research/README.md 的登记/回写规则维护；整篇作废：主目录移到 research/archive/ 并在 archive README 登记，保留不删。
- 新审计/评审记录先在 docs/ 主目录落盘，结论兑现后移入 audit-archive/ 并在其 README 登记。
- 新建功能规划必须三层齐备：`specs/<name>/design.md`（预研结论 + 设计）+ `tasks.md`（任务清单/指引）+ 路线图对应域补 spec 链接。
