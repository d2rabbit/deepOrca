# 调研方案：定制“记忆审计子智能体”——把 backpass 的能力自研进 DeepOrca

日期：2026-09-04 · 分支：`feat/modern-ui-redesign` · 性质：方案调研（无代码变更）

> 承接同日 [`2026-09-04-backpass-integration-feasibility.md`](./2026-09-04-backpass-integration-feasibility.md)
> （结论：backpass 不必须集成，其方法论值得借鉴）。本篇回答“**怎么抄**”：不引 external
> CLI，而是让 DeepOrca 用自己的 session 证据、自己的记忆管线、自己的定制子智能体
> 通道，把 backpass 那一套“记忆梯度下降”做进产品。**本方案只出设计，不写代码。**

## 命题映射

| 模块线 | 定位 | 角色 |
| --- | --- | --- |
| 方法论源 | `kunchenguid/backpass` | 借鉴其“跨会话证据 → 记忆规则迭代”的流程骨架与质量门槛（引用/佐证/删除门槛/原子写回/审核闭环），不引其代码或 CLI |
| DeepOrca 证据源 | 会话 JSONL + sessions-index + audit 日志 + L0-L3 记忆 | 用**自有 session 与记忆**作为学习素材，替代 backpass 依赖的外部 harness transcripts |
| DeepOrca 执行通道 | `defineAction` + `runBackgroundLlmTask`/`runSubagent` + `AskUserQuestion` + review 报告面 | 用**定制子智能体**承载“提取证据→生成 proposal→用户逐项审核→写回”全流程 |
| 空白区证明 | `specs/archive/memory-remediation/design.md` | 该 spec 早已把“session→SOP/规则自萃取”定为**后续自研**；backpass 正是这个空白区的现成参照物 |

## TL;DR

| 维度 | 结论 |
| --- | --- |
| 可行性 | **高**。DeepOrca 已具备方案所需全部地基：自有会话证据源、L0-L3 记忆与检索、`runBackgroundLlmTask(profile:"review")` 只读后台循环、`AskUserQuestion` 审核、review 双语 HTML 报告。新增面集中在「证据扫描→gap 聚合→proposal 合成」这一条语义管线 |
| 是否必要 | 非当前必要（无用户诉求驱动）；但若立项，**建议进入 next-version 储备，P0 纯观察、数据决策门定 P1**，与 depth-lane 同套路 |
| 推荐通道 | **`memory.audit` action（defineAction）** 进场即三端可达（LLM 工具 + IPC + MCP）；执行走 `runBackgroundLlmTask({profile:"review"})` 只读审计；审核用 `AskUserQuestion` 逐项 + 自包含双语 HTML 报告；P0 可**零新增 IPC/i18n** |
| 与 backpass 关键区别 | 素材是 DeepOrca 自有 sessions（含 audit 哈希链证据）；产物 sink 对齐**原生 `AGENTS.md`/SKILL.md**；写回只经主会话/权限面，不由后台任务直接写 |
| 红线 | 会话/store 只读；写回必经用户审核 + permission；默认关；fail-open；不污染 L0-L3 运行时记忆 |

---

# Part I 要抄什么

## 1.1 backpass 方法论骨架（借鉴清单）

