# 实验性 AI SDK 传输适配（ai-sdk-experimental-adapter）

> **日期**：2026-09-17 立稿。
> **2026-09-17 工件化**：本 spec 已吸收合并入 [`model-fleet-adaptation`](../design.md) §七（X 系列任务，同日 git mv 至活跃区）；本文件保留为**完整设计与决策溯源工件**，实施基准以存续 spec 为准。
> **同日实施**：X0–X3 代码面按存续 spec 全量落地（本工件 §2.1 口径有一处微调：回向不作为数据路径——传输层直接合成 OpenAI wire chunk 流，归约/落盘逻辑 100% 复用；详见存续 spec tasks X1.1 勾选注记）。
> **定位**：在**保留全部自有模型语义**（DeepSeek 家族专属优化 + model-fleet-adaptation 家族注册表）的前提下，旁挂 **Vercel AI SDK（`ai` + `@ai-sdk/openai-compatible`）** 作为**实验性第二 LLM 传输通道**——默认关闭、可一键回退；消息持久化经**边界转译**，**不迁移存储**。
> **用户拍板（2026-09-17，三项）**：① 保留本项目 DeepSeek 专属优化与适配，SDK 路径不得绕开；② 引入实验性 SDK 适配能力；③ 持久化走转译、不迁移。
> **上游调研（含源码级契约实证）**：[docs/research/2026-09-17-models-dev-ai-sdk-prestudy.md](../../../docs/research/2026-09-17-models-dev-ai-sdk-prestudy.md)。关键实证：`@ai-sdk/openai-compatible@3.0.51` 原生内置 DeepSeek 三契约（`delta.reasoning_content ?? delta.reasoning` 增量解析 / assistant 回放"有则携带 `reasoning_content`、无则省键" / `includeUsage`），与本仓手写语义一致；`ai@7.0.105` Apache-2.0、Node ≥22、zod 工具定义。
> **关联 spec**：[model-fleet-adaptation](../design.md)（家族注册表、协议分派、渲染层单一事实源为其领地——本 spec **不改家族语义面**，只挂传输层）。其「双后端换主循环已否决」决策对本线同样生效：**主循环 / 权限 / 记忆 / 技能路由 / 压缩策略全部不动**。

---

## 一、红线（不可越）

| # | 红线 | 依据 |
| --- | --- | --- |
| L1 | **家族语义权威性**：本地 token 计量（家族路由 BPE/启发式、本地计数唯一统计源政策）、reasoning 回放（`reasoningReplay` 三模式）、thinking 信封（`THINKING_BUILDERS`）、dirge 文本兜捞（`tool-call-repair.ts`）、多模态门控（`supportsMultimodal` 闸门）、turn-tail 前缀缓存纪律——全部保留在既有模块；实验通道**只消费、不复制、不旁路、不弱化** | 拍板① |
| L2 | **持久化形状不变**：`SessionMessage.messageParams` 继续存 OpenAI wire 形状；转译只发生在实验通道边界（出向请求前、归约结果回填时）；存量会话 / 会话索引 / usage ledger 零改动 | 拍板③ |
| L3 | **默认关闭**：未显式开启（settings/env）时行为与今天**逐字节一致**（含分流代码路径零副作用——设置读取与布尔判断除外） | 拍板② |
| L4 | **依赖纪律**：`ai` 与 `@ai-sdk/openai-compatible` **exact-pin**（Electron 主进程红线；调研顺带曝光 `openai`/`undici` 存量 `^` range 张力，本 spec 不强制收严但新增依赖必须合规）；**不引** `@ai-sdk/deepseek`（无文档页/空 README/models.dev 亦指向 openai-compatible，非主推） | 仓库规则 + 调研 §3.1 |
| L5 | core UI-free 照旧；新模块不 import electron/react/Node 专属（vendor 资产路径 host 注入红线照旧） | 仓库规则 |

## 二、架构

