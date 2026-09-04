# 记忆审计子智能体（memory-audit）— 任务清单

> 对应设计：[design.md](./design.md)。2026-09-04 立稿。**P0+P1+P2 全部落地（同日，用户拍板跳过数据门直接干完）。****P0 全部落地（19b3bcf9，同日；P0.7 首轮真实数据已采——维持 P0 观察态，n=2 不足以判 P1，下次评估门槛 ≥20 会话）；P1/P2 等门。**
> 拍板项默认值见 design §6（audit 链纳入 / 佐证阈值 2 / `.deeporca/audits/` / P0 不含行为侧 / 单路线合成）。
> 纪律：会话与 store 全程只读；P0–P1 零新增 IPC 与 i18n key；fail-open；usage-ledger source=`background` 记账。

## P0 纯观察（确定性证据扫描，数据决策门）

- [x] **P0.1** `core/actions/memory-audit.ts`：`memory.audit` action（defineAction，参数 `{since?, maxSessions?, dryRun?}`；sideEffects 声明 `read-in-cwd`）+ `session-manager-base.ts` 注册两行（action 定义随 19b3bcf9；注册两行随 1e5cdf95）
- [x] **P0.2** 阶段 1 确定性证据扫描：复用 `listSessionMessages` / `readSessionTraceSource` 读 transcript JSONL + `sessions-index`；失败事件抽取（`ok:false` / `PERMISSION_DENIED|TIMEOUT|PROCESS_FAILED` / `status:"failed"`+`failReason`）；排除 `isSilentSubagent`
- [x] **P0.3** audit 哈希链证据接入：`audit/<sessionId>.jsonl` path_gate deny / process_start 事件 + `verifyAuditChain()` 校验结果入证据表
- [x] **P0.4** 阶段 2 筛选聚合：去重（同 tool_call_id/同失败文本）+ 按 session 佐证计数（阈值 2 可配置）+ 确定性规则直出（如反复 PERMISSION_DENIED → alwaysAllow 候选）
- [x] **P0.5** 观察产物：JSON 证据快照落 `<root>/.deeporca/audits/<id>.json`（沿用 review-store 写读/修剪模式）；`dryRun` 默认 true（只返回摘要不落盘）
- [x] **P0.6** 测试：扫描真值表（各 errorType / 排除 silent / 佐证阈值边界 / audit 链损坏容错 fail-open）+ 只读性断言（全程零写）+ mutation-check 一次
- [x] **P0.7** 数据决策门报告：真实项目采样——失败模式数量/证据质量/误报率/token 成本（usage-ledger source=`background`）；结论回写本文件与 design 状态行
  - **首轮数据（2026-09-04，本仓自身项目存储 dryRun 扫描）**：2 会话全量扫描，1 个已佐证模式 `session-failed|API key not found`（2/2 独立会话，证据清晰、零明显误报）；无 permission-denied 候选；audit 链文件 0（该项目未启用/未留存，fail-open 生效）。零 LLM 消耗（P0 纯确定性扫描本无 token 成本）。
  - **门结论**：扫描器在真实数据上端到端可用且信号干净；但样本量（n=2 会话）不足以判定 P1（proposal 合成）ROI——**维持 P0 观察态**，随日常使用积累数据（下次评估门槛：≥20 会话或 ≥3 个已佐证模式）；发现的 `API key not found` 会话失败模式已移交配置校验方向（属会话创建前置校验，不归记忆审计管）。

## P1 proposal 合成 + 审核（仍不写回）

- [x] **P1.1** 合成指令与执行 —— **通道适配**：未走 runBackgroundTask+skill（无需工具面，合成是单次结构化补全），改 `ctx.completeViaLlm` + `applyAuxSchema` 契约校验 + 内容级重试 ≤2；bg-task 通道保留给 P3 泛化
- [x] **P1.2** proposal JSON 契约（design §2.3 schema）：严格解析（非法 → 收缩/重试 ≤2 次 → fail-open 返回证据快照本身）；单次 ≤5 edit 超标走收缩计划
- [x] **P1.3** 输入脱敏：只给 `meta.resultMd` 摘要 + 现有 AGENTS.md/SKILL.md；文档化"哪些内容会进模型 prompt"
- [x] **P1.4** 审核闭环：action 输出携带 reviewInstructions（主会话用 AskUserQuestion 逐项问，零新增 i18n）；决策经 `recordDecisions` 入 store——任何已决（accept/reject/skip）不再重现
- [x] **P1.5** 自包含双语 HTML 报告：`buildReviewReportHtml` 同款模式落 `<root>/.deeporca/audits/<id>.html`；`withReviewReportSurface` wrapper 接线
- [x] **P1.6** 测试：契约解析真值表 / 审核暂停恢复 / 拒绝不再重现 / 报告落盘与修剪；既有 action 注册回归

## P2 受控写回

- [x] **P2.1** 批准子集 → 主会话 agent 用原生 `edit` 写 `AGENTS.md`/SKILL.md（delete 需 ≥2 session harm 证据；freshness 由 snippet 机制保证）
- [x] **P2.2** 权限回归：写回路径全量走 `computeToolCallPermissions`（ask/deny）；Plan Mode 下 force-ask 生效验证
- [x] **P2.3** 端到端验收：证据可溯（每条 proposal 的 evidenceIds 展开到 sessionId + tool_call_id + audit 链）

## P3（可选）泛化 —— 另行立项，不阻塞收官（流转口径 1）

- [x] proposal 管线抽成通用"规则/SOP 萃取"通道 —— **已延伸立项并落地（2026-09-04）：[specs/sop-extraction/](../../sop-extraction/design.md)**（memory.distill action；行为侧/召回侧连接器留其 P2 待宿主 seam）
