# 进程内多驱动并行（in-process-multi-driver）— 设计方案

> **日期**：2026-09-02 立稿（未实施）· **同日拍板**：直接引入 `@ekaone/agent-relay` 作为编排依赖（用户决策："可以直接加进来，反正影响也不是很大"）；S0 由"选型定生死"改为"质量验证 + 锁版"。
> **需求**：单会话引擎不做大范围改动的前提下，引入外部框架实现**同一活动区（同一工作区根）**内的多路并行驱动（multi-driver）——进程内轻量并发，不启重型进程/线程。
> **调研范围**：桌面 bridge 单驱动约束逐点排查（代码证据）+ 框架清单 8 项 npm 实存性核验 + 仓库内既有底子盘点。

---

## 一、现状：单驱动约束到底在哪（代码证据）

结论先行：**单驱动的瓶颈不在引擎内核——内核状态已全部按 sessionId 键控，且留有"multi-session groundwork"——而在三处外围：`handleUserPrompt` 的单指针路由、桌面 main 的单例 bridge、渲染层单流 UX。**

### 1.1 桌面层

| 约束点 | 证据 |
|---|---|
| SessionBridge 全局单例 | `main/index.ts:620-624`：`bridge = new SessionBridge(resolveInitialRoot(), emit)`，一时刻一个 root = 一个 `SessionManager`；换根时置 null 重建（2449/2491） |
| 渲染层单流假设 | `Composer.tsx` 的 `busy/disabled`——流式期间禁发，隐含"同时只有一路在跑" |
| **事件通道已可多路复用** ✓ | `AssistantMessage` / `SessionEntryUpdated` / `LlmStreamProgress` 的 payload 均带 sessionId（`session-bridge.ts:314-334`）——渲染层区分并发流**零改动** |

### 1.2 引擎层（真正的单驱动语义点）

| # | 约束点 | 证据 | 影响 |
|---|---|---|---|
| E1 | `handleUserPrompt` 按**单个** `activeSessionId` 路由 create-vs-reply，且只有**一个** `activePromptController` | `session-manager-lifecycle.ts:78-97`、`session-manager-base.ts:195-197` | 并发的第二个 prompt 会打进同一会话 |
| E2 | `replySession` 无"本会话 processing 中"守卫 | `lifecycle.ts:244-319` | 对同一 session 并发 reply → 双循环写同一 JSONL（当前靠 UX 单流遮住） |
| E3 | `activeSessionId` 是"焦点+路由"混合语义 | `runSubagent` 用 save/restore 保护它（`session-manager-tasks.ts:844/895`） | 并发下被最后写入者覆盖；save/restore 先例说明团队已知晓 |

### 1.3 已就绪的多会话底子（"不大改"成立的根据）

- **状态全按 sessionId 键控**：`sessionControllers` / `messageCache` / `processTimeoutControls` 均 Map；子代理注释明言"engine is subagent-friendly — activateSession is keyed by sessionId"（`session-manager-tasks.ts:832`）。
- **每会话独立 scratch 目录已铺**：`createSession` 的 "multi-session groundwork"（`lifecycle.ts:106-115`，`.deeporca/sessions/<id>`）。
- **按 ID 驱动/中断的 API 已存在**：`replySession(sessionId, …)` 本就按 id 驱动；`interruptSession(sessionId)`（`lifecycle.ts:942`）按 id 中断 + 杀进程树。
- **多循环并发已有生产先例**：`runBackgroundLlmTask`（bg-* 任务自持循环）与 action 多路复用（AGENTS.md：progress 事件按 TARGET root 打标）证明进程内并发 LLM 循环可行。

### 1.4 并发化必须加护栏的共享点（均为小改，非大改）

| # | 共享点 | 风险 | 护栏 |
|---|---|---|---|
| G1 | `GitFileHistory` 共享 `projectDir/file-history/.git`，无锁 | 并发 git 命令 → index.lock 竞争 | per-project 串行队列 |
| G2 | `pendingIndex` 防抖写 | `updateSessionEntry` 为同步 load→mutate→save（JS 单线程内原子），基本安全；但 `createSession` 的 MAX_SESSION_ENTRIES 淘汰与并发更新交错需复核 | 审计 + 必要时淘汰段加同步守卫 |
| G3 | `activePromptController` / `interruptActiveSession` 单数语义 | 多路下中断错人 | 直接改用已有的 `interruptSession(id)`；`activePromptController` Map 化或弃用 |
| G4 | `silentSubagentActive` 全局 flag（save/restore） | 并发子代理泄漏 | 改 per-call 传递或计数化 |
| G5 | `maybeSyncCodegraphIndex` / `maybeSyncCrgIndex` 共享索引写 | 并发重建互踩 | 互斥或运行中去重 |
| G6 | LLM 请求速率与 token 消耗 | N 路 = N 倍速率/消耗 | pool 层并发上限 + 背压；usage-ledger（2026-09 已落地）已能按请求记账多路消耗 |

