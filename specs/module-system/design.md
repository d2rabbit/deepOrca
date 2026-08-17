# DeepOrca Studio 平台 — 模块系统 × 发行版架构（详细设计 v2）

> 日期：2026-08-15 · 状态：设计（未实现）· **v2 视野升级**：从"给 DeepOrca 加扩展机制"升级为
> "DeepOrca 作为可被第三方组装成垂直 AI Studio 的**产品内核**"。
>
> 灵感来源：VSCode 扩展平台（manifest + contribution points + activation + extension host）
> × 浏览器/发行版生态（同一内核，不同产品：Chromium→Chrome/Edge/Opera；Debian→Ubuntu）
> × 本仓已落地三大资产：**ActionRegistry**（`specs/define-action/design.md`，~30 action）、
> **A2UI 自研声明式 UI**（`specs/a2ui-integration/design.md`，renderer `a2ui/` 已落地）、
> **官方 MCP SDK**（core deps）。
>
> 一句话定位：
>
> **DeepOrca = AI Studio 内核（kernel）。第三方不 fork 代码，而是用一份"发行版清单"把内核
> 组装成他们想要的垂直产品**——一个 Unity 游戏开发 AI 平台、一个 Flutter 专用 AI IDE、
> 一个数据分析 AI 工作台。action 总线（能力）+ A2UI（界面）+ wasm 沙箱（第三方计算）+
> MCP（重工具）+ Skill（方法论）五件套构成完整的定制基座；发行版层只做"组装与皮肤"，
> 不碰内核代码。
>
> 关联路线：feature-roadmap §十二 插件中心、§十六 能力编排、§十 引擎演进（Subagent）。
> 现有代码锚点（本设计的地基，均已实现）：
>
> - `packages/core/src/actions/registry.ts` — ActionRegistry / RunHandle / seam 注入式 ActionContext
> - `packages/core/src/session.ts:874-916` — 静态注册 ~30 action；`:2696/:3414` 每轮重建工具面
> - `packages/desktop/src/renderer/a2ui/` — 自研 Surface processor（四类消息协议）
> - `packages/desktop/src/shared/ipc.ts:167-195` — a2ui:action / event:a2uiSurfaceUpdate 双向通道
> - `packages/desktop/src/renderer/main.tsx:54` — `resolveTheme()` + 5 套 styles-*.css 主题切换
> - `packages/desktop/src/renderer/hooks/use-panel-layout.ts:5-17` — rail 视图（现为硬编码 union，待数据化）
> - `packages/desktop/src/renderer/App.tsx:856` — 命令面板（command palette 已存在）
> - `packages/desktop/electron-builder.yml:10-11` — appId/productName（品牌参数化点）
> - `packages/core/src/common/permissions.ts` — sideEffects 权限网关
>
> 设计约束（红线）：
>
> 1. **core 无 UI 铁律**不变——内核永不 import react/electron。
> 2. **action 是唯一能力总线**——一切能力（内置/模块/发行版/MCP 编排）最终都是 registry 里
>    一个可执行条目；一切 UI 事件最终汇入 `registry.execute`。
> 3. **单一内核，永不分叉**——所有产品（含我们自己的 DeepOrca 桌面版）共享同一 kernel 代码线；
>    差异只存在于数据层（发行版清单 + 模块 + 主题 + 布局）与签名信任层。
> 4. **信任分层是安全模型的核心**（§四）——不同信任级拿到不同的代码边界，"UI 是数据"只约束
>    不可信层，不约束发行版。
> 5. **热插拔不重启**——模块/主题/布局变更在运行中生效；工具面变更在轮次边界应用。
> 6. **fail-open**——模块系统与发行版层的任何故障不阻塞会话内核。

---

## 一、视野：为什么 action + A2UI 已经是"完整解决方案"

用户判断的本质：一个垂直 AI 产品需要五样东西，DeepOrca 内核已经每样都有了一个**通用机制**——