```
SessionManager（零改动：主循环 / 压缩 / 后台任务 / 深度泳道 / 辅助调用 / 自动恢复）
  └─ createChatCompletionStream（唯一咽喉点，入口处分流，~10 行）
       ├─ off（默认）→ 现有 openai SDK 通道（openai-client.ts，零改动，权威通道）
       └─ on（实验） → common/ai-sdk-transport.ts（新）
            ├─ 出向：model-message-adapter.ts（新）OpenAI→ModelMessage 转译
            │        + THINKING_BUILDERS 输出 → providerOptions 透传（§2.3）
            │        + 多模态门控在转译前沿用既有闸门（L1）
            ├─ createOpenAICompatible({ baseURL, apiKey, headers,
            │        fetch: undici Agent(keepAlive), includeUsage, metadataExtractor })
            ├─ streamText(...) → result.stream 消费（归约语义对齐 base.ts:915-1304）
            └─ 归约结果 { choices, usage, localUsage } 回填 OpenAI 形状
               → 返回 SessionManager（持久层零感知，L2）
```

### 2.0 分层定则：语义抽象与机制抽象的分界（2026-09-17 补齐）

- **`model-capabilities.ts` = 语义上界（名词抽象）**：`ModelSpec` 是两个传输通道共同的参数源（字段名、replay 模式、thinking 协议键、窗口、门控）。fleet spec §2.0 已定其深模块纪律与零依赖硬约束（`model-capabilities.ts:7-9` 模块头注释），本线不越界——注册表可以"指名"（`ThinkingProtocolId` 键的既有模式：注册表持键、builder 机制在 `openai-thinking.ts`），不能"做事"。
- **机制抽象（动词）= 传输 port 类型**：显式化为新建 `common/llm-transport.ts` **纯类型模块**（type-only）——`LlmTransportRequest` / `LlmTransportResult`（即现归约形状 `{ choices, usage, localUsage }`）与通道函数签名。两通道实现同一 port 签名（编译期 `satisfies` 断言锁定）；电池 B2 双通道对拍天然共用同一请求类型；未来 Claude/Anthropic 格式通道（fleet spec Backlog）有正式接缝可挂。
- **落位规则**：`llm-transport.ts` 是主进程内部件（可 `import type` openai/ai 的消息类型），**不得**进 `@deeporca/core/capabilities` 子路径、不得被注册表模块 import——依赖方向恒为 `传输层 → { port 类型, 注册表 }`；port 类型 → （仅类型）SDK；注册表 → 无依赖。
- **推迟变体（记录不实施）**：`ModelSpec` 增加传输偏好字段（如 `transport: "openai-sdk" | "ai-sdk"`——models.dev `npm` 字段的数据版思路，每 provider 指明用哪个 provider 包）为 **C 段后演进**：现在加入会把实验状态固化进语义层（违反 L3 精神），灰度数据支持扶正后再议。

### 2.1 转译层 `common/model-message-adapter.ts`（纯函数）

出向 `openAIToModelMessages(params, opts)`：OpenAI `ChatCompletionMessageParam[]` → `ModelMessage[]`。

- assistant `tool_calls` → tool-call parts（`toolCallId` 逐条对齐）；assistant 的 `reasoning_content`（家族 spec 的持久化字段）→ **reasoning part**——回放链第一跳：openai-compatible 转换器（dist 实证）会把 reasoning part 回放为请求体 `reasoning_content`，有则携带、无则省键，正是 DeepSeek V4.1 工具轮契约；
- tool role → tool part（output 序列化规则与现有 converter 的工具结果序列化保持一致）；
- 图片 parts 仅在门控通过时转 file part（门控失败时的剥离语义与现 converter 一致）；
- system/user 文本原样映射；turn-tail 请求期追加逻辑在转换**之前**对 OpenAI 形状执行（前缀字节稳定性不受转换器实现影响）。

回向 `reduceToOpenAIMessage(...)`：`streamText` 归约产物（text / reasoning / toolCalls）→ OpenAI 形状 assistant message（reasoning 写回 `spec.reasoningField`），供 `SessionMessage.messageParams` 落盘——与现通道归约块的最终消息重组语义（base.ts:1266-1275）对齐。

**验收核心是往返黄金测试（电池 B1）**：OpenAI → ModelMessage →（模拟 openai-compatible 转换）→ OpenAI 的字段等价断言，覆盖 reasoning 回放存在/省略边界、工具轮中断补写、图片门控、turn-tail。

### 2.2 实验传输层 `common/ai-sdk-transport.ts`

