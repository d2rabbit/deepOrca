# DeepOrca Desktop — Windows 8 磁贴(Metro)主题设计

- 日期:2026-07-21
- 范围:`packages/desktop`(Electron 桌面客户端)
- 目标:为 Windows 平台新增一套以 **Windows 8 磁贴(Metro)为骨架、叠加适度 Fluent 点缀**的主题,与现有 macOS Aqua 主题并存,运行时按平台自动切换。

## 1. 背景与动机

当前桌面客户端(`packages/desktop`)只有一套视觉皮肤:**macOS Aqua 复古主题**(OS X 10.0–10.4 风格)。其特征是 pinstripe 细条纹背景、candy-gel 果冻蓝按钮、左上角红/黄/绿"gumdrop"糖果球窗口控件、持续呼吸的主操作按钮、普遍大圆角与胶囊形 pill 按钮。这套皮肤在 macOS 上是契合的,但在 Windows 上既不符合系统操作习惯(窗口控件在左上角、缺少键盘可达性约定),也不符合 Windows 视觉语言。

本设计为 Windows 平台引入一套**以 Win8 磁贴为骨架、叠加适度 Fluent 点缀**的设计语言:深色背景、彩色磁贴色块、Segoe UI 字体、右上角窗口控件(磁贴骨架),同时叠加 Fluent 元素——**全局统一圆角**(6–8px)、**仅模态框的轻亚克力模糊**、**柔和浅投影**(Fluent 点缀)。骨架保留磁贴的辨识度,点缀带来现代感,避免 Win11 那种全面 Fluent 的甜腻。两套主题并存,跨平台用户各得其所。

## 2. 已确认的决策(来自 brainstorming)

| 决策点 | 选择 | 说明 |
|---|---|---|
| 改造范围 | **平台自适应** | 保留 Aqua(macOS)+ 新增 Metro(Windows),运行时按 `process.platform` 切换 |
| 主题切换机制 | **两份 CSS 文件** | 平台决定加载哪份;`build.mjs` 复制两份,`index.html` 注入对应 `<link>` |
| 窗口控件 | **分平台** | Win:右上角直角最小化/最大化/关闭;Mac:左上角红绿灯。`main` 按 platform 设 `titleBarStyle` |
| 配色基调 | **深色磁贴(经典 Win8)** | 深背景 + 彩色磁贴 + 白字 |
| 实现颗粒度 | **一次性全量** | `styles-metro.css` 从零写完整一套,一次提交,覆盖全部组件 |
| Fluent 融合 | **磁贴为主 + Fluent 点缀** | 骨架保留磁贴(深色/色块/直角控件),叠加适度 Fluent:全局圆角、模态亚克力、柔和投影 |

## 3. 不做什么(YAGNI 边界)

- **不做手动主题切换**。本期只按平台自动切换,不暴露用户可调的"主题"设置项。后续如需可在 Settings 加。
- **不做全面 Win11 Fluent**。Fluent 元素只做**有限点缀**:全局圆角 6–8px、仅模态框的亚克力、柔和浅投影。不做 Mica 质感全屏背景、不做深度多层阴影、不做 Fluent 图标系统、不做窗口控件圆角(控件保持磁贴直角)。
- **不做亮色磁贴变体**。本期只交付深色磁贴一套。
- **不改组件结构与布局**。grid 布局、组件拆分、i18n、IPC 契约都不动;只改视觉层(CSS + 窗口控件渲染 + `main` 的平台分支)。
- **不改 CLI / core / vscode 包**。改动严格限定在 `packages/desktop`。
- **不改构建产物结构**。`dist/` 下仍是 `main.js / preload.cjs / renderer/`,只是 `renderer/` 里多一份 `styles-metro.css`。

### 3.1 Fluent 点缀清单(本期**会**做)

为避免歧义,这里正面列出本期内**允许**的 Fluent 元素,清单外的 Fluent 元素一律不做:

| Fluent 元素 | 是否做 | 应用范围 | 参数 |
|---|---|---|---|
| **圆角(border-radius)** | ✅ 做 | 全局统一(卡片、按钮、磁贴、输入框、会话项、消息气泡、模态框) | 6–8px(容器 8、按钮/磁贴 6) |
| **亚克力(backdrop-filter: blur)** | ✅ 做 | **仅模态框**的遮罩层与模态框本体 | `blur(20px)` + 半透明深色底 |
| **柔和投影(box-shadow)** | ✅ 做 | 卡片(权限/提问/计划)、模态框 | `0 2px 8px rgba(0,0,0,0.3)` |
| **窗口控件圆角** | ❌ 不做 | — | 控件保持磁贴直角 |
| **Mica 全屏背景** | ❌ 不做 | — | 主背景用纯深色实色 |
| **深度多层阴影** | ❌ 不做 | — | 只用单层柔和阴影 |
| **Fluent 图标系统** | ❌ 不做 | — | 沿用现有文字/emoji 标记 |
| **亚克力用于 TopBar/Sidebar** | ❌ 不做 | — | 这些面板纯深色实色,性能与辨识度优先 |

## 4. 架构

### 4.1 平台信息传递

`process.platform` 在主进程,渲染层无法直接读。复用现有 IPC:

- **`IpcRequest.Ready`** 的返回值,从 `{ projectRoot }` 扩展为 `{ projectRoot, platform }`。`platform` 取 `process.platform`(值为 `"win32" | "darwin" | "linux"`)。
- `App.tsx` 启动时从 `api.ready()` 读出 `platform`,存入 state,作为渲染分支依据。
- 这是唯一的 IPC 契约变更,且是**向后兼容的加字段**(`shared/ipc.ts` 里 `ReadyResult` 加可选 `platform`)。

### 4.2 CSS 加载策略

两份独立 CSS,互不干扰:

- `packages/desktop/src/renderer/styles.css` —— 现有 Aqua 主题,**保留不动**(macOS 默认)。
- `packages/desktop/src/renderer/styles-metro.css` —— **新建**,Win8 磁贴主题。

加载方式:**不在 `index.html` 里硬编码 `<link>`**,而是在 `main.tsx`(React 入口)里动态注入。原因:`index.html` 是静态文件,无法在渲染层知道平台前决定加载哪份;而在 `main.tsx` 里 `api.ready()` 已经返回了平台。

```
// main.tsx 伪代码
const { platform } = await api.ready();
const css = platform === "win32" ? "styles-metro.css" : "styles.css";
const link = document.createElement("link");
link.rel = "stylesheet";
link.href = css;
document.head.appendChild(link);
// 之后再 ReactDOM.render(<App />)
```

为避免主题切换前的白屏闪烁(FOUC),`index.html` 的 `<body>` 设一个中性的深色背景兜底(`#1d1d1d`,即 Metro 深色),等 CSS 加载完覆盖。

**CSP 注意**:`index.html` 现有 CSP 是 `style-src 'self' 'unsafe-inline'`,允许 inline style 和 self 的 CSS 文件。动态 `<link>` 加载 `self` 的 CSS 符合 CSP,无需改 CSP。但 `document.head.appendChild(link)` 不涉及 inline style,安全。

### 4.3 构建脚本

`packages/desktop/build.mjs` 现有 renderer 段会 copy `index.html` 和 `styles.css` 到 `dist/renderer/`。需要扩展,把 `styles-metro.css` 也复制过去。具体是在 renderer 的 copy 步骤里加一行 `cp(styles-metro.css → dist/renderer/styles-metro.css)`。不影响 main/preload bundle。

### 4.4 窗口控件分平台

`main/index.ts` 的 `createWindow()`:

- **当前**:`frame: false` + `titleBarStyle: "hidden"`,所有平台一致。
- **改造后**:按 `process.platform` 分支:
  - `win32`:`frame: false`(保持无边框,让渲染层画磁贴控件)。`titleBarStyle` 在 Windows 上不传(Windows 的 `titleBarOverlay` 是 Win10/11 Fluent,不符合本期目标,故不用)。
  - `darwin` / 其它:保持现有 `frame: false` + `titleBarStyle: "hidden"`。
- `backgroundColor` 按 platform 调整:Windows 设 `#1d1d1d`(Metro 深色兜底),macOS 保持 `#e7ecf2`。

渲染层 `TopBar.tsx` 按 `platform` 渲染不同控件组:

- `win32`:控件组放**右侧**(`justify-content: flex-end` 顺序),三个直角按钮:
  - 最小化:`_`(横线),hover 浅色块
  - 最大化:`□`(方框),hover 浅色块
  - 关闭:`✕`(叉),hover **红色块**(`#e81123`,Win 标准关闭红)
  - 按钮 46×32 px(Win 标准触控友好尺寸),无圆角,无 border,hover 整块填色。
  - 控件组容器 `-webkit-app-region: no-drag`,其余 TopBar 区域可拖拽。
- `darwin` / 其它:**保留现有** `gumdrop` 三球(左上)。

