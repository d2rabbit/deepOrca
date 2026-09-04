# CodeBrain / MemBrain 理念采纳（cmb-adoption）— 任务指引（待开工）

> 日期：2026-09-04 建立 · 状态：**四批次 A-D 全部落地（2026-09-04，提交 007d57e8 / 584440aa / 95e0ac5d / 1e5cdf95；含 mutation-check 与全量回归）**
> 阶段模型：**预研 → 设计 → 任务**，三层在当前树内可查：
>
> | 层   | 文档                                                                                                                                  | 现状 |
> | ---- | ------------------------------------------------------------------------------------------------------------------------------------- | ---- |
> | 预研 | [`docs/research/2026-08-17-hallmark-codebrain-membrain-prestudy.md`](../../docs/research/2026-08-17-hallmark-codebrain-membrain-prestudy.md)（可行性轮，P0-P2 已落地）· [`2026-09-04-codebrain-membrain-philosophy.md`](../../docs/research/2026-09-04-codebrain-membrain-philosophy.md)（理念轮） | ✅   |
> | 台账 | [`docs/research/2026-09-04-codebrain-membrain-issues.md`](../../docs/research/2026-09-04-codebrain-membrain-issues.md)（CMB-1~11 唯一跟踪点）                                                        | ✅   |
> | 设计 | [`design.md`](./design.md)（§1 取证 / §2 分批设计 / §6 拍板项）                                                                       | ✅   |
> | 任务 | **本文件**                                                                                                                            | ⏳ 待开工 |
>
> **开工顺序**（继承台账）：批次 A → B → C → D；批次内顺序即任务编号。每批完成即回写台账总览表（✅ + 提交号 + 验收证据），全批完成按 [`specs/README.md`](../README.md) 流转口径归档。

## 硬约束（每批适用）

- 零新依赖；不引上游代码（MemBrain 无 LICENSE，禁止拷贝）。
- 全部改动为模型面/日志面，**无 renderer 文案、不进 i18n 6 目录**。
- 路径判断复用生产路径助手，不做手搓分隔符替换（AGENTS.md 跨平台路径策略）。
- 每个新增测试做一次 **mutation-check**（临时破坏被测实现确认测试失败后还原）。

## 批次 A · 诊断诚实化（CMB-1 + CMB-5，~1d，缺陷修复优先）

- [x] **A-1（CMB-1）** `DiagnosticsLegResult` 增 `status: "ok" | "unavailable"` + `unavailableReason?`；两处 `catch` 记录 unavailable（原因摘要 ≤120 字符）—— `core/src/session-manager-diagnostics.ts`（0.25d）
- [x] **A-2（CMB-1）** `buildDiagnosticsSystemMessage` 重写真值语义：真 clean（期望腿全 ok 且零错误）才返回 null；存在 unavailable 腿必注入降级行（含"无错误≠检查通过"）；截断只削错误正文、降级行豁免 —— 同文件（0.25d）
- [x] **A-3（CMB-1）** 纯函数真值表测试五格：真 clean / 单腿 unavailable / 双腿 unavailable / 有错误混 unavailable / 期望腿为空 → null —— `core/src/tests/session-manager-diagnostics.test.ts` 扩展（0.25d）
- [x] **A-4（CMB-5）** 桥内 deps 就绪探测 helper（三族判据表：TS=node_modules / Python=.venv|venv / Go=go.sum；无依赖声明零干扰）—— `desktop/src/main/tools/lsp-bridge/deps-readiness.ts` 新文件（0.25d）
- [x] **A-5（CMB-5）** 接线：`get_diagnostics` 路由后、spawn 前探测；missing 走 **isError/异常通道** 返回 `LSP_UNAVAILABLE(deps-missing)` + 补救指引（禁止正常结构返回，design §1.2 陷阱）—— 桥 server 侧（0.25d）
- [x] **A-6（CMB-5）** 三族真值表单测（跨平台 tmpdir 构造）+ core 侧集成断言（deps-missing → 诊断消息含降级原因与指引）—— desktop + core tests（0.25d）

## 批次 B · 记忆供给面（CMB-2 + CMB-7，~1-2d，memory 域独立可并行）

