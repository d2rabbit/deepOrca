# 模型集成底座调研：models.dev × Vercel AI SDK

> 状态：✅ 已消费（2026-09-17 全链落地）。**同日项目所有者拍板三项决策（§0），实现方案并入 [`specs/model-fleet-adaptation/`](../../specs/model-fleet-adaptation/design.md) §七/X 系列后同日实施完毕**（X0–X3 代码面全绿：port 类型 + 转译层 + 实验传输通道 + settings 开关 + models.dev 数据轨三消费点；电池 B1–B3/B5/B6 fixture 全绿 + off/on 分流端到端断言；B4/B7 真机清单与 X4 接入 SOP 成文，真机执行待排期）。原独立 spec `ai-sdk-experimental-adapter` 吸收为工件随迁 `specs/model-fleet-adaptation/ai-sdk-experimental-adapter/`。
> 缘起：项目所有者提出以 **models.dev**（模型目录数据）+ **ai-sdk.dev**（Vercel AI SDK 运行时）作为下一轮模型集成的核心底座，本文完成一手取证、与本仓 LLM 链路逐项对位、给出分阶段落地建议。
> 方法：官网 / `api.json` 实拉实测（4.7MB 全量解析）+ npm registry 元数据 + **`@ai-sdk/openai-compatible@3.0.51` 发布产物（unpkg dist）源码级核验** + 官方文档抓取 + 本仓代码全量走读（子代理盘点，file:line 见 §1）。版本均以 2026-09-17 快照为准。

---

## TL;DR

1. **两者是互补的一对，且天然配套设计**：models.dev 是"数据"（220 provider / 7843 模型的规格目录，MIT），AI SDK v7 是"运行时"（统一 LLM 传输层，Apache-2.0）。配套证据：models.dev 每个 provider 条目带 `npm` 字段直接指明该用哪个 AI SDK provider 包——220 个里 **178 个指向 `@ai-sdk/openai-compatible`**；opencode 生态即按此组合消费，DeepSeek 官方条目亦如此。
2. **DeepSeek 契约吻合度超预期（源码级实证，非文档推断）**：`@ai-sdk/openai-compatible` 原生内置本仓手写的三条承重契约——① 增量解析 `delta.reasoning_content ?? delta.reasoning`（与本仓 `reasoningReadFields` nullish 链同构）；② assistant 消息回放"有 reasoning 则携带 `reasoning_content`、无则省略键"（正是 DeepSeek V4.1 工具轮防 HTTP 400 的回放契约）；③ `includeUsage` 即 `stream_options.include_usage`。详见 §3.3。
3. **许可与工具链零障碍**：models.dev 数据 MIT、`ai@7.0.105` 及全部传递依赖 Apache-2.0、Node ≥22 引擎约束与本仓 `.nvmrc`=22 一致、`tool({ inputSchema })` 用 Zod（本仓已 `zod ^4.4.3`）——`scripts/check-licenses.js` 白名单（MIT/Apache-2.0）无需任何 exception 即可通过。
4. **已拍板（2026-09-17，见 §0）**：① 保留本项目全部 DeepSeek 专属优化与适配（SDK 路径不得绕开）；② 引入**实验性** SDK 适配能力（默认关的第二传输通道）；③ 持久化走**边界转译**、不迁移存储（R2 就此关闭）。原"A/B/C 三阶段"建议随拍板收编进 spec：B/C 合构为实验性适配线（含 P0 电池与全量切换否决判据），A（models.dev 目录）收窄为其数据轨工作包——与 `model-fleet-adaptation` spec 对位后定位为注册表的数据补全/建议源，不推翻家族语义层。

---

## 0. 已拍板决策记录（2026-09-17，项目所有者）

