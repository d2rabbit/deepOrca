# X 线真机手动清单（B4 / B7 + 灰度观察项）

> specs/model-fleet-adaptation §七 X2.6 成文要求：B1–B3 / B5–B6 已由 fixture 测试锁定
> （`packages/core/src/tests/{model-message-adapter,ai-sdk-transport}.test.ts`）；
> 本文是需要真实 DeepSeek key 与真机的项目，执行后在本文件勾选留痕。

## B4 — DeepSeek 非标字段真流（需 DeepSeek key + 网络关）

前置：设置面板开启「实验性 AI SDK 传输」（用户级开关），端点为 DeepSeek 官方或 opencode 预设；`~/.deeporca` 下开 debug 日志（settings `debugLogEnabled`）抓请求/响应。

- [ ] **B4.1 `prompt_cache_hit_tokens` 捕获路径定案**：连续两轮对话（第二轮长前缀复用），检查 tokens 面板缓存命中统计：
  - 若 openai-compatible 原生 usage 解析（`prompt_tokens_details.cached_tokens`）已覆盖 DeepSeek 返回 → 定案「原生路径」，关闭本项；
  - 若统计为零但 DeepSeek 文档口径返回 `prompt_cache_hit_tokens` → 需在 `ai-sdk-transport.ts` 接 `metadataExtractor.createStreamExtractor` 捕获并入 usage chunk（回写 X2.4，加 fixture 断言后关闭本项）。
- [ ] **B4.2 `extra_body.reasoning_effort` 嵌套透传保真**：thinking 开启 + effort=high，debug 日志核对实验通道请求体同时含 `thinking:{type:"enabled"}` 与 `extra_body:{reasoning_effort:"high"}`（fixture 层已由 B3 锁定；本项验证真实 wire——若厂商报未知字段错误，退路 `transformRequestBody` 已在 X2.3 预置）。
- [ ] **B4.3 工具轮 replay 真流**：一轮带工具调用的对话（bash），第二轮继续——确认无 400（replay 链真机闭环；fixture 层由 B1/B3 锁定）。

## B7 — 性能对账（真机基准，数据决定 C 段去留）

- [ ] **B7.1 TTFO**：同一提示（含长 system）在两通道各跑 5 轮，记录首 token 延迟中位数；差异 >20% 需归因（连接复用/首请求握手）。
- [ ] **B7.2 吞吐**：长生成（≥2K tokens 输出）各 3 轮，tokens/sec 中位数对账。
- [ ] **B7.3 内存**：10 轮连续会话后主进程 RSS 曲线对比（Electron 任务管理器或 process.uptime 采样）。
- 结论记录：____（全绿 → 允许灰度叙事；任一显著劣化 → 记 issue 进 X2 修复队列后再对）。

## 灰度观察项（开关开启后的连续证据，非阻塞）

- [ ] 开关 ON 下主会话 1 天正常使用，无错误分类退化（`llm-error` 日志无 UNKNOWN 激增）。
- [ ] 开关 ON 下 idle 看门狗无误报（长思考轮不触发 `LlmStreamIdleTimeoutError`）。
- [ ] 关态回归：开关关闭后行为与实验前一致（逐字节由 B2/分流断言锁定，此处真机复核一轮）。
