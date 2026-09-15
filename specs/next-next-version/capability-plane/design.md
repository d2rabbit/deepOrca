# 能力四平面：系统集成层与能力清册（capability-plane）· 技术设计

> **状态**：**概念/方案稿（只出方案，不改代码）** · **日期**：2026-09-14 · 分支 `feat/modern-ui-redesign` · **next-next 规划区首项（地基支柱）**。
> **上游纲领**：[`docs/features/next-next-version-plan.md`](../../../docs/features/next-next-version-plan.md)（四平面概念 · §1/§2/§6 红线）。
> **用户定调**：**本质上就是我们将自身所有的能力全部注册成系统层能力，这是概念级别的设计。**本 spec 是该定调的地基实现面：能力清册 + 四平面编译。
> **对应实现域**：`packages/core/src/actions/`（`ActionDefinition` 可选扩展，additive-only）+ `packages/desktop/src/main/`（能力清册与四平面编译器）+ `packages/desktop/src/shared/`（生成的契约面）。**core 保持无 UI 铁律**：UI/窗口/系统字段是数据描述，core 只承载不解释。

---

## §0 执行摘要

本仓 core 侧已有 `defineAction`——**一处声明，三个数据面**（LLM tool / IPC / MCP，`actions/types.ts:1-16`）。**desktop 侧没有任何等价物**：新增一个能力要手改 4 处（`shared/ipc.ts` key+type → `main/index.ts` handler+tier → `preload/index.ts` 扁平方法 → 实现模块），且 `ActionDefinition`（`types.ts:51-59`）只有 `id/description/category/parameters/sideEffects/_input`，**没有任何 UI / 窗口 / 系统字段**——action 无法声明"我要一个窗口"或"我要一个托盘项"。

本 spec 补上这半：**能力清册（Capability Manifest）**——一处声明，四个平面同时成立：

| 平面 | 由谁物化 | 本 spec 范围 |
| --- | --- | --- |
| **P1 数据面** | `ActionRegistry`（既有）+ IPC 自动生成（新） | ✅ 编译（含 IPC/preload 自动生成） |
| **P2 界面面** | 组件注册表（新） | ✅ 编译，**装载器归支柱二** |
| **P3 窗口面** | 组件窗口宿主 | ✅ 编译（元数据），**宿主归支柱二** |
| **P4 系统面** | 系统集成层（Tray/快捷键/通知/协议） | ✅ 编译 + 系统面**注册表与宿主**（本 spec 含最小可用集） |

**关键设计**：清册是 `ActionDefinition` 的**可选扩展**（`surfaces?` 字段），现有 ~40 action 零改动即继续工作；desktop 侧新增 `defineCapability` 与编译器，把一处声明展开为 IPC 通道 + preload 方法 + 界面槽位 + 窗口 spec + 系统面项。

## §1 能力清册（Capability Manifest）

### 1.1 声明形态

在 `ActionDefinition` 上增加**可选**的 `surfaces` 字段（additive-only，core 侧仅类型承载，不解释语义）：

```ts
// core: actions/types.ts —— 可选扩展，全部字段 optional
export interface ActionSurfaces {
  /** P2 界面面：能力的面板/覆盖层装载声明 */
  readonly panels?: ReadonlyArray<{
    readonly slot: string;            // 槽位 id（宿主约定，如 "rail.view" / "workspace.tab" / "overlay"）
    readonly component: string;       // 组件注册表键（desktop 解析，core 只传递字符串）
    readonly title?: string;          // i18n 键（6 locale 义务不变）
    readonly icon?: string;           // ui/icons 分类模块名
    readonly order?: number;
  }>;
  /** P3 窗口面：能力可否拥有自己的窗口 */
  readonly windows?: ReadonlyArray<{
    readonly spec: string;            // 窗口 spec 键（支柱二解析）
    readonly singleton?: boolean;     // 单例语义（同 arch preview 先例）
    readonly placement?: "center" | "cascade" | "follow-parent";
    readonly parent?: "main" | "owner-window";
    readonly partition?: string;      // 独立 session partition（默认隔离）
  }>;
  /** P4 系统面：能力可否被系统唤起 */
  readonly system?: {
    readonly tray?: { readonly titleKey: string; readonly icon?: string };
    readonly shortcuts?: ReadonlyArray<{ readonly accelerator: string; readonly scope: "global" | "app" }>;
    readonly notifications?: boolean;  // 该能力可发系统通知
    readonly protocol?: ReadonlyArray<string>;  // 协议路由 prefix，如 "deeporca://review/"
  };
  /** 承载该能力的域类型（§2）：默认 ["workspace"] */
  readonly domains?: ReadonlyArray<"workspace" | "window" | "network">;
}
```

