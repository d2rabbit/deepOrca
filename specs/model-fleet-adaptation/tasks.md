# 模型舰队收官适配 — 任务清单

> 对应需求：[requirements.md](./requirements.md)（R1–R12）/ 设计：[design.md](./design.md)（§二 抽象详案 + §七 传输线摘要为实施基准）。
> P0：DeepSeek V4 基线（含新 variant）/ GLM5 / Kimi 2.5→K3；P1：MiniMax M3 / Qwen 3.8。
> **范围：仅 OpenAI chat 格式**；Claude 格式与新 reasoning 模式见文末待定 Backlog。
> **2026-09-17 吸收**：[ai-sdk-experimental-adapter](./ai-sdk-experimental-adapter/tasks.md) 并入为 **X 系列**（实验性 AI SDK 传输线，三项拍板见 design §七；完整任务详单与出口/回滚细则见工件）；本 spec 同日自 next-version 规划区 git mv 至活跃区。
> **2026-09-17 二次拍板（范围重构）**：除已适配 **deepseek/stepfun** 外，S1–S4 原生登记**取消、转 X4**；**后续所有新模型依托 X 系列接入**；X3 数据轨升为 X4 前置（原则上不再否决）。对应需求 **R13**。

## G0 通用改造（先行，2-2.5 天）

### 注册表与解析

- [x] G1.0 DeepSeek V4 当日新发布 "version" variant 核对（确切 model 串/窗口/思考默认/多模态/轻量等价物），与基线型号一并登记进 deepseek 家族条目与 `MODEL_OVERRIDES`
  - 结论（2026-08-21 两次核对官方 pricing/Change Log）：**三模型**——`deepseek-v4-flash`（V4-Flash-0731）/ `deepseek-v4-pro`（V4-Pro-0813）/ **`deepseek-v4-flash-vision-exp`**（图像理解实验版，**多模态**，思考默认开；文档 1M 窗口，压缩阈值维持产品 512K 既有值）；`deepseek-chat`/`deepseek-reasoner` 已于 2026-07-24 停用——四串全部登记（停用串保留 override 兼容存量设置）。_Requirement: R1_
- [x] G1.1 `model-capabilities.ts` 重塑为注册表：`ModelFamilySpec`/`ModelSpec` 类型、FAMILIES（deepseek + unknown 一等条目；glm/kimi/minimax/qwen 随 S1-S4 落地）、`MODEL_OVERRIDES`、`resolveModelSpec()` 四步解析（精确覆盖→pattern→baseURL host 兜底→UNKNOWN）；deepseek 家族按现值登记（`lightweightModel: "deepseek-v4-flash"`）；删除旧常量并清理 `index.ts` re-export
  - 模块保持零依赖（已验证 renderer 可经 `@deeporca/core/capabilities` 导入）。_Requirement: R1, R2, R8_
- [x] G1.2 门面切换：`defaultsToThinkingMode`/`supportsMultimodal` 改查 `resolveModelSpec`（签名不变，`supportsMultimodal` 保留旧 trim 语义）；`getCompactPromptTokenThreshold` 从 session.ts 迁入本模块，session.ts 改 import 并保留 re-export 稳定模块面
  - _Requirement: R1, R4_
- [x] G1.3 `ModelRegistration` 合并优先级：门面加可选 `registration` 参（用户登记 thinking/vision 覆盖家族默认；缺省行为不变）；新增 `findModelRegistration`（主端点优先，镜像 settings.ts 既有优先级）；message-converter 经 `resolveModelRegistration` 选项接线
  - _Requirement: R5_

### 后台任务选型链（P0 中的 P0）

- [x] G1.4 后台链落地：纯函数 `resolveBackgroundLlm()` 入注册表模块；SessionManager `createBackgroundLlm()` 组合（可注入 `createSecondaryClient`，默认接线 openai-client 保留设施）
  - _Requirement: R3, R4_
- [x] G1.4b **跨端点动态激活**（2026-08-21 补）：回退链加环①'——家族 lightweight 不在主端点时，扫描其他已配置端点（有 apiKey 且登记 models[]，如内置 opencode-zen / opencode-go 预设分开登记 flash 与 pro）的登记表，命中则经新增 `createEndpointClient(apiKey, baseURL)` 路由到该端点；环序 ①主端点 lightweight → ①'跨端点 lightweight → ②secondary → ③主模型；flash/pro 分布在不同端点时后台任务仍能用上家族 flash
  - _Requirement: R3_