| 垂直产品需要 | DeepOrca 已有的通用机制 | 缺口 |
| --- | --- | --- |
| 能力（工具、命令、领域操作） | **action 总线**：一次贡献 → LLM 工具 + IPC + UI 三表面 | 贡献目前是编译期的，第三方进不来 |
| 界面（领域面板、富展示、交互表单） | **A2UI**：声明式组件树 + 数据绑定 + 事件回流 | 贡献目前只能手写 React 进内核 |
| 第三方计算（分析、转换、校验） | — | **缺**：wasm 沙箱（本设计补上） |
| 重工具（引擎 CLI、编译器、调试器） | **MCP**：进程外 server 生态 | 缺"由发行版携带配置"的组装方式 |
| 领域方法论（怎么做事） | **Skill**：SKILL.md 知识注入 | 缺"随模块/发行版装卸"的捆绑方式 |

把五个缺口补齐后，"Unity 游戏开发 AI 平台"不再是一个新工程，而是**一份清单**：

```
Unity Studio 发行版 = 内核
  + 模块 unity.asset-inspector（wasm：资源依赖分析 + Inspector 式 A2UI 面板）
  + 模块 unity.scene-lint（wasm：场景规则校验 action）
  + MCP server 配置：unity-devtools（官方重工具，进程外）
  + Skill 包：unity-workflows（怎么分包、怎么优化 DrawCall）
  + 主题 + rail 布局预设（Scene/Assets/Build 三个领域面板进 rail）
  + 品牌层（应用名/图标/欢迎页）
```

这就是"发行版（Distribution）"概念：**数据化组装 + 签名信任，代码零分叉**。

## 二、四层产品模型

```
┌────────────────────────────────────────────────────────────────┐
│ L3 用户层：终端用户在发行版之上再装模块/改设置（不可信：wasm+数据UI） │
├────────────────────────────────────────────────────────────────┤
│ L2 发行版层（Distribution）：垂直产品的全部定义                      │
│    dist.json 清单：模块套装(带版本锁) + MCP 配置 + Skill 包          │
│    + 主题 + 布局预设 + catalog 组件扩展 + 品牌(名称/图标/欢迎页)      │
│    【签名信任：可携带 renderer 组件代码（受控 ABI）】                  │
├────────────────────────────────────────────────────────────────┤
│ L1 平台服务层（Platform Services）：可被任何人安全扩展的基座           │
│    action 总线（动态化） / A2UI 运行时 / wasm 模块运行时(DMABI)       │
│    / MCP 客户端 / Skill 扫描链 / 设置 schema / 任务树 / 记忆          │
├────────────────────────────────────────────────────────────────┤
│ L0 内核（Kernel）：LLM 会话循环、7 内置工具、权限系统、持久化、压缩     │
│    【冻结边界：平台 API 契约之外的一切都是内部实现】                    │
└────────────────────────────────────────────────────────────────┘
```

- **L0/L1 = 我们维护**（L1 是本仓绝大部分现役代码的行动总线化改造）。
- **L2 = 第三方产品方维护**（他们"拥有"自己的发行版，如同 Ubuntu 拥有 Debian 之上的品牌）。
- **L3 = 最终用户**。
- 我们自己的桌面产品 = 一个**参考发行版**（reference distribution），与第三方发行版同机制、
> 同待遇——这是"单一内核"原则的自证：`DeepOrca` 桌面版本身就用 dist.json 组装。

## 三、VSCode 理念 → 本平台映射（升级版）

| VSCode | 本平台 | 差异（有意为之） |
| --- | --- | --- |
| `package.json` + `contributes` | `module.json` 贡献点 | 同构 |
| activation events | `activationEvents`（onAction/onSurface/onProjectOpen/…） | 同构 |
| command + palette | **action**（三表面超集）；命令面板已存在（App.tsx:856） | action 兼为 LLM 工具 |
| extension host | wasm 沙箱运行时（不可信层）/ 进程内（发行版层） | 按信任分级，见 §四 |
| `vscode.*` API | DMABI host imports + 平台 API 契约（§八） | 注入=授权 |
| view/viewContainer | A2UI surface + rail 布局贡献 | **UI 是数据**（不可信层） |
| theme contribution | 主题贡献（复用 resolveTheme + styles-*.css 机制） | 同构 |
| extension marketplace | 模块注册表 + 发行版注册表 | 后置 P3/D3 |
| **VSCode fork（Cursor/Windsurf 式）** | **发行版 = 不 fork 的 fork** | **核心差异：代码零分叉** |

