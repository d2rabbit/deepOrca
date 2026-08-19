# 预研：超级大版本重构 — 内核 wasm 化与系统级语言重写（性能/内存驱动）

日期：2026-08-19 · 分支：`fix/test-baseline-ui-feedback` · 性质：预研（无代码变更）
命题来源：用户方向确立——**超级大版本重构计划，目标是强化性能**。现状为前端技术栈
（Electron + Node + TypeScript 全家桶），**内存占用过高**是主诉；候选手段为「内核层
wasm 化」与「全部采用系统层语言编写」。

## 命题解构（两个可分离的子命题）

| 子命题 | 内容 | 与性能/内存的关系 |
| --- | --- | --- |
| **A 内核 wasm 化** | 内核（L0/L1：会话循环/工具/权限/持久化）编译为 wasm（component）交付 | **不是性能手段**——wasm 在 V8 内运行不快于原生 JS，内核本身是受信代码也不需要沙箱；其真实价值是可移植交付 + WIT 契约形式化 + 与 guest 沙箱统一（见 Part III） |
| **B 系统级语言全量重写** | 内核改用 Rust（候选 Zig/Go，裁决见 Part II-4）编写 | **是内存/性能的主杠杆**——但收益主要来自**进程模型坍缩**（去 Electron 多进程、去 N 个 V8/Python 子进程）与去 GC/去 V8 常驻，而非"语言更快"（harness 是 LLM IO-bound，见 Part I-3） |

**结论先行**：A 与 B 必须解耦排程——**先语言（B）、后 wasm（A）**。wasm 化放在重写
完成后作为追加编译目标（cargo 双目标 native + wasm32-wasip2）几乎免费；反过来"先
wasm 化再重写"则把 TS→wasm 的性能损耗（JS 引擎进 wasm，基座 ~13.4MB 且慢于 V8
原生）先吃进主干，纯属负资产。

## TL;DR

| 对象 | 本质 | 成熟度 / 许可 | 对本命题的价值 | 结论 |
| --- | --- | --- | --- | --- |
| **Codex CLI TS→Rust 重写**（openai/codex） | 同类产品（coding agent harness）的全量 Rust 重写先例 | 生产级 · Apache-2.0 | 官方理由：性能/安全/**零依赖单二进制安装**/扩展性；"no runtime GC → lower memory"、"不再 boot 第二个 V8" | **最强先例**：重写方向被同类产品验证；反面注记——Rust 版仍出过 12GB 内存 bug，**重写不免疫架构性泄漏** |
| **Tauri（壳先例）** | Rust 壳 + 系统 WebView，替代 Electron | 生产级 · MIT/Apache 双 | 基准：空闲内存 30–42MB vs Electron 168–300MB（**降 ~58–75%**）、安装包 2.5MB vs 85MB（**降 ~96%**）、启动约 2x | **壳替换的收益天花板实证**；反例 tauri#5889（Windows WebView2 某些场景反超）需回归 |
| **swc / rolldown / biome / Turbopack** | JS 工具链 Rust 重写 + **napi-rs 绑定留在 Node 生态** | 生产级 · MIT/Apache | 渐进迁移范式：Rust 内核以原生模块混入 Node 宿主，**不换壳也能吃到内存/性能收益** | **混合期架构范式的权威依据**（M2 迁移策略直接复用） |
| **ComponentizeJS / jco**（Bytecode Alliance） | TS/JS → wasm component（StarlingMonkey 引擎内嵌），不换语言 | 可用但性能/体积不利 · Apache-2.0 | 验证了"内核 wasm 化不换语言"这条路**技术上通、经济上亏**（基座 ~13.4MB，慢于 V8 原生） | **不采纳为主路径**；仅在 M4 作对照参考 |
| **wasmtime + WASI 0.2/0.3 + Component Model** | wasm 运行时与组件规范（1.0 路线图中） | 生产级（wasmtime）· Apache-2.0 WITH LLVM-exception | 内核 wasm 双目标的运行时载体；epoch/fuel 中断是 module-system R3 风险的长期解 | **M4 载体**；module-system B1 维持"Node 原生 WebAssembly + DMABI"决策不变 |
| **Extism**（dylibso） | 通用 wasm 插件框架（Rust 核心，15+ host SDK 含 Node，7+ PDK） | 生产级 · BSD-3-Clause | guest 插件体系的对照物——与 B1 的 DMABI 决策互斥（spec 已记档"不引入"） | 维持不引入；其 host/PDK 分层思想可供 guest-sdk 参考 |
| **Hyperlight-wasm**（Microsoft） | hypervisor 微 VM 包 wasm（wasmtime 沙箱 1–2ms 启动 vs 微 VM >120ms） | **实验态，官方自认非生产** · Apache-2.0 | 无 | **不采纳**（桌面单机场景过重） |
| **Zellij** | Rust 应用 + wasmtime 插件的真实桌面先例 | 生产级 · MIT | "Rust 宿主 + wasm 插件"共存的工程证据 | 佐证 M2+M4 共存可行 |
| **Go 系 agent**（charmbracelet/crush、sst/opencode） | Go 编写的同类 agent harness | 生产级 · MIT 系 | 内存优于 Node、低于 Rust 精细控制；并发模型简单 | **不推荐主路径**（内存安全/生态/wasm 目标均弱于 Rust） |