- [x] G1.5 session.ts 五调用点切换（`judgeViaLlm` / `createSkillDecomposer` / `identifyMatchingSkillNames` / `enhancePrompt` / `compactSession`）；`@deeporca/memory` 副模型经 `settings.secondaryModel` 解析、无另置硬编码（链路 ② 天然覆盖）
  - _Requirement: R3_

### 协议分派

- [x] G2 `openai-thinking.ts`：+可选 `model?` 参，`THINKING_BUILDERS` per-family 表分派；deepseek 与 unknown 条目返回与今天逐字节相同对象 + golden 测试锁定；主循环/压缩/四处后台调用全部传 model
  - _Requirement: R6, R4_
- [x] G2b **effort 统一刻度与家族映射**（2026-08-22 二次定稿并实施）：独立文件 `common/think-level.ts`——统一五档 low/medium/high/xhigh/max（UI/settings 只存统一档），对外展示 关闭/初 (Low)/中 (Medium)/高 (High)，极高 (Extra High)/至高 (Max) 默认隐藏（合法但不入菜单）；DeepSeek V4 家族映射 `low→low、medium→high、high→high、xhigh→high、max→max` 入 `THINK_LEVEL_FAMILY_MAPS`，thinking builder 经 `mapThinkLevel` 投影；未登记家族恒等透传；`ReasoningEffort = ThinkLevel`，默认 high；TopBar/SettingsPanel 选项由 `THINK_LEVELS` 派生，i18n ×6 五档标签（CJK 括注英文）
  - _Requirement: R6_
- [ ] G2c **新家族 effort 映射登记**（2026-09-17 收窄至 escape-hatch 范围）：原生登记取消后新家族走 UNKNOWN 恒等透传；仅当 X4 验证发现某家族「effort 档位语义不兼容」时才按本任务登记（随首个实证缺口家族一并设计）
  - _Requirement: R6, R13_
- [x] G3 `openai-message-converter.ts`：reasoning 回显按 `reasoningReplay`（empty-field/omit/content）+ `reasoningField` 分派（converter 已持有 model，签名不变）；session.ts 流式读取改走 `reasoningReadFields`（nullish 链保序）；中转/持久化字段名走 spec（deepseek 值不变 → 存量会话兼容）
  - _Requirement: R6, R4_
- [x] G4 压缩阈值查 `spec.contextWindowTokens`（阈值语义保持满窗口触发；deepseek 512K / unknown 128K 现值；0.85 提前量不做，留后续调参）
  - _Requirement: R1, R4_
- [x] G4b **压缩阈值用户自定义**（2026-08-21 补）：`settings.compactTokenThreshold`（正整数 tokens，env `DEEPORCA_COMPACT_TOKEN_THRESHOLD` → project → user，非法值忽略，未设=注册表按模型默认）；session 主循环与 Stage-A 两处阈值检查接入覆盖；IPC 契约（SettingsSummary/EditableSettings）+ 设置面板输入项（五语言文案）+ TopBar/ContextProgress 进度条同步展示覆盖值。判别式测试：110K 介于覆盖 100K 与家族默认 128K 之间——仅覆盖生效才触发压缩
  - _Requirement: R1_
- [ ] G5 llm-error 新系列错误样本扩充（框架不动，按需增模式；随 **X4** 各系列验证收集，DeepSeek 基线无需新样本）
  - _Requirement: R6_

### 渲染层单一事实源与回归

- [x] G6 `core/package.json` exports 增 `"./capabilities"` 子路径；`renderer/lib/model-utils.ts` 与 `token-usage.ts` 删复制常量改导入；子路径已验证可从 desktop 解析导入（dist 产物零 Node 依赖）
  - _Requirement: R7_
- [x] G7 测试三层落盘：`tests/model-capabilities.test.ts` 17 例（解析矩阵含未知 deepseek-* 多模态语义锁定 / baseURL 提示与仿冒 host / 门面等价含 trim 语义 / registration 覆盖 / 回退链四环 / golden / converter 回显）
  - _Requirement: R1, R2, R3, R4_
