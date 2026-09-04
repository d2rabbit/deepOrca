# SOP 萃取通道（sop-extraction）— 任务清单

> 对应设计：[design.md](./design.md)。2026-09-04 立项并同日实施完毕（用户拍板「P3 深入继续」，随 GVGL 真机验证批）；P0+P1 全部落地，P2 连接器待宿主 seam。
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

## P2（观察，待 seam）

- [ ] 行为侧连接器：digest context 的 `behaviorProfile` 插槽接 activity-frames 画像（需 ActionContext 宿主 seam）
- [ ] 召回侧连接器：`relatedMemories` 插槽接 MemoryProvider 查询（同上；用途=去重"已知"）
- [ ] 生产 accept 率跟踪（memory.audit 与 distill 共用 rejections store，可直接统计）
