# dsh 调研整合台账（deepseek-harness 吸收状态与候选池）

> 日期：2026-08-17 · 核验分支：`feat/sandbox-p0-path-gate`
> 性质：**整合文档**。本文取代以下三份原文档，作为 dsh（deepseek-ai/deepseek-harness）调研的唯一台账与决策入口；三份原文档保留于 `docs/research/archive/` 仅供溯源：
> 1. `archive/2026-08-14-deepseek-harness-deep-dive.md`（全景调研）
> 2. `archive/2026-08-14-dsh-adoption-plan.md`（分层落地计划）
> 3. `archive/2026-08-14-dsh-deepseek-optimization-takeaways.md`（18 条优化机制 + 设计哲学）
>
> **口径声明（2026-08-17 用户决策）**：dsh 调研结论**仅供参考**，以项目实际实现方案为准，调研内容不列入正式实现。下文所有"可吸收"条目均为候选池性质，启动任何一项前需按项目自有 spec 流程另行立项；本文的价值在于对账现状、避免重复调研、给候选排序。
>
> 同批决策：`archive/2026-08-14-pi-sdk-derived-agent-feasibility.md`（外部派生 agent 预研）**已作废**——deepOrca 自有派生 agent 生态已经成型（见第三节 #9 C1 重估），"外部子 agent 运行时"这一需求已自有满足。

---

## 〇、结论速览

P0 三项正确性修复（usage 口径、错误分类 + 溢出自动恢复、流 idle 看门狗）已于 2026-08-14 全量落地并经本次代码复核确认仍在位；subagent 深度上限、reasoning 空串契约维持、以及 RoutingFacade 冻结 + MCP 工具名排序等自有演进，已**部分甚至大幅覆盖**了原计划 P1-3（外部工具序稳定化）的目标。当前真正悬空的候选集中在四件事上：崩溃合成收尾（P1-1，正确性）、compaction 两段式与前缀回放（P1-2 / takeaways #11，成本）、beforeToolExecution 轻量钩子（P1-4，架构 enabler）、前缀守恒收尾包（#13 显式 pin + 字节一致性测试，含 P1-3 残余与 #18 残余）。S1/S2（事件溯源、waterfall 化）维持"触发条件未满足、暂缓"的原判；C1（dsh 外部委派）的主体前提已随自有派生 agent 生态成熟而弱化，仅剩"借 dsh 插件生态"一点残值待 dsh 首个 tagged release 后再估。

计数：**已核实吸收 5 项（另有 1 项部分吸收、1 项决策性维持）；可吸收候选 10 项（核心 4 项）；明确暂缓/不吸收 6 类。**

**进度量化（2026-08-17 二轮深核）**：P0 层 **3/3 = 100%**（唯一落地提交 `a2b0540`，2026-08-15，"LLM 稳健性三件套"，含测试 +7 与 README/CHANGELOG 对 deepseek-harness 的开源致谢——口径"纯设计吸收，零代码依赖"）；P1 层直接落地 **0/4**，但其中 P1-3 的目标已被自有演进覆盖约九成（确定性排序 + RoutingFacade 冻结 + 注册序稳定，仅缺显式 pin 与守护测试）；takeaways #18 主体落地、展示接线缺失（desktop 全域无 cache_read 展示，rg 零命中）；#11/#13 未动；S1-S4/C1-C3 全部未动（waterfall/cordis/toolOrder/beforeToolExecution/TOOL_NOT_STARTED 全库零命中）。源码中以注释形式注记 dsh 出处仅两处：`llm-error.ts:60`、`session.ts:381`——即 dsh 借鉴目前**只到 P0 为止，别无藏货**。

---

## 一、三份原文档各自预期了什么

