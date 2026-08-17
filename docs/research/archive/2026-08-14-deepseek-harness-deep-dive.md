# DeepSeek Harness (dsh) 深度调研：优点吸纳清单与插件兼容方案设计

> 日期：2026-08-14 · 分支：fix/stabilize-data-loss-and-test-suite
> 调研对象：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT，0.1.0-rc.5，81.3k stars，浅克隆于 `/tmp/dsh-research`，深度 1）
> 官方自述："Everything is a Plugin"，基于 vendored Cordis（koishi 生态 cordis 的实质性 fork）的插件化 agent harness
> 结论先行：**dsh 最值得吸纳的不是代码而是三套现成设计——(1) 事件溯源 session log + surface 投影（"model-visible ⟺ logged" 不变量）；(2) loop 只暴露 waterfall 扩展点、一切策略皆插件；(3) 工具结果的 KV-cache 意识与 token 经济学。插件兼容建议走「进程边界优先、内核 vendoring 备选」的混合路线：短期把 dsh 作为整体经 JSON-RPC SDK / ACP 接入 deeporca 的 subagent 委派缝；若确需进程内运行 dsh 插件，vendor Cordis 内核而非自行重实现。**

---

## 一、调研对象与基本面

| 项 | 值 |
| --- | --- |
| 协议 | MIT（含 THIRD_PARTY_NOTICES）✅ |
| 版本 | 0.1.0-rc.5，**developer preview，官方明示 "THERE WILL BE COMPATIBILITY-BREAKING CHANGES"** |
| 运行时 | Node `^22.19 \|\| >=24`，ESM only，pnpm workspaces |
| 形态 | monorepo：~50 个 `@deepseek-ai/dsh-*` 包 + apps/cli + apps/web + python SDK + native（landlock C 启动器）+ vendor/（Cordis fork） |
| 分发 | `npx @deepseek-ai/dsh web`；插件经 npm（`dsh-plugin` topic）分发 |
| 版本策略 | `SESSION_FORMAT_VERSION` 保持 0，无兼容承诺；"foundation over blast radius"——可自由改名/重打包 |

风险基线：**这是一个快速变化的预览版项目**，任何兼容方案都必须把"锁定上游版本 + vendor"作为前提。

## 二、架构总览：Cordis 微内核 + capability seam + 声明式组合

### 2.1 Cordis 核心模型（vendored fork，`vendor/cordis/`）

- **Context = 代理式服务仓库**：`new Context()` 返回 Proxy，属性读取路由到服务解析器；`ctx.extend()` 原型继承子 context；`ctx.isolate(name, label)` 开辟服务隔离域；`Context.is` 用 `Symbol.for('cordis.is')` 跨副本识别。
- **Plugin 三种形状**：函数 / 类 / `{apply(ctx, config)}`；静态元数据 `name / Config(standard-schema) / inject / provide`。
- **Service 基类**：构造即自我注册（`ctx.reflect.provide`），随 fiber 卸载自动注销，同名重复注册抛错。
- **inject 驱动激活**：插件只有当其 `inject` 声明的服务全部可用时才激活——**加载顺序由服务可用性驱动，行顺序无语义**。
- **`ctx.effect()` 可逆注册**：注册即返回 disposer，支持 generator（每 yield 一个子 disposer）；fiber 卸载时逆序回收一切。
- **五种事件分发模式**：`emit`（同步不等）/ `parallel`（并发 await）/ `serial`+`bail`（短路）/ **`waterfall`（`(...args, next)` 中间件，不调 `next()` 即 veto）**——dsh 的一切策略扩展点都是 waterfall。
- **Fiber 状态机**：`PENDING → LOADING → ACTIVE | FAILED | UNLOADING → DISPOSED`。
- 类型扩展全程用 **TypeScript declaration merging**（`SessionEventMap`、`ContentBlockMap`…），插件类型安全地向核心词汇表加事件/内容块。

### 2.2 Capability seam 三角色模式

每个可替换能力恰好三角色，缺一不可（`docs/glossary.md`、`docs/capability-seams.md`）：

- **Service Definition**：拥有 `ctx.<key>` 的抽象类或 registry 类（**绝不是 interface**——要作为插件加载并自我注册）；
- **Service Provider**：一个或多个实现（同一 context 只挂一个）；
- **Consumer**：inject 该服务的插件（通常是 model-facing 工具）。

