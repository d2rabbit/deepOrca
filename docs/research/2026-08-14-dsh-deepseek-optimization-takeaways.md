# dsh 对 DeepSeek 模型的优化机制、可吸取的设计哲学与插件树借鉴

> 日期：2026-08-14 · 配套文档：[2026-08-14-deepseek-harness-deep-dive.md](2026-08-14-deepseek-harness-deep-dive.md)（全景调研 + 插件兼容方案）
> 调研对象：`/tmp/dsh-research`（deepseek-ai/deepseek-harness 浅克隆，0.1.0-rc.5）
> 本文只回答三个问题：① dsh 如何增强 DS 系列模型；② 哪些设计哲学/能力可实质性增强 deeporca；③ 插件树概念能否搞过来、对我们有何启发。

---

## 一、dsh 如何增强 DeepSeek 系列模型

**一句话主线：dsh 对 DeepSeek 的优化本质是「前缀字节守恒」——让每个请求字节成为会话日志的纯函数，从而把 DeepSeek 的自动前缀缓存（context caching）吃满；再叠加一套针对 DeepSeek 线上怪癖的协议适配层。**

### 1.1 协议适配层（`packages/llm/llm-deepseek/`，对抗线上怪癖）

| # | 机制 | 具体行为 | 出处 |
| --- | --- | --- | --- |
| 1 | **reasoning 条件回传** | 序列化 assistant 历史时，仅当该轮带 `tool_calls` 才写回 `reasoning_content`（DeepSeek thinking 模式契约）；纯文本轮丢弃省 token。无文本轮发 `content: ""` 而非 null（null 会被线上 400 拒绝且**持久化后锁死该会话之后的每一轮**）；空工具结果发 `'(no output)'` | `llm-deepseek/src/serialize.ts:71-138` |
| 2 | **thinking/effort 词汇** | `off` → `thinking:{type:'disabled'}` 且**绝不发** `reasoning_effort:'off'`；`high/max` → 顶层 `reasoning_effort`；session-title 用途强制关思考；部署锁思考的 adapter 配置 high/max 在加载即抛错 | `serialize.ts:15-53`、`index.ts:161-166` |
| 3 | **cache token 互斥折算** | DeepSeek 的 `prompt_tokens` **包含** cache 命中，折算为互斥计数 `inputTokens = prompt_tokens - cacheRead`；`prompt_cache_hit_tokens`（DS 拼法）与 `cached_tokens`（OpenAI 拼法）都认 | `translate.ts:45-62` |
| 4 | **SSE/[DONE] 哨兵契约** | keep-alive 注释只重置 idle 看门狗、不进事件流；EOF 前无 `[DONE]` 抛 `STREAM_CLOSED`；usage 无论在 finish chunk 还是尾随 usage-only chunk 都延迟到 `[DONE]` 统一发出；首包 `reasoning_content:""` 不开启 reasoning 块；零内容退化完成映射为可重试的 `EMPTY_RESPONSE` | `sse.ts:28-40`、`translate.ts:86-185` |
| 5 | **按读 idle 看门狗** | 超时计在**单次读取**上而非整个流（默认 300s）——匹配长思考的 CoT 静默；keep-alive 注释计为活跃不误杀 | `adapter.ts:214-269`、`util/timeout/src/index.ts:115-173` |
| 6 | **错误归一化** | 400+溢出措辞→`CONTEXT_WINDOW_EXCEEDED`（五条正则族）；配额措辞→`QUOTA`（优先于 429，不进重试集合）；解析 `retry-after` | `adapter.ts:117-149`、`llm/src/error.ts:24-100` |
| 7 | **归因 header** | `user-agent: deepseek-harness/<version>`、`x-deepseek-harness-user-id/session-id`、压缩流量 `x-deepseek-harness-compact:1`——只进 header 不进正文 | `adapter.ts:283-295` |
| 8 | **模型目录** | 默认 V4-Flash/V4-Pro、`contextWindow: 1M`、`maxTokens: 256K`；目录 advisory，未列模型透传；未列模型返回 text-only 负能力防误收图片 | `adapter.ts:89-93,175-212` |
| 9 | **配置快照同代性** | baseURL/key/catalog 每次 stream 重读快照（进行中的流保持起始快照）；key 与端点从**同一份快照**解析，杜绝"新端点配旧密钥"；非法快照保留 lastGood | `index.ts:200-276` |
| 10 | **重试归属分离** | adapter 只发一次请求；重试策略由 `llm-retry` 插件在 `agent/request-error` 扩展点执行，重试计数**从持久日志恢复**、先落盘再等待——崩溃恢复不重复计数 | `llm-retry/src/index.ts:58-207` |

