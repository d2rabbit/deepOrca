# 记忆审计子智能体（memory-audit）· 自有证据 → 记忆规则迭代 — 技术设计

> **状态**：**P0+P1+P2 全部落地（2026-09-04，用户拍板跳过数据门直接干完）：扫描 19b3bcf9 + 合成/审核/写回（本轮收尾提交）——synthesis 走 completeViaLlm+schema 契约（P1.1 通道适配见 tasks），决策持久化任何已决项不再重现，接受项回 controlled write-back 指令（原生 edit 工具）；P3 泛化另行立项**——上游调研已定稿：可行性轮 [`docs/research/2026-09-04-backpass-integration-feasibility.md`](../../docs/research/2026-09-04-backpass-integration-feasibility.md)（结论：backpass 不集成，只借方法论）+ 方案轮 [`docs/research/2026-09-04-memory-audit-subagent-proposal.md`](../../docs/research/2026-09-04-memory-audit-subagent-proposal.md)（本 spec 的直接依据，全部 file:line 取证在案）。归档于 [research-adoption-plan](../../docs/features/research-adoption-plan.md) 三线之一。
> **上游提案**：把 backpass 的「跨会话证据 → 记忆规则迭代」自研进 DeepOrca——用自有 session 证据 + 自有记忆管线 + 自有子智能体通道，不引 external CLI。
> **对应实现域**：`core/`（`memory.audit` action + 证据扫描 + proposal 管线）与 `desktop/`（报告/store，P1 起）。**活跃 spec（本阶段实施，不属 `next-version` 规划区）**。
> **硬约束**：零新依赖、不引 backpass 代码/CLI/`acpx`；会话与 store 全程只读；写回只经主会话权限面；默认关闭、fail-open；不向 L0–L3 运行时记忆写入任何合成规则。

---

## 0. 背景与结论

### 0.1 提案是什么（一句话）

新增一个定制记忆审计子智能体：以 `memory.audit` action 为入口，用 `runBackgroundLlmTask(profile:"review")` 只读扫描自有 sessions 与 audit 日志，经「确定性证据扫描 → gap 聚合 → LLM proposal 合成」三段式产出记忆规则（`AGENTS.md`/SKILL.md）增删改建议，`AskUserQuestion` 逐项审核 + 自包含双语 HTML 报告，用户批准后由主会话 `edit` 写回。

### 0.2 适配判定（TL;DR，取证见调研方案轮 Part II）

1. **地基全在**：自有会话证据（transcript JSONL + `sessions-index` + **audit 哈希链日志**——机器可验证的 path_gate deny/process_start 证据）；L0–L3 记忆管线（只当参考源，不写入）；`runBackgroundLlmTask(profile:"review")` 只读后台循环（窄工具面 `read,bash` + `mcp__codegraph|serena`，系统 preamble 强制 JSON，无 write）；`AskUserQuestion` 审核闭环 + `buildReviewReportHtml` 双语报告面。
2. **增量只有一条语义管线**：证据扫描 → gap 聚合 → proposal 合成。`defineAction` 注册即三端可达（LLM 工具 + IPC + MCP），P0–P1 **零新增 IPC / 零新增 i18n key**（报告 HTML 自带 label；`AskUserQuestion` key 已存在）。
3. **空白区对位**：`specs/archive/memory-remediation/design.md` §五 2 早已把「session → SOP/规则自萃取」拍板为后续自研空白区——本 spec 是该空白区的第一个具体形态；运行时 L0–L3（向量/场景/画像）与规则级记忆（显式 `AGENTS.md`/SKILL.md 文本）是两回事，边界见 §2.5。
4. **推进纪律与 depth-lane 同套路**：**P0 纯观察先行，数据决策门定 P1**——本阶段即启动 P0，观察期从简（目标是快速拿到真实项目的失败模式数据，决定 P1 是否同版本推进；门未过则封存为单发的确定性扫描工具）。

### 0.3 借鉴清单与红线（backpass 方法论 → 本仓承载）

借鉴九法（每证据必带引用 / 佐证 ≥2 独立 session / 删除需 harm 证据 / 双模型分层 / 单次 ≤5 edit / 原子写回+freshness / 拒绝持久化 / 分析不写仓库 / 用户逐项审核）在 §2 逐条有承载；**明确不抄**：backpass CLI/内部模块/`acpx`/`lavish-axi`、外部 transcript 来源（Claude/Codex 等不在本期）、bootstrap 隐式初始化（写回必须显式经用户审核）。

---

## 1. 现状与证据（调研方案轮 Part II 全量在案，此处只列落点锚）