范例（shell seam）：`packages/shell/shell`（`abstract class ShellExecutor extends Service`，docstring 里写死结算契约：`run` 只对基础设施失败 reject，非零退出/超时/中止都 resolve）→ provider `bash-local` / `bash-sandbox` / `pwsh-local` → consumer `tool-bash`。**换 sandbox/远程 executor 不动任何 consumer**。

### 2.3 声明式组合：cordis.yml 三层叠加

1. **entry 格式**（`vendor/loader/src/config/entry.ts`）：`id / name / config / disabled / group / inject / isolate / intercept`，支持 `!!js` 表达式（config 在 inject 激活后求值、disabled 每次挂载决策求值）。
2. **进程级 profile/bundle**：profile = `$DSH_HOME/profiles/<name>/`（package.json 声明 `dsh.profile.bundles` 有序列表 + 用户 `cordis.patch.yml`）；bundle = npm 包（`dsh.bundle.patch` 指向 patch 文件）。层叠：bundle patches（按序）→ profile patch → home patch → `--patch` overlay。patch 语义：**按 id 整体替换 config（非深合并）/ disabled / insert**；算法是纯函数 `applyEntryPatches` 导出，`dsh --dump-config` 可离线审计。
3. **会话级 agent preset**：preset 目录含 `agent.cordis.yml`，`ctx.agentPresets.mount(agentCtx)` 在 agent 工厂 `setup()` 钩子里挂载；视图解析链 `agent → preset → global`（近层 shadow 远层，靠 scope parent 链）；出厂 roster 有 standard/code/cordis/minimal 四档。

### 2.4 插件分发与发现

- 包名 `@deepseek-ai/dsh-*`，`@deepseek-ai/cordis` 是**每个包的 peerDependency**（保证全树单框架实例）；
- 社区发现走 `dsh-plugin` GitHub topic；
- 安装 `dsh plugin --profile <name> add <pkg>`（转发 pnpm 到 profile 目录）；
- 源码面有 `verify-cordis-config` gate：cordis.yml 里的 bare 插件必须出现在消费方 package.json dependencies。

## 三、优点吸纳清单（映射到 deeporca 现状）

按价值排序。每条给出 dsh 出处与 deeporca 落点。

### S 级（架构级，直接回应 deeporca 当前痛点）

**S1. 事件溯源 session log + surface 投影，"model-visible ⟺ logged" 不变量**
dsh 出处：`packages/core/session/README.md`、`src/surface.ts`。append-only 日志为唯一事实源；LLM 消息历史由 `deriveMessages()` 从 surface（`user/message` / `assistant/message` / `tool/result`）**派生**；事件带 `sourceEventSeqs` / `surfaceOp(append|replace)` / `ignorable` 三个结构元数据；replace 只遮蔽 surface 不删原始日志；**崩溃修复不截断而是合成收尾**（无 call 补 `TOOL_NOT_STARTED`、无 result 补 `TOOL_OUTCOME_UNKNOWN` 并教模型"只重试只读/幂等操作"）。
deeporca 落点：**直接命中本分支（data-loss 稳定化）的痛点**。当前 `sessions-index.json` + jsonl + 250ms debounce 的 `pendingIndex` 不变量（AGENTS.md 已载明其脆弱性）可整体升级为 append-only log + 投影模型，索引本身变成投影之一，debounce 竞态从根上消失。

**S2. Loop 只暴露 waterfall 扩展点，一切策略皆插件**
dsh 出处：`docs/event-producer-consumer.md`、`packages/core/agent-loop/src/`。loop 内不设策略；`agent/pre-step`（对提议的 step 有权威否决权）、`agent/request`（改请求 config）、`agent/request-error`（compaction 的溢出恢复挂这里）、`tools/pre-execute`（hooks/permission/sandbox 的 allow/deny/ask）、`tools/execute`（timeout/retry 包装）、`tools/post-execute`（accept/replace/block/追加 additionalContexts）。
deeporca 落点：当前 `SessionManager.activateSession()` 是单体循环（compaction、权限、hook 全内联）。把这几处抽成 waterfall 扩展点后，compaction / 权限 / guard 全部可降级为插件，core 进一步瘦身。

