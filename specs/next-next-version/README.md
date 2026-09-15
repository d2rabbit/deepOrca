# specs/next-next-version — 第三阶段（能力宿主）规划区

> **口径（2026-09-14 立）**：本区承载 **next-next 版本（第三阶段）** 的 spec——**建立在 next-version（A–E 主线）之上**，不与之并行占用资源，亦不改写其任何内容。开工时 `git mv` 回 `specs/<name>/` 转为活跃 spec。
> 上游纲领：[`docs/features/next-next-version-plan.md`](../../docs/features/next-next-version-plan.md)（四平面概念 · 四支柱 · 分期 · 红线）。路线与现状以 [`docs/features/feature-roadmap.md`](../../docs/features/feature-roadmap.md) §0 为准；实现以 `specs/` 为准；调研仅参考。
> 本区引用归档件用 `../archive/<name>/`，引用活跃 spec 用 `../../<name>/`，引用 next-version 项用 `../next-version/<name>/`。

## 一句话定位

**next-version 让 DeepOrca 成为「可被组装的内核」；next-next-version 让 DeepOrca 成为「能力的宿主」。**

把自身所有能力注册成**系统层能力**：每个能力一处声明，在**四个平面**（数据/界面/窗口/系统）同时成立，可被任意窗口、任意系统入口、任意域内节点调用。

## 核心概念

**能力四平面（Capability Four Planes）**——把既有 `defineAction` 的「define once, surface everywhere」（三**数据**面）升维为四平面：

| 平面 | 含义 | 现状 |
| --- | --- | --- |
| P1 数据面 | LLM 工具 / IPC / MCP | ✅ 已有 |
| P2 界面面 | 面板 / 覆盖层 / 检视器 | ❌ 9 处手写 |
| P3 窗口面 | 拥有自己的窗口 | ⚠️ 2 个硬编码特例 |
| P4 系统面 | 托盘 / 全局快捷键 / 通知 / 协议 | ❌ 零 |

**域（Domain）**——能力的可用作用域，三投影同一概念：**工作域**（工作区 root）· **窗口域**（窗口的能力白名单）· **网络域**（链上 space）。**多窗口与真助理 = 域在本地多开；域网链路 = 域跨设备延伸。**

## 四支柱

```
                 支柱一 capability-plane（地基：能力清册 → 四平面编译 + 系统集成层）
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
   支柱二 component-window      支柱三 multi-window-assistant   支柱四 domain-network
   组件窗口宿主（P3）            多窗口与真助理（P4+域）           域网链路协作（网络域）
```

| spec | 一句话 | 平面 | 依赖 |
| --- | --- | --- | --- |
| [capability-plane](./capability-plane/design.md) | 能力清册 + 四平面编译 + 系统集成层（Tray/快捷键/通知/协议/自启）：**一处声明，四平面成立**；消灭今天"加能力手改 4 处" | P1–P4 | 无（地基）；动态化依赖 module-system B1 |
| [component-window](./component-window/design.md) | 组件窗口宿主：把 A2UI popout + arch preview 两套硬编码特例泛化为**统一窗口管理器 + surface 宿主 + per-window API + 窗口订阅模型** | P3 | 支柱一 |
| [multi-window-assistant](./multi-window-assistant/design.md) | 多活工作域（per-root 引擎实例 + 事件流按域路由，消灭"后台域只有冻结快照"）+ 真助理（跨域编排 + 系统唤起）+ 全域任务面 | P4 + 域 | 支柱一、二 |
| [domain-network](./domain-network/design.md) | 域网链路协作：协作链从局域网升级——补**广域发现与寻址 / store-and-forward / 跨域信任治理**三层缺失地基（链路协议本身全复用） | 网络域 | coord-chain 协议核心（`next/coord-chain` 已实现） |

## 分期

| 阶段 | 支柱 | 内容 |
| --- | --- | --- |
| **N1** | 一 | 能力清册 + 四平面编译骨架（先 P1/P2）+ 单能力端到端 |
| **N2** | 二 | 组件窗口宿主（窗口管理器 + surface 宿主 + per-window API + 订阅模型）；两个特例回迁 |
| **N3** | 一+三 | P4 系统面（Tray/快捷键/通知/deep link/自启）+ 多活工作域 |
| **N4** | 三 | 真助理（全域任务编排 + 唤起回流） |
| **N5** | 四 | 域网链路协作（发现/中继复本/跨域治理，分 3 期；**N5.4 硬前置 = coord-chain OC1.5–OC4.5 加固完成**） |

**排序理由**：N1 必须先做（其余支柱都消费它）；N2 先于 N3（多窗口是系统面的前提——托盘唤起到哪、通知点开打开什么，都要窗口宿主先有身份）；N5 完全独立可并行（前置是 coord-chain 协议核心已落地）。

## 与 next-version 的关系（衔接，非替代）

| next-version 项 | 关系 |
| --- | --- |
| **module-system（B1 冷插拔）** | **前置**：B1 的 registry 动态化是能力清册运行期可变的基础；清册是 B1 的**第一方对称面** |
| **C 远程访问（M1–M3）** | **同源**：C-M1 的 `createIpcHelpers()` dispatch 抽取与"能力→IPC 自动生成"同一块地基，**建议合并设计一次做对**；C 的隧道可作域网络一条传输实现 |
| **A 自进化引擎（E1 埋点）** | **受益**：清册把"调用来自哪个平面/哪个域"变成可记录元数据，E1 免费获得更细执行语境 |
| **coord-chain（本阶段王牌）** | **前置**：协议核心/加密传输/建链重放/mDNS 已在 `next/coord-chain` 落地；域网络在其上补三层缺失地基，不动链本身 |
| D 知识编译 / E 语义检索 | **无关**，可并行 |

## 红线（四支柱共同）

1. **core 无 UI 铁律**：UI/窗口/系统字段是数据描述，core 只承载不解释。
2. **P1 数据面零回退**：清册是 `ActionDefinition` 的**可选扩展**（additive-only），现有 ~40 action 不改一行也继续工作。
3. **IPC 安全模型不降级**：三层 tier + 发送方身份策略不变；新增的是"能力→tier"声明映射；`ipc-contract.test.ts` 红线继续有效。
4. **权限沿用既有体系**：沿用 `sideEffects` → `permissions.ts`，不新造第二套特权模型；系统/窗口面入口不得成为权限旁路。
5. **默认安全姿态不变**：`defaultSession` 全拒、导航白名单、`window.open` 拒绝——新增系统面**逐项放开并留审计**。
6. **零静默扩张**：系统面入口（自启/托盘驻留/全局快捷键）**默认关闭**，须用户显式开启。
7. **fail-open 与降级诚实**：四平面任一缺失须降级到下一可用平面并如实呈现。
8. **域边界即安全边界**：窗口域能力白名单、网络域 space 成员边界都是权限边界，不得跨域越权。

## 状态

四 spec 均为 **概念/方案稿（2026-09-14 立，未开工，零代码变更）**。正式实现以各 spec 的 `tasks.md` 为准，且**必须先过 next-version 全线**。
