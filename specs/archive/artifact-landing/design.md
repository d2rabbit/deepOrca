# 产物落地三链（Artifact Landing）— 技术设计

> 日期：2026-09-08 · 状态：设计稿（未实现）· 需求：[requirements.md](./requirements.md) A1–A6 / B7–B11 / C12–C17
> 三链彼此独立、可分期实施；共享的约束只有三条：IPC 走 `resolveRegisteredRoot`/`safePathWithinRoot` 既有安全面、依赖精确锁版本、渲染 bundle 零负担。

## 0. 总览

```
链路 A  编辑器 binary 命中 ──► EditorReadBinary IPC ──► BinaryFileViewer（懒加载） ──► 内嵌预览/系统打开兜底
链路 B  spec.md ──► md→marp 预处理器（main）──► marp-core render ──► {html,css} ──► sandbox iframe 预览
                                          └─► slides.html（自包含） ──► offscreen 窗口 printToPDF ──► slides.pdf
链路 C  spec.md / openui 源码 ──► prototype-brief.ts（纯函数模板引擎）──► brief.md ──► PromptSend 注入实现会话
```

## 1. 链路 A：编辑器二进制兜底预览（open-file-viewer SDK + 按需插件子集）

> **最终选型（2026-09-08 用户拍板）**：采用 `@open-file-viewer/*` SDK，**按需子集引入**。核查数据留痕（bundlephobia + npm registry `dist.unpackedSize`，2026-09-08）：core 主包 430KB min / 133KB gzip + ≥1.35MB min 聚合 chunk；npm 安装面 ≈100MB（three 37MB / hls.js 24.8MB / xlsx 7.5MB / leaflet 3.7MB…，未用格式依赖随包安装——已知并接受的 dev/CI 成本）。
> **挂载取舍（2026-09-08 拍板：只对常规类文件兜底）**：默认插件 = `pdfPlugin`（pdf）/ `officePlugin`（word+excel+ppt 一插件覆盖三类）/ `imagePlugin`（原生 img 零额外依赖；**仅图片，媒体流的唯一例外**）/ `archivePlugin`（zip 系；jszip 本就是 office 插件的静态依赖，边际成本≈0）/ `fallbackPlugin`（兜底）。**明确排除** = 音频/视频/媒体流（不做兜底）· `textPlugin`（文本 cm6 已覆盖，冗余）· email·epub·xps·ofd·drawing·cad·model3d·gis·asset（特殊格式不兜底；gis 还含 CDN CSS 与在线瓦片，违背离线约束 A5）。
> 说明：64MB 是**被预览单文件**的 IPC 上限（`MAX_BINARY_SIZE` 常量，可调），与库体积无关。

### 1.1 IPC 契约（shared/ipc.ts + preload）

```ts
// IpcRequest.EditorReadBinary: "editor:readBinary"
editorReadBinary(filePath: string): Promise<{
  ok: boolean; bytes?: ArrayBuffer; name?: string; ext?: string; size?: number;
  reason?: "escaped" | "not-file" | "too-large" | "extension-unsupported";
}>
```

- main 端 handler 复用 `editor-handlers.ts` 的 `safePath`（`safePathWithinRoot` 语义不变）；白名单对齐挂载插件的可预览格式：`pdf docx docm rtf odt xls xlsx xlsm csv ods ppt pptx odp png jpg jpeg svg webp gif avif bmp heic heif zip 7z tar gz tgz`。媒体（mp4/mp3/mov…）不进白名单 → A3 兜底（系统打开）。
- 上限 `MAX_BINARY_SIZE = 64MB`；`bytes` 以 `ArrayBuffer` 走 Electron 结构化克隆，**不做 base64**。
- 文本路径（现有 `EditorReadFile`）不动；`binary:true` 语义保留，渲染端据此切换视图而非报错。

### 1.2 渲染端组件（renderer）

