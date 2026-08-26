# TS 原生化迁移 — 包拓扑拆分与分阶段排程（ts-native-migration）

> 日期：2026-08-21 · 状态：**立项（排期计划）**
> 依据：[`docs/research/2026-08-21-scriptc-tsgo-ts-native-path-prestudy.md`](../../docs/research/2026-08-21-scriptc-tsgo-ts-native-path-prestudy.md)（下称"08-21 预研"）+ [`2026-08-19-kernel-wasm-systems-refactor-prestudy.md`](../../docs/research/2026-08-19-kernel-wasm-systems-refactor-prestudy.md)（M0/M1 部分）
>
> 铁律（2026-08-21 项目所有者确立）：
> 1. **不换语言**。core 维持 TypeScript 源码；原生化载体是 scriptc（TS→原生二进制），工具链升级是 TypeScript 7/tsgo。Rust 仅为 scriptc 路线夭折时的备选。
> 2. **迁移启动前必须完成包拓扑拆分**：Electron 框架主体独立为 `@deeporca/shell` 包；desktop 包内**所有设计工具层**整体迁入新建的 `@deeporca/design` 包。拆分是迁移的前置阶段（P0），不是迁移的附属工作。
> 3. 调研仅供参考，正式实现以本 spec 为准。

---

## 一、目标与出口

| # | 目标 | 出口标准 |
| --- | --- | --- |
| G1 | 包拓扑拆分完成（P0） | `@deeporca/shell` / `@deeporca/design` 两新包独立构建、独立测试；desktop 收敛为产品应用；`npm run check && npm test` 全绿；desktop 真机烟雾通过 |
| G2 | 工具链升级 tsgo（P1） | `tsgo --noEmit` 成为 typecheck 准入；诊断与 tsc6 零差异；lint 侧双版本并存期有清理时点 |
| G3 | 内存止血 M0（P2） | 08-19 报告 M0 四项落地，常驻内存实测削减有回写读数 |
| G4 | 传输中立化 M1（P3） | core↔shell 边界固化为协议（WS/stdio），无头服务端可跑会话全流程 |
| G5 | 原生化就绪（P4） | `scriptc coverage` 对 core 全量跑分有基线报告；三条接缝审计完成；存亡项差距有量化清单 |
| G6 | core 原生化 M2（P5，条件触发） | core 子系统逐个出原生二进制、经 P3 协议边界灰度切换；Node 版与原生版双跑对拍（沿用 scriptc 逐字节对拍思路） |

**非目标**：不换 Electron 壳（M3 降级为纯可选，不排期）；不动 module-system B1 guest-sdk 的 Rust 决策；不动 wasm guest 沙箱线；designer 功能本身零演进（P0 是纯搬迁，功能不变）。

## 二、为什么拆分是迁移的前置（而非附属）

scriptc 路线的无缝切换含义是：**core 实现从"Node 进程内 TS 库"换成"原生二进制"时，宿主壳与上层功能零感知**。这要求两件事在迁移前就位：

1. **框架与产品分离**。现状 `packages/desktop` 是"Electron 框架（进程模型/窗口/IPC/preload/vendor 注入）+ 产品功能（聊天 UI/会话服务/面板）+ 设计工具层"三层揉在一个包里。原生 core 就位后，框架层要能以"spawn 原生内核 + 协议通讯"的方式消费 core——框架代码必须独立成包、边界清晰，否则每次内核形态变化都要在整个 desktop 里翻找调用点。
2. **设计工具层解耦**。设计工具层（OpenUI/dd/A2UI/designer）是**产品模块**而非应用底座——它体量大（renderer 三个子系统 + main 侧四个工具 + core actions + 模板 + vendor 脚本）、演进节奏快、且与聊天主界面仅通过贡献点式入口相连。留在 desktop 里会让 P3 的协议边界设计和 P5 的灰度切换不断被无关改动干扰。独立成包后：desktop 只管会话产品，design 包以自己的依赖、自己的测试、自己的发布节奏演进，未来甚至可被非 Electron 宿主复用。

## 三、目标包拓扑

```
packages/
├─ core/        @deeporca/core     引擎（不变；UI-free 红线不变；scriptc 迁移主体）
├─ memory/      @deeporca/memory   L0–L3 记忆管线（不变）
├─ embedding/   @deeporca/embedding 本地嵌入（不变）
├─ shell/       @deeporca/shell    【新建】Electron 框架主体
│                                  进程/窗口生命周期、IPC 契约与安全层、preload、
│                                  vendor 工具链加载与 host 注入、插件管理器基座、
│                                  打包基建（electron-builder 配置、vendor 拷贝）
├─ design/      @deeporca/design   【新建】设计工具层（详见 §四清单）
│                                  OpenUI / dd / A2UI / designer 全部资产，
│                                  对 desktop 以组件库 + 贡献点入口形式消费
└─ desktop/     @deeporca/desktop  产品应用（收敛后）：聊天/会话 UI、权限与任务面板、
                                   i18n、设置、main 侧产品服务（git/archive/editor 等），
                                   依赖 shell + design 组合成最终应用
```