- `runAiSdkChatCompletionStream(...)`：与 `createChatCompletionStream` **同签名、同返回形状**（`{ choices, usage, localUsage }`），分流处二者可互换。
- fullStream 消费：`text-delta / reasoning-delta / tool-input-start|delta|end / finish / error / abort` 分派 → 归约语义对齐现通道（content / reasoning / refusal / 工具按 index→toolCallId 缝合 / 最终消息重组）。`onDelta` 透传参数照旧透传（editor-agent 桥零感知）。
- usage：SDK usage（`inputTokenDetails.cacheReadTokens` 等）填 `usage`（对应现有 apiUsage 被动保留语义）；**`localUsage` 仍由本地计数器对转换前的 OpenAI 形状 payload 计数**——统计链零改动（转译不迁移的直接红利，L1/L2）。DeepSeek 非标 `prompt_cache_hit_tokens` 经 `metadataExtractor.createStreamExtractor` 捕获并入本地缓存命中统计（B4 实测定路径：extractor vs 维持现有合并逻辑）。
- 错误：`onError` / 流内 `error` part → 还原 `APICallError`（statusCode/响应体）→ `classifyLlmError` 照常分类；自动恢复路径（lifecycle.ts:713-753）零改动。
- 流看门狗：`withStreamIdleTimeout` 包 result.stream 迭代（AsyncIterable 竞速组合不变，B6 验证）。
- 工厂缓存：按 `apiKey::baseURL` 键缓存 `createOpenAICompatible` 实例（对齐 openai-client 四工厂语义；v1 单工厂形态，secondary/endpoint/vision 复用分流处既有解析）。

### 2.3 thinking 信封透传

`buildThinkingRequestOptions` 输出（deepseek `{thinking, extra_body.reasoning_effort}` / stepfun 顶层 `reasoning_effort`）→ providerOptions 键透传（openai-compatible 文档口径：任意未知键原样进请求体）。**嵌套 `extra_body` 透传保真是 B4 实测项**；若失真，退路是 `transformRequestBody` 请求体后处理（仍在传输层内，不碰 THINKING_BUILDERS）。

### 2.4 开关与设置

- `settings.experimentalSdkTransport: boolean`，默认 `false`；优先级沿用 settings 既有解析链（env `DEEPORCA_EXPERIMENTAL_SDK_TRANSPORT=1` → project → user）。**项目文件不得开启**（与端点/密钥隔离同款检疫，settings.ts:931 既有规则）。
- 设置面板"实验"分区 + i18n ×6 目录全量文案。
- v1 全局开关；per-endpoint 灰度留 backlog（§六）。

### 2.5 models.dev 数据轨（独立工作包 WP3，可单独否决）

与 model-fleet-adaptation 对位后收窄（拍板①的对位结论）：**目录数据不进家族语义层**。

- `scripts/vendor-models-dev.js`（download-marker 模式，同 uv/granite 一族）拉 `api.json` → `packages/desktop/vendor/models-dev/`（MIT 数据可再分发；全量 4.7MB，可配裁剪）；host 注入路径进 core。
- core 新建 `common/model-catalog.ts`（零依赖、host 注入、fail-open）三个消费点：
  1. **未登记模型 fail-open 增强**：`resolveModelSpec` 落入 UNKNOWN 时，若目录有该模型条目，补 `contextWindowTokens / 输出上限 / 多模态 / 工具调用` 默认值——家族协议字段（thinking 协议、replay、reasoningField）**不**从目录推导，仍手工核填（fleet spec 原则）；
  2. **设置面板建议源**：模型登记从自由文本升级为"可搜索候选 + 规格预填"，手工登记与能力勾选永远优先；
  3. **费用估算乘数**：tokens 面板用 `cost`（$/Mtok，含 cache_read 差价）乘本地 token 计数——本地计数唯一统计源政策不变，价格只是乘数。
- 目录缺失/损坏/未配置 → 全部消费点 fail-open 到现状（行为等价今天）。

## 三、改动面清单（精确到文件）