集成深度（沿用既有定义）：L0 知识层 / L1 用户可选外挂 / L2 内置 / L3 源码级继承。
本命题全部为 **L3 自研重写**（对标本体的代码一概不拷贝——本次无 GPL 障碍，但对标
仅作证据）。

**许可红线**：与 llm_wiki 预研相反，**本次无许可障碍**——wasmtime（Apache-2.0 WITH
LLVM-exception）、Tauri（MIT/Apache）、Extism（BSD-3）、ComponentizeJS/jco
（Apache-2.0）、Hyperlight（Apache-2.0）、Zellij（MIT）、Codex CLI（Apache-2.0）全部
宽松。唯一红线延续：llm_wiki 本体（GPL-3.0）不可作壳层参考代码，Tauri 化设计须净室。

---

# Part I 问题诊断：当前栈的内存花在哪（本仓一手取证）

## 1.1 进程拓扑（一次典型会话的常驻开销）

```
DeepOrca 桌面运行时（现状）
├─ Electron 主进程（Node 24 V8）        ← 引擎 in-process：core+memory+MCP 客户端
│    ├─ onnxruntime native（Granite 97M，q8 盘上 ~118MB 量级）
│    │    ├─ routing 单例（默认开启，boot 即 warmup 载入）
│    │    └─ memory 包独立实例（开 local-onnx 后再载一份 ← 双份可共享消除）
│    ├─ node:sqlite（gitmcp 索引、memory vectors/FTS5）
│    └─ JS 堆：全部活跃会话消息 Map + task-tree + file-history + prompt 大字符串
├─ Chromium renderer（React UI + 聊天历史渲染 + A2UI surfaces）
├─ GPU / utility 进程（Chromium 固有）
├─ 隐藏 offscreen Chromium（WebFetch）  ← 【常驻】首次抓取后缓存到退出
│                                          （web-fetch-provider.ts:53-99 ensureProviderWindow
│                                           只创建不回收，1280×900 完整 renderer 进程）
├─ N × Node 子进程（各带独立 V8，30–60MB/个起）
│    ├─ MCP servers（用户配置数个，stdio）
│    ├─ gitmcp server（node:sqlite）
│    ├─ codegraph（Node 22.5+，node:sqlite）
│    └─ openwiki CLI（init/update 时瞬时）
└─ Python/uv 子进程（serena LSP、CRG）   ← 各 ~100MB 级（激活时）
```

## 1.2 三个关键裁决点

1. **大头是进程模型，不是语言**。内存主项 = Electron 多进程底盘 + N 个子进程 V8/
   Python 运行时 + 常驻隐藏 Chromium + 常驻模型权重。把这些坍缩成"1 个 Rust 主进程
   + 1 个 renderer（或系统 WebView）+ 按需短命子进程"，是数量级层面的收益来源——
   Codex"不再 boot 第二个 V8"说的就是这件事。
2. **JS 堆侧有独立的止血空间**（不依赖重写）：活跃会话消息全量驻留、prompt 每轮
   全量重建大字符串、streaming 缓冲、sessions-index 高频读改写（debounce 已有但
   仍 17×/turn 量级）。这些是 M0 的清单项。