| # | 决策 | 对本调研的收束 |
| --- | --- | --- |
| 1 | **保留本项目内的 DeepSeek 专属优化和适配** | §1 全部"保留自研"判定（本地 token 计量家族路由、reasoning 回放、thinking 信封、dirge 兜捞、多模态门控、turn-tail 前缀纪律）由"建议"升格为**红线**；SDK 路径只消费这些机制，不得复制、不得旁路、不得弱化。与 `model-fleet-adaptation` G0 原生路线同向（其"双后端换主循环已否决"决策同样约束本线：实验通道不动主循环/权限/记忆/技能路由） |
| 2 | **引入实验性 SDK 适配能力** | AI SDK（`ai` + `@ai-sdk/openai-compatible`，exact-pin）作为**实验性第二传输通道**：设置开关默认关，现 `openai` SDK 通道保持默认权威通道；原 §6-B"金丝雀 + P0 电池"整体并入（先证伪再铺开的方法论不变） |
| 3 | **持久化进行转译，不迁移** | §5-R2 关闭：选方案 (a)——`SessionMessage` 持久化形状（OpenAI wire `messageParams`）不变，实验通道边界处 OpenAI ↔ ModelMessage 双向转译；存储/索引/存量会话零改动。红利：pre-flight 本地 token 计量继续对 OpenAI 形状直接计数，统计链零改动 |

**与既有 spec 的对位（立稿时补记，同日合并落地）**：家族注册表与协议分派是 [`specs/model-fleet-adaptation/`](../../specs/model-fleet-adaptation/design.md) 的领地（G0 已落地：`resolveModelSpec` 四步解析、`THINKING_BUILDERS` per-family、`reasoningReplay` 三模式；2026-09-17 已吸收本文实现方案为 §七/X 系列并移入活跃区）。本线不改家族语义面；models.dev 数据轨据此收窄为——① 未登记模型 fail-open 增强（窗/输出上限/多模态/工具调用默认值）、② 设置面板建议源与规格预填、③ 费用估算乘数；家族协议字段仍按 fleet spec"实施时按厂商文档手工核填"原则，**目录数据不进语义层**。

---

## 1. 现状基线：本仓 LLM 接入层盘点（2026-09-17，feat/modern-ui-redesign）

当前链路**不是手写 HTTP**，而是官方 `openai` SDK（`^6.35.0`）+ undici Agent 注入，全部 LLM 调用收口于单一咽喉点：

| 关切 | 现状 | 位置 |
| --- | --- | --- |
| HTTP 客户端 | `openai` SDK 封装，四工厂缓存（primary/secondary/endpoint/vision），undici keepAlive 180s，3s 探活 | `packages/core/src/common/openai-client.ts`（216 行） |
| 流消费咽喉点 | `createChatCompletionStream`：强制 `stream:true` + `include_usage`，`for await` 归约 content/reasoning/refusal/tool_calls（按 index 缝合），**reduce-then-return，不向前传 chunk**；含"provider 忽略 stream:true"非流式兜底与 dirge 文本通道兜捞 | `session-manager-base.ts:915-1304`（~390 行）+ `common/tool-call-repair.ts`（466 行） |
| 错误处理 | 无传输层重试；仅一次自动恢复（溢出→compact 重跑 / 超时→重跑）；`classifyLlmError` 8 类（status+regex） | `common/llm-error.ts`（262 行）、`session-manager-lifecycle.ts:713-753` |
| 流看门狗 | `withStreamIdleTimeout` 每 `next()` 超时竞速 | `session-stream.ts`（52 行） |
| 模型目录 | **硬编码 2 家族**（DEEPSEEK/STEPFUN）+ 未知家族兜底；仅 contextWindow（作压缩阈值）、thinking 默认、多模态、reasoningField/ReadFields/Replay；**无价格、无知识截止、无发布日期、无开放权重信息**；必须零依赖（renderer 经 `@deeporca/core/capabilities` 子路径共享打包） | `common/model-capabilities.ts`（395 行） |
| 端点配置 | 用户自填 `endpoints[]`（baseURL+key+手工模型清单+thinking/vision 勾选）；4 个硬编码 preset；模型键 `endpointId/modelId` | `settings.ts:1254-1308`、`renderer/components/SettingsPanel.tsx` |
| 消息转换 | `SessionMessage`（存原始 OpenAI 形状 `messageParams`）↔ OpenAI 消息；工具中断补写、**turn-tail 请求期追加保持持久化前缀字节稳定**（DeepSeek 上下文缓存杠杆）、DeepSeek V4.1 reasoning 回放（`"content"` 模式）、stepfun `omit` | `common/openai-message-converter.ts`（345 行） |
| thinking 请求形状 | deepseek `{thinking:{type}, extra_body:{reasoning_effort}}` vs stepfun 顶层 `reasoning_effort`（不可关） | `common/openai-thinking.ts`（65 行） |
| token 计量 | 本地计数为唯一统计源；deepseek 家族精确 BPE（`@tlibnx/tokenizer-deepseek_v4` 唯一 exact-pin），其余 CJK 启发式；发送前 pre-flight 计数触发压缩 | `common/token-counter.ts`（315 行）+ `usage-ledger.ts`（151 行）、`lifecycle.ts:521-539` |
| 缓存命中统计 | 合并 DeepSeek `prompt_cache_hit_tokens` 与标准 `prompt_tokens_details.cached_tokens` 进本地账 | `session-manager-base.ts:980-998` |
| wire 层总规模 | 客户端+流消费+辅助调用+看门狗 ≈810 行；错误/日志 ≈540 行；配置+目录 ≈960 行 | — |

