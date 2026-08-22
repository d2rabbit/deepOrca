# 模型舰队收官适配 — 任务清单

> 对应需求：[requirements.md](./requirements.md)（R1–R8）/ 设计：[design.md](./design.md)（§二 抽象详案为实施基准）。
> P0：DeepSeek V4 基线（含新 variant）/ GLM5 / Kimi 2.5→K3；P1：MiniMax M3 / Qwen 3.8。
> **范围：仅 OpenAI chat 格式**；Claude 格式与新 reasoning 模式见文末待定 Backlog。

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
- [x] G2b **effort 三档修正**（2026-08-22，依据官方 thinking_mode 文档）：实际生效等级为 low/high/max 三档（medium/xhigh 服务端映射 high），厂商默认 high——`ReasoningEffort` 扩为三档、全链默认值 max→high 对齐（settings/openai-client/openai-thinking）、TopBar 思考下拉与设置面板补"低"档（i18n ×6 `model.thinkingLow`）、golden 测试同步
  - _Requirement: R6_
- [ ] G2c **effort 扩展等级映射**（暂不展开，随 S1–S4 逐家族）：家族条目加 `effortLevels` + `mapEffort(unified→家族原生档)`，UI/settings 全程存 unified 三档、映射在 builder 内发生（方案见 design §2.4 映射方案段）
  - _Requirement: R6, R8_
- [x] G3 `openai-message-converter.ts`：reasoning 回显按 `reasoningReplay`（empty-field/omit/content）+ `reasoningField` 分派（converter 已持有 model，签名不变）；session.ts 流式读取改走 `reasoningReadFields`（nullish 链保序）；中转/持久化字段名走 spec（deepseek 值不变 → 存量会话兼容）
  - _Requirement: R6, R4_
- [x] G4 压缩阈值查 `spec.contextWindowTokens`（阈值语义保持满窗口触发；deepseek 512K / unknown 128K 现值；0.85 提前量不做，留后续调参）
  - _Requirement: R1, R4_
- [x] G4b **压缩阈值用户自定义**（2026-08-21 补）：`settings.compactTokenThreshold`（正整数 tokens，env `DEEPORCA_COMPACT_TOKEN_THRESHOLD` → project → user，非法值忽略，未设=注册表按模型默认）；session 主循环与 Stage-A 两处阈值检查接入覆盖；IPC 契约（SettingsSummary/EditableSettings）+ 设置面板输入项（五语言文案）+ TopBar/ContextProgress 进度条同步展示覆盖值。判别式测试：110K 介于覆盖 100K 与家族默认 128K 之间——仅覆盖生效才触发压缩
  - _Requirement: R1_
- [ ] G5 llm-error 新系列错误样本扩充（框架不动，按需增模式；随 S1–S4 各系列核填落地，DeepSeek 基线无需新样本）
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

## S1 GLM 5 系列（P0）

- [ ] S1.1 注册表登记：家族条目（modelPatterns/窗口/思考默认/多模态/lightweightModel）+ 覆盖表，按 GLM 当日文档核填 _Requirement: R1_
- [ ] S1.2 思考开关参数核填 → G2 builder 表 glm 条目 _Requirement: R6_
- [ ] S1.3 reasoning 字段核填（field/replay/readFields）→ G3 落地 _Requirement: R6_
- [ ] S1.4 工具调用格式核对（tools/并行/strict）
- [ ] S1.5 压缩阈值入表（含 per-variant 覆盖） _Requirement: R1_
- [ ] S1.6 前缀缓存命中核对
- [ ] S1.7 错误样本入 G5 _Requirement: R6_
- [ ] S1.8 真机 e2e（desktop:startWin + GLM 端点：会话→工具→权限→compaction→记忆四链路→跨会话召回） _Requirement: R3_

## S2 Kimi 2.5 → K3 系列（P0，全区间型号一并登记）

- [ ] S2.1-S2.8（同 S1 清单，逐项核填留痕；2.5 / 3 / K3 各型号独立登记——窗口差异走 `MODEL_OVERRIDES`）

## S3 MiniMax M3 系列（P1）

- [ ] S3.1-S3.8（同上）

## S4 Qwen 3.8 系列（P1）

- [ ] S4.1-S4.8（同上；注意 Qwen 系 thinking 开关与 GLM 不同的历史惯例，勿复制粘贴）

## 收官核对（0.5 天）

- [ ] 全系列回归 + `npm run check && npm test` 全绿 _Requirement: R4_
- [ ] README/文档模型支持表更新（五系列 + OpenAI chat 格式范围说明）+ CHANGELOG 收官条目
- [ ] 跨厂商冒烟：单一 GLM-only 端点配置下后台任务（compaction/技能匹配/记忆）零 deepseek 调用（网络面板或 generation-log 验证） _Requirement: R3_
- [ ] 渲染层复核：能力标记/用量条随注册表对新系列自动生效，无双份常量残留 _Requirement: R7_

## 待定 Backlog（不在本收官范围，需另行立项）

- Claude（Anthropic）消息格式适配
- 各家非-OpenAI-chat 的新 reasoning 模式协议
- 双后端 / 外部 agent 承接（已否决 2026-08-21，留档不排期）

## 不做

- 厂商专有增值特性 / 模型自动路由 / 嵌入改造 / 厂商 SDK 引入（见 design.md §六）
