# UI-Design 引擎替换调研：LeaferJS vs HTML-in-Canvas vs CanvasUI + Stitch 借鉴

> 日期：2026-09-10 · 状态：调研定稿
> 需求（user 2026-09-10）：UI-Design 模块（当前 OpenUI Lang 引擎）要**换底层引擎**——用 OpenUI 做简单原型尚可，但做**精致化 UI 视觉稿**不合理、要求过高；用户不介意替换整个 UI-Design 底层。候选走廊：**LeaferJS（用户看好，定位契合）** vs **HTML-in-Canvas**（替代原 CanvasUI 候选，CanvasUI 组件库被用户判定不适格）。
> 另：探索 **Stitch**（Google）作为加强 PM-Design 原型模块的借鉴能力产品。
> 方法：源码事实基线（见下）+ 网络一手信息（leaferjs.com / GitHub / Context7 / Google 官方博客）。

---

## 〇、基线（沿用 2026-09-10 修正文档的事实，不重复展开）

- UI-Design 当前 = OpenUI Lang：`design.materialize`（core `actions/design.ts`）→ deep-design skill → `render_openui` → `content.openui`（`prototype.openui.txt`）→ `DesignWorkspace` 用 `OpenuiRenderer`（官方 React DOM 组件）渲染 → `.ddu` 导出（manifest + `source.openui.txt` + viewer stub）。
- `.dd` 是通用后缀；`.ddp` = PM-Design 导出包、`.ddu` = UI-Design 导出包；legacy `source.dd`（YAML+HTML）仅存于旧产物。
- 用户换引擎的动因：**精致视觉稿**（像素级/绝对定位/编辑微调/高保真导出）是 OpenUI 组件组合 DSL 的短板（`prototype-reliability/design.md` §4.1：自由画布/绝对布局 ❌、母版/实例 ❌）。

---

## 一、LeaferJS 深度调研（引擎候选 · 用户看好）

### 1.1 定位与核心事实

| 事实           | 内容                                                                                                                                                                                                                                               | 出处                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 官方定位       | **"AI 时代的无限画布引擎"**、"可以做 Figma 级编辑器的 Canvas 内核"、"生成式 UI 交互"                                                                                                                                                               | leaferjs.com / GitHub README                 |
| 许可/体积      | **MIT**，leafer-ui **70KB min+gzip，零依赖**，商业可用                                                                                                                                                                                             | GitHub README / 官网                         |
| 性能           | 100 万个交互元素：创建 1.28s（传统方案 9-15s）、内存 320MB（对照 2-4GB）、拖拽 60fps（对照 0-4fps）                                                                                                                                                | GitHub README                                |
| 架构           | 场景树驱动渲染管线；DOM 风格 API；脏标记 + 按帧缓存包围盒 + 专用离屏命中测试画布；`App` 多视口分层（ground/tree/sky）                                                                                                                              | zread 代码索引/官方文档                      |
| 布局           | **原生 Flex 布局**（`flow`/`flowAlign`/`gap`/`padding`）——"像写 HTML 一样写布局"，Group/Box/Frame 自带                                                                                                                                             | 官方文档                                     |
| 跨平台渲染后端 | web / **node（离屏渲染，服务端图像/视频生成）** / worker / 小程序；架构图含 `@leafer-ui/canvaskit`（CanvasKit 适配）                                                                                                                               | zread 架构索引                               |
| 编辑器         | `leafer-editor`（官方集成包）：图形编辑器（选择/移动/缩放/旋转/倾斜/多选/框选/编组/双击进组/锁定/层级/历史记录/自定义工具）+ 视图控制（缩放/适配/聚焦）+ 滚动条 + 箭头 + **HTML 插件**                                                             | leaferjs.com 插件中心 / GitHub leafer-editor |
| 导出           | 元素级/画面级导出；**PNG（含高清）、SVG、PDF**；异步等待网络资源加载；Node 版服务端导出                                                                                                                                                            | 官方导出文档                                 |
| LLM 生成路径   | **JSON 导入导出**：`leafer.toJSON()` / `app.tree.set({children: json.children})` —— LLM 可直接生成图元 JSON 场景树                                                                                                                                 | 官方 JSON 文档                               |
| 官方 AI 支持   | **Leafer AI 知识库 & Skills**（`github.com/leaferjs/ai-docs`，MIT，GitHub+Gitee 镜像，2026 仍活跃更新）；**Context7 MCP** 索引上线；官方更新日志："上线 Leafer AI 知识库，支持 MCP 和 AI 对话框"（2026-03）；V2.0.3 标题"助你快速打造 AI 无限画布" | 官网 AI 页 / 更新日志 / Context7             |
| AI 训练计划    | 三阶段：数据收集（官方文档+社区代码+Q&A）→ MIT 数据开放训练 → AI 应用（Q&A + 代码生成）                                                                                                                                                            | leaferjs.com/ui/guide/ai.html                |
| 社区/插件      | 官方插件 ~11 个（editor/view/scroll/arrow/html/state/flow/text-editor/animate/filter/export…）+ 社区免费插件（leafer-x-\*，含 **leafer-x-design-system** 免费 AI 插件）+ 社区付费插件（富文本编辑器、吸附线赞助版）                                | 插件中心                                     |