- [x] G8.a 命令行门禁：`npm run build` + `npm run check`（typecheck+lint+format）全绿；`npm test` 全工作区 exit 0（core 625 例 0 失败）
- [ ] G8.b DeepSeek 真机回归一轮（desktop:startMac 会话→工具→压缩链路）——**零行为变化是硬门**（命令行已锁，真机待桌面环境执行）
  - _Requirement: R4_

## S0 DeepSeek V4 基线复核（P0）✅ 2026-08-21

- [x] S0.1 家族按现值登记（见 G1.0 结论：三模型 flash / pro / flash-vision-exp 全部登记，vision-exp 为多模态；chat/reasoner 停用但保留 override 兼容存量）；跨端点激活见 G1.4b；真机 e2e 并入 G8.b

## S1–S4 —— 已转 X4（2026-09-17 二次拍板：原生登记取消，新模型全部依托 X 线）

原 S1.1–S4.8 的验证清单（型号清单 / 思考开关 / reasoning 字段 / 工具调用 / 窗口 / 多模态 / 缓存 / 错误样本 / 真机 e2e）**整体转为 X4 逐系列核对表**（见 X 系列 X4 组）；其中「注册表登记 + builder 核填」两项替换为「models.dev 覆盖核对 + X 通道验证」。Qwen 注意项（thinking 开关与 GLM 历史惯例不同）保留为 X4.4 核对点。

## X 系列：实验性 AI SDK 传输线 + 新模型接入正式路径（2026-09-17 吸收并二次拍板升格；X0–X2 传输线 4–5 天 + 真机半天；X3 数据轨 2–3 天；X4 接入 1.5–2.5 天；详单见工件）

### X0 依赖与设置地基

- [x] X0.1 `core/package.json` exact-pin 引入 `ai@7.0.105` + `@ai-sdk/openai-compatible@3.0.51`；`npm run license:check` 白名单直过（Apache-2.0 零 exception）；`npm run typecheck && npm run build` 全绿（esbuild 主进程 bundle 不内联验证） _Requirement: R11_
  - ✅ 2026-09-17 实施全绿：exact-pin 落 `core/package.json`；license 门禁 OK（零新 exception）；typecheck/build/lint/format/test/desktop:build 全绿（core 1020 例 + 各 workspace）。_红线 L4；不引 `@ai-sdk/deepseek`_
- [x] X0.2 `settings.experimentalSdkTransport`（默认 false；env `DEEPORCA_EXPERIMENTAL_SDK_TRANSPORT` → project → user；**项目文件开启项检疫忽略**）+ IPC 契约（SettingsSummary/EditableSettings）+ SettingsPanel「实验」分区 + i18n ×6 _Requirement: R9_
  - ✅ 2026-09-17：`settings.ts` 解析链**结构性排除** project 源（systemEnv → userSettings → userEnv，连 safeProject/projectEnv 都不读，强于检疫钳制）；IPC 契约 + session-bridge（开关只落用户文件，saveTarget=project 时旁路写用户文件）+ SettingsPanel 开关（debugLog 旁）+ i18n ×6；解析行为由 `ai-sdk-transport.test.ts` settings 用例锁定（默认 false / 用户设置 / 系统 env / **项目文件无法开启**）

### X1 port 类型与转译层（拍板③）

- [x] X1.0 `common/llm-transport.ts` **port 纯类型模块**：`LlmTransportRequest` / `LlmTransportResult`（归约形状 `{choices, usage, localUsage}`）与通道签名；type-only、不进 capabilities 子路径、不被注册表 import；两通道签名编译期 `satisfies` 断言 _Requirement: R11_
  - ✅ 2026-09-17：`common/llm-transport.ts`（LlmTransportChunk/Stream/Context/Channel/RequestBody；仅 `import type` openai 消息类型）；`ai-sdk-transport.test.ts` 顶部 `runAiSdkChatCompletionStream satisfies LlmTransportChannel` 编译期断言。_design §七 分层定则：注册表"指名"、port "定形"、通道"做事"_
