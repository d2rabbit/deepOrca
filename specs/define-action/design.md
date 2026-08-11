# defineAction 一次定义多表面 — 详细设计

> 日期：2026-08-11 · 状态：规划中
>
> 灵感来源：[BuilderIO/agent-native](https://github.com/BuilderIO/agent-native)（MIT）的 `defineAction` 设计模式
> 前序调研：本对话（Agent Plugins / agent-native / HarnessBank 三模块集成调研）
> 关联路线：feature-roadmap §十六 能力编排协议（defineAction 核心机制）、§十二 插件中心、§十 引擎演进（Subagent）、§十一 自进化层二（HarnessBank evolver）
>
> 首批适配模块：**代码审查**（CRG + ocr）+ **知识索引**（codegraph + openwiki + arch-scan）
>
> 设计约束：
>
> 1. **严守 core 无 UI 铁律**——schema 落 `shared/`、run 逻辑 + MCP 暴露落 core、IPC handler 注册落 desktop main、UI 触发落 renderer。不照搬 agent-native 原版的 fullstack 共置。
> 2. **fail-open / 渐进**——新机制与现有 MCP server / IPC handler 并存，不重写已落地的 codegraph/CRG MCP server，仅在外层包一层注册与编排。
> 3. **不引入 agent-native 框架本体**——只吸收 `defineAction` 模式 + `application_state` 思想，React+Vite+Nitro 全栈与 Electron+core 分层对立，不采纳。

---

## 一、问题：一个功能碎片化到三种调用机制

两个首批模块都患同一个病——**一个产品 UI 功能碎片化到 3 种调用机制、跨 2 个 package、无统一状态面**。

### 代码审查（CRG + ocr）现状

| 引擎 | 调用机制 | MCP？ | IPC？ | UI |
|---|---|---|---|---|
| ocr（Open Code Review，Alibaba） | desktop main 特权 IPC spawn | ❌ 无 | `review:run` / `review:checkAvailable` | Quality tab（真结果查看器） |
| CRG（code-review-graph）生命周期 | desktop main IPC | ❌ 无 | `crg:reindex` / `crg:visualize` / `crg:list` | Risk/Architecture tab（**仅图生命周期 + 说明文字，非结果查看器**） |
| CRG 分析（10 工具） | core MCP server `code-review-graph` | ✅ 10 工具 | ❌ 无 | 无（agent 聊天驱动） |

**痛点**：ocr 完全没有 MCP 表面（agent 只能 bash hack 调 `ocr review`）；CRG 分析工具 UI 不可触发，Risk/Architecture tab 是说明文字而非结果查看器；同一"代码审查"能力散落在特权 IPC spawn / 普通 IPC / MCP 三套机制。

### 知识索引（codegraph + openwiki + arch-scan）现状

| 组件 | 调用机制 | MCP？ | IPC？ | UI |
|---|---|---|---|---|
| codegraph（符号级） | core MCP server `codegraph` + desktop IPC 建图 | ✅ 8 工具 | `codegraph:reindex` / `codegraph:list` | IndexLibraryPanel（Phase 1） |
| openwiki（文档级） | desktop main IPC CLI spawn | ❌ 无 | `wiki:init` / `wiki:update` / `wiki:listPages` / `wiki:readPage` | IndexLibraryPanel（Phase 2） |
| arch-scan（架构级） | **纯聊天 prompt `/arch-scan`** | ❌ 无 | ❌ 无 | IndexLibraryPanel Phase 3（**fire-and-forget，不被 await、无状态回流**） |

**痛点**：openwiki 无 MCP 表面（agent 无法程序化查 wiki）；arch-scan 是 fire-and-forget prompt，面板拿不到完成信号；三件套的"同步构建"编排是 renderer 里 40 行 promise 链 + 一个 prompt hack，不是一等公民能力；插件清单分裂（`knowledge` 装 openwiki+gitmcp，`code` 装 codegraph+arch-scan），但 UI 当成一个"index"rail。

---

## 二、defineAction 原语设计

### 2.1 核心 API

```ts
// packages/core/src/actions/registry.ts （新增，UI-free）
export interface ActionDefinition<I, O> {
  id: string;                 // 点分命名空间，如 "review.run"、"index.buildAll"
  schema: ZodSchema<I>;       // 输入校验（同时生成 MCP tool inputSchema）
  description: string;        // 供 MCP tool / LLM 工具列表
  category?: string;          // UI 分组（review / index / ...）
  // 可选：声明副作用，复用现有权限系统（permissions.ts）做 IPC 网关鉴权
  sideEffects?: string[];
}

export interface ActionContext {
  projectRoot: string;
  emit: (event: ActionProgressEvent) => void;  // 进度回流（替代裸 IPC event）
}

export class ActionRegistry {
  register<I, O>(def: ActionDefinition<I, O>, run: (input: I, ctx: ActionContext) => Promise<O>): void;
  execute<I, O>(id: string, input: unknown): Promise<O>;        // 供 desktop IPC handler 委托
  toMcpToolDefinitions(): ToolDefinition[];                      // 自动生成 MCP 工具面供 agent
}
```

### 2.2 三表面如何"自动"

一次 `register` 同时产生三个表面，无需手写三套绑定：

| 表面 | 产生方式 | 落点 |
|---|---|---|
| **MCP tool**（agent 可调） | `toMcpToolDefinitions()` 把每个 action 生成 `mcp__deeporca__<id 点分转下划线>` 工具，注册进现有 builtin MCP server 机制（`augmentMcpServersWithBuiltins` 同款） | core |
| **IPC handler**（UI 可触发） | desktop main 启动时遍历 registry，为每个 action 注册 `<category>:<verb>` IPC handler，内部 `registry.execute(id, input)` | desktop main（薄包装） |
| **LLM 内置工具** | action 默认进 MCP 工具面即等价于 LLM 工具；纯本地逻辑的 action 也可直接进 `ToolExecutor` 的 handler map | core |

> **关键**：子进程 spawn 逻辑（ocr / crg / wiki / codegraph 的 build）**留在 core**——core 是 Node 运行时，可用 `child_process`。Electron 特定的 `ELECTRON_RUN_AS_NODE` / vendored 路径解析通过已有的 host-injection 模式注入（`configureCrgVersionRoot` / `configureCodegraphVendorRoot` 同款），保持 core 不 import electron。当前 spawn 代码在 desktop main 是历史选择，迁移时下沉到 core。

### 2.3 进度回流（替代散落的 `event:*Progress`）

现有 `event:reviewProgress` / `event:crgProgress` / `event:codegraphProgress` / `event:wikiProgress` 四套进度事件统一为 `ActionContext.emit`。desktop main 把 emit 转成统一的 `event:actionProgress`（payload 含 `actionId`），renderer 按 actionId 分发到对应面板。arch-scan 首次获得进度回流。

### 2.4 权限网关

IPC handler 注册时按 `def.sideEffects` 复用 `computeToolCallPermissions` 鉴权（现有 `handlePrivileged` 的替代）。当前 `ReviewRun` / `CrgReindex` / `WikiInit` 的特权标记迁移为 action 的 `sideEffects: ["spawn-subprocess", "mutate-index"]`。

---

## 三、适配清单：代码审查（5 个 action）

| action id | schema | run 逻辑 | 三表面收益（现状 → 目标） |
|---|---|---|---|
| `review.run` | `{scope?, from?, to?, audience?}` | 下沉 core，spawn ocr CLI | IPC（Quality tab 按钮，保留）+ **MCP tool 新增**（agent 像工具一样调 ocr，告别 bash hack）+ scope 从硬编码解放 |
| `review.checkAvailable` | `{}` | core，探测 npm launcher | IPC + MCP |
| `crg.reindex` | `{root}` | core crg.ts 现有 `runCrgResetWithOutput` | IPC（Risk tab，保留）+ **MCP tool 新增**（agent 可主动建图，不必等用户点按钮） |
| `crg.visualize` | `{}` | core crg.ts 现有 `runCrgVisualize` | IPC + MCP |
| `crg.analyze` | `{tool: 分析工具名, args}` | core，路由到现有 10 个 CRG MCP 工具 | IPC（**Risk/Architecture tab 变真结果查看器**）+ MCP（10→1 收敛入口，可选） |

**核心收益**：ocr 首获 MCP 表面；CRG 分析首次可从 UI 触发，Risk/Architecture tab 从说明文字升级为结果查看器。

---

## 四、适配清单：知识索引（6 个 action）

| action id | schema | run 逻辑 | 三表面收益 |
|---|---|---|---|
| `index.buildAll` | `{mode: "init"\|"update", root}` | **core 新增编排器**（替代 renderer 40 行 promise 链） | IPC（IndexLibraryPanel"构建索引"按钮）+ **MCP tool 新增**（agent 一键全量索引） |
| `codegraph.reindex` / `codegraph.list` | `{root}` / `{}` | core codegraph.ts 现有 | IPC + MCP（保留现有 8 个 `codegraph_*` 查询工具不动） |
| `wiki.init` / `wiki.update` / `wiki.listPages` / `wiki.readPage` | 各自参数 | 下沉 core，spawn openwiki CLI | IPC（保留）+ **MCP tool 新增**（**openwiki 首获 MCP 表面**——agent 可程序化查 wiki） |
| `arch-scan.run` | `{perspective?, depth?}` | core，**触发 subagent 执行该 skill**（见 §五） | IPC（**带状态回流**，告别 fire-and-forget）+ **MCP tool 新增**（agent 可像工具一样调架构扫描） |

**核心收益**：openwiki 首获 MCP 表面；arch-scan 从 prompt 变可 await 的工具；三件套编排从 renderer 上移到 core 成一等公民。

---

## 五、关键难点：arch-scan.run → subagent 收敛

`arch-scan.run` 的 `run` **不能是确定性函数**——它的本质是"agent 读代码 + 输出 A2UI Surface"。所以它的 `run` 必须触发一个 subagent 去执行该 skill。

这恰好串联三个 roadmap 模块，使 arch-scan 成为 defineAction + Subagent + A2UI 的**第一个交汇用例**：

```
arch-scan.run(input)
  → core 触发 subagent（§十 Subagent P2 的 runSubagent）
      → subagent 执行 arch-scan skill（读代码 + 思考）
      → 输出经 update_surface（§十 A2UI，已有）渲染
  → ActionContext.emit 回流进度/完成
```

**依赖**：`arch-scan.run` 落地前置条件是 §十 Subagent（P2）。在此之前，arch-scan 保留现状（prompt 注入），`arch-scan.run` 作为 Phase 3 项，待 Subagent 就绪。这也为 Subagent 从 P2 提级提供了具体用例依据（与 §十一 HarnessBank evolver 同款论证）。

---

## 六、分层落地（严守 core 无 UI 铁律）

```
shared/actions.ts        action 的 schema 类型（zod）+ actionId 常量（无运行时，两侧可 bundle）
core/actions/            ActionRegistry + MCP 自动暴露 + 编排逻辑 + spawn 下沉
                           （index.buildAll 编排、arch-scan.run 触发 subagent、ocr/crg/wiki spawn）
desktop main             启动时遍历 registry 注册 IPC handler（委托 core.execute）+ 权限网关
desktop renderer         CodeReviewPanel / IndexLibraryPanel 调 api.<actionId>()
```

**与 agent-native 原版的区别**：原版把 schema + run 共置一份（fullstack 假设）。DeepOrca 改造为三处分离——schema 在 shared（两侧可 bundle）、run 在 core（UI-free，可 spawn）、IPC 注册在 desktop（薄包装 + 鉴权）。这保证 core 不 import react/electron，desktop 依赖 core 不可逆。

---

## 七、迁移阶段

| 阶段 | 内容 | 依赖 | 验证 |
|---|---|---|---|
| **Phase 0** | 建 `ActionRegistry` 原语 + MCP 自动暴露 + 统一 `event:actionProgress` + 一个 trivial action（如 `review.checkAvailable`）跑通三表面 | 无 | trivial action 同时出现在 MCP 工具列表、IPC handler、UI 按钮，进度回流正常 |
| **Phase 1** | 迁移**代码审查** 5 个 action | Phase 0 | ocr 可被 agent 作为 MCP 工具调用；Risk tab 能显示 CRG 分析结果 |
| **Phase 2** | 迁移**知识索引** codegraph + openwiki 部分（5 个 action） | Phase 0 | `index.buildAll` 在 core 编排；openwiki 可被 agent 查询；renderer 链删除 |
| **Phase 3** | 迁移 `arch-scan.run` | **§十 Subagent（P2）** | arch-scan 可 await、有进度、agent 可工具化调用 |
| **Phase 4**（后续） | defineAction 成为所有新能力标准入口；老 MCP server 渐进包装 | — | §十六 OpenWork 双工具编排可基于 defineAction 实现 |

每阶段独立可发布、可回滚（与现有 MCP server / IPC handler 并存，旧路径保留至新路径验证）。

---

## 八、非目标

- **不重写** codegraph / CRG 现有 MCP server——它们是 vendored 上游进程，defineAction 只在外层包注册与编排，不改 server 内部工具。
- **不迁移** 7 个内置工具（bash/read/write/edit/AskUserQuestion/UpdatePlan/WebSearch）——它们是引擎核心，工具面已直接进 `ToolExecutor`，不属于"能力编排"范畴。
- **不引入** agent-native 框架本体（React+Vite+Nitro）——只吸收 defineAction 模式 + `application_state` 思想（后者另案，补全 A2UI 反向链路）。
- **不做** OpenWork 双工具 `search_capabilities`/`execute_capability` 的 MCP server（§十六 P3）——那是 defineAction 之上的编排层，本 spec 只到 defineAction 原语 + 两模块适配。
- **不动** 插件清单分裂（knowledge/code 两个 skill.plugin.md）——那是 §十二 插件中心 UI 的事，本 spec 只保证 action 层统一，UI 分组另案。

---

## 九、与 roadmap 的对应

- 本 spec 落实 feature-roadmap §十六「核心机制：defineAction」小节（v3.17 新增）的首批具体动作清单。
- `arch-scan.run`（§五）为 §十 Subagent（P2）提供提级用例，与 §十一 HarnessBank evolver 同源论证。
- `application_state`（agent-native 第二个借鉴点）不在本 spec，另案设计（补全 A2UI 反向链路，纯增量）。

---

## 十、模块设计（深模块视角）

> 设计方法论：`codebase-design` skill——深模块（小接口藏大量行为）、删除测试、接口即测试面、接受依赖别创建依赖、返回结果别生副作用。词汇：Module / Interface / Depth / Seam / Adapter / Leverage / Locality。

### 设计自检

- **方法数**：ActionRegistry 收敛到 4（register / execute / list / toMcpToolDefinitions），不可合并。
- **参数**：`register(def, run)` 两参；`execute(id, input, opts?)` 仅 AbortSignal。
- **接缝真实性**：registry.execute 被 McpActionBridge + IpcActionBridge **两个 adapter** 调用 → 真实 seam ✓；Spawner 被 ElectronNodeSpawner + MockSpawner **两个 adapter** 实现 → 真实 seam ✓。

### M1. ActionRegistry（core）— 深中心

| 维度 | 内容 |
|---|---|
| Interface | `register<I,O>(def, run)`、`execute<I,O>(id, input, opts?)→RunHandle<O>`、`list()→ActionDefinition[]`、`toMcpToolDefinitions()→ToolDefinition[]` |
| 不变量 | id 唯一(点分)；未知 id→ACTION_NOT_FOUND；schema 校验失败→INPUT_INVALID(不抛裸异常)；run 收 (input, ctx)，ctx.emit 唯一进度通道、ctx.signal 支持取消 |
| Depth | **DEEP**——4 方法隐藏 MCP schema 生成、进度路由、spawn 委托、subagent 触发、取消传播、权限透传 |
| Seam | action-author 侧(defineAction)↔ 系统；core ↔ 执行基底 |
| Adapters | McpActionBridge、IpcActionBridge(两 adapter 调同一 execute) |
| Leverage | 一次 register = 三表面；第 N 能力 O(1) 而非 O(3 套绑定) |
| Locality | spawn/MCP/IPC 接线变更集中，不散落各能力 |

删除测试：删掉→每能力回手写 3 套绑定→复杂度重现到 N 调用方→深。✓

### M2. Spawner（core↔desktop 注入接缝）— 关键的"接受依赖"

core 要 spawn 子进程(ocr/crg/wiki/codegraph build)但不得 import electron → **不 `new`，接受注入**。

| 维度 | 内容 |
|---|---|
| Interface | `spawn(cmd,args,opts)→{stdout:AsyncIterable, stderr:AsyncIterable, kill(), exited:Promise<{code}>}`、`resolveNodeRunner()→string\|null` |
| 不变量 | 不 import electron；desktop boot 时注入实现；失败返回结构化 error 不抛 |
| Depth | **DEEP**——2 方法隐藏跨平台二进制解析、ELECTRON_RUN_AS_NODE、PATH 探测、stdio 流 |
| Seam | core 与"如何启动子进程"之间 |
| Adapters | ElectronNodeSpawner(desktop 注入)+ MockSpawner(tests)→ 真实 seam ✓ |
| Leverage | 所有 spawn-based action 依赖此一 seam，可无真实子进程单测 |
| Locality | vendored 路径解析(Node 22.5 turboshaft、uv pin)集中一处 |

注入点：`desktop/src/main/index.ts` boot 调 `configureActionSpawner(new ElectronNodeSpawner(vendorRoots, nodeRunner))`，同 `configureCodegraphVendorRoot`/`configureCrgVersionRoot` host-injection 模式。删除测试：删掉→core 要么 import electron(违反铁律)要么无法 spawn→深。✓

### M3. RunHandle（execute 返回）— "返回结果，别生副作用"

execute 不把进度/取消泄漏成全局，返回 handle：

| 维度 | 内容 |
|---|---|
| Interface | `result: Promise<O>`、`onProgress(cb)→unsubscribe`、`cancel(reason?)` |
| 不变量 | cancel 后 result reject 为 CANCELLED；onProgress 可多次订阅；handle 持本次执行的进度流(非全局) |
| Depth | MEDIUM——把"一次执行的副作用"封装成可传递的值 |

取代裸 Promise：进度回流 + 取消是 action 固有需求(建图要流式进度、arch-scan 要可取消)，裸 Promise 表达不了。

### M4. defineAction（作者侧糖）— 极小接口

`defineAction<I,O>(def, run)→def`，内部 `registry.register(def,run)`。**有意浅**(ergonomic sugar，不引入新接缝，不违反"一个 adapter=假设接缝"原则)。

### M5. McpActionBridge（core adapter）— seam 第一证明

每个 action 生成 MCP 工具 `mcp__deeporca__<id>`；dispatch 反查 id→registry.execute→await result。注册进 builtin MCP 机制(新增 `DEEPORCA_ACTIONS_MCP_SERVER_NAME`)。Locality：MCP 协议变更集中，不动各 action。

### M6. IpcActionBridge（desktop main adapter）— seam 第二证明

boot 时遍历 registry.list()，每 action 注册 `<category>:<verb>` IPC channel；handler 内 `permissionGate.check(def.sideEffects)→registry.execute(id,input,{signal})`；RunHandle.onProgress 转发为统一 `event:actionProgress`(payload 含 actionId，renderer 按此分发)。**取代**：现有 4 套特权/普通 handler + 4 套 `event:*Progress` → 一条 registerAll + 一个 `event:actionProgress`。两 adapter(M5+M6)调同一 execute → 真实 seam ✓。

### M7. ActionContext + 三类 run

```ts
type ActionRun<I,O> = (input: I, ctx: ActionContext) => Promise<O>;
interface ActionContext {
  readonly projectRoot: string;
  readonly signal: AbortSignal;
  readonly emit: (e: ActionProgress) => void;
  readonly spawner: Spawner;            // M2 注入
  readonly runSubagent?: (opts) => Promise<result>;  // 仅 arch-scan.run 用,可选注入
}
```

| run 类型 | 形态 | 注入依赖 | 例子 |
|---|---|---|---|
| 确定性 spawn | `ctx.spawner.spawn(...)` 收 stdout→解析 | spawner | review.run、crg.reindex/visualize、codegraph.reindex、wiki.init/update |
| 编程(组合 action) | `registry.execute(子id,...)` 串行 | registry | index.buildAll、crg.analyze |
| subagent 驱动(非确定) | `ctx.runSubagent({skill,...})` | runSubagent(可选) | arch-scan.run |

`runSubagent` **可选**注入——仅 arch-scan.run 需要，普通 action 的 ctx 不含它(小表面积，不强制 agent 依赖)。

### 分层映射

```
shared/actions.ts        ActionDefinition 类型 + actionId 常量 + zod schema
core/actions/
  registry.ts            ActionRegistry(M1)+ RunHandle(M3)
  spawner.ts             Spawner 接口(M2)+ 未注入时 fail-open null 实现
  mcp-bridge.ts          McpActionBridge(M5)
  define.ts              defineAction 糖(M4)
  actions/*.ts           具体 action(review/crg/index/codegraph/wiki/arch-scan)
core/spawner-host.ts     configureActionSpawner() host-injection 点(M2)
desktop main/
  action-ipc.ts          IpcActionBridge(M6)+ ElectronNodeSpawner 实现
  index.ts               boot: configureActionSpawner(...) + registerAll(registry, ipc, permGate)
desktop renderer/        CodeReviewPanel/IndexLibraryPanel 调 api.<actionId>()
```

层铁律验证：core 不 import react/electron(Spawner 是接口，实现由 desktop 注入)✓；desktop 依赖 core ✓；core 不反向依赖 desktop ✓。

### 11 个 action 的 run 归位

| action | run 类型 | 落点 | skill 工作流来源 |
|---|---|---|---|
| review.run / checkAvailable | spawn | core/actions/review.ts | smart-code-review Step 3 |
| crg.reindex / visualize | spawn(下沉自 crg.ts) | core/actions/crg.ts | — |
| crg.analyze | 编排(路由现有 10 MCP 工具) | core/actions/crg.ts | smart-code-review Step 2 |
| index.buildAll | 编排(串行 3 子 action) | core/actions/index.ts | IndexLibraryPanel.runSequential 上移 |
| codegraph.reindex / list | spawn(下沉自 codegraph.ts) | core/actions/codegraph.ts | codegraph-cli init/index |
| wiki.init/update/listPages/readPage | spawn(下沉自 main runWikiAgent) | core/actions/wiki.ts | openwiki --init/--update |
| arch-scan.run | subagent 驱动 | core/actions/arch-scan.ts | arch-scan SKILL Step 0-3 |

编排 action 的深度价值：`index.buildAll` 的 run = `await registry.execute("codegraph.reindex") → wiki.init → arch-scan.run`，三子 action 复用、编排器极薄——即 Leverage("一次实现在 N 调用点回本")。