- 新组件 `components/editor/BinaryFileViewer.tsx`：`React.lazy` 懒加载（首次挂载才拉取 SDK chunk 与解析器），内部用 `@open-file-viewer/react` 的 `FileViewer`：
  - 插件装配为**常量数组**（§选型取舍的五插件），保证未挂载插件模块可被 tree-shaking 剔除；
  - `pdfPlugin({ workerSrc })`——worker 静态资产 `import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.mjs?url"`，禁 CDN；
  - 输入源仅本地字节（`bytes: ArrayBuffer` + `fileName` 推断扩展名），禁用 URL 输入（A5 离线 + 无远程请求）；
  - `theme: appearance === "dark" ? "dark" : "light"` 跟随编辑器现有外观；工具栏 `labels/titles` 全量 i18n（新 keys `editor.preview.*`，六 locale）；
  - `onUnsupported`/`onError` → 自绘兜底态（A3：原因 + 「在系统中打开」，走既有 shell 通道，缺则补窄通道）。
- **构建守护（A6）**：desktop:build 后断言 renderer 依赖图与 dist 不含 `three`/`leaflet`/`hls.js`。SDK 无 subpath exports、未声明 `sideEffects`，esbuild 对纯声明型插件模块通常可剔除未用 re-export；**when 断言失败 → 兜底二选一**：patch 该包 `package.json` 加 `"sideEffects": false`（patch-package / postinstall 脚本），或 vendor fork 进 `vendor-src/`。
- 集成点：`EditorWorkspace.tsx` 现 `state.binary` 分支（701 行附近）由占位文本改为 `<BinaryFileViewer file={activeFile} />`；`use-editor-workspace.ts` 状态机不变。

### 1.3 依赖

| 包 | 版本策略 | 说明 |
| --- | --- | --- |
| `@open-file-viewer/core` | 精确锁（调研时 0.1.3） | 预览核心 + 五插件（React 适配层依赖它） |
| `@open-file-viewer/react` | 精确锁 | React 适配层 |
| `pdfjs-dist` | 精确锁（>=4，SDK optional peer） | pdf 引擎 + worker 资产 |

许可 MIT（open-file-viewer 的 NOTICE 引 Apache-2.0 子件：loading indicator 移植、Material Symbols）——合并时跑 `scripts/vendor-notice.js` 更新 ThirdPartyNotices。已知成本：依赖树安装面 ≈100MB（three 等未挂载格式依赖随包安装，仅 dev/CI 磁盘与时间，不进安装包——前提是 §1.2 构建守护通过）。

## 2. 链路 B：需求文档幻灯片输出

### 2.1 主进程模块 `main/tools/spec-slides.ts`（纯函数 + 一个 IO 壳）

```ts
// 纯函数（单测冷）：
buildSlidesMarkdown(specMd: string, opts: { title: string }): { passthrough: boolean; markdown: string }
renderSpecSlides(specMd: string, opts: { title: string; appearance: "light" | "dark" }): { html: string; css: string; pages: number }
// IO 壳（index.ts handler 内）：
exportSpecHtml(root, artifactId): { ok, path?, blockedRemote? }   // 写 <artifactDir>/slides.html
exportSpecPdf(root, artifactId): { ok, path? }                    // slides.html → printToPDF → slides.pdf
```