依赖方向（单向，lint 守护）：`core` ← `memory`/`embedding` ← `shell` ← `desktop` ← `design` 不成立——**正确方向**：`design` 与 `desktop` 均依赖 `shell` 与 `core`，`desktop` 依赖 `design`（消费其组件与入口），`design` **不得**依赖 `desktop`。`core` 对任何上层包保持零依赖、UI-free。

## 四、设计工具层搬迁清单（P0-1 的完整范围，一手盘点 2026-08-21）

| 层 | 现状位置 | 去向 | 说明 |
| --- | --- | --- | --- |
| renderer 子系统 | `desktop/src/renderer/openui/` | `design/src/renderer/openui/` | OpenUI Lang 模块群 |
| renderer 子系统 | `desktop/src/renderer/dd/` | `design/src/renderer/dd/` | deep-design 编译器 |
| renderer 子系统 | `desktop/src/renderer/a2ui/` | `design/src/renderer/a2ui/` | A2UI processor/surfaces |
| renderer 组件 | `components/DesignPanel.tsx`、`DesignPreview.tsx`、`PrototypePanel.tsx`、`PrototypeWindow.tsx`、`ComparisonMatrix.tsx` | `design/src/renderer/components/` | desktop 经组件库入口消费 |
| main 工具 | `main/tools/design-store.ts`、`dd-package.ts`、`dembrandt-browser.ts`、`a2ui/` | `design/src/main/` | design-store 是设计资产持久化；dembrandt 是品牌摄取 |
| core actions | `core/src/actions/design.ts`、`design-audit.ts`、`bento.ts` | **决策点 D1**（见 §六） | 推荐经 defineAction 外挂化迁入 design 包；保守方案是暂留 core |
| 模板/技能 | `core/templates/design/`（macrostructures、references/ui-styles）、`core/templates/plugins/design/` | `design/templates/` | 遵循 template-split 既定方向：设计域模板随设计包走，以插件包形态被 core 发现 |
| vendor/脚本 | `scripts/vendor-tailwind.js`、bento/dembrandt 相关 vendor 逻辑、`generate-openui-prompt.mjs` | design 包自有 scripts | 与 desktop 构建解耦 |
| 测试 | 上述各层对应测试文件 | 随迁 | 测试五件套（openui 等）保持全绿 |

**不属于设计工具层、留在 desktop 的**：聊天/会话 UI（MessageList/Composer/PlanCard/PermissionCard 等）、任务树/索引库/源码管理面板、i18n、设置、main 侧产品服务（git-service、archive-store、editor-handlers、file-scanner、workspace-registry 的产品策略部分）。

**留在 shell 的框架件**：`main/index.ts` 的进程 boot 与 `configure*Root` host 注入、`ipc-security.ts`、`shared/ipc.ts` 契约常量与类型、`preload/`、`plugin-manager.ts` 的框架部分、`web-fetch-provider.ts`（offscreen Chromium 是框架级设施）、`safe-path.ts`、构建/打包基建。

## 五、分阶段排程

```
并行批（互不阻塞）:
  P0 包拓扑拆分（P0-1 design 抽离 → P0-2 shell 抽离，内部有序）
  P1 tsgo 工具链（P1-a 非阻塞对账 → P1-b 准入 → P1-c 7.1 后单轨化）
  P2 M0 内存止血（offscreen 回收 / embedding 单例 / 子进程懒启动 / 会话 LRU）
  P4-a scriptc spike：core 全量 coverage 跑分（只读，不动代码）

串行主线:
  P3 传输中立化（依赖 P0-2：shell 拥有协议边界）──┐
  P4-b 三条接缝加固 + 存亡项消缺设计（依赖 P4-a 基线）┼→ P5 条件门
  P5 M2 core 原生化（条件触发，见下）              ──┘
  P6 远期可选（壳替换评估 / wasm 交付）——不排期
```

