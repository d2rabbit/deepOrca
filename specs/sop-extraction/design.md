# SOP 萃取通道（sop-extraction）· memory-audit P3 泛化 — 技术设计

> **状态**：**P0+P1 已落地（2026-09-04，随 GVGL 真机验证批；P2 连接器待宿主 seam）**——上游：[`specs/archive/memory-audit/`](../archive/memory-audit/design.md) P3（"proposal 管线抽成通用规则/SOP 萃取通道"）+ 其空白区出处 `specs/archive/memory-remediation/` §五 2（「session→SOP/规则自萃取」自研空白区）。按流转口径 6 延伸立项：memory-audit 主体收官，P3 构成独立工作面。
> **命题**：把已验证的管线基底（证据 → 合成 → 逐项审核 → 拒绝持久化 → 受控写回）从"**失败驱动的记忆规则**"泛化为"**成功驱动的 SOP 萃取**"——素材不再是什么坏了，而是"这次是怎么做成的"。
> **对应实现域**：`core/actions/memory-distill.ts`（新 action）；共享基底经 memory-audit.ts 直接导出（零搬移重构，对已测文件零触碰）。
> **硬约束**（继承 memory-audit）：零新依赖；会话与 store 只读；写回只经主会话原生工具（新文件走 write、改文件走 edit）；默认 fail-open；不向 L0–L3 写入；P0–P1 零新增 IPC/i18n。

---

## 0. 背景与结论

### 0.1 提案是什么（一句话）

新增 `memory.distill` action：对选定会话做**确定性摘要扫描**（用户意图序列 + 工具使用画像 + 结论），经 LLM 合成产出**可复用 SOP 提案**——新建技能（SKILL.md 全文草案）、AGENTS.md 规则、既有技能增补——沿用 memory.audit 的逐项审核（AskUserQuestion）、决策持久化（已决不重现）与受控写回指令。

### 0.2 与 memory.audit 的关系（分界）

| 维度 | memory.audit（已归档） | memory.distill（本 spec） |
| --- | --- | --- |
| 素材信号 | 失败事件（ok:false / deny / failed） | 成功程序（会话里实际怎么做的） |
| 触发语义 | "扫历史，找坏习惯" | "把这次的做法固化下来"（用户对刚跑完的会话说） |
| 证据源 | transcript 失败事件 + 索引 + audit 链 | transcript 摘要（意图/工具/结论）+ 技能名录去重 + AGENTS.md 头 |
| sink | AGENTS.md / 既有 SKILL.md 增删改 | 同左 + **新建技能**（skill-new：SKILL.md 全文草案） |
| 共享基底 | 决策持久化 store（同文件、内容哈希键天然防撞）、审核环、写回纪律 | 同左（memory-evidence.ts 抽取共享） |

### 0.3 泛化的三块增量（本 spec 的实际工作量）

1. **证据连接器（会话侧）**：`readSessionDigest`——确定性提取每会话的用户意图序列（原文裁剪）、工具画像（名称计数 + 关键参数如文件路径/命令前缀）、assistant 结论段；有界（每会话 ≤ ~2.5KB 摘要）。
2. **合成契约扩展**：proposal 新增 `target: "skill-new"` + `skillName` + `body`（SKILL.md 正文草案，含 frontmatter）；去重约束——已有同名/强重叠技能时只允许"增补"不允许"新建"（名录级判定，确定性）。
3. **写回 sink 扩展**：skill-new 的受控写回指令走**原生 write 工具**（新文件，路径 `.deeporca/skills/<name>/SKILL.md`，权限/快照天然覆盖）；与捆绑 skill-writer 的边界：distill 负责"提案+落盘草案"，深度创作仍归 skill-writer（spec 留痕）。

### 0.4 明确不做（决策留痕）