---

## 二、外部框架核验与选型（已拍板）

### 2.1 实存性核验（npm，2026-09-02）

| 框架 | 结果 | 判定 |
|---|---|---|
| Volcano Agent SDK | ❌ `@volcano/agent-sdk` / `volcano-agent` 均查无此包 | 清单幻觉项，排除 |
| Thoughtflow | ❌ 查无此包 | 同上 |
| bullmq-ai-agent | ✅ 0.6.13，但依赖 BullMQ + Redis + LangChain 全家桶 | 与"进程内轻量、无外部服务"诉求相反，排除 |
| open-multi-agent | ✅ 1.8.0，但实为 **OpenCode 插件工具系统**（依赖 `@opencode-ai/plugin`） | 绑定 OpenCode 生态，非通用编排框架，排除 |
| pi-mill | ✅ 0.1.1，Pi agent 的 mill 运行时路由扩展 | 绑定 Pi/mill，非通用库，排除 |
| liminal | ✅ 0.17.22（crosshatch，"Effect × Actors"） | 引入 Effect 生态 = 重依赖，未选 |
| actojs | ✅ 1.0.0（Elixir 风 Actor，单人维护） | 次选备胎 |
| **@ekaone/agent-relay** | ✅ 0.2.0："framework-agnostic multi-agent task delegation — in-memory bus, typed tasks, LLM coordinator, dead-letter queue" | **✅ 已拍板引入（主选）** |

### 2.2 决策与风险策略

- **决定**：直接引入 `@ekaone/agent-relay`，装入 **desktop 的 dependencies**（不进 core——分层铁律）。影响面评估同意用户判断：框架被 DriverPool 单点包住，最坏情况的替换成本 = 重写一个 ~200 行适配文件。
- **单人 0.x 包风险对冲**：① 锁**精确版本**（S0 验证后回填本节）；② 框架类型/符号**不得泄漏出 `main/driver-pool.ts`**（ipc 契约与 core 全部自持类型）；③ 备胎路径成文：actojs（Actor 适配）或 p-queue 手写，DriverPool 对内接口不变。
- S0 性质变更：从"选型定生死"→"**质量验证 + 锁版**"（typed task 泛型质量、DLQ 行为、并发正确性、打包体积）；验证不通过才启用备胎。

---

## 三、总体架构

```
┌─ renderer ──────────────────────────────────────────────────────┐
│  多驱动 UI：并行会话卡片 / 任务 tab（复用现有 sessionId-keyed 事件流）│
│  新 IPC：driver.spawn / driver.list / driver.send / driver.cancel │
└──────────────┬───────────────────────────────────────────────────┘
┌──────────────┴─ desktop main ────────────────────────────────────┐
│  DriverPool（main/driver-pool.ts，框架唯一入口/出口）               │
│   ├─ @ekaone/agent-relay：typed task bus + 依赖感知并行 + DLQ      │
│   ├─ driver = { driverId, sessionId, AbortController, promptQ }   │
│   └─ 并发上限 N + 背压 + 每路独立 interrupt/pause                   │
│  调用面（全部为已有 API，core 近零改）：                             │
│   manager.createSession / replySession(sessionId) /               │
│   interruptSession(sessionId) / resumeSession                     │
└──────────────┬───────────────────────────────────────────────────┘
┌──────────────┴─ core（仅护栏小改，不动内核）────────────────────────┐
│  E2 守卫 · G1 串行队列 · G3 弃单数中断 · G4 计数化 · G5 互斥 · G2 审计│
└───────────────────────────────────────────────────────────────────┘
```

要点：

1. 框架只落在桌面 main 编排层；core 保持 UI-free / 框架-free。
2. 多路 = 多 sessionId 的 `replySession` 并发 await，**绕过** `handleUserPrompt` 单指针路由（E1 无需改）；旧单驱动路径原样保留，向后兼容。
3. 事件零新增：三条 session-keyed 通道直接承载多路流。
4. 红利：`createSession` 的缓存稳定前缀设计（`lifecycle.ts:162-171`）使并发多会话**提高** DeepSeek 前缀缓存命中率；多路消耗经 usage-ledger 按路可见。

## 四、DriverPool 具体设计

### 4.1 driver 状态机

```
idle ──spawn──▶ spawning ──createSession+首轮 replySession──▶ running
running ──无 tool_calls 的完成──▶ completed（terminal）
running ──等待用户/权限──▶ waiting_for_user / ask_permission（可 driver.send 恢复）
running ──driver.pause──▶ paused ──driver.resume──▶ running
任意 ──driver.cancel──▶ cancelled（interruptSession(id)：abort + 杀进程树）
running ──异常──▶ failed（进 DLQ；可 driver.retry）
```