| 位置 | 改动 | 说明 |
| --- | --- | --- |
| `core/common/llm-transport.ts` | 新建（type-only，~40 行） | 传输 port 类型：请求/归约形状与通道签名；主进程内部件，不进 capabilities 子路径（§2.0） |
| `core/common/model-message-adapter.ts` | 新建（~250 行） | 纯函数双向转译 + 单测 |
| `core/common/ai-sdk-transport.ts` | 新建（~300 行） | 实验通道，同签名同返回形状 |
| `core/session-manager-base.ts` | 咽喉点入口分流（~10 行） | off 路径逐字节不变（断言测试） |
| `core/settings.ts` + IPC 契约 + SettingsPanel + i18n×6 | 开关一项 | 默认 false；项目文件检疫 |
| `core/package.json` | +`ai`/`@ai-sdk/openai-compatible`（exact-pin） | license 白名单直过 |
| `scripts/vendor-models-dev.js` + `core/common/model-catalog.ts` | 新建（WP3，可否决） | download-marker + fail-open 三消费点 |
| `renderer/lib/model-utils.ts` / `token-usage.ts` | WP3 费用估算接线 | 经 capabilities 子路径，零 Node 依赖 |
| **零改动** | `model-capabilities.ts` / `openai-thinking.ts` / `openai-message-converter.ts` / `openai-client.ts` / `token-counter.ts` / `usage-ledger.ts` / `tool-call-repair.ts` / `llm-error.ts` / 主循环与生命周期 | L1 红线：语义面全部原样 |

## 四、P0 电池（出口判据，先证伪再铺开）

| # | 电池 | 形态 | 判据 |
| --- | --- | --- | --- |
| B1 | 转译往返黄金 | 单测（fixture） | OpenAI→ModelMessage→模拟转换→OpenAI 字段等价；reasoning 回放存在/省略边界、工具轮中断补写、图片门控、turn-tail 全覆盖 |
| B2 | 双通道归约对拍 | 单测（同一 SSE fixture mock 两通道） | `{choices, usage, localUsage}` 一致（含 refusal、工具缝合、非流式兜底语义） |
| B3 | 前缀确定性 | 单测（字节快照） | 同一输入在锁定 SDK 版本下请求体字节级稳定（DeepSeek 前缀缓存杠杆） |
| B4 | 非标字段真流 | 真机（DeepSeek key） | `prompt_cache_hit_tokens` 捕获路径定案 + `extra_body.reasoning_effort` 嵌套透传保真；失真则走 `transformRequestBody` 退路并记录 |
| B5 | 错误分派全家桶 | 单测 | 断连/超时/4xx/5xx/abort → `classifyLlmError` 分类与现通道不退化；自动恢复触发条件等价 |
| B6 | 看门狗/背压组合 | 单测 | `withStreamIdleTimeout` 与背压感知流的组合：idle 计时不因消费慢而误报 |
| B7 | 性能对账 | 真机基准 | TTFO/吞吐/内存 vs 现通道；数据决定 C 段去留，不给印象分 |

**出口**：B1–B6 全绿 → 允许灰度（默认仍关，使用者显式开）；任一证伪且无退路 → 关闭实验线（回滚 = 关开关 / revert 依赖提交，现通道未动一根线）。B4/B7 需网络与真 key，列手动验证清单。

## 五、阶段

| 阶段 | 内容 | 出口 |
| --- | --- | --- |
| WP1 转译层 | §2.1 + B1 + B2 前半（fixture 化归约） | 转译往返与归约等价锁定 |
| WP2 传输层 | §2.2/2.3/2.4 + 分流 + B2–B6 + B4/B7 手动清单 | 电池全绿，开关可灰度 |
| WP3 数据轨（可否决） | §2.5 models.dev 三消费点 | fail-open 断言 + 设置面板建议源可用 |
| C 段（不在本 spec 首期） | 全量切换/退役 openai 依赖 | 触发前提：WP2 全绿 + 一个版本灰度数据 + **不弱化任何 DeepSeek/家族语义**（拍板①）；届时另立决策 |

## 六、开放点

- per-endpoint 灰度开关（v2，若灰度需求出现）。
- `@ai-sdk/*` 升级窗口策略：major 节奏快（v5→v7 两年三 major），exact-pin + 随发版周期统一评估 + B3 快照随升级重跑。
- DeepSeek 缓存命中路径定案（metadataExtractor vs 本地合并，B4 输出）。
- `openai`/`undici` 存量 `^` range 的收严时机（独立小改，不阻塞本 spec）。