**《深度调研》（deep-dive）**：对 dsh（0.1.0-rc.5，MIT，官方自述 "Everything is a Plugin"）做全景解剖——核心是 vendored Cordis 微内核（Proxy 服务仓库 + fiber 状态机 + waterfall 事件分发 + declaration merging），配 capability seam 三角色（Definition/Provider/Consumer）。产出一份 **S/A/B 三级吸纳清单**：S 级四项（S1 事件溯源 session log + surface 投影、S2 loop 只暴露 waterfall 扩展点、S3 工具执行管线、S4 工具渲染意图），A 级七项（A1 compaction 插件化 + KV-cache 经济学、A2 subagent 体系、A3 skill 分层注册表、A4 system-prompt 组装注册表、A5 approval seam、A6 防死循环 guard、A7 spill），B 级七项（hooks 桥、plan mode 日志化、sandbox seam、jobs/workflow、DeepSeek 专项调优、文档即代码、Code Mode）。并提出插件兼容三路线：**C1 进程边界委派（推荐）/ C2 vendor Cordis 内核（备选）/ C3 自研 shim（否决）**。

**《落地计划》（adoption-plan）**：把上述清单按"先修正确性、再顺势加固、后演进架构"切成 **P0–P3 四层**：P0 三项正确性修复（P0-1 usage 口径与压缩阈值、P0-2 错误分类器 + 溢出 compact-and-retry、P0-3 流 idle 看门狗）；P1 四项加固（P1-1 崩溃合成收尾、P1-2 compaction 两段式 + 配对边界、P1-3 外部工具顺序稳定化、P1-4 权限流钩子化轻量版）；P2 择机表（渲染意图、subagent 体系、防死循环、spill、tool timeout、Code Mode、reasoning 回传观察项）；P3 明确暂缓四条（事件溯源全量重构、dsh 进程边界接入、vendor Cordis、sandbox seam）。文首附十点现状对账表，其中 #1（reasoning 一刀切空串）判定为**策略差异保持现状**。

**《优化机制》（takeaways）**：提炼 dsh 对 DeepSeek 的 **18 条机制**（主线是"前缀字节守恒"——让每个请求字节成为会话日志的纯函数，吃满 DeepSeek 自动前缀缓存），含 reasoning 条件回传（#1）、cache 互斥折算（#3）、按读 idle 看门狗（#5）、错误归一化（#6）、compaction 摘要前缀回放（#11）、溢出→压缩→重试闭环（#12）、system-prompt 段序 + toolOrder（#13）、cache 感知 meter（#18）等；附**六条设计哲学**（日志即真相、策略皆插件、前缀守恒是产品级 KPI、合成收尾不截断、fail-closed、文档即代码）与插件树借鉴的七点原生启发（seam 三角色、inject 激活、disposer、组合即数据、类型化事件表、waterfall 语义、patch 纯函数化）。

---

## 二、当前已吸收内容（代码逐条核实，2026-08-17，分支 `feat/sandbox-p0-path-gate`；P0 三项与深度上限切片均落地于提交 `a2b0540`（2026-08-15），含测试 +7 与 README/CHANGELOG 开源致谢）

