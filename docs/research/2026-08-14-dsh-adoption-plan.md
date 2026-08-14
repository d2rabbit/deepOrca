# dsh 调研成果落地计划：对照 deeporca 现状的分层吸收方案

> 日期：2026-08-14 · 分支：fix/stabilize-data-loss-and-test-suite
> 前置文档：[2026-08-14-dsh-deepseek-optimization-takeaways.md](2026-08-14-dsh-deepseek-optimization-takeaways.md)（机制清单）、[2026-08-14-deepseek-harness-deep-dive.md](2026-08-14-deepseek-harness-deep-dive.md)（全景）
> 约束：**不影响现有进度与方向**——designer 产品线继续推进；本分支（data-loss 稳定化 + 测试套件）正常收尾；一切吸收按"先修正确性、再顺势加固、后演进架构"分层，不引入对 dsh 的代码依赖（纯设计吸收）。
> 现状依据：对 packages/core 的十点专项审计（converter / usage / SSE / 错误分类 / compaction / prompt 顺序 / 持久化 / subagent / 权限 / IPC），下文逐项引用 file:line。

---

## 〇、现状对账速览

| #   | 机制             | deeporca 现状                                                                                                                                    | 差距判定                                                                                                                                                                                                                  |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | reasoning 回传   | **有意的一刀切空串**回传（converter:148-156），真实 reasoning 永不回传；`content:""` 而非 null ✓；中断 tool call 请求时合成、不落盘 ✓            | 策略差异，非 bug——**保持现状**                                                                                                                                                                                            |
| 2   | usage/cache 折算 | ~~cache 字段原样累加；压缩阈值用 `total_tokens` 原始累计值~~                                                                                     | ✅ **P0-1 已落地（2026-08-14）**：`activeTokens` 切 prompt 侧口径（`getLastPromptTokens`），新增 `getFreshInputTokens` 互斥折算 cache 命中；压缩阈值不再含输出 token/累计值                                               |
| 3   | SSE/流健壮性     | ~~裸 `for await` SDK 流；无 idle 超时，断流即会话 failed~~                                                                                       | ✅ **P0-3 已落地（2026-08-14）**：`createChatCompletionStream` 全消费方过 `withStreamIdleTimeout` 看门狗（单次读取计时，默认 300s，`streamIdleTimeoutMs`/`STREAM_IDLE_TIMEOUT_MS` 可调），超时归 TIMEOUT 并可自动重试一次 |
| 4   | 错误归一化       | ~~无错误码分类；溢出错误 → 直接 failed~~                                                                                                         | ✅ **P0-2 已落地（2026-08-14）**：`classifyLlmError()` 八类分类器 + `runActivationLoopWithAutoRecovery`——溢出自动 compact-and-retry 一次、TIMEOUT 重试一次、QUOTA 显式不重试                                              |
| 5   | compaction       | 有：阈值 512K/128K、压最旧 2/3 留尾 1/3、独立摘要 prompt + JSONL dump、固定 flash 模型（prompt.ts:377-391）                                      | 部分缓解（P0-2 已把溢出接进自动压缩；压缩后 `activeTokens` 归零重计量）；无 tool-result 预剪、摘要无前缀缓存复用 → 归 P1-2                                                                                                |
| 6   | 工具顺序稳定     | 内置 7 工具字面量顺序固定 ✓；外部 MCP/action 工具依赖路由/注册顺序（session.ts:2788-2793）                                                       | 小缺口：外部工具序跨运行可能抖动，损害前缀缓存 → P1-3                                                                                                                                                                     |
| 7   | 持久化           | 本分支已修 index 丢失（pendingIndex + flush 原子写）；崩溃在途 tool call **无落盘合成收尾**，resume 会**实际重跑**未完成 tool calls（2740-2762） | 恢复语义风险：崩溃后重放有副作用操作 → P1-1                                                                                                                                                                               |
| 8   | runSubagent      | 最简实现；无深度上限（注释自认）、无降权、返回值仅末条文本                                                                                       | 增强项，非紧迫                                                                                                                                                                                                            |
| 9   | 权限流           | 纯函数 + 约 5 处触点（session.ts:2820-2865 等），可抽扩展点                                                                                      | 架构演进项，不急                                                                                                                                                                                                          |
| 10  | IPC              | 15 推送 + ~90 请求通道；本分支新增 design 域三通道（未提交）                                                                                     | 健康，无需动作                                                                                                                                                                                                            |

## 〇点五、P0 落地记录（2026-08-14）

P0 三项已在本分支落地（纯 core 改动，无 desktop/UI/依赖变更）：

