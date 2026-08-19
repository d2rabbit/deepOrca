# 预研：内核重写后备语言深挖 — MoonBit / 仓颉（Cangjie）

日期：2026-08-19 · 分支：`fix/test-baseline-ui-feedback` · 性质：预研（无代码变更）
命题来源：用户指定——重点调研 **MoonBit** 与**仓颉**作为超级大版本内核重写的后续预选
语言。承接 `docs/research/2026-08-19-kernel-wasm-systems-refactor-prestudy.md`
（下称"主报告"）Part II-4 的语言裁决（当时 Rust vs Go/Zig），本报告把两门国产新语言
放到同一裁决框架下深挖。

## 命题映射

| 模块线 | 对象 | 在本线中的角色 |
| --- | --- | --- |
| 超大版本重构 · 语言选型 | moonbitlang/MoonBit | wasm-first 的 AI-native 通用语言（深圳 IDEA，张宏波团队）——M4 wasm 目标与 guest 模块语言的候选 |
| 超大版本重构 · 语言选型 | 华为 仓颉（Cangjie） | 鸿蒙原生通用语言（2025-06 开源）——鸿蒙 PC 移植触发线的绑定候选 |

## TL;DR

| 对象 | 本质 | 成熟度 / 许可 | 对内核重写的适配 | 结论 |
| --- | --- | --- | --- | --- |
| **MoonBit** | wasm-first 静态类型语言，三后端（wasm-gc / JS / native），定位 AI-native | **0.10 beta，1.0 计划 2026**；stdlib Apache-2.0，**官方工具链仓库 AGPL-3.0（一手核证）** | wasm 双目标 ✓ 一等（体积宣称优于 Rust）；GC 语言（内存叙事弱于 Rust）；native 后端较新、C-FFI 有 breaking 史 | **guest 语言第一候选 + M4 复审候选**，不作 M2 内核语言；上车前置 = 1.0 GA + 运行时许可豁免核验 |
| **仓颉** | 华为全场景通用语言，静态编译机器码，内嵌 AgentDSL | 1.0.x 公测；**Apache-2.0 with Runtime Library Exception（一手核证）** | 鸿蒙/Android/iOS/Win/Linux 产物覆盖 ✓ 但 **Windows 本机不可构建**（Linux 交叉编译）；**未见 wasm 后端**（M4 不成立）；GC + 堆上限可配 | **鸿蒙 PC 移植触发时的绑定复审项**（AgentDSL 对 agent harness 独特契合）；当前不进 M2 |
| （基线）Rust | 主报告已裁决的默认主线 | 生产级；工具链 MIT/Apache | 六轴全绿（无 GC / cargo 双目标 / 生态断层领先） | 维持不变 |

**许可红线（本报告最重要的单条结论）**：

1. **MoonBit 呈"分裂许可"**——标准库 `moonbitlang/core` 为 Apache-2.0（LICENSE 一手
   核证）；但**官方构建工具链仓库 `moonbitlang/moon`（moon 构建器 / moonbuild /
   mooncake 包管理器 / moonrun 运行时）为完整 AGPL-3.0**（LICENSE 一手核证，仓库为
   Rust 多 crate 工程）。这与 MemBrain 先例（README 徽章 ≠ 仓库本体）同类：表面印象
   "MoonBit 开源宽松"不成立。**关键悬置**：wasm/native 产物必然链接其运行时支持库——
   AGPL 仓库若无 Runtime Library Exception（仓颉恰好明确带，MoonBit 未见），编译产物
   可能被波及 AGPL 义务。**采纳前必须官方确认或实测产物合规**；编译器 moonc 的开源
   仓库许可同样待核验。
2. **仓颉明确宽松**——`Cangjie/cangjie_runtime`（GitCode）README 原文"Apache-2.0
   with Runtime Library Exception"：运行时链接豁免是显式的，编译产物无传染之虞。
   本仓 license 门禁（`npm run license:check`）立场上，仓颉干净、MoonBit 有悬置。

---

# Part I MoonBit 深挖

## 1.1 定位与工程事实

- **出身**：深圳 IDEA 研究院（数字经济），张宏波（ReScript 编译器核心、BuckScript
  作者）团队；单一机构驱动。
- **自我定位**："AI-native 通用编程语言"——官方 roadmap 明言面向 AI 时代（语言设计、
  编译器、运行时、IDE 一体化），与 DeepOrca"为 LLM 而生的 harness"有气质共振。
- **三后端**：① **wasm（一等公民）**——wasm-gc 目标，官方宣称产物体积小于 Rust、
  性能与 Rust 相当（TheNewStack 报道复述）；② JS 后端（宣称最高 25x 于原生 JS）；
  ③ native 后端（宣称部分基准 15x 于 Java）。⚠️ 以上性能数字全部为**厂商口径**，
  无第三方复现，采信降级处理。