| 条目 | 来源 | 证据（file:line） | 说明 |
| --- | --- | --- | --- |
| P0-1 usage 口径 + 压缩阈值锚定 prompt 侧 | adoption-plan P0-1；takeaways #3/#18 | `packages/core/src/session.ts:358`（`getLastPromptTokens`）、`:366-377`（`getCacheReadTokens` 双拼法：`prompt_cache_hit_tokens` :370 与 `prompt_tokens_details.cached_tokens` :374-375）、`:384-387`（`getFreshInputTokens`，docstring 自注 "Mirrors dsh's mutually-exclusive conversion"）、`:3493` / `:3519`（`activeTokens = getLastPromptTokens(responseUsage)`） | 压缩压力读数 = 最近一次请求 prompt 侧总量（含 cache 命中，因仍占窗口），不再累计 total_tokens；fresh 口径互斥折算、负值钳零。 |
| P0-2 错误分类器 + 溢出自动 compact-and-retry | adoption-plan P0-2；takeaways #6/#12 | `packages/core/src/common/llm-error.ts:123`（`classifyLlmError`）；`packages/core/src/session.ts:3589-3629`（`runActivationLoopWithAutoRecovery`：仅 `CONTEXT_WINDOW_EXCEEDED` 与 `TIMEOUT` 走恢复，溢出→`compactSession` :3618→重跑一次 :3627；压缩自身失败回抛原始溢出错 :3623-3624） | 重试预算为"每次激活一次"（激活由用户发起即刷新）；注意这与 dsh #10 的"重试计数持久化、先落盘再等待"仍有差异——崩溃自动重放场景的对齐归 P1-1 一并考虑。 |
| P0-3 流 idle 看门狗 | adoption-plan P0-3；takeaways #5 | `packages/core/src/session.ts:259`（`LlmStreamIdleTimeoutError`）、`:275-285`（`withStreamIdleTimeout`，单次 `next()` 计时）、`:1908`（`createChatCompletionStream` 消费方接线） | 超时归类 TIMEOUT，与 P0-2 联动自动重试一次；时长可经 settings/env 配置。 |
| A2 subagent 深度上限（切片） | deep-dive A2（`delegationDepth` 单调不减） | `packages/core/src/session.ts:198`（`MAX_SUBAGENT_DEPTH = 4`）、`:1193-1194`（`runSubagent` 入口强制抛错）、`:962`（注释注明 2026-08-15 深评审 B6 引入） | A2 仅此切片落地：深度上限有了；**委派降权（child approval 钉 never）与结算送达排序未做**——`runSubagent`（:1192-1223）仍是"跑完取末条 assistant 文本"的最简实现。 |
| reasoning 空串契约（有意维持，非新吸收） | adoption-plan 对账表 #1"保持现状"决策 | `packages/core/src/common/openai-message-converter.ts:148-156` | 契约注释齐备：thinking 模式下每条 assistant 回放携带 `reasoning_content: ""`——保请求合法、避免回传海量历史思考 token、且保持前缀字节稳定。这是"与 dsh 差异经审计后有意保留"的正面样本。 |
| takeaways #18 cache 感知 meter（**✅ 主体+展示均已落地，2026-08-17 D4 执行时更正**） | takeaways #18 | `packages/core/src/session.ts:3493/:3519`（activeTokens 锚定 provider 实报 prompt 侧） | 压力读数侧已对齐。**更正**：早先"desktop 无 cache_read 展示"系字段名误判（grep 了 cacheRead/cache_read，实际字段为 `prompt_cache_hit_tokens`，经 `addUsageValue` 递归累加）——desktop `renderer/lib/token-usage.ts` 聚合 cacheHit/cacheMiss，TopBar（cache%）与 TokenStatsPanel（命中率）均已接线。#18 判定升级为 ✅ 已消费。 |
| 前缀保温同主题的自有演进（**非 dsh 计划条目，备案**） | —（与 adoption-plan 同主题的后续演进） | `packages/core/src/common/openai-client.ts:9-14`（undici `Agent` keepAlive 180s）、`:81-92`（fire-and-forget warmup 预建 TCP+TLS，3s 有界）、`:110-129`（`getMachineId`：随机 UUID、无 hostname、0o600，隐私注释注明 2026-08-15 深评审 C3） | 归因 header 隐私化与 dsh takeaways #7 的"归因只进 header"精神同向；keepalive/warmup 是连接层保温，与前缀字节守恒互补。 |

---

## 三、可吸收未吸收（候选池，按价值排序）

> 重申口径：以下均为**候选**，启动需另立 spec；"成本估计"为粗粒度量级。

**1. P1-1 崩溃合成收尾 + resume 不再盲目重放 tool calls**（来源：adoption-plan P1-1；deep-dive S1 崩溃修复切片 / 哲学 4）
- 内容：崩溃/中断时在途 tool call 落盘合成结果（无 call 补 `TOOL_NOT_STARTED`、无 result 补 `TOOL_OUTCOME_UNKNOWN`），并教模型"只重试只读/幂等操作"；resume 不再实际执行 trailing pending 调用。
- 现状证据（❌ 未做）：`packages/core/src/session.ts:3474-3475` 注释明示"later resume re-enters the loop and executes them via the trailing-pending path"；`resumeSession` docstring（:3756-3757）同口径——**双处注释自证 resume 仍重放在途调用**；全库无 `TOOL_NOT_STARTED`/`TOOL_OUTCOME_UNKNOWN`。`appendToolMessages`（:4953+）执行在途调用前无任何合成路径。二轮深核补充：converter 已有 `interrupted: true` 元数据标记（`openai-message-converter.ts:273-314`）但**仅作用于消息渲染层**，不影响执行语义；旁系地基方面，`ccd5a09`（stop losing session-index updates）修过 index 写丢失（pendingIndex 读优先 + 终态 flushSessionsIndex），但 session 持久化整体仍是 debounce + jsonl 模型，S1 事件溯源未动。⚠️ 附带发现：提交 `7f7316f` 名为 "crash-safe session index + awaitable MCP dispose"，实际 diff 只改 memory/embedding（store cache 引用计数）——名实不符，session index 并未在该提交中改动，评估进度时勿被提交名误导。
- 预期收益：消除"崩溃后 resume 意外重放写/删/网络操作"的正确性风险——这是 data-loss 主题的自然续集，价值最高。
- 实现落点：`resumeSession` 恢复分支 + 持久层（converter :280-287 的中断文案移入落盘）；保留 settings 开关兜底旧行为。可顺带对齐 P0-2 遗留的"重试预算非持久化"差异（dsh #10）。
- 成本：中（改恢复语义，需存量会话兼容测试）；建议独立小分支。