- **P0-1**：`session.ts` 新增 `getLastPromptTokens()` / `getFreshInputTokens()`（prompt − cache_hit，兼容 DeepSeek `prompt_cache_hit_tokens` 与 OpenAI `prompt_tokens_details.cached_tokens` 两种口径，负值钳零）；`activeTokens` 三处赋值从 `total_tokens` 切到 prompt 侧；`compactSession` 完成后 `activeTokens` 归零，由下一次真实请求重新计量。渲染层的上下文进度条（TopBar/ContextProgress 原本就是 activeTokens ÷ 阈值）随口径自动对齐。
- **P0-2**：`llm-error.ts` 新增 `classifyLlmError()`（AUTH/QUOTA/RATE_LIMIT/CONTEXT_WINDOW_EXCEEDED/SERVER/TRANSIENT/TIMEOUT/UNKNOWN，正则族含 "exceeds context limit" 等 DeepSeek 实测文案）；`activateSession` 的激活循环提取为闭包，经 `runActivationLoopWithAutoRecovery()` 包装——溢出 → 通知 + `compactSession` + 重放一次；TIMEOUT → 直接重放一次；QUOTA/其余 → 原失败路径；压缩自身失败时上报原始溢出错误。防循环采用**每次激活一次**的重试预算（激活由用户发起，预算随激活刷新；崩溃自动重放场景归 P1-1 处理）。
- **P0-3**：`session.ts` 新增 `withStreamIdleTimeout()`（单次 `next()` 计时，timer unref）+ `LlmStreamIdleTimeoutError`（分类器按哨兵名归 TIMEOUT）；`createChatCompletionStream` 全部消费方（主循环/压缩/子任务）统一过看门狗；时长经 settings `streamIdleTimeoutMs` / env `STREAM_IDLE_TIMEOUT_MS` 配置，默认 300000ms（`DEFAULT_STREAM_IDLE_TIMEOUT_MS`）。

测试：分类器 9 类 fixture、usage 边界（含 cache_hit > prompt_tokens 钳零、OpenAI 嵌套口径）、看门狗静默超时/慢速完成两路径、溢出→压缩→重试恢复、二次溢出仅重试一次、QUOTA 不重试、TIMEOUT 重试共 7 个新用例 + 3 处存量断言随口径更新（session 98/98、llm-error 5/5、settings 33/33 绿）。

## 一、分层方案

### P0 —— 正确性修复（✅ 三项已全部落地本分支，2026-08-14，详见上方「P0 落地记录」）

> 判定标准：改动 ≤2 个文件、纯 core 内部、不碰 UI、与"稳定化"主题同向。

**P0-1. usage 口径修正 + 压缩阈值改用真实 prompt 大小**

- 现状问题：`activeTokens = total_tokens`（session.ts:289-295）把**历史累计的输出 token** 和 **cache 命中部分**都算进压缩阈值——长会话会过早触发压缩，且 cache 命中被重复计费展示。
- dsh 参照：`inputTokens = prompt_tokens − cacheRead` 互斥折算（dsh translate.ts:45-62）；压力读数 = 最近一次请求的 prompt 大小而非累计（token-meter projection）。
- 改动点：`session.ts` 的 `ModelUsage`/`addUsageValue`/`getTotalTokens`——新增 `freshInputTokens`（prompt − cache_hit）与 `lastPromptTokens`（最近一次请求的 prompt 侧总量）字段；压缩阈值判定改锚定 `lastPromptTokens`；`usagePerModel` 展示面同步拆分 cache_read。
- 收益：压缩触发时机正确 + 计费展示真实；**cache 命中越多收益越大**。
- 验证：补 `addUsageValue` 单测（cache_hit > prompt_tokens 等边界）；本分支测试套件已复活，直接挂入。

**P0-2. LLM 错误分类器 + 溢出自动 compact-and-retry**

- 现状问题：上下文溢出 → catch → `status=failed`（session.ts:2918-2926），用户整会话报废——而 compactSession 全部设施已存在，只差接线。
- dsh 参照：`CONTEXT_WINDOW_EXCEEDED` 归一化（五条正则族）→ `agent/request-error` 上 compact → retry，重试凭证是持久化的进展标记，默认只重试 1 次。
- 改动点：
  1. `common/llm-error.ts` 增加 `classifyLlmError()`：`AUTH / QUOTA / RATE_LIMIT / CONTEXT_WINDOW_EXCEEDED / SERVER / TRANSIENT`（正则族照 dsh 思路按 DeepSeek 错误文案实测校准）；
  2. `activateSession` 的 catch 分支：溢出码 → 调 `compactSession` → 重试一次（带持久化标记防循环，失败仍走原 failed 路径）；`QUOTA` 显式不重试。