## 四、信任三层与代码边界（安全模型的骨架）

"UI 是数据、计算进 wasm"是**不可信层**的规则；发行版是**产品所有者**，规则不同。
三条信任带明确各自的代码边界：

| 信任层 | 是谁 | 可携带的代码 | UI 能力 | 审批方式 |
| --- | --- | --- | --- | --- |
| **T0 内置** | 随内核编译（review/task-tree 等编译期 action、7 内置工具） | 任意（代码评审准入） | 任意 React | 发版流程 |
| **T1 发行版**（签名） | 垂直产品方（Unity Studio 的作者） | **renderer 组件包**（受控组件 ABI：只实现 A2UI catalog 组件接口，不碰 IPC/不碰内核状态）+ wasm 模块 + MCP 配置 + Skill + 主题/布局/品牌 | ① A2UI 数据面；② **catalog 组件扩展**（如 Scene 树、Inspector 表格） | 发行版签名 + 用户安装时一次性授权（"你要安装的是 XX Studio"） |
| **T2 模块**（不可信） | 任何人（含用户散装） | **只有 wasm**（沙箱内） | **只有 A2UI 数据**（catalog 白名单内） | 逐项能力审批（fs.read:\*.md 等范围卡） |

裁决要点：

1. **T1 允许带组件代码**，解决"垂直产品必然需要富 UI（Inspector/场景树/时间轴）"与
   "内置 catalog 表达力有限"的张力——但组件代码**只实现 catalog 组件契约**
   （props 进 / 声明式子树出 / action 事件回流），运行在 renderer 的隔离模块域，
   拿不到 `ipcRenderer`、拿不到 window.deeporca、拿不到任意 React 上下文。
   组件 ABI 版本化（§八），破坏契约的组件拒载。
2. **T1 仍然不能带 main 进程代码**——重工具一律走它自己携带的 MCP server（进程外、
   自负其责）；内核 main 进程永不执行第三方 Node 代码。
3. T2 完全继承 v1 设计（wasm 沙箱 + 能力制 + A2UI 白名单）——上一版全部安全结论原样有效。

## 五、贡献点全集（contribution points v2）

一个模块（T2）或一个发行版（T1）通过清单贡献以下任一组合：

```jsonc
"contributes": {
  // —— v1 已设计 ——
  "actions":  [{ "id", "title", "description", "parameters"(JSON Schema), "sideEffects", "timeoutMs" }],
  "surfaces": [{ "id", "title", "template"(A2UI JSON), "dataFrom": { "action", "input" }, "refresh" }],
  "panels":   [{ "id", "rail", "surface" }],
  "settings": [{ "key", "type", "default" }],              // settings.modules.<id>.<key>
  "skills":   ["skills/<name>"],                            // 并入扫描链
  // —— v2 新增（发行版层为主）——
  "mcpServers": [{ "name", "command", "args", "env" }],    // 携带重工具配置（T1；T2 禁止）
  "theme":      { "id", "name", "base": "glass|line|metro|orca|fusion", "tokens": { ...var overrides } },
  "layout":     { "rail": [ { "id", "icon", "title", "panel", "order" } ], "defaultView": "..." },
  "catalogComponents": [{ "type": "unity.scene-tree", "component": "components/SceneTree.js" }], // T1 only，组件 ABI
  "commands":   [{ "id", "title", "action" }],             // 进命令面板（绑定到 action，不新发明机制）
  "branding":   { "appName", "icon", "welcomeSurface", "onboarding": [ ...steps ] } // T1 only
}
```

