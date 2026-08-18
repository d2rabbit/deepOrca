# Windows 8 Metro/Fluent 主题 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 DeepOrca Desktop 新增一套以 Win8 磁贴为骨架、叠加适度 Fluent 点缀的深色主题,运行时按平台自适应(win→Metro / mac→Aqua)。

**Architecture:** 7 步自底向上:先打通 IPC 管道把 `process.platform` 传给渲染层(ipc.ts → main/index.ts),再建立动态 CSS 加载机制(main.tsx + index.html),编平台感知的控件(TopBar.tsx + App.tsx),最后从零写出完整的 `styles-metro.css`。Aqua 主题的 `styles.css` 零改动。

**Tech Stack:** TypeScript (strict), React 19, Electron 33, esbuild, plain CSS (无预处理器)。

**依赖顺序:**
```
Task 1 (ipc.ts) ─┬─→ Task 3 (main/index.ts)
                 ├─→ Task 5 (main.tsx) ←─ Task 4 (index.html)
                 └─→ Task 6 (App.tsx → TopBar.tsx)
Task 2 (build.mjs) —— 独立
Task 7 (styles-metro.css) —— 独立,最后做
```

---

### Task 1: IPC 契约 — `ReadyResult` 加 `platform` 字段

**Files:**
- Modify: `packages/desktop/src/shared/ipc.ts:131`

- [ ] **Step 1: 改 `DesktopApi.ready()` 的返回值类型**

第 131 行,从:
```ts
ready(): Promise<{ projectRoot: string }>;
```
改为:
```ts
ready(): Promise<{ projectRoot: string; platform: NodeJS.Platform }>;
```

`NodeJS.Platform` 是 `"win32" | "darwin" | "linux" | ...`,来自 `@types/node`,Electron 的 `process.platform` 返回的就是这个类型。

- [ ] **Step 2: 类型检查**

```bash
npm run typecheck --workspace @deeporca/desktop
```
预期:PASS(当前只有声明,main 进程 handler 还没改,类型可能报 handler 返回缺少 `platform`——属于预期,Task 3 补齐后消除)。

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/shared/ipc.ts
git commit -m "feat(desktop): add platform field to ReadyResult IPC contract"
```

---

### Task 2: 构建脚本 — 复制 `styles-metro.css` 到 `dist/`

**Files:**
- Modify: `packages/desktop/build.mjs:67-71`

- [ ] **Step 1: 扩展 `copyStaticAssets`**

当前 `copyStaticAssets`:
```js
async function copyStaticAssets() {
  await mkdir(resolve(outdir, "renderer"), { recursive: true });
  await cp(resolve(__dirname, "src/renderer/index.html"), resolve(outdir, "renderer/index.html"));
  await cp(resolve(__dirname, "src/renderer/styles.css"), resolve(outdir, "renderer/styles.css"));
}
```

改为:
```js
async function copyStaticAssets() {
  await mkdir(resolve(outdir, "renderer"), { recursive: true });
  await cp(resolve(__dirname, "src/renderer/index.html"), resolve(outdir, "renderer/index.html"));
  await cp(resolve(__dirname, "src/renderer/styles.css"), resolve(outdir, "renderer/styles.css"));
  await cp(resolve(__dirname, "src/renderer/styles-metro.css"), resolve(outdir, "renderer/styles-metro.css"));
}
```

这确保 dev(`--dev`) 和生产构建都会复制 `styles-metro.css`。`styles-metro.css` 此时还不存在(Task 7 创建),构建脚本在 `styles-metro.css` 缺失时 `cp` 会报错。为了在 Task 7 前还能构建,改为 **条件复制**(文件存在时才复制):

```js
async function copyStaticAssets() {
  await mkdir(resolve(outdir, "renderer"), { recursive: true });
  await cp(resolve(__dirname, "src/renderer/index.html"), resolve(outdir, "renderer/index.html"));
  await cp(resolve(__dirname, "src/renderer/styles.css"), resolve(outdir, "renderer/styles.css"));
  // styles-metro.css 为新建文件,构建时若不存在则跳过(不报错)
  const metroCss = resolve(__dirname, "src/renderer/styles-metro.css");
  if (existsSync(metroCss)) {
    await cp(metroCss, resolve(outdir, "renderer/styles-metro.css"));
  }
}
```

顶部已有 `import { cp, mkdir } from "node:fs/promises";`,需追加 `existsSync`:
```js
import { existsSync } from "node:fs";
```

- [ ] **Step 2: 验证构建**

```bash
npm run desktop:build
```
预期:PASS,`dist/renderer/` 下存在 `index.html` 和 `styles.css`;`styles-metro.css` 因尚不存在被跳过,无报错。

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/build.mjs
git commit -m "feat(desktop): conditionally copy styles-metro.css to dist in build script"
```

---

### Task 3: 主进程 — 平台感知窗口 + Ready handler 返回 platform

**Files:**
- Modify: `packages/desktop/src/main/index.ts`

- [ ] **Step 1: `createWindow()` 按平台设背景色**

当前 `createWindow()`:
```ts
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#e7ecf2",
    title: "DeepOrca",
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
```