- 收益：**把最高频的会话死亡原因变成自动恢复**，与"prefix cache warm"提交同一主题。
- 验证：单测（分类器）+ 构造溢出 fixture 的集成测试。

**P0-3. 流 idle 看门狗**

- 现状问题：无 per-read 超时；thinking 模式长静默与真断流无法区分，断流即 failed。
- dsh 参照：超时计在单次读取上（默认 300s），keep-alive 注释计为活跃（dsh util/timeout:115-173）。
- 改动点：`createChatCompletionStream`（session.ts:1390-1453）包一层 idle watchdog——每次 `iterator.next()` 单独计时，触发归 `TIMEOUT`（与 P0-2 分类器联动可重试一次）；超时时长进 settings（默认 300s，不写死——本仓库"无硬编码可调参"的 dsh 对应纪律）。
- 注意：OpenAI SDK 吞掉 SSE 注释层，先以"读取活动"为准即可，心跳识别列为后续增强（若实测需要，再降级到自管 SSE 解析）。
- 验证：fake stream 单测（静默超时 / 慢速正常完成两路径）。

### P1 —— 顺势加固（本分支 merge 后，作为下一个稳定化/质量迭代）

**P1-1. 崩溃合成收尾 + resume 不再盲目重放 tool calls**

- 现状问题：崩溃时在途 tool call 无落盘标记，resume 路径会**实际执行**这些未跑的 tool calls（session.ts:2740-2762）——崩溃前的写/删/网络操作可能被意外重放。
- dsh 参照：冷修复合成 `TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN` 落盘，并教模型"只重试只读/幂等操作"。
- 改动点：`loadSessionMessages` 后的恢复分支——把"trailing pending tool calls 直接执行"改为"先落盘合成 interrupted 结果（复用 converter:280-287 的文案进持久层），由模型决定是否重试"；保留一个设置开关恢复旧行为以兜底回归。
- 风险：变更恢复语义，需存量会话兼容测试；**建议独立小分支**，不混入本分支收尾。
- 与方向关系：这是 data-loss 主题的自然续集，不算新开方向。

**P1-2. compaction 两段式 + 配对边界切割**

- (a) **先剪后摘要**：超阈值时先做 model-free 的 tool-result 截断（老消息的大输出替换为占位 + 摘要提示），重新计量仍超才触发 LLM 摘要——省钱且快。改动点：`compactSession`（session.ts:2944-3033）前置一步纯函数变换。
- (b) **切割边界按 tool call/result 配对**：现 endIndex 找"首个非 tool 消息"（2966-2973）已有雏形，补强为显式配对断言，杜绝孤立 tool_call 进摘要区导致的 400。
- (c) 摘要请求前缀回放（dsh 的 KV-cache 复用）：**需先决策**——我们摘要固定用 flash（COMPACTION_MODEL，model-capabilities.ts:8），主会话常用 pro，DeepSeek 前缀缓存按模型隔离，跨模型回放无缓存收益。处置：主模型为 flash 的会话直接受益（回放真前缀）；pro 会话维持独立 prompt。改动小、收益场景明确，随 (a)(b) 一起做。

**P1-3. 外部工具顺序稳定化**

- 改动点：`session.ts:2788-2793` 拼装 externalTools 处按工具名 code-unit 字典序稳定排序（或 settings 增加显式 `toolOrder`，含未列工具占位——照 dsh system-prompt 设计）；同步确认 routed tools 的 shortlist 输出顺序稳定。
- 收益：跨会话/跨重启前缀字节一致，prefix cache 命中率不再受 MCP 发现顺序影响。改动约 10 行 + 单测。

**P1-4. 权限流扩展点化（轻量版）**

- 不引入 waterfall 框架，只做一步：把 `computeToolCallPermissions` 调用（session.ts:2820-2830）包成 core 内部的一个 `beforeToolExecution` 钩子注册表（数组式 listener，同步返回 allow/ask/deny），权限检查作为第一个内建 listener 挂入。
- 收益：为后续 guard（循环提醒）、tool timeout、hooks 桥留好挂载点，但不背 Cordis 语义包袱；审计已确认触点集中（约 5 处），抽取低风险。

### P2 —— 后续迭代择机（与 designer 方向兼容，不抢资源）

