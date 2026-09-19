# design-stage-gates — 技术方案

> 需求见 [requirements.md](./requirements.md)。全部改动落在 `packages/core/src/actions/`（design-gates.ts / prototype.ts / design.ts / leafer-repair.ts），core 保持无 UI。

## 1. 现状缺口（已核实）

| Stage | 落盘门现状 | 缺口 |
| --- | --- | --- |
| spec（PRD） | `specSectionsAudit` 七节 + 表深 + 修复轮 | 表格行检测不容缩进/占位（p-core 真机 0 行误判类） |
| pm-design | `pmSectionsAudit` 六节 + 修复轮（generatePmDesignDocument） | stage0 蒸馏失败**硬失败整个 materialize**（增强阶段应为 fail-open） |
| ui-design | 仅"有 # 标题 + ≥2 个 ## 节"轻检查 | `uiSectionsAudit` 定义了**没接**；无修复轮；失败硬错误 |
| arch | `looksLikeArchDoc`（有标题+有 mermaid 即过） | `archSectionsAudit` 定义了**没接**；无骨架内联；无修复轮 |
| OpenUI 程序 | `pageCoverageFindings`（页面清单覆盖） | 无交互密度门（死按钮/空壳可通过） |
| Leafer 程序 | `repairLeaferProgram` fail-closed 自检环（结构+error lint） | 无画布深度门（Frame 缺页可通过） |
| 子代理 seam | 无重试 | 单次网络抖动/5xx/空内容 = 动作失败 |

## 2. OCR（alibaba/open-code-review）源码调研

Go 项目（npm 包是二进制启动器）。`internal/agent`（diff 编排）+ `internal/llmloop`（共享 LLM 工具环）+ `internal/config/template`（多阶段模板）。

- **多阶段模板管线**：`prompts/{main,plan,re_location,review_filter,grouping,memory_compression}_task_{system,user}.md` + `task_template.json`（每阶段 timeout/预算：MAX_TOKENS 200K、MAX_COMPLETION_TOKENS 16,384、MAX_TOOL_REQUEST_TIMES 100）。模板即阶段契约，预算即模板字段。
- **失败分层**：Plan 阶段失败 → "plan-less behavior，文件仍获完整 MAIN_TASK 审查"；LLM 分组失败 → 回退逐文件确定性分派（"a grouping failure never blocks the pipeline"）。而 Comment 落盘侧：行号越界机械校验 + JSON schema 校验，不达标剪除。**增强 fail-open × 验证 fail-closed**。
- **确定性优先**：RE_LOCATION 三级（同文件启发式 → 跨文件启发式 → LLM 兜底）；review_filter 畸形 JSON/覆盖不全 → 保留原批意见不改。
- **结论**：OCR 没有魔法 agent 框架——稳定来自"每阶段专属提示词模板 + 机械可判定的产物校验 + 分层失败语义"。我们的技能子代理（spec-writer / pm-designer-openui / deep-design / arch-writer，全部 `Do not call tools` 的纯文本生成代理）已经是同构的垂直 agent；补齐门与失败分层即可，**不另起技术栈**。

## 3. 方案

### 3.1 design-gates.ts 升级为共享引擎

- `normalizeGeneratedMarkdown(md)`：表格行去前导空白（仅当去空白后以 `|` 开头且 ≥2 个 `|`）；审计与落盘共用同一归一化产物。
- `countTableDataRows(section)`：`^[ \t]*\|` 行，排除分隔行（`:?-{2,}`）与纯占位行（每格皆 `<…>` 或 `[TODO…`）；spec/arch 审计共用。
- `callSubagentStable(ctx, opts)`：子代理稳定调用 seam——抛错经 `classifyLlmError` 分类（RATE_LIMIT/SERVER/TRANSIENT/TIMEOUT）重试一次（1s）；内容 null/空同样重试一次；其余语义交还调用方。
- `runDesignStage<T>` v2：补 emit（progressCode + basePercent）、错误携带 findings 明细、内部走 `callSubagentStable`。pm-design / ui-design / arch 三个文档 stage 全部迁入该引擎（各自 buildPrompt/audit/extract 保持可测纯函数）。
- `openuiInteractivityFindings(spec, program)`：页面清单已知时——组件调用总数 ≥10；`Action(` ≥ max(2, 页数)；每个声明页可达（初始页或存在 `@Set($page,…)` 导航边）。返回 findings 句列，注入 repairOpenuiProgram 契约（fail-open 层）。
- `archSectionsAudit` 强化：七节（技术选型/系统架构/数据模型/核心流程/模块拆分/非功能/风险）+ Mermaid ≥2 且含 erDiagram + 技术选型表/模块拆分表 ≥3 数据行 + 风险表 ≥2 数据行。
- `leaferCanvasFindings(text, requiredPageCount?)`：解析 JSON（失败返回 finding）→ 顶层 Frame 数 < requiredPageCount → 缺页 finding（硬门）；总节点数 < 4×Frame → 密度提示（软门，只进契约）。