- [x] X1.1 `common/model-message-adapter.ts` 双向转译纯函数：出向（`tool_calls`→tool-call parts、`reasoning_content`→reasoning part（**回放链第一跳**）、tool→tool part 序列化同现 converter、图片门控通过才转 file part、turn-tail 转换前执行）+ 回向（归约产物→OpenAI 形状落盘消息，reasoning 写回 `spec.reasoningField`）_Requirement: R10, R11_
  - ✅ 2026-09-17 实施口径微调：**回向不作为数据路径存在**——传输层直接再合成 OpenAI wire chunk 流（`ai-sdk-transport.ts` synthesizeChunks），会话管理器归约/落盘逻辑原样复用（B2 parity 由构造保证）；转译层两遍扫描解决 ToolModelMessage 的 toolName 反查。adapter 仅出向纯函数。
- [x] X1.2 电池 B1 转译往返黄金（OpenAI→ModelMessage→模拟转换→OpenAI 字段等价；覆盖回放存在/省略边界、工具轮中断补写、图片门控、turn-tail、refusal；mutation-check 一次）_Requirement: R10_
  - ✅ 2026-09-17：`tests/model-message-adapter.test.ts` 6 例全绿（往返含镜像 openai-compatible 转换器的 wire 半程）；mutation-check 完成（破坏回放分支 → 2 红 → 恢复 → 6 绿）。

### X2 实验传输层（拍板②）

- [x] X2.1 `common/ai-sdk-transport.ts`：`createOpenAICompatible` 工厂（`apiKey::baseURL` 缓存、undici Agent 经 `fetch` 注入、`includeUsage`、metadataExtractor 骨架）+ `streamText` fullStream 归约对齐 base.ts:915-1304（content/reasoning/refusal/工具缝合/最终重组/`onDelta` 透传），实现 X1.0 port _Requirement: R11_
  - ✅ 2026-09-17 实施口径（合成策略）：传输层**不复制归约逻辑**——`synthesizeChunks` 把 fullStream 映射回 OpenAI wire chunk（text/reasoning-delta→delta.content/reasoning_content、tool-input-start/delta→按 index 缝合的 tool_calls、finish→usage chunk 含 cacheReadTokens/reasoningTokens 细分），既有归约/计量/dirge/重组 100% 共享。v7 现实适配：system 消息→`instructions` 选项；`maxRetries: 0`（传输层零重试，恢复策略归引擎）；RetryError 解包到末次 provider 错误。metadataExtractor 骨架=捕获路径占位（B4 定案）。
- [x] X2.2 咽喉点分流（`createChatCompletionStream` 入口 ~10 行）；**off 路径逐字节不变**断言测试 _Requirement: R9_
  - ✅ 2026-09-17：分流在 `session-manager-base.ts` create 调用点（单三元式 + 凭据从 client 实例读取）；off 路径保障=默认 false（settings 用例锁定）+ 分流仅布尔判断，legacy 分支代码逐字节未动；凭证提取 `readOpenAIClientEndpoint` 复用既有四工厂的端点解析。
- [x] X2.3 thinking 信封 providerOptions 透传（`buildThinkingRequestOptions` 输出→透传键；deepseek/stepfun golden；`extra_body` 嵌套失真退路 `transformRequestBody`）_Requirement: R11_
  - ✅ 2026-09-17：透传实现为**通用非标键通道**（MAPPED_BODY_KEYS 之外的一切顶层键——thinking/extra_body/reasoning_effort/response_format 等——经 providerOptions.deeporca 原样上 wire），B3 断言 `body.thinking`/`body.extra_body`/`body.stream_options.include_usage`；真机 wire 保真归 B4.2（退路 transformRequestBody 预留于 openai-compatible 原生选项）。
- [x] X2.4 本地计量接线：pre-flight 与 `localUsage` 对**转换前 OpenAI 形状**计数（`countRequestPayloadTokens` 零改动断言）；DeepSeek `prompt_cache_hit_tokens` 捕获占位（B4 定案 extractor vs 本地合并）_Requirement: R11_
  - ✅ 2026-09-17：计量代码在分流点**之前**（base.ts promptTokens 预检计数）与**之后**（localUsageWithApiCache 合并）均为共享路径，`countRequestPayloadTokens` 零改动（结构保证 + core 全量回归）；`prompt_cache_hit_tokens` 走既有合并点（base.ts:987），实验通道 usage chunk 带 `prompt_tokens_details.cached_tokens` 细分（B2 断言），原生路径 vs extractor 由 B4.1 定案。