| 地基 | 锚点 | 用途 |
| --- | --- | --- |
| 会话证据源 | `<configRoot>/projects/<projectCode>/<sessionId>.jsonl` 平铺（`session-manager-persistence.ts:433-442`）；`SessionMessage`（`session-types.ts:145-159`）tool 消息含 `ok/error` + `meta.resultMd`/`meta.function`，user 消息含 `meta.userPrompt`；`SessionEntry.failReason/status`（:89-123）是现成失败入口 | 阶段 1 扫描输入 |
| audit 哈希链 | `audit/<sessionId>.jsonl`（path_gate verdict/scope/filePath + process_start + sandbox_backend，SHA-256 链 `verifyAuditChain()`，`core/src/sandbox/audit.ts`） | 比 transcript 更强的机器可验证证据 |
| 现成证据管道 | desktop `session-trace.ts` 的 `readSessionTraceSource`（跨 workspace 安全只读容错）+ `normalizeSessionTrace`（tool_call 结果回配 + verdict 解析）；core `listSessionMessages`（persistence:327-353）纯读 | 阶段 1 直接复用，不自造读取层 |
| 只读执行通道 | `runBackgroundLlmTask(profile:"review")`（`session-manager-tasks.ts:459-826`）：无 write、无 steering、强制 JSON、窄工具面；OCR delegate review 是现成先例 | 阶段 3 LLM 合成载体 |
| action 三端承接 | `defineAction`（`core/src/actions/`）注册进 `session-manager-base.ts:391+` 自动成为 LLM 工具 + IPC `action:run` + MCP bridge | 入口，零新增 IPC |
| 审核与报告面 | `AskUserQuestion`（`waiting_for_user` 暂停/恢复）；`buildReviewReportHtml` 自包含双语 + `review-store`（`<root>/.deeporca/reviews/`，KEEP=10）+ `withReviewReportSurface` wrapper | P1 审核闭环 |
| 写回权限面 | 主会话原生 `edit` 工具：read `snippet_id` → edit 只搜该 snippet（freshness 近似）+ `computeToolCallPermissions` + 文件快照 + 审计链 | P2 受控写回 |

## 2. 设计

### 2.1 数据流（三段式管线）

```text
用户触发 memory.audit (action)
  → runBackgroundLlmTask(profile:"review", skill:"memory-audit")
      ├─ 阶段1 确定性证据扫描（零 LLM）
      │    复用 readSessionTraceSource / listSessionMessages + audit 链 verifyAuditChain
      │    → 失败事件表 {sessionId, ts, tool, errorType, ok/error, filePath?, scope?}
      ├─ 阶段2 证据筛选与 gap 聚合（确定性）
      │    排除 isSilentSubagent；--since/上限；按 session 聚合去重（同 tool_call_id/同失败文本）；
      │    佐证计数（≥2 独立 session 默认阈值）；确定性规则直出（如反复 PERMISSION_DENIED → alwaysAllow 建议）
      └─ 阶段3 LLM proposal 合成（profile:"review"，JSON 契约）
            input = 筛选后证据摘要（meta.resultMd，不塞原始 transcript）+ 现有 AGENTS.md/SKILL.md 内容
            output = proposal[]（schema 见 §2.3）
  → host 侧落 store（<root>/.deeporca/audits/<id>.json，沿用 review-store 写读/修剪模式）
  → 返回主会话 → AskUserQuestion 逐项审核（P1）+ HTML 报告
  → 用户批准子集后，由主会话 agent 用原生 edit 写回（P2，全量 permissions + 快照 + audit 链）
```

### 2.2 阶段要点

- **阶段 1（核心增量）**：失败事件定义 = `ok:false` 工具结果 / `PERMISSION_DENIED|TIMEOUT|PROCESS_FAILED`（`common/tool-types.ts:151-185`）/ `status:"failed"`+`failReason` / audit `path_gate verdict:"deny"`。红线：只读；仅已注册 workspace root（`resolveRegisteredRoot`/`isKnownRoot`），不触碰 usage-ledger 与 `.deeporca/` 其它目录。
- **阶段 2**：轻量规则完全确定性直出（单例噪音不进 proposal）；复杂语义 gap（"总在同一类任务上犯错"）推阶段 3。
- **阶段 3**：输入脱敏纪律——只给证据摘要与现有记忆文件，明确哪些内容会进模型 prompt（对外部 provider 的数据面说明）；输出超标（>5 edit）走"收缩计划"先落高置信项。

### 2.3 proposal 输出契约（阶段 3 JSON schema）

```ts
type MemoryAuditProposal = {
  id: string;                        // 稳定 id，审核与拒绝持久化都锚它
  action: "add" | "update" | "delete";
  target: "agents" | "skill";        // AGENTS.md 或某 SKILL.md
  ruleText?: string;                 // add/update 的新文本
  diffHint?: string;                 // update/delete 的定位提示（非直接 patch）
  evidenceIds: string[];             // 可展开到 sessionId + tool_call_id / audit 链
  rationale: string;
  estTokens: number;                 // always-loaded 成本估算
};
```

