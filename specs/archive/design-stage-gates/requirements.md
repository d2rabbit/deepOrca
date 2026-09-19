# design-stage-gates — 需求（EARS）

> Phase 1 of spec-workflow。技术方案见 [design.md](./design.md)；任务分解见 [tasks.md](./tasks.md)。
> 立项依据：user 2026-09-11——"原型设计和 UI 设计，架构图设计这两个部分也这么强化一下……去看看 opencodereview（OCR，`@alibaba-group/open-code-review`）的源码是怎么做的，我们也参考一下，甚至可以引入专属的这几个模块的 agent 体系。我只有一个要求：**一定要稳定**。"
> 前置：specs/prompt-doc-chain 已落地 PRD 深度门（`specSectionsAudit` + 修复轮）与 pm-design 六节门；本规格把同一待遇补齐到**其余全部生成 stage**，并引入 OCR 的垂直 agent 稳定性分层。

## 范围

四个生成 stage 的机械深度门与稳定性分层：**ui-design.md**（design.materialize 强化 stage）、**技术架构文档**（prototype.arch）、**OpenUI 原型程序**（materialize 产物）、**Leafer 场景 JSON**（design.materialize 产物）。同时把子代理调用 seam 补上瞬态重试。**不含**：PRD 深度门（已有）、pm-design 门（已有）、对话侧链路、渲染层 UI 变更（进度码回退英文原文，零 i18n 强制）。

## OCR 源码调研结论（借鉴依据，详见 design.md §2）

1. **多阶段模板管线**：MAIN_TASK → PLAN_TASK → RE_LOCATION，每阶段专属提示词模板 + 专属预算——对应我们的 spec→pm-design→原型→ui-design 链；
2. **增强阶段 fail-open**："Plan failure never blocks the main review" / "LLM grouping failed → falling back to per-file dispatch"——增强产物失败回退基线行为，永不阻塞主管线；
3. **落盘验证 fail-closed**：行号越界/JSON 结构机械校验，不达标不入结果集；
4. **确定性优先于 LLM**：RE_LOCATION 三级解析（同文件启发式 → 跨文件启发式 → LLM 兜底）——修复先走确定性归一化，再花 LLM 轮。

## 验收标准（EARS）

### S1 — 确定性归一化层（OCR 借鉴 #4）

1. When 任一文档 stage（spec / pm-design / ui-design / arch）的子代理产物进入审计, the system shall 先做确定性归一化：表格行去前导空白（LLM 常把 GFM 表缩进，行首 `|` 检测全失效）、并按占位符感知规则计数数据行（纯 `<占位>` / `[TODO` 单元格的行不计）——归一化后的文档才是审计与落盘对象。

### S2 — ui-design.md 深度门 + fail-open 降级

2. When design.materialize 的 ui-design stage 产出文档, the system shall 以 `uiSectionsAudit`（四节逐节点名）审计，findings 非空时带 findings 修复一轮，复审通过才作为画布主驱动。
3. When ui-design 修复轮后仍未达标（弱模型极限）, the system shall **fail-open 降级**：ui-design 置空、画布按既有原型驱动提示词生成（与无 pm-design 的旧路径同构），发射降级进度事件——OCR "plan failure never blocks" 同款分层，绝不因提示词文档失败杀死 UI 生成。

### S3 — 架构文档深度门

4. When `prototype.arch` 生成架构文档, the system shall 内联 ARCH_SKELETON（七节骨架 + 表格行模板）驱动生成，以强化版 `archSectionsAudit` 审计：七节齐全、≥2 张 Mermaid 图且必含 erDiagram、技术选型/模块拆分表 ≥3 数据行、风险表 ≥2 数据行；findings 非空带 findings 修复一轮，复审仍败 **fail-closed**（显式动作，产物即契约）。

### S4 — OpenUI 原型程序深度门

5. When prototype.materialize 校验生成的 OpenUI 程序, the system shall 在页面覆盖门之外追加交互密度门（机械可判定）：组件调用总数下限、`Action(` 交互数下限、每个声明页面可达（初始页或存在 `@Set($page,…)` 导航边）——findings 注入修复环契约（fail-open，verify 阶段兜底，与既有页面覆盖门同层）。

### S5 — Leafer 场景深度门

6. When design.materialize 校验 Leafer 文档, the system shall 追加画布深度门：基底原型已知页面数时顶层 Frame 数不得少（缺页=破损 UI，**fail-closed**，修复一轮后仍缺则拒绝落盘）；节点密度不足仅作为修复契约提示（软门——弱模型密度弹性大，硬门反致不稳定）。

### S6 — 子代理瞬态重试

7. When 设计管线内任一子代理调用抛出可分类瞬态错误（RATE_LIMIT / SERVER / TRANSIENT / TIMEOUT，复用 `classifyLlmError`）或返回空内容, the system shall 同提示词重试一次（1s 退避，前缀缓存友好）；非瞬态错误立即失败，重试耗尽按各 stage 既有语义（fail-open 降级或 fail-closed）。

## 非目标

- 三阶段以外的产物门（tokens/drift/verify 既有规则不动）；
- 进度码 i18n 新键（降级/重试事件回退英文原文，映射后补）；
- 用其它技术栈另起 agent 运行时（裁决：OCR 模式证明"专属垂直 agent + 机械门 + 分层失败语义"在进程内即可达成稳定，另起栈只会增加不稳定面）；
- 子代理温度/采样参数化（宿主层议题，另行立项）。
