# 第三阶段规划：能力宿主 —— 系统集成层 · 能力四平面 · 域网络

> 日期：2026-09-14 · 状态：**规划中（`next-next/*` 版本路线，概念级纲领，本文不排当前版本，亦不排 next-version 期）**
> 来源：会话方向确立（真系统集成层 / 组件方式集成 / 组件窗口 / 多窗口与真助理 / 全域任务 / 协作链升级域网链路）。
> 依据口径：路线与现状以 [`docs/features/feature-roadmap.md`](./feature-roadmap.md) §0 为准；正式实现以 `specs/` 为准；调研仅参考。
> 前置：本规划**建立在 `next-version`（A–E 主线）之上**——能力清册的动态化以 module-system B1 为前置，域网络以 coord-chain 协议核心为前置。关系见 §5。

---

## 0. 版本定位

**next-version 让 DeepOrca 成为「可被组装的内核」；next-next-version 让 DeepOrca 成为「能力的宿主」。**

一句话：**把自身所有能力注册成系统层能力**——每个能力不再是"应用里的一个功能"，而是系统里的一等公民：一处声明，在**四个平面**（数据/界面/窗口/系统）同时成立，可被任意窗口、任意系统入口、任意域内节点调用。

| | 现状 | next-next 目标 |
| --- | --- | --- |
| 能力形态 | `defineAction` 已是真总线（~40 action），但**只有数据面**（LLM tool / IPC / MCP） | **四平面**：数据面 + 界面面 + 窗口面 + 系统面 |
| 加一个能力的成本 | **手改 4 处**：`shared/ipc.ts`（key+type）· `main/index.ts`（handler+tier）· `preload/index.ts`（扁平方法）· 实现模块 | **1 处**：能力清册一行（desktop 侧 `defineCapability`） |
| 界面归属 | 9 处按 action id 手写的 React 面板；`use-panel-layout.ts:5-17` 硬编码 union | 界面由能力**声明**，宿主按声明装载（组件注册表） |
| 窗口 | 单主窗口 + 2 个硬编码子窗口（prototype popout / arch preview），无窗口管理抽象 | **窗口管理器**：统一注册表 + 声明式窗口 spec + 组件窗口宿主 |
| OS 集成 | **零**（无 Tray / globalShortcut / Notification / deep link / 自启） | 系统面：托盘驻留 + 全局唤起 + 系统通知 + 协议入口 |
| 并行任务 | 单活跃引擎实例；后台 root **无事件流**（`App.tsx:997-999` 自陈只存冻结快照） | 多活工作区 + 事件流按 root 路由（真·全域并行） |
| 协作边界 | 局域网单层广播域、地址直连、成员常在线、数据不出局域网 | **域网络**：跨网段发现/寻址 + store-and-forward + 跨域信任治理 |

---

## 1. 核心概念：能力四平面（Capability Four Planes）

本仓既有概念是 `defineAction` 的「**define once, surface everywhere**」——一处声明带来三个**数据面**（LLM tool / IPC / MCP，见 `packages/core/src/actions/types.ts:1-16`）。next-next 把这个概念**升维**：一个能力的存在方式不止是"可被调用"，而是"在系统里占有一席之地"。

| 平面 | 含义 | 现状 | 载体 |
| --- | --- | --- | --- |
| **P1 数据面** | 可被谁调用：LLM 工具 / IPC 通道 / MCP 工具 | ✅ 已有（三表面） | `ActionRegistry.toToolDefinitions()` + `action-ipc.ts` |
| **P2 界面面** | 在哪显示：面板 / 覆盖层 / 检视器 | ❌ 无（9 处手写） | **组件注册表**（新） |
| **P3 窗口面** | 能否拥有自己的窗口：单例/多开、尺寸、父子、preload | ⚠️ 有两个硬编码特例 | **组件窗口宿主**（新，从 prototype popout 泛化） |
| **P4 系统面** | 能否被系统唤起：托盘项 / 全局快捷键 / 通知 / 协议路由 | ❌ 零 | **系统集成层**（新） |

**一处声明，四平面自动成立。** 新增能力的边际成本从 O(4 处手改) 降到 O(1 行声明)——与 core 侧 `defineAction` 同构，这正是 desktop 侧缺失的那半。

> **为什么现在才做**：P1 已是真实现（两个 adapter 让 seam 成立），P2/P3 的种子已在（A2UI popout 全套机器、浮动岛视觉语言），P4 是纯空白。四平面共用同一份元数据（id / description / parameters / sideEffects / category），没有它就必须先写四遍——这正是今天手改 4 处的根因。

## 2. 核心概念：域（Domain）

**域 = 能力的可用作用域**，也是 next-next 的统一 scope 维度：