锚点说明：

- `theme`：基于现有 5 套主题（styles-*.css）做 token 级覆盖（CSS 变量），不引入新主题机制。
- `layout`：把 `use-panel-layout.ts` 的硬编码 `SidebarView` union **数据化**为 rail manifest
  （这是 L1 侧必要改造，见 §九）；发行版预设领域 rail（如 Unity 的 Scene/Assets/Build）。
- `commands`：命令面板条目只是 action 的视图投影——命令即 action，无第二套命令系统。
- `mcpServers`：T1 携带的 MCP 配置进 `augmentMcpServersWithBuiltins` 同一装配管线，
  安装时明示"此发行版将启动以下外部进程"。

## 六、发行版（Distribution）

### 6.1 dist.json（发行版清单）

```jsonc
{
  "id": "unity-studio",                       // ^[a-z][a-z0-9-]*$
  "version": "1.0.0",
  "name": "Unity Studio by Acme",
  "engines": { "deeporca": "0.1" },           // 平台 API 主版本协商（§八）
  "branding": { "appName": "Unity Studio", "icon": "assets/icon.png", "welcomeSurface": "welcome" },
  "theme": { "id": "unity-dark", "base": "fusion", "tokens": { "--ui-accent": "#97c93d" } },
  "layout": { "rail": [
      { "id": "scene", "icon": "scene", "panel": "unity.scene-tree", "order": 1 },
      { "id": "assets", "icon": "assets", "panel": "unity.asset-inspector", "order": 2 },
      { "id": "build", "icon": "build", "panel": "unity.build-report", "order": 3 },
      { "id": "chat", "icon": "chat", "order": 0 }        // 内核面板照常混排
  ] },
  "modules": [                                 // 模块套装（版本锁）
    { "source": "registry:unity/asset-inspector", "version": "^0.2.0" },
    { "source": "registry:unity/scene-lint", "version": "0.1.3" },
    { "source": "local:./modules/custom-rule", "version": "dev" }
  ],
  "mcpServers": [ { "name": "unity-devtools", "command": "npx", "args": ["-y", "@acme/unity-devtools-mcp"] } ],
  "skills": [ "skills/unity-workflows" ],
  "catalogComponents": [ { "type": "unity.scene-tree", "component": "components/SceneTree.js" } ],
  "signature": { "algo": "ed25519", "value": "…" }        // D2 起强制
}
```

Flutter 专用 IDE 同构：`flutter.widget-gallery`（surface）+ `flutter.l10n-lint`（wasm action）
+ dart-analysis MCP + flutter-workflows skill + 自定 rail。

### 6.2 组装与打包

- **运行时组装**（开发/热切换）：内核加载 dist.json → 投影贡献（模块逐个走 §七安装管线）。
  "切换发行版"= 换一份清单 + 重投影（主题/布局热生效，模块按装卸语义切换）。
- **打包分发**（给最终用户装 App）：`scripts/` 新增 dist 构建器——同一内核 Electron 包，
  参数化 `electron-builder.yml` 的 appId/productName/icon（锚点 :10-11/:41），
  dist payload 落 `Resources/app/distribution/`。**一个内核构建，N 个产品包**。
- 参考发行版 `deeporca-reference`：我们桌面产品自己的 dist.json，先把"吃自己的狗粮"
  作为发行版机制的第一验收（单一内核原则的自证）。

## 七、模块系统（T2 不可信层）——v1 设计原样收编

> 本章为 v1 设计的完整保留（仅编号调整）；它现在是平台的一个信任层而非全部。

**模块 = manifest + 贡献 + wasm 后端 +（可选）捆绑 skill**：

```
.deeporca/modules/
├── modules-index.json        # 单写者 + pending 读优先（sessions-index 纪律）
└── commit-linter/0.1.0/
    ├── module.json  ├── main.wasm
    ├── surfaces/report.a2ui.json
    └── skills/commit-linter-guide/SKILL.md
```

