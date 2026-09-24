# 模型厂商画像与专属优化 — 需求（requirements）

> 对应设计：[design.md](./design.md) / 任务：[tasks.md](./tasks.md)。
> **2026-09-22 终版拍板（用户）**：①**白名单制**——仅下列本代官方端点型号享受专属优化，其余一切模型（同端点其它型号、未来代、权重版本）**全部走兜底策略**；②**MiniMax-M3.1 暂时隐藏**（尚未正式发布，不入白名单）；③**qwen3.8 特殊**：存在其它权重版本，官方端点仅支持 flash/max 两款 + qwen3.8-plus（目录未收录，按用户口径入单）；④本 spec 与 [`model-fleet-adaptation`](../review-ing/model-fleet-adaptation/requirements.md) **合并、以本方案为主**（对方已加合并横幅，X 线五红线与已落地基建归本 spec 继承）。
>
> ### 支持矩阵（白名单）
>
> | 家族     | 白名单型号                                                                                                                                                                                                                  | 隐藏/走兜底                                                              |
> | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
> | deepseek | `deepseek-flash` `deepseek-v4-flash` `deepseek-v4-pro` `deepseek-v4-flash-vision-exp`                                                                                                                                       | chat/reasoner 已停用（保留 override 兼容）                               |
> | stepfun  | `step-5-preview` `step-3.7-flash` `step-router-v1`                                                                                                                                                                          | 3.5 系（旧代）                                                           |
> | kimi     | `kimi-k3` `kimi-k2.7-code` `kimi-k2.7-code-highspeed` + 别名 `kimi-for-coding`/`kimi-code`/`kimi-coding`（K2.8 经别名，运行时元数据定代际）                                                                                 | k2.5 / k2.6（旧代）                                                      |
> | minimax  | `MiniMax-M3`                                                                                                                                                                                                                | **M3.1（隐藏未发布）**、M2 全系                                          |
> | qwen     | `qwen3.8-flash` `qwen3.8-max` `qwen3.8-plus` `qwen3.8-max-preview`                                                                                                                                                          | 3.8 权重版本（flash-next 等第三方 id）                                   |
> | glm      | `glm-5.3` `glm-5.3-flash` `glm-5.3-flashx` `glm-5.3-highspeed`                                                                                                                                                              | 5.2 及更早                                                               |
> | mimo     | `mimo-v2.5` `mimo-v2.5-pro` `mimo-v2.5-pro-ultraspeed` `mimo-v2.6-pro` `mimo-v2.6-pro-ultraspeed` `mimo-v2.6-flash`（1M 新代）                                                                                              | `mimo-v2-flash` `mimo-v2-omni`（256K 旧代）                              |
> | agnes    | `agnes-2.5-flash` `agnes-3.0-flash`（**2026-09-24 用户指令新增**；官方端点 `apihub.agnes-ai.com/v1`，512K 窗口 / 65536 输出，图像 URL 输入，思考开关 `chat_template_kwargs.enable_thinking` 布尔——数据驱动 optionMap 承载） | 2.5-pro 系（文档未明确 Agent 定位）、image/video 型号（非文本 agent 面） |
>
> 2026-09-22 立稿；agnes 家族 2026-09-24 依官方 wiki（wiki.agnes-ai.com agnes-25-flash / agnes-30-flash 页）增补。上游依据：[docs/research/2026-09-22-model-optimization-plan.md](../../docs/research/2026-09-22-model-optimization-plan.md)（v5.1 终稿）与 [调研报告](../../docs/research/2026-09-22-vendor-code-agent-model-optimizations.md)（七家四期调研，3473 行证据链）。
> **用户拍板（2026-09-22）**：方案方向已认可（"我认可你的方案"）；含对 [`specs/review-ing/model-fleet-adaptation`](../review-ing/model-fleet-adaptation/requirements.md) **R13 的修订**（见 §4）。

## 1. 问题与范围