状态来源 = 该路 sessionId 的 `SessionEntryUpdated` 事件（engine 状态机原样映射，pool 不自造第二真相）；`waiting_for_user`/`ask_permission` 语义与单驱动会话完全一致。

### 4.2 对外接口（ipc 契约层类型，pool 内部才碰框架）

```ts
driverSpawn(root: string, init: { prompt: UserPromptContent; title?: string }): Promise<{ driverId; sessionId }>
driverSend(driverId: string, prompt: UserPromptContent): Promise<{ queued: boolean }>   // running 中入队
driverCancel(driverId: string): Promise<{ stopped: boolean }>
driverPause(driverId: string) / driverResume(driverId: string)
driverList(): Array<{ driverId; sessionId; title; state; queued; promptTokens }>
```

事件：**零新增**——渲染层按 sessionId 订阅现有三条通道；pool 只补一个轻量 `DriverStateChanged`（driverId↔sessionId 映射与队列深度，低频）。

### 4.3 与 agent-relay 的映射

| 本方案概念 | agent-relay 概念 |
|---|---|
| 一路 driver 的完整生命周期 | 一个 typed task 流 |
| `driverSpawn` / `driverSend` / `driverCancel` | task 定义（typed tasks）+ in-memory bus 提交 |
| 并发上限 N / 每路 prompt 队列 | bus 消费并发度；队列深度 8，满则 `driverSend` 结构化拒绝（背压） |
| 单路异常隔离 | dead-letter queue → `failed` 态 + `driver.retry` 重投 |
| 首版无跨路依赖 | DAG 能力预留（任务树分支并行/汇总等待时启用），不进首版验收 |

### 4.4 并发与背压策略

- 全局并发上限 `MAX_CONCURRENT_DRIVERS = 3`（设置项，S4）；到达上限后 `driverSpawn` 结构化拒绝并提示。
- 每路 prompt 队列深度 8；`ask_permission`/`waiting_for_user` 态的 `driverSend` 走权限应答通道（与单驱动会话语义一致）。
- LLM 层不额外限流（各家网关自带 429），但 pool 记录每路 in-flight 请求数供 UI 展示。

### 4.5 文件落点（全部新文件 / 小改，遵守 2500 行纪律）

- 新增：`packages/desktop/src/main/driver-pool.ts`（≤500 行，纯编排）
- 修改：`shared/ipc.ts`（契约段）· `preload/index.ts`（绑定）· `main/index.ts`（handler 注册，~30 行）
- core 护栏：`session-manager-lifecycle.ts`（E2 守卫）· `common/file-history.ts`（G1 队列）· `session-manager-tasks.ts`（G4 计数化）· 对应测试
- 渲染层：`components/DriverDeck.tsx`（并行卡片，复用 Message/ContextProgress）· App.tsx 挂载 · i18n ×6

## 五、分期（每期独立可验收）

- **S0 质量验证 + 锁版（0.5 天）**：agent-relay 装入 desktop dependencies；冒烟 = 双 typed task 并行 + 独立 task 并行 + DLQ 触发 + TS 类型评估 + 打包体积测量；**结论与锁定版本回填 §2.2**；不达标启用备胎（actojs / p-queue，接口不变）。
- **S1 core 护栏（1–2 天，纯小改）**：E2/G1/G4/G5 + G2 审计；双会话并发回归夹具（复用 `session-test-utils` mocked-client 手法）。
- **S2 DriverPool + IPC（2–3 天）**：§4 全量 + main 侧单测（状态机、背压、单路中断不影响他路）。
- **S3 渲染层（2–3 天）**：DriverDeck 卡片、每路控制、旧视图零回归、i18n ×6。
- **S4 观测与调优（0.5 天）**：多路消耗视图（usage-ledger 按 sessionId 聚合）、并发上限设置、缓存命中率对比记录。

## 六、风险与不做清单

- **同工作区文件冲突**：两路同时写同一文件是语义问题非并发问题——首版约束为"多路 = 多**只读探索/审查**或**任务树分工的不同分支**"，写入型并行等任务树（taskRef）调度成熟后再放开；权限系统按会话独立裁决已天然隔离。
- **单人 0.x 包风险**：§2.2 锁版 + 单点隔离 + 备胎成文。
- **明确不做**：改 `activateSession` 内核循环；引擎级 Actor 化；跨进程/跨设备并行；Redis/队列服务依赖；首版 DAG 跨路依赖编排。

## 七、验收标准

1. 同一工作区内 ≥2 路 driver 并发跑完各自任务，互不串流、互不覆盖状态；
2. 单路 interrupt/pause/cancel 只影响该路（进程树按 sessionId 清理）；
3. 并发下 file-history 无 index.lock 报错；
4. 旧单驱动路径（现有对话 UI）行为完全不变；
5. `npm run check && npm test` 全绿，护栏项各有回归测试；
6. agent-relay 符号 grep 不出现在 `driver-pool.ts` 之外（隔离验收）。
