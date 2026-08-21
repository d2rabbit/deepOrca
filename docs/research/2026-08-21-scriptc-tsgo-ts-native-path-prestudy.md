# 预研：TypeScript 原生化迁移路径 — vercel-labs/scriptc + TypeScript 7（tsgo）

日期：2026-08-21 · 分支：`docs/ui-ux-redesign-proposal` · 性质：预研（无代码变更）
命题来源：用户拍板更正 [`2026-08-19-kernel-wasm-systems-refactor-prestudy.md`](./2026-08-19-kernel-wasm-systems-refactor-prestudy.md)
（下称"08-19 主报告"）的 M2 语言裁决——**不换语言，继续使用 TypeScript**；超级大版本的
性能/内存目标改由两条 TS 原生路径承接：**scriptc**（TS→原生二进制编译器）作运行时
迁移载体，**tsgo**（TypeScript 7 的 Go 原生编译器）作工具链升级。本报告在同一裁决
框架下深挖两者，并回答一个问题：*今天怎么写 TS，后面才能尽可能无缝地迁移？*

## TL;DR

| 对象 | 本质 | 成熟度 / 许可 | 对本命题的价值 | 结论 |
| --- | --- | --- | --- | --- |
| **scriptc**（vercel-labs） | TS/JS → 原生可执行文件 / wasm（WASI p1）的**静态编译器**：TS 编译器前端 → LLVM IR → clang；无 JS 引擎的微型原生运行时（hello world ~320KB / 启动 ~4ms，对照 Node ~120MB / ~35ms）；`--dynamic` 可选内嵌 quickjs-ng（~620KB）承接 npm 包与 `any` 代码 | **官方自认 experimental，非生产**；~4.2k stars、534 提交、开发活跃 · **Apache-2.0** | 首个可信的"**留在 TypeScript、拿到原生二进制**"路径——正是更正后方向的对标物；内存收益机理与 Codex 相同（不再常驻 V8/GC），但不换语言、无重写漂移成本 | **观察名单 + 最小 spike，不作当前迁移载体**：三项存亡级 API（child_process / fetch 客户端 / dynamic import()）在原生目标上**未证实或缺失**，语言子集约束需对 core 24k 行做符合性改造 |
| **TypeScript 7 / tsgo**（microsoft/typescript-go，Project Corsa） | tsc 与语言服务的 **Go 原生移植**（port 非 rewrite，类型语义逐字节保持）；官方口径全量构建 **8–12x**、均值 ~10x（VS Code 1.5M LOC：77.8s → 7.5s），编辑器项目加载 9.6s → 1.2s | **7.0 已 GA**（2026-06-18 RC，2026-07-08 GA 口径；`@typescript/native-preview` 夜间构建在先）· Apache-2.0 | **纯工具链收益**：typecheck/语言服务提速一个数量级，与运行时内存无关；本仓已在 TS 6.0.3 桥接版上，迁移是短跳 | **近期采纳（低风险）**：先入非阻塞 CI 干跑对账，诊断零差异后提升为准入；`typescript-eslint` 等编程式 API 消费者等 7.1 |

**一句话**：tsgo 解决"编译慢"，**现在就能上**；scriptc 解决"运行时内存"，**方向正确但
未成熟**——对它的正确姿势是"**写可编译的 TS + 守住进程/网络/动态加载三条接缝**"，
把无缝迁移的期权持有到其原生 API 面补齐。08-19 主报告的 M0（内存止血）与 M1（传输
中立化）**完全不受影响且更加重要**；M2 由"Rust 重写"改定义为"TS 源码保持 + scriptc
原生编译"，启动条件重写（见 Part III）。

---

# Part I scriptc 深挖

## 1.1 是什么、怎么工作

- **流水线**：用 TypeScript 编译器做解析与类型检查 → 发射 LLVM IR → clang 出原生
  二进制（macOS/Linux/Windows）；另保留可读 C 后端用于调试；wasm 走 WASI Preview 1
  （需 Zig 交叉工具链）。