DeepOrca 的模型语义层目前只覆盖 deepseek/stepfun 两家族；GLM/Kimi/MiniMax/Qwen/MiMo 走 UNKNOWN 兜底。四期调研（7 家厂商官方 harness × 12 维度 + 双角度复核 599 断言 + 子家族代际专项）确认三类缺口：

1. **家族与子家族断层**：同一厂商内部存在代际/架构断层（kimi k2.5–k2.8 与 K3 是两代架构且 K2.8 经 `kimi-for-coding` 别名换模型而 id 不变；MiniMax M2/M3/M3.1 三分——M3.1 为 forced_on+档位+离散窗口；GLM 5.3 与 5.3-flash 一文本一视觉；DeepSeek V4 与 V4.1 架构两代 wire 趋同；StepFun step-5-preview（1M，Step Plan 通道）与 step-3.x（256K）断层且 DeepOrca 现条目按 3.7 编写——step-5 用户会提前 4 倍压缩）。一家一画像粒度不足。
2. **专属优化缺失**：token 消耗（压缩公式/分层/工具面收窄）与缓存命中（锚点/装配指纹/前缀稳定）两大类 harness 级优化，七家全部具备而 DeepOrca 基本没有。
3. **生效机制缺失**：专属优化何时应用、何时不适用，需要「命中 + 端点试探 + 兜底」的完整机制（纯模型串匹配对"同 id 换模型"天然失效）。

**范围**：上表白名单型号的专属优化；白名单外一切模型走兜底。**白名单语义**：命中白名单（或别名）→ 该家族专属优化；未命中 → 兜底（与今日行为逐字节一致）——同端点的其它型号、未来新型号、权重版本一律兜底，不再前瞻默认。能力数据（窗口/档位/多模态，models.dev 目录驱动）对任意模型继续 fail-open 提供（既有 X3.2 机制，非专属优化）。

## 2. 用户故事

- 作为配置了 Kimi/GLM/MiniMax/Qwen/MiMo 端点的用户，我希望模型匹配自动套用该家族的专属优化，不需要手工配置。
- 作为使用子家族新款（K3/M3.1/5.3-flash/3.8-next）的用户，我希望代际差异被正确区分，不会拿到 5 倍错误的窗口或错误的思考协议。
- 作为使用第三方网关的用户，我希望优化先乐观应用、被端点拒绝时精确降级该维度并同轮重发，其余维度不受连坐。
- 作为使用未识别模型的用户，我希望行为与今天完全一致（逐字节），升级零风险。
- 作为 DeepSeek 现有用户，我希望请求逐字节不变（零回归）。
- 作为维护者，我希望新增家族/子家族只改注册表条目，调用点零改动；未来新型号尽量零改码（前瞻默认+显式钉旧）。

## 3. 验收标准（EARS）