| # | backpass 机制 | 直接借鉴点 | DeepOrca 对应承载 |
| --- | --- | --- | --- |
| 1 | 跨会话证据聚合 | 每证据必带 transcript 原文引用 | `SessionMessage` 的 `id`/`sessionId`/`tool_call_id` 可精确定位引用 |
| 2 | 佐证门槛 | 新指令默认需 ≥2 个独立 session | `sessions-index` 按 session 聚合，天然可计数 |
| 3 | 删除门槛 | 删除已有指令需多会话 `harm` 证据；单纯不遵守不支持删 | 写入规则时校验“证据强度” |
| 4 | 两种模型分层 | analysis=便宜模型逐会话；synthesis=高推理模型聚合 | `runBackgroundLlmTask` 本身可分层；或 P0 先用单一路线 |
| 5 | 预算/上限 | 单次最多 5 edit、always-loaded token 预算 | proposal 结构上限定 edit 上限 |
| 6 | 原子写回 + freshness | 写回前校验目标文件未变，单文件多 edit 全有或全无 | 写回由主会话/`edit` 工具完成，天然受权限与快照约束 |
| 7 | 拒绝持久化 | 拒绝结果落盘避免同一建议反复出现 | 记忆审计 store 记录 accept/reject |
| 8 | 分析不写仓库 | 提取/聚合阶段零写入 | `profile:"review"` 后台循环无 write，天然满足 |
| 9 | 用户逐项审核 | 浏览器/终端审核闭环 | `AskUserQuestion`（waiting_for_user 暂停/恢复） |

## 1.2 明确不抄的部分

- **不引 backpass CLI / 内部模块 / `acpx` / `lavish-axi`**：外部 harness 依赖、npm-GitHub 版本不同步、外部模型数据处理面，全部通过“用自有 subagent 通道重实现”避开。
- **不引入外部 transcript 来源**：只学 DeepOrca 自有 sessions；Claude/Codex 等外部会话不在本期范围（未来可另议）。
- **bootstrap 行为**（无 memory 文件时自动创建 `AGENTS.md` 指针）**不抄**：DeepOrca 的规则写回必须显式、经用户审核，不做隐式初始化。

---

# Part II 现有地基（每股力都有一手证据）

## 2.1 自有会话证据源（session 格式探明）

- 用户根目录：`resolveConfigRoot()` 若 `~/.deepcode` 存在则用之，否则 `~/.deeporca`（`packages/core/src/common/app-dirs.ts:19-30`）。真实本机走 `~/.deepcode`。
- 项目目录：`projectDir = join(configRoot, "projects", getProjectCode(root))`（`session-manager-persistence.ts:433-442`）。**transcript JSONL 平铺在项目目录根**（`<projectCode>/<sessionId>.jsonl`），不是 `sessions/` 子目录；同目录有 `sessions-index.json`、`usage-ledger.jsonl`、`audit/<sessionId>.jsonl`、`trust.json`、`file-history/`。
- `SessionMessage`（`packages/core/src/session-types.ts:145-159`）：`id/sessionId/role/content/contentParams/messageParams/compacted/visible/createTime/updateTime/meta?`。
  - **tool 消息证据**：`content` 是 `ToolExecutionResult` JSON 字符串，含 **`ok:true/false` + `error`**；`meta.resultMd`（2000 字符截断摘要）、`meta.function`（原始参数）——失败/错误可直接解析。
  - **assistant 消息证据**：`messageParams.tool_calls` + `messageParams.reasoning_content`。
  - **user 消息证据**：`meta.userPrompt.{text,imageUrls,skills,permissions,alwaysAllows,planMode}`。
  - **拒绝证据**：`PERMISSION_DENIED`/`TIMEOUT`/`PROCESS_FAILED` 等 `ToolErrorType`（`common/tool-types.ts:151-185`）；`status:"permission_denied"` + `failReason`（`session-manager-lifecycle.ts:1012-1024`）。
- `SessionEntry`（`session-types.ts:89-123`）：`status/failReason/summary/assistantReply/toolCalls/usage/activeTokens/planMode/askPermissions/isSilentSubagent/workspaceDir` 等——**`failReason`/`status` 是现成的“失败证据”入口**。注意 `isSilentSubagent` 应被排除出审计素材。
- **增强证据源：audit 哈希链日志**。`audit/<sessionId>.jsonl` 记录 `path_gate` 事件（`verdict:"allow"|"deny"` + `scope` + `filePath` + `tool`）、`process_start`、`sandbox_backend`，带 SHA-256 链可 `verifyAuditChain()`（`packages/core/src/sandbox/audit.ts`）。这是比 transcript 更强、**机器可验证**的“失败模式/权限拒绝”证据——审计方案必须纳入。