- [x] **B-1（CMB-2）** `EXTRACT_MEMORIES_SYSTEM_PROMPT` 增规则 6/7/8：分界语义补全（禁再抽取上文已确立事实）/ final sweep 输出前终检 / 逐字保留清单 —— `memory/src/tdai/core/prompts/l1-extraction.ts`（0.25d）
- [x] **B-2（CMB-2）** 软校验：抽出内容专名不在源文本 → `logger.warn` 可观测不丢弃（与 08-17 #3 同款处置，落点同文件族）—— `memory/src/tdai/core/record/l1-extractor.ts`（0.25d）
- [x] **B-3（CMB-2）** `l1-validation.test.ts` 字符串断言扩展三规则关键词 + 软校验告警路径测试；既有 L1 用例零回归（0.25d）
- [x] **B-4（CMB-7）** 相对时间预解析 helper（中英词表：今天/昨天/前天/上周/上上周/上个月/最近 + 英文对等；锚=记录 timestamp；换算不了保留原样 + `（源未锚定）`）—— `memory/src/tdai/core/hooks/` （0.25d）
- [x] **B-5（CMB-7）** `formatMemoryLine` 获知时间分离：两个活动时间字段均空且 `timestamp` 有值的行追加 `（记录于 <timestamp>）` —— `auto-recall.ts`（0.25d）
- [x] **B-6（CMB-7）** 中英换算真值表（各 ≥5 例 + 无锚保留 + 词表外保留）+ `formatMemoryLine` 渲染回归（0.25d）
- [x] **B-7（CMB-8 前置，顺带）** depth-lane design 补一行 MemBrain 第二实现者论据 —— `specs/next-version/depth-lane/design.md`（10min）

## 批次 C · 编辑即提醒（CMB-3，~1d）

- [x] **C-1** 代码类扩展名共享 helper（对齐 lsp-diagnostics 十族集合；常量落 core `tools/`，注释注明与 desktop `server-specs.ts` 对齐，**禁止 core→desktop 反向依赖**）（0.25d）
- [x] **C-2** `edit-handler.ts` 成功路径 output 追加 `（已修改 <file>，建议立即运行诊断检查该文件。）`——仅代码类扩展名；不承诺回合末自动复核（design §6 拍板 3）（0.25d）
- [x] **C-3** `write-handler.ts` 同款处理（0.25d）
- [x] **C-4** handler 测试：代码类扩展名 output 追加行存在 / 非代码（.md/.txt）不存在；回合末诊断桥行为不变（0.25d）

## 批次 D · 辅助调用契约（CMB-4，~1-2d，改动面最大故最后做）

- [x] **D-1** `common/aux-llm-contract.ts` 新文件：`AuxSchema<T>` 纯函数校验器类型 + `AUX_CONTENT_RETRY_BUDGET = 2` 常量（零依赖）（0.25d）
- [x] **D-2** `judgeViaLlm` 增可选 `opts.schema`；既有 choices 校验收编为内置 schema；内容级失败重试 ≤ 预算、耗尽 fail-open null —— `session-manager-base.ts`（0.5d）
- [x] **D-3** `completeTextViaLlm` 增可选 `opts.schema` 同款语义（0.25d）
- [x] **D-4** 两原语 JSDoc 契约：输入预算/输出 schema/重试预算/fail-open/auxiliary 记账义务（0.25d）
- [x] **D-5** 示范模板化（单点）：`templates/auxiliary/skill-matching.md.ejs` 新增；`session-manager-skills.ts:100-130` 内联 prompt 改 `getExtensionRoot()` 读取渲染（复用 prompt.ts EJS 加载模式）（0.5d）
- [x] **D-6** 校验器真值表 + 重试预算测试（内容级计次/预算耗尽 null）+ **mutation-check 一次** + 既有 8 调用点回归（0.5d）

## 收尾

- [x] 全批完成后：`npm run check && npm test` 全绿（2026-09-04：build/typecheck/lint/test 全绿，Node 24.19）（Node ≥22.5，绝对路径 `/Users/kelthas/.nvm/versions/node/v24.19.0/bin`）；台账总览表 CMB-1/2/3/4/5/7 逐行回写 ✅ + 提交号 + 验收证据（007d57e8 / 584440aa / 95e0ac5d / 1e5cdf95）；`docs/research/README.md` 消费状态推进；本 spec 按 specs/README.md 流转口径归档（四批次全落地，待归档动作）。