- **R1 五段命中**：`resolveModelProfile` shall 依序经 别名解析（alias）→ 具名覆盖 → 子家族 pattern → 家族 pattern → UNKNOWN 解析；**家族与子家族判定只依据模型串与目录 `family` 字段，不读取 baseURL/端点/节点**。
- **R2 子家族分层**：至少下列子家族 shall 分开登记并可分别命中——kimi-k2（k2.7-code 为 always-thinking、disableField='thinking'）vs kimi-k3；minimax-m2\* vs MiniMax-M3（精确）vs MiniMax-M3.1；glm vs glm-flash（5.3-flash 原生视觉）；deepseek-flash vs deepseek-thinking；step-5（前瞻默认 1M）vs step-3.7（256K）vs step-3.5（档位仅 [low,high]）。
- **R3 别名层**：已知别名（`kimi-for-coding`/`kimi-code`/`kimi-coding`）命中时，子家族与能力 shall 经运行时目录元数据（support_efforts/default_effort/always_thinking 或目录条目）解析；目录不可用则落家族默认并对该会话启用全维试探。
- **R4 优化优先与试探**：命中家族的 A 类（wire 可见）优化 shall 先按优化态构造请求（乐观）；端点产生**可归因拒绝**（HTTP 400 且满足 §design 6.3 归因判据之一）时，shall 仅禁用该 (通道,模型,维度) 并同轮以默认态重发一次。
- **R5 归因精确性**：auth/配额/限流/内容过滤/上下文溢出类错误 shall not 触发任何优化禁用。
- **R6 B 类直通**：纯本地类优化（压缩策略/循环干预/装配指纹等）shall 随模型匹配直接生效，不参与试探。
- **R7 兜底等价**：未命中家族或 `applied=false` 时，请求与行为 shall 与升级前逐字节相同。**范围澄清（2026-09-23 swarm round-2 F8）**：本条约束的是**画像/请求形状层**（P0.x A 类优化——思考形状、temperature 门控、reasoning 字段链）；B1 spill 落盘指针、B2 工具面收窄、B4 流式静默重试是**模型无关的 harness 层行为**（成本/可靠性优化，对所有模型一致生效），不在本条约束面内。
- **R8 数据外置**：模型能力（窗口/模态/档位值/reasoning 字段名/temperature）shall 全部来自 models.dev 目录（`model-catalog.ts` 扩展解析）或端点运行时元数据；画像模块内 shall not 含能力常量。
- **R9 请求两段式**：请求构造 shall 拆为 `buildBaseRequest()` + `applyOptimizations(base, profile, probeState)`，后者为纯函数、产出可枚举字段集（供拒绝归因）。
- **R10 窗口动态校准**：可归因的 413/上下文溢出（过防误触谓词）shall 记入 per-(模型,通道) 观察值，此后阈值取 min(目录窗口, 观察值)；恢复 shall 压缩后原地重试且有次数上限。
- **R11 deepseek 零回归**：deepseek 家族（端点接受前提下）请求 shall 逐字节不变（golden 测试锁定）。
- **R12 目录 fail-open**：目录缺失/损坏/无该模型时，全部派生 shall 回退与今日等价的行为。
- **R13 零依赖**：画像模块 shall 不 import 任何模块（含 model-catalog），保持 renderer bundle 可用。
- **R14 证据可溯**：每条画像策略 shall 携带 `evidence`（仓库/文件:行号 或目录字段）；无第一方证据的策略 shall 为默认值。

## 4. 业务规则与约束

- **R13（model-fleet-adaptation）修订**：原文"注册表原生登记仅保留 deepseek/stepfun"修订为——**能力与协议数据不再由注册表承载**（交 models.dev + AI SDK）；注册表仅承载**专属家族优化策略 + 子家族 pattern + 第一方域名**，且每条策略须附第一方证据。本修订经用户认可方案方向（2026-09-22），随 P0 实施前在 model-fleet-adaptation spec 补记一行变更记录。
- core 保持 UI-free；画像模块零依赖（可进 `@deeporca/core/capabilities` 子路径 bundle）。
- **wire 参数零臆造**：画像不含 wire 参数名；请求形状由 AI SDK（`@ai-sdk/openai-compatible` 已 pin；MiniMax 第一方走 `@ai-sdk/anthropic`，exact-pin + license 审计）与既有 builder 表承载。
- 不做主动探测请求（试探只在真实请求被拒时发生）；优化禁用首期不做跨会话持久化。
- 不做模型自动选择/智能路由；不改 `SessionMessage` 持久化形状；不引 per-厂商业务 SDK。
- 第一方域名表仅用于试探加速（预置"已知接受"），不参与正确性判定。
- 否定性结论（"未发现"/"不存在"）入文档前须两组以上独立正则交叉验证（四期 grep 假阴性教训）。

## 5. 非目标

- 厂商专有增值特性（context caching API 显式管理、batch 接口）；ZCode 式"多拼写霰弹枪"策略（与既有保守取向相反）；受限表达式 DSL 的完整移植（仅作为 P3 可选，先落静态 patch 表 + 路径冲突检测）；流式重试提交边界、观察式窗口学习之外的三期候补机制（另列 backlog）。
