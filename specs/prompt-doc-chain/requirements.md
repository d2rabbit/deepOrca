# prompt-doc-chain — 需求（EARS）

> Phase 1 of spec-workflow。技术方案见 [design.md](./design.md)；任务分解见 [tasks.md](./tasks.md)。
> 立项依据：user 2026-09-10——现状 PRD→原型、原型→UI 都是"原文直喂 + 静态契约"，没有基于本次 PRD 分析的强化提示词层（已核实：`prototype.materialize` 直接把 spec 全文交给 pm-designer-openui；`design.materialize` 直接从 requirement+原型内容生成 Leafer）。两项裁决：① **pd-design.md 自动 + 可手动重算**（materialize 内嵌 stage0，另有独立动作）；② **ui-design.md 也落盘**（第二个提示词文档）。

## 范围

生成链插入两级提示词文档：`PRD(spec) → pd-design.md（原型提示词文档）→ 原型(OpenUI) → ui-design.md（UI 强化提示词）→ UI(Leafer)`。pd-design.md 是从 PRD 分析蒸馏出的设计意图文档（页面结构/交互叙事/信息架构/视觉基调/平台策略/继承要点），作为原型生成的**主驱动**；ui-design.md 把交互意图翻译成视觉稿语言，作为 UI 生成的主驱动。**不含**：对话侧手动 `/pm-design-openui` 命令链路（只服务套件管线）、ui-design.md 的独立修订动作（首版随 materialize 重新生成）、设计系统选择变更的自动重算。

## 用户故事

- 作为用户，我的 PRD 在原型化之前先被"设计视角"蒸馏一遍——页面、交互叙事、信息架构在 pd-design.md 里显式成形，原型不再是 PRD 原文的直译；
- 作为用户，PRD 修订后 pd-design 自动失效并提示重算，也可以手动一键重算；
- 作为用户，原型转 UI 时，交互意图（pd-design）被强化为视觉稿语言（ui-design.md），UI 生成不再从 PRD 原文跳跃到画布。

## 验收标准（EARS）

### S1 — pd-design 生成与失效

1. When `prototype.pddesign` 运行, the system shall 读取当前 PRD 版本（含主题层继承/交叉参考上下文），经子代理产出 **pd-design.md** 并持久化为套件版本内容 `pdDesign` 字段（落盘 `pd-design.md` 投影）。
2. When `prototype.materialize` 运行且所选版本无 `pdDesign`, the system shall 自动执行 stage0 生成 pd-design（进度码 `prototype.pddesign.generating/saved`）后再原型化；已有 `pdDesign` 时直接使用（不强制重算）。
3. When pd-design 保存（无论独立动作还是 stage0）, the system shall 按派生物失效规则重置 `openui/openuiVariants/verification/arch`（与 render_spec 同规——上游意图变了，下游派生物不再可信）。
4. When `render_spec` 重写 PRD, the system shall 同时重置 `pdDesign`（spec → pdDesign 派生链失效）。
5. When 子代理返回的 pd-design 不是带结构的 markdown, the system shall 拒绝持久化并返回结构化错误（不落盘残缺文档）。

### S2 — ui-design 强化与透传

6. When `design.materialize` 运行且基底原型携带 `pdDesign`, the system shall 先产出 **ui-design.md**（进度码 `design.uidesign.generating/saved`）：以 pd-design 为基础、叠加视觉翻译契约（页面帧构图/tokens 映射/视觉层级），随 `render_leafer` 持久化为 UI 套件 `uiDesign` 字段（落盘 `ui-design.md` 投影）。
7. When 基底原型无 `pdDesign`（旧数据）, the system shall 保持既有 UI 生成提示词**字节不变**（优雅降级，零回归）。
8. When `design.revise(part="design")` 的提示词组装, the system shall 在存在 `uiDesign` 时将其作为上下文注入修订基线（存在才注入，缺失不变）。

### S3 — 渲染与 i18n

9. When 需求原型工作台打开 spec 页, the system shall 在文档存在时提供"提示词"视图（阅读 `pdDesign`）与"重新生成"入口（手动重算）。
10. When 新增进度码, the system shall 落 `progressLabel` 映射并在全部 6 语言目录补键（缺失回退英文原文）。

## 非目标

- ui-design.md 的独立修订/重算动作（首版随 materialize 重新生成）；
- 对话侧手动命令链路（`/pm-design-openui`）的提示词文档化；
- 设计系统选择变化触发的 pd-design/ui-design 自动重算；
- brief.md / arch 文档链路的改动。