### 1.2 架构层（跨包协同，吃满前缀缓存与 token 经济学）

| # | 机制 | 具体行为 | 出处 |
| --- | --- | --- | --- |
| 11 | **compaction 摘要 = 会话请求真前缀** | 摘要调用**逐字节回放**最后一个请求的 system+tools+被遮蔽消息，只把压缩指令追加为最后一条 user 消息——长会话摘要几乎全按 cache-read 计价；路由到别的模型或压缩非头部区域即明示放弃复用 | `compaction-basic/src/region.ts:488-514`、`summarizer.ts:121-182` |
| 12 | **溢出→压缩→重试闭环** | `agent/request-error` 上仅 `CONTEXT_WINDOW_EXCEEDED` 触发：先 model-free 剪 tool result → 再摘要 → `replaceGeneration` 前进才授权 retry（持久化 generation 是"确有进展"的唯一凭证） | `compaction-basic/src/index.ts:137-332` |
| 13 | **前缀稳定性工程** | system prompt 段按 `order` 拼接（身份 -100 / persona 0 / 工具引导 100-199）；`toolOrder` 显式指定工具顺序（含 `<unlisted-tools>` 占位），省略时按 code-unit 字典序——消除插件加载顺序抖动，任何变化只从第一个变化 token 起失效 | `system-prompt/src/index.ts:139-183` |
| 14 | **请求可重建不变式** | 每步剥掉 adapter 默认值→`agent/request` waterfall→`prepareCall` 重新物化；invariant 插件校验"请求 messages 必须与会话日志 `deriveMessages()` 逐字节一致"，不一致即判 desync | `agent-loop/src/agent.ts:417-494`、`invariant.ts:19-54` |
| 15 | **effort 路由绑定恢复** | 恢复会话时仅当 provider/model 未变才恢复日志中的 effort，且排除 adapter 物化的默认值——不把 v4-pro 的 effort 误用到别的模型 | `agent.ts:285-290` |
| 16 | **max-tokens 粘性** | 任一步撞上限后，后续正常完成不得把 turn 结局降级 | `agent.ts:54-61` |
| 17 | **Code Mode token 经济学** | 子工具调用的中间输出**不进模型历史**，只有外层经筛选的结果进入；工具描述直接教模型 "Only what you print or return comes back — curate it." | `tools/src/code-mode.ts:46-69` |
| 18 | **cache 感知 token meter** | 压力读数锚定 provider 实际报告的 prompt 大小（含 cache 命中），而非本地估算 | `token-meter/src/projection.ts:7-66` |

**对 deeporca 的直接启示**：我们已有 compaction 阈值调优（512K/128K），但**没有前缀字节守恒意识**——EJS 渲染顺序、工具注册顺序、reasoning 回传规则（#1）、`content:""` vs null 的 400 陷阱（#1）、usage 双拼法折算（#3）、idle 看门狗（#5）都未对齐。其中 #1 和 #3 是可以立即核查、成本极低、可能直接修 bug 的项。

## 二、可吸取的设计哲学与能力（对 deeporca 的实质性增强）

### 2.1 六条设计哲学

