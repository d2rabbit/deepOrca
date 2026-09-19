# design-stage-gates — 任务分解

> 每批过 `npm run typecheck` + 相关测试后提交。批间允许中断续作。

## WP0 规格三件套

- [x] requirements.md / design.md / tasks.md。
- [x] OCR（alibaba/open-code-review）源码调研结论落 design.md §2。

## WP1 共享引擎（design-gates.ts）

- [x] `normalizeGeneratedMarkdown` + `countTableDataRows`（占位感知）纯函数；
- [x] `callSubagentStable`（classifyLlmError 瞬态重试 + 空内容重试）；
- [x] `runDesignStage` v2（emit/findings 明细/稳定 seam；DesignStageResult 判别联合）；
- [x] `openuiInteractivityFindings`、`leaferCanvasFindings`（硬/软分层）；
- [x] `archSectionsAudit` 强化（七节 + erDiagram + 三表行门槛）；
- [x] 单测：归一化/行计数/密度/画布/审计 findings。

## WP2 prototype.ts

- [x] SPEC_SKELETON 行级模板（三表 + 验收清单占位行不计数）；
- [x] specSectionsAudit 换 countTableDataRows + 验收占位不计 + 归一化接入（生成与修复两路）；
- [x] materialize stage0 fail-open 降级（手动 pmdesign 保持 fail-closed）；
- [x] materialize 覆盖门并入交互密度 findings；
- [x] ARCH_SKELETON + prototypeArchRun 迁 runDesignStage（fail-closed）+ arch-writer SKILL 撤模板改单源引用；
- [x] 修复 callSubagentStable 字符串产物 → {content} 包装（嵌套围栏感知抽取回归）。

## WP3 design.ts + leafer-repair.ts

- [x] ui-design stage 迁 runDesignStage + fail-open 降级；
- [x] Leafer 画布深度门（缺页硬门修复一轮后仍缺 fail-closed；密度软门进修复契约；结构环后复检）；
- [x] 稳定 seam 接入画布生成/深度修复/自检环。

## WP4 收尾

- [x] progress-label 新码映射（repairing ×2 + degrade ×2）+ i18n 6 语言目录补键；
- [x] `npm run check` + 全量 `npm test`（core 975 / desktop 713 / memory 72 / embedding 14 全绿）；
- [x] mutation check ×5（占位行计数 / stage0 降级 / arch 门 / Leafer 硬门 / 瞬态重试——破坏各自对应测试均失败，还原全绿）；
- [x] 分批提交推送。