### 4.5 文件改动清单

| 文件 | 操作 | 内容 |
|---|---|---|
| `packages/desktop/src/shared/ipc.ts` | 改 | `ReadyResult` 加 `platform: string` 字段 |
| `packages/desktop/src/main/index.ts` | 改 | `createWindow()` 按 platform 分支(frame/backgroundColor);`Ready` handler 返回 `platform` |
| `packages/desktop/src/main/session-bridge.ts` | 不动 | — |
| `packages/desktop/src/preload/index.ts` | 不动 | `ready()` 已是 invoke,无需改 |
| `packages/desktop/src/renderer/main.tsx` | 改 | 启动时按 `platform` 动态注入对应 CSS link,再 mount |
| `packages/desktop/src/renderer/index.html` | 改 | 移除硬编码 `<link href="styles.css">`,body 加深色兜底背景 |
| `packages/desktop/src/renderer/App.tsx` | 改 | `ready()` 读 `platform` 存 state,传给 `TopBar` |
| `packages/desktop/src/renderer/components/TopBar.tsx` | 改 | 按 `platform` 渲染磁贴控件组(右)或 gumdrop(左) |
| `packages/desktop/src/renderer/styles.css` | 不动 | Aqua 主题原封保留 |
| `packages/desktop/src/renderer/styles-metro.css` | **新建** | 完整深色磁贴主题,覆盖全部组件 |
| `packages/desktop/build.mjs` | 改 | renderer copy 步骤加 `styles-metro.css` |

总计:**1 新建 + 6 改 + 其余不动**。核心工作量集中在 `styles-metro.css`(从零写一套完整主题)和 `TopBar.tsx`(双分支控件)。

## 5. Metro 磁贴设计系统

### 5.1 设计原则

1. **磁贴骨架 + Fluent 点缀**。主体保留磁贴语言(扁平色块、无渐变拟物、色块即层级),仅在圆角、模态亚克力、柔和投影三处引入 Fluent 现代感。
2. **全局统一圆角**。容器类(卡片/模态框/消息气泡/输入框)`--metro-radius: 8px`;控件类(按钮/磁贴/会话项)`--metro-radius-sm: 6px`。**例外**:窗口控件(最小化/最大化/关闭)保持**直角**,以保留磁贴辨识度。
3. **扁平色块,不用渐变拟物**。不用径向/线性渐变做立体果冻感(Aqua 的核心特征,彻底抛弃)。强调色用单一实色值。
4. **色块即层级**。不用粗 border 分层,主要用背景色明度差 + 轻投影。深背景上更深的色块 = 凹陷(输入框/代码块),磁贴色块 = 凸起(会话项/卡片)。
5. **柔和投影辅助分层**。卡片和模态框用 `0 2px 8px rgba(0,0,0,0.3)` 单层柔影;会话项、按钮等小元素不用投影,靠色块。
6. **大色块、少留白**。磁贴之间紧贴(2px 缝隙模拟 Win8 磁贴网格),不留大间距。
7. **无装饰动画**。主操作按钮**去掉** `aqua-pulse` 呼吸动画。仅保留功能必要的动画(spinner 旋转、消息进入)。
8. **字体 Segoe UI 优先**。`--sans` 改为 `"Segoe UI", "Segoe UI Variable", -apple-system, ...`。

### 5.2 调色板(深色磁贴)

