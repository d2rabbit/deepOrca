# 组件窗口宿主（component-window）— 任务清单

> 对应设计：[design.md](./design.md)。2026-09-14 立稿，概念/方案稿（未开工）。
> 上游纲领：[docs/features/next-next-version-plan.md](../../../docs/features/next-next-version-plan.md) §1（P3）/§2（域）。
> 红线：**行为等价优先**（arch preview / prototype popout 的单例、move-follow、级联、权限全拒逐条迁移，不借机改行为）；窗口权限**默认全拒**；导航白名单锁死；窗口域能力白名单是权限边界（域外调用被拒）；per-window API 裁剪**先等价现状再收紧**；依赖支柱一（清册 P3 元数据）。

## N2.1 窗口注册表 + 生命周期 API

- [ ] **N2.1.1** `main/window/window-registry.ts`：统一窗口注册表（id/kind/ownerCapability/ownerRoot/ownerSession/singleton/createdAt），取代两处分散 `Map`
- [ ] **N2.1.2** 域绑定与级联：ownerRoot 关闭 → 级联关其窗口；ownerSession 结束 → 关会话域窗口（复用 arch preview 级联先例 `knowledge-ipc.ts:37-43`）
- [ ] **N2.1.3** 生命周期 API：`WindowList/WindowFocus/WindowState/WindowMove/WindowResize/WindowSetTitle`（补 `shared/ipc.ts:36-38` 仅 `WindowClose` 的缺口）+ 域内校验（窗口只能操作自己域窗口）
- [ ] **N2.1.4** 回迁 arch preview（`knowledge-ipc.ts:393-483`）→ 注册表 + 等价测试（singleton/cascade/follow-parent/partition/权限全拒/导航锁死）
- [ ] **N2.1.5** 回迁 prototype popout（`index.ts:2130-2195`）→ 注册表（**token pull 握手原样保留**；回迁前补齐握手竞态测试）

## N2.2 声明式窗口 spec + 通用 preload

- [ ] **N2.2.1** 窗口 spec 编译器：消费清册 `surfaces.windows`（singleton/placement/parent/partition/dimensions）
- [ ] **N2.2.2** 通用窗口 preload `preload/window.cjs`：`buildWindowApi({ windowId, allowedCapabilities, domain })`，取代 `prototype.cjs`
- [ ] **N2.2.3** 能力白名单裁剪 + 与 P1 tier/`sideEffects` 网关串联（**白名单外调用被拒真值表**）
- [ ] **N2.2.4** 验收：新增一个组件窗口**只改清册声明**，preload/IPC/权限零手写

## N2.3 Surface 宿主 + 组件装载器

- [ ] **N2.3.1** surface 宿主：按 windowId 路由（复用 A2UI 四类消息协议 `renderer/a2ui/processor.ts`，不重定义）
- [ ] **N2.3.2** 窗口内组件装载器：消费支柱一 P2 组件注册表（取代 `PrototypeWindow.tsx` 专用分支）
- [ ] **N2.3.3** 验收：A2UI 四类协议在新宿主下全通过；能力产出的表面可在自己窗口渲染

## N2.4 窗口订阅模型

- [ ] **N2.4.1** `emitTo(subscription, channel, payload)`：订阅者 `windowId | domain | capability | broadcast`；订阅前事件**缓冲**（复用 `registry.ts:224-236` 进度缓冲先例）
- [ ] **N2.4.2** 既有 `emit`/`emitToMain`（`index.ts:616-641`）降为语法糖（`broadcast` / `main-window` 特例），渐进迁移
- [ ] **N2.4.3** 测试：含内容载荷通道泄漏回归（不再依赖手工判断）；订阅/退订/缓冲 flush 真值表
- [ ] **N2.4.4** 新增 UI 上下文同步测试：独立 partition 下主题/语言仍同步（主题经注入而非 storage）
