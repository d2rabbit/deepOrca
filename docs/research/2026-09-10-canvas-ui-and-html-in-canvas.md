# 设计模块渲染路线调研（修正版）：UI-Design 的 Canvas UI / HTML-in-Canvas 追加选项评估

> 日期：2026-09-10 · 状态：调研定稿（**2026-09-10 修订——初版误把原型语境当主语境，本节以源码为准重建**）
> 目的：用户提出在设计模块之外评估两个追加选项——**① Canvas UI** 与 **② HTML-in-Canvas**。
> 用户指正（2026-09-10）：deep-design 是整个设计管线的总称，分 **pm-design（原型）** 与 **ui-design（UI 设计稿）** 两个子域；`.dd` 是**通用后缀名**，`.ddu` 才是 UI 模块导出包（`.ddp` 是 PM 原型导出包）；**UI-Design 当前实现走 OpenUI Lang**。
> 方法：core 动作链 + desktop renderer/导出链源码逐文件核对（不是 spec 复述）。

---

## 〇、源码事实基线（以代码为准，先立据再评估）

| 事实 | 源码证据 |
| --- | --- |
| **UI-Design 模块入口 = `design.materialize`**，产物为 **OpenUI Lang 程序**（非 .dd HTML） | `packages/core/src/actions/design.ts:1-8`（"design.materialize — the UI-DESIGN module's entry … produces an OpenUI Lang program via the deep-design skill / render_openui"）· `:172-183`（prompt 要求完整 OpenUI Lang 程序）· `:203`（`executeA2ui(ctx, "render_openui", …)`） |
| **UI-Design 的持久化载体 = `content.openui`**（`.deeporca/designs/<suite>/prototype.openui.txt`） | `design.ts:150,157,378-380,570`（`content?.openui` 全链路）· `DesignWorkspace.tsx:330,353,665` |
| **UI-Design 的渲染器与原型共用**（`openuiCode + mode="openui"`） | `DesignWorkspace.tsx:661-666` → `OpenuiRenderer.tsx`（官方 `@openuidev/react-lang` `<Renderer>` + `openuiLibrary` DOM 组件，`isStreaming=false`，toolProvider/onStateUpdate 已接） |
| **质量闭环跑在 OpenUI 程序上**：`design.lint`（dead-button/dangling-nav/emoji 静态规则）· `design.review`（单轮 LLM review）· `design.revise part=design`（改 OpenUI 程序）· 全部过 `repairOpenuiProgram` 修复环 | `design.ts:314-346,478-485,569-605`；WP2.5（设计线与原型线同标准，持久化前过官方解析器修复环） |
| **`.ddu` 导出 = UI-Design 包**：manifest（format ddu / kind ui-design / pipeline openui）+ `source.openui.txt` + `index.html` viewer stub；tokens/components 可选 JSON | `dd-package.ts:182-222`（`buildDduOpenuiPackage`，注释明确 "current UI-Design generation stack (OpenUI Lang source; viewer stub)"）· `design-ipc.ts:168-174` |
| **`.dd` 是通用后缀**：legacy `source.dd`（YAML+HTML）仅用于 `pipeline === "design"` 的旧产物；新栈统一 OpenUI Lang | `dd-package.ts:15-17`（"source.openui.txt + viewer stub (buildDduOpenuiPackage); source.dd (buildDduPackage)"）· `dd-package.ts:158-180`（legacy `buildDduPackage`）· `design-ipc.ts:241`（pipeline 判定） |
| **`.ddp` 导出 = PM-Design 原型包**（含 verification.md、openuiVariants） | `dd-package.ts:79-156` · `ddp-variant-export.test.ts` |
| **deep-design Spec 里曾规划的「Canvas UI 特效画笔」素材层（liquid/blaze/glass 等 25 组件）从未落地** | `specs/archive/deep-design/design.md` §3.3 为规划稿；仓库 grep `canvas-ui`/`liquid.js`/`blaze` 零命中；`scripts/install-canvas-ui.js` 不存在 |