```
/* 背景层(由深到浅) */
--metro-bg:          #1d1d1d;   /* 主背景(Win8 开始屏幕深) */
--metro-bg-tile:     #2b2b2b;   /* 磁贴/卡片底色 */
--metro-bg-recessed: #131313;   /* 凹陷区(输入框/代码块) */

/* 强调色磁贴(Win8 经典调色板,全部实色) */
--metro-blue:   #1f6fc7;   /* 主操作、选中态、链接(原 #2d8cf0 提暗以适配深底) */
--metro-teal:   #00aba9;   /* 次级强调 */
--metro-green:  #3e8e3e;   /* 成功/工具消息(原 #4caf50 提暗以适配深底) */
--metro-orange: #f0a30a;   /* 警告 */
--metro-red:    #e81123;   /* 关闭按钮 hover、错误 */
--metro-magenta:#b9006c;   /* 系统消息 */

/* 文字(深背景上的明度) */
--metro-text:        #ffffff;   /* 主文字 */
--metro-text-dim:    #c7c7c7;   /* 次要 */
--metro-text-faint:  #8a8a8a;   /* 提示/元信息 */

/* 描边(极少用,仅 hairline 分隔) */
--metro-divider: rgba(255,255,255,0.08);

/* Fluent 点缀 token */
--metro-radius: 8px;        /* 容器类:卡片/模态框/消息气泡/输入框 */
--metro-radius-sm: 6px;     /* 控件类:按钮/磁贴/会话项 */
--metro-shadow: 0 2px 8px rgba(0,0,0,0.3);          /* 卡片/模态柔影 */
--metro-shadow-modal: 0 8px 32px rgba(0,0,0,0.5);   /* 模态框更深的浮起感 */
--metro-acrylic: rgba(29,29,29,0.72);  /* 模态框亚克力底色(配合 backdrop-filter) */

/* 字体 */
--metro-sans: "Segoe UI", "Segoe UI Variable", "Segoe UI Webfont",
              -apple-system, BlinkMacSystemFont, system-ui, Roboto,
              "Microsoft YaHei", Helvetica, Arial, sans-serif;
--metro-mono: Consolas, "Cascadia Code", "SF Mono", Menlo, monospace;
```

注:所有颜色用**实色**,不用渐变。`--metro-blue` 等只用单一色值(`#1f6fc7`),不在磁贴上叠高光。

### 5.3 组件样式映射

每个组件在 Metro 下的视觉规则:

| 组件 | Aqua(现状) | Metro(目标) |
|---|---|---|
| **body 背景** | pinstripe 细条纹 | `--metro-bg` 纯深色 |
| **TopBar** | 渐变标题栏 + 内高光 | 深色条(`#1d1d1d`),底部 1px `--metro-divider`,无渐变 |
| **窗口控件(Win)** | 左上糖果球 | 右上 46×32 **直角**按钮(唯一例外,保留磁贴辨识度),最小化/最大化 hover `#ffffff1a`,关闭 hover `#e81123` |
| **品牌文字** | 深字 + 白投影 | 白字,无投影 |
| **文件夹按钮** | 白→灰渐变胶囊 | 磁贴色块(蓝 `#1f6fc7`),白字,`--metro-radius-sm` 圆角 |
| **model-pill(模型/MCP/设置)** | 白→灰渐变胶囊 | 深色磁贴(`#2b2b2b`),hover 变蓝,`--metro-radius-sm` 圆角 |
| **badge-warn(无 API Key)** | 黄渐变胶囊 | 橙色磁贴(`#f0a30a`),黑字,`--metro-radius-sm` 圆角 |
| **Sidebar 背景** | pinstripe | `--metro-bg` |
| **会话项** | hover 半透明白,选中果冻蓝渐变 | hover `#ffffff14`,选中**实色蓝磁贴**(`#1f6fc7` 白字),`--metro-radius-sm` 圆角,2px 缝隙网格 |
| **btn-new(新会话)** | 果冻蓝胶囊 + 呼吸 | 实色蓝磁贴,`--metro-radius-sm` 圆角,无动画 |
| **status-dot** | 糖果球径向渐变 | 实色小方块(磁贴风格),或实色圆点(无渐变) |
| **消息 user** | 白→浅蓝渐变气泡 + 圆角 | 浅色磁贴(`#2b2b2b`),左边 3px 蓝色竖条强调,`--metro-radius` 圆角 |
| **消息 assistant** | 无背景 | 无背景,白字;gutter 用蓝色图标 |
| **消息 tool** | 无背景 | 左边 3px 绿色竖条,工具名白字加粗,`--metro-radius` 圆角 |
| **思考折叠** | 斜体灰字 | 浅灰磁贴(`#2b2b2b`)折叠块,`--metro-radius-sm` 圆角 |
| **diff** | 左竖线 + 绿红字 | 深背景 + 绿/红实色高亮行(`add` 行底色 `#3e8e3e33`,`del` 行 `#e8112333`) |
| **markdown code** | 浅灰背景圆角 | `--metro-bg-recessed`,`--metro-radius-sm` 圆角 |
| **markdown pre** | 浅灰边框圆角 | `--metro-bg-recessed`,`--metro-radius` 圆角,无边框 |
| **Composer 容器** | 白渐变 + 内高光 | `--metro-bg` 顶部 1px divider |
| **input-row(输入框)** | 白底凹陷圆角 + 聚焦蓝光晕 | `--metro-bg-recessed`,`--metro-radius` 圆角,聚焦时 2px 蓝色实线边框(无光晕) |
| **send-btn** | 果冻蓝 + 呼吸动画 | **实色蓝磁贴**(`#1f6fc7`),白字,`--metro-radius-sm` 圆角,**无动画** |
| **stop-btn** | 红果冻 + 呼吸 | 实色红磁贴(`#e81123`),白字,`--metro-radius-sm` 圆角 |
| **skill chips** | 胶囊,选中果冻蓝 | `--metro-radius-sm` 圆角小块,选中实色蓝,已加载实色紫(`#b9006c`) |
| **Card(权限/提问/计划)** | 白渐变圆角 + 大投影 | 深色磁贴(`#2b2b2b`),`--metro-radius` 圆角,**`--metro-shadow` 柔影**,左边色条强调(权限=橙、提问=蓝、计划=teal) |
| **opt(选项按钮)** | 白渐变圆角,选中果冻蓝 | 深色磁贴,选中实色蓝,`--metro-radius-sm` 圆角 |
| **card-actions primary** | 果冻蓝 + 呼吸 | 实色蓝磁贴,无动画,`--metro-radius-sm` 圆角 |
| **Modal** | pinstripe 圆角 + 大投影 | **亚克力**(`backdrop-filter: blur(20px)` + `--metro-acrylic` 底色),`--metro-radius` 圆角,`--metro-shadow-modal`;遮罩层也带 `blur(8px)` |
| **settings-tab** | 底部蓝下划线 | 实色蓝底白字(选中态整块填色) |
| **滚动条** | 蓝渐变胶囊 | 细深色条(6px),hover 变蓝,无渐变 |
| **:focus-visible** | 蓝色光晕环 | 2px 实色蓝边框(无光晕) |
| **spinner** | 蓝顶圆环 | 保留(功能性动画),色改蓝 |

