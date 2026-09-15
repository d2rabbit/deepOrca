# 记忆触发器召回强化（memory-trigger-recall）· 技术设计

> **状态**：**方案稿（只出方案，不改代码）** · **日期**：2026-09-14 · 分支 `feat/modern-ui-redesign` · **2026-09-14 立项入 next-version 规划区（储备项，启动时 `git mv` 回 `specs/memory-trigger-recall/` 转活跃）**。
> **上游调研**：[`docs/research/gameStudio/related/2026-09-14-tmem-hyperframes-prestudy.md`](../../../docs/research/gameStudio/related/2026-09-14-tmem-hyperframes-prestudy.md) §2（T-Mem 论文 arXiv 2606.15405 / EMNLP 2026 Main + 仓库一手取证与逐概念对位，本 spec 的直接依据）。
> **用户定调**：用于**记忆模块的强化**。调研结论（2026-09-14）：增量唯一新概念是写入时触发器（Trigger）；概念移植进 vendored TDAI 管线，**不引 T-Mem Python 代码**（与 MemOS 线作废同逻辑——记忆能力由 `@deeporca/memory` 单一承接的边界不变）。
> **对应实现域**：`packages/memory/`（vendored TDAI 管线内收敛）。**core 零改动**——core 经 `MemoryProvider` 接口消费记忆，触发器是管线内部增强，对外 `recall()` / `capture()` 签名不变。

---

## §0 执行摘要

现有记忆召回（BM25 + 向量）的可达性受限于查询与记忆的**表面相似度**：描述性召回（共享措辞/实体）没问题，**联想性召回**（查询与记忆无表面共现、仅靠潜在语义弧相连）系统性失灵。本方案引入 T-Mem 的核心机制——**写入时触发器**：`capture()` 落库时预演"这条记忆未来会在什么上下文被需要"，为每条记忆生成检索线索并与记忆同库索引；`recall()` 时触发器命中用于扩充候选集，但**触发器文本永不进入答案上下文**（解耦"如何被够到"与"够到的是什么"）。

| 层 | 内容 | 新增/复用 |
|----|------|-----------|
| 对象模型 | Item/Scene/Persona 全部映射到 TDAI 既有概念（§1），**唯一新增 Trigger** | 复用为主 |
| 写入侧 | L1 落库后异步生成 4 族 × 2 粒度触发器（§2/§3），fail-open | 新增 `prompts/trigger-*` + 生成器 |
| 召回侧 | 触发器双索引（BM25+向量）命中 → 解引用并入候选 → 既有去重排序（§4） | 改造 recall 管线 |
| 治理面 | settings 开关（默认关）+ `byLayer` 计费增 `trigger-gen` + 数量上限（§5） | 新增配置 |

## §1 对象模型映射（T-Mem → TDAI，2026-09-14 已核实）

| T-Mem 概念 | TDAI 等价物 | 判定 |
| --- | --- | --- |
| Item（原子事实） | `MemoryRecord`（`tdai/core/record/l1-writer.ts`：content / type(persona\|episodic\|instruction) / priority / **scene_name 锚定** / source_message_ids） | ✅ 已存在，无需新层 |
| Scene（场景） | TDAI scene（`tdai/core/scene/`，L2 场景抽取/索引/导航） | ✅ 已存在 |
| Persona（人设） | L3 persona（`tdai/core/persona/`） | ✅ 已存在 |
| Topic 预过滤 | 无（`core/routing/` 是技能/工具短名单，非记忆预过滤） | ⏸ 本 spec 不做（§8） |
| **Trigger（触发器）** | ❌ 无 | **本 spec 唯一新增对象** |

## §2 触发器规范（4 族 × 2 粒度）

每族一段固定结构提示词（**参考 T-Mem 开源 `prompts/` 目录的四族模式**，改写为本仓管线语境，不逐字搬运）：

| 族 | 类别 | 粒度 | 提示词要点（生成什么） |
|----|------|------|------------------------|
| Entity | 描述性 | record + scene | 从记忆/场景中抽取实体与关键词线索——覆盖"用户提到同名实体"的召回 |
| Horizon | 描述性 | record + scene | 预演"用户未来以什么措辞复述这段内容"——覆盖同义改写召回 |
| Bridge | 联想性 | record | "什么**表面无关**的问题会经潜在语义弧牵出这条记忆"——每条触发器写明桥接关系 |
| Scene | 联想性 | scene | 场景级的情境重述——"什么任务/情境下需要回到这个场景" |

- **record 级**：每条 `MemoryRecord` 生成 Entity + Horizon 各 1 条、Bridge 0–2 条（由抽取 LLM 判断有无语义弧，允许为空）。
- **scene 级**：每个场景生成 Entity + Scene（联想）各 1 条，锚定场景整体。
- 生成输入 = 记忆内容（+ 场景摘 要，scene 级时），单次 LLM 调用批量产出一个粒度的全部触发器（JSON schema 校验 + 1 次重试预算，对齐 cmb-adoption 确立的辅助调用纪律）。