- **三档语言层**：① **静态层**（默认）——无 Node、无 JS 引擎的微型原生运行时，泛型
  单态化、引用计数内存管理；② **动态层**（`--dynamic` 显式开启）——内嵌 quickjs-ng
  （~620KB）执行无法静态编译的部分（npm 包发布的 JS、`any` 类型代码），跨界值运行时
  校验，"二进制不会静默长出引擎"；③ **拒绝层**——不支持的构造直接编译失败，带 SC
  编号诊断 + code frame + 改写提示，"nothing is ever silently miscompiled"。
- **`scriptc coverage`**：报告程序可静态编译的比例，逐点列出需要动态层/不支持的
  位置——这是量化迁移成本的现成工具。
- **质量工程**：测试语料同一程序分别在 Node 与原生二进制下运行，stdout/stderr/退出
  码**逐字节对拍**；完整门禁再跑 AddressSanitizer + 引用计数审计。实验项目里罕见的
  严谨度。

## 1.2 成熟度与治理

- 官方自述 "scriptc is experimental"，**无生产可用声明、无稳定 API 承诺、无公开
  roadmap**；Vercel Labs 单一机构驱动（对照：治理风险与 MoonBit 同类，但许可干净）。
- 构建依赖：Node 24+ 与 clang（wasm 另需 Zig）——本仓 `.nvmrc` 为 Node 22，引入需
  升级构建机基线。

## 1.3 语言子集约束（对本仓源码的符合性压力）

摘自官方 Limitations 页（全部为编译错误或编号化行为差异，无静默项）：

- 宽松 `==`/`!=` 仅同类型比较与 `x == null` 惯用法；`break`/`continue` 不得跨越
  `finally`；泛型单态化有边缘拒绝（嵌套泛型函数、自依赖泛型类等）
- **Map/Set 键仅限 string/number**；`Symbol`/`globalThis`/`re.exec` 未降级（SC2020）；
  Date 仅有限构造与 getter；`JSON.parse` 返回 `unknown`
- 无 `--dynamic` 时 `any` 直接 SC2011；数组致密，空数组 `pop()` 是**不可捕获的**
  RangeError；结构宽度子类型按拷贝传递（不共享别名）
- FFI 为 C ABI 静态链接（manifest 声明），**不支持运行时动态库加载**、不支持
  可变参数/按值结构体/owned 返回
- 动态层是 quickjs-ng 而非 V8：CPU 密集代码慢、Node builtins 是 shim、**微任务交错
  顺序与 Node 可能不同**（对流式/并发代码是行为级风险）

## 1.4 存亡级缺口：对照 core 的硬依赖（一手取证，2026-08-21）

| core 硬依赖 | 本仓调用点 | scriptc 状态 | 判定 |
| --- | --- | --- | --- |
| **child_process spawn（stdio JSON-RPC）** | MCP servers / gitmcp / codegraph / uv（`core/mcp/`、`spawn-spec.ts`） | 原生目标**未见支持证据**；WASI 明确 SC3002 拒绝 | ❌ **存亡项**——MCP 架构的底座，未证实前核心不可编译 |
| **HTTP 客户端 / fetch（SSE 流式）** | LLM API 会话循环（`openai-client.ts`）、WebFetch | 原生仅示例 `node:http` **服务端**；客户端/fetch 未见；WASI 拒绝联网 | ❌ **存亡项**——LLM 调用即产品本身 |
| **dynamic `import()`** | 路由嵌入懒加载（`routing/embedding-loader.ts`）、ESM 插件/技能加载 | 文档**完全未提及**；静态编译与运行时动态加载本质冲突 | ❌ **存亡项**——大概率仅动态层可达或不可用 |
| `node:sqlite` | memory 向量/FTS5、gitmcp 索引 | 未提及；FFI 可静态链接 sqlite 但禁运行时动态库加载 | ⚠️ 需改 FFI 静态链接方案 |
| onnxruntime 原生库 | routing/memory 嵌入（双实例待并单） | 同上，FFI 约束下需专项设计 | ⚠️ |
| 微任务/流式时序 | streaming 响应、会话循环 | 动态层微任务顺序与 Node 有差异声明 | ⚠️ 行为回归风险 |