### 1.2 已知痛点/风险（诚实清单，zread issues 深度审）

| 风险                   | 详情                                                                                                                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 维护者单点          | 独立开发者（Chao Wan，5 年开源、公开谈过负债 80 万），试行 4 天工作周、优先金牌赞助商；虽有 8 个微信交流群、数十万开发者、企业采用（工业监控、AI 无限画布产品），但**引入方式按 npm lib 精确版本 pin**（user 拍板：不做源码 vendor，见 §1.3）                        |
| 🟠 Canvas 文本编辑短板 | `@leafer-in/text-editor` 相对较新：缩放下光标错位/大黑块（issue #885）；Konva/Fabric 用 DOM overlay 规避，Leafer 选择更深耦合——正常路径更顺、冲突更难隔离。**富文本编辑须付费插件**（leafer-htmltext-edit）；免费 `leafer-x-richText` 是 canvas 渲染富文本（非编辑） |
| 🟠 引擎级 bug 偶发     | ~~已修 destroy→布局死循环（#865 类）~~ **勘误（预研实测 2026-09-10）**：issue #865 = "LeafLayout 有小概率会对已销毁元素执行布局"（崩溃类偶发 bug），状态仍 **Open**、并非"已修死循环"；editable/locked 可被编程式 API 绕过；对比 Figma 级竞品仍缺路径文本、操作方向 API |
| 🟡 LLM 生成生态未成熟  | 官方 AI 支持目前是"知识库/MCP/Skills/代码生成"方向，**尚未提供"LLM→Leafer JSON"的契约/修复环级保障**——这正是 DeepOrca 要自建的部分（把 OpenUI 的 contract+repair 工程搬到 Leafer，见 §四）                                                                           |

### 1.3 版本与包选型（npm lib 直接引入，不做源码 vendor · user 2026-09-10 拍板）

> 用户明确：LeaferJS **直接 npm lib 引入**，源码级 vendor 引入是浪费。官网当前版本线 **v2.2.x**（导航/issue 模板显示 v2.2.10；`@leafer-in/editor` npm latest 2.2.9，2026-08 仍在发布——活跃）。

| 包                                                              | 内容                                                                             | 选型判定                                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **`leafer-editor`（web 版）@2.2.x**                             | leafer-ui + 图形编辑器 + 视图控制 + 滚动条 + 箭头 + **HTML 插件** + 导出元素插件 | ✅ **首选**——UI-Design 需要"渲染 + 画布编辑微调"，一次到位                             |
| `@leafer-in/flow`                                               | 自动布局（Flex 排版）                                                            | ✅ 按需加装——精致稿排版关键（不在 leafer-editor 默认清单内）                           |
| `@leafer-in/filter` / `@leafer-in/state` / `@leafer-in/animate` | 滤镜 / 交互状态 / 动画                                                           | ⭕ 按需加装（首版可缓）                                                                |
| `leafer`（全家桶）                                              | 自动安装 leafer-ui + **全部** @leafer-in/\* 插件                                 | ❌ 不选——含 robot/game 等无关插件，体积浪费                                            |
| `leafer-draw`                                                   | leafer-ui 轻量版，无交互                                                         | ❌ 不选——编辑场景需要交互                                                              |
| `@leafer-ui/node`                                               | Node 离屏渲染（服务端出图/自动化测试）                                           | ⭕ 后续可选（服务端批量截图/无头校验时再引；原生 canvas 依赖走 renderer 之外需另评估） |