**依赖现状的既有张力（与本调研直接相关）**：`openai ^6.35.0`、`undici ^7.25.0` 均为 `^` range，但两者都在 Electron 主进程执行——与"主进程执行包必须 exact-pin"的仓库红线冲突（存量问题，非本次引入）。任何 AI SDK 采纳都必须 exact-pin（`ai@x.y.z` + `@ai-sdk/openai-compatible@x.y.z`），顺势还压低了整棵依赖树。

**代码中对 models.dev / AI SDK 的既有引用：零**（`git grep` 全仓仅一篇外部审计归档文档提及 `@ai-sdk/*` 出现在他方工具的传递依赖树里）。

---

## 2. models.dev 调研

### 2.1 是什么

- 开源的 AI 模型规格数据库：**220 个 provider、7843 个模型**（2026-09-17 实拉 `api.json` 统计），数据以 GitHub 仓库内按 provider/model 组织的 TOML 维护，社区 PR 更新。
- 维护方：opencode（anomalyco）生态；仓库 **`anomalyco/models.dev`**（自 `sst/models.dev` 迁移，GitHub API 显示 Moved Permanently），**MIT 许可**，6,884 ★，最后一次推送 2026-09-17T01:40Z——**当日仍在活跃更新**。
- 站点即查询界面 + 免费无鉴权 JSON API（无 SDK key、无调用限制声明）。

### 2.2 数据面（实测）

| 端点 | 内容 | 实测 |
| --- | --- | --- |
| `/api.json` | 全量：provider → `{ id, env, npm, api, name, doc, models{modelId: ModelSpec} }` | 4,689,192 字节，220 provider |
| `/models.json` | provider 无关目录，键 `lab/model`（如 `swiss-ai/apertus-8b`），条目含 license/links | 实拉解析正常 |
| `/catalog.json` | 合并目录 | 未逐一解析 |
| `/logos/{provider}.svg`、`/logos/labs/{lab}.svg` | 图标资产 | — |

ModelSpec 字段覆盖率（7843 模型实测）：`id/name/description/attachment/reasoning/tool_call/temperature/modalities/open_weights/limit/release_date/last_updated` **100%**；`family` 92%、`cost` 95%、`reasoning_options` 72%、`structured_output` 69%、`knowledge`（知识截止）52%、`interleaved`（思维链交错字段名）14%、`status`（含 deprecated）3.5%。

**DeepSeek 官方条目实例**（对位价值最高）：

```jsonc
"deepseek-v4-pro": {
  "family": "deepseek-chat", "reasoning": true,
  "reasoning_options": [{ "type": "toggle" }, { "type": "effort", "values": ["low","high","max"] }],
  "tool_call": true, "structured_output": true,
  "interleaved": { "field": "reasoning_content" },   // ← 本仓 reasoningReplay 契约的数据化表达
  "modalities": { "input": ["text","image"], "output": ["text"] },
  "limit": { "context": 1000000, "output": 384000 },
  "cost": { "input": 0.15, "output": 0.6, "reasoning": 0.6, "cache_read": 0.003 }  // $/Mtok
}
```

