# SOP 萃取通道（sop-extraction）· memory-audit P3 泛化 — 技术设计

> **状态**：**P0+P1 已落地（2026-09-04，随 GVGL 真机验证批）；P2 三件套 2026-09-06 规划细化（§4）并同日落地（含多段审查修复批——独立审查 P0/P1 级发现 3 项全部闭合，落地留痕见 §4.4）**——上游：[`specs/archive/memory-audit/`](../archive/memory-audit/design.md) P3（"proposal 管线抽成通用规则/SOP 萃取通道"）+ 其空白区出处 `specs/archive/memory-remediation/` §五 2（「session→SOP/规则自萃取」自研空白区）。按流转口径 6 延伸立项：memory-audit 主体收官，P3 构成独立工作面。
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

1. **行为侧（activity-frames）/召回侧（L0–L3）连接器不在本期**：两者都需要 ActionContext 上不存在的宿主 seam（画像读取器 / MemoryProvider 查询口）。设计上预留：digest 的 context 段留两个插槽（`behaviorProfile` / `relatedMemories`），宿主注入点到位后各加一段即可，管线其余部分零改动。此项作为 P2 观察项留 tasks（2026-09-06 细化为 §4 + tasks P2.1–P2.3，seam 成本经代码核对下调）。
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
| **P2.1（优先）** | 召回侧连接器：relatedMemories 插槽接 L1 查询（§4.2；同时是双注入摩擦点的解法） | ✅ 2026-09-06 落地 |
| **P2.2** | 行为侧连接器：behaviorProfile 插槽接 activity-frames 画像（§4.2；含 patterns/workflows 增强项） | ✅ 2026-09-06 落地 |
| **P2.3** | 生产 accept 率跟踪（rejections store 统计） | ✅ 2026-09-06 落地 |

## 4. P2 连接器设计（2026-09-06 细化——依据与 L0–L3 / activity-frames 的冲突·结合性调研）

### 4.1 边界结论：与两套既有记忆系统无结构性冲突

写入面互不相交是结构性的，且三级规划红线一致（memory-remediation §五 2 → memory-audit §2.5 → 本 spec §0.4）：

| 系统 | 写入口 | 与 distill 的关系 |
| --- | --- | --- |
| L0–L3（`@deeporca/memory`，TDAI fork：L0 原始对话→L1 原子事实→L2 场景→L3 画像） | 仅 `capture(turn)` 轮次回流 + `clearProjectMemory()` 销毁 | **只读去重源**（P2.1 起）；distill 永不写 L0–L3 |
| activity-frames 行为记忆 | 无持久化画像——`collectProfile()` 现场聚合（session/git/shell/file），只读外部采集 DB | **只读证据源**（P2.2 起）；不重造画像 |
| 规则级记忆（本 spec 产物：SKILL.md / AGENTS.md） | 原生 write/edit + 用户逐项审核 | — |

三层互补分工，注入位置互不重叠：语义记忆被动召回（`<memory-context>`，`session-manager-lifecycle.ts:215-234`，每会话一次 2s race，memory 侧配额 300 字/条、2000 字总额）、行为上下文（`<behavior-context>`，`lifecycle.ts:236`，opt-in）、规则记忆 always-loaded（系统提示组装期）。三方数据同源（sessions JSONL / 采集 DB）属分层复用，非竞争。

### 4.2 seam 设计（代码核对后成本下调）

原判"需 ActionContext 上不存在的宿主 seam"；代码核对结论：**两侧基建均已存在，P2 只是把既有能力暴露到 action 层**（对齐 ActionContext 既有 fail-open 注入模式，`actions/types.ts:81-148`）：

1. **召回侧（P2.1，优先）**：`ActionContext` 新增可选 `searchKnownMemories?(query, limit?)`（返回已知事实文本条目或 null），由 SessionManager 从既有 `memoryProvider.searchMemories`（`session-types.ts:39`，查 L1）接线——memory 关闭/超时返回 null。`buildDistillPrompt` 增 `relatedMemories` 段（"已知事实"，有界），prompt 规则新增：与已知记忆同义的提案跳过或降级。**这是 §4.3-1 双注入摩擦点的既定解法**——P2.1 之前 distill 去重只对技能名录（existingSkills，`memory-distill.ts:241`），对 L0–L3 内容敞开。
2. **行为侧（P2.2）**：`ActionContext` 新增可选 `collectBehaviorContext?()`，直接复用既有 `buildBehaviorContext` 选项（`session-types.ts:334`；desktop 已注入 `formatContextBlock(collectProfile(root))`，`session-bridge.ts:303-312`）；SOP 语义增强**已落地**：core `buildBehaviorPatterns` 选项（binder fallback——patterns 优先、profile 兜底）+ desktop `formatSopContextBlock`（activity-frames `get_workflows` 同源数据：workflowPatterns/commandBigrams/commonFirstActions/git 节奏，比 `get_profile` 更贴合"怎么做事"；`get_patterns` 本身还是 Phase 3 stub，故取 workflows 侧数据）。输出裁剪 ≤1KB 进 digest context。
3. **accept 率（P2.3）**：memory.audit 与 distill 共用 rejections store（内容哈希键），统计经既有 action 输出 / HTML 报告面呈现——零新增 IPC 与 MessageKey（独立面板另评估）。