### 7.1 action 总线动态化（最小侵入）

```ts
// registry.ts 增量：register 不变；新增动态语义
registerContributed(moduleId, def)     // stub 注册（VSCode palette 模式）
resolveContributed(moduleId, run)      // 激活后换真身
unregisterOwner(moduleId)              // 卸载清空
onChanged(cb)                          // 工具面变更通知
```

执行路径：stub 命中 → `ModuleRuntime.activate`（懒加载 wasm + dm_init）→ 换真身执行；
激活失败 → `ACTION_FAILED`（fail-open）。工具面：`toToolDefinitions()` 每轮重建
（session.ts:2696/:3414 既有行为），stub 增删**下一轮自然生效**——热插拔刷新零新通道。

### 7.2 DMABI（自研薄 wasm ABI）

- **决策**：Node 22 原生 `WebAssembly` + 自定义 imports，零新依赖；不引入
  Component Model/wasmtime-js/Extism（演进方向记档）。
- **内存协议**：JSON over linear memory；`dm_invoke` 返回 i64 = `(ptr<<32)|len`（正=输出）；
  负数区间消歧：`-1…-16` 错误码，`≤ -0x1000` 挂起 `-(ticket)`。
- **exports**：`memory(1..N页,顶16MB/上限64MB)` / `dm_abi_version` / `dm_alloc` / `dm_free` /
  `dm_init(配置快照+granted权限)` / `dm_invoke` / `dm_resume` / `dm_dispose`。
- **async 裁决**：yield/resume 挂起协议（guest 拿 ticket 后返回挂起值，宿主异步完成
  `dm_resume`；guest SDK 封装成 await）。拒绝 SAB+Atomics（跨域隔离代价）与 Asyncify
  （工具链侵入）。
- **能力分级**：Tier-0 同步（log/progress/clock/config.own，P0）→ Tier-1 ticket
  （action.invoke 白名单/fs.read glob/llm.judge，P1）→ Tier-2 流（a2ui.update/net.fetch/mcp.call，
  P3 逐项评审）。**无 WASI**——文件/网络只经审批能力。
- **隔离**：P0 in-process + wall-clock；P1 迁 `worker_threads` + 超时 `terminate()` 硬击杀
  （Node 无 fuel 的现实解）。trap → ACTION_FAILED；dispose 后 invoke 自动重激活。
- **guest 语言**：Rust（P0 首发，proc-macro 生成 async 状态机）→ AssemblyScript（P1）
  → Javy/JS→wasm（P2）。SDK 独立 `packages/guest-sdk/`，不进 core 依赖树。

### 7.3 A2UI 贡献与回流

模板（catalog 白名单校验，未知组件拒装）+ `dataFrom.action` 数据绑定（JSON Pointer，
action 完成推 updateDataModel）+ 通用 `ModuleSurfacePanel`（一个挂载器服务所有模块面板）。
交互回流：Surface 按钮 → `a2ui:action`（ipc.ts:168）→ main 解析 `<moduleId>.<actionId>` →
`registry.execute` → `event:a2uiSurfaceUpdate` 推回。**零新机制**——A2UI 事件与 LLM 工具
调用汇入同一总线。

### 7.4 生命周期（热插拔状态机）

```
discovered → install(manifest校验+权限审批) → registered(stub/冷) 
  → activated(命中 activationEvent 才加载 wasm) → deactivating(取消在途+dm_dispose)
  → disabled / uninstalled
```

升级=新版本目录+原子切索引+旧实例退役+回滚窗口；重启后回 registered 懒激活；
权限持久化（新版本权限超集触发 diff 再审批）。

## 八、平台稳定性契约（成为"内核"的代价与承诺)

第三方敢在上面做产品，前提是**平台 API 面有版本纪律**。定义两级接口：

**平台 API（对外承诺，semver，冻结成本我们承担）**：