改为(仅加一行 `backgroundColor` 条件):
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
    // 两边都用 hidden + 自绘控件 — Mac 走 gumdrop(左上),Win 走磁贴控件(右上)。
    // 不用 Windows 的 titleBarOverlay(那是 Fluent,本期目标是 Win8 磁贴)。
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
```

- [ ] **Step 2: `Ready` handler 返回 `platform`**

当前 `registerIpc()` 中的 Ready handler:
```ts
handle(IpcRequest.Ready, () => ({ projectRoot: getBridge().projectRoot }));
```

改为:
```ts
handle(IpcRequest.Ready, () => ({
  projectRoot: getBridge().projectRoot,
  platform: process.platform,
}));
```

- [ ] **Step 3: 类型检查**

```bash
npm run typecheck --workspace @deeporca/desktop
```
预期:PASS(Task 1 加了 `platform` 字段,现在 handler 补齐了,类型约束满足)。

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/main/index.ts
git commit -m "feat(desktop): platform-aware window bg color and Ready handler returns platform"
```

---

### Task 4: index.html — 移除硬编码 CSS link,加深色兜底背景

**Files:**
- Modify: `packages/desktop/src/renderer/index.html`

- [ ] **Step 1: 改写 body 背景和去掉 `<link>`**

当前:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DeepOrca</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./renderer.js"></script>
  </body>
</html>
```

改为(移除 `<link>`,`<body>` 内联深色背景兜底):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DeepOrca</title>
    <!-- CSS 由 main.tsx 按平台动态注入,此处不再硬编码 -->
  </head>
  <body style="background:#1d1d1d;margin:0">
    <div id="root"></div>
    <script type="module" src="./renderer.js"></script>
  </body>
</html>
```

`style="background:#1d1d1d;margin:0"` 用 Metro 深色做 FOUC 防护——CSS 加载前的极短时间窗口,用户不会看到白屏闪。`margin:0` 避免 body 默认 8px margin。

- [ ] **Step 2: 构建验证**

```bash
npm run desktop:build
```
预期:PASS,`dist/renderer/index.html` 不含 `<link rel="stylesheet">`,body 带内联 style。

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/index.html
git commit -m "feat(desktop): remove hardcoded CSS link, add dark body fallback for FOUC prevention"
```

---

### Task 5: main.tsx — 动态 CSS 注入 + 等 CSS 加载完再 mount

**Files:**
- Modify: `packages/desktop/src/renderer/main.tsx`

- [ ] **Step 1: 重写 `main.tsx`**

当前(简单粗暴直接 mount):
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>
);
```

改为(动态 CSS 注入后再 mount):
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { api } from "./api";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

function injectStylesheet(href: string): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => {
      // 回退到 Aqua 主题,保证页面不裸奔
      if (href !== "./styles.css") {
        injectStylesheet("./styles.css").then(resolve);
      } else {
        // 连 Aqua 都加载失败,认命,直接 mount
        console.error("[desktop] failed to load any stylesheet");
        resolve();
      }
    };
    document.head.appendChild(link);
  });
}

async function bootstrap(): Promise<void> {
  const { platform } = await api.ready();
  const cssFile = platform === "win32" ? "./styles-metro.css" : "./styles.css";
  await injectStylesheet(cssFile);
  createRoot(container!).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>
  );
}

void bootstrap();
```

**关键点:**
- `api.ready()` 在这里被调用一次,拿到 `platform` 选择 CSS。`App.tsx` 内部也会调 `api.ready()`(拿 `projectRoot`),两次调用无害——main 进程 handler 幂等。
- `injectStylesheet` 用 Promise 封装 `<link>` 的 load/error 事件,确保 CSS 完全加载后才 mount React,消除 FOUC。
- `onerror` 回退逻辑:如果 Metro CSS 加载失败(比如文件被误删),回退到 Aqua 保证能运行。

- [ ] **Step 2: 类型检查**

```bash
npm run typecheck --workspace @deeporca/desktop
```
预期:PASS。`api.ready()` 现在返回 `{ projectRoot, platform }`,解构 `platform` 合法。

- [ ] **Step 3: 构建验证**

```bash
npm run desktop:build
```
预期:PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/main.tsx
git commit -m "feat(desktop): dynamic CSS injection by platform with FOUC-safe bootstrap"
```

---

### Task 6: App.tsx + TopBar.tsx — 平台传参 + 双分支窗口控件

**Files:**
- Modify: `packages/desktop/src/renderer/App.tsx`
- Modify: `packages/desktop/src/renderer/components/TopBar.tsx`

- [ ] **Step 1: `App.tsx` — 读 `platform` 存 state,传给 TopBar**

当前 App.tsx 第 56–57 行:
```tsx
const [projectRoot, setProjectRoot] = useState("");
const [settings, setSettings] = useState<SettingsSummary | null>(null);
```

在其后新增:
```tsx
const [platform, setPlatform] = useState<string>("");
```

当前第 127–138 行的 `useEffect` 启动代码中 `api.ready()` 调用:
```tsx
const { projectRoot: root } = await api.ready();
if (disposed) return;
setProjectRoot(root);
```

改为:
```tsx
const { projectRoot: root, platform: plat } = await api.ready();
if (disposed) return;
setProjectRoot(root);
setPlatform(plat);
```

当前 TopBar 的 render(第 392 行):
```tsx
<TopBar
  projectRoot={projectRoot}
  settings={settings}
  mcpCount={mcpStatuses.length}
  onPickFolder={() => void handlePickFolder()}
  onOpenModel={() => setModal("model")}
  onOpenMcp={() => setModal("mcp")}
  onOpenSettings={() => void handleOpenSettings()}
/>
```