本仓 4 个 endpoint preset 在 models.dev **全部有对应 provider 条目**（实测）：`deepseek`、`stepfun`、`stepfun-step-plan`、`opencode`（= OpenCodeZen）、`opencode-go`。周边生态（moonshotai、zhipuai、minimax、alibaba 全家）覆盖完整。

### 2.3 消费方式（三选一）

| 方式 | 优劣 |
| --- | --- |
| npm `@opencode-ai/models@0.0.76`（MIT，零依赖） | 类型安全 + 离线快照内置；但 **unpacked 5.7MB**（内嵌全量数据），且 0.0.x 版本节奏未定 |
| **vendor 脚本下载 `api.json`（推荐）** | 沿用 `scripts/vendor-download.js` download-marker 模式（同 uv/granite 一族）：pin 拉取日期/内容哈希、进 `extraResources`、可控更新节奏、可裁剪（只保留视图需要的 provider 子集）；数据本身 MIT 无再分发障碍 |
| 运行时 fetch + 本地缓存 | 最新鲜，但引入网络依赖与首启冷路径，与"离线可用"基调冲突；只适合作为 vendor 之外的"检查更新"旁路 |

### 2.4 风险

- 社区数据质量与新鲜度依赖 PR 节奏（对主流 provider 覆盖密集，长尾可能有滞后/错误）；接入时应**只作建议来源**，用户手工登记的模型条目永远优先，且能力开关（thinking/vision 勾选）保留人工覆盖。
- 7843 条全量对选择器是噪声，需要按"已配置 endpoint 匹配 + 常用子集"裁剪视图。
- `cost` 单位为 $/Mtok（站方惯例），接入计费估算时需换算并与 `usage-ledger` 的本地 token 口径对齐（本地计数仍是唯一统计源的政策不变，价格只是乘数）。

---

## 3. Vercel AI SDK v7 调研

### 3.1 包拓扑与工程约束（npm registry 实测）

| 包 | 版本 | 许可 | 约束 |
| --- | --- | --- | --- |
| `ai` | 7.0.105 | Apache-2.0 | **Node ≥22**（与 `.nvmrc`=22 对齐）；仅 3 个传递依赖（`@ai-sdk/gateway`/`@ai-sdk/provider`/`@ai-sdk/provider-utils`，全 Apache-2.0）；ESM |
| `@ai-sdk/openai-compatible` | 3.0.51 | Apache-2.0 | 仅 2 个 `@ai-sdk/*` 依赖 |
| `@ai-sdk/deepseek` | 3.0.47 | Apache-2.0 | **存在但 ai-sdk.dev 无文档页（404）、README 空、models.dev 亦把 deepseek 指向 openai-compatible**——视为非主推路线，DeepSeek 走 openai-compatible 即正路 |

本仓只消费 **AI SDK Core**（`streamText`/`generateText`/tool 定义）。AI SDK UI hooks（renderer 有自己的栈）、Agent/Workflow/Harnesses 抽象（deepOrca 自己就是 harness，其循环/权限/压缩/语义路由均自研且更贴 DeepSeek 语义）**一律不用**——定位是替换 §1 表中"wire 层 ≈810 行"的传输层，不动引擎语义。

### 3.2 `createOpenAICompatible` 能力面（官方文档核实）

`name/baseURL/apiKey/headers/queryParams/**fetch**（可注入 undici Agent，keepAlive 策略可延续）/includeUsage/supportsStructuredOutputs/transformRequestBody（代理非标格式改写）/supportedUrls/metadataExtractor（非标响应字段捕获 → providerMetadata）`。

模型级 `providerOptions.{providerName}`：`reasoningEffort`、`strictJsonSchema`、`user`，且**任意未知键原样透传进请求体**——本仓 deepseek `{thinking:{type}, extra_body:{reasoning_effort}}` 信封可用透传表达（B 阶段电池需实测确认嵌套 `extra_body` 的透传保真）。

### 3.3 DeepSeek 契约吻合（`@ai-sdk/openai-compatible@3.0.51` dist 源码级核验）

