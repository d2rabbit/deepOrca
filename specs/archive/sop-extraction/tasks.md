# SOP 萃取通道（sop-extraction）— 任务清单

> 对应设计：[design.md](./design.md)。2026-09-04 立项并同日实施完毕（用户拍板「P3 深入继续」，随 GVGL 真机验证批）；P0+P1 全部落地。2026-09-06 P2 规划细化（冲突·结合性调研落稿，design.md §4）并同日落地（多段审查修复批见 §4.4）。
> 纪律：会话只读；摘要有界脱敏；合成契约校验 + fail-open；已决不重现；写回只经原生工具。

## P0 基底与会话摘要

- [x] **P0.1** 共享基底 —— **实施方式调整**：不做文件搬移手术，改为 memory-audit.ts 直接导出共享件（isSafeSessionId/clip/sha8/proposalKeyOf/rejections 读写/audits 目录），distill 引用之——对已归档已测文件零触碰，风险最小（7/7 回归确认）
- [x] **P0.2** `readSessionDigest(projectDir, sessionId)`：确定性摘要——意图序列（用户消息 ≤160 字 ×≤8）/ 工具画像（名称→次数 + 命令/路径关键参数 top3）/ 结论段（末条 assistant ≤400 字）；单会话摘要 ~2.5KB 上限
- [x] **P0.3** 真值表测试：摘要内容/上限裁剪/空会话/损坏行容错

## P1 distill 全链

- [x] **P1.1** `actions/memory-distill.ts`：`memory.distill` action（参数 `sessions?`（默认 3）| `sessionId?` | `dryRun?` | `synthesize?` | `recordDecisions?`；sideEffects read-in-cwd + write-in-cwd）
- [x] **P1.2** 合成契约：`{sopProposals:[{action: add-rule|update-rule|skill-new|skill-append, skillName?, ruleText?, body?, rationale, evidenceRefs[]}]}`——applyAuxSchema + 内容级重试 ≤2 + fail-open；≤5 条；skill-new 必须带 body（frontmatter + 正文）
- [x] **P1.3** 去重（确定性）：已有同名技能 → skill-new 降级计数；**批内同名 skill-new 去重**（测试驱动发现的真缺口）；rejections 已决项互斥
- [x] **P1.4** 审核环：reviewInstructions（AskUserQuestion 逐项）+ recordDecisions 与 memory.audit 同 store（内容哈希键天然防撞）
- [x] **P1.5** 受控写回：skill-new → 原生 **write** 工具指令（`.deeporca/skills/<name>/SKILL.md`，全量权限/快照/审计）；规则类 → 原生 **edit**（同 memory.audit）
- [x] **P1.6** 测试：合成契约真值表 / 同名降级 / 端到端决策→写回指令形态 / fail-open / dryRun 只读；注册与导出（base.ts + actions/index.ts）

## P2 连接器 + 验证（2026-09-06 规划细化；依据与 L0–L3 / activity-frames 的冲突·结合性调研，design.md §4）

> 结论：无结构性冲突（写入面互不相交、三级红线一致）；两侧 seam 基建已存在（`memoryProvider.searchMemories` / `buildBehaviorContext`），成本低于原判。P2.1 优先——它同时是"同一事实双份注入"（L3 画像 vs SKILL.md 规则）预算摩擦点的解法。

### P2.1 召回侧连接器（优先）— ✅ 2026-09-06 落地

- [x] core seam：`ActionContext` 增可选 `searchKnownMemories?(query: string, limit?: number)`（fail-open，返回已知事实文本或 null；`actions/types.ts`）；SessionManager 经 `common/memory-seam.ts` 绑定器从 `memoryProvider.searchMemories` 接线（查 L1，`session-manager-base.ts` 构造器）
- [x] distill 接槽：`buildDistillPrompt` 增 `relatedMemories` 段——digest 首意图去重拼接（≤200 字符）查 L1（limit 5）、`bounded()` 裁剪 ≤600；prompt 规则"与已知记忆同义的提案跳过或降级"（`memory-distill.ts`）
- [x] 门控与降级：memory 关闭 / provider 缺失 / 超时（2s race，`common/timeout.ts`）→ 插槽空，管线零改动；`completeViaLlm` 缺失时先判后取（不白烧 L1 查询）
- [x] 测试：绑定器全真值表（可用/缺失/不可用/同步抛/异步拒/垃圾/空文本/超时，`memory-seam.test.ts`）；prompt 形态与精确预算（===600）；去重规则注入断言——同义抑制为 prompt 软约束（设计取舍留痕 §4.4，无确定性后滤）
- [x] 红线测试：distill 全链 Proxy 钉死 ctx 只读键集（无 capture/clear 等写通道）

### P2.2 行为侧连接器 — ✅ 2026-09-06 落地（最小连接器）

- [x] core seam：`ActionContext` 增可选 `collectBehaviorContext?(): string | null`（fail-open，`actions/types.ts`）
- [x] desktop 接线：**零 desktop 改动**——core 构造器复用既有 `buildBehaviorContext` 选项注入（desktop `session-bridge.ts` 已有），门控跟随 `settings.behaviorContext`（`session-types.ts` 补字段），不持久化画像
- [x] distill 接槽：prompt `behaviorProfile` 段（`bounded()` ≤1024）；**输出仅字符数**（文本不进快照/工具结果/主会话——审查修复 P0 闭合）
- [x] SOP 语义增强项（2026-09-06 第二批落地）：core 新增 `buildBehaviorPatterns` 选项（binder fallback 语义：patterns 优先、profile 兜底，boot 注入不受影响）；desktop `formatSopContextBlock`（get_workflows 同源数据：workflowPatterns / commandBigrams / commonFirstActions / git 节奏，纯函数可测）经 session-bridge 注入
- [x] 测试：画像缺失 / 采集 DB 不在 / 抛错的降级（绑定器真值表）；插槽精确预算（===1024）；门控关闭时不出现在 prompt（绑定器门控真值表）

### P2.3 生产 accept 率跟踪 — ✅ 2026-09-06 落地

- [x] rejections store 统计：`summarizeDecisions`（memory-audit.ts 共享基底，按 key 的 action 前缀分桶）→ distill 主输出与 recordDecisions 响应携带 `decisionStats`（零新增 IPC 与 MessageKey；memory.audit 侧可后续采纳同字段；独立面板另评估）
- [x] 决策留痕：不做 SOP → L0–L3 反向回流（"不写 L0–L3"三级红线，§4.3-4 留痕）