改为(加 `platform` prop):
```tsx
<TopBar
  platform={platform}
  projectRoot={projectRoot}
  settings={settings}
  mcpCount={mcpStatuses.length}
  onPickFolder={() => void handlePickFolder()}
  onOpenModel={() => setModal("model")}
  onOpenMcp={() => setModal("mcp")}
  onOpenSettings={() => void handleOpenSettings()}
/>
```

- [ ] **Step 2: `TopBar.tsx` — 加 `platform` prop + 双分支渲染控件**

当前 Props(第 6–14 行):
```tsx
type Props = {
  projectRoot: string;
  settings: SettingsSummary | null;
  mcpCount: number;
  onPickFolder: () => void;
  onOpenModel: () => void;
  onOpenMcp: () => void;
  onOpenSettings: () => void;
};
```

改为:
```tsx
type Props = {
  platform: string;
  projectRoot: string;
  settings: SettingsSummary | null;
  mcpCount: number;
  onPickFolder: () => void;
  onOpenModel: () => void;
  onOpenMcp: () => void;
  onOpenSettings: () => void;
};
```

解构加 `platform`:
```tsx
export function TopBar({
  platform,
  projectRoot,
  settings,
  mcpCount,
  onPickFolder,
  onOpenModel,
  onOpenMcp,
  onOpenSettings,
}: Props): JSX.Element {
```

当前 `.window-controls` 块(第 36–55 行):
```tsx
<div className="window-controls">
  <button className="gumdrop close" ... />
  <button className="gumdrop min" ... />
  <button className="gumdrop zoom" ... />
</div>
```

改为双分支——Win 平台渲染磁贴控件,其余平台保持 gumdrop:
```tsx
{platform === "win32" ? (
  <div className="window-controls win">
    <button
      className="win-ctrl min"
      aria-label={t("window.minimize")}
      title={t("window.minimize")}
      onClick={() => void api.minimizeWindow()}
    >
      &#x2014;
    </button>
    <button
      className="win-ctrl max"
      aria-label={t("window.zoom")}
      title={t("window.zoom")}
      onClick={() => void api.toggleMaximizeWindow()}
    >
      &#x25A1;
    </button>
    <button
      className="win-ctrl close"
      aria-label={t("window.close")}
      title={t("window.close")}
      onClick={() => void api.closeWindow()}
    >
      &#x2715;
    </button>
  </div>
) : (
  <div className="window-controls">
    <button className="gumdrop close" aria-label={t("window.close")} title={t("window.close")} onClick={() => void api.closeWindow()} />
    <button className="gumdrop min" aria-label={t("window.minimize")} title={t("window.minimize")} onClick={() => void api.minimizeWindow()} />
    <button className="gumdrop zoom" aria-label={t("window.zoom")} title={t("window.zoom")} onClick={() => void api.toggleMaximizeWindow()} />
  </div>
)}
```

**字符说明:**`&#x2014;` = `—`(破折号,最小化)、`&#x25A1;` = `□`(空心方框,最大化)、`&#x2715;` = `✕`(乘法叉,关闭)。用 HTML entities 避免 JSX 里直接写 Unicode 的编码问题。

- [ ] **Step 3: 类型检查**

```bash
npm run typecheck --workspace @deeporca/desktop
```
预期:PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/App.tsx packages/desktop/src/renderer/components/TopBar.tsx
git commit -m "feat(desktop): platform-aware TopBar with Win metro controls vs Mac gumdrop"
```

---

### Task 7: styles-metro.css — 完整深色 Metro/Fluent 主题

**Files:**
- Create: `packages/desktop/src/renderer/styles-metro.css`

这是工作量最大的一步——从零写一套完整样式,覆盖所有组件。按 `styles.css`(Aqua)的结构顺序,逐段改写为 Metro/Fluent 风格。

**设计参数速查(来自 spec):**
- 背景:深色 `#1d1d1d`,磁贴 `#2b2b2b`,凹陷 `#131313`
- 圆角:容器 `8px`,控件 `6px`,窗口控件 `0px`(唯一例外)
- 投影:卡片 `0 2px 8px rgba(0,0,0,0.3)`,模态 `0 8px 32px rgba(0,0,0,0.5)`
- 亚克力:仅模态框 `backdrop-filter: blur(20px)` + `rgba(29,29,29,0.72)`
- 强调色:蓝 `#1f6fc7`、绿 `#3e8e3e`、红 `#e81123`、橙 `#f0a30a`、紫 `#b9006c`、teal `#00aba9`
- 字体:`Segoe UI` 优先,等宽 `Consolas`
- 禁止:渐变、呼吸动画、径向高光
- 滚动条:6px 深色细条

- [ ] **Step 1: 写 CSS 变量 + reset**