| 本仓手写契约 | openai-compatible 实现（dist 实证） | 判定 |
| --- | --- | --- |
| 增量读 `reasoning_content ?? reasoning`（`reasoningReadFields`，base.ts:1148-1159） | `const reasoningContent = delta.reasoning_content ?? delta.reasoning`；chunk schema 同时声明两字段，注释："Most openai-compatible models set `reasoning_content`, but some providers serving `gpt-oss` set `reasoning`. See #7866" | **同构**，连兼容面都一致 |
| DeepSeek V4.1 工具轮回放：assistant 消息须携带已存 `reasoning_content`，无则**省略键**（converter L154-175 的 `"content"` replay 模式） | assistant 消息转换：`...reasoning.length > 0 ? { reasoning_content: reasoning } : {}`；另对 Gemini thought_signature 走 `extra_content`（回放设计泛化到多家族） | **同构**（省键语义逐字符一致） |
| `stream_options.include_usage`（base.ts:950-957） | provider 级 `includeUsage` 选项 | 等价 |
| usage 缓存/推理拆分（base.ts:980-998 本地合并） | 解析 `prompt_tokens_details.cached_tokens → cacheReadTokens`、`completion_tokens_details.reasoning_tokens → reasoningTokens`；**不解析 DeepSeek 非标的 `prompt_cache_hit_tokens`** | 部分等价——DeepSeek 缓存命中需 `metadataExtractor.createStreamExtractor` 捕获（或维持本地合并逻辑） |
| tool_calls 按 index 缝合（base.ts:1166-1194） | index/id/function 增量缝合，且容忍 Google 缺 index | 覆盖 |
| 前缀字节稳定（turn-tail 请求期追加，converter L86-108） | AI SDK 按传入消息原样转换，转换确定性可测 | 可保留——见风险 R3 |
| dirge 文本通道兜捞工具调用（tool-call-repair.ts 466 行） | 无此能力（期望结构化通道） | **保留自研**，作用于归约后文本，与传输层正交，不受迁移影响 |
| 多模态门控（仅 user 角色 + `supportsMultimodal` 才发图，converter L177-196） | AI SDK 不做产品级门控 | **保留自研**（发送前闸门，不动传输层） |

### 3.4 `streamText` v7 形状（官方文档核实）

- `result.stream` 全量事件流：`start/start-step/text-start|delta|end/reasoning-start|delta|end/tool-input-start|delta|end/tool-call/tool-result/tool-error/finish-step/finish/abort/error/raw`；`textStream` 纯文本便捷视图；**背压感知**（按消费速度生成）。
- usage：`inputTokens + inputTokenDetails{cacheReadTokens,cacheWriteTokens,noCacheTokens} / outputTokens + outputTokenDetails{reasoningTokens,textTokens} / totalTokens`——比现在拿到的更细。
- 错误**折叠进流**（`onError` 回调 + `error` part）而非抛同步异常；`APICallError` 携带 statusCode/响应体（文档口径）——`classifyLlmError` 可继续工作，但消费姿势要从"try/catch"改为"流内错误分派"（B 阶段电池验证点）。
- 工具定义 `inputSchema`（Zod；本仓 `zod ^4.4.3` ✓）；`onChunk/onEnd` 回调；`abortSignal` 支持（`abort` part 与本仓 AbortController map 对得上）。
- 每步带性能指标（TTFO、chunk 间隔分位、tokens/sec）——可白捡进诊断日志。

---

## 4. 两者与本仓的对位总表

| 现状关切 | models.dev 贡献 | AI SDK 贡献 | 判定 |
| --- | --- | --- | --- |
| 2 家族硬编码目录 → 真实目录 | **主贡献**：220 provider/7843 模型规格（窗/价/模态/reasoning_options/interleaved/知识截止/开放权重） | — | A 阶段 |
| 模型选择器体验（手工填 id + 勾 thinking/vision） | 供给可搜索候选 + 能力默认值（勾选仍可人工覆盖） | — | A 阶段 |
| 压缩阈值（`contextWindowTokens`） | 供给真实 `limit.context`（阈值策略仍自研派生） | — | A 阶段 |
| token 费用估算（usage-ledger 只有量没有价） | 供给 `cost`（$/Mtok，含 cache_read 差价） | — | A 阶段 |
| wire 层 810 行（SSE/缝合/非流式兜底） | — | **主贡献**：传输/解析/缝合/usage 标准化，契约源码级吻合 | B 阶段 |
| reasoning 回放 / thinking 信封 / include_usage | `interleaved`/`reasoning_options` 字段可反哺开关自动化 | 原生内置（§3.3），信封靠 providerOptions 透传（待实测） | B 阶段 |
| 错误分类 / idle 看门狗 / 自动恢复 | — | APICallError 带 status/body；流可包 `withStreamIdleTimeout`（AsyncIterable 竞速照用）；恢复策略自研不动 | 保留自研 |
| 本地 token 计量（唯一统计源） | 价格乘数 | pre-flight 计数改对 ModelMessage 或转换前 OpenAI 形状计数，chokepoint 平移 | 保留自研 |
| 前缀缓存稳定（turn-tail） | — | 消息原样转换，确定性需黄金测试锁定 | B 阶段验证 |
| Electron 打包 / 许可 | MIT 数据，vendor 脚本进 extraResources | Apache-2.0 全链，主进程 exact-pin，esbuild external 照旧 | 无障碍 |