| 契约 | 内容 | 版本载体 |
| --- | --- | --- |
| action 总线语义 | ActionDefinition schema、RunHandle 行为（进度/取消/ActionError code）、id 命名空间 | `engines.deeporca` 主版本 |
| 贡献点 schema | module.json / dist.json 的字段与校验规则 | 同上（只加不改，破坏性变更升主版本） |
| A2UI catalog | 组件类型集 + 属性 schema + 消息协议（createSurface/…） | catalog semver（v0.x 起步） |
| catalog 组件 ABI（T1） | renderer 组件包的导入面/导出面/禁触清单 | 组件 ABI semver |
| DMABI | wasm exports/imports/内存协议/挂起协议 | `dm_abi_version` |
| 设置 schema | settings 命名空间与类型 | settings 版本号 |
| IPC 契约 | shared/ipc.ts 类型 + 通道名（renderer↔main 稳定面） | ipc 契约版本 |

**内核内部（无承诺，自由重构）**：session.ts 内部结构、MCP 客户端实现、记忆管道内部、
压缩策略、一切 `private`。原则：**贡献点与总线之外的都不是 API**。

配套纪律：平台 API 变更走 RFC（spec 目录）+ 兼容性测试矩阵（参考发行版 + 示例模块
+ 示例发行版进 CI）——"单一内核"能活多久取决于这张契约表守得多严。

## 九、L1 侧必要改造清单（把"产品壳"从代码变成数据）

发行版机制要成立，桌面壳里三处硬编码必须数据化：

1. **rail 布局数据化**：`SidebarView` union（use-panel-layout.ts:5-17，11 个视图）→
   rail manifest 驱动（id/icon/panel/order），内核面板与贡献面板同表混排。
2. **面板注册表**：视图组件从 App.tsx 的条件渲染改为 `PanelRegistry`
   （id → 懒加载组件 + 权限标记），贡献面板经 `ModuleSurfacePanel` 通用挂载。
3. **品牌参数化**：appName/icon/欢迎页从 electron-builder 构建期参数 + dist.json 运行时
   branding 双通道（构建期定打包身份，运行时定窗口内呈现）。

## 十、模块设计自检（深模块词汇）

| 模块 | Interface | 深度论证（删除测试） |
| --- | --- | --- |
| **M1 ModuleRegistry**（core） | install/uninstall/setEnabled/list/manifestOf | 删掉→N 调用方自管扫描+状态+校验→复杂度重现 ✓ |
| **M2 ModuleRuntime**（core） | activate/invoke/dispose；InProcess+Worker 两 adapter | 删掉→每模块手链 wasm→协议复杂度重现 ✓ |
| **M3 CapabilityBroker**（core） | compileImports(granted)；executeTicket(op) | 安全模型全藏于此：作者只见"能力在不在" ✓ |
| **M4 ContributionProjector**（core） | project/retract(manifest) | 一份 manifest 投影 5+ 表面（registry/skills/settings/surface/layout）——第 N 模块 O(manifest) ✓ |
| **M5 DistributionRuntime**（core+main） | loadDist/unloadDist/listDists | 隐藏"清单→全套贡献编排+品牌+布局"组装；删掉→每个产品方 fork 代码→平台瓦解 ✓ |
| **M6 ComponentHost**（renderer） | registerCatalogComponent(type, bundle)（T1，组件 ABI 沙箱域） | 富 UI 与安全边界的唯一交汇点，版本化隔离 ✓ |

## 十一、决策矩阵（机制防漂移）

| 需求形态 | 用什么 |
| --- | --- |
| 引擎核心 | 内置工具（7 个，冻结） |
| 产品一等能力（随内核发版） | 编译期 action（T0，现状不动） |
| 垂直产品（整套定制+品牌+富UI） | **发行版（T1）** |
| 用户/第三方散装轻扩展 | **模块（T2：wasm+数据UI）** |
| 重运行时/引擎 CLI/调试器 | 发行版携带的 MCP server（进程外） |
| 纯方法论 | Skill（模块/发行版可捆绑） |
| 跨能力编排 | action.invoke（Tier-1） |

