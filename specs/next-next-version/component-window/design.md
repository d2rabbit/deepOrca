# 组件窗口宿主（component-window）· 技术设计

> **状态**：**概念/方案稿（只出方案，不改代码）** · **日期**：2026-09-14 · 分支 `feat/modern-ui-redesign` · **next-next 规划区支柱二（P3 平面落地）**。
> **上游纲领**：[`docs/features/next-next-version-plan.md`](../../../docs/features/next-next-version-plan.md)（§1 P3 平面 · §2 域 · §3 依赖图）。
> **用户定调**：**以组件的方式集成到系统，然后调用我们的组件窗口。**本 spec 是"组件窗口"这一层的实现面。
> **对应实现域**：`packages/desktop/src/main/`（窗口管理器 + surface 宿主）+ `packages/desktop/src/renderer/`（组件注册表装载 + per-window API）+ `packages/desktop/src/preload/`（通用窗口 preload）。**依赖支柱一**（能力清册的 P3 元数据）；不依赖支柱三/四。

---

## §0 执行摘要

"多窗口"作为**模式**在本仓已跑通——但只有两个**硬编码特例**，各写各的 `Map<string, BrowserWindow>`：

| 特例 | 位置 | 已有的能力 |
| --- | --- | --- |
| Prototype popout（A2UI 全屏预览） | `index.ts:2130-2195` | 独立小 preload（`prototype.cjs`，`sandbox:true`）、token **pull 式载荷握手**（防 race）、surfaceId 作用域订阅、双向回流、窗口追踪 Map |
| Arch preview（架构图 HTML） | `knowledge-ipc.ts:36-483` | **单例语义**（已开则 restore+focus）、`parent` 父子 z-order 跟随、**move-follow**（主窗移动保持偏移）、独立 `partition`、权限请求全拒、导航锁死、主窗关闭级联 |

**这两套合起来已解决多窗口最难的部分**，缺的只是把它**泛化成通用宿主机**：统一窗口注册表 + 声明式窗口 spec（来自能力清册）+ per-window API + 窗口订阅模型。

同时暴露了当前最真实的痛点：`emit()` 全窗口广播 vs `emitToMain()` 定向，**靠"哪些通道能广播"手工判断**（`index.ts:616-641`），没有窗口订阅模型。

## §1 窗口管理器（统一抽象）

### 1.1 窗口注册表

取代两个分散的 `Map`：

```ts
interface WindowEntry {
  readonly id: string;                    // 稳定窗口 id（非 webContents.id）
  readonly kind: string;                  // 窗口 spec 键（来自能力清册 P3 元数据）
  readonly ownerCapability?: string;      // 拥有它的能力 actionId（可空 = 系统窗口）
  readonly ownerRoot?: string;            // 归属工作域（§2 域）
  readonly ownerSession?: string;         // 归属会话（沙箱与权限上下文）
  readonly browserWindow: BrowserWindow;
  readonly singleton: boolean;
  readonly createdAt: number;
}
```

**关键**：`ownerRoot` / `ownerSession` 是**域绑定**——窗口不是漂浮的，它属于一个域；域的生命周期（工作区关闭、会话结束）驱动窗口级联（复用 arch preview 的 `closeAllArchPreviewWindows()` 级联先例，`knowledge-ipc.ts:37-43`）。

### 1.2 声明式窗口 spec

窗口形态由**能力清册**声明（支柱一 `surfaces.windows`），宿主编译：

| spec 字段 | 语义 | 复用先例 |
| --- | --- | --- |
| `singleton` | 同 spec 已开则 restore+focus，不新建 | arch preview `knowledge-ipc.ts:393-399` |
| `placement` | `center` / `cascade`（主窗旁偏移 40px）/ `follow-parent` | arch preview `:403-420` |
| `parent` | `main`（z-order 跟随 + 一起最小化） / `owner-window` | arch preview `:403` |
| `partition` | 独立 session partition（**默认隔离**） | arch preview `:428` / prototype popout `sandbox:true` |
| `frame` / 尺寸 | 默认 `frame:false`（与主窗一致） | 主窗 `index.ts:713` |
| 权限策略 | **默认全拒**（`setPermissionRequestHandler(() => false)`） | arch preview `:453-456` |
| 导航策略 | 白名单锁死（继承主窗 `will-navigate` 纪律） | `index.ts:737-746` |

### 1.3 窗口生命周期 API

现状只有 `WindowClose` 一个通道（`shared/ipc.ts:36-38`）。补齐：`WindowList` / `WindowFocus` / `WindowState`（几何）/ `WindowMove` / `WindowResize` / `WindowSetTitle`——**全部按 §1.2 的域绑定做权限校验**（窗口只能操作自己域内的窗口）。

## §2 域（本地投影）

本 spec 落地纲领 §2 的**本地域投影**（网络域投影归支柱四）：

```
工作域（workspace root）
   └─ 窗口域（组件窗口）  ← 携带能力白名单
        └─ 会话域（可选，窗口持有某个会话）
```

- **窗口域能力白名单**：每个窗口 spec 声明它能调用哪些能力（P1 面）。窗口 preload 只暴露其白名单内的 API——比今天"prototype 窗口共享 `handleShared` 通道"更细。这是纲领红线 8（域边界即安全边界）的本地落地。
- **域生命周期**：工作域关闭 → 级联关窗口；会话结束 → 关其会话域窗口。非活跃域降级为冻结态（复用 PiP 快照语义，支柱三深化）。