3. **性能（延迟）不是本命题的主收益**。harness 端到端延迟由 LLM API 主导（秒级），
   内核 CPU 热点（消息转换/权限匹配/BM25/嵌入）大多已在 native（onnx/sqlite）里。
   **重写的收益函数 = 内存占用 + 启动时间 + 常驻体积 + 长会话稳定性 + 进程安全**，
   不是吞吐。

## 1.3 重写当量（精确计量，2026-08-19）

| 包 | 非测试源码 | 测试 | 说明 |
| --- | --- | --- | --- |
| core | **102 文件 / 24,364 行** | 44 文件 / 14,088 行 | session.ts 一文件 ~227KB；重写主体 |
| memory | 55 文件 / 16,017 行 | — | TDAI fork——重写时**可整体替换**（Rust 直写 L0–L3，无需 17k 行对译） |
| embedding | 4 文件 / 582 行 | — | transformers.js → Rust 侧 `ort`（onnxruntime-rust）对等 |
| desktop | 159 文件 / 36,327 行（ts+tsx） | — | renderer 为主（重写后**大部分保留**）；main 侧桥接层重写 |

量级判断：需对译的内核面 ≈ core 24k + memory 替代实现 + desktop main 桥接 ≈
**35–45k 行 Rust 当量 + 测试补齐**；单人全职**数月量级**（非数周，也非人年级）。
Codex 团队多人力做了数月，本仓范围更小但单人——排期按人月区间管理，不做点承诺。

---

# Part II 行业先例取证

## 2.1 Codex CLI：同类产品的全量重写先例（2025-06）

OpenAI 把 coding agent CLI 从 TypeScript 重写为 Rust，官方理由四条：性能、安全、
**零依赖单二进制安装**（无 npm/node_modules）、扩展性。社区复述的内存机理直接命中
本仓痛点：*"lower memory use from not having to boot a separate V8 engine with its
own GC"*、*"no runtime garbage collection → lower memory consumption"*。
**反面注记（必须写进风险）**：Rust 版此后仍出现 12GB 启动内存的架构性 bug——
语言重写消除的是 GC/运行时开销类泄漏，**消除不了设计性驻留**（本仓 Part I-1.2 的
进程拓扑问题，重写方案必须连同进程模型一起改才有收益）。

## 2.2 Tauri：壳层收益的实证边界

多来源基准一致：空闲内存 **30–42MB vs Electron 168–300MB**（降 ~58–75%）、安装包
**~2.5MB vs ~85MB**（降 ~96%）、冷启动约 2x。**边界条件**：① Windows 走 WebView2，
一致性/内存与 Chromium renderer 存在差异（tauri#5889 有反超案例），renderer 资产
（React + A2UI + 主题体系）迁移需真机回归；② Electron 专属能力无直接等价——
**offscreen Chromium WebFetch**（本仓内置工具的渲染抓取引擎）在 Tauri 无 BrowserWindow
等价物，需降级为静态抓取或引入独立 headless 方案（内存收益反噬点，需专项设计）。

## 2.3 swc/rolldown/biome/Turbopak：混合期范式（不换壳的渐进重写）

JS 工具链的 Rust 化浪潮证明了第三条路：**Rust 内核以 napi-rs 原生模块身份留在
Node/Electron 宿主内**（Vite 用 rolldown、Next 用 Turbopack、Biome 整体 Rust）。
对本命题的意义：M2 重写**不必以换壳为前提**——子系统逐个 Rust 化（napi 桥），
renderer 与 Electron 壳原样保留，内存/性能收益即时兑现，壳替换（M3）降级为可选项。

## 2.4 语言裁决：Rust 而非 Go/Zig

- **Go**（crush/opencode 先例）：开发速度快、并发简单；但 GC 仍在（内存收益打折）、
  无内存安全叙事、**wasm32 目标二等公民**（子命题 A 的双目标编译受挫）。
