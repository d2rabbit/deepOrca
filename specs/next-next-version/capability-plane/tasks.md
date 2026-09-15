# 能力四平面（capability-plane）— 任务清单

> 对应设计：[design.md](./design.md)。2026-09-14 立稿，概念/方案稿（未开工）。
> 上游纲领：[docs/features/next-next-version-plan.md](../../../docs/features/next-next-version-plan.md) §1/§2/§6。
> 红线：`ActionSurfaces` 是**可选扩展**（additive-only，现有 ~40 action 零改动）；生成器不得直出裸 `ipcMain.handle`（三层 tier 内注册，`ipc-contract.test.ts` 门禁）；系统面全部**默认关**（红线 6）；`defaultSession` 逐项放开 + 审计（禁整体放行）；core 承载不解释（无 UI 铁律）；不新增第二套权限模型。

## N1.1 类型 + 骨架 + 单能力端到端

- [ ] **N1.1.1** `core/src/actions/types.ts`：`ActionSurfaces` 接口（panels/windows/system/domains，**全部 optional**）+ `ActionDefinition.surfaces?` 可选字段
- [ ] **N1.1.2** additive 证明测试：现有 ~40 action 零改动通过全部既有测试（`surfaces` 缺省行为等价）
- [ ] **N1.1.3** `desktop/src/main/capability/registry.ts`：能力清册单写者骨架（`defineCapability` / 查询 / 校验 actionId 存在）
- [ ] **N1.1.4** 端到端样本：`review.full` 声明面板（P2）+ 窗口（P3 仅编译）+ 通知（P4），打通 P1/P2/P4 三面
- [ ] **N1.1.5** i18n：清册声明的 titleKey 全部落 6 locale（`Record<MessageKey,string>` 类型强制）

## N1.2 P1 编译完整化（IPC + preload 自动生成）

- [ ] **N1.2.1** 清册 `ipc: { tier }` → 在既有 `handle`/`handlePrivileged`/`handleShared` 上自动注册 handler（委托 `registry.execute`）；生成器类型层面禁止裸 `ipcMain.handle`
- [ ] **N1.2.2** preload 方法自动生成（替换 `preload/index.ts:14-248` 扁平单例手写）
- [ ] **N1.2.3** 三处手写迁移（ipc.ts key+type / main handler / preload 方法）→ 清册单点
- [ ] **N1.2.4** 验收：新增一个能力**只改清册一行**；`ipc-contract.test.ts` 全绿；preload 手写行数下降可量化

## N1.3 P2 编译（槽位表 + 组件注册表）

- [ ] **N1.3.1** `renderer/capability/component-registry.ts`：`registerComponent(key, ReactComponent)` + 槽位渲染器
- [ ] **N1.3.2** 槽位表装载：`slot → component[]`（宿主按 order 装载，缺组件时降级占位不崩）
- [ ] **N1.3.3** `use-panel-layout.ts:5-17` 硬编码 `SidebarView` union 数据化（清册驱动 rail 视图）
- [ ] **N1.3.4** 验收：既有 12 个 rail 视图行为等价；9 处按 action id 手写的消费者**渐进迁移**（不搞大爆炸，长期共存）

## N1.4 P4 最小系统面（OS 集成层从零建设）

- [ ] **N1.4.1** Tray：图标 + 菜单（由 `system.tray` 生成）+ 点击唤起指定域；**默认关**
- [ ] **N1.4.2** `globalShortcut`：全局唤起（条数上限 + 冲突检测；`whenReady` 注册 / `will-quit` 注销）；默认关逐条开启
- [ ] **N1.4.3** Notification：能力声明 `notifications: true` 才可用；**逐项放开** `defaultSession.setPermissionRequestHandler`（`index.ts:2655-2658`）的 notification 单项 + 审计日志；点击路由到能力的窗口/槽位
- [ ] **N1.4.4** 协议入口（`setAsDefaultProtocolClient` + `open-url` / `second-instance` argv → 清册前缀最长匹配）+ 自启：**仅编译不启用**（默认关）
- [ ] **N1.4.5** 角标/进度：`setBadgeCount` / `setProgressBar` 接能力进度面
- [ ] **N1.4.6** 测试：系统面全部默认关的真值表；协议 URL 白名单校验（注入用例）；快捷键冲突检测；生成器不得产出裸 handler

## N1.5 与 module-system B1 对接（B1 落地后）

- [ ] **N1.5.1** 清册注册改走 B1 动态接口（`registerContributed`/`unregisterOwner`/`onChanged`）——第一方与第三方共用同一入口
- [ ] **N1.5.2** 验收：运行期加/卸能力无需重启