---

## 5. 风险与缺口（按严重度）

- **R1（依赖纪律存量）**：`openai`/`undici` 现为 `^` range 却在主进程执行，本就违反 exact-pin 红线。AI SDK 引入时须 exact-pin `ai` + `@ai-sdk/openai-compatible`，并建议顺势把 `openai`/`undici` 一并收严（若 B/C 阶段成行，`openai` 最终整体退役）。
- **R2（最大工程成本：消息模型二选一）**：`SessionMessage.messageParams` 持久化的是 OpenAI wire 形状；AI SDK 输入是 `ModelMessage`，输出回灌是 `responseMessages`。两条路：(a) 咽喉点处 OpenAI↔ModelMessage 双向转换（持久层不动，但转换层本身要测，且 reasoning 回放数据在 ModelMessage assistant part 里的存取要对齐）；(b) 存储迁移到 ModelMessage 形状（一步到位但有存量会话/索引兼容成本）。**→ 已拍板关闭（2026-09-17，§0 决策 3）：选方案 (a) 边界转译层，存储不迁移。**
- **R3（前缀缓存确定性）**：DeepSeek 上下文缓存按前缀字节命中，AI SDK 的消息→wire 转换若在不同版本间改变字段序/序列化细节，缓存命 中率会静默衰减。需要"同一 ModelMessage 列表 → 请求体字节级黄金快照"测试锁版本。
- **R4（DeepSeek 非标字段）**：`prompt_cache_hit_tokens`（缓存命中统计）不在 openai-compatible 解析面内，需 metadataExtractor 或保留本地合并；`extra_body.reasoning_effort` 嵌套透传待实测。
- **R5（错误流折叠）**：同步异常 → 流内 error part 的范式变化波及 `classifyLlmError` 的 6 个调用姿势与自动恢复路径；API-returned status/body 的可得分需电池验证。
- **R6（目录数据质量）**：models.dev 社区维护，接入必须"建议优先、人工覆盖永远赢"；对 7843 条做裁剪视图。
- **R7（快照体量）**：`@opencode-ai/models` 5.7MB 全量快照进包不划算；vendor `api.json`（4.7MB，可裁剪）或按需子集更贴仓库模式。
- **R8（生态节奏）**：AI SDK 主版本节奏快（v5→v7 两年三major），exact-pin + 升级窗口策略（随发版周期统一评估）应写进 spec。

---

## 6. 落地建议（三阶段，均为提案，实现以 spec 为准）

### 阶段 A：models.dev 目录接入（低风险高价值，独立成篇 spec 即可启动）

