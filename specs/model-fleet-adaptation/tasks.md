# 模型舰队收官适配 — 任务清单

> 对应设计：[design.md](./design.md)。P0：DeepSeek V4 基线（含新 variant）/ GLM5 / Kimi 2.5→K3；P1：MiniMax M3 / Qwen 3.8。
> **范围：仅 OpenAI chat 格式**；Claude 格式与新 reasoning 模式见文末待定 Backlog。

## G0 通用改造（先行，1.5-2 天）

- [ ] G1.0 DeepSeek V4 当日新发布 "version" variant 核对（确切 model 串/窗口/思考默认/多模态/轻量等价物）并补入 deepseek 家族表
- [ ] G1.1 `model-capabilities.ts` 家族注册表（family/models/contextWindow/defaultsToThinking/multimodal/lightweightModel/thinkingProtocol/reasoningField），deepseek 家族按现值登记
- [ ] G1.2 `resolveLightweightModel(endpoint)`：副模型按端点家族解析（compaction/技能匹配/记忆抽取/openai-client 四处调用点切换），回退链 家族 lightweightModel → settings.secondaryModel → 现常量
- [ ] G1.3 `defaultsToThinkingMode`/`supportsMultimodal` 改查注册表，签名不变
- [ ] G2 thinking 协议分派（`openai-thinking.ts` per-family 构造；DeepSeek 分支字节不变 + 回归锁定）
- [ ] G3 reasoning 字段分派（`openai-message-converter.ts`；DeepSeek 路径行为不变，session 测试锁定）
- [ ] G4 压缩阈值 per-model（session.ts 阈值改查 contextWindowTokens）
- [ ] G5 llm-error 新系列错误样本扩充
- [ ] G6 DeepSeek 全量回归（npm run check + npm test + 真机一轮）——**零行为变化是硬门**

## S1 GLM 5 系列（P0）

- [ ] S1.1 注册表登记（型号清单/窗口/思考默认/多模态，按 GLM 当日文档核填）
- [ ] S1.2 思考开关参数核填 → G2 分派落地
- [ ] S1.3 reasoning 字段核填 → G3 落地
- [ ] S1.4 工具调用格式核对（tools/并行/strict）
- [ ] S1.5 压缩阈值入表
- [ ] S1.6 前缀缓存命中核对
- [ ] S1.7 错误样本入 G5
- [ ] S1.8 真机 e2e（desktop:startWin + GLM 端点：会话→工具→权限→compaction→记忆四链路→跨会话召回）

## S2 Kimi 2.5 → K3 系列（P0，全区间型号一并登记）

- [ ] S2.1-S2.8（同 S1 清单，逐项核填留痕；2.5 / 3 / K3 各型号独立登记）

## S3 MiniMax M3 系列（P1）

- [ ] S3.1-S3.8（同上）

## S4 Qwen 3.8 系列（P1）

- [ ] S4.1-S4.8（同上；注意 Qwen 系 thinking 开关与 GLM 不同的历史惯例，勿复制粘贴）

## 收官核对（0.5 天）

- [ ] 全系列回归 + `npm run check && npm test` 全绿
- [ ] README/文档模型支持表更新（五系列 + OpenAI chat 格式范围说明）+ CHANGELOG 收官条目
- [ ] 跨厂商冒烟：单一 GLM-only 端点配置下后台任务（compaction/技能匹配/记忆）零 deepseek 调用（网络面板或 generation-log 验证）

## 待定 Backlog（不在本收官范围，需另行立项）

- Claude（Anthropic）消息格式适配
- 各家非-OpenAI-chat 的新 reasoning 模式协议
- 双后端 / 外部 agent 承接（已否决 2026-08-21，留档不排期）

## 不做

- 厂商专有增值特性 / 模型自动路由 / 嵌入改造 / 厂商 SDK 引入（见 design.md §六）