### 3.2 prototype.ts

- `SPEC_SKELETON`：功能需求/数据与字段/页面清单各补**具体 GFM 行模板**（占位符行）——弱模型"填空到行"，占位行不计数据行（模板抄也过不了门）。
- `specSectionsAudit` 行计数改用 `countTableDataRows`；spec 产物先 `normalizeGeneratedMarkdown` 再审计/落盘。
- materialize stage0 蒸馏失败 → **fail-open 降级**：发射降级事件、按无 pm-design 的既有提示词生成（spec 直驱）；手动 `prototype.pmdesign` 保持 fail-closed（显式重算必须成功或明确报错）。
- materialize 的覆盖门拼接处并入 `openuiInteractivityFindings`（同一 coverageNote 通道进修复环契约）。
- `prototypeArchRun`：ARCH_SKELETON 内联 + `runDesignStage`（audit=强化 archSectionsAudit，maxRepairs=1，fail-closed）。
- `ARCH_SKELETON`：七节 + 三表行模板 + mermaid 占位（`graph TD`/`erDiagram`/`sequenceDiagram` 各一），风格与 SPEC_SKELETON 一致。

### 3.3 design.ts

- ui-design stage 迁 `runDesignStage`（audit=uiSectionsAudit，maxRepairs=1）；复审仍败 → fail-open 降级（uiDesign=null，原型直驱画布，既有字节路径）+ 降级事件。
- Leafer 产物在 `repairLeaferProgram` 前跑 `leaferCanvasFindings`（基底原型页面数为 required）：缺页 → 带 findings 追加一轮定向修复再入自检环，仍缺页 fail-closed；密度提示拼进修复契约。

### 3.4 失败语义总表（分层裁决）

| 位置 | 语义 | 依据 |
| --- | --- | --- |
| spec 深度门 | fail-closed | 契约源，薄 PRD 毒化全链 |
| pm-design 手动重算 | fail-closed | 显式动作产物即契约 |
| pm-design stage0（自动） | **fail-open 降级 spec 直驱** | OCR plan-failure 分层 |
| ui-design stage（自动） | **fail-open 降级原型直驱** | 同上 |
| arch 深度门 | fail-closed | 显式动作 |
| OpenUI 交互密度 | fail-open（契约注入 + verify 兜底） | 与页面覆盖门同层 |
| Leafer 缺页 | fail-closed | 破损 UI 不可落盘 |
| Leafer 密度 | 软门 | 弱模型弹性，硬门反不稳 |
| 子代理瞬态错误 | 重试 1 次后按上层语义 | OCR 预算内重试 |

## 4. 测试策略

- 归一化/行计数纯函数单测（缩进表、占位行、分隔行变体）；
- ui-design：审计通过 / 修复后通过 / 修复仍败降级（画布仍生成、uiDesign 空串清除语义保持）；
- arch：缺节/缺 erDiagram/表不足 findings 文案 + 修复轮 + 仍败拒绝落盘；
- stage0 降级：蒸馏失败 → materialize 仍成功、提示词与 spec 直驱字节一致；
- OpenUI 密度 findings：空壳程序触发、达标不触发；
- Leafer：Frame 缺页 fail-closed、密度只进契约；
- 瞬态重试：可重试错误恰重试一次、非瞬态不重试、空内容重试；
- 既有 pd/spec/prompt-doc-chain 测试全绿（迁移到引擎后行为等价——emits/percent 契约保持）。