**S3. 工具执行管线的工程细节**
dsh 出处：`docs/tool-execution-pipeline.md`、`packages/core/tools/src/index.ts`：
- `tool/call` **先于执行落盘**（UI 拿 pending 卡片）；结果引用 call 的 seq；
- **monotonic guards**：只能 deny 或弃权、身份受保护的注册式守卫；
- 并发调度：exclusive 调用构成 barrier，parallel 进有界滚动池，**派发可重叠但结果严格按模型顺序提交**；
- abort 语义：未开始调用记录合成结果 `TOOL_ABORTED_BEFORE_DISPATCH`，**保证 replay 时 call/result 永远配对**；
- `finalizeContent`：执行开始时快照的 content-only 最后不变量，每个结果恰好调用一次（含管线失败路径）；
- 工具用 `isConcurrencySafe(args)` 纯函数自声明并行安全性。
deeporca 落点：`ToolExecutor.executeToolCalls` 的并发/中断配对语义可直接对照升级。

**S4. 工具渲染意图（presentation intent）**
dsh 出处：`packages/core/tools/src/presentation.ts`。工具以纯函数 `presentCall(args)` / `presentResult(args, result)` 声明 provider 中立的渲染意图（generic / terminal / diff / search / read / web 六族视图），UI 不按工具名特判；结构化投影随 session log 持久化，live 与 replay 读同一份数据。
deeporca 落点：desktop renderer 目前按工具定制卡片，可收敛为意图驱动渲染，新工具零 UI 代码。

### A 级（子系统级，成体系优于现状）

**A1. Compaction 即插件 + KV-cache 经济学**（`packages/compaction/compaction-basic/README.md`）
- 压力检测挂 `agent/pre-step`，溢出恢复挂 `agent/request-error`，loop 无感知；
- 摘要请求**逐字节重放对话自己的系统提示+工具+被遮蔽消息**，复用 provider KV cache 暖前缀；两段式（先 model-free 剪 tool result，仍超阈值才摘要）；保留策略按 surface 单元 + tool call/result 配对边界切割；摘要不小于源则拒绝。
- deeporca 已有按模型阈值（512K/128K）的中段压缩，可吸收其两段式与 cache 意识设计。

**A2. Subagent 完整体系**（`packages/subagent/subagent/README.md`）
- `ctx.subagents` 注册表多 provider 共存（in-process spawn/fork、ACP、Claude Agent SDK、dsh-sdk 出进程）；
- one-shot 与 continuable 分离；**settlement delivery 无条件送达**（idle 父开新 turn、busy 父 steer 进 step 边界、teardown 父只 inject 不 wake；发送先于 child ownership 释放）；
- **委托即降权**：child approval policy 钉 `'never'`、`delegationDepth` 持久化单调不减、child 系统提示带固定 `subagent:delegation` 声明。
- deeporca 落点：`runSubagent`（session.ts:805）目前无深度上限、无降权、无结算通知排序保证——这是现成升级蓝图。

**A3. Skill 注册表分层 + 调用面策略**（`packages/skill/skill/README.md`）
- host 层 + scope 层合并（近层同名胜出、层内 rank 决定）；
- `invocation` 策略保留 `modelInvocable`/`userInvocable` 四组合——一次 discovery 同时服务模型工具/人类命令/内部调用；
- `snapshot()` 返回 `{skills, complete}`，任何 provider 失败如实标 incomplete 且不可缓存。
- deeporca 落点：当前 skill 扫描是扁平优先级列表 + LLM 匹配，可吸收分层/调用面/完整性标记。

**A4. System prompt 组装即注册表**（`packages/core/system-prompt/README.md`）
- section 带 `order` 数值带；**工具引导文本由工具插件自己携带**；`toolOrder` 显式声明模型可见工具顺序（含 `<unlisted-tools>` 占位）——**保证 KV cache 前缀稳定**；`{{variable}}` 插值严格（未知 throw）；scoped section 可 shadow global。
- deeporca 落点：prompt.ts 的 EJS 拼接顺序目前是隐式的，cache 前缀稳定性无保障。

**A5. Approval / permission seam**（`packages/interaction/user-approval/README.md`）
- `ctx.approval.request()` 返回四态（allowed-once/rejected/cancelled/unavailable），**只有一次性授权**（刻意简化）；缺失应答者 fail-closed 变 deny；每请求落 `approval/asked`+`approval/decided` 审计对；**策略即插件**（waterfall listener）。
- deeporca 落点：`computeToolCallPermissions` 是纯函数，可包装为 `tools/pre-execute` 上的一个 listener，天然兼容此模型。