## §3 数据流

### 3.1 capture 侧（生成）

```
capture() → L0 记录 → L1 抽取落库（现状不动）
         → [新增] trigger-gen（异步、fire-and-forget）
             record 落库回执 → 按 §2 生成触发器 → 写 store（§4）→ 失败仅记日志
```

- **fail-open 红线**：触发器生成失败/超时/JSON 不合法 → 跳过该条，capture 主流程与现状完全一致；无触发器的记忆走既有召回，零退化。
- L2 场景落库回执同样挂接（scene 级触发器）。

### 3.2 recall 侧（扩充）

```
recall(query) → 既有召回管线（BM25 + 向量，不动）
             → [新增] 触发器索引并行检索（BM25 + 向量各一次）
             → 命中触发器解引用 target（record id / scene name）
             → 并入候选集 → 既有去重/优先级排序/数量上限（不动）
             → 渲染上下文时按类型过滤：trigger 文档永不出现在 prompt
```

- 触发器检索失败 → 静默退化为现状召回（fail-open 同纪律）。
- **上下文过滤是硬不变量**：store 渲染层按文档类型过滤（与渲染 persona/record 的既有分支并列），测试锁死。

## §4 存储与索引

- 新文档类型 `trigger`：`{ id, family: "entity"|"bridge"|"scene"|"horizon", granularity: "record"|"scene", targetId, text, sessionKey, createdAt }`（`tdai/core/types.ts` 扩展；Pydantic 式校验对应 TS 类型收窄）。
- BM25 与向量索引各建触发器条目（text 为索引内容；metadata 携带 family/granularity/targetId）。
- 触发器随其 target 的删除/合并级联清理（挂接既有 `LocalMemoryCleaner` 与 dedup 合并路径——target 没了触发器必须没）。

## §5 配置与计费

- **开关**：settings 记忆域新增 `triggers.enabled`（**默认关**，P0 观察期零行为变化；开启后生效）。关闭时零额外 LLM 调用、零索引条目。
- **计费**：`memory/adapter.ts` 的 `MemoryGenerationInfo.layer` 由 `"l1"|"l2"|"l3"|"other"` 扩展 `"trigger-gen"`，`memory-manager.ts` 的 `byLayer` 统计同步扩展——记忆管线消费可见性纪律（specs/archive/memory-remediation Phase 2）直接延续。
- **数量治理**：单条记忆触发器上限 4（4 族封顶）；场景级每场景 2。超限按生成顺序丢弃。触发器不参与 priority 排序竞争（仅在候选扩充阶段起作用）。

## §6 分期

| 批次 | 内容 | 验收 |
|------|------|------|
| **P0** | TriggerDocument 类型 + store 写入/双索引 + 渲染过滤 + record 级 Entity/Horizon 两族生成 + 开关（默认关）+ byLayer 计费 | 开关关=零行为变化（对照测试）；开=触发器入库且 prompt 零泄漏；fail-open 注错不阻塞 capture |
| **P1** | recall 扩充管线（解引用并入候选）+ scene 级两族 + 级联清理（挂 Cleaner 与 dedup） | 联想性查询（无表面共现）能召回目标记忆的真值表测试；删记忆后触发器同步消失 |
| **P2** | Bridge 族（record 级联想）+ 数量治理调参 + 召回质量走查（自建联想查询集；LoCoMo 式外部基准可选不排期） | 走查报告归档；上限治理生效 |

## §7 风险与对策

| 风险 | 对策 |
|------|------|
| 触发器文本污染答案上下文 | 渲染层类型过滤 + 测试锁死（§3.2 硬不变量）；触发器 metadata 标记仅检索 |
| LLM 成本翻倍（每记忆多一次调用） | 默认关；单调用批量产出全族；byLayer `trigger-gen` 透明计费；memory-usage 面板可观测后由用户决定常开 |
| 触发器噪声拉低召回精度 | 仅扩充候选（不直接进答案）；既有去重/排序/上限在下游兜底；P2 走查调参 |
| vendored TDAI 修改失控 | 修改收敛在 record/scene/store/prompts 四个子目录的既定扩展点；NOTICE.md fork 纪律不变；上游对照差异集中登记 |
| dedup 合并后触发器指向失效 | 合并路径级联重定向/清理（§4），测试覆盖合并场景 |

## §8 明确不做

不引入 T-Mem Python 代码或 sidecar；不改 core（MemoryProvider 接口与 routing 零触碰）；不做 Topic 预过滤层（T-Mem 有、本仓暂无对应面，留观察）；不动 L2/L3 既有管线语义；不追求 LoCoMo 榜单复现（本仓无该基准设施，走自有走查集）；不改变记忆能力单一承接边界（无第二记忆系统）。