- [x] X2.5 错误分派（`onError`/error part → `APICallError` → `classifyLlmError`，B5 分类矩阵：断连/超时/4xx/5xx/abort 与现通道等价）+ `withStreamIdleTimeout` 包流迭代（B6 背压组合）；自动恢复路径零改动 _Requirement: R11_
  - ✅ 2026-09-17：`mapAiSdkError`（RetryError 解包 + statusCode→status + responseBody→error.error.message）——B5 用例：429→RATE_LIMIT（含 status 断言）、401→AUTH、预中止→AbortError；B6：停滞流 80ms 看门狗触发 `LlmStreamIdleTimeoutError`→TIMEOUT。自动恢复代码零改动。
- [x] X2.6 电池 B2/B3/B5/B6 落盘（fixture mock；B3 请求体字节快照锁 SDK 版本）；B4/B7 真机手动清单成文（DeepSeek key） _Requirement: R9, R11_
  - ✅ 2026-09-17：`tests/ai-sdk-transport.test.ts` 7 例全绿——B2 双通道归约对拍（同 fixture 直读 vs 经 streamText+合成，reduce 结果 deepEqual）、B3 两次请求体 JSON 字节相等 + 信封/工具/消息链断言、B5×3、B6、settings 解析；B4/B7 清单成文 [x-battery-manual.md](./x-battery-manual.md)。

### X3 models.dev 数据轨（X4 前置——二次拍板后原则上不再否决，仅技术证伪可砍；与 §2.1 手工核填原则对位）

- [x] X3.1 `scripts/vendor-models-dev.js`：download-marker 拉 `api.json` → `packages/desktop/vendor/models-dev/`（MIT 可再分发；拉取日期+内容哈希 marker；裁剪配置）；extraResources 沿用 _Requirement: R12_
  - ✅ 2026-09-17：脚本（TTL 7 天刷新 + sha256/条目数 marker + 健全性下限 50 providers/1000 models + withAtomicSwap + assertPublicHttpsUrl）实拉落盘 **220 providers / 7842 models**；`build.mjs` 注册 `ensureVendored("models-dev", …)`（extraResources 沿 vendor/ 全树既有机制）。
- [x] X3.2 `common/model-catalog.ts`：host 注入 + 零依赖 + fail-open 查询（未登记模型窗/输出上限/多模态/工具调用默认值增强；**协议字段不从目录推导**，`resolveModelSpec` 解析序不变）；无目录/坏目录行为等价今天断言 _Requirement: R12_
  - ✅ 2026-09-17：模块零 import（host 注入 JSON 文本，`configureModelCatalog`）；门面增强仅在 `familyResolved === false` 分支（`getCompactPromptTokenThreshold`/`supportsMultimodal`），native 家族恒胜（用例断言 deepseek 512K 不被目录覆盖）；`tests/model-catalog.test.ts` 5 例全绿（fail-open/坏快照拒绝/建议源/费用）。desktop main 启动注入 vendor 路径（dev/打包同 `__dirname/../vendor` 解析）。
- [x] X3.3 设置面板建议源：模型登记「可搜索候选 + 规格预填（thinking/vision 勾选默认值）」，手工登记与勾选覆盖永远优先；i18n ×6 _Requirement: R12_
  - ✅ 2026-09-17：IPC `ModelsCatalogSuggest`（main 侧 catalogSuggestModels host 匹配，fail-open []）+ SettingsPanel datalist 合并（registry 家族建议在前、目录建议去重追加）+ 精确命中目录条目时预填 thinking/vision 勾选（勾选仍可手工改）。
- [x] X3.4 tokens 面板费用估算：`cost`（$/Mtok，含 cache_read 差价）× 本地 token 计数（唯一统计源政策不变）；经 `@deeporca/core/capabilities` 子路径零 Node 依赖 _Requirement: R12_
  - ✅ 2026-09-17 实施口径：接入点选定为既有费用估算链 `main/tools/token-pricing.ts`（tokens 面板 costUsd 的唯一来源）——目录价格升级为**主价格源**（含 cache_read 折扣档，cache 计费修正），内置 DeepSeek ballpark 表降级为离线兜底；本地 token 计数仍为唯一统计源（价格只是乘数），接口形状不变。

### X4 新系列经 X 线接入（2026-09-17 二次拍板承接原 S1–S4；X3 为前置；后续所有新模型沿用此路径）