## 2.2 记忆管线（L0-L3 现状探明）

- `packages/memory/src` 是 TDAI Core 的硬 fork；`MemoryManager` + `DeepOrcaHostAdapter` 对外（`packages/memory/src/index.ts`）。
- L0 会话原始记录（`tdai/core/conversation/l0-recorder.ts`）→ L1 原子事实（`l1-extractor.ts` 带确定性校验器 + 幻觉过滤）→ L2 场景段（`scene-extractor.ts`，输出 `[PERSONA_UPDATE_REQUEST]`）→ L3 user persona（`persona-generator.ts`）。调度器每 10 次会话 / 空闲 600s 触发（**默认 L0-L3 管线开，`settings.memory.enabled` 默认关**）。
- 自动召回：`auto-recall.ts` `performAutoRecall()` → hybrid BM25+embedding RRF 融合 → `prependContext`（动态 L1）+ `appendSystemContext`（persona+场景导航）。**注入只在 `createSession` 一次性发生**（`lifecycle.ts:194-213`），reply 靠 `tdai_memory_search` 工具。
- **已存在**的闭环：① `maybeCaptureMemory(sessionId)`（每天轮结束 capture → L0→L1→…）；② 行为画像 loop（`collectProfile` 最近 20 session，每次创建重算）；③ task-tree 决策点 fork 召回；④ persona 自我更新（`[PERSONA_UPDATE_REQUEST]`）。
- **不存在**的闭环：把 session 历史交给 LLM 提炼成**规则/skill/AGENTS 级记忆并写回**——这正是 `specs/archive/memory-remediation/design.md` §五 2 拍板“后续自研”的空白区。**backpass 补齐的正是这一环。**（运行时 L0-L3 与“规则级记忆”是两回事：前者是向量/场景/画像，后者是显式 `AGENTS.md`/SKILL.md 文本规则。）

## 2.3 定制子智能体通道（机制探明）

- **`defineAction`**（`core/src/actions/define.ts`、`registry.ts`、`types.ts`）：`ActionDefinition{ id, description, parameters(json-schema), sideEffects? }`；dotted id → LLM tool name（`.`→`_`）。注册进 `session-manager-base.ts:391+` 即自动成为 LLM 工具；经 `action-ipc.ts` 自动三端可达（LLM + IPC `action:run` + MCP bridge）——**零新增 IPC**。
- **`runBackgroundLlmTask`**（`core/src/session-manager-tasks.ts:459-826`）：两个 profile——`"default"`（有 write，path-grant 到 `.deeporca/prototypes/`）与 **`"review"`（只读审计：无 write、无 steering、系统 preamble 强制 JSON 输出、工具面 `read,bash` + `mcp__codegraph|serena`）**。审计类子智能体的**直接模板**：OCR delegate review 就是现成先例（`desktop/main/index.ts:273-298` + `tools/ocr-cli.ts:272-307`）。token 记账走 `usage-ledger.jsonl`（source=`background`），不受会话权限门管控但被窄工具面 + path-grant 约束。
- **先例**：`design.materialize`/`prototype.*` 用 `runSubagent`+skill（silent 子会话）；`arch-scan.run` 用 backgroundTask 优先 + subagent fallback。引擎层**没有**独立 persona/工具白名单概念——定制内容全部通过 **skill（SKILL.md）注入**。
- **审核面**：`AskUserQuestion`（一次多问、选项 label、`metadata.kind:"ask_user_question"` + `toolExecutionResult.awaitUserResponse` → 状态 `waiting_for_user` 暂停，恢复走 `sendPrompt` 注入答案文本）；`review.full` 的复合审计 action 模板 + `buildReviewReportHtml`（**自包含 zh/en 双语 label**）+ `review-store`（`<root>/.deeporca/reviews/<id>.html`+`.json`，REPORTS_KEEP=10）+ `withReviewReportSurface`（**action 完成即自动落报告**的 wrapper 模式）。
- **i18n 约束**：新增 `MessageKey` 必须 6 locales 全改（`en.ts` 源语是 `Record<MessageKey,string>` 类型强制）。**规避**：报告走 HTML 自带 label（零 renderer key）；审核走 `AskUserQuestion`（`question.*/common.*` 等 key 已存在）；只有做“审计历史面板”才需新增 ~10-15 个 key。