**判定**：三项存亡级 API 任一不落地，core 都无法以 scriptc 为主运行时。这与"语言
子集改造量"（1.3，属于工作量问题）不同，是**平台能力缺位**（属于路线图问题）。

## 1.5 但方向为什么是对的

- 内存收益机理与 Codex Rust 重写**完全相同**（不再 boot 第二个 V8、无运行时 GC），
  但**零重写漂移**：源码仍是同一份 TS，旧内核继续演化不产生双语种双倍成本——
  08-19 主报告 K1 风险（重写陷阱）整条消失。
- 失败成本可控：`scriptc coverage` 给出逐点诊断，迁移是"消诊断"的收敛过程而非
  大爆炸切换；静态层/dynamic 层可按子系统混合。
- 与 M1（传输中立化）天然接力：core↔壳边界一旦固化为协议（WS/stdio），内核实现
  从"Node 进程内 TS"换成"scriptc 原生二进制"对壳**透明**——这就是"无缝"的工程含义。

# Part II TypeScript 7 / tsgo 深挖

## 2.1 事实基线

- **GA 状态**：7.0 已正式发布（2026-06-18 RC、2026-07-08 GA 口径；个别二手来源称
  2 月，以官方博客为准——不影响本报告结论）。是 **port 不是 rewrite**：类型检查
  语义与 6.x 逐字节保持，官方承诺"开启 stableTypeOrdering 的 6.0 代码在 7.0 应
  编译出相同结果"。
- **性能**：全量构建官方口径 8–12x（VS Code 代码库 77.8s→7.5s，10.4x）；编辑器
  项目加载 9.6s→1.2s；并行 flag：`--checkers N`（默认 4）、`--builders N`（project
  references 并行构建，默认 16）——**monorepo 是最大受益形态**，本仓正是。
- **定位边界**：加速的是**编译器与语言服务**，对产物运行时内存/性能**零影响**。
  它与 scriptc 不是替代关系而是配套关系：tsgo 让"留在 TS"的日常成本更低，scriptc
  让"留在 TS"的终态仍是原生二进制。

## 2.2 破坏性变更 × 本仓 tsconfig 逐条对照（一手取证）

本仓 `tsconfig.base.json`：strict 全开、`module: ESNext`、`moduleResolution: bundler`、
`target: ES2022`、`verbatimModuleSyntax: true`、`types: ["node"]`、`composite +
incremental + declaration`、project references、**未用 baseUrl**。

| TS 7 变更 | 本仓状态 | 影响 |
| --- | --- | --- |
| `target: es5` 移除（最低 es2015） | ES2022 | ✅ 无 |
| `moduleResolution: node/node10` 移除 | bundler（官方建议保留项之一） | ✅ 无 |
| `amd/umd/systemjs/none` 模块格式移除 | ESNext | ✅ 无 |
| `baseUrl` 移除 | 未使用 | ✅ 无 |
| `esModuleInterop: false` 移除 | true | ✅ 无 |
| **`types` 默认改空数组** | 已显式 `["node"]` | ✅ 无（恰好免疫） |
| **`rootDir` 默认改 `./`** | 各包未显式设置 | ⚠️ **唯一实锤待办**：逐包核对 emit 布局，必要时显式 `"rootDir": "./src"` |
| JSDoc 收紧 / 模板字面量码点化 / stableTypeOrdering 默认 | — | ⚠️ 干跑对账时观察诊断差 |
| `verbatimModuleSyntax` 在 7.0 的行为 | 本仓重度依赖（`import type` 纪律） | ⚠️ 来源未确认，spike 验证项 |
| `--build` / composite / incremental | 本仓构建链核心 | ⚠️ tsgo 支持 `--build`（且有 `--builders` 增强）；incremental/tsbuildinfo 行为需 spike 验证 |
| `scripts/rewrite-esm-imports.js` 后置改写 | tsc emit 布局假设 | ⚠️ tsgo emit 输出布局一致性需验证 |