1. **日志即真相，模型所见是投影**（append-only session log + `deriveMessages()` surface 投影；"model-visible ⟺ logged"）。→ deeporca 当前 `sessions-index.json` + jsonl + 250ms debounce 的 pendingIndex 不变量（AGENTS.md 已载明其竞态脆弱性）可整体升级：**索引降级为投影之一，竞态从根上消失**。这是对当前 data-loss 稳定化分支最直接的实质性增强。
2. **策略皆插件，loop 只暴露 waterfall 扩展点**（`agent/pre-step`、`agent/request`、`agent/request-error`、`tools/pre|execute|post-execute`）。compaction、权限、guard、超时、重试全挂在点上，loop 本体零策略。→ deeporca 的 `activateSession()` 单体循环应抽扩展点，core 进一步瘦身。
3. **前缀字节守恒是产品级 KPI**（见第一节主线）。prompt 组装、工具顺序、摘要回放全部服务于 KV cache 命中率——这是 DeepSeek 计费模型下的直接成本优化。
4. **崩溃修复用合成收尾而非截断**（无 call 补 `TOOL_NOT_STARTED`、无 result 补 `TOOL_OUTCOME_UNKNOWN` 并教模型"只重试只读/幂等操作"）；abort 的未派发调用记合成结果保证 call/result 永远配对。
5. **fail-closed 与归属清晰**：permission 无应答即 deny；sandbox 不可用即拒绝执行；密钥绝不回显；配置非法保留 lastGood 并报错，绝不静默跳过。
6. **文档即代码 + "Model Experience" 纪律**：tool/config/persistence catalog 脚本生成 + CI 新鲜度 gate；每个 README 必写"模型看到什么 / Token 效应 / KV Cache 效应"三段式。

### 2.2 能力吸收优先级（映射 deeporca 落点）

| 优先级 | 能力 | deeporca 落点 |
| --- | --- | --- |
| P0 | reasoning 条件回传 + `content:""` 防御 + usage 双拼法折算 | `openai-message-converter.ts`、用量计费——**立即核查，可能直接修 bug** |
| P0 | 事件溯源 session + 合成收尾 | 当前分支的数据丢失治理 |
| P1 | loop waterfall 扩展点（前置：权限/compaction 插件化） | `session.ts` 循环抽点 |
| P1 | compaction KV-cache 回放 + 溢出自动重试闭环 + 两段式（先剪 tool result） | 现有 compaction 升级 |
| P1 | subagent 体系：委托即降权（approval 钉 never、`delegationDepth` 持久化）、settlement 送达排序 | `runSubagent`（session.ts:805）升级 |
| P2 | 工具渲染意图（presentCall/presentResult 纯函数） | desktop 卡片渲染收敛 |
| P2 | repeat-tool-reminder（建议式防死循环）、spill（大结果外置）、tool timeout 声明制 | 新插件 |
| P2 | skill 分层注册表 + `modelInvocable/userInvocable` 调用面 | skill 加载升级 |
| P3 | sandbox seam（bwrap/Seatbelt/Landlock）、jobs/schedule/workflow | 中长期 |

## 三、插件树概念能否搞过来？

### 3.1 dsh 插件树的本质（三句话）

1. **微内核 + 服务仓库**：Context 是 Proxy 服务注册表，插件 = 三种形状（函数/类/`{apply}`）+ 静态元数据（`inject`/`provide`/`Config`）；**加载顺序由 inject 声明的服务可用性驱动**，服务注销会唤醒依赖方重新评估。
2. **一切注册可逆**：`ctx.effect()` 返回 disposer，fiber 卸载逆序回收——热插拔/配置热更/测试隔离的地基。
3. **组合即数据**：进程级 profile/bundle（`cordis.patch.yml` 按 id 整体替换/insert/disabled 的纯函数 patch 算法）+ 会话级 preset（`agent.cordis.yml`，scope 链 `agent → preset → global` 近层 shadow 远层）。一个 agent = 一棵声明式组装的插件树，`dsh --dump-config` 可离线审计。

### 3.2 能不能直接搞过来？