```css
/* ===========================================================================
   Metro + Fluent 点缀 — Windows 8 磁贴骨架叠加适度现代感

   骨架规则(Win8 Metro):
   - 深色纯色背景(#1d1d1d),无 pinstripe 条纹
   - 扁平色块分层,无渐变拟物
   - Segoe UI 字体
   - 磁贴式 2px 缝隙网格
   - 主按钮无呼吸动画
   Fluent 点缀:
   - 全局统一圆角 6–8px(窗口控件除外——保持直角)
   - 仅模态框的轻亚克力模糊
   - 卡片和模态框的柔和浅投影
   =========================================================================== */

:root {
  /* 背景层 */
  --metro-bg:          #1d1d1d;
  --metro-bg-tile:     #2b2b2b;
  --metro-bg-recessed: #131313;

  /* 强调色磁贴(全部实色,无渐变) */
  --metro-blue:      #1f6fc7;
  --metro-teal:      #00aba9;
  --metro-green:     #3e8e3e;
  --metro-orange:    #f0a30a;
  --metro-red:       #e81123;
  --metro-magenta:   #b9006c;

  /* 文字 */
  --metro-text:       #ffffff;
  --metro-text-dim:   #c7c7c7;
  --metro-text-faint: #8a8a8a;

  /* 分隔 */
  --metro-divider: rgba(255,255,255,0.08);

  /* Fluent 点缀 token */
  --metro-radius: 8px;
  --metro-radius-sm: 6px;
  --metro-shadow: 0 2px 8px rgba(0,0,0,0.3);
  --metro-shadow-modal: 0 8px 32px rgba(0,0,0,0.5);
  --metro-acrylic: rgba(29,29,29,0.72);

  /* 字体 */
  --metro-sans: "Segoe UI", "Segoe UI Variable", -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Microsoft YaHei", Helvetica, Arial, sans-serif;
  --metro-mono: Consolas, "Cascadia Code", "SF Mono", Menlo, monospace;
}

* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }

body {
  background: var(--metro-bg);
  color: var(--metro-text);
  font-family: var(--metro-sans);
  font-size: 13.5px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}

button {
  font-family: inherit;
  cursor: pointer;
  border: none;
}

/* 聚焦 — 2px 实色蓝边框,无光晕 */
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--metro-blue);
}
```

- [ ] **Step 2: 写 TopBar 样式**

```css
/* ── Layout ─────────────────────────────────────────────── */
.app {
  display: grid;
  grid-template-columns: 260px 1fr;
  grid-template-rows: 38px 1fr;
  grid-template-areas:
    "topbar topbar"
    "sidebar main";
  height: 100%;
  background: var(--metro-bg);
}

/* ── Title bar ─────────────────────────────────────────── */
.topbar {
  grid-area: topbar;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  background: var(--metro-bg);
  border-bottom: 1px solid var(--metro-divider);
  -webkit-app-region: drag;
}
.topbar button,
.topbar .model-pill,
.topbar .folder,
.window-controls {
  -webkit-app-region: no-drag;
}

/* 品牌 */
.brand {
  font-weight: 700;
  letter-spacing: 0.2px;
  color: var(--metro-text);
}
.brand .dim {
  color: var(--metro-text-faint);
  font-weight: 500;
}
.topbar .spacer { flex: 1; }

/* 文件夹按钮 — 蓝色磁贴 */
.folder {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 360px;
  padding: 3px 10px;
  background: var(--metro-blue);
  border-radius: var(--metro-radius-sm);
  color: #fff;
  font-family: var(--metro-mono);
  font-size: 11.5px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.folder:hover {
  background: #247dd4;
}

/* 模型/MCP/设置 — 深色磁贴 pill */
.model-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  background: var(--metro-bg-tile);
  border-radius: var(--metro-radius-sm);
  color: var(--metro-text);
  font-size: 12px;
}
.model-pill:hover {
  background: var(--metro-blue);
  color: #fff;
}
.model-pill:active {
  background: #1859a8;
}
.model-pill .think {
  color: var(--metro-blue);
  font-size: 11px;
}
.model-pill:hover .think {
  color: rgba(255,255,255,0.85);
}

/* 无 API Key 警告 — 橙色磁贴 */
.badge-warn {
  font-size: 12px;
}
button.badge-warn {
  color: #1d1d1d;
  background: var(--metro-orange);
  border-radius: var(--metro-radius-sm);
  padding: 4px 12px;
  font-weight: 600;
}
button.badge-warn:hover {
  filter: brightness(1.1);
}
```

- [ ] **Step 3: 写窗口控件样式(Win 磁贴直角)**

```css
/* ── Win 磁贴窗口控件(右上角,直角) ───── */
.window-controls.win {
  display: flex;
  align-items: center;
  gap: 0;
  margin-left: auto;
}
.win-ctrl {
  width: 46px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--metro-text);
  font-size: 12px;
  border-radius: 0;
  padding: 0;
}
.win-ctrl:hover {
  background: rgba(255,255,255,0.1);
}
.win-ctrl.close:hover {
  background: var(--metro-red);
  color: #fff;
}

/* ── Mac gumdrop 控件(保留,不重写) ── */
/* Aqua 的 .gumdrop 规则在 styles.css,这里不重复。 */
/* Win 平台不会加载 styles.css,所以 gumdrop 不会出现。 */
```

注意:由于 Metro 样式只覆盖 `.win-ctrl`,不需要写 `.gumdrop` 规则——Win 平台不会加载 `styles.css`,也就没有 gumdrop 样式;但 `TopBar.tsx` 的 else 分支仍然渲染 gumdrop HTML,**需要在 Metro CSS 里加一个兜底:**给 `.gumdrop` 一个最小样式,防止 Mac 用户意外看到裸 button。