## 2.3 7.1 API 缺口与工具链影响（本仓实际依赖面）

- **7.0 无稳定编程式 API**（官方定在 7.1，"at least several months away"）。本仓
  一手核查：源码与 scripts **零编程式 API 调用**（纯 CLI 使用）——直接不受影响。
- **typescript-eslint（^8.59.2）依赖 TS 编译器 API** → 过渡期官方方案：package.json
  别名并存（`typescript` 维持 6.0.x 供 lint，另以别名装 7.0 跑 `tsgo` 构建/typecheck）。
- **tsx ^4.21 / esbuild ^0.28**：esbuild 系转译，与 tsc/tsgo 无关 → 测试与 desktop
  构建链零影响。

## 2.4 采纳路径（低风险、可回退）

1. **P0（下一窗口即可）**：devDependency 别名引入 TS 7 / native-preview，CI 加
   非阻塞 job：`tsgo --noEmit --pretty false` 与 `tsc --noEmit --pretty false` 双跑，
   收集诊断 diff 与计时（社区推荐的安全试法）。
2. **P1（diff 清零后）**：tsgo 提升为 typecheck 准入；`tsc` 6.0 保留给 eslint 与
   emit（待 2.2 的 rootDir/emit 布局验证后，emit 也可切）。
3. **P2（7.1 稳定 API 后）**：typescript-eslint 升级，移除 6.0 别名，完成单轨化。

# Part III 对 mega-version 排程的修正（替代 08-19 主报告 Part IV 的 M2–M4 定义）

| 段 | 修正后定义 | 变化 |
| --- | --- | --- |
| **M0 内存止血** | 不变（offscreen Chromium 回收 / embedding 单例 / 子进程懒启动 / 会话 LRU） | **不变，仍是第一杠杆** |
| **M1 传输中立化** | core↔壳协议边界（WS 无头服务端） | **权重上调**：它从"重写前置"升级为"无缝切换开关"——边界协议化后，内核实现（Node TS ↔ scriptc 二进制）对壳透明 |
| **M2 原生化**（重定义） | ~~Rust 重写~~ → **TS 源码保持 + scriptc 原生编译**：先 `scriptc coverage` 量化 gap → 消存亡项（1.4）→ 消语言子集诊断（1.3）→ 子系统逐个出原生二进制，经 M1 协议边界灰度切换 | 启动条件：**scriptc 原生目标补齐 child_process + HTTP 客户端/fetch + dynamic import 等价物**（或本仓完成对这三者的接缝隔离改造）；无重写漂移，但新增"单供应商实验项目"治理风险 |
| **M3 壳替换** | Electron → Tauri 评估 | 降级为纯可选；scriptc 路线下 Electron main 的 Node 也可被原生内核+薄壳替代，Tauri 不再是唯一终点 |
| **M4 wasm 双目标** | scriptc 的 WASI 目标 vs Rust wasm32-wasip2 | scriptc WASI 当前拒网络/子进程，桌面内核不可行；维持"远期按需"，MoonBit guest 线裁决不变 |

**与 Rust 线的关系**：Rust 从 M2 主语言降级为**备选**（若 scriptc 长期不补齐存亡项
或项目夭折，回退 08-19 主报告原排程）；module-system B1 guest-sdk 的 Rust 工具链
决策不受影响（guest 侧与内核侧解耦）。

# Part IV 迁移卫生规则（今天写"scriptc 可编译"的 TS）

> 目的：把未来迁移成本锁定为"消诊断"而非"改造代码"。均为增量约束，与现有 strict
> 配置同向，不引入新工具。