```
能力 × 域 = 该能力在该作用域内可用
```

三种域的投影，同一个概念：

| 域类型 | 含义 | 载体 |
| --- | --- | --- |
| **工作域** | 一个打开的工作区（root） | 多活工作区实例（现状：单活跃，后台无事件流） |
| **窗口域** | 一个组件窗口持有的能力子集 | 窗口级能力白名单 |
| **网络域** | 链上一个空间（space）——跨设备的同一协作边界 | coord-chain `space.charter`（v7 设计，未实现） |

**域是 next-next 的统一点**：多窗口与真助理是"域在本地多开"，域网链路是"域跨设备延伸"。同一份能力清册，在不同域里按声明生效。

## 3. 四支柱与依赖关系

```
                    ┌─────────────────────────────────────┐
                    │  支柱一 capability-plane（地基）      │
                    │  能力清册：一处声明 → 四平面编译        │
                    └──────────────┬──────────────────────┘
                                   │ 被依赖
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
┌───────────────┐        ┌──────────────────┐      ┌──────────────────┐
│ 支柱二         │        │ 支柱三            │      │ 支柱四            │
│ component-    │        │ multi-window-     │      │ domain-network   │
│ window        │◄───────┤ assistant         │      │ 域网链路协作       │
│ 组件窗口宿主    │  被调用  │ 多窗口与真助理      │      │ （协作链升级）      │
└───────────────┘        └──────────────────┘      └──────────────────┘
   P3 平面落地              域在本地多开 + P4 系统面      域跨设备延伸
```

| 支柱 | 一句话 | 对应平面 | 依赖 |
| --- | --- | --- | --- |
| 一 · [capability-plane](../../specs/next-next-version/capability-plane/design.md) | 能力清册 + 四平面编译：一处声明，四平面成立 | P1–P4 元数据 | 无（地基）；动态化依赖 module-system B1 |
| 二 · [component-window](../../specs/next-next-version/component-window/design.md) | 组件窗口宿主：把 prototype popout 泛化为通用 surface 宿主 | P3 | 支柱一 |
| 三 · [multi-window-assistant](../../specs/next-next-version/multi-window-assistant/design.md) | 多活工作区 + OS 集成层 + 真助理 | P4 + 域 | 支柱一、二 |
| 四 · [domain-network](../../specs/next-next-version/domain-network/design.md) | 域网链路协作：跨网段发现/寻址 + store-and-forward + 跨域治理 | 网络域 | coord-chain 协议核心 |

**为什么是四支柱而不是一个大 spec**：地基（支柱一）必须先成立，否则支柱二/三会各自重复造注册机制（今天的 4 处手改就是这么来的）；支柱四与前三个**可完全并行**（不同代码域、不同依赖），但在概念上共享"域"——链上空间是域的网络投影，支柱三的窗口域能力白名单在跨设备时要有同一套语义。

## 4. 分期

| 阶段 | 支柱 | 内容 | 体量 |
| --- | --- | --- | --- |
| **N1** | 一 | 能力清册（`CapabilityManifest` 元数据扩展 + desktop 侧 `defineCapability` + 四平面编译器骨架，先只编译 P1/P2） | 中 |
| **N2** | 二 | 组件窗口宿主（窗口管理器抽象 + surface host + per-window API + 窗口订阅模型）；A2UI popout 与 arch preview 两个特例回迁 | 中大 |
| **N3** | 一+三 | P4 系统面（Tray / globalShortcut / Notification / deep link / 自启）+ 多活工作区（per-root 引擎实例 + 事件流路由） | 大 |
| **N4** | 三 | 真助理（全域任务编排：助理跨域发起、通知回流、唤起入口） | 中大 |
| **N5** | 四 | 域网链路协作（跨网段发现/寻址 + store-and-forward + space 治理，分 3 期） | 超大 |

**关键排序理由**：N1 是唯一必须先做的（其余三支柱都消费它）；N2 先于 N3，因为多窗口是系统面的**前提**（托盘唤起要唤起到哪、通知点开要打开什么，都需要窗口宿主先有身份）；N5 完全独立，可与 N1–N4 任意阶段并行启动（前置是 coord-chain 协议核心已在 `next/coord-chain` 落地）。

## 5. 与 next-version 的关系（衔接，非替代）