**2. P1-2 compaction 两段式 + 配对边界 + 前缀回放决策**（来源：adoption-plan P1-2；takeaways #11/#12）
- 内容：(a) 超阈值先做 model-free 的 tool-result 截断（占位 + 摘要提示），重计量仍超才 LLM 摘要；(b) 切割边界从"首个非 tool 消息"启发式补强为显式 tool call/result 配对断言；(c)（= takeaways #11）摘要请求逐字节回放会话真前缀以复用 KV cache——**需先决策**：摘要固定用 flash（`COMPACTION_MODEL`），而 DeepSeek 前缀缓存按模型隔离，故仅主模型为 flash 的会话受益，pro 会话维持独立 prompt。
- 现状证据（❌ 未做，2026-08-17 二轮读码确认）：`packages/core/src/session.ts:3631-3690+` `compactSession` 单段直达 LLM 摘要，请求体仅一条 user 消息（:3672 `messages: [{ role: "user", content: compactPrompt }]`）——无前缀回放。边界方面有一个值得记录的既有保护：endIndex 从 2/3 点**向前扫描跳过 tool 消息**（:3653-3660），即 END 侧已有"不切在 tool 块中间"的软化配对保护；但 START 侧（searchStart 直接取整）无断言，孤立 tool_call 仍可能进入摘要区，且全程无显式 call/result 配对校验。无 model-free 预剪阶段。
- 预期收益：(a) 省钱且快（长会话大输出先剪）；(b) 杜绝孤立 tool_call 进摘要区导致 400；(c) 条件性 cache 收益。
- 实现落点：`compactSession` 前置一步纯函数变换 + 边界断言；`prompt.ts:377-391` 摘要模板配合。
- 成本：小-中；(c) 是决策问题不是工程问题，先拍板再动。

**3. P1-4 beforeToolExecution 轻量钩子注册表**（来源：adoption-plan P1-4；deep-dive S2 的最小切片）
- 内容：不引入 waterfall 框架，把 `computeToolCallPermissions` 的调用点包成 core 内部数组式 listener 注册表（同步返回 allow/ask/deny），权限检查作为第一个内建 listener。
- 现状证据（❌ 未做）：全 core 无 `beforeToolExecution`/`waterfall`/`pre-execute`。注意：`appendToolMessages` 的 `ToolExecutionHooks`（session.ts:4961-4988）是**固定生命周期回调**（进程/审计/文件检查点），不是可注册的决策钩子——两者勿混淆。
- 预期收益：为防死循环 guard（A6）、tool timeout 声明制、hooks 桥（B1）留挂载点；触点集中（约 5 处），抽取低风险。
- 实现落点：`session.ts` 权限触点处 + 新 registry 模块。
- 成本：小。