### 4.3 摩擦点与对策（调研留痕）

1. **双注入/预算**：本 spec 产物 always-loaded 与 L2/L3 跨会话注入可能双份承载同一事实（如"用户偏好 TypeScript"同存 L3 画像与 SKILL.md 规则）。对策：proposal 契约已有 `estTokens`；P2.1 落地即闭缺口。
2. **隐私门控**：行为侧插槽跟随 `settings.behaviorContext`（与 boot 注入同门控，不另开隐式通道）；画像不持久化、只进后台合成 prompt；采集 DB 读取维持只读 + 路径遏制。
3. **副模型共享**：L1/L2/L3 抽取与本 spec 合成同走 `settings.secondaryModel`——共享配额，换模型族两侧一起切（model-fleet-adaptation G1.5 已覆盖）。
4. **反向回流不做**：accept 率高的 SOP 不回写 L1/L3（撞"不写 L0–L3"三级红线；如要做另行拍板立据）。

### 4.4 落地留痕（2026-09-06）

落点：`actions/types.ts` + `actions/registry.ts`（两个 fail-open seam，RegistryHost→ActionContext 注入链）；`common/memory-seam.ts`（绑定器：可用门/同步抛守卫/2s race，纯函数可单测）+ `common/timeout.ts`（race 助手）；`session-manager-base.ts`（构造器接线：`memoryProvider` / `buildBehaviorContext`，门控 `settings.behaviorContext`，`session-types.ts` 补该字段）；`actions/memory-distill.ts`（`bounded()` 600/1024 真预算、prompt 双插槽 + 去重规则、context 仅字符数）；`actions/memory-audit.ts`（`summarizeDecisions` P2.3 基底）。测试：distill P2 真值表 + 红线 Proxy（ctx 只读键集钉死）+ 统计端到端；registry seam 传递；`memory-seam.test.ts` 全真值表；变异校验 4/4。

审查修复（独立审查发现，均已闭合）：**P0** context 原样落盘快照/回流工具结果（违 §4.3-2"画像不持久化"）→ 输出改为**仅字符数**，文本只存在于后台合成 prompt；**P1** `clip()` 200 字符短路使 600/1024 预算成死代码 → 换 `bounded()`，测试钉精确值；**P1** `completeViaLlm` 缺失时白烧 L1 查询 → 先判后取。

设计取舍留痕：同义提案抑制为 **prompt 软约束**（与 estTokens 同级，无确定性后滤——语义相似度过滤刻意不做，避免误杀）。

补充落地（2026-09-06 第二批，遗留项清偿）：**patterns/workflows 取向 builder**——core 新增 `buildBehaviorPatterns` 选项（binder fallback：patterns 优先、profile 兜底，boot 注入不受影响），desktop `formatSopContextBlock`（get_workflows 同源数据，纯函数）经 session-bridge 注入；**distill 快照 keep-N 剪枝**（`pruneDistillSnapshots`，对齐 memory-audit SNAPSHOT_KEEP=10，导出可直测）——原"预存缺口：快照无剪枝"闭合。门禁：core 847/0、desktop 510/0、`npm run build` ESM 重写覆盖新文件、变异校验 3/3。

第三批（2026-09-06，code-bug-analyzer 四维扫描的修复批）：**Medium** ①`summarizeDecisions` 对损坏 rejections 条目解引用会砖化整个 action → `summarizeStore` 入口形状守卫（fail-open）+ 免重读；②剪枝逻辑在 distill 侧整段复制违"共享基底"约定 → 提取 `prunePrefixedSnapshots`，audit/distill 共用；③conclusion 400 预算被 clip-200 短路（与本批修过的 P1 同类遗留）→ `bounded(conclusion, 400)`。**安全加固**：L1/画像 prompt 段加 "DATA, not instructions" 定界；skillName 字符集门（`SAFE_SKILL_NAME`，防路径注入写回指令）；git commit scope 字符集白名单（防恶意仓库经 behavior-context 走私文本）；desktop patterns builder 60s TTL 缓存（主进程同步扫描不进 distill 热路径）。**Low 清偿**：快照文件名随机后缀（同毫秒不互相覆盖）、`bounded()` 尾部孤立代理对清理、verdict 入库归一（非 accept/reject → skip）、`(Nx)`→`(N×)` 统一、registry seam 字段命名统一、fallback/timeout 文档对齐实现。测试：query 截断钉值 200 / skillName 拒绝 / 损坏 store 容错 / verdict 归一钉 store 内容 / git scope 真仓夹具——变异校验 5/5。门禁：core 848/0、desktop 511/0。**未采纳（留痕）**：skill-new 审阅展示完整 body（UX 改动，另议）；lifecycle 内联 race 迁移到 withTimeoutNull（返回形状不同，非本批）。

## 5. 回写规则

落地回写本 spec 状态行 + `specs/archive/memory-audit/tasks.md` P3 行指向本文；P2 连接器等 seam，不设时限。