- **Zig**：体积/控制力极佳但生态薄（MCP/LLM/加密栈都要手搓），1.0 未至。
- **Rust**：无 GC、内存安全、cargo 双目标（x86_64/aarch64 native + wasm32-wasip2）
  一等支持、onnxruntime-rust/rusqlite/tokio/rustls 生态齐备、**module-system B1 的
  guest-sdk 已把 Rust 工具链带进仓库**（第一块砖已就位）。

> **2026-08-19 增补**：MoonBit 与仓颉（Cangjie）两门后备预选语言的深挖另立报告
> [`2026-08-19-moonbit-cangjie-language-prestudy.md`](./2026-08-19-moonbit-cangjie-language-prestudy.md)。
> 裁决：两者均不撼动 Rust 的 M2 主线（GC + 未 GA + 生态差距）；**MoonBit** 的正确
> 上车点是 module-system 的 guest 语言（wasm 体积最优），但其官方工具链仓库为
> **AGPL-3.0**（一手核证）且运行时链接豁免悬置，上车前必须解掉；**仓颉** 为
> Apache-2.0 with Runtime Library Exception（干净），但无 wasm 后端、Windows 不可
> 本机构建，定位鸿蒙 PC 移植触发线的绑定复审项（AgentDSL 对 harness 有独特契合）。

# Part III wasm 的真实定位（子命题 A 的裁决）

## 3.1 为什么"wasm 化"不是性能手段

- 内核是**受信代码**——wasm 的沙箱价值（能力制/内存隔离）属于 **guest/第三方**侧，
  module-system B1 的 DMABI 已经覆盖，内核自己进沙箱没有安全收益。
- wasm 在 V8/wasmtime 内的执行不快于原生 JS/Rust；TS→wasm 路线（ComponentizeJS，
  StarlingMonkey 内嵌 JS 引擎）基座 ~13.4MB 且慢于 V8 原生——**负优化**。
- 真正的 wasm 收益在**交付形态**：一份 wasm component 可跑在 wasmtime（服务器/无头）、
  WebView（远期 Web 壳）、嵌入式运行时——这是 C 线远程访问与鸿蒙预研"core 抬到传输
  中立层"的终极版。

## 3.2 wasm 在 mega-version 中的三个正当角色

| 角色 | 内容 | 时机 |
| --- | --- | --- |
| 可移植交付目标 | Rust 内核 cargo 双目标编译出 native + wasm32-wasip2 两种产物；wasm 产物进 wasmtime 无头服务端 | M4（重写完成后追加，边际成本小） |
| 平台 API 契约形式化 | **WIT 接口文件取代 module-system §八 契约表的自然语言描述**——七张契约表中的 action 总线/DMABI/贡献点先落 WIT，compat 校验机器化 | M2 设计期即引入 WIT 作 IDL（先作文档，后作边界） |
| guest 沙箱统一 | 远期 DMABI 与 component model 收敛（spec 已记档"演进方向"）；wasmtime 的 epoch/fuel 中断是 R3（Node 无 fuel）的长期解 | B1 落地后按需评估，不在本命题抢跑 |

## 3.3 生态对照裁决

- **ComponentizeJS/jco**：技术验证有价值（TS 不换语言也能组件化），但性能/体积不利
  → 不作主路径。
- **Extism**：统一插件框架的完成度高（15+ host/7+ PDK），但 B1 已裁决自研薄 ABI 且
  零新依赖——维持不动，其 host/PDK 分层供 guest-sdk 设计参考。
- **Hyperlight-wasm**：实验态 + 微 VM 启动 >120ms，桌面单机过重 → 不采纳。
- **wasmCloud/Spin/Lunatic**：云分发/actor 形态与桌面产品错配 → 不采纳。

---

# Part IV 推荐路径：mega-version 五段排程（M0–M4）

> 排程原则：**每一段独立产生收益、独立可停**；重写（M2）不做大爆炸切换。