### 5.4 去动画

- 删除 `@keyframes aqua-pulse` 在 Metro 下的应用(直接不引用)。
- `send-btn`、`card-actions .primary` 在 Metro 下 `animation: none`。
- `@media (prefers-reduced-motion)` 块在 Metro 下整体不需要(因为本来就没动画),但保留兜底。

## 6. 关键实现细节

### 6.1 动态 CSS 注入与 FOUC 防护

`index.html` 移除 `<link rel="stylesheet" href="./styles.css">`,改为:
- `<body>` 内联 `style="background:#1d1d1d"`(Metro 深色兜底)。
- 不预加载任何 CSS。

`main.tsx` 流程:
1. `const { projectRoot, platform } = await api.ready();`
2. 选 CSS 文件:`platform === "win32" ? "./styles-metro.css" : "./styles.css"`。
3. `document.createElement("link")` + 设置 `href`,挂到 `<head>`。
4. 等 `<link>` 的 `onload`(或 `onerror` 兜底用另一份),再 `createRoot(...).render(<App ... />)`。

为防 link 加载失败导致裸 HTML,加 `onerror` 回退到 `styles.css`。

### 6.2 TopBar 双分支控件

`TopBar.tsx` 接收 `platform: string` prop。

- `platform === "win32"`:渲染 `.window-controls.win` —— 右对齐,三个 `.win-ctrl` 按钮(最小化 `─`、最大化 `□`、关闭 `✕`)。关闭按钮加 `.close` 修饰类。
- 其它:保留现有 `.window-controls`(gumdrop 三球)。

CSS 选择器:
- Aqua `styles.css` 里 `.gumdrop` 等规则**不动**。
- Metro `styles-metro.css` 里写 `.win-ctrl` 规则;同时**覆盖** `.topbar`、`.model-pill` 等(因两份 CSS 类名相同,Metro 文件后加载,覆盖 Aqua)。注意:`main.tsx` 只加载其中一份,所以不存在"Aqua 先加载、Metro 覆盖"的层叠问题——**任一时刻只有一份 CSS 在生效**。

### 6.3 main 进程平台分支

```ts
function createWindow(): void {
  const isWin = process.platform === "win32";
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: isWin ? "#1d1d1d" : "#e7ecf2",
    title: "DeepOrca",
    autoHideMenuBar: true,
    frame: false,
    // 两边都用 hidden + 自绘控件:Mac 走 gumdrop(左上),Win 走磁贴控件(右上)。
    // 不用 Windows 的 titleBarOverlay(那是 Fluent,本期目标是 Win8 磁贴)。
    titleBarStyle: "hidden",
    webPreferences: { ... },
  });
  ...
}
```

