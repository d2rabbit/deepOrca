# 实验性 AI SDK 传输适配 — 任务清单

> 对应设计：[design.md](./design.md)。上游调研：[docs/research/2026-09-17-models-dev-ai-sdk-prestudy.md](../../../../docs/research/2026-09-17-models-dev-ai-sdk-prestudy.md)（含契约源码实证）。
> 拍板依据（2026-09-17）：① DeepSeek 专属优化保留（红线 L1）② 实验性 SDK 适配引入（L3 默认关）③ 持久化边界转译不迁移（L2）。
> **2026-09-17 工件化**：已吸收合并入 [`model-fleet-adaptation`](../tasks.md) X 系列（同日 git mv 至活跃区）；本清单保留为完整溯源工件，勾选留痕以存续 spec 为准。
> 粗估：WP1+WP2 ≈ 4–5 天（含电池落盘）+ B4/B7 真机半天；WP3 ≈ 2–3 天（独立可否决）。

## WP0 依赖与设置地基

- [ ] T0.1 `core/package.json` exact-pin 引入 `ai@7.0.105` + `@ai-sdk/openai-compatible@3.0.51`；`npm run license:check` 白名单直过（Apache-2.0，零 exception）；`npm run typecheck && npm run build` 全绿（ESM/external 兼容验证，esbuild 主进程 bundle 不内联）
  - _红线 L4；不引 `@ai-sdk/deepseek`_
- [ ] T0.2 `settings.experimentalSdkTransport: boolean`（默认 false；env `DEEPORCA_EXPERIMENTAL_SDK_TRANSPORT` → project → user 解析链沿用；**项目文件开启项被检疫忽略**，对齐端点/密钥隔离规则）；IPC 契约（SettingsSummary/EditableSettings）+ SettingsPanel「实验」分区 + i18n ×6
  - _红线 L3；拍板②_

## WP1 转译层（拍板③：持久化转译，不迁移）

- [ ] T1.0 新建 `common/llm-transport.ts` **port 纯类型模块**：`LlmTransportRequest` / `LlmTransportResult`（归约形状 `{choices, usage, localUsage}`）与通道函数签名；type-only、可 `import type` SDK 消息类型、**不进 capabilities 子路径**；现通道 `createChatCompletionStream` 与实验通道签名一致性由编译期 `satisfies` 断言锁定
  - _设计 §2.0（语义/机制抽象分界）；B2 对拍共用请求类型；红线 L1_
- [ ] T1.1 新建 `common/model-message-adapter.ts` 纯函数层：`openAIToModelMessages(params, { multimodalAllowed })`（assistant `tool_calls`→tool-call parts、`reasoning_content`→reasoning part（回放链第一跳）、tool→tool part（序列化与现 converter 一致）、图片门控通过才转 file part、turn-tail 在转换前对 OpenAI 形状执行）+ `reduceToOpenAIMessage(...)`（归约产物→OpenAI 形状落盘消息，reasoning 写回 `spec.reasoningField`）
  - _红线 L1/L2；设计 §2.1_
- [ ] T1.2 电池 B1 转译往返黄金测试：OpenAI→ModelMessage→模拟 openai-compatible 转换→OpenAI 字段等价；用例矩阵覆盖 reasoning 回放**存在/省略**边界、工具轮中断补写、图片门控、turn-tail、refusal
  - _设计 §四 B1；mutation-check 一次（临时破坏回放分支确认测试红）_

## WP2 实验传输层（拍板②：实验性引入，默认关）

- [ ] T2.1 新建 `common/ai-sdk-transport.ts`：`createOpenAICompatible` 工厂（`apiKey::baseURL` 键缓存；undici Agent keepAlive 经 `fetch` 注入；`includeUsage`；metadataExtractor 骨架）+ `runAiSdkChatCompletionStream` 与 `createChatCompletionStream` **同签名同返回形状**；fullStream 归约语义对齐 base.ts:915-1304（content/reasoning/refusal/工具缝合/最终消息重组/`onDelta` 透传）
  - _设计 §2.2；红线 L1（只消费既有语义模块）_