---

# Part III 方案设计

## 3.1 一句话方案

新增一个**定制记忆审计子智能体**：以 `memory.audit` action 为入口，用 `runBackgroundLlmTask(profile:"review")` 只读扫描 DeepOrca 自有 sessions 与 audit 日志，经「确定性证据扫描 → gap 聚合 → LLM proposal 合成」三段式产出记忆规则增删改建议，用 `AskUserQuestion` 逐项审核 + 自包含 HTML 报告呈现，用户批准后由主会话/`edit` 写回原生 `AGENTS.md`/SKILL.md。

## 3.2 数据流与模块

```text
用户触发 memory.audit (action)
  → runBackgroundLlmTask(profile:"review", skill:"memory-audit")
      ├─ 阶段1 确定性证据扫描（无 LLM）
      │    readSessionTraceSource / listSessionMessages（projectDir, sessionId）
      │    + audit 日志 path_gate/process_start（verifyAuditChain）
      │    → 失败事件表：{sessionId, ts, tool, errorType, ok/error, filePath?, scope?}
      ├─ 阶段2 证据筛选与去重（确定性）
      │    排除 isSilentSubagent；--since/上限；按 session 聚合；gap 候选排序
      └─ 阶段3 LLM proposal 合成（profile:"review"，JSON 契约输出）
            input = 筛选后的证据摘要 + 现有 AGENTS.md/SKILL.md 内容
            output = proposal[] {id, action:add|update|delete, target:agents|skill,
                     ruleText/diff, evidenceIds[], rationale, budgetToken}
  → host 侧（action run 内）落 store（.deeporca/audits/）
  → 返回主会话 → 用户审核（AskUserQuestion 逐项 / HTML 报告）
  → 批准子集约定后，由主会话 agent 用 edit 工具写回（受 permissions 管控）
```

## 3.3 各阶段设计要点

### 阶段1：确定性证据扫描（核心增量工作）
- **数据源**：`projectDir/<sessionId>.jsonl` + `sessions-index.json` + `audit/<sessionId>.jsonl`。
- **现成复用**：desktop `session-trace.ts` 的 `readSessionTraceSource`（L120-149，跨 workspace 安全、只读、容错）+ `normalizeSessionTrace`（L151-236，已实现 tool_call 结果回配与 verdict 解析）——**这是最安全的现成证据管道**。core 侧 `listSessionMessages`（persistence:327-353）也纯读。
- **失败事件定义**：`ok:false` 工具结果、`PERMISSION_DENIED`/`TIMEOUT`/`PROCESS_FAILED`、`status:"failed"`+`failReason`、audit `path_gate verdict:"deny"`。
- **红线**：只读不写；不支持任意绝对路径（走已注册 workspace root / `isKnownRoot` 校验）；`usage-ledger` 与 `.deeporca/` 其它目录不触碰。

### 阶段2：证据筛选与 gap 聚合
- 去重（同一 `tool_call_id`/同一失败文本）、按 session 计数、排除 single-occurrence 噪音；可借鉴 backpass 的「≥2 独立 session 佐证」作默认阈值（可配置）。
- 轻量规则可完全确定性（如“某命令反复 PERMISSION_DENIED → 建议加入 alwaysAllow 白名单”）；复杂语义 gap（“总在同一类任务上犯错”）推给阶段3 LLM。