注:Windows 上 `titleBarStyle: "hidden"` 等价于无边框(没有 Mac 的Inset 效果),配合 `frame:false` 即可。不使用 Windows 的 `titleBarOverlay`(那是 Fluent,不符合本期目标)。

`Ready` handler 改:
```ts
handle(IpcRequest.Ready, () => ({
  projectRoot: getBridge().projectRoot,
  platform: process.platform,
}));
```

### 6.4 build.mjs 改动

renderer 的 copy 段(现有 copy `index.html`、`styles.css`)增加:
```js
await cp(resolve(__dirname, "src/renderer/styles-metro.css"), resolve(outdir, "renderer/styles-metro.css"));
```

dev 模式(`--dev`)同样要 copy,因为 renderer 是从 `dist/renderer/` 加载的。

## 7. 测试与验证

由于 `desktop` 包当前**没有测试**(`package.json` 无 `test` 脚本),验证以手动 + 类型检查为主:

1. **类型检查**:`npm run typecheck --workspace @deeporca/desktop` 必须通过。重点 `ipc.ts` 的 `ReadyResult` 改动、`App.tsx` / `TopBar.tsx` 的新 prop。
2. **构建**:`npm run desktop:build` 必须成功,`dist/renderer/` 下应同时存在 `styles.css` 和 `styles-metro.css`。
3. **Windows 手动验证**(核心):
   - `npm run desktop:start`,窗口背景为深色,无白屏闪烁。
   - 窗口控件在**右上角**,最小化/最大化/关闭分别生效;关闭按钮 hover 变红。**控件保持直角**(圆角唯一例外)。
   - 标题栏可拖拽移动窗口;控件区不触发拖拽。
   - **全局圆角**:卡片、按钮、磁贴、输入框、会话项、消息气泡均有 6–8px 圆角;唯独窗口控件是直角。
   - 会话项选中为实色蓝磁贴;新会话按钮为蓝色圆角磁贴。
   - 发送按钮为实色蓝、**无呼吸动画**;聚焦输入框为蓝色实线边框(无光晕)。
   - 消息区:user 消息左侧蓝色竖条、tool 消息左侧绿色竖条;diff 行绿/红底色。
   - 卡片(权限/提问/计划)有柔和浅投影(`0 2px 8px rgba(0,0,0,0.3)`)。
   - 模态框(模型/MCP/设置)呈现**亚克力模糊**背后的内容透出感、圆角、深投影;文字清晰可读。在禁用 GPU 加速的环境(--disable-gpu)下应回退为半透明纯色底(不模糊),不崩。
4. **macOS 手动验证**(回归):
   - `npm run desktop:start`,视觉与改造前**完全一致**(gumdrop、pinstripe、果冻按钮、呼吸动画都在)。
   - 确认 `styles.css` 未被触碰。
5. **Linux**:行为同 macOS(走 Aqua 分支),作为兜底验证无崩溃即可。

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 动态 CSS 加载失败导致裸页 | `onerror` 回退到 `styles.css`;`index.html` body 深色兜底背景 |
| FOUC(先白屏后变深) | `index.html` body 内联深色背景;`main.tsx` 等 CSS load 完再 render |
| `styles-metro.css` 漏覆盖某个组件,显示异常 | 5.3 节组件映射表逐项核对;全量一次性提交降低遗漏 |
| Windows 上 `titleBarStyle` 行为差异 | 两边都用 `frame:false` + 自绘,不依赖系统标题栏 |
| **亚克力 `backdrop-filter` 在低 GPU/虚拟机失效** | 用 `@supports (backdrop-filter: blur(1px))` 包裹;不支持时回退到 `--metro-acrylic` 半透明纯色底(不模糊),视觉略差但不破 |
| **亚克力下文字对比度下降** | 模态框用 `--metro-acrylic: rgba(29,29,29,0.72)` 较高不透明度;文字保持 `--metro-text`(#fff),确保 ≥4.5:1 |
| 两份 CSS 后续维护不同步(改了组件忘改另一份) | 接受;后续若频繁改可考虑抽公共部分,本期不做 |
| 改 `ReadyResult` IPC 契约影响其它消费者 | 仅 renderer `App.tsx` 消费 `ready()`,且为加字段非改字段,兼容 |

## 9. 后续(不在本期)

- 在 Settings 加"主题"下拉(自动/Aqua/Metro),支持手动覆盖平台默认。
- 亮色磁贴变体(Win8.1 桌面风格)。
- Windows 触控优化(磁贴尺寸放大、手势)。
- 高对比度模式辅助。
