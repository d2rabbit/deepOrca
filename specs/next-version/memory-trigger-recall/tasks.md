# 记忆触发器召回强化（memory-trigger-recall）— 任务清单

> 对应设计：[design.md](./design.md)。2026-09-14 立稿，方案稿（未开工）。
> 上游调研：[docs/research/gameStudio/related/2026-09-14-tmem-hyperframes-prestudy.md](../../../docs/research/gameStudio/related/2026-09-14-tmem-hyperframes-prestudy.md) §2。
> 红线：触发器文本**永不进入答案上下文**（渲染过滤测试锁死）；全程 fail-open（生成/检索失败不阻塞 capture/recall 主流程）；settings 开关**默认关**；core 零改动；不引 T-Mem Python 代码（只移植 prompt 模式）；全部改动收敛在 `packages/memory/`。

## P0 类型 + 存储 + record 级两族

- [ ] **P0.1** `memory/tdai/core/types.ts`：`TriggerDocument` 类型（family: entity|bridge|scene|horizon / granularity: record|scene / targetId / text / sessionKey / createdAt）
- [ ] **P0.2** `memory/tdai/core/store/`：trigger 文档写入 + BM25/向量双索引条目（metadata 携带 family/granularity/targetId）+ **渲染层类型过滤**（trigger 永不出现在 prompt 上下文）
- [ ] **P0.3** `memory/tdai/core/prompts/trigger-record.ts`：Entity + Horizon 两族提示词（参考 T-Mem `prompts/` 模式改写；单调用批量产出；JSON schema + 1 次重试预算，对齐 cmb-adoption 辅助调用纪律）
- [ ] **P0.4** `memory/tdai/core/record/l1-writer.ts` 落库回执后挂 trigger-gen（异步 fire-and-forget；失败仅记日志，capture 语义零变化）
- [ ] **P0.5** 配置开关 `triggers.enabled`（默认关；关=零 LLM 调用零索引条目）+ `memory/adapter.ts` `MemoryGenerationInfo.layer` 增 `"trigger-gen"` + `memory-manager.ts` `byLayer` 同步扩展
- [ ] **P0.6** 测试：开关关=行为对照基线（无新调用/无新条目）；prompt 零泄漏（渲染真值表）；注错 fail-open；trigger-gen 计费入账断言

## P1 recall 扩充 + scene 级 + 级联清理

- [ ] **P1.1** recall 管线：触发器索引并行检索（BM25+向量）→ 解引用 target → 并入候选集 → 既有去重/排序/上限兜底；检索失败静默退化
- [ ] **P1.2** `prompts/trigger-scene.ts`：scene 级 Entity + Scene（联想）两族；`tdai/core/scene/scene-extractor.ts` 落库回执挂接
- [ ] **P1.3** 级联清理：挂接 `LocalMemoryCleaner` 与 l1-dedup 合并路径——target 删除/合并时触发器同步清理/重定向
- [ ] **P1.4** 测试：联想性查询真值表（无表面共现查询可召回目标记忆）；删记忆→触发器消失；dedup 合并→触发器重定向；recall 注错退化对照

## P2 Bridge 族 + 治理 + 走查

- [ ] **P2.1** `prompts/trigger-bridge.ts`：record 级 Bridge 族（0–2 条，允许为空）+ 数量治理（单记忆 ≤4 / 单场景 ≤2，超限按序丢弃）
- [ ] **P2.2** 召回质量走查：自建联想查询集（无表面共现用例）产出走查报告归档本目录；据数据调上限与族开关
- [ ] **P2.3** memory-usage 面板展示 trigger-gen 消费（desktop 侧 byLayer 透传，i18n 键 ×6 locale）