| 项                  | 内容                                                                       | 触发时机                            |
| ------------------- | -------------------------------------------------------------------------- | ----------------------------------- |
| 渲染意图            | 工具自带 `presentCall/presentResult` 纯函数，UI 零特判                     | 下次 desktop 工具卡片改版时         |
| subagent 体系       | 深度上限、委派降权（子会话 approval 钉 never）、结构化返回、结算送达排序   | designer 多 agent 编排需求出现时    |
| 防死循环 guard      | 连续同工具同参数 [3,5,8] 递进提醒，决定权留模型                            | 挂 P1-4 的钩子，独立小 PR           |
| spill               | 超大工具结果落盘 + locator 预览                                            | token 成本成为投诉点时              |
| tool timeout 声明制 | 工具自声明 `timeoutMs`，统一 wrapper 执行                                  | 同上                                |
| Code Mode           | `run_code` 聚合工具，中间结果不进历史                                      | MCP 工具数膨胀到影响前缀/选择质量时 |
| reasoning 真实回传  | 维持空串策略；**仅当** DeepSeek 官方契约收紧（空串开始报错）时切换条件回传 | 观察项，零成本                      |

### P3 —— 明确暂缓（写下理由，防止漂移）

1. **事件溯源 session log 全量重构**（dsh S1）：收益最大但改动最深。当前分支的 pendingIndex+flush 修复已止血；待 P1-1 落地、本主题稳定后，若仍有竞态/丢数报告，再立独立 spec 评估"index 降级为投影"的重构。**现在不做。**
2. **dsh 进程边界接入（C1 委派 provider）**：dsh 处于 preview（SESSION_FORMAT_VERSION=0、明示破坏性变更）。等其首个 tagged release 再评估；届时走 `runSubagent`/`ActionRegistry` 缝，不动 core。
3. **vendor Cordis 内核 / 插件树**：与"core 刻意极简"原则冲突，仅在 dsh 生态出现我们绕不开的插件时再议。
4. **sandbox seam（bwrap/Seatbelt）**：安全模型变更需独立论证，不在吸收范围。

## 二、落地顺序与分支安排

```
当前分支 fix/stabilize-data-loss-and-test-suite
  └─ 收尾（design 域 IPC 提交 + 测试套件绿）+ ✅ P0-1 / P0-2 / P0-3 已落地（同批提交）
       ├─ P0-1 / P0-2 / P0-3：✅ 已完成（2026-08-14，纯 core、无 desktop/UI/依赖变更）
       ├─ P1-1 崩溃合成收尾：`fix/session-crash-recovery`（data-loss 主题续集）← 下一步
       ├─ P1-2 / P1-3：`perf/compaction-and-prefix-cache`（与 6a9b70f2 同主题）
       └─ P1-4 钩子注册表：`refactor/before-tool-execution-hook`
```

每个 PR 独立可 revert；P0 三项互不依赖可并行。全程无新依赖、无 vendor、无 lockfile 变更（P0/P1 全部用现有设施实现）。

## 三、验收口径

- P0-1：构造含 cache_hit 的 usage fixture，断言 `freshInputTokens` 折算正确；阈值判定单测从累计口径切到 lastPrompt 口径。
- P0-2：溢出 fixture → 会话自动压缩重试成功；QUOTA → 不重试直接报错；重试标记落盘可恢复。
- P0-3：fake stream 静默 300s（测试注入短超时）→ TIMEOUT 分类；慢速持续输出 → 正常完成。
- P1-1：kill -9 崩溃 fixture → resume 后不再自动执行 pending 写操作，模型收到合成 interrupted 结果。
- P1-3：同一 MCP 集合不同发现顺序下，`getTools` 输出字节一致。
- 全程 `npm run check && npm test` 绿；core 分层规则（无 UI 依赖、无 console）不破。

## 附：审计依据索引

- converter：`packages/core/src/common/openai-message-converter.ts:148-156, 280-287`
- usage：`packages/core/src/session.ts:242-317, 2857-3008`；阈值 `session.ts:159-185`
- 流：`session.ts:1311-1477, 2918-2926`；client `common/openai-client.ts:14`
- compaction：`session.ts:2764-2774, 2944-3033`；`prompt.ts:377-391`；`common/model-capabilities.ts:1-8`
- 恢复：`session.ts:2740-2762, 3066-3090`
- 工具序：`prompt.ts:582-823`（字面量序）、`session.ts:2788-2793`（外部追加）
- 权限触点：`session.ts:2743-2749, 2820-2865, 4056-4118`；`common/permissions.ts:152`
- 本分支基线：`ccd5a09e`（index 丢数修复）、`6a9b70f2`（前缀保温）；未提交：`desktop/src/shared/ipc.ts`（design 域）