- **预处理器（buildSlidesMarkdown）**：检测到既有 `marp: true` front-matter → `passthrough` 直通（作者按原生 marp 语法写的，一字不动）。否则**合成 front-matter**：`marp: true / theme: deeporca / paginate: true / headingDivider: 2` + 首页标题页（`# {title}` + brief/首段）+ spec 原文。关键点：`headingDivider: 2` 是 Marpit 全局指令，官方文档明示效果等价于在每个 `## ` 前手工插 `---`；且它跑在 markdown-it token 流上——围栏代码块整体是 fence token，内部的 `##` 不会产生 heading token，**结构上不可能被切**（无需手写逐行扫描器；落地时以一条单测钉住该行为，若实测失效再降级为 fence-aware 手写切页的备选路径）。
- **外链统计**：预处理阶段统计 spec 内 `https?://` 图片引用数（导出提示与 CSP 阻断共用该计数）。
- **marp 集成**：`@deeporca/desktop` main 依赖 `@marp-team/marp-core`（精确锁 4.x）。`Marp` 实例注册自定义主题 `deeporca`（`marp.themeSet.add(css)`）：产品感 CSS，色值按 `appearance` 烘焙（对齐 `ui.css` tokens 的亮/暗两组常量），含 `section` 排版/分页角标/代码高亮底色。auto-scaling 开启（散文长节自动缩排）。
- **PDF**：`new BrowserWindow({ show: false })` → `loadFile(slidesHtml)` → `webContents.printToPDF({ landscape: true, printBackground: true })` → 写 `<artifactDir>/slides.pdf`。复用桌面端既有 offscreen 窗口纪律（web-fetch-provider 先例）：窗口用完即毁。
- **外链策略（B10）**：默认在导出 HTML 头部注入 CSP `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`；导出时统计 `http(s)` 外链图片数量并在完成提示中列明（i18n）。放行配置项 `design.slidesRemoteImages`（默认 false；开启时按 Mimosa 约束校验 host：仅 http/https，拒绝 localhost/环回/私有/保留地址）。

### 2.2 IPC 与 UI

- `IpcRequest.PrototypeSpecSlides: "prototype:specSlides"`（root, artifactId）→ `{ok, html, css, pages}`；
- `IpcRequest.PrototypeSpecExportSlides: "prototype:specExportSlides"`（root, artifactId, kind: `"html" | "pdf"`）→ `{ok, path?, blockedRemote?: number}`。两通道均走 `resolveRegisteredRoot`。
- `PrototypeWorkspace.tsx` spec tab 加视图段控「文档 | 幻灯片」：幻灯片态渲染 sandbox iframe（`sandbox` 无 allow-scripts，`srcDoc={html + <style>css</style>}`），左右翻页（键盘 ←/→ + 页码指示）；导出两按钮放幻灯片工具条。新 i18n keys：`prototypeWorkspace.slides*`（六 locale）。
- 幻灯片产物（slides.html/pdf）是衍生物：不进 `FILE_BY_PIPELINE` 内容模型、不参与版本 diff；目录内与 `requirement.md` 同级的附属文件（先例一致）。

## 3. 链路 C：落地简报生成器

### 3.1 模块 `main/tools/prototype-brief.ts`（UI-free 纯函数）

```ts
export function buildImplementationBrief(input: {
  kind: "spec" | "openui";
  specMd?: string;          // kind=spec 必填
  openuiSource?: string;    // kind=openui 必填
  title: string;
  brief?: string;
  locale: string;           // 决定模板语言包（zh/en 完整，其余回落 en）
}): { ok: boolean; briefMd?: string; gaps?: string[] };
```

- **输入抽取（spec）**：解析 `## ` 章节 → 每章 = 一屏（章节名即屏幕名）；小节 `### ` = 区块；既有「待确认」清单（PrototypeWorkspace 已有同款解析）注入简报「待确认」附录；`- [ ]` 任务项 → 行为条目。
- **输入抽取（openui，尽力而为）**：从源码提取文本节点/按钮文案/导航目标（`<a>`/router 链接）形成部件清单；**抽不出的结构整体降级为「源码附录」**（C14），禁止语义猜测。
- **节结构（C12 固定六节）**：`目标`（title/brief + 验收要点）→ `屏幕清单`（名称/入口/退出）→ `逐屏布局`（行结构 + 区域词：参照附录 D 措辞，正文零绝对坐标）→ `行为与导航`（每个交互目标必须可解析，见闭环校验）→ `技术栈映射`（DeepOrca openui 栈：组件/样式 token 对应表）→ `落地守则`（真实持久化、按标签补全行为、可用性优先、颜色按 token、完成定义）。
- **闭环校验（C14）**：抽取阶段构建 `screens: Set<string>` 与 `links: Array<{from, to}>`；`to ∉ screens` → `gaps` 收集，非空即 `ok:false` 返回缺口清单（UI 侧 toast/面板展示），不产出简报。
- **语言**：模板串分 `zh`/`en` 两包内置于模块（agent-facing model-speak，C16 不进 i18n catalog）；`locale` 以 `zh` 开头用 zh 包，其余 en 包。

