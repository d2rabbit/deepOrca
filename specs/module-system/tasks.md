# Studio 平台与模块系统 — 任务核对表

> 对应 `specs/module-system/design.md`（v2：模块系统 P 轨 + 发行版 D 轨）。
> 每项完成即打勾并注明验收证据（测试/真机路径）。

## P0 冷插拔（未开始）

### core 基础设施

- [ ] `packages/core/src/modules/manifest.ts`：ModuleManifest 类型 + zod 校验（id/semver/engines/permissions/contributes）+ 精确错误
- [ ] `packages/core/src/modules/module-registry.ts`：状态机 + `modules-index.json` 单写者（pending 读优先、终端操作 flush）+ 版本化目录 + 升级原子切换
- [ ] `packages/core/src/actions/registry.ts` 动态化：`registerContributed` / `resolveContributed` / `unregisterOwner` / `onChanged`；stub 懒激活；`toToolDefinitions()` 含 stub
- [ ] `packages/core/src/modules/module-runtime.ts`（in-process）：wasm 实例化 + DMABI 编解码（JSON over linear memory，i64 packed ptr/len，负数区间消歧）+ Tier-0 imports + 内存硬顶（16MB 默认/64MB 上限）+ `dm_abi_version` 协商 + trap→ACTION_FAILED
- [ ] `packages/core/src/modules/capability-broker.ts`（P0 版）：granted → Tier-0 imports 编译；未授权 import 链接期失败
- [ ] `packages/core/src/modules/contribution-projector.ts`：manifest actions → registry stubs；project/retract 幂等

### 示例模块与工具链

- [ ] `packages/guest-sdk/`（Rust crate）：DMABI exports 脚手架 + Tier-0 绑定 + JSON 编解码
- [ ] 示例模块 `commit-linter`（Rust 纯计算）：manifest + main.wasm + 单 action

### P0 验收

- [ ] 运行中安装 → 下一轮工具列表出现 → agent 调用返回结果 → 卸载消失，全程不重启
- [ ] 坏 manifest 拒装（id/缺 wasm/schema），错误精确，索引无残留
- [ ] 未授权能力实例化失败（链接期）
- [ ] 重启恢复（registered 态 + 懒激活 + 权限持久化）
- [ ] fail-open：模块系统异常不影响普通会话
- [ ] 测试锁定：registry 动态化 / manifest 校验矩阵 / runtime 编解码 round-trip / 全链路 install→invoke→uninstall

## P1 热激活 + 隔离（未开始）

- [ ] yield/resume 挂起协议（ticket ≥ 0x1000，错误码 -1…-16）+ guest SDK async 封装（Rust proc-macro）
- [ ] Tier-1 能力：`action.invoke:<prefix>` / `fs.read:<glob>` / `llm.judge`（fail-open 返 null）
- [ ] activationEvents 全集（onAction/onSurface/onProjectOpen/onSessionStart/always）
- [ ] worker_threads 隔离（InProcessRuntime + WorkerRuntime 两 adapter）+ 超时 terminate
- [ ] A2UI surface 贡献：模板 + catalog 白名单 + `dataFrom.action` 绑定 + `event:a2uiSurfaceUpdate` 推送 + `a2ui:action` 回流
- [ ] `ModuleSurfacePanel.tsx` 通用挂载器
- [ ] IPC：`module:list/install/enable/disable/uninstall`（特权）+ `event:modulesChanged`
- [ ] 验收：模块互调；死循环击杀且会话无恙；面板按钮回流触发 action；AssemblyScript 第二 guest

## P2 管理 + 自举（未开始）

- [ ] `ModulesPanel.tsx` + 安装权限审批卡（A2UI 自举）+ 版本升级权限超集 diff 审批
- [ ] `contributes.settings` → settings schema 合并 + dm_init 快照
- [ ] `contributes.panels` rail 槽位 + 白名单
- [ ] `contributes.skills` 并入扫描链（随模块装卸进退）
- [ ] Javy（JS→wasm）guest profile
- [ ] 验收：全程 UI 装卸；JS/Rust 模块同槽；skill 随模块进退

## D1 发行版 MVP（未开始，依赖 P1）

### 壳数据化（§九三件）

- [ ] rail 布局数据化：`SidebarView` 硬编码 union（use-panel-layout.ts:5-17）→ rail manifest 驱动（id/icon/panel/order）；分两步：内核 11 视图先入表 → 贡献面板混排
- [ ] 面板注册表 `PanelRegistry`：App.tsx 条件渲染 → id→懒加载组件+权限标记
- [ ] 品牌参数化：electron-builder appId/productName/icon 构建期 + dist.json branding 运行时双通道

### 发行版机制

- [ ] `dist.json` schema + zod 校验（modules 套装版本锁/theme tokens/layout/catalogComponents/mcpServers/branding）
- [ ] `DistributionRuntime`（core+main）：loadDist/unloadDist——模块逐个走 P 轨安装管线 + 主题热切 + 布局重投影
- [ ] 主题贡献：基于 resolveTheme + styles-\*.css 的 token 覆盖（CSS 变量）
- [ ] 参考发行版 `deeporca-reference`：DeepOrca 桌面产品自身改用 dist.json 组装（dogfood）

### D1 验收

- [ ] 用一份 dist.json 把壳换装成 demo 垂直产品（主题+rail+品牌+2 模块），**零代码分叉**，可切回
- [ ] DeepOrca 自身跑参考发行版（单一内核原则自证）
- [ ] 发行版装卸的 fail-open 与状态残留测试

## D2 信任与富 UI（未开始，依赖 D1）

- [ ] ed25519 发行版签名 + 验装 + 来源记录；安装明示外部进程（mcpServers）清单
- [ ] catalog 组件 ABI + `ComponentHost`（renderer 隔离域：无 IPC/无全局/无内核状态）+ 拒载降级 TextContent
- [ ] `catalogComponents` 贡献（T1 only）+ demo 组件（如 SceneTree）验证 ABI
- [ ] `mcpServers` 贡献并入 `augmentMcpServersWithBuiltins` 装配管线
- [ ] 打包参数化：dist 构建器（scripts/）——一个内核构建产出独立品牌安装包
- [ ] 平台 API 契约表落地：契约版本号 + 兼容矩阵（参考发行版+示例模块+示例发行版进 CI）
- [ ] 验收：签名发行版带自定义 catalog 组件运行；一键产出独立品牌安装包

## P3/D3 生态（未开始）

- [ ] 模块 + 发行版注册表（索引/检索协议）
- [ ] Tier-2 流能力逐项评审：`a2ui.update` / `net.fetch:<host>` / `mcp.call`
- [ ] catalog 扩展评审制（第三方组件入库流程）
- [ ] 与 §十 Subagent 对接评估（模块 action 作为 branch 执行体）——仅评估立项
- [ ] 多发行版 profile 切换方案定案（开放问题 4）