**A6. Guard：建议式 loop-hygiene**（`packages/guard/repeat-tool-reminder`）
- 数连续同工具同参数调用，阈值 [3,5,8] 递进提醒，**决定权留给模型**；被拒调用也计数（正是要打碎的循环）；提醒以 `additionalContexts` 注入为 logged `user/message`（来源可归因）。
- `timeout-policy`：工具自声明 `timeoutMs`（声明即协作文档：声明了就必须转发 `exec.signal`）。
- deeporca 落点：目前无循环检测；agent 死循环只能靠 max iterations（80000）兜底。

**A7. Spill：超大工具结果外置**（`packages/spill/*`）
- 超阈值文本落盘为 session 私有文件，模型只见 head/tail 预览 + locator + 检索提示。
- deeporca 落点：目前大输出直接进上下文，是 token 炸弹源。

### B 级（机制/纪律级）

- **B1. Hooks 桥**（`packages/hooks/`）：`hook-protocol` 方言中立库（matcher、exit-code codec、`mergeHookOutputs` 折叠 deny>ask>allow）+ Claude Code / Codex 两个薄桥；UserPromptSubmit→`agent/pre-step`、PreToolUse→`tools/pre-execute` 等映射表现成。README 如实列出 23/30 个不支持事件——**能力边界文档的诚实度值得抄**。
- **B2. Plan mode = 纯日志状态 + 软引导**（`packages/plan/plan-mode`）：last-wins 日志事件，resume/fork/compaction 全部可恢复；切换走与请求对齐的提交通道不撕裂 step；强制约束明确交给 sandbox/approval。
- **B3. Sandbox seam**（`packages/sandbox/` + `native/landlock-run`）：`ctx.sandbox.confine(argv, policy)` 返回包装命令，bwrap/Seatbelt/Landlock 内核级 fail-closed；~300 行 C11 静态链接启动器按平台 npm optional package 分发。
- **B4. Jobs/Schedule/Workflow**：后台任务注册表（`run_in_background` 归口）、durable 定时任务（状态归 session 日志、timer 只是其投影）、模型编写 JS 编排脚本扇出 subagent（worker-thread 隔离）。
- **B5. DeepSeek 专项调优**（`packages/llm/llm-deepseek/README.md`）：**reasoning passback 规则**（带 tool call 的 assistant turn 必须把 `reasoning_content` 序列化回历史，无 tool call 则丢弃省 token）；`reasoningEffort: off|high|max` 词汇（`off` 序列化为 `thinking.type: disabled`）；`cacheReadTokens ← prompt_cache_hit_tokens`；SSE usage 归一化推迟到 `[DONE]`；上下文溢出归一为 `CONTEXT_WINDOW_EXCEEDED`（compaction 的唯一权威触发信号）。→ **逐条对照 deeporca 的 openai-message-converter / compaction 触发逻辑核查**。
- **B6. 文档即代码**：tool-catalog / config-catalog / persistence-catalog 由脚本生成 + CI 新鲜度 gate；每个 README 有 "Model Experience"（模型看到什么/Token 效应/KV Cache 效应）三段式。
- **B7. Code Mode**：preset 可让模型只见 `run_code` + 生成的 TS/Python SDK，子调用仍走完整守卫管线——应对工具数膨胀的现成方案。

## 四、dsh 插件机制解剖（兼容对象定义）

一个 dsh 插件的完整依赖面：

1. **编译期**：`import { Context, Service } from '@deepseek-ai/cordis'` + `declare module '@deepseek-ai/cordis'`（declaration merging 扩展 Context/事件表）。
2. **运行时最小面**（按必要性排序，详见下表）：Context 代理与品牌符号、服务注册表（provide/get/set + 注销唤醒依赖方）、fiber 生命周期 + effect 回收、插件规范化（三形状 + Config 校验 + inject 归一化）、五种事件分发（含 waterfall 的 next/veto 语义）、mixin 直通方法。
3. **组合层**（若要吃 cordis.yml/bundle）：Loader entry 树、模块 specifier 解析、`!!js` 方言、`applyEntryPatches`、`ctx.isolate/intercept`、schemastery 校验。
4. **dsh 层语义**：scope 原语（`dsh-scope`）、目标插件 inject 声明的 seam 服务（`ctx.tools/llm/sessions/systemPrompt/shell/settings/credentials/approval…`）、harness 事件契约（`agent/*`、`tools/*` 的参数形状与 next 语义）。
5. **稳定契约 vs 内部实现**：契约面 = Cordis 公共 API + Loader entry 格式 + seam Definition 类 docstring + 事件名/@mode/参数 + manifest 字段；内部面 = `internal/*` 事件、ModuleLoader 解析、provider 包内部。