### 3.2 落点与注入

- 产物 `<artifactDir>/brief.md`（附属文件，同 requirement.md 先例；不入版本内容模型）。
- 动作入口：PrototypeWorkspace spec/openui tab 工具条「生成落地简报」按钮 → 触发 `IpcRequest.PrototypeBuildBrief`（新通道，root+artifactId）→ 成功后提示 + 两个后续动作：「注入实现会话」（`api.sendPrompt(briefMd)`，无激活会话或输入框非空时改预填——C15）与「打开 brief.md」（编辑器打开）。
- core 不改动；简报不是 skill 不是 prompt 模板变更，只是工件 + 一次 PromptSend。

## 4. 供应链与合规

- 三组新依赖全部精确锁版本：`@open-file-viewer/*` + `pdfjs-dist`（renderer）、`@marp-team/marp-core`（main）。不引入 m3e-canvas 任何代码；不引入 marp-cli/Puppeteer。
- 许可：MIT（open-file-viewer NOTICE 含 Apache-2.0 子件；marp-core MIT；m3e-canvas 仅方法论不涉许可义务）→ 合并前更新 ThirdPartyNotices（vendor-notice 通道）。
- 离线承诺（A5/B10）：预览解析器与字体资产随包；幻灯片导出默认 CSP 断网；简报生成纯本地。

## 5. 测试策略

- main 纯函数单测（run-tests.mjs）：`spec-slides`（切页边界：代码块内 `##`/front-matter 直通/空 spec）、`prototype-brief`（六节结构快照、闭环缺口拦截、源码附录降级、zh/en 包）、`EditorReadBinary` handler（逃逸拒绝/超限/白名单外/正常字节）。
- renderer 组件测试（dom-harness）：`BinaryFileViewer` 挂载（mock api，断言懒加载与兜底分支）；spec tab 视图切换与 iframe srcDoc 注入。
- 回归按仓库惯例 mutation-check 一次（临时破坏修复点确认测试变红后还原）。
- 构建守护：desktop:build 后断言 renderer 依赖图与 dist 产物不含 `three`/`leaflet`/`hls.js`（A6，未挂载格式引擎不得进入；失败则按 §1.2 兜底：sideEffects 补丁或 vendor fork）、不含 `marp`（B8，marp 只进 main bundle）。

## 附录 D：防塌陷措辞库（m3e-canvas 方法论内化，链路 C 模板素材）

十条原则 → 模板句式（zh 包示例；en 包对应翻译）：

1. **受控词汇**：部件只允许引用映射表内的组件名，映射表随简报输出。
2. **几何→语义**：坐标不出现在正文——「上部居中放置搜索栏。」而非坐标值。
3. **负向禁令**：横排必带「（放在同一行并垂直居中，不要竖着堆叠或换行）」。
4. **复合成组**：「由 A、B、C 横向相连组成的按钮组」——一个组件一次生成。
5. **命名指代**：每个组给稳定名称（「“操作”按钮组」），后续行为条目按名引用。
6. **导航闭环**：「点击后以 slide 过渡跳转到“详情”屏幕」+ 每个 to 必须存在（生成期校验）。
7. **意图直通**：spec/待确认条目原文引用（blockquote），不改写不概括。
8. **语义词↔平台映射**：收尾节给对照表（「同一行 → Row/Flex row；嵌套在内部 → Box/容器覆盖」）。
9. **落地守则**：真实持久化而非假数据；按标签补全缺失行为（“保存”按钮应执行保存）；可用性优先于像素完美；颜色按 token 引用、禁止硬编码色值。
10. **完成定义**：交付可运行构建与验收要点核对，而非片段。