- **内存模型**：GC 语言——wasm 目标用 Wasm GC（宿主引擎的 GC，产物小）；native 目标
  用自研 GC。**对比 Rust 的"无 GC"优势在此消失**，仅剩"GC 实现更精简"的次级叙事。
- **FFI**：C-FFI 已可用（官方 pearls 指南），但引用计数须由 FFI 侧手工维护
  （文档明言"FFI functions must properly maintain the reference count"），且 FuncRef
  曾发生 breaking 变更——pre-1.0 的接口面仍在动。接 onnxruntime/sqlite 这类大 C 面
  是可行路径但当前有摩擦。
- **并发**：async 模型已有完整设计（LambdaConf 2025 keynote 专题）。

## 1.2 成熟度与治理

- 当前 **0.10**（官方 updates 自述"1.0 前的重要一步"），**beta 态、1.0 计划 2026 年**
  （roadmap + 多方报道一致）。语言/FFI/标准库均有 breaking 史。
- 生态：mooncakes 包注册表起步；核心库 Apache-2.0 可自由使用；MCP/HTTP/TLS 等
  内核所需栈**均无成熟等价物**（对照 Rust 的断层差距）。
- 治理风险：单一机构 + 小团队 = bus factor 与路线图单点；工具链 AGPL 化已是信号
  （对商业化边界的态度）。

## 1.3 对 DeepOrca 的差异化价值（不是"另一个 Rust"）

- **guest 模块语言**（module-system T2）：DMABI 要的正是"小体积 wasm + 能力制"——
  MoonBit 的 wasm-gc 产物体积是其最强卖点，**比 Rust 更适合做第三方模块的首发
  guest 语言**（学习曲线也低于 Rust）。工具链独立于内核仓库，AGPL 风险被
  "guest 自带工具链、宿主只收产物"的边界天然隔离。
- **M4 wasm 内核候选**：若未来内核 wasm 化（主报告 M4），MoonBit 是比 Rust 的
  wasm32-wasip2 更"wasm 原生"的选项（前提：1.0 GA + 许可悬置解决）。

# Part II 仓颉（Cangjie）深挖

## 2.1 定位与工程事实

- **出身**：华为，2025-06-21 HDC 正式发布并开源（运行时、编译器、工具链、测试框架、
  文档）；与 ArkTS 同级地位的鸿蒙原生语言。当前 **1.0.x 公测**（官方文档线 1.0.4）。
- **平台矩阵**（cangjie_runtime README 一手）：产物可跑 **Linux / macOS / Windows /
  OpenHarmony**，静态编译机器码，"同构开发、异构运行"；但 **Windows 环境不可本机构
  建标准库，须在 Linux 交叉编译**（README 明言计划支持，截稿时点未落地）——本仓主
  开发机是 Windows，这是一等公民摩擦。
- **wasm 后端：未见证据**（针对性检索为空；官方叙事是"静态编译至各 OS 机器码"）。
  → 主报告 M4（wasm 双目标）在仓颉线上**不成立**。
- **内存模型**：自动内存管理（GC），但运行时可配堆上限（`cjHeapSize`）——对桌面
  常驻进程是实用的软限额手段；仍非 Rust 式无 GC。
- **语言独特性**：**内嵌 AgentDSL**（官方"原生智能"卖点：自然语言与编程语言有机
  融合的编程框架）+ 轻量级线程并发。前者对 agent harness 是独有契合点——把 LLM 调
  用作为语言级原语而非库调用，与本仓"内核层 LLM 循环"的设计域直接重叠。
- **生态**：cangjie-tpc（三方库组织，Gitee）已有 Web 框架且**功能清单含 MCP**——
  内核最重的生态缺口（MCP 客户端）在仓颉侧反而有社区起步；鸿蒙生产案例真实（力扣
  鸿蒙原生 APP 全量仓颉，官方口径冷启动/功耗收益）。

## 2.2 治理与战略

- 华为背书 + OpenHarmony 体系（openharmony-sig 托管关联编译器/工具仓库）——企业
  持续性优于单一研究院；但开源治理年轻（仓库 2025-06 起），社区规模小，且生态重心
  明显鸿蒙中心。
- **战略契合**：本仓鸿蒙 PC 移植预研（`2026-08-18-harmonyos-pc-electron-port-
  feasibility.md`，结论"先不做"，远程访问 C 线是其替代路线第一步）——**若鸿蒙线
  未来重启，仓颉的平台绑定价值瞬间从减分变加分**（Electron on OH 基本无解，仓颉
  native 是正解）。这是把仓颉留在预选池的核心理由。