**结论前置**：UI-Design（设计稿子域）的当前实现与"原型"共用 OpenUI Lang 协议/渲染器/修复环，差异只在编排入口（`design.*` vs `prototype.*`）、套件 kind（ui vs prototype）和导出包（.ddu vs .ddp）。因此对两个选项的评估以 **OpenUI Lang + 官方 DOM 渲染** 为基准面。

---

## 一、选项 ①：Canvas UI（纯画布自绘）

两种语义必须分开：

### 1.1 作为「渲染引擎」（CanvasKit/Skia + Yoga 自绘 UI）—— 不适用

| 维度 | 评估 |
| --- | --- |
| 渲染层替换 | 需用 CanvasKit（WASM ~2-4MB）+ Yoga 布局 + 自研 React renderer 替换官方 `<Renderer>` + `openuiLibrary`；60+ 组件全部重写为 `<View>/<Text>/<Image>` 级别基础件 |
| 协议层 | OpenUI Lang 不变可继续生成，但渲染端需全新翻译器（DSL → canvas 指令），parser/修复环/act-tag/质量检查全部依赖 DOM 渲染语义，一起失效或重写 |
| 交互/无障碍 | 表单、ime、缩放、选中、`act-tag` 标注、DevTools 检查全丢；无障碍树自建 |
| 收益 | 0 —— UI-Design 交付物要的是"可导出/可审阅/真机像"（.ddu stub + 应用内预览），不是"像素级特效画布"；Figma 式自绘是为了**编辑器工具**（无限画布+缩放+框选），UI-Design 无此编辑器诉求 |
| 与交付的关系 | `.ddu` 的 `source.openui.txt` 无法独立播放（viewer stub），本就依赖应用内运行时；换 canvas 后连应用内也依赖 WASM 引擎——交付链变长而非变短 |

**否决。** 唯一仍成立的子系统诉求是"特效"，见 §1.2。

### 1.2 作为「特效画笔素材」（deep-design §3.3 未落地的 liquid/blaze/glass 等）—— 有落点但需改形

- 原规划（`scripts/install-canvas-ui.js` vendor + Agent 内联到生成 HTML）宿主是 .dd 产物；**现宿主已是 OpenUI Lang 组件库**——正确对应物是把特效做成 **openuiLibrary 里的 canvas 组件**（如 `FxGlass(children)` / `FxParticles`），挂在 `library-schema.ts` 单源 schema 下，prompt 由 `library.prompt()` 自动生成。
- 这正是 `specs/prototype-reliability/design.md` §4.4 **A-3「原型组件目录」**（Timer/进度环/空态插画卡等原型专用 custom library）的同构思路——可合并为同一个 P2 跟进项，UI-Design 与原型共用。
- 依赖宿主无关：特效组件自包含 canvas 2D，产物（OpenUI 程序）在应用内渲染即可，不依赖实验 API。

---

## 二、选项 ②：HTML-in-Canvas（浏览器原生 API）

### 2.1 能力与状态（2026-09 时点）

- **是什么**：WICG 提案（Chromium 实现 `CanvasDrawElement`），把已布局的 DOM 元素绘制进 canvas 2D/WebGL/WebGPU，同时保留布局、交互、无障碍、页内查找、DevTools 检查。三原语：`layoutsubtree` + `drawElementImage()` + `paint` 事件。
- **DeepOrca 实测**（`docs/research/2026-07-30-html-in-canvas.md`）：Electron 43.2.0 / Chromium 150 默认关闭，加 `--enable-features=CanvasDrawElement` 启动参数即全套 API 可用（`drawElementImage`/`layoutSubtree`/`requestPaint`/`captureElementImage` 均 function）。
- **2026-09 状态刷新**：Origin Trial 窗口 Chrome 148–151（2026-05 至 09，Google I/O 2026 官方发布）；Chromium 152+ 仍须 flag、**未默认开启**；Firefox 从"反对"转"解决指纹/兼容问题中"，Safari 无实现；无 polyfill。Remotion `@remotion/web-renderer` 已把它作为客户端渲染帧捕获的自动后端（探测 nested 支持，失败降级 DOM composer）——第三方信号证明 API 形态可用。
- **已知限制**：跨域 iframe 不渲染、SVG foreignObject 未工作、交互元素需手动同步 transform matrix、`layoutsubtree` 限画布直接子元素。

