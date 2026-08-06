# SkillWeaver 式技能/工具路由 — 详细设计

> 日期：2026-08-06 · 状态：规划中
>
> 灵感来源：[arXiv:2606.18051](https://arxiv.org/abs/2606.18051)（无论文代码，本设计为自行实现）
> 前序评估：`docs/research/2026-08-06-skillweaver-skill-routing-integration.md`
>
> 设计约束：
>
> 1. **零外部运行时依赖**——纯 TS，嵌入推理走 transformers.js（ONNX），不引入 Python；
> 2. **fail-open**——召回层任何异常都退化为现有行为（全量候选/全量工具），绝不让路由层搞挂会话；
> 3. **启动路径零同步网络/重计算**——模型懒加载、异步下载（2026-08-05 白屏事故教训）。

---

## 一、目标

把 DeepOrca 的两处"全量灌入"改为"先检索、再加载"：

| #   | 现状                                                                                           | 目标                                                             |
| --- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| G1  | 技能匹配：每条用户消息把全部技能 name+desc 发给 flash LLM 分类（`identifyMatchingSkillNames`） | 嵌入召回 top-K 短名单 → LLM 只精排短名单；匹配开销与技能总数脱钩 |
| G2  | MCP 工具：所有已连服务器的工具 schema 每轮全量注入                                             | 按本轮上下文召回相关工具子集注入；小工具集全量放行               |
| G3  | 技能全量 SKILL.md 进系统提示                                                                   | （后续）大技能分片召回注入                                       |

非目标：不训练 bi-encoder（无训练数据，用预训练模型 zero-shot）；不做 DAG 组合规划（P4，挂计划模式另行设计）。

---

## 二、总体架构

```
用户消息 userPrompt
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  EmbeddingService（新增，packages/core/src/routing/）         │
│  • transformers.js feature-extraction，懒加载                 │
│  • 模型：granite-embedding-97m-multilingual-r2 ONNX（默认）   │
│  • 模型文件在 userData 按需下载（vendor 代理兜底）             │
└──────────────┬──────────────────────────────────────────────┘
               │ Float32Array[384]
               ▼
┌─────────────────────────────────────────────────────────────┐
│  VectorIndex（纯内存，暴力点积；数百条目 × 768 维 < 1ms）      │
│  • 技能索引：name + description + 触发词                       │
│  • 工具索引：serverName/toolName + description                │
│  • 磁盘缓存：~/.deepcode/cache/emb-<contentHash>.json          │
└──────────────┬──────────────────────────────────────────────┘
               │ top-K 候选
               ▼
   ┌───────────┴────────────┐
   ▼                        ▼
技能路由（G1）             工具路由（G2）
短名单→flash 精排          按服务器聚合→schema 子集注入
（现有逻辑不变）            （McpManager 出口处裁剪）
```

---

## 三、模块设计（packages/core/src/routing/）

```
routing/
├── embedding-service.ts   — transformers.js 封装（懒加载/量化模型/下载）
├── vector-index.ts        — 纯内存余弦索引 + 磁盘缓存
├── skill-router.ts        — G1：技能短名单召回
├── tool-router.ts         — G2：MCP 工具 schema 召回
├── model-download.ts      — 模型文件下载（vendor/代理/断点）
└── types.ts
```

### 3.1 EmbeddingService

```ts
export interface EmbeddingService {
  /** 模型未就绪时返回 null（调用方走 fail-open 分支）。 */
  embed(texts: string[]): Promise<Float32Array[] | null>;
  isReady(): boolean;
  /** 后台预热（下载+加载），由宿主在空闲时触发，绝不阻塞调用方。 */
  warmup(): void;
}
```

- 实现基于 `@huggingface/transformers`（新增 core 依赖，`env.allowLocalModels` 指向下载目录）。
- 模型选型（2026-08-06 候选对比后定稿）：默认 **`ibm-granite/granite-embedding-97m-multilingual-r2`**（ONNX，97M 参数，384 维，Apache 2.0，200+ 语言含中文，32K 上下文，<100M 参数档 MTEB 检索最高 60.3）。
  - 备选/回退：`BAAI/bge-base-zh-v1.5`（中文专精，768 维）——若中文抽查不达标则切换；`Bekko-Embedding a8m/a25m`（MIT，极端轻量）作为低端兜底。
  - **不选** all-MiniLM-L6-v2 / BGE-base-en-v1.5 / paraphrase-MiniLM：英文模型，DeepOrca 主场景是中文提示 × 中文技能描述（前序评估 §3.2 的风险结论）。
  - **不选** Potion（model2vec 蒸馏）/ Ogma / FastTextEmbed：代码检索特化或质量不足，且与 transformers.js 运行时不匹配。
  - Granite 官方随附 ONNX + OpenVINO 权重，transformers.js 可直接加载，无需自导出。
- 查询侧前缀：Granite 使用 `"query: "` / `"passage: "` 任务前缀（其模型卡约定）；BGE 回退路径则用 `"为这个句子生成表示以用于检索相关文章："`。前缀由模型配置驱动，可关。
- 加载策略：首次 `embed()` 触发加载；加载中返回 null（fail-open）；加载失败记录并 30 分钟内不再重试。
- 文本预处理：技能描述截断到 256 token；批量 encode（batch=16）。

### 3.2 VectorIndex

```ts
export interface VectorIndex {
  /** 重建索引（条目变化时）。返回 false 表示嵌入不可用（fail-open）。 */
  rebuild(entries: Array<{ id: string; text: string }>): Promise<boolean>;
  query(text: string, topK: number): Array<{ id: string; score: number }>;
  readonly size: number;
}
```

- 条目 = 技能（`name + "\n" + description`）或工具（`server.tool + "\n" + tool.description`）。
- 磁盘缓存键 = 内容哈希（所有条目文本 + 模型版本）；命中即跳过 encode。
- 查询向量每轮计算一次（~10–30ms，M 系列芯片），在会话内按 prompt 文本缓存。
- 相似度阈值不作为硬开关，仅排序截断 topK（避免阈值调参）；空结果时调用方回退全量。

### 3.3 SkillRouter（G1 集成点）

修改 `SessionManager.identifyMatchingSkillNames()`（session.ts:1063）：

```ts
const candidates = simpleSkills; // 现状：全部候选
const shortlist = await this.skillRouter?.shortlist(userPrompt, candidates, { topK: 8 });
const pool = shortlist ?? candidates; // null → fail-open 全量
// 后续 LLM 分类逻辑不变，只把 simpleSkills 换成 pool
```

不变式：

- 已挂载/已加载技能（`isLoaded`、`selectedSkills`）**始终直通**，不参与裁剪——用户显式挂载的技能不可被召回漏掉。
- `allowImplicitInvocation === false` 的技能维持现有排除规则。
- 技能数 ≤ 12 时不走召回（小池子直接全量，省一次 encode）。
- 召回结果写入 debug log（`routing.skill` 事件：shortlist、耗时、命中分），供准确率抽查。

### 3.4 ToolRouter（G2 集成点）

现状：`McpManager.getMcpToolDefinitions()` 全量返回，session 循环每轮注入。

设计：在会话循环构建请求处（`activateSession` 的工具列表组装点）加一层：

```ts
const allMcpTools = mcpManager.getMcpToolDefinitions();
const routed = (await this.toolRouter?.select(currentTurnContext, allMcpTools)) ?? allMcpTools;
```

规则：

1. 内置 7 工具（bash/read/write/edit/AskUserQuestion/UpdatePlan/WebSearch）**永远全量**，不经过路由。
2. 服务器级聚合：按服务器召回（该服务器所有工具描述合并为一条索引文本），命中即注入该服务器全部工具——避免"召回半个服务器"造成调用链断裂。
3. 阈值放行：全部 MCP 工具 schema 估算 token < 2000 时全量注入（小负载不裁剪）。
4. 每个服务器携带 `routing.pinned` 配置项（settings.mcpServers.<name>.pinned），pin 住的服务器全量放行。
5. 召回上下文 = 当前用户消息 + 上一条助手消息摘要（截断 512 字符）。
6. **每轮重算**：同一服务器在不同轮次可进可出——工具列表是 per-request 的，不影响已注入历史（历史消息里的 tool_call 与工具定义无强绑定，OpenAI 兼容端点按 tool_call_id 配对结果，不要求定义在场）。

风险对策：误召回漏工具 = 模型"不知道有这工具"。缓解：

- 系统提示追加一行路由告示：「部分工具按相关性注入；若需要的能力不在工具列表，可通过 <服务器名> 关键词提示宿主重载」（配合一个轻量 `routing hint` 机制：用户消息命中服务器名/别名时直通该服务器）。
- debug log 记录每轮注入/裁剪了哪些服务器，可回放审计。

### 3.5 模型下载（model-download.ts）

- 目标目录：`getUserConfigRoot()/models/granite-embedding-97m-multilingual-r2/`（userData 级，不进 git、不进 vendor 构建产物）。
- 来源：HuggingFace resolve URL（model.onnx + tokenizer 等 4–6 个文件），走现有 vendor 代理兜底模式（参考 `scripts/vendor-*.js` 的 proxy fallback）。
- 断点续传 + 版本标记文件（`.model-version`）；下载失败保持未就绪态，不阻塞任何功能。
- 首用 UX：设置页显示「路由模型：未下载 / 下载中 x% / 就绪」，下载只由用户启用开关或首次预热触发。

---

## 四、配置 schema（settings 扩展）

```jsonc
{
  "routing": {
    "enabled": true, // 总开关（默认开，模型未就绪时自动 fail-open）
    "model": "granite-97m-multilingual", // | "bge-base-zh-v1.5" | "bekko-a8m"
    "skillTopK": 8, // G1 短名单长度
    "skillMinPool": 12, // 候选数 ≤ 此值不走召回
    "mcpToolGating": true, // G2 开关
    "mcpTokenBudget": 2000, // 低于此估算 token 全量放行
    "queryInstruction": true, // BGE 查询指令前缀
  },
}
```

设置 UI：模型配置页加「路由」分组（开关 + 模型选择 + 状态指示）；默认只对开发者暴露高级项。

---

## 五、测试与验收

1. **召回准确率抽查**：50 条中文真实查询 × 现有技能池（内置 15 + 插件技能），指标 top-8 命中率 ≥ 90%（以现有 LLM 分类结果为伪标签）。不达标则换 bge-m3 重测。
2. **token 对照**：同一长会话分别开关路由，记录每轮请求 token 均值；G2 预期降幅与挂载 MCP 数量正相关（目标：挂满内置 MCP 时每轮 -30% 以上）。
3. **fail-open 用例**：模型未下载/下载失败/encode 抛异常时，会话行为与现状逐字节一致。
4. **延迟**：embed 调用 p95 < 50ms（缓存命中时 < 1ms）；技能匹配总耗时不高于现状。
5. 单元测试：VectorIndex 排序正确性、阈值放行、pinned 直通、isLoaded 直通。

---

## 六、里程碑

| 阶段 | 内容                                                              | 出口标准                                     |
| ---- | ----------------------------------------------------------------- | -------------------------------------------- |
| M1   | EmbeddingService + VectorIndex + 下载链路，debug 面板可看召回结果 | 抽查达标（§5.1）                             |
| M2   | G1 技能短名单上线（默认开）                                       | token 降幅 ≥ 5×（技能池 50+ 时）且准确率不降 |
| M3   | G2 MCP 工具路由（默认开，可关）                                   | 长会话每轮 token -30%+，无功能回归报告       |
| M4   | （另行设计）SAD 分解 + 计划模式 DAG 组合                          | —                                            |

---

## 七、明确不做

- 不引入 FAISS/向量数据库（规模不够，纯内存点积足够）。
- 不训练自定义 bi-encoder。
- 不在启动路径做模型下载/加载（全部懒加载 + 异步）。

---

## 八、与记忆系统的关系：一套嵌入基建，两个消费方（2026-08-06 补充）

TDAI 记忆的向量召回当前是关闭的（`memory-manager.ts` 里 `embedding: { enabled: false, provider: "none" }`，`hybrid` 策略实际只剩 BM25 关键词半边）。启用它同样需要向量模型，而 TDAI 自带的两条路都不合适：远端 `openai` provider 依赖 DeepSeek 端点没有的 embeddings 服务；`local` provider 的 node-llama-cpp 是原生模块，Electron ABI 适配成本高。

**决策：本设计的 EmbeddingService 作为 core 级共享基建，同时供两处消费，不各搞一套。**

1. **路由侧**：进程内直接调用（本文 §3）。
2. **TDAI 侧**：二选一——
   - 首选（零侵入）：由宿主把共享服务包一层 127.0.0.1 回环 HTTP shim（`POST /v1/embeddings`，OpenAI 兼容），TDAI 配 `provider: "openai"` 指向它，向量召回自动并入现有 hybrid 策略；
   - 备选（更干净）：`packages/memory` 是自有 workspace，给 TdaiCore 加一个注入外部 EmbeddingService 的口子。
3. 模型只下载/加载一份，维度以共享模型为准（granite-97m = 384），TDAI 的 `dimensions` 配置随之对齐。向量召回当前关闭、无存量索引，切换维度无迁移负担。
4. 启用顺序：M1–M2 先把路由跑通并积累准确率数据，再开 TDAI 向量召回（配置翻转即可），避免一次动两个系统时无法归因回归。