### 2.4 审核与写回

- **审核（P1）**：`AskUserQuestion` 逐项接受/拒绝/跳过 → `waiting_for_user` → 答案注入恢复；`buildReviewReportHtml` 风格自包含双语 HTML 落 `<root>/.deeporca/audits/<id>.html`+`.json`。
- **拒绝持久化**：接受/拒绝结果写 audit store（对应 backpass `rejections.json`），同一建议不再反复出现。
- **写回（P2）**：**后台任务不直接写**（review profile 无 write 是对的）；用户批准后由主会话 agent 用 `edit` 写——天然获得 permission 管控 + 文件快照 + 审计日志；freshness 由 edit 的 snippet 机制近似（写回前文件已变则 snippet 失配报错，全有或全无）。
- **删除门槛**：delete 类 proposal 需多会话 harm 证据（默认 ≥2 独立 session），单纯"不遵守"不支持删。

### 2.5 边界（防混淆，逐系统划清）

| 系统 | 关系 |
| --- | --- |
| L0–L3 运行时记忆（`@deeporca/memory`） | **只读参考/去重源**，绝不写入合成规则 |
| activity-frames 行为画像 | 可作补充输入，**P0 不纳入**（先验证最小闭环） |
| review.full / OCR delegate | 复用其 `profile:"review"` 通道与报告模式；audit 是"记忆/规则"维度的另一条只读审计 |
| CMB 台账（`specs/archive/cmb-adoption/`） | CMB-2/7 改的是 L1 抽取与渲染（运行时记忆质量）；本 spec 改的是规则级记忆——同属"记忆供给面"但互不重叠；CMB-9（结构债调度）若未来启动，其 top-K 审计思想与本 spec 的 gap 排序同源 |
| depth-lane | 无直接依赖；同享"P0 观察 → 数据决策门"纪律（research-adoption-plan 统一时序） |

## 3. 分期

| 期 | 内容 | 门槛 |
| --- | --- | --- |
| **P0 纯观察** | `memory.audit` action + 阶段 1–2 确定性扫描 → JSON 证据快照（含 audit 链）；零 UI、零写回 | **数据决策门**：真实项目扫出的失败模式数量/证据质量/误报率证明 ROI，才进 P1 |
| **P1 proposal + 审核** | 阶段 3 LLM 合成（JSON 契约）+ `AskUserQuestion` 逐项 + 双语 HTML 报告 + 拒绝持久化；仍不自动写回 | 人工审核通过率与 token 成本（usage-ledger source=`background`）|
| **P2 受控写回** | 用户批准后主会话 `edit` 写 `AGENTS.md`/SKILL.md | 全量 permissions + 快照 + audit 链 |
| **P3（可选）泛化** | proposal 管线抽成通用"规则/SOP 萃取"通道（对齐 `core/skill/` 空白区）；打通行为侧 + 召回侧证据 | 另行立项 |

## 4. 明确不做（决策留痕）

1. **不引 backpass CLI / 内部模块 / `acpx` / `lavish-axi`**；不接外部 transcript 来源（Claude/Codex 等，未来另议）。
2. **不做隐式 bootstrap**（无记忆文件时自动建 `AGENTS.md` 指针）——写回必须显式经用户审核。
3. **不向 L0–L3 写入**；不重造行为画像（activity-frames 已有）。
4. **P0–P1 零新增 `MessageKey` 与 `IpcRequest`**；若 P3 做审计历史面板再评估 i18n（~10-15 key ×6 locale）。
5. **后台任务永不直接写仓库文件**——这是通道选型（profile:"review"）的既定结论，不做例外。

## 5. 回写规则

落地任一期：调研方案轮 README 行推进消费状态；本 spec 状态行更新；按 [`specs/README.md`](../README.md) 流转口径收官归档。

## 6. 拍板项（默认值已定，开工时逐项确认）

| # | 事项 | 决定 | 理由 |
| --- | --- | --- | --- |
| 1 | P0 证据是否含 audit 哈希链日志 | **含** | 机器可验证（SHA-256 链），比 transcript 更强 |
| 2 | 佐证阈值默认值 | **2 个独立 session**（可配置） | backpass 同款；单例噪音不进 proposal |
| 3 | 产物目录 | **`<root>/.deeporca/audits/`**（沿用 reviews 模式：html+json、KEEP 修剪） | 与 review-store 同构，零新基建 |
| 4 | P0 是否纳入 activity-frames 行为侧证据 | **不纳入** | 先验证最小闭环，P3 再扩 |
| 5 | 阶段 3 双模型分层（便宜分析 × 高推理合成） | **P0–P1 单路线**（profile:"review" 单层） | 先验证 ROI；分层等 P1 数据再定 |