但实际上根据架构,**任一时刻只有一份 CSS 生效**,Win 平台加载 Metro → gumdrop HTML 不会出现(因为 TopBar 的 ternary 走 `.win-ctrl` 分支)。所以不需要兜底。

- [ ] **Step 4: 写 Sidebar 样式**

```css
/* ── Sidebar ─────────────────────────────────────────── */
.sidebar {
  grid-area: sidebar;
  background: var(--metro-bg);
  border-right: 1px solid var(--metro-divider);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
}
.sidebar-head span {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--metro-text-faint);
}

/* 新会话按钮 — 蓝色磁贴 */
.btn-new {
  color: #fff;
  background: var(--metro-blue);
  border-radius: var(--metro-radius-sm);
  padding: 4px 12px;
  font-weight: 600;
  font-size: 12px;
}
.btn-new:hover {
  background: #247dd4;
}

.session-list {
  overflow-y: auto;
  padding: 4px 8px 12px;
  flex: 1;
  min-height: 0;
}

/* 会话项 — 2px 磁贴缝隙 */
.session-item {
  padding: 7px 10px;
  border-radius: var(--metro-radius-sm);
  margin-bottom: 2px;
  cursor: pointer;
  color: var(--metro-text);
}
.session-item:hover {
  background: rgba(255,255,255,0.08);
}

/* 选中态 — 实色蓝磁贴 */
.session-item.active {
  color: #fff;
  background: var(--metro-blue);
}

.session-title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 3px;
  font-size: 11px;
  color: var(--metro-text-faint);
}
.session-item.active .session-meta {
  color: rgba(255,255,255,0.8);
}

.session-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.session-actions button {
  background: var(--metro-bg-tile);
  color: var(--metro-text-dim);
  border-radius: var(--metro-radius-sm);
  font-size: 11px;
  padding: 2px 10px;
}
.session-item.active .session-actions button {
  background: rgba(255,255,255,0.2);
  color: #fff;
}
.session-actions button:hover {
  background: var(--metro-red);
  color: #fff;
}

/* 状态点 — 实色方块(磁贴风) */
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
  background: var(--metro-text-faint);
}
.status-dot.completed { background: var(--metro-green); }
.status-dot.running,
.status-dot.compacting,
.status-dot.processing,
.status-dot.pending { background: var(--metro-orange); }
.status-dot.error,
.status-dot.interrupted,
.status-dot.failed,
.status-dot.permission_denied { background: var(--metro-red); }
.status-dot.ask_permission,
.status-dot.waiting_for_user { background: var(--metro-blue); }
.status-dot.idle { background: var(--metro-text-faint); }
```

- [ ] **Step 5: 写 Message / 消息区样式**

```css
/* ── Main / chat ─────────────────────────────────────────── */
.main {
  grid-area: main;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--metro-bg);
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px 8px;
  min-height: 0;
}
.messages-inner {
  max-width: 860px;
  margin: 0 auto;
}

.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--metro-text-dim);
  text-align: center;
}
.empty-state h1 {
  font-size: 34px;
  margin: 0;
  color: var(--metro-blue);
}
.empty-state .tips {
  font-size: 13px;
  color: var(--metro-text-faint);
}

/* 消息行 */
.msg {
  margin-bottom: 16px;
  display: flex;
  gap: 10px;
}
.msg .gutter {
  flex: 0 0 20px;
  padding-top: 1px;
  font-size: 15px;
  text-align: center;
  user-select: none;
}
.msg .body {
  flex: 1;
  min-width: 0;
}

/* User 消息 — 左边蓝色竖条强调 */
.msg.user .body {
  background: var(--metro-bg-tile);
  border-left: 3px solid var(--metro-blue);
  border-radius: 0 var(--metro-radius) var(--metro-radius) 0;
  padding: 8px 12px;
  color: var(--metro-text);
}
.msg.user .gutter {
  color: var(--metro-blue);
}
.msg.assistant .gutter {
  color: var(--metro-blue);
}
.msg.tool .gutter {
  color: var(--metro-green);
}
.msg.tool.err .gutter {
  color: var(--metro-red);
}

/* 工具消息 — 左边绿色/红色竖条 */
.tool-line {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.tool-name {
  font-weight: 600;
}
.tool-params {
  color: var(--metro-text-dim);
  font-family: var(--metro-mono);
  font-size: 12.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
.tool-result {
  margin-top: 6px;
  border-left: 2px solid var(--metro-divider);
  padding-left: 10px;
}
.tool-result .label {
  color: var(--metro-text-faint);
  font-size: 11px;
  margin-bottom: 2px;
}

/* Diff — 绿/红行底色 */
.diff {
  font-family: var(--metro-mono);
  font-size: 12.5px;
  border-left: 2px solid var(--metro-divider);
  padding-left: 10px;
  margin-top: 6px;
  white-space: pre-wrap;
}
.diff .add { color: var(--metro-green); }
.diff .del { color: var(--metro-red); }
.diff .ctx { color: var(--metro-text-faint); }

/* 思考折叠 — 磁贴块 */
.thinking {
  color: var(--metro-text-dim);
  font-style: italic;
}
.thinking summary {
  cursor: pointer;
  color: var(--metro-text-faint);
  list-style: none;
}
.thinking summary::marker { content: ""; }
.thinking[open] summary {
  margin-bottom: 6px;
}

/* 系统消息 */
.system-note {
  color: var(--metro-magenta);
  font-size: 12.5px;
}

/* Markdown */
.md { overflow-wrap: anywhere; }
.md > *:first-child { margin-top: 0; }
.md > *:last-child { margin-bottom: 0; }
.md p { margin: 6px 0; }
.md h1, .md h2, .md h3 { margin: 14px 0 6px; line-height: 1.3; }
.md code {
  font-family: var(--metro-mono);
  font-size: 12.5px;
  background: var(--metro-bg-recessed);
  padding: 1px 5px;
  border-radius: var(--metro-radius-sm);
}
.md pre {
  background: var(--metro-bg-recessed);
  border-radius: var(--metro-radius);
  padding: 12px 14px;
  overflow-x: auto;
}
.md pre code {
  background: none;
  padding: 0;
}
.md a { color: var(--metro-blue); }
.md ul, .md ol { padding-left: 22px; margin: 6px 0; }
.md table { border-collapse: collapse; margin: 8px 0; }
.md th, .md td {
  border: 1px solid var(--metro-divider);
  padding: 4px 10px;
}
.md blockquote {
  border-left: 3px solid var(--metro-divider);
  margin: 8px 0;
  padding-left: 12px;
  color: var(--metro-text-dim);
}
```