## 五、deeporca 对 dsh 插件的兼容方案设计

### 5.1 三条路线对比

| 路线 | 做法 | 兼容度 | 工作量 | 风险 |
| --- | --- | --- | --- | --- |
| **C1. 进程边界兼容**（推荐起点） | 不进程内运行 dsh 插件；把 dsh 整体（或选定插件树）以 `dsh-jsonrpc-agent` 子进程 / ACP 形式接入，挂在 deeporca 的 subagent 委派缝（`runSubagent`/`ActionRegistry`）或 MCP 缝上 | dsh 能力整体可用，但"插件"粒度不可单独取用 | 小 | 低 |
| **C2. 内核 vendoring**（中期可选） | 按本仓库既有 vendor 机制（`scripts/vendor-*`）vendor `@deepseek-ai/cordis` + loader + include；在 core 里实现 dsh 的 Service Definition（`ctx.tools/llm/session/approval/…`）作为 deeporca 能力的适配层 | 高（含 cordis.yml 组合） | 大 | 中（双框架并存，需守住 core 极简原则） |
| **C3. 自研 shim**（不推荐） | 在 deeporca 里重写 Cordis 最小面模拟 dsh 插件 | 中 | 中 | **高**——fiber 回收顺序、waterfall veto、inject 重激活唤醒等语义极易仿错，长期维护他人框架的仿制品是负债 |

**推荐：C1 起步，C2 为备选，放弃 C3。** 理由：

1. deeporca 的既定纪律是"内建工具刻意极简，外部能力经 MCP/委派接入"——C1 与此完全同构，且 dsh 官方自己提供 JSON-RPC SDK（3 请求 + 4 通知的极小协议：`initialize / session/prompt / shutdown` + `session.event / session.status / subagent.*`）与 ACP server，进程边界是一等公民设计。
2. dsh 处于预览版且明示破坏性变更，进程边界把版本锁定隔离在一个子进程里，core 不被其 churn 波及。
3. C3 的语义陷阱有实锤：dsh 对 Cordis 做了 18 处本地加固（fiber 重入、事务性对账、disabled 插值……），说明这些语义连上游都会搞错——自行仿写必然踩同样的坑。
4. 若未来确需进程内插件（性能/部署理由），C2 直接 vendor 经过 dsh 加固的 Cordis fork，语义保真度最高；届时 deeporca core 需新增的是 seam 适配层而非框架。

### 5.2 C1 落地方案（进程边界）

- **接入点**：新增一个 subagent provider（对照 dsh `ctx.subagents` 的多 provider 模型），经 JSON-RPC stdio 驱动 `dsh-jsonrpc-agent`；或经 `ActionRegistry` 注册一个 `dsh.run` action。
- **协议映射**：
  - deeporca `runSubagent({skill, prompt, input})` → `initialize`（进程级一次）+ `session/prompt`（每委派一次）；
  - `session.event` 通知流 → 映射为 deeporca `SessionMessage` 增量（复用 `onAssistantMessage` 回调通道）；
  - `subagent.started/finished` → deeporca 会话树元数据；
  - 结算通知排序规则照抄 A2（发送先于 ownership 释放）。
- **隔离**：dsh 子进程自带 cordis.yml（可由 deeporca 的 `.deeporca/` 生成），`DEEPSEEK_API_KEY` 透传；版本锁定在 vendor 的 runtime 副本上。
- **权限边界**：委派即降权——deeporca 侧在委派边界记录 `source: 'delegation'` 日志，dsh 侧以其 `approval/policy: never` preset 运行。

### 5.3 C2 预案（内核 vendoring，仅当 C1 证明不足时启动）

 seam 适配映射表（dsh Service Definition → deeporca 实现）：