集成事实：React 无官方组件库（leafer-vue 仅 Vue）——React 侧按官方指南用 `ref + new Leafer({ view: el })` 模式初始化即可；包为 TS 项目、类型随 npm 包内置；ESM/CJS 双发布，esbuild browser bundle 无障碍。版本纪律：**npm 精确版本 pin（不带 `^`，与仓库精确锁定风格一致）+ package-lock 锁定**；Leafer 跑在 renderer（浏览器 bundle），不触碰主进程特权路径，不适用"主进程执行组件"的最严供应链规则。

### 1.4 对 UI-Design 的价值评估

| 维度             | 评估                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 精致视觉稿       | ✅ 图元级模型（Rect/Text/Path/Image…）+ 渐变/阴影/滤镜/圆角 + Flex 自动布局 + CanvasKit 适配——**像素级控制与高保真导出，正是 OpenUI 组件 DSL 的短板**     |
| 生成后可编辑微调 | ✅ **内置 Figma 风格编辑器**（选择/变换/编组/层级/历史）——OpenUI 只能"改程序重渲染"，Leafer 允许用户在画布上直接微调，**这是"精致化"的关键闭环**          |
| LLM 生成协议     | ✅ JSON 场景树直出（`toJSON`/`set` 对称）；⭕ 需自建生成契约/验证/修复环（OpenUI 已有先例可搬）                                                           |
| 交付物           | ✅ 导出 PNG/SVG/PDF；`.ddu` 可从 viewer stub 升级为 **vendor 官方 web.min.js + JSON 数据的真实可播放 HTML**（unpkg 有 dist/web.min.js，离线 vendor 可行） |
| 跨端一致性       | ✅ 服务端（node）可离屏渲染——生成校验、批量截图、无头评审（captureReviewShots 类）零浏览器依赖                                                            |
| 维护/供应链      | 🟠 单点维护者 → vendor 锁定 + 版本 pin（仓库纪律已有先例）                                                                                                |

---

## 〇½、预研勘误（2026-09-10 本地实测 + npm/GitHub 核查，实施前必读）

在 `leafer-editor@2.2.10` 精确 pin 安装包上做的源码级核查 + Node(napi) 真渲染冒烟，对本调研与 spec 的修正：

| 主张                     | 实测结论                                                                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 导出 PNG                 | ✅ 成立：`leafer.export('png')` 出真图；`{pixelRatio: 2}` 高清导出成立（4 倍像素）                                                                                                                                                                                                    |
| 导出 SVG                 | ❌ **不成立（v2.2.10）**：`IExportFileType` 含 `'svg'`，导出插件调用 `leaf.toSVG()`，但 `toSVG` 在 `@leafer/display` 只是 "UI rewrite" 接口声明，**全部编译产物（web/node）均无实现**，运行时必 TypeError；npm 无 `@leafer-in/svg` 插件。声明未实装                                      |
| 导出 PDF                 | ❌ **不成立**：`'pdf'` 落入光栅分支后 `mimeType('pdf') = 'image/pdf'`——浏览器 `canvas.toDataURL('image/pdf')` **静默回退 PNG**（产出假 .pdf）；Node napi 后端直接报错。仅未捆绑的 skia-canvas 后端理论上可出真 PDF                                                                      |
| `@leafer-ui/node` 开箱即用 | ⚠️ 修正：不自带 canvas 后端，须 `useCanvas('napi', @napi-rs/canvas)` 显式挂载；`@leafer/node-core` 等子包 npm **只发 TS 源码**（main 指向 src/index.ts）。P2 评估服务端渲染时按此算成本                                                                                              |
| JSON 往返                | ✅ 比预期更强：`set({tag,width,height,fill,children})` 一次成型；`toJSON()` → 重放 → 重渲染 **字节级一致**（0 字节差）；`toJSON()` 从 `__input` 序列化保留人类可读输入                                                                                                                |
| 体积口径                 | ⚠️ 修正：70KB = leafer-ui **核心**；`leafer-editor` 全量 `dist/web.min.js` 实测 **307KB**（min 未 gzip）。`.ddu`/renderer 体积预算按 307KB 计                                                                                                                                        |
| issue #865               | 措辞勘误："LeafLayout 小概率对已销毁元素执行布局"（崩溃类偶发），仍 Open；非"已修布局死循环"                                                                                                                                                                                          |
| 供应链                   | ✅ 成立：`leafer-editor@2.2.10` 全部 16 个依赖为 `@leafer*` 第一方同版本精确锁定，零第三方传递依赖；`@leafer-in/flow` 确不在默认清单内（按需加装）；issue #885 属实（缩放下文本编辑错位，Open）                                                                                          |