边界（再次明确）：模块不得带 JS UI 代码（那是 T1 特权）；发行版不得带 main 进程代码
（重工具走 MCP）；任何人不得 fork 内核（单一内核原则）。

## 十二、阶段规划

> 两个轨道：P 轨（模块系统，v1 原案不变）+ D 轨（发行版，v2 新增）。D1 依赖 P1 完成。

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **P0 冷插拔** | manifest/registry/runtime(Tier-0)/示例模块 commit-linter | 运行中装卸→工具面下轮变更→LLM 调用成功，全程不重启 |
| **P1 热激活+隔离** | yield-resume/Tier-1/worker 隔离+击杀/surface 贡献+回流 | 模块互调；死循环被击杀；模块面板按钮回流触发 action |
| **P2 管理+自举** | ModulesPanel/权限审批卡/settings/skills 贡献/JS guest | 全程 UI 装卸；skill 随模块进退 |
| **D1 发行版 MVP** | dist.json/组装器/主题 token 贡献/布局数据化(§九三件)/参考发行版 dogfood | 用 dist.json 把桌面壳换装成 demo 垂直产品（改主题+rail+品牌+装2模块），**零代码分叉**；DeepOrca 自身跑参考发行版 |
| **D2 信任与富 UI** | ed25519 签名/组件 ABI+ComponentHost/mcpServers 贡献/打包参数化 | 签名发行版可带 catalog 组件（如 demo SceneTree）；一键产出独立品牌安装包 |
| **P3/D3 生态** | 模块+发行版注册表/检索协议/Tier-2 流能力/catalog 扩展评审/市场 | 第三方从注册表一键组装发行版 |

## 十三、风险与开放问题

| # | 风险 | 缓解 |
| --- | --- | --- |
| R1 | yield/resume 协议工程复杂 | P0 只开 Tier-0；P1 真实用例驱动；DMABI 版本化 |
| R2 | 平台 API 冻结成本（§八承诺很贵） | 契约表最小起步（先 action 总线+贡献点）；破坏性变更升主版本；兼容矩阵进 CI |
| R3 | Node 无 fuel，恶意长计算 | P0 wall-clock；P1 worker terminate；长期关注 Node fuel 支持 |
| R4 | 组件 ABI（T1）成为攻击面/兼容黑洞 | 组件域禁触清单（无 IPC/无全局）+ ABI semver + 拒载降级 TextContent |
| R5 | 发行版碎片化拖累内核（各方索要私有后门） | 单一内核原则写进贡献流程；一切需求走贡献点，后门请求一律转 RFC |
| R6 | 品牌滥用/恶意发行版 | D2 签名+来源记录；安装明示外部进程清单；注册表审核（D3） |
| R7 | 工具列表震荡 | 轮次边界刷新 + 单会话 action 总数上限 |
| R8 | 布局数据化/面板注册表改造波及现有 11 视图 | D1 一次到位但按"内核面板先入表、贡献面板后混排"分两步验收 |

**开放问题**：

1. 发行版能否声明"禁用内置 rail/面板"（纯白牌）？倾向 D1 允许 layout 全覆盖、内核面板可隐藏但 chat 不可。
2. Web 壳（浏览器版 Studio）是否纳入平台 ABI 承诺？倾向暂不承诺，记演进方向。
3. 发行版与任务树/Subagent 的关系（branch 执行体=模块 action？）——关联 §十，P3 评估。
4. 多发行版并存（一个用户装两个垂直产品）= 多内核数据目录隔离？还是单内核多 profile？倾向后者（profile 切换），D1 定案。

## 十四、非目标

- 不做内核代码分叉支持（单一内核原则；fork 者自担 API 漂移）。
- 不做云托管/多租户平台（本地桌面产品内核）。
- P0-P2 不做远端市场；D3 前注册表仅本地/私有。
- 发行版不带 main 进程代码（重工具=MCP）；模块不带任何 JS 代码（wasm+数据）。
- 不在本 spec 实现 Subagent 调度（§十，后续对接）。