**三平面不冲突原则**：`surfaces` 缺省 = 该能力只占 P1 数据面（今天的全部 action 即此形态）。

### 1.2 desktop 侧 `defineCapability`

core 侧 `defineAction` 管"能力可被调用"，desktop 侧 `defineCapability` 管"能力如何存在"：

```ts
// desktop/main: 能力清册单写者
defineCapability({
  actionId: "review.full",              // 指向既有 action（P1 面复用）
  surfaces: { panels: [...], windows: [...], system: {...} },
  // 以下为 desktop 侧新增的编译期契约
  ipc: { tier: "privileged" },          // 显式声明授权层级（不再手写 handler）
  permission: { inheritFromAction: true } // 沿用 action 的 sideEffects，不新造特权模型
});
```

**单写者原则**：清册由 desktop 一处装配（`main/capability/registry.ts`），是"能力→桌面表现"的唯一事实源；`shared/ipc.ts` 的通道常量与 `preload` 方法由清册**生成**（构建期或 boot 期），不再手写。

## §2 四平面编译

```
能力清册（一处声明）
   ├─ P1 数据面：registry 既有三表面 + IPC handler（按 tier 自动注册）+ preload 方法（自动生成）
   ├─ P2 界面面：槽位表（slot → component[]）交给 renderer 组件注册表装载
   ├─ P3 窗口面：窗口 spec 表交给组件窗口宿主（支柱二）
   └─ P4 系统面：托盘项 / 快捷键 / 通知 / 协议路由 交给系统集成层注册
```

- **P1 编译**：`ipc: { tier }` → 在既有 `handle` / `handlePrivileged` / `handleShared` 三层上注册 handler，委托 `registry.execute(actionId, input)`；**不新增裸 `ipcMain.handle`**（`ipc-contract.test.ts` 红线继续有效）。preload 方法由清册生成，**消灭"扁平单例手写"**。
- **P2 编译**：产出 `slot → component[]` 表；renderer 侧新增**组件注册表**（`registerComponent(key, ReactComponent)`），槽位渲染器按表装载。这是 `use-panel-layout.ts:5-17` 硬编码 union 数据化的正解。
- **P3 编译**：产出窗口 spec 表（元数据），**本 spec 只编译不宿主**——宿主是支柱二。
- **P4 编译**：本 spec 含**最小可用系统面宿主**（§3），因为它是"系统层能力"这句话的落点。

## §3 系统集成层（P4，OS 面从零建设）

现状（2026-09-14 取证）：**Tray / globalShortcut / Notification / deep link protocol / file association / auto-launch 全部为零**；仅 `app.dock.setIcon`、单实例锁、`shell.openExternal` 已用。`defaultSession.setPermissionRequestHandler` **全拒**（`index.ts:2655-2658`），含 notifications——做通知前必须显式放开该单项。

| 面 | 落地要点 | 默认姿态 |
| --- | --- | --- |
| **Tray** | 托盘图标 + 菜单（由清册 `system.tray` 生成）+ 点击唤起主窗口/指定域 | **默认关**（用户显式开启才驻留） |
| **globalShortcut** | 全局唤起快捷键（注册表条数上限 + 冲突检测；`app.whenReady` 后注册，`will-quit` 注销） | 默认关，逐条用户开启 |
| **Notification** | 系统通知（能力发通知须声明 `notifications: true`；点击→路由到能力的窗口/槽位） | 仅声明的能力可用；须放开 `defaultSession` 的 notification 单项 |
| **协议入口（deep link）** | `setAsDefaultProtocolClient` + `open-url`（macOS）/ `second-instance` argv（Win/Linux）→ 路由到能力（清册 `protocol` 前缀最长匹配） | 默认关 |
| **自启** | `setLoginItemSettings` | 默认关，仅托盘开启时可建议 |
| **角标/进度** | `setBadgeCount` / `setProgressBar`（能力进度面） | 可用，随能力进度 |