# Part III 六轴裁决表（含 Rust 基线）

| 轴 | Rust（基线） | MoonBit | 仓颉 |
| --- | --- | --- | --- |
| ① 内存模型（主报告痛点） | 无 GC ✅ | GC（wasm-gc/自研）⚠️ | GC + cjHeapSize 软上限 ⚠️ |
| ② wasm 双目标（M4） | cargo 双目标 ✅ | **一等公民，体积最优** ✅✅ | **未见 wasm 后端** ❌ |
| ③ 桌面三平台 + FFI | 全一等 + bindgen 成熟 ✅ | native 较新；C-FFI 可用但有 breaking 史 ⚠️ | 产物覆盖 ✓；**Windows 本机构建 ✗** ⚠️ |
| ④ 生态（MCP/HTTP/TLS/onnx/sqlite） | 断层领先 ✅ | mooncakes 起步 ❌ | tpc 有 MCP 起步 ⚠️；鸿蒙中心 |
| ⑤ 成熟度 / 治理 | 生产级 / 基金会+巨头 ✅ | 0.10 beta，1.0@2026，单机构 ⚠️ | 1.0.x 公测，华为背书，治理年轻 ⚠️ |
| ⑥ 许可（本仓门禁立场） | MIT/Apache ✅ | stdlib Apache-2.0 但**工具链 AGPL-3.0 + 运行时豁免悬置** ❌ | **Apache-2.0 with Runtime Library Exception** ✅ |
| ⑦ 战略契合 | Codex/swc 双先例 | wasm-first ↔ M4；小体积 ↔ guest 模块 | 鸿蒙绑定 ↔ 移植触发线；AgentDSL ↔ harness |

# Part IV 裁决与上车点

1. **内核 M2 主语言维持 Rust，两门预选均不改变现排程**（M0 止血 → M1 传输中立 →
   M2 Rust 化）。理由：两门语言在轴①⑤（GC + 未 GA）上都不满足"现在就重写 24k 行
   内核"的门槛；MoonBit 另有许可悬置。
2. **MoonBit 的正确上车点是 guest 侧而非内核侧**：module-system T2 模块的 guest 语言
   候选（B1 的 guest-sdk Rust 之外的第二官方路径）——小体积 wasm 正中 DMABI 需求、
   学习曲线低于 Rust、AGPL 工具链被"guest 自带工具链、宿主只收产物"边界隔离。
   **前置门槛**：① 1.0 GA；② 官方书面确认编译产物无 AGPL 波及（或运行时库出链接
   豁免）；③ FFI/接口面稳定承诺。
3. **仓颉的 correct 触发点是鸿蒙线**：列为鸿蒙 PC 移植重启时的**绑定复审项**——届时
   仓颉 native + AgentDSL + Apache-2.0-with-exception 三项叠加价值凸显，可评估
   "鸿蒙端口直接以仓颉重写内核"而非移植 Electron 壳。**前置门槛**：① Windows 本机
   构建落地；② wasm 后端出现（若 M4 仍有效）；③ tpc 生态长出 HTTP/TLS/onnx 绑定。
4. **复审时点**：MoonBit 1.0 发布日 / M2 启动日 / 鸿蒙线重启日——三个事件各自触发
   本报告 §Part III 表的重新打分，避免"预研一次定终身"。

# Part V 风险清单

| # | 风险 | 缓解 |
| --- | --- | --- |
| L1 | MoonBit 运行时库 AGPL 波及编译产物（悬置未解） | 上车前官方确认/实测；在此之前仅限 guest 侧试点（边界隔离） |
| L2 | 两门语言 pre-GA 的接口 churn（MoonBit FuncRef 先例） | gate 卡 1.0/GA；不进内核主干 |
| L3 | 单一机构依赖（IDEA / 华为路线图单点） | 保持 Rust 主线，预选仅作备份与专项触发 |
| L4 | 仓颉 Windows 工具链二等（交叉编译） | 触发复审时先验证本机开发闭环（本仓主力 Windows） |
| L5 | 厂商性能口径无第三方复现 | 一切性能数字按宣称处理，决策不建立在未复现数字上 |

# Part VI 结论

两门语言都**不撼动 Rust 的 M2 主线地位**（GC + 未 GA + 生态差一个数量级），但各自
持有一张 Rust 没有的牌：**MoonBit 的牌是 wasm 体积与 guest 契合**（正确的上车点是
module-system 的 guest 语言，上车前必须解掉 AGPL 运行时悬置）；**仓颉的牌是鸿蒙
native 绑定 + AgentDSL + 干净的 Apache-2.0-with-exception**（正确的上车点是鸿蒙
移植触发线）。两者按"事件触发复审"管理，与主报告的 M0→M1→M2 排程零冲突。