**4. 前缀守恒收尾包（#13 + P1-3 残余 + #18 残余）**（来源：takeaways #13/#18；adoption-plan P1-3）
- 内容：① system-prompt 段落 `order` 显式化（`prompt.ts` EJS 拼接顺序目前是隐式的）；② 工具序显式 pin（dsh `toolOrder` + `<unlisted-tools>` 占位风格，或至少加一条"跨发现顺序字节一致"的守护测试）；③ `usagePerModel` 展示拆出 cache_read。
- **P1-3 覆盖度重估（诚实评估）**：原条目标的是"外部工具序跨运行抖动损害前缀缓存"，当前代码已**大幅自有覆盖**——
  - MCP 工具：`packages/core/src/mcp/mcp-manager.ts:665-702` `getMcpToolDefinitions` 按名 `localeCompare` 确定性排序，:695-699 注释明说这是为 DeepSeek cache 稳定前缀服务；
  - 路由输出：`packages/core/src/routing/routing-facade.ts:35-78` RoutingFacade"decide once per session, freeze, invalidate explicitly"，docstring 明说动机是防止逐轮工具集变化打碎前缀缓存；`tool-router.ts:83` 用 `filter` 保序，输入即已排序列表；
  - 描述增强：`session.ts:699-727` `augmentMcpToolDescriptions` 用 `map` 保序；
  - action 工具：`packages/core/src/actions/registry.ts:144-164` 注册序稳定（注释 "stable for tool lists"），注册点为 `session.ts:863-905` 固定字面量序；
  - 组装：`session.ts:3405-3410` `getTools(内置字面量序, [...routedMcp, ...actions])`，内置 7 工具序见 `prompt.ts:585-590`。
  - **残余缺口**：以上是"构造即确定"，但无 dsh 式显式 `toolOrder` pin（未来加注册源时无护栏），也无字节一致性守护测试（adoption-plan 验收口径"同一 MCP 集合不同发现顺序下输出字节一致"从未落成测试）。故 P1-3 判定为**目标基本达成、收尾价值小而便宜**。
- 预期收益：前缀命中率护栏化；计费展示真实化（#18 残余）。
- 实现落点：`prompt.ts` 段序常量化、工具序 pin 或守护测试、usage 展示接线。
- 成本：小（合计约一个轻量 PR）。

**5. S1 事件溯源 session log + surface 投影**（来源：deep-dive S1；哲学 1）
- 内容：append-only 日志为唯一事实源，LLM 消息历史由投影派生，索引降级为投影之一。
- 现状证据（❌ 未做）：session 持久化仍是 sessions-index + jsonl 模型，无 `sourceEventSeqs`/surface。**旁证**：同一哲学已在其他子系统落地——`packages/core/src/sandbox/audit.ts:183`（`AuditLog`，append-only 哈希链审计日志）、`packages/core/src/tasks/task-tree-service.ts:13`（reflog.jsonl append-only 注释）——团队已在用"日志即真相"，唯独 session 主干未动。
- 预期收益：debounce 竞态从根上消失（AGENTS.md 载明的 pendingIndex 不变量是长期维护负担）。
- 实现落点：session 持久层整体重构。
- 成本：**大**。维持原判：待 P1-1 落地后若仍有竞态/丢数报告，再立独立 spec。

**6. S2 loop waterfall 扩展点化**（来源：deep-dive S2；哲学 2）
- 内容：`activateSession` 单体循环抽出 `agent/pre-step`、`agent/request`、`agent/request-error`、`tools/pre|execute|post-execute` 等扩展点。
- 现状证据（❌ 未做）：无任何 waterfall 扩展点；P0-2 的恢复逻辑是直接包在 `runActivationLoopWithAutoRecovery` 闭包上的，不是插件挂点。
- 预期收益：compaction/权限/guard 可降级为插件，core 瘦身；是 A1/A5/A6 的共同前置。
- 实现落点：`session.ts` 循环重构。
- 成本：大；P1-4 是它的 1% 版本，先走 P1-4 探路。

**7. A2 其余切片：委派降权 + 结算送达排序**（来源：deep-dive A2）
- 内容：subagent child 的 approval 钉 never、结算通知无条件送达且先于 ownership 释放。
- 现状证据：`runSubagent`（session.ts:1192-1223）无降权、无结算排序；返回值仅末条 assistant 文本。
- 预期收益：多 agent 编排的安全与可靠性。
- 成本：中；触发时机维持原判——designer 多 agent 编排需求出现时。