| next-version 项 | 与 next-next 的关系 |
| --- | --- |
| **module-system（B1 冷插拔）** | **前置**。B1 的 registry 动态化（`registerContributed`/`unregisterOwner`/`onChanged`）是能力清册运行期可变的基础；能力清册是 B1 的**第一方对称面**——B1 让第三方模块能注册能力，清册让自有能力有同等的声明力 |
| **C 远程访问（M1–M3）** | **同源**。C-M1 的 `createIpcHelpers()` dispatch 表抽取与"能力→IPC 自动生成"是同一块地基；**建议合并设计一次做对**（否则 dispatch 表要抽两次）。C 的隧道可作域网络的一条传输实现 |
| **A 自进化引擎（E1 埋点）** | **受益**。E1 在 `registry.execute` 单点埋点；能力清册把"调用来自哪个平面/哪个域"变成可记录元数据，E1 免费获得更细的执行语境 |
| **D 知识编译 / E 语义检索** | **无关**，可并行 |
| **coord-chain（本阶段王牌）** | **前置**。协议核心/加密传输/建链重放/mDNS 已在 `next/coord-chain` 落地；域网络是在其上补三层缺失地基（§见支柱四），不动链本身 |

**口径**：next-next 不改写 next-version 任何主线内容；两者共享地基但不共享 spec。开工顺序上 next-version 全线优先。

## 6. 红线（四支柱共同约束）

1. **core 保持无 UI 铁律**：能力清册的 UI/窗口/系统字段是**数据描述**，core 只承载不解释；desktop 解释并物化。core 永不 import react/electron。
2. **P1 数据面语义零回退**：清册是 `ActionDefinition` 的**可选扩展**，现有 ~40 action 不改一行也必须继续工作（additive-only）。
3. **IPC 安全模型不降级**：三层授权（handle / handlePrivileged / handleShared）与发送方身份策略保持不变；新增的是"能力→tier"的**声明映射**，不是放宽。`ipc-contract.test.ts` 的"禁止裸 `ipcMain.handle`"红线继续有效。
4. **权限沿用既有体系**：能力沿用 `sideEffects` → `permissions.ts` 网关，不新造第二套特权模型；窗口/系统面的新入口（托盘/快捷键/协议）必须是**能力声明的结果**，不能成为绕过权限的旁路。
5. **默认安全姿态不变**：`defaultSession` 全拒策略、导航白名单、`window.open` 拒绝——新增系统面时**显式逐项放开并留审计**，不得整体放行。
6. **零静默扩张**：任何系统面入口（自启、托盘驻留、全局快捷键）默认关闭，须用户显式开启。
7. **fail-open 与降级诚实**：四平面任一缺失（无托盘权限的平台、无窗口宿主的场景）必须降级到下一可用平面并如实呈现，不静默失效。
8. **域边界即安全边界**：窗口域的能力白名单、网络域的 space 成员边界，都是权限边界，不得跨域越权调用。

## 7. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 四平面元数据过度设计，反而比手写更重 | N1 只做 P1/P2 编译，P3/P4 骨架留空；用一个真实能力（如 `review.full`）端到端打通再推广 |
| 能力清册与 module-system B1 的贡献注册表概念重叠 | 明确分工：B1 管**第三方模块**（wasm 沙箱 + 信任分层 + 发行版），清册管**第一方能力**的系统化；两者共用 registry 的 `registerContributed` 入口，清册是其第一方调用方 |
| 多活工作区引发资源爆炸（N 个引擎实例） | 域的生命周期绑定窗口/root；非活跃域降级为冻结态（复用现有 PiP 快照语义）；设活跃域上限并显式提示 |
| OS 集成面的跨平台差异（Linux 托盘/快捷键） | 按"能力降级"处理——平台不支持的系统面降级到下一平面（窗口面/界面面），并在能力清单 UI 上如实标注 |
| 域网络语义与 coord-chain v7 的 space 概念分叉 | 以 v7 `space.charter`/`space.link`/epoch/replica 为唯一权威，支柱四只补**传输与可用性**两层，不重定义 space 语义 |
| 概念级纲领落地时被当作实现依据 | 本文与四 spec 均为**概念/方案稿**，无代码变更；正式实现以各支柱 spec 的 tasks 为准，且必须先过 next-version 全线 |

## 8. 明确不做（本规划边界）

- 不做公链 / 代币 / 跨互联网广播（域网络止于"域"的组织边界，非公网广播）。
- 不做多人字符级协同编辑（沿用 coord-chain 既有非目标）。
- 不替换或改写 next-version 任何主线（module-system / 远程访问 / 自进化 / 知识编译 / 语义检索）。
- 不引入第二套权限模型、第二套注册中心、第二套 UI 协议（复用 `sideEffects` + `ActionRegistry` + A2UI）。
- 不做移动端 / 鸿蒙端（`android-dev-kit`、`harmonyos-dev-kit` 各自独立排期）。
- 不为"四平面齐全"而强行给每个能力造窗口/托盘项——**声明是可选的**，缺省即不占位。