| dsh seam | deeporca 对应物 | 适配要点 |
| --- | --- | --- |
| `ctx.tools` | `ToolExecutor` + MCP 工具 | 注册表包装；`presentCall/presentResult` 映射到 desktop 卡片 |
| `ctx.llm` | `CreateOpenAIClient` 工厂 | 实现 adapter 注册；复用 DeepSeek 端点预设 |
| `ctx.session` / 持久化 | `sessions-index` + jsonl（或升级后的 S1 日志） | 若先做 S1 改造，此处天然对齐 |
| `ctx.approval` | `computeToolCallPermissions` + AskPermission 流 | 包装为 waterfall listener |
| `ctx.systemPrompt` | `prompt.ts` EJS 组装 | section/order 化改造（A4） |
| `ctx.shell` | bash tool + `setShellIfWindows` | docstring 结算契约照搬 |
| `ctx.skills` | skill 扫描/加载 | A3 分层化 |
| `ctx.settings` / `ctx.credentials` | `settings.ts` / `.deeporca/settings.json` | 直接适配 |

兼容分层（哪些 dsh 插件能跑）：① 纯工具插件（`ctx.tools.register`）——最容易；② hook/waterfall 插件（`tools/pre-execute` 等）——需 S2 扩展点先落地；③ 服务 provider 插件——需对应 seam 存在；④ UI 插件（dsh-client 树）/ 协议插件——**不兼容**，明确排除。

### 5.4 与 pi-agent 调研结论的关系

两份调研结论同向：**外部 agent 运行时一律走委派/进程边界接入，不动 deeporca 核心循环**。dsh 与 pi 二选一作为首个委派 provider 即可；dsh 胜在与 DeepSeek 模型同源调优 + 官方 SDK 协议极小，pi 胜在 API 稳定度与文档。建议优先 dsh（与本产品定位"tuned for DeepSeek"天然对齐）。

## 六、风险与约束

1. **预览版 churn**：`SESSION_FORMAT_VERSION=0` 无兼容承诺；一切接入以锁定版本 + vendor 为前提。
2. **双运行时心智负担**：C1 下 deeporca 会话日志与 dsh 会话日志各有一份，需在 UI 明示归属；结算/中断语义要靠 5.2 的排序规则弥合。
3. **供应链**：vendoring dsh runtime 会带入其依赖树（Cordis fork + schemastery 等），需过 `THIRD_PARTY_NOTICES` 合规与本仓库 vendor 审计惯例。
4. **不要平行移植**：S/A 级清单是"设计吸收"而非代码依赖——逐条在 deeporca 自有类型体系里重实现，避免把 dsh 的 0.x API 面变成我们的编译期依赖。

## 七、建议行动顺序（调研结论，非任务承诺）

1. **先做 S1 设计评估**（事件溯源 session log）——直接服务当前 data-loss 稳定化分支，收益最大且与 dsh 兼容路线正交；
2. B5 的 DeepSeek 专项规则逐条对照核查（reasoning passback、CONTEXT_WINDOW_EXCEEDED 归一化）——成本极低，可能立即修 bug；
3. S2 扩展点抽离（waterfall 化）作为 A1/A5/A6 的前置；
4. C1 委派接入做 spike（`dsh-jsonrpc-agent` 子进程 + `runSubagent` 桥），验证事件流映射保真度；
5. S3/S4 工具管线与渲染意图随 desktop UI 迭代择机吸收。

## 附：信息来源

- 浅克隆 `/tmp/dsh-research`（depth 1，80MB）全量源码与文档
- 权威文档：`docs/architecture.md`、`cordis-primer.md`、`capability-seams.md`、`event-producer-consumer.md`、`tool-execution-pipeline.md`、`agent-lifecycle.md`、`api-gateway.md`、`glossary.md`、`rescope.md`
- 关键源码：`vendor/cordis/src/{context,events,registry,service,reflect,fiber}.ts`、`packages/core/agent-loop/src/agent.ts`、`packages/core/tools/src/index.ts`、`packages/core/session/src/surface.ts`、`packages/sdk/protocol/src/types.ts`、`packages/llm/llm-deepseek/README.md`
- 组合样例：`packages/bundle/base/cordis.patch.yml`、`apps/cli/config/agent-presets/*/agent.cordis.yml`、`examples/headless-agent/cordis.yml`