**user 裁决（2026-09-10）**：图片导出（PNG/SVG/PDF）不关注——`.ddu` 只做**可交互画布导出**（leafer 运行时 + JSON 内嵌，双击即得平移/缩放/选中微调的画布）；EARS 13 已改为 shall-not，PNG 以外的图片导出列入 P2 重估（阻塞于上游 toSVG 实装）。

---

## 二、HTML-in-Canvas（候选修正：替代 CanvasUI）

### 2.1 CanvasUI 为何不适格（确认用户判断）

用户指认的 CanvasUI = **DavidHDev/canvas-ui（canvasui.dev，2026 新项目）**，事实链：

- **它是"HTML-in-Canvas 之上的创意特效组件库"**（Droplets/HexFloat/Glass/Shatter，shadcn registry 分发，React/Solid/Vue/Svelte/vanilla），**不是设计引擎**：无布局引擎、无编辑器、无导出管线、无设计系统概念。
- 强依赖 HTML-in-Canvas **实验 API**（Origin Trial 148-150，本地需 flag），非 API 环境降级为 WebGL overlay 或普通 HTML——**运行基础本身不稳**。
- 无 license 声明、无版本历史、无测试覆盖，maturity 极低。
- **结论：与用户判断一致——不适格做 UI-Design 引擎。**（注意区分：阿里旧项目 alibaba/canvas-ui 是 React→Canvas 渲染器，同样非设计引擎，2024 后未见活跃维护。）

### 2.2 HTML-in-Canvas 本身：能力与定位修正

- 能力（2026-09 状态）：WICG 提案 / Chromium `CanvasDrawElement`；`layoutsubtree` + `drawElementImage()` + `paint` 事件；Origin Trial M148-M151 窗口（2026-05~09 收尾）**仍未默认开启**；Chromium 152+ 仍须 flag；Firefox 转向"解决指纹/兼容问题中"、Safari 无实现；无 polyfill。DeepOrca Electron 43/Chromium 150 已实测：加 `--enable-features=CanvasDrawElement` 全套 API 可用（2026-07-30 调研）。Remotion 已把它作为客户端渲染帧捕获的自动后端（探测降级）——第三方落地的形态信号。
- **分层定位修正**：它不是"引擎"，是**渲染宿主增强层**（把真实 DOM 内容投进 canvas/WebGL/3D 且保留交互/无障碍）。对 UI-Design 的价值场景 = 未来"画布化预览/多稿对比/特效"的**启用层**，不是生成/编辑/交付层。
- **与 LeaferJS 的关系**：不同层，不互斥。LeaferJS 生成并渲染图元场景树（自持 canvas）；HTML-in-Canvas 增强"真实 HTML 内容入画布"。若 UI-Design 未来需要"HTML 类设计件作画布纹理"，可二者并用；但本次引擎替换**以 LeaferJS 为主，HTML-in-Canvas 不入主链路**（P3 观察项）。

---

## 三、Stitch 借鉴调研（加强 PM-Design 原型模块）

来源：Google 官方博客（2026-03-19 更新）+ Google Developer Blog + 第三方对比（2026-03，发布两天内 Figma 股价 -8~10%）。

### 3.1 能力画像

| 能力                | 事实                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 无限画布            | 单一工作区承载图片/文本/代码/UI 组件；可读取拖入的截图/代码片段/草图作为生成上下文                                                                      |
| 设计 agent/AI 画布  | "vibe design"：从商业目标/用户感受/灵感出发发散；一次生成 5 屏；agent 推理整个项目演进（非单 prompt），**推断下一屏**（settings/profile/onboarding 等） |
| Agent Manager       | 并行多条设计探索分支，可对比、合并（侧边栏管理）                                                                                                        |
| Instant prototyping | **静态屏 → 点击 Play 自动连成可点击原型；按钮无目标屏时自动生成缺失屏**                                                                                 |
| DESIGN.md           | **每个项目有 Markdown 设计系统文件**（色板/字阶/间距/组件样式）；可指给 live URL **自动提取**生成 DESIGN.md 并导入；跨项目复用                          |
| Voice canvas        | Gemini Live 语音协作：改需求/求评审/访谈式从零建页                                                                                                      |
| MCP server + SDK    | 官方 MCP + SDK，接入 Claude Code / Cursor / Gemini CLI（`generate_ui` 工具，"collapse design-to-code"）                                                 |
| 导出                | Figma 文件（图层/组件保留）；代码：React+Tailwind / HTML+CSS / Flutter                                                                                  |
| 限制                | 单用户、无多人协作；设计系统深度不及 Figma（组件库/自动布局/变量/tokens）；精确间距/响应式手工微调不及 Figma；免费 350 次/月                            |