- [ ] **Step 6: 写 Composer(输入区)样式**

```css
/* ── Composer ────────────────────────────────────────────── */
.composer {
  border-top: 1px solid var(--metro-divider);
  background: var(--metro-bg);
  padding: 12px 28px 16px;
}
.composer-inner {
  max-width: 860px;
  margin: 0 auto;
}

.status-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 20px;
  margin-bottom: 8px;
  font-size: 12.5px;
  color: var(--metro-text-dim);
}

/* Spinner — 保留功能性动画 */
.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--metro-divider);
  border-top-color: var(--metro-blue);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.err-strip { color: var(--metro-red); }

/* 输入框 — 凹陷深色,圆角,聚焦实线蓝边 */
.input-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  background: var(--metro-bg-recessed);
  border: 1px solid var(--metro-bg-tile);
  border-radius: var(--metro-radius);
  padding: 8px 10px;
}
.input-row:focus-within {
  border-color: var(--metro-blue);
}

textarea.prompt {
  flex: 1;
  resize: none;
  background: transparent;
  border: none;
  outline: none;
  color: var(--metro-text);
  font-family: var(--metro-sans);
  font-size: 14px;
  line-height: 1.5;
  max-height: 220px;
}
textarea.prompt::placeholder {
  color: var(--metro-text-faint);
}

/* 发送按钮 — 实色蓝磁贴,无动画 */
.send-btn,
.stop-btn {
  border-radius: var(--metro-radius-sm);
  padding: 8px 18px;
  font-weight: 600;
  font-size: 13px;
}
.send-btn {
  color: #fff;
  background: var(--metro-blue);
}
.send-btn:hover {
  background: #247dd4;
}
.send-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
  background: var(--metro-text-faint);
}

/* 停止按钮 — 实色红磁贴 */
.stop-btn {
  color: #fff;
  background: var(--metro-red);
}
.stop-btn:hover {
  background: #cf0e20;
}

.composer-hints {
  display: flex;
  gap: 14px;
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--metro-text-faint);
  align-items: center;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.toggle input {
  accent-color: var(--metro-blue);
}
.plan-on {
  color: var(--metro-blue);
  font-weight: 600;
}

/* Skill chips — 直角小块 */
.skill-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.chip {
  font-size: 11.5px;
  padding: 3px 11px;
  border-radius: var(--metro-radius-sm);
  color: var(--metro-text-dim);
  background: var(--metro-bg-tile);
  cursor: pointer;
}
.chip.on {
  background: var(--metro-blue);
  color: #fff;
}
.chip.loaded {
  background: var(--metro-magenta);
  color: #fff;
}
```

- [ ] **Step 7: 写 Card(权限/提问/计划)样式**