**安全**：所有系统面入口的路由目标是**清册里的能力**，因此天然经过 P1 的 tier 与既有 `sideEffects` 权限网关——系统面不构成权限旁路（红线 4）。协议 URL 必须走与 `will-navigate` 同级的白名单校验（红线 5）。

## §4 与 module-system B1 的关系

| | module-system B1（第三方模块） | capability-plane（本 spec，第一方能力） |
| --- | --- | --- |
| 服务对象 | 第三方 wasm 模块 / 发行版 | DeepOrca 自有 ~40 action |
| 关注点 | 信任分层、沙箱、动态插拔、发行版清单 | 一处声明四平面、消灭手改 4 处、OS 集成 |
| 共用入口 | `registerContributed` / `unregisterOwner` / `onChanged` | 清册是这些入口的**第一方调用方** |

**分工声明**：本 spec 不重定义模块系统；B1 落地后，清册的注册动作**改为走 B1 的动态接口**（届时 `registerContributed` 不仅是第三方入口，也是第一方入口）。在 B1 之前，清册以静态装配起步——与 next-version-plan §主线A 对 `docwiki.*` 的处置口径一致（"按静态 defineAction 注册起步，B1 后免费获益"）。

## §5 分期

| 批次 | 内容 | 验收 |
| --- | --- | --- |
| **N1.1** | `ActionSurfaces` 类型（core，可选字段）+ 清册骨架（desktop 单写者）+ 1 个真实能力端到端（建议 `review.full`：面板 + 窗口 + 通知） | 现有 ~40 action 零改动通过全部既有测试（additive 证明）；`review.full` 四平面中 P1/P2/P4 可用 |
| **N1.2** | P1 编译完整化：IPC handler 自动注册（按 tier）+ preload 方法自动生成；三处手写迁移 | 新增一个能力**只改清册一行**；`ipc-contract.test.ts` 全绿；preload 手写行数下降 |
| **N1.3** | P2 编译：槽位表 + renderer 组件注册表；`use-panel-layout.ts` 硬编码 union 数据化 | rail 视图由清册驱动；既有 12 个视图行为等价 |
| **N1.4** | P4 最小系统面：Tray + globalShortcut + Notification（含 `defaultSession` 单项放开 + 审计）；协议/自启仅编译不启用 | 托盘可唤起指定域；快捷键冲突检测生效；通知点击路由到能力窗口；**全部默认关** |
| **N1.5** | 与 B1 对接（B1 落地后）：清册注册改走动态接口 | 运行期加/卸能力无需重启 |

## §6 风险与对策

| 风险 | 对策 |
| --- | --- |
| 元数据膨胀，清册比手写更重 | 全部字段 optional；用一个真实能力打通再推广（N1.1）；不追求"每个能力四平面齐全" |
| 生成式 preload/IPC 破坏既有安全契约 | 生成器**只能产出三层 tier 内的注册**，不得直出 `ipcMain.handle`；契约测试作为门禁 |
| 系统面引入新攻击面（协议 URL 注入） | 协议路由走白名单 + 最长前缀匹配 + 参数校验；与 `will-navigate` 同级校验 |
| `defaultSession` 全拒策略误放开 | 逐项放开 + 审计日志；禁止整体放行（红线 5） |
| 与 B1 概念重叠 | 分工声明（§4）；B1 前静态、B1 后动态，同一入口 |
| renderer 组件注册表与既有按 id 手写的 9 处消费者冲突 | 迁移是**渐进**的：清册驱动的槽位与既有手写面板长期共存，逐个迁移，不搞大爆炸 |

## §7 明确不做

不重定义模块系统（归 module-system）；不做窗口宿主与表面装载器（归支柱二）；不做多活工作区与真助理编排（归支柱三）；不做域网传输（归支柱四）；不新增第二套权限模型（沿用 `sideEffects`）；不替换 A2UI 协议；不改 `ActionRegistry` 的四方法深接口（只加可选字段与生成器）。