### 3.2 可借鉴点 → DeepOrca 映射（原型模块加强）

| Stitch 能力                                           | DeepOrca 现状                                                                                                                                  | 借鉴动作（建议）                                                                                                                                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **即时原型自动补屏**（点击无目标 → agent 生成缺失屏） | WP2.2：`@Set($page,…)` 目标 ∉ `$page` → **failed**（导航闭包机械 gate）                                                                        | **从"报死"升级为"可补"**：failed 后可选让 agent 生成缺失屏（`design.materialize` 同款 deep-design 子代理），失败才落 failed——把 Stitch 的"自动补缺失屏"变成 PM-Design 的修复环能力（与 A-1/A-2 补丁同批评估） |
| DESIGN.md 设计系统文件 + URL 提取                     | **已具备**：`.deeporca/DESIGN.md`（design.ts 已有） + **dembrandt** `design.extract` 从 URL 提取 tokens（`design.ts` E1b，含 Provenance 契约） | 理念同源（DeepOrca 早于/并行于 Stitch 已落地）；可借鉴"跨项目复用"UX：把 DESIGN.md 做成可选项目模板预设（当前是 9 套内置 + 用户自建）                                                                         |
| 一次生成多屏 + 推断下一屏                             | PRD 页面清单逐页映射（WP0.2/0.3，页面 ID 列）                                                                                                  | 借鉴"从需求推断缺失页"：materialize 缺页时建议补页（无需生成，仅建议/待确认——机械性克制：PRD 是唯一事实源）                                                                                                   |
| MCP server + SDK（外部 agent 集成）                   | 无（设计域无 MCP 通道）                                                                                                                        | **P2 评估**：把设计/原型能力暴露为 DeepOrca MCP 工具（`design.materialize` / `prototype.*`），供其他编码 agent 消费——与 AG-UI/MCP-Apps 传输层结论互补                                                         |
| Agent Manager 并行分支对比                            | 变体机制（openuiVariants 三端）+ 任务树分支                                                                                                    | P2：UI 层"同需求多方向并排对比"（非本轮）                                                                                                                                                                     |
| 导出 Figma/代码                                       | `.ddp`/`.ddu`（source + viewer stub）                                                                                                          | 借鉴"保图层导出"目标：Leafer 引擎方案下可导出 PNG/SVG/PDF；代码导出可后续评估（React+Tailwind 映射）                                                                                                          |

**借鉴判定**：Stitch 印证 DeepOrca 两条已有路线（DESIGN.md + dembrandt 提取、导航闭包检查）方向正确；**唯一新增借鉴点是"自动补缺失屏"**（把机械 gate 与生成修复结合），列入原型模块 P1 候选。

---

## 四、结论与替换路径草案

### 4.1 结论

1. **UI-Design 新引擎 = LeaferJS**（用户判断成立）：
   - 定位契合（"AI 时代无限画布引擎 + Figma 级编辑内核"＋官方 MCP/Skills 支持）；图元级模型 + Flex 自动布局 + 内置编辑器 + 多格式导出 + Node 离屏渲染，**覆盖"精致视觉稿"的全部缺口**（OpenUI 的 4 个 ❌ 全被正面回应）；
   - LLM 生成路径可行（JSON 场景树直出），但**需自建生成契约/验证/修复环**（把 OpenUI 的 contract+repair 工程整体平移，这是主要工作量）；
   - 供应链：**npm lib 直接引入**（user 拍板，不做源码 vendor）——`leafer-editor` web 版 @2.2.x 精确版本 pin，MIT、70KB、零依赖，风险可控。
2. **HTML-in-Canvas 不入主链路**（P3 观察项）：它是宿主增强层不是引擎；CanvasUI（两个同名项目）确认不适格。
3. **Stitch**：借鉴"自动补缺失屏"+ 印证设计系统提取路线；其余为 P2 UX/生态项。