| 路线 | 结论 |
| --- | --- |
| **整体 vendor Cordis 内核** | **可行但重大**。技术无阻塞（MIT、ESM、Node22 ✓，本仓库已有成熟 vendor 机制），dsh 插件可直接跑；代价是 deeporca core 从"刻意极简"转向"框架承载"，双框架心智负担，且 preview 期 churn 需持续对账。**只应在确需进程内运行 dsh 插件生态时启动** |
| 自研 shim 模拟 Cordis API 面 | **否决**。fiber 回收顺序、waterfall veto、inject 重激活等语义极易仿错（dsh 自己对上游做了 18 处加固即证据） |
| **进程边界接入**（推荐） | dsh 整体作为子进程经其官方 JSON-RPC SDK（3 请求 + 4 通知极小协议）/ ACP 挂到 deeporca 的 `runSubagent`/`ActionRegistry` 委派缝——插件树归 dsh 进程内部自治，deeporca 零框架负担 |

### 3.3 不搬框架，单搬思想——对 deeporca 的七点启发

即使永远不引入 Cordis，这些概念可以原生长在 deeporca 自己的类型体系里：

1. **capability seam 三角色**（Definition/Provider/Consumer 缺一不成 seam）：deeporca 的 bash/read 等内建工具与 MCP 之间缺一层"可替换能力"抽象。可把 `shell 执行`、`web 搜索`、`embedding`、`记忆` 率先 seam 化——Definition 是注册表类而非 interface，Provider 可换（本地/E2B/远程），Consumer（工具）零改动。
2. **inject 驱动的激活顺序**：替代"启动时按固定顺序初始化"——能力就绪才激活依赖方，天然解决 vendor 工具缺失时的降级编排（deeporca 现有 fail-open router 是手工版）。
3. **注册即返回 disposer**：deeporca 的 `SessionManager.dispose()`、MCP client 生命周期目前手工管理；effect/disposer 纪律能让会话热重载（`session-bridge` 的 manager reload 已有雏形）变得可逆且完备。
4. **组合即数据（声明式 agent 配方）**：deeporca 的"一个会话用什么模型/技能/权限/工具集"目前散在 settings.json + 运行时状态里；可以引入**纯数据格式的 agent preset**（不必用 yml/cordis 格式，JSONC 即可），由 `.deeporca/` 下发，实现 dsh preset 的"同一进程多种 agent 配方共存"。
5. **declaration merging 的类型化事件表**：`SessionEventMap` 让插件类型安全地扩展事件词汇——deeporca 的 IPC 事件（`shared/ipc.ts`）与未来的扩展点事件可用同手法保持跨包类型安全。
6. **waterfall 中间件语义**（`(...args, next)`，不调 next 即 veto）：比"一串监听器"表达力强一档，权限审批、请求改写、结果后处理天然适合。
7. **patch 纯函数化 + 可 dump 审计**：任何组合层（settings 覆盖、preset 叠加）都应有一个纯函数 `applyPatch` + `--dump` 离线审计能力，杜绝"实际生效配置没人知道是什么"。

### 3.4 建议路径

1. **现在**：走进程边界（3.2 路线三）把 dsh 整体接入做委派 provider 试点——插件树红利（其生态插件）经此路径间接获得；
2. **同步**：按 3.3 在 deeporca 原生落地 seam 三角色 + disposer 纪律 + agent preset 纯数据配方——这是不受 dsh churn 影响的自有资产；
3. **观望**：dsh 出首个 tagged release（其 AGENTS.md 明示预览期结束才冻结命名）后再评估是否整体 vendor Cordis 内核。

## 附：关键出处

- DeepSeek 适配：`packages/llm/llm-deepseek/src/{serialize,translate,sse,adapter,index}.ts`、`README.zh.md`
- LLM seam：`packages/llm/llm/src/index.ts`（registerAdapter/prepareCall）、`error.ts`、`retry-policy.ts`
- 缓存协同：`packages/compaction/compaction-basic/src/{region,summarizer,index}.ts`、`packages/core/system-prompt/src/index.ts:139-183`、`packages/core/agent-loop/src/invariant.ts`
- 插件树：`vendor/cordis/src/{context,registry,service,fiber,events,reflect}.ts`、`vendor/loader/src/config/entry.ts`、`packages/bundle/base/cordis.patch.yml`、`apps/cli/config/agent-presets/`
- 设计笔记：`.agents/notes/implemented/architecture/`（reasoning effort 能力、溢出恢复、可重建请求等决策记录）