### 2.2 对 UI-Design 的评估

| 维度 | 评估 |
| --- | --- |
| 常态渲染 | **无收益**——openuiLibrary 是 DOM 组件树，浏览器 DOM 渲染已是最优；不需要画布层 |
| 特效层 | 收益：OpenUI 生成的设计稿（登录页/卡片等 DOM 内容）可投进 canvas 做 shader 级特效（液体玻璃/像素/形变/3D 贴图），且**交互/无障碍保留**——比 §1.2 的 canvas 自绘特效更强（后者是普通 canvas 2D，无 shader）；但依赖 flag/Chromium 演进 |
| 画布化预览/多稿对比 | 潜在收益：若 UI-Design 工作台未来做"设计稿画布"（缩放/旋转/图层/对比），HTML-in-Canvas 让 DOM 设计件作为纹理进画布且保持选择——官方 Demo 点名场景就是 Figma/Miro 式画布应用 |
| 交付物 | **不受影响**：`.ddu` 导出是 source.openui.txt + stub，不依赖画布 API；应用内预览是唯一用点，导出/审阅零牵连 |
| 风险 | flag 实验态无稳定承诺；Electron 升级滞后于 Chromium；跨域资源限制 |

**判定：P3 观察项，不立项**（与 7 月调研一致，但定位从"远期视觉特效路径"细化为"UI-Design/原型共用的画布化预览+shader 特效的现成启用路径"）。触发条件：① Chromium 默认开启（或 Electron 升级自动获得）；② 出现"设计稿画布化预览/多稿对比"或"shader 级特效"的真实需求。启用方式零 vendor：加 flag + 特性探测降级。

---

## 三、结论汇总

| 选项 | 判定 | 一句话理由 |
| --- | --- | --- |
| Canvas UI（渲染引擎自绘） | **不立项** | 协议层不变但渲染层全量重写，交互/无障碍/质量链全丢，收益为 0 |
| Canvas UI（特效画笔组件） | **P2 跟进项（并入 A-3）** | 正确形态 = openuiLibrary 的 canvas 特效组件（library-schema 单源），不是 vendor 素材 |
| HTML-in-Canvas | **P3 观察项** | 能力可用（Electron 43 实测 + Remotion 落地），但 flag 态无承诺；等默认开启或画布化需求出现 |
| OpenUI Lang 技术底座 | **维持** | UI-Design 与原型共用协议/渲染器/修复环，两选项均不构成替代 |

## 参考来源

- 仓库源码：`packages/core/src/actions/design.ts` · `packages/desktop/src/main/tools/dd-package.ts` · `packages/desktop/src/main/design-ipc.ts` · `packages/desktop/src/renderer/components/design-workspace/DesignWorkspace.tsx` · `packages/desktop/src/renderer/openui/OpenuiRenderer.tsx` · `specs/archive/deep-design/design.md`（legacy 规划，§3.3 特效素材未落地）· `specs/prototype-reliability/design.md` §4（引擎选型底座 + A-3 组件目录）· `docs/research/2026-07-30-html-in-canvas.md`（Electron 43 实测）· `docs/research/2026-08-14-openui-*.md`（管线深潜/三层定位）
- 网络（2026-09）：Chrome 官方 blog `html-in-canvas-origin-trial`（OT 148–151）· WICG `html-in-canvas` 提案 · Remotion web-renderer HTML-in-canvas 文档 · I/O 2026 Chrome 15 项更新

## 修订记录

- 2026-09-10 初版：误以原型（PM-Design）语境为主（用户第一轮纠正"UI 设计模块"指 UI-Design 子域）。
- 2026-09-10 修订：用户再纠正——deep-design 为合并域、.dd 通用后缀、.ddu 才是 UI 导出、UI-Design 当前实现即 OpenUI Lang（源码证实 `design.ts` 模块注释 + `buildDduOpenuiPackage`）。本文按源码事实重建全部结论。原初版正文已废弃。