| 段 | 内容 | 出口标准 | 前置 |
| --- | --- | --- | --- |
| **P0-1** | design 包抽离（§四全清单搬迁 + 依赖方向 lint 守护 + desktop 改组件库消费） | 新包独立构建测试；desktop 无 openui/dd/a2ui 残留 import；真机烟雾过 | 无 |
| **P0-2** | shell 包抽离（框架件搬迁 + desktop main 收敛为薄入口组合 shell+产品服务） | 同上；`shared/ipc.ts` 契约迁至 shell 且双侧引用更新 | P0-1 |
| **P1** | tsgo 三小步（08-21 预研 §2.4） | typecheck 准入切换；rootDir 显式化完成 | 无 |
| **P2** | M0 四项（08-19 报告 Part IV） | 常驻内存实测读数回写 | 无 |
| **P3** | core↔shell 协议边界（WS 无头服务端；与远程访问 C 线共享地基） | 无头模式跑通会话全流程；desktop 经同一协议消费 core | P0-2 |
| **P4-a** | `scriptc coverage` 对 core+memory 全量跑分 | 基线报告：诊断计数按 SC 码分类、存亡项确认状态 | 无（尽早跑） |
| **P4-b** | 三条接缝（进程/网络/动态加载）注入式隔离加固 + 存亡项消缺方案设计 | 接缝审计清单全绿；消缺设计评审过 | P4-a |
| **P5** | M2 原生化：子系统逐个出原生二进制，经 P3 边界灰度；顺序沿用 08-19（子进程/MCP 管理 → 权限/路径 → session loop/消息转换/压缩 → 持久化） | 每子系统：Node 版与原生版测试双跑对拍全绿后切换 | **条件门**：scriptc 原生目标补齐 child_process + fetch/HTTP 客户端 + dynamic import 等价物，或 P4-b 接缝方案使三者可替换 |
| **P6** | M3 壳替换评估 / M4 wasm 交付 | —— | 不排期，事件触发 |

**排期说明**：P0/P1/P2/P4-a 可立即并行；P3 是当前主线 C 的组成部分（不新增立项，本 spec 只声明依赖关系）；P5 不设日历承诺——它是**条件触发**段，触发器见 08-21 预研 Part VI（scriptc 存亡项官宣 / 稳定版发布 / 7.1 API / P3 落地）。

## 六、决策点

| # | 决策 | 选项 | 推荐 |
| --- | --- | --- | --- |
| D1 | design 域 core actions（design/design-audit/bento）去向 | A. 经 defineAction 外挂化迁入 design 包；B. 暂留 core 作内置 action | **A**——与"外部工具迁出 core"的既定方向一致；若 defineAction 表达能力不足则降级 B 并记档 |
| D2 | shell 对外形态 | A. 库（desktop main import 组合）；B. 可独立运行的薄壳进程 | **A 先行**（改动小），P3 时自然演进到 B（协议边界需要独立进程形态） |
| D3 | `shared/ipc.ts` 契约归属 | 迁 shell vs 留 desktop | **迁 shell**——契约是框架件；desktop/design 双侧 import 更新 |
| D4 | 打包基建（electron-builder.yml、vendor 拷贝、package-desktop.js）归属 | shell vs desktop | **shell**——installer 组装的是"框架+vendor"，产品包提供 renderer 与配置输入 |

## 七、风险

| # | 风险 | 缓解 |
| --- | --- | --- |
| M1 | P0 拆分期 desktop 功能回归（import 路径大面积变更） | 纯搬迁零功能变更纪律；每步 `npm run check && npm test` + 真机烟雾；拆成小步 PR |
| M2 | design 与 desktop 存在隐性双向依赖，抽离时发现环 | P0-1 第一步先做依赖分析（madge 或 eslint import 图），成环处先立贡献点接缝再搬 |
| M3 | core actions 外挂化（D1-A）触碰 action 注册/权限/路由假设 | defineAction 能力盘点先行；不足则降级 D1-B，不强行 |
| M4 | 拆分与 tsgo/M0 并行期的合并冲突 | P0 文件面最大，安排在其他两段的维护窗口；P1 只动 package.json/CI，P2 集中在 main/tools 与 session |
| M5 | scriptc 存亡项长期不落地 → P5 无限期挂起 | 预期内——P5 本就是条件触发；P0–P4 每一段独立产生收益（拓扑清晰/编译提速/内存下降/无头能力），不依赖 P5 兑现 |
| M6 | 拆分包后构建拓扑变化（rewrite-esm-imports、desktop:build 排除规则）破坏 | 构建脚本随包走，P0 出口标准含全量构建验证 |

## 八、与既有规划的关系

- **远程访问 C 线**（`2026-08-15-remote-access-sunlogin-mapping.md`）：P3 即其 M1 地基（dispatch 抽取）的同一工程，本 spec 不重复立项，只声明"P3 完成后远程接入解锁"。
- **module-system spec**：guest-sdk/wasm 沙箱线完全独立；本拆分后 design 包是未来"模块"形态的第一个真实样例（贡献点消费方）。
- **pre-production 收官计划**：本 spec 是**下一版本**的排期，与当前版本冻结策略无冲突；P1（tsgo）若在当前版本窗口内启动，仅以非阻塞 CI 干跑形式（不动准入门禁）。
- **08-19/08-21 预研**：本 spec 是其正式立项承接；两预研的消费状态回写 🟡。