### 阶段3：proposal 合成（LLM，JSON 契约）
- 复用 `runBackgroundLlmTask` 的 `profile:"review"`：**系统 preamble 强制 JSON、无 write、窄工具面**，天然保证“分析阶段不写仓库”。
- 输入控制：只给证据摘要 + 现有记忆文件，不把整段原始 transcript 塞给模型（backpass 的 distill/redact 思路，用 DeepOrca 自有 `meta.resultMd` 摘要即可）；需明确哪些内容会进入模型 prompt（对外部 provider 的说明）。
- 输出 schema：`proposal[] {id, action:add|update|delete, target:agents|skill, ruleText/diff, evidenceIds[], rationale, estTokens}`，限定最大 edit 数（默认 5），超标走“收缩计划”（先落高置信项）。

### 审核与写回
- **审核**（P0 推荐）：`AskUserQuestion` 逐项接受/拒绝/跳过 → `waiting_for_user` 暂停 → 答案注入恢复；再配一份 `buildReviewReportHtml` 风格的自包含双语 HTML（`<root>/.deeporca/audits/<id>.html`+`.json`，继承 `review-store` 的写读/修剪模式）供完整上下文查看。
- **写回**：**不由后台任务直接写**（review profile 无 write 是对的）。用户批准后，由**主会话 agent** 用原生 `edit` 工具写 `AGENTS.md`/SKILL.md——这样自动获得 permission 管控 + 文件快照 + 审计日志（`edit` 工具路径天然 fall 进 `computeToolCallPermissions`）。
- **拒绝持久化**：接受/拒绝结果写入 audit store，避免同一建议反复出现（对应 backpass `rejections.json`）。
- **freshness 语义**：`edit` 工具的 snippet 机制（read 返回 `snippet_id`，edit 只搜该 snippet）本身即是“写回前校验文件未变”的近似实现。

## 3.4 与现有记忆/审查体系的边界（防混淆）

| 系统 | 已有/将做 | 与 `memory.audit` 的关系 |
| --- | --- | --- |
| L0-L3 运行时记忆（`@deeporca/memory`） | 已实现 | **不写它**：memory.audit 只把它当“参考/去重”源，不向 L0-L3 写入合成规则 |
| activity-frames 行为画像 | 已实现（管线 B 每 session 重算） | 可作为“行为侧证据”补充输入（`collectProfile`），但 audit 不重复造此轮 |
| review.full / OCR delegate | 已实现 | 复用其 `profile:"review"` 通道与报告 HTML 模式；audit 是“记忆/规则”维度的另一条只读审计 |
| `core/skill/` 对话→SOP 萃取 | **仅计划（spec §五 2 空白区）** | memory.audit 是这一空白区的**第一个具体形态**：其产物 sink 对齐原生 SKILL.md（与 spec 的“硬约束”一致），若未来做通用 SOP 萃取，audit 的 proposal 管线可复用 |

---

# Part IV 分期与验收

## 4.1 分期（若立项）

- **P0｜纯观察（先做，无 UI 改动）**：`memory.audit` action + `runBackgroundLlmTask(profile:"review")` + “确定性证据扫描（阶段1-2）”→ 输出 JSON 证据快照。**只观察**：真实项目里能扫出多少/哪些失败模式、证据质量如何、误报率。数据进 `usage-ledger`（source=`background`）即可读 token 成本。**决策门**：P0 数据证明“值得”才进 P1。
- **P1｜proposal 合成 + 审核**：阶段3 LLM 合成（JSON 契约）+ `AskUserQuestion` 逐项审核 + 自包含 HTML 报告 + 拒绝持久化。仍**不自动写回**。
- **P2｜受控写回**：用户批准后主会话 `edit` 写 `AGENTS.md`/SKILL.md（全量 permissions + 快照 + audit 链）；freshness/原子性经由 `edit` 机制天然获得。
- **P3（可选）｜泛化**：把 proposal 管线抽成通用“规则/SOP 萃取”通道（对齐 `core/skill/` 空白区）；或打通 activity-frames 行为侧 + L0-L3 召回侧作为证据补充。