- [ ] T2.2 咽喉点分流：`createChatCompletionStream` 入口读取开关（~10 行）；**off 路径逐字节不变**断言测试（除设置读取与布尔判断外零副作用）
  - _红线 L3_
- [ ] T2.3 thinking 信封透传：`buildThinkingRequestOptions` 输出 → providerOptions 键透传；deepseek/stepfun golden 锁定（与现通道请求体关键字段等价）；嵌套 `extra_body` 失真时退路 `transformRequestBody`（B4 前先按文档口径实现）
  - _红线 L1（THINKING_BUILDERS 零改动）；设计 §2.3_
- [ ] T2.4 本地计量接线：pre-flight 计数与 `localUsage` 继续对**转换前 OpenAI 形状** payload（`countRequestPayloadTokens` 零改动断言）；SDK usage 填 `usage`（被动保留语义）；DeepSeek `prompt_cache_hit_tokens` 捕获路径占位（B4 定案）
  - _红线 L1（本地计数唯一统计源）；设计 §2.2_
- [ ] T2.5 错误与看门狗：`onError`/`error` part → `APICallError` → `classifyLlmError`（分类矩阵测试 B5：断连/超时/4xx/5xx/abort 与现通道等价）；`withStreamIdleTimeout` 包 stream 迭代（B6 背压组合测试）；自动恢复路径零改动
  - _设计 §2.2/§四 B5/B6_
- [ ] T2.6 电池 B2/B3/B5/B6 落盘（fixture mock；B3 请求体字节快照锁版本）；B4/B7 真机手动清单成文（DeepSeek key：缓存命中捕获 + effort 透传 + TTFO/吞吐/内存对账）
  - _设计 §四；出口 = B1–B6 全绿_

## WP3 models.dev 数据轨（建议项，独立否决；与 fleet spec 对位收窄）

- [ ] T3.1 `scripts/vendor-models-dev.js`：download-marker 模式拉 `api.json` → `packages/desktop/vendor/models-dev/`（MIT 可再分发；记录拉取日期+内容哈希；裁剪配置项）；electron-builder extraResources 沿用
  - _设计 §2.5_
- [ ] T3.2 `core/common/model-catalog.ts`：host 注入路径 + 零依赖 + fail-open 查询（未登记模型条目→窗/输出上限/多模态/工具调用默认值）；**家族协议字段不从目录推导**（`resolveModelSpec` 解析序不变，仅 UNKNOWN 兜底增强）；fail-open 断言（无目录/坏目录行为等价今天）
  - _拍板①对位：目录数据不进语义层_
- [ ] T3.3 设置面板建议源：模型登记「可搜索候选 + 规格预填（thinking/vision 勾选默认值）」，手工登记与勾选覆盖永远优先；i18n ×6
  - _设计 §2.5 消费点 2_
- [ ] T3.4 tokens 面板费用估算：`cost`（$/Mtok，含 cache_read 差价）× 本地 token 计数（唯一统计源政策不变）；经 `@deeporca/core/capabilities` 子路径，渲染层零 Node 依赖
  - _设计 §2.5 消费点 3_

## 出口与回滚

- **WP1+WP2 出口**：B1–B6 全绿 + `npm run check && npm test` 全绿 → 允许灰度（默认仍关）；B4/B7 手动清单执行完毕记录归档。
- **WP3 出口**：fail-open 断言 + 建议源/费用估算真机走查；可独立否决（否决 = 不合并 WP3，不影响 WP1/WP2）。
- **回滚**：关开关（用户级一键）；代码回滚 = revert 依赖与分流提交（现通道零改动，回滚零风险）。
- **C 段（全量切换/退役 openai）**：不在本 spec 首期；触发前提 = WP2 全绿 + 一个版本灰度数据 + 不弱化任何 DeepSeek/家族语义（拍板①），届时另立决策。