1. `scripts/vendor-models-dev.js`（download-marker 模式）拉 `api.json` 进 `vendor/models-dev/`，记录拉取日期 + 内容哈希；可配裁剪清单（默认全量，安装包增量 4.7MB 可接受；后续再瘦身）。
2. core 新建 `common/model-catalog.ts`：vendor JSON（host 注入路径，遵守 vendor 路径红线）→ 规格视图；`model-capabilities.ts` 的家族/覆盖逻辑改为"目录数据优先、MODEL_OVERRIDES 修缺、UNKNOWN 兜底"三级合并，**保持零依赖与现有导出形状**（renderer 子路径共享不动）。**→ 拍板后收窄（§0 对位）**：与 model-fleet-adaptation 的"厂商文档手工核填"原则对齐，目录数据不进家族语义层（thinking 协议/replay/reasoningField 仍手工登记）；catalog 只做未登记模型 fail-open 增强 + 设置建议源 + 费用乘数，注册表解析序不变。
3. desktop：SettingsPanel 模型登记改为"可搜索候选 + 规格预填（窗/能力勾选默认值）+ 人工覆盖"；tokens 面板用 `cost` 乘出费用估算（本地 token 计数政策不变）。
4. 出口判据：现有 4 preset 端点全部能从目录反查出模型规格；无目录/坏目录时行为与今天完全一致（fail-open 到现有 2 家族逻辑）。

### 阶段 B：AI SDK 金丝雀（P0 电池驱动，先证伪再铺开）

> **拍板落点（2026-09-17，§0 决策 2/3）**：本阶段整体并入 [`model-fleet-adaptation` §七 / X 系列（X0–X2）](../../specs/model-fleet-adaptation/design.md)——实验通道默认关、边界转译不迁移持久化、DeepSeek 语义保留为红线；下述电池并入该 spec（B1–B7，另增"转译往返黄金"与 port 类型专项）。

在 `createChatCompletionStream` 旁挂 `streamText` 通道（设置项开关，默认关），对同一会话录制双通道请求/响应，跑 **P0 电池**：

1. **黄金对拍**：固定消息序列（含工具轮、reasoning、图片、turn-tail），断言两通道发出的请求体关键字段等价（含 `reasoning_content` 回放的存在/省略边界）与归约结果一致。
2. **前缀确定性**：同一 ModelMessage 列表在 SDK 版本锁定下请求体字节级快照。
3. **非标字段**：DeepSeek 真流实测 `prompt_cache_hit_tokens` 获取路径（metadataExtractor vs 本地合并）与 `extra_body` 嵌套透传保真。
4. **错误分派**：断连/超时/4xx/5xx/abort 全家桶走流内 error part 后 `classifyLlmError` 分类不退化。
5. **看门狗/背压**：`withStreamIdleTimeout` 包 AsyncIterable 的组合行为；idle 计时不受背压影响。
6. **性能对账**：TTFO、吞吐、内存与现有通道对比（电池数据决定去留，不给印象分）。

出口判据：电池全绿 + 消息模型决策（R2）定案 → 进入 C；任何一项证伪且无 workaround → 关闭 B 线，保留现状（`openai` SDK 通道继续服务，仅收严 exact-pin）。

### 阶段 C：全量切换（条件触发）

> **拍板追加前提（§0 决策 1）**：除"B 电池全绿 + 灰度数据"外，不可妥协前提是**不弱化任何 DeepSeek/家族既有语义**；触发时点另立决策，不在 spec 首期范围。

B 绿后才排期：迁移六个调用点（主循环/压缩/深度泳道/辅助/后台任务/视觉端点）、退役 `openai`/`undici` 依赖、错误与恢复路径统一切流、`npm run check && npm test` 全绿 + 真机回归。**回滚**：咽喉点旁挂结构天然支持一键切回。

---

## 7. 参考资料（2026-09-17 快照）

- models.dev 站点与 API：<https://models.dev/>（`/api.json` `/models.json` `/catalog.json`）；GitHub **`anomalyco/models.dev`**（MIT，自 sst 迁移）；npm `@opencode-ai/models@0.0.76`
- AI SDK：<https://ai-sdk.dev/docs/introduction>（v7）、`/docs/ai-sdk-core/stream-text`、`/providers/openai-compatible-providers`；npm `ai@7.0.105` / `@ai-sdk/openai-compatible@3.0.51` / `@ai-sdk/deepseek@3.0.47`
- 源码核验样本：`unpkg.com/@ai-sdk/openai-compatible@3.0.51/dist/index.js`（reasoning 增量解析 / assistant 回放 / usage 细节三处实证）
- 本仓对位：`packages/core/src/session-manager-base.ts`、`common/{openai-client,model-capabilities,openai-message-converter,openai-thinking,token-counter,usage-ledger,llm-error,tool-call-repair}.ts`、`session-stream.ts`