- [x] X4.0 接入 SOP 定稿：验证清单模板（models.dev 目录覆盖核对 + X 通道真机四链路：会话→工具→权限→compaction/记忆）+ escape-hatch 判据成文（实证语义缺口 → 提请拍板加注册表条目） _Requirement: R13_
  - ✅ 2026-09-17：[x4-onboarding-sop.md](./x4-onboarding-sop.md)（三步接入流程 + 八项真机核对表 + escape-hatch 三条件 + 系列排期）。
- [ ] X4.1 GLM 5 系列接入（原 S1：目录覆盖核对（型号串/窗口/多模态/价格/`interleaved`）→ X 通道验证（工具调用/缓存对齐/错误样本入 G5/e2e 四链路）→ effort 恒等透传可用性确认） _Requirement: R13_
- [ ] X4.2 Kimi 2.5→K3 系列接入（原 S2，全区间型号目录核对；窗口差异经 catalog 数据而非 `MODEL_OVERRIDES`） _Requirement: R13_
- [ ] X4.3 MiniMax M3 系列接入（原 S3） _Requirement: R13_
- [ ] X4.4 Qwen 3.8 系列接入（原 S4；核对点：Qwen thinking 开关与 GLM 历史惯例不同——确认 UNKNOWN 透传形状可用，不可用即触发 escape hatch 提请拍板） _Requirement: R13_

**审查修复（2026-09-17，bug-hunt-swarm 四路审查后）**：F1 中段 system 消息原位保留（`allowSystemInMessages`，位置/前缀缓存契约由 dispatch 端到端断言锁定）；F3 usage 末值发射 + 全零防护（finish.totalUsage，raw 缓存字段自 finish-step 合入）；F2 渲染层目录分叉修复（slim hints 经 SettingsSummary 下传 + `configureCatalogHints` 注入，capabilities 子路径零快照）；错误映射补 cause 链下钻（SDK statusCode-200 包装解包，mid-stream 4xx/5xx 保真）；DeepSeek 非标缓存字段经 usage.raw 直通；dispatch 测试 setHomeDir 隔离 + ledger 断言 + 生产归约 parity（reasoning/tools 混合 SSE）；P3 快赢（vendor 重定向重验证 / datalist 预填仅首次 / bridge 脏检查 / core 估算 clamp / pricing 输入价门槛）。门禁全绿。

**X 线出口**：B1–B6 全绿 + `npm run check && npm test` 全绿 → 允许灰度（默认仍关）；任一证伪且无退路 → 关闭**传输线**（回滚 = 关开关 / revert 依赖与分流提交，现通道零改动）。X3 仅技术证伪可砍（砍则 X4 回退手工清单核对）。C 段（全量切换）不在首期，前提见 design §七。

## 收官核对（0.5 天）

- [ ] X4 各系列回归 + `npm run check && npm test` 全绿 _Requirement: R4, R13_
- [ ] README/文档模型支持表更新（五系列 + OpenAI chat 格式范围说明）+ CHANGELOG 收官条目
- [ ] 跨厂商冒烟：单一 GLM-only 端点配置下后台任务（compaction/技能匹配/记忆）零 deepseek 调用（网络面板或 generation-log 验证；后台链 G1.4b 已落地，X4 验证复跑） _Requirement: R3_
- [ ] 渲染层复核：能力标记/用量条对新系列自动生效（原生家族 = 注册表；其余 = UNKNOWN + X3 目录增强），无双份常量残留 _Requirement: R7, R12_

## 待定 Backlog（不在本收官范围，需另行立项）

- Claude（Anthropic）消息格式适配
- 各家非-OpenAI-chat 的新 reasoning 模式协议
- 双后端 / 外部 agent 承接（已否决 2026-08-21，留档不排期）
- 实验传输线全量切换 / 退役 openai 通道（C 段——前提：X 线电池全绿 + 一个版本灰度数据 + 不弱化任何 DeepSeek/家族语义，见 design §七）
- `ModelSpec` 传输偏好字段（models.dev `npm` 字段的数据版思路，随 C 段后演进）

## 不做

- 厂商专有增值特性 / 模型自动路由 / 嵌入改造 / per-厂商官方 SDK 引入（见 design.md §六；**例外**：Vercel AI SDK 实验传输线为 2026-09-17 拍板引入，见 X 系列——非厂商绑定，仅传输层）