## 4.2 验收建议（仅做时）

- 只读性：P0/P1 全程不产生 `AGENTS.md`/SKILL.md 之外任何写；写回仅 P2 用户批准后发生。
- 证据可溯：每条 proposal 的 `evidenceIds[]` 能展开到具体 `sessionId + tool_call_id` 与 audit 哈希链。
- 佐证阈值：删除/新增规则默认需 ≥2 独立 session（可配置），单例噪音不进 proposal。
- 预算：proposal 默认 ≤5 edit；`usage-ledger` 中 background 任务的 token 有据可查。
- 审核闭环：拒绝项不会反复出现（有 rejections 持久化证据）。
- 权限：写回走原生 permission（ask/deny）；Plan Mode 下 force-ask 生效。
- i18n/IPC：P0-P1 零新增 `MessageKey` 与 `IpcRequest`（报告 HTML 自带 label；AskUserQuestion key 已存在）；若做 P3 面板再评估。

---

# Part V 风险与遗留

| 风险 | 说明 | 对策 |
| --- | --- | --- |
| “从失败提炼规则”因果归因不可靠 | 与 backpass VISION 同题：证据门槛降低但无法证明因果；一次错误误升为全局规则 | 佐证门槛 + 用户逐项审核 + 默认关 |
| 会话/store 数据敏感 | transcript 携带用户代码/工具输出；audit 日志含绝对路径 | 只读 + 已注册 root + 报告/摘要不进外部 prompt 未经 redaction；明确“哪些内容会发给外部 provider” |
| 写回质量 | 直接改 AGENTS.md 风险高 | 只在 P2 用户批准后由主会话 edit 写回；单文件多 edit 全有或全无（edit 机制） |
| 与 L0-L3 冲突 | 合成规则可能重复/覆盖现有记忆 | memory.audit 只读参考现有记忆，写回 sink 是显式 `AGENTS.md`/SKILL.md，两套边界清晰 |
| 极新项目参照物 | backpass API/行为变化快 | 我们只借方法论不借代码；方法论本身稳定 |
| 成本 | 阶段3 LLM 合成有 token 开销 | P0 纯观察先验证 ROI；`usage-ledger` 可量化 |
| 平台 | 本仓 Windows 优先开发 | 证据扫描走 Node 只读 API，跨平台无 shell 依赖；audit 哈希链校验为纯 JS |

**未决拍板项**：① P0 证据扫描是否默认含 audit 哈希链日志（建议含，是机器可验证证据）；② 佐证阈值默认值（建议 2，可配置）；③ 产物目录用 `.deeporca/audits/`（沿用 reviews 模式）还是并入某个既有 store；④ 是否在 P0 就纳入 activity-frames 行为侧证据（建议 P0 不纳入，先验证最小闭环）。

---

## 结论

DeepOrca 已具备把 backpass 方法论“抄进自家体系”的完整地基：**自有会话证据（含 audit 哈希链）**、**L0-L3 记忆管线**、**`runBackgroundLlmTask(profile:"review")` 只读审计通道**、**`AskUserQuestion` + 双语 HTML 审核面**；`defineAction` 三端自动承接意味着 IPC/i18n 在 P0-P1 可零新增。真正的增量只有“证据扫描→gap 聚合→proposal 合成”这一条语义管线，以及一条“只经用户审核后写回原生 `AGENTS.md`/SKILL.md”的受控写回路径。

建议：**按 next-version 储备立项，P0 纯观察先行**（只做确定性证据扫描，数据决策门定 P1）。本方案不写码、不落 spec（总口径：调研仅供参考，实现以 specs/ 为准）。