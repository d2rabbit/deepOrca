# 产物落地三链（Artifact Landing）— 需求文档

> 日期：2026-09-08 · 状态：调研定稿（未实现）· 归属：活跃 spec（本阶段实施）
> 调研：2026-09-08 三份外部参照调研 —— [xushanpei/open-file-viewer](https://github.com/xushanpei/open-file-viewer)（MIT，v0.1.3）· [marp-team/marp-core](https://github.com/marp-team/marp-core)（MIT，v4 stable / v5 RC）· [lnkiai/m3e-canvas](https://github.com/lnkiai/m3e-canvas)（MIT）——结论已内嵌本文 §1 与 [design.md](./design.md) 附录 D，不另立调研文档。

## 1. 问题与背景

三链共用一条主线：**工作区产物（文件、文档、原型）从"被生成"到"被消费/被落地"的最后一公里**。目前三个断点：

1. **文件看不了**。cm6 只认文本：`editor-handlers.ts` 的 `BINARY_EXTENSIONS`（pdf/docx/xlsx/pptx/图片/压缩包等 60+ 扩展名）或 NUL 字节嗅探命中后返回 `{ok, binary:true}`，编辑器只显示一行「二进制文件 — 无法编辑。」占位。agent 会话产出的 PDF 报告、数据表格、文档附件在产品内不可见，用户被迫切到系统外部。
2. **文档带不走**。spec 管线的产物是一份 `spec.md`，只能在 PrototypeWorkspace 内以 markdown 小节平铺渲染。没有演示形态、没有分发形态（对照 openui/dd 管线已有 standalone `index.html` 打包先例）——需求评审与干系人同步只能截屏。
3. **原型落不了地**。spec/原型交给编码 agent 实现时，输入是一句自由需求或原型源码。外部参照 m3e-canvas 验证了防塌陷的正确姿势：**受控 IR + 确定性模板翻译 + 反塌陷措辞 + 平台组件映射**，让交给 agent 的内容里不存在任何需要 LLM 猜测的信息（其提示词由代码生成，LLM 只写人话备注）。我们没有这一层——原型到实现会话之间是断的。

外部参照结论（2026-09-08）：

- **open-file-viewer**：纯前端容器式预览 SDK（core 框架无关 + React 适配层），插件制（重解析器在插件内 `await import()` 动态加载）；输入直接支持 `ArrayBuffer`（Electron IPC 结构化克隆天然契合，无需 URL/file://）；Office 三级降级（docx-preview → mammoth → OpenXML 文本抽取），xlsx 带大表窗口化与公式明细；HTML 注入过 DOMPurify。体积核查（2026-09-08，bundlephobia + npm registry）：core 主包 430KB min / 133KB gzip + ≥1.35MB min 聚合 chunk；npm 安装面 ≈100MB（three 37MB / hls.js 24.8MB 等未用格式依赖随包安装）。**最终选型（2026-09-08 用户拍板）：采用该 SDK，按需子集引入 —— 默认只挂 pdf / office（word+excel+ppt 一插件）/ image / archive / fallback 五插件，其余格式插件（text/video/audio/email/epub/xps/ofd/drawing/cad/model3d/gis/asset）不引入；以构建守护断言未挂载格式引擎（three/leaflet/hls.js）不得进入渲染产物。**
- **marp-core**：`new Marp(); marp.render(md) → {html, css}` 纯文本变换（Node 侧，渲染 bundle 零增量）；自带 auto-scaling/Shiki/KaTeX/官方主题。PDF/PPTX 属 marp-cli（要拖 Puppeteer/Chrome），但 DeepOrca 桌面端自带 Chromium——`printToPDF` 即可，**不引 marp-cli**。
- **m3e-canvas**：**只取方法论，不集成代码**。其防塌机制拆解（源码级）：受控 IR 收窄自由度 → 每 kind×语言手写模板穷举 → 几何解释器（行检测/包含树/区域词）把坐标翻译成语义布局 → 负向禁令逐条封死已知失败模式 → 导航闭环 checklist → 平台感知收尾守则（真实持久化/按标签补全行为/可用优先/按角色引用颜色/语义词↔平台组件映射）。十条可迁移原则见 design.md 附录 D。

## 2. 范围

### 包含

- **链路 A（查看兜底）**：新 IPC `EditorReadBinary`（`safePathWithinRoot` + 扩展名白名单 + 64MB 上限 → ArrayBuffer，上限为常量可调）；渲染端 `BinaryFileViewer` 懒加载组件（`@open-file-viewer/react` 适配层，**按需插件子集**：`pdfPlugin` / `officePlugin`（word+excel+ppt 一插件）/ `imagePlugin` / `archivePlugin` / `fallbackPlugin`；text/video/audio/email/epub/xps/ofd/drawing/cad/model3d/gis/asset 不挂载）；工具栏文案六语言；明暗主题跟随；pdf worker 随包分发，全链路离线。
- **链路 B（幻灯片输出）**：主进程 md→marp 预处理器（`## ` 切页 + front-matter 直通）；spec tab「幻灯片」视图（sandbox iframe 预览 + 翻页）；导出自包含 `slides.html`；导出 `slides.pdf`（offscreen BrowserWindow + `printToPDF`）；产品主题 CSS（按明暗烘焙）。
- **链路 C（落地简报）**：简报生成器 `prototype-brief.ts`（UI-free 纯函数，确定性模板）；输入 spec.md / openui 原型 → 产出 `brief.md` 实现任务书；防塌陷措辞库；导航闭环校验；「注入实现会话」动作（`PromptSend` / 输入框预填）。

### 非目标（本期不做）

- A：二进制文件编辑；CAD/3D/GIS 插件；服务端格式转换；diff 视图的二进制对比；二进制文件进入 file-history/checkpoint；**音频/视频/媒体流预览（2026-09-08 拍板：明确排除，不做兜底——`imagePlugin` 仅图片例外）**；OFD/EPUB/邮件/CAD/3D/GIS 等特殊格式不做预览兜底。
- B：PPTX 导出；marp-cli 引入；幻灯片协同/在线编辑；spec.md 被改写（幻灯片是衍生物，spec.md 仍是唯一事实源）。
- C：集成 m3e-canvas 画布或其分享链接协议；视觉还原度评估/走查工具；core 会话循环改动（简报注入走既有 `PromptSend` 通道）；自动代跑实现。
- 通用：不改 workspace-root pinning、`safePathWithinRoot` 与 IPC 安全不变量。

## 3. 用户故事

1. 作为用户，agent 生成了 report.pdf / 数据表.xlsx，我在编辑器文件树点开它——看到分页文档预览/可切换 sheet 的表格预览，而不是「无法编辑」。
2. 作为用户，我点开一张超出 64MB 的视频文件，得到明确的超限提示与「在系统中打开」兜底按钮，而不是空白占位。
3. 作为用户，我写完 spec 后切到「幻灯片」视图，逐页检查它作为演示材料的样子；不满意就回文档视图改，改完刷新即可。
4. 作为用户，我把导出的 slides.html / slides.pdf 发给评审人——对方不需要安装 DeepOrca，浏览器/阅读器直接打开。
5. 作为用户，我对 spec/原型点「生成落地简报」，得到一份结构化实现任务书；点「注入实现会话」，当前会话以简报全文为第一指令开始实现。
6. 作为谨慎用户，简报引用的屏幕/路由目标不存在时，生成被拦下并告诉我缺口清单——而不是让 agent 在实现时自己猜。

## 4. 验收标准（EARS）

### 链路 A：编辑器兜底预览

- **A1** When 编辑器读取判定为 binary 且扩展名在白名单（pdf / docx·docm·rtf·odt / xls·xlsx·xlsm·csv·ods / ppt·pptx·odp / png·jpg·jpeg·svg·webp·gif·avif·bmp / zip·7z·tar·gz·tgz），the 编辑器 shall 以内嵌预览视图替换现「二进制文件 — 无法编辑。」占位；heic·heif、媒体与特殊格式不在白名单，命中走 A3 兜底（系统打开）。
- **A2** The `EditorReadBinary` 通道 shall 经 `safePathWithinRoot` 解析路径（逃逸即拒绝）、按扩展名白名单放行、单文件上限 64MB，成功时 shall 返回 `{ok, bytes: ArrayBuffer, name, ext, size}`；任一不满足 shall 返回 `{ok:false, reason}` 且不读取文件字节。
- **A3** When 预览不支持该格式（白名单外、解析失败、超限），the 系统 shall 回退为明确的原因提示 + 「在系统中打开」兜底动作；shall 不出现无解释的空白。
- **A4** The 预览器 shall 跟随应用明暗外观（light/dark/auto），工具栏文案 shall 全部经六语言 i18n catalog（open-file-viewer 的 `labels/titles` 覆盖通道），shall 不向用户泄露插件内置的未本地化文案为主要交互面。
- **A5** The 预览链路 shall 完全离线可用：格式引擎与 pdf.worker 随安装包分发，运行期不发起任何网络请求；shall 禁用外部 URL 输入源（仅本地字节）；the 挂载插件集 shall 不含任何 CDN/在线资源路径（gis 插件的在线瓦片/CDN CSS 即不挂载的原因之一）。
- **A6** The 依赖 `@open-file-viewer/core`、`@open-file-viewer/react`、`pdfjs-dist` shall 精确锁版本（无 `^`/`~`）；the 渲染端 shall 仅挂载白名单插件（插件常量数组），且 the 构建产物 shall 以断言守护：未挂载格式的引擎（three/leaflet/hls.js 等）不得进入 renderer 依赖图与 dist —— when 守护断言失败（tree-shaking 失效），shall 采用给该包补 `sideEffects` 声明的补丁或 vendor fork 兜底。已知并接受的成本：npm 依赖树安装面 ≈100MB（three 等未用格式依赖随包安装，仅影响开发/CI 磁盘与时间）。

### 链路 B：幻灯片输出

- **B7** When 用户在 PrototypeWorkspace spec tab 切到「幻灯片」视图，the 系统 shall 将 spec.md 经 md→marp 预处理器渲染为分页预览：按 `## ` 切页（围栏代码块内的 `##` 不切）、首页为标题页（工件标题 + brief）、检测到 `marp: true` front-matter 时按原生语法直通不预处理。
- **B8** The 幻灯片渲染 shall 发生在主进程（marp-core，精确锁 v4）；the 渲染端 shall 仅接收 `{html, css}` 并在 sandbox iframe 内呈现；the 渲染 bundle 因本链路产生的体积增量 shall 为零（marp 及其依赖不得进入 renderer bundle）。
- **B9** When 用户导出 HTML，the 系统 shall 在工件目录写入自包含 `slides.html`（样式内联，不覆盖 spec.md，作为衍生物不参与既有版本内容对比）；When 用户导出 PDF，the 系统 shall 经 offscreen BrowserWindow 加载该 HTML 并 `printToPDF`（横向、打印背景）生成 `slides.pdf` 同规则落盘。
- **B10** The 生成的 HTML/PDF shall 自包含且默认不发起远端请求：spec 内外链图片 shall 默认阻止，导出完成提示中列明被阻止的资源数；外链放行策略（仅 http/https、拒绝内网/环回/保留地址 host）shall 留作默认关闭的配置项。
- **B11** The 幻灯片 shall 使用产品主题 CSS（按当前明暗烘焙，色值对齐 ui tokens），且 shall 不修改 spec 管线既有数据模型与 hub 域归属。

### 链路 C：落地简报

- **C12** When 用户对 spec 工件或 openui 原型触发「生成落地简报」，the 系统 shall 由确定性模板引擎（代码，非 LLM 即兴）生成 `brief.md`，节结构固定为：目标 → 屏幕清单 → 逐屏布局（行/区域/嵌套，反塌陷措辞）→ 行为与导航 → 技术栈映射（DeepOrca openui 栈）→ 落地守则。
- **C13** The 简报正文 shall 遵循防塌陷措辞库（design.md 附录 D）：横排显式禁堆叠/换行、复合部件成组并以稳定名称指代、颜色按 token/角色引用、正文不出现绝对坐标（以区域词与行结构表达）。
- **C14** When 简报引用的屏幕/路由目标在输入中不存在，the 生成 shall 失败并返回缺口清单（不产出含悬空引用的简报）；the openui 源码中无法结构化抽取的部分 shall 降级为「源码附录」原样附后，shall 不做语义猜测。
- **C15** When 用户点「注入实现会话」，the 系统 shall 将 brief.md 全文经 `PromptSend` 送入当前激活会话；when 当前无激活会话或输入框非空，shall 改为预填输入框由用户确认发送。
- **C16** The brief 的用户可见操作（按钮/提示/错误）shall 进六语言 i18n catalog；the brief 正文为 agent-facing 文档，模板固定措辞允许中英混排（model-speak），shall 不强制逐语言目录化。
- **C17** The 简报生成器 shall 为 UI-free 纯函数模块（输入工件文本与元数据，输出 `{ok, briefMd?, gaps?}`），shall 经 run-tests.mjs 离线单测（含缺口拦截与源码附录降级负例）。

## 5. 风险与对策

- open-file-viewer 0.1.x 早期、API 可能变 → 精确锁版本；插件协议简单（match/render/destroy），弃维护时 fork/vendor 成本低；office 插件内置中文降级文案为主要残留面，经工具栏 labels 覆盖主要交互面，残留降级文案 P2 视需要 vendor 后本地化；tree-shaking 若失效（守护断言变红）→ `sideEffects` 补丁或 vendor fork 兜底（A6）。
- marp-core v5 为 RC → 锁 v4 stable，v5 GA 后另行评估升级（Node ≥20.19 满足）。
- 散文 spec 按 `## ` 切页可能单页过长 → marp auto-scaling 自动缩排兜底，预览即所见。
- 大文件 ArrayBuffer 过 IPC 的内存峰值 → 64MB 上限（常量可调）+ 仅在打开预览时读取（不预读）。