| 段 | 内容 | 收益锚点 | 前置 |
| --- | --- | --- | --- |
| **M0 内存止血**（不换语言，下一版即可排） | ① offscreen Chromium 用后即毁/空闲回收（或定时导航回 about:blank 释放页堆）；② routing/memory embedding 共享单例消双份 ~118MB；③ 子进程懒启动 + 空闲退出（codegraph/gitmcp/未用 MCP）；④ 活跃会话 LRU 落盘、prompt 装配复用、streaming 缓冲上界 | 数百 MB 级常驻削减，**性价比碾压一切重写** | 无 |
| **M1 传输中立化**（已规划，共享地基） | C 线 WS 无头服务端（next-version-plan 主线 C）+ 鸿蒙预研"core 抬到传输中立层" | 重写的前置：先把内核与壳的边界从"同进程函数调用"固化成"协议边界" | C-M1 |
| **M2 内核 Rust 化**（mega-version 主体） | 子系统逐个 Rust 化，**napi-rs 桥留在 Electron main**（swc/rolldown 范式）；顺序建议：①子进程/MCP 管理与进程坍缩（收益最大）②权限/路径边界（内存安全）③session loop/消息转换/压缩 ④持久化；memory 管线以 Rust 直写 L0–L3 替代 TDAI 对译；WIT 同步落 IDL | 每子系统合入即兑现内存/稳定性收益；双栈并存期可控 | M0 数据（知道热点在哪）+ M1 边界 |
| **M3 壳替换**（可选终点） | Electron → Tauri：renderer React 资产迁移 + Windows WebView2 回归 + offscreen WebFetch 替代方案专项 | 空闲内存再降 ~60–75%、包体 ~96%、启动 2x | M2 完成（壳下已全是 Rust 桥） |
| **M4 wasm 双目标**（追加层） | cargo 双目标产出 wasm32-wasip2 component；wasmtime 无头端跑同一内核；WIT 契约上机器校验 | 一份内核 = 桌面/无头/远程/（远期）Web 壳 | M2 |

**与既有规划的关系**：M1 = 主线 C（不新增）；M2 的第一块砖 = B1 guest-sdk（Rust 工具
链进仓）；M0 可挂下一版窗口；M2–M4 即"超级大版本"本体（独立于 A/B/C 三主线的新主线，
立项时另立 spec）。**明确不做**：TS→ComponentizeJS 直接 wasm 化（负优化）、Go/Zig
主路径、Hyperlight/wasmCloud/Spin、以及任何"先 wasm 后重写"的排序。

# Part V 风险清单

| # | 风险 | 缓解 |
| --- | --- | --- |
| K1 | 重写陷阱：新内核重写期旧内核仍在演化（漂移双倍成本） | M2 逐子系统替换而非并行重写；每步 napi 桥回归测试（现有 14k 测试是资产，转 Rust 侧契约测试） |
| K2 | 重写不解决设计性驻留（Codex 12GB 反例） | M2 必须连同进程模型改（坍缩子进程/按需模型）；M0 先把热点数据拿到手 |
| K3 | MCP Rust SDK 成熟度落后 TS 官方 SDK（B1 迁移刚落 TS SDK） | M2 顺序把 MCP 管理放第一位但以 stdio 协议直写起步（本仓已有手写 JSON-RPC 经验）；SDK 等价物成熟后切换 |
| K4 | Electron 专属能力（offscreen Chromium）在 Tauri 无等价 | M3 前专项设计（降级静态抓取/独立 headless/复用系统浏览器 CDP）；不解决不启动 M3 |
| K5 | Windows WebView2 一致性（tauri#5889 反例） | M3 真机回归矩阵（本仓 F4 线已有 Windows 真机验证流程） |
| K6 | 单人产能（35–45k 行当量） | 分段独立可停；M0/M1 先兑现收益；M2 优先级按收益/行比排序 |
| K7 | onnxruntime-rust / rusqlite / transformers 等价物接口面差异 | embedding 582 行薄层先行对译验证（最小 spike） |

# Part VI 结论

内存问题的**第一杠杆是 M0 止血与进程模型坍缩**（立即、不换语言、数百 MB 级）；
**第二杠杆才是系统语言重写**（M2，Rust，Codex/swc 双先例，napi 混合期渐进）；
**wasm 化不是性能手段而是交付与契约手段**（M4，重写完成后的 cargo 双目标追加，
WIT 先行作 IDL）。三者按 M0→M1→M2→M3/M4 排程，每段独立可停——这就是"超级大版本
重构"的骨架；本次预研无许可障碍（对标全部宽松），唯一延续红线是 llm_wiki 本体
（GPL-3.0）不可作 Tauri 化的参考代码。