### 4.2 替换路径（草案，不在本次调研实施）

| 步  | 内容                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **生成协议**：deep-design skill 产物从 OpenUI Lang → Leafer JSON 场景树；定义 `LEAFER_CREATE_CONTRACT`（图元白名单/坐标规范/design system tokens 注入，仿 `OPENUI_CREATE_CONTRACT`）                                   |
| 2   | **验证修复环**：`repairLeaferProgram`（JSON schema 校验 + 图元边界/重叠检查 + 解析失败回退），对齐 WP2.5 标准（design 与 prototype 线同标准）                                                                          |
| 3   | **渲染**：`DesignWorkspace` 预览从 `OpenuiRenderer` → Leafer 画布——**npm 引入 `leafer-editor`（web 版）@2.2.x + 按需 `@leafer-in/flow`**（精确版本 pin，不做源码 vendor，见 §1.3）；保留选中/迭代/预览联动 UI 不变     |
| 4   | **持久化**：suite content 增加 `content.leafer`（JSON），`prototype.openui.txt` → `design.leafer.json`（旧产物兼容读）                                                                                                 |
| 5   | **导出**：`.ddu` 升级为**真实可播放 HTML**（替换 viewer stub）——leafer-editor 的 web 运行时文件取自 npm 包 dist 产物（构建期拷贝，非源码 vendor）+ JSON 数据内嵌；另提供 PNG/SVG/PDF 单文件导出（Leafer 原生导出能力） |
| 6   | **质量闭环**：`design.lint` 规则移植到 Leafer JSON（无死元素、图元越界、tokens 一致性）；`design.review/revise` 适配新载体                                                                                             |
| 7   | **原型模块不动**：PM-Design 继续 OpenUI Lang；Stitch 借鉴项（自动补缺失屏）独立评估                                                                                                                                    |

### 4.3 风险登记

| 风险                | 缓解                                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 维护者单点          | **npm lib 精确版本 pin（不带 `^`）+ package-lock 锁定**（user 拍板：不做源码级 vendor，浪费）；Leafer 在 renderer 执行，不触碰主进程特权路径，不适用最严供应链规则；升级跟随官方 changelog（v2.2.x 活跃，2026-08 仍有发布） |
| Canvas 文本编辑短板 | 首版以"渲染 + 微调变换"为主，就地文本编辑缓期（`leafer-x-richText` 渲染富文本免费，编辑付费插件不进首版）                                                                                                                   |
| LLM→JSON 生成质量   | 契约+修复环（步 1-2）是首要投资；JSON 面积大 → 提供紧凑 DSL 转 JSON 或模板 seed（参照 deep-design 的 seed 思路）                                                                                                            |
| 与 OpenUI 资产并存  | 双引擎按子域隔离（原型=OpenUI、UI-Design=Leafer）；guard 测试沿用三层定位边界批（防越界）                                                                                                                                   |

---

## 参考来源

- 仓库：`packages/core/src/actions/design.ts` · `packages/desktop/src/main/tools/dd-package.ts` · `packages/desktop/src/main/design-ipc.ts` · `packages/desktop/src/renderer/components/design-workspace/DesignWorkspace.tsx` · `docs/research/2026-07-30-html-in-canvas.md` · `specs/prototype-reliability/design.md` §4 · `docs/research/2026-09-10-canvas-ui-and-html-in-canvas.md`（修正版基线）
- LeaferJS：leaferjs.com（首页/插件中心/导出/JSON/图形编辑器/AI 训练计划）· GitHub leaferjs/leafer-ui + leafer-editor · zread 代码索引（架构/跨平台/Node.js 渲染/issues 深度）· Context7 leaferjs/ai-docs · leaferjs/ai-docs（GitHub/Gitee）
- CanvasUI：DavidHDev/canvas-ui（canvasui.dev，shadcn registry，HTML-in-Canvas 特效组件库）· alibaba/canvas-ui（React→Canvas 渲染器）
- Stitch：Google 官方博客（2026-03-19 "vibe design" 更新）· Google Developer Blog（Stitch 发布）· sfailabs.com Google Stitch vs Figma（2026-03，含 20 分钟首稿/350 次免费/导出格式/限制）
- HTML-in-Canvas：Chrome 官方 blog `html-in-canvas-origin-trial`（OT 148-151）· WICG 提案 · Remotion web-renderer 文档