**8. S3/S4 工具管线细节 + 渲染意图**（来源：deep-dive S3/S4）
- 内容：call 先落盘、monotonic guards、派发可重叠但结果按序提交、abort 合成配对；工具自带 `presentCall/presentResult` 纯函数渲染意图。
- 现状证据（❌ 未做）：core 无 presentCall/presentResult；desktop 卡片按工具定制。
- 成本：中-大；随 desktop UI 迭代择机。

**9. C1 重估：dsh 外部委派的残值**（来源：deep-dive §5；2026-08-17 用户决策）
- 前提变化：原 C1 的核心卖点是"补上外部子 agent 运行时"。现 deepOrca 自有派生 agent 生态已成型——`packages/core/src/actions/registry.ts:22-63`（`RegistryHost` 含 `runSubagent` 注入位 :44）、`packages/core/src/actions/define.ts:10`（`defineAction` 原语）、`session.ts:848-849`（runSubagent 接入 registry host）与 `:863-905`（约 25 个 action 字面量序注册）、`packages/desktop/src/main/action-ipc.ts`（IPC + LLM + MCP 三面到达）。"外部子 agent 运行时"需求**已自有满足**，pi-sdk 预研同因作废。
- **残值评估**：C1 剩下的唯一独立价值是"借 dsh 插件生态"——即以子进程方式让 dsh 的社区插件（`dsh-plugin` topic）间接可用。这一点与"自有运行时"不重叠，但受制于 dsh 仍处 preview（`SESSION_FORMAT_VERSION=0`、明示破坏性变更）。**处置：维持观望，待 dsh 首个 tagged release 且其生态出现我们绕不开的插件时，再单独评估"借生态"这一残值是否值得一个委派 provider。**在此之前 C1 不立项。

**10. B 级机制中的低成本散点**（来源：deep-dive B5/B6；takeaways #2/#7/#9）
- 归因 header 规范化（`user-agent`/session-id 只进 header）、配置快照同代性（baseURL/key 同一份快照解析）、模型目录 advisory 化。单项均为小改动，可随相关模块的正常迭代顺手对齐，不单独立项。

---

## 四、明确暂缓或不吸收（带理由）

| 项 | 处置 | 理由 |
| --- | --- | --- |
| C3 自研 shim 模拟 Cordis | **永久否决** | fiber 回收顺序、waterfall veto、inject 重激活语义极易仿错（dsh 自己对上游做了 18 处加固即证据）；长期维护他人框架的仿制品是负债。 |
| C2 vendor Cordis 内核 | 条件暂缓 | 与"core 刻意极简"分层纪律冲突；双框架心智负担；仅在"dsh 生态出现绕不开的插件且 C1 委派不敷使用"时再议。 |
| C1 外部委派（主体） | 前提弱化，仅存"借生态"残值 | 见三-9：自有派生 agent 生态（actions/defineAction/RegistryHost.runSubagent）已满足需求；且 dsh 处于 preview 期。 |
| B3 sandbox seam（bwrap/Seatbelt/Landlock） | **不吸收——需求已自有满足** | 原计划 P3-4 以"安全模型需独立论证"暂缓；此后项目自建了完整沙箱子系统（`packages/core/src/sandbox/`：policy 引擎 + path-gate + `audit.ts` 哈希链 append-only 审计日志 + `backend/` 的 macos-sandbox-exec / linux-bwrap / windows-wsl2 / noop 四后端），并已接入 bash 工具（`bash-handler.ts:161-166, 280-284`）与 session（`session.ts:136-138, 167`，当前分支即沙箱 P0 主题）。dsh 的 capability-seam 形态不再是需求。 |
| reasoning 真实回传（takeaways #1 的条件回传变体） | 不吸收，维持空串一刀切 | 2026-08-14 对账决策"保持现状"，契约注释在位（converter :148-156）：保合法、省 token、前缀稳定三利。仅当 DeepSeek 官方契约收紧（空串报错）才切换，零成本观察项。 |
| takeaways §3.3 插件树七点原生启发（seam 三角色 / inject / disposer / waterfall 语义 / patch 纯函数化） | 设计承接，未实现 | 由 `specs/module-system/design.md` v2 承接（2026-08-15，状态自记"设计（未实现）"，视野已升级为发行版/模块系统，非 dsh 复刻）；全库无 cordis/waterfall 实现痕迹 |
| A3 skill 分层注册表 / A5 四态审批 / A6 防死循环 guard / A7 spill / B1 hooks 桥 / B4 jobs / B7 Code Mode / B6 文档即代码 | P2 观望 | 各有明确触发时机（见 adoption-plan P2 表）：A6 挂 P1-4 之后的独立小 PR；A7/spill/Code Mode 等 token 成本成为投诉点或 MCP 工具数膨胀时；B6 随文档体系自然演进。均不抢当前资源。 |