```css
/* ── Prompt cards ─────────────────────────────────────────── */
.card {
  border-radius: var(--metro-radius);
  background: var(--metro-bg-tile);
  padding: 14px 16px;
  margin-bottom: 10px;
  box-shadow: var(--metro-shadow);
}
.card.warn {
  border-left: 4px solid var(--metro-orange);
}
.card .card-title {
  font-weight: 700;
  margin-bottom: 8px;
  color: var(--metro-text);
}
.card.warn .card-title {
  color: var(--metro-orange);
}
.card .mono {
  font-family: var(--metro-mono);
  font-size: 12.5px;
  background: var(--metro-bg-recessed);
  border-radius: var(--metro-radius-sm);
  padding: 8px 10px;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 6px 0;
  color: var(--metro-text);
}
.opt-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}
.opt {
  text-align: left;
  background: var(--metro-bg);
  color: var(--metro-text);
  border-radius: var(--metro-radius-sm);
  padding: 8px 12px;
  font-size: 13px;
}
.opt:hover {
  background: rgba(255,255,255,0.06);
}
.opt .opt-desc {
  display: block;
  color: var(--metro-text-faint);
  font-size: 11.5px;
  margin-top: 2px;
}
.opt.selected {
  background: var(--metro-blue);
  color: #fff;
}
.opt.selected .opt-desc {
  color: rgba(255,255,255,0.85);
}
.scope-tag {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: var(--metro-radius-sm);
  margin-left: 6px;
  background: rgba(255,255,255,0.15);
}
.q-block { margin-bottom: 12px; }
.q-block .q-text {
  font-weight: 600;
  margin-bottom: 6px;
}

.card-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.card-actions button {
  border-radius: var(--metro-radius-sm);
  padding: 7px 16px;
  font-size: 13px;
  background: var(--metro-bg);
  color: var(--metro-text);
}
.card-actions button:hover {
  background: var(--metro-bg-tile);
}
.card-actions .primary {
  color: #fff;
  background: var(--metro-blue);
}
.card-actions .primary:hover {
  background: #247dd4;
}
.card-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 8: 写 Modal(模型/MCP/设置) — 亚克力模糊**

```css
/* ── Modal — 亚克力 blur + 圆角 + 深投影 ── */
.modal-overlay {
  position: fixed;
  inset: 0;
  backdrop-filter: blur(8px);
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

/* 亚克力降级:不支持 blur 的浏览器回退到纯半透明 */
@supports not (backdrop-filter: blur(1px)) {
  .modal-overlay {
    background: rgba(0,0,0,0.75);
  }
  .modal {
    background: var(--metro-bg);
  }
}

.modal {
  width: 460px;
  max-width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
  background: var(--metro-acrylic);
  backdrop-filter: blur(20px);
  border-radius: var(--metro-radius);
  padding: 18px 20px;
  box-shadow: var(--metro-shadow-modal);
  color: var(--metro-text);
}

/* 亚克力降级:模态框本体 */
@supports not (backdrop-filter: blur(1px)) {
  .modal {
    background: var(--metro-acrylic);
    /* rgba(29,29,29,0.72) 本身是半透明色,无 blur 也能和背景拉开 */
  }
}

.modal h2 {
  margin: 0 0 14px;
  font-size: 16px;
  color: var(--metro-text);
}
.modal .field { margin-bottom: 14px; }
.modal .field label {
  display: block;
  font-size: 12px;
  color: var(--metro-text-dim);
  margin-bottom: 6px;
}
.modal select,
.modal input[type="text"],
.modal input[type="password"],
.modal textarea {
  width: 100%;
  background: var(--metro-bg-recessed);
  border: 1px solid var(--metro-bg-tile);
  color: var(--metro-text);
  border-radius: var(--metro-radius-sm);
  padding: 7px 10px;
  font-size: 13px;
}
.modal select:focus,
.modal input:focus,
.modal textarea:focus {
  border-color: var(--metro-blue);
  outline: none;
}

.mcp-item {
  background: var(--metro-bg);
  border-radius: var(--metro-radius-sm);
  padding: 10px 12px;
  margin-bottom: 8px;
}
.mcp-item .row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.mcp-tools {
  margin-top: 6px;
  font-size: 12px;
  color: var(--metro-text-dim);
}

/* Settings 特定 */
.modal-wide { width: 620px; }
.settings-target {
  font-size: 12px;
  color: var(--metro-text-dim);
  margin-bottom: 12px;
}
.settings-target code { color: var(--metro-text); }
.settings-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--metro-divider);
  margin-bottom: 14px;
}
.settings-tab {
  background: transparent;
  color: var(--metro-text-dim);
  padding: 8px 12px;
  font-size: 13px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
}
.settings-tab:hover { color: var(--metro-text); }
.settings-tab.active {
  color: #fff;
  background: var(--metro-blue);
  font-weight: 600;
  border-bottom-color: var(--metro-blue);
  border-radius: var(--metro-radius-sm) var(--metro-radius-sm) 0 0;
}
.settings-body {
  max-height: 52vh;
  overflow-y: auto;
  padding-right: 4px;
}
```

- [ ] **Step 9: 写 Settings 表单元素 + 权限行 + MCP 编辑器**

```css
.row-inline {
  display: flex;
  gap: 8px;
  align-items: center;
}
.row-inline input { flex: 1; }
.hint {
  font-size: 12px;
  color: var(--metro-text-faint);
  margin-top: 6px;
}
.hint.warn { color: var(--metro-orange); }
label.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--metro-text);
}
label.check input { width: auto; accent-color: var(--metro-blue); }

.perm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--metro-divider);
}
.perm-label { font-size: 13px; }
.perm-label .hint { margin-top: 2px; }
.perm-row select {
  width: 120px;
  flex: none;
  background: var(--metro-bg-recessed);
  border: 1px solid var(--metro-bg-tile);
  color: var(--metro-text);
  border-radius: var(--metro-radius-sm);
  padding: 4px 8px;
}

