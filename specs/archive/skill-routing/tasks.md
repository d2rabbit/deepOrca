# skill-routing 任务清单 — G3 大技能分片召回注入

> 日期：2026-08-18 · 状态：**实施中**（2026-08-18 拍板纳入本阶段收尾批，台账 `docs/spec-open-items-status.md` §一 #9）
> 依据：[design.md](./design.md) §一 目标表 G3 + §二 架构（复用 EmbeddingService/VectorIndex，fail-open 铁律）
> 前置：G1 短名单已落地（`routing/skill-router.ts`），embedding 动态加载在树（`routing/embedding-loader.ts`）。

## 实施口径（design.md G3 行的具体化）

- **阈值分片**：SKILL.md 低于 `shardMinChars`（默认 6000 字符）不分片、全文注入（现状不变）；只有大技能走分片。
- **分片单位**：markdown 标题（`#`/`##`/`###`）切段；超长段按 `maxShardChars` 硬切；片 = 标题 + 正文。首标题之前的内容（frontmatter/导语）恒定保留为 header。
- **注入形态**：`<name-skill>` 块内 = header + 全量小节索引（编号+标题）+ 按当前用户提示召回的 top-K 小节原文 + 未召回小节的索取指引（agent 可按索引点名，行为退化为多轮）。块外结构（path 属性/resources 渲染）复用 `buildSkillDocumentsPrompt` 不变。
- **召回**：复用 VectorIndex（含内容哈希磁盘缓存，避免每轮重嵌入）+ EmbeddingService；任何失败 → 全文注入，绝不阻断会话（fail-open 铁律）。
- **配置**：`RoutingConfig` 增 `skillSharding`（默认 true）/`shardMinChars`（6000）/`shardTopK`（4）；本期不暴露设置 UI，走默认值。

## 任务

- [x] T1 `routing/skill-sharding.ts` 纯函数：`shardSkillDocument`（分片+索引）与 `renderShardedContent`（header+索引+召回小节渲染）
- [x] T2 `routing/skill-shard-recaller.ts`：基于 VectorIndex 的分片召回器（fail-open 返 null）；`RoutingConfig` 三新键 + `DEFAULT_ROUTING_CONFIG` 默认值
- [x] T3 session 接线：`appendSkillMessages`/`buildSkillPrompt` 异步化并感知当前 `userPrompt.text`；RouterBundle 暴露 recaller；大技能走分片、小技能/任何失败回退全文
- [x] T4 测试 `tests/skill-sharding.test.ts`：分片矩阵（小文/null、标题切分、超长硬切、header 保留）/渲染断言（召回进、未召回不进）/召回排序（确定性 fake embedding）/回退路径（not-ready → null）
- [x] T5 回写：design.md 状态行 G3 → 已实现；台账 §一 #9 划项（2026-08-18 收尾批完成，见当批 feat 提交）