1. **行为侧（activity-frames）/召回侧（L0–L3）连接器不在本期**：两者都需要 ActionContext 上不存在的宿主 seam（画像读取器 / MemoryProvider 查询口）。设计上预留：digest 的 context 段留两个插槽（`behaviorProfile` / `relatedMemories`），宿主注入点到位后各加一段即可，管线其余部分零改动。此项作为 P2 观察项留 tasks。
2. **不自动建库**：distill 永不批量扫全部历史自动生成技能——按用户点选的会话（默认最近 3 个）工作，产出必须逐项过审。
3. **不写 L0–L3**：与 memory.audit 同一红线。

## 1. 现状与证据

- **管线基底已验证**：memory.audit P1/P2（提交 3754ea29）——synthesis 契约（applyAuxSchema + 内容级重试）、reviewInstructions（AskUserQuestion 主会话审核）、recordDecisions 持久化（任何已决不重现）、pendingWriteBacks 受控写回，测试 7/7。
- **空白区出处**：`specs/archive/memory-remediation/design.md` §五 2 拍板「session→SOP/规则自萃取」为后续自研；memory.audit 是第一形态（失败驱动），本 spec 是第二形态（成功驱动）。
- **真机验证背景（2026-09-04 GVGL 批）**：flash 合成在该端点存在空响应率（2/4），fail-open 兜底确认——distill 的合成沿用同一契约与重试，同样不依赖"模型一定答对"。

## 2. 设计

### 2.1 数据流

```text
用户触发 memory.distill { sessions?: 3 | sessionId?: "…" , dryRun?, synthesize? }
  → 阶段1 确定性会话摘要（零 LLM）
      readSessionDigest(sessionId)：意图序列（用户消息裁剪 160 字 ×≤8）
        + 工具画像（tool 名→次数 + 命令/路径关键参数 top3）
        + 结论段（最后一条 assistant 文本裁剪 400 字）
      context 段：AGENTS.md 头 60 行 + 既有技能名录（去重用）
  → 阶段2 LLM 合成（ctx.completeViaLlm + applyAuxSchema 契约）
      输出 sopProposals[]：{ action: add-rule|update-rule|skill-new|skill-append,
        skillName?, ruleText?|body?, rationale, evidenceRefs(会话内消息定位) }
      约束：≤5 条；skill-new 需 body 全文（frontmatter+正文）；同名技能存在 → 只允许 skill-append
  → 审核（reviewInstructions → AskUserQuestion 逐项）
  → recordDecisions（与 memory.audit 同一 store；已决不重现）
  → accepts → pendingWriteBacks：
      skill-new → 原生 write 工具写 .deeporca/skills/<name>/SKILL.md
      agents/skill 规则 → 原生 edit 工具（同 memory.audit）
```

### 2.2 关键决策

| # | 决策 | 理由 |
| --- | --- | --- |
| 1 | 独立 action（`memory.distill`）而非给 memory.audit 加 mode | 触发语义/证据面/sink 全不同；共享靠基底模块而非开关 |
| 2 | proposal 键沿用 `${action}:${target}:${sha8(内容)}` | 与 memory.audit 同 store 天然防撞（内容不同即不同键） |
| 3 | skill-new 写回走 write 而非 edit | 新文件无 snippet 可锚；write 同样过权限+快照+审计 |
| 4 | 摘要有界（每会话 ~2.5KB） | 合成输入预算可控；原文永不整段入 prompt（P1.3 同款脱敏纪律） |
| 5 | evidenceRefs 用"会话 id + 消息序号"人可读形态 | SOP 证据是"程序"不是"故障"，审核时用户要能回看当时怎么做的 |

## 3. 分期

| 期 | 内容 | 状态 |
| --- | --- | --- |
| **P0** | memory-evidence.ts 基底抽取（memory-audit 重构零行为变化）+ readSessionDigest + 测试 | ✅ 随本 spec 落地 |
| **P1** | memory.distill 全链（合成契约/审核环/决策持久化/skill-new 写回）+ 测试 | ✅ 随本 spec 落地 |
| **P2（观察）** | 行为侧/召回侧连接器（待宿主 seam）；生产 accept 率跟踪 | ⬜ |

## 4. 回写规则

落地回写本 spec 状态行 + `specs/archive/memory-audit/tasks.md` P3 行指向本文；P2 连接器等 seam，不设时限。