.mcp-editor {
  background: var(--metro-bg);
  border-radius: var(--metro-radius-sm);
  padding: 10px 12px;
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

button.ghost {
  background: var(--metro-bg-tile);
  color: var(--metro-text);
  border-radius: var(--metro-radius-sm);
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
}
button.ghost:hover { background: var(--metro-blue); color: #fff; }
button.ghost.danger {
  color: var(--metro-red);
  flex: none;
}
button.ghost.danger:hover {
  background: var(--metro-red);
  color: #fff;
}
```

- [ ] **Step 10: 写滚动条 + reduced-motion**

```css
/* ── 滚动条 — 6px 细深色条 ── */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: rgba(255,255,255,0.15);
}
::-webkit-scrollbar-thumb:hover {
  background: var(--metro-blue);
}

/* ── 无装饰动画(本主题无 aqua-pulse,只保留功能性动画) ── */
/* 不需要 pulse keyframe,不存在 send-btn/card-actions .primary 的 animation */
/* reduced-motion 仅作为兜底 */
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
```

- [ ] **Step 11: 构建验证**

```bash
npm run desktop:build
```
预期:PASS。`dist/renderer/` 下出现 `styles-metro.css`。

- [ ] **Step 12: 类型检查(整体)**

```bash
npm run typecheck --workspace @deeporca/desktop
```
预期:PASS。

- [ ] **Step 13: Commit**

```bash
git add packages/desktop/src/renderer/styles-metro.css
git commit -m "feat(desktop): add complete Windows Metro/Fluent dark theme stylesheet"
```

---

## 验收检查清单(全部 Task 完成后)

### 构建
```bash
npm run typecheck --workspace @deeporca/desktop  # 必须 PASS
npm run desktop:build  # 必须 PASS
```

### Windows 手动验收
- [ ] `npm run desktop:start`,窗口背景为深色(`#1d1d1d`),无白屏闪
- [ ] 窗口控件在**右上角**,三个直角按钮(─/□/✕),hover 关闭变红
- [ ] 标题栏可拖拽移动,控件区不触发拖拽
- [ ] 全局圆角:卡片8px、按钮/磁贴/会话项6px、窗口控件0px(直角)
- [ ] 会话项选中为实色蓝磁贴(`#1f6fc7` 白字);新会话按钮蓝色圆角
- [ ] 发送按钮实色蓝、**无呼吸动画**;聚焦输入框 2px 蓝色实线边框(无光晕)
- [ ] user 消息左边蓝色竖条;tool 消息左边绿色竖条;diff 绿/红行底色
- [ ] 卡片(权限/提问/计划)有柔和浅投影 `0 2px 8px`
- [ ] 模态框:亚克力模糊背景透出、圆角、深投影;文字清晰可读
- [ ] 在禁用 GPU 环境(`--disable-gpu`)下模态框回退半透明纯色底(不模糊),**不崩**

### macOS 回归验收
- [ ] `npm run desktop:start`,视觉与改造前**完全一致**
- [ ] 红绿灯在左上角、pinstripe 条纹、果冻按钮、呼吸动画都在
- [ ] `styles.css` 未被触碰

---

## 文件改动汇总

| 文件 | 操作 | Task |
|---|---|---|
| `packages/desktop/src/shared/ipc.ts` | 改 | T1 — ReadyResult 加 platform |
| `packages/desktop/build.mjs` | 改 | T2 — 条件复制 styles-metro.css |
| `packages/desktop/src/main/index.ts` | 改 | T3 — 平台背景色 + Ready handler |
| `packages/desktop/src/renderer/index.html` | 改 | T4 — 去 hardcoded link + 深色 body |
| `packages/desktop/src/renderer/main.tsx` | 改 | T5 — 动态 CSS 注入 |
| `packages/desktop/src/renderer/App.tsx` | 改 | T6 — platform state → TopBar |
| `packages/desktop/src/renderer/components/TopBar.tsx` | 改 | T6 — 双分支窗口控件 |
| `packages/desktop/src/renderer/styles.css` | **不动** | — |
| `packages/desktop/src/renderer/styles-metro.css` | **新建** | T7 — 完整 Metro 主题 |

**不变的文件:**`session-bridge.ts`、`preload/index.ts`、`api.ts`、`MessageList.tsx`、`Message.tsx`、`Composer.tsx`、`Sidebar.tsx`、`PermissionCard.tsx`、`QuestionCard.tsx`、`PlanCard.tsx`、`ModelModal.tsx`、`McpModal.tsx`、`SettingsModal.tsx`、`i18n/`、`lib/`、`markdown.ts`。

---

## 自审(plan 写完后的检查)

**1. Spec 覆盖:**
- IPC 加 platform ✓ (Task 1)
- main 进程平台分支 ✓ (Task 3)
- 两份 CSS 文件 ✓ (Task 2 复制 + Task 7 新建)
- 动态 CSS 注入 ✓ (Task 5)
- FOUC 防护 ✓ (Task 4 body 深色 + Task 5 等 CSS load 完再 mount)
- 分平台窗口控件 ✓ (Task 6)
- 深色 Metro 调色板 ✓ (Task 7 CSS变量)
- 全局圆角 6-8px ✓ (Task 7)
- 仅模态亚克力 ✓ (Task 7 Step 8)
- 柔和投影 ✓ (Task 7 Step 7 + 8)
- 窗口控件保持直角 ✓ (Task 7 Step 3)
- 去呼吸动画 ✓ (Task 7 未定义 aqua-pulse keyframe)
- Segoe UI 字体 ✓ (Task 7 CSS变量)
- build.mjs 改 ✓ (Task 2)
- styles.css 不动 ✓

**2. 占位符:**无。所有 CSS 代码、所有 TS 代码都是完整具体的。

**3. 类型一致性:** `platform` 类型在 ipc.ts(`NodeJS.Platform`) → main/index.ts(`process.platform`) → App.tsx(`string` state) → TopBar(`string` prop) 链上一致。`ReadyResult` 新字段在 main 进程 handler 和 renderer 消费者都补齐。