---

## 五、建议吸收顺序（P1 四项 vs 前缀守恒三条）

> **落地记录（2026-08-17 晚，收官计划 D 线执行完毕）**：P1-1、P1-2、P1-4、前缀收尾包（#13 段序显式化 + 字节一致性守护测试）**全部实现并通过测试**（resume-synthesis 7 用例 / compaction 5 用例 / tool-execution-gate 5 用例 / prefix-consistency 2 用例，93 项 session 回归无损）；#11 前缀回放按 §三-2 决策默认不做（决策表见 `specs/pre-production/tasks.md`）；#18 更正为早已接线（见 §二表格更正行）。本节排序建议已全部兑现，候选池剩余项（S1/S2/A2 其余切片/S3/S4/C1 残值/B 级散点）维持原判进入冻结期。

前缀守恒三条的归属先拆开：**#11 实质是 P1-2(c) 的决策点**，#18 主体已吸收只剩展示残余，#13 与 P1-3 残余同性质可合并。所以真正的排序问题是四个 P1 条目 + 一个"前缀收尾包"怎么排。

**推荐顺序：**

1. **P1-1 崩溃合成收尾**——唯一剩下的正确性项，直接消除"resume 重放副作用操作"风险，是 data-loss 主题的收口；独立分支、不受其他项牵制。
2. **P1-2 compaction 两段式（含 #11 前缀回放决策）**——经济学项里收益最确定的（先剪后摘要对每个长会话都省钱）；(c) 的 flash/pro 决策先拍板，若判"仅 flash 会话受益"则实现面更小。
3. **P1-4 beforeToolExecution 钩子**——小成本架构 enabler，解锁 A6/timeout/hooks 桥；若近期有 guard 类需求可提前与 P1-2 并行（二者无耦合）。
4. **前缀收尾包（#13 段序显式化 + 工具序 pin/字节一致性守护测试 + #18 展示残余）**——P1-3 目标已被自有演进（MCP 名排序 + RoutingFacade 冻结 + 注册序稳定）基本覆盖，这里只补护栏与测试，一个轻量 PR 随行即可，不值得单排优先级。

排序理由一句话：**先正确性（P1-1）后经济学（P1-2），enabler（P1-4）与护栏（前缀包）垫后**——且后两者都能以远小于原计划的成本收尾，因为主体已被 RoutingFacade/MCP 排序这些自有演进预支付了。

---

## 附：核验方法与证据索引

- 本文所有 file:line 均于 2026-08-17 在 `feat/sandbox-p0-path-gate` 工作树上以全文检索 + 定点读码复核（非转抄原文档——原文档行号基于 `fix/stabilize-data-loss-and-test-suite`，已整体漂移，如 `appendToolMessages` 由 :2740-2762 区域移至 :4953+）。
- 关键锚点：`packages/core/src/session.ts`（:198, :259, :275, :358, :384, :848-905, :1192-1223, :1908, :3405-3410, :3474-3475, :3493, :3519, :3555, :3589-3629, :3631-3690, :4953-4988）、`packages/core/src/common/llm-error.ts:123`、`packages/core/src/common/openai-message-converter.ts:148-156`、`packages/core/src/common/openai-client.ts:9-14, 81-92, 110-129`、`packages/core/src/mcp/mcp-manager.ts:665-702`、`packages/core/src/routing/routing-facade.ts:35-78`、`packages/core/src/actions/registry.ts:22-63, 144-164`、`packages/core/src/prompt.ts:585-590`、`packages/core/src/sandbox/`（policy/audit/backend）、`packages/desktop/src/main/action-ipc.ts`。
- 相关测试仍在位：`packages/core/src/tests/llm-error.test.ts`、`packages/core/src/tests/session.test.ts`（含 usage 边界与恢复路径用例）。