## §3 组件窗口宿主（"调用我们的组件窗口"）

### 3.1 Surface 宿主

窗口的**内容**由 surface 声明驱动（复用 A2UI 已有的四类消息协议 `renderer/a2ui/processor.ts`）：

```
能力产出 surface  →  surface 宿主（按 windowId 路由）  →  窗口内组件装载器渲染
                                                        （组件注册表，来自支柱一 P2 编译）
```

**泛化自 prototype popout 的三件套**：独立小 preload（改为**通用** `window.cjs`，按窗口 spec 注入能力白名单）+ token pull 握手（沿用防 race 设计）+ 窗口内组件装载器（取代 `PrototypeWindow.tsx` 的专用分支）。

### 3.2 per-window API

现状 `preload/index.ts:250` 是**扁平单例** `window.deeporca`，所有窗口共享同一份 API（prototype 窗口靠 `handleShared` 白名单绕过）。改为：

```ts
// 通用窗口 preload：按窗口 spec 注入裁剪后的 API
window.deeporca = buildWindowApi({ windowId, allowedCapabilities, domain });
```

- 组件窗口拿到的 API = 它的能力白名单（P1 面）→ 自动经过 tier + `sideEffects` 权限网关（红线 4：无权限旁路）。
- **主窗口**保持全量 API（向后兼容），组件窗口为裁剪面。

### 3.3 窗口订阅模型（消灭手工判断广播）

取代 `emit()` / `emitToMain()` 的手工取舍：

```ts
emitTo(subscription, channel, payload);  // 订阅者：windowId | domain | capability | broadcast
```

- 每个窗口**声明它订阅的域/能力**（来自 spec）；有内容载荷的通道（LSP 帧、editor-agent 进度）自然只投递到订阅者，不再靠"这个通道能不能广播"的记忆判断。
- 既有 `emit` / `emitToMain` **保留为语法糖**（`broadcast` / `main-window` 两个特例），迁移渐进。

## §4 两个特例的回迁

| 特例 | 回迁动作 | 风险 |
| --- | --- | --- |
| Prototype popout | 专用 preload `prototype.cjs` → 通用 `window.cjs` + 能力白名单；专用 renderer 分支 `?view=prototype` → 组件装载器按 spec 装载；`A2uiOpenWindow` 通道 → 清册驱动的窗口面 | 中（有真实 e2e 依赖：`PrototypePanel.tsx:282`） |
| Arch preview | `archWindows` Map → 统一注册表；`knowledge-ipc.ts:393-483` 的创建逻辑 → 窗口 spec（singleton/cascade/follow-parent/partition 逐条对应）；静态 HTML 加载保留（它不走 renderer app 路由） | 低（行为已完备，纯抽取） |

**回迁原则**：**行为等价优先**——两个特例的既有语义（单例、move-follow、级联、权限全拒）逐条迁移并测试，不借机改行为。

## §5 分期

| 批次 | 内容 | 验收 |
| --- | --- | --- |
| **N2.1** | 窗口注册表 + 生命周期 API（list/focus/state/move/resize/title）+ 域绑定（ownerRoot/ownerSession） | arch preview 与 prototype popout 迁入注册表后行为等价（单例/move-follow/级联/权限全拒逐条测试） |
| **N2.2** | 声明式窗口 spec 编译器（消费清册 P3 元数据）+ 通用窗口 preload（能力白名单裁剪） | 新增一个组件窗口**只改清册声明**；白名单外能力调用被拒（真值表测试） |
| **N2.3** | Surface 宿主（按 windowId 路由）+ 窗口内组件装载器（消费支柱一 P2 组件注册表） | 能力产出的表面可在自己的窗口内渲染；A2UI 四类协议在新宿主下全通过 |
| **N2.4** | 窗口订阅模型（`emitTo`）+ 既有 `emit`/`emitToMain` 降为语法糖 | 含内容载荷通道的泄漏回归测试全绿（不再依赖手工判断）；订阅/退订真值表 |

## §6 风险与对策

| 风险 | 对策 |
| --- | --- |
| 回迁破坏 prototype popout 的载荷握手（有真实竞态防护） | token pull 握手设计**原样保留**，只换宿主与 preload；握手竞态测试先行（回迁前补齐） |
| per-window API 裁剪导致既有 prototype 窗口行为回退 | 白名单初始化时先**等价于现状**（prototype 窗口拿到它今天能用的全部），再逐步收紧 |
| 订阅模型引发事件丢失（订阅时机 vs 事件发射） | 复用 registry 的**进度缓冲**先例（`registry.ts:224-236`）：订阅前的事件缓冲，首个订阅者接入时 flush |
| 窗口数量失控（每能力都开窗） | 声明是**可选**的（纲领 §8）；窗口 spec 须显式声明；域绑定天然限制爆炸（域关即级联关） |
| 独立 partition 导致主题/语言不同步 | partition 只隔离 cookie/storage，不隔离 UI 主题（主题经注入而非 storage）；新增 UI 上下文同步测试 |

## §7 明确不做

不做多活工作区与真助理编排（归支柱三）；不做 OS 集成面（归支柱一 P4）；不做域网传输（归支柱四）；不重定义 A2UI 四类消息协议（复用）；不做窗口内多 tab（窗口是"一个组件窗口"，不是第二个 IDE）；不改主窗口的单例地位与全量 API。