1. **三条接缝保持注入式隔离**（本仓已有此架构纪律，强化为红线）：
   - 进程类（child_process/spawn）→ 只经 `core/mcp/spawn-spec.ts` 一类抽象点
   - 网络类（fetch/HTTP 客户端）→ 只经 LLM client / WebFetch 的 provider 注入点
   - 动态加载类（dynamic import）→ 只经 `routing/embedding-loader.ts` 式加载器
   迁移时这三处换成 scriptc FFI/原生等价物，业务代码零改动。
2. **避开 1.3 的拒绝清单**：新代码不用宽松 `==`（eslint eqeqeq 可固化）、控制流不跨
   `finally`、Map/Set 键只用 string/number、不用 `Symbol`/`globalThis`/`re.exec`、
   `Promise.all([...])` 先注解数组类型、空数组 `pop()` 前判空（顺带消除 scriptc 的
   不可捕获 RangeError 语义差）。
3. **`any` 只增不减地消灭**：本仓 `noImplicitAny` 已开；存量 `any`（LLM 响应/JSON
   边界）是 `--dynamic` 层的主要去向，越少则静态编译覆盖率越高。
4. **新增 core 子系统时跑一次 `scriptc coverage`**（ spike 先行验证工具链可用性），
   把覆盖率当 CI 观察指标（非门禁），形成棘轮。

# Part V 风险清单

| # | 风险 | 缓解 |
| --- | --- | --- |
| S1 | scriptc 三项存亡 API（child_process/fetch/dynamic import）长期不落地 | 事件触发复审（见 Part VI）；M2 启动条件不满足就不启动；回退线 = 08-19 Rust 排程 |
| S2 | scriptc 单供应商（Vercel Labs）+ experimental，路线图中断或转向 | 只持期权不押注：迁移卫生规则（Part IV）本身是好纪律，scriptc 夭折则成本为零 |
| S3 | 语言子集改造量被低估（24k 行 core + 16k 行 memory  fork） | spike 第一件事：`scriptc coverage` 对 core 全量跑分，拿到诊断计数再排期 |
| S4 | 动态层（quickjs-ng）微任务时序差异 → streaming/并发行为回归 | 迁移验收复用现有逐字节对拍思路：core 14k 行测试在 Node 与原生二进制双跑 |
| S5 | tsgo emit 布局/rootDir 默认值变更破坏 `rewrite-esm-imports.js` 假设 | P0 干跑阶段先验证 emit 等价性；必要时显式 `rootDir` |
| S6 | typescript-eslint 卡在 TS 6 API（7.1 未到）→ 双版本并存期依赖混乱 | 官方别名方案；别名清单写入 package.json 注释，7.1 后清理 |
| S7 | Node 24+ 构建基线（scriptc）与仓内 Node 22 基线冲突 | spike 阶段隔离验证；采纳时再统一升级 `.nvmrc` |

# Part VI 结论与复审触发器

**tsgo 是"现在"**：本仓已在 6.0 桥接版上、tsconfig 几乎全绿（唯一实锤待办 rootDir
显式化）、零编程式 API 依赖——按 2.4 的 P0→P1→P2 推进，typecheck 提速一个数量级，
风险可控可回退。**scriptc 是"方向"**：它首次让"留在 TypeScript"与"原生运行时内存
收益"不再互斥，且消灭 Rust 重写的漂移成本；但三项存亡级平台能力缺位 + experimental
治理，正确姿势是 **观察名单 + 最小 spike（coverage 跑分）+ Part IV 迁移卫生**，
把无缝迁移期权持有到能力补齐。08-19 主报告的 M0/M1 不动且更重要；Rust 降为备选。

**复审触发器**（任一发生即重估本报告）：① scriptc 原生目标官宣 child_process 或
fetch/HTTP 客户端支持；② scriptc 发布稳定版/生产声明（或反向：停止维护）；③
TypeScript 7.1 稳定编程式 API 发布；④ M1 传输中立化落地（无缝切换开关就位）。
