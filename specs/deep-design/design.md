# DeepDesign — 内核驱动的设计生成与视觉展示模块

> 状态：**已实现（2026-08-18 终判回写）** · 日期：2026-07-29
> 域声明（2026-08-18 拍板）：**deep-design = pm-design + ui-design**——deep-design 域为 pm-design（PM-Design V2 需求具现化工作台，`specs/pm-design-v2/design.md`）与 ui-design 的合并域。
> 落地事实：核心闭环全落地且演进超本稿——设计系统预设 3→9 套（tokens 化 DESIGN.md + 对比度脚本核验）、产物演进为 `.dd` OrcaDesign 文档（YAML front-matter + HTML body + section markers，本地 vendored Tailwind JIT 离线编译）、webview 改 iframe srcDoc 渲染 + 内联迭代 composer（update_design 工具，section delta + 版本快照 FIFO 20 版）；技能本体 `packages/core/templates/plugins/design/skills/deep-design/` + 面板 DesignPanel/DesignPreview。正向偏差注记见 `docs/pre-production-spec-final-audit.md`。
> 定位：DeepOrca 的内置设计能力，复刻并超越 Claude Design / OpenDesign 的核心闭环，
> 但**不引入外部 daemon**（Express+SQLite+Node24），全部复用 DeepOrca 已有的 Electron + Agent 基础设施。

---

## 1. 核心洞察：Claude Design / OpenDesign 到底是什么

调研 OpenDesign 完整仓库（100+ skills、100+ design-templates、151 design-systems）后，
其核心机制可以拆解为**三层纯文件系统 + 一个 Agent loop**：

```
① 设计系统层（DESIGN.md）—— 品牌契约，纯 Markdown
   色彩 / 字体 / 间距 / 动效 / 组件规范 → Agent 读取后约束每次生成

② 模板层（template.html seed + layouts.md）—— 渲染蓝图
   每种设计类型（原型/仪表盘/演示文稿/落地页）有一个 seed HTML + 可粘贴的 section 骨架
   Agent 不从零写 CSS，而是"复制 seed → 粘贴 section → 填内容"

③ 工作流层（SKILL.md）—— 编排 Agent 行为
   触发词 → 工作流步骤 → 自检清单 → 输出契约（写单 HTML 文件）

④ 展示层 —— 不是引擎，是浏览器
   iframe srcdoc 渲染 Agent 写的 HTML → 导出 HTML/PDF
```

**关键结论：没有"设计引擎"，没有"渲染引擎"。** 设计稿是 LLM 写的 HTML/CSS，
展示靠浏览器原生渲染。OpenDesign 的 277 插件本质都是 SKILL.md（Agent 行为指令），
daemon 只是文件服务器 + BYOK 代理 + iframe 预览壳。

---

## 2. DeepDesign 架构：去掉 daemon，复用内核

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DeepOrca Agent（已有）                        │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────┐ │
│  │ deep-design  │  │ DESIGN.md    │  │ Canvas UI 组件素材（画笔）  │ │
│  │ Skill        │  │ 品牌契约      │  │ 25 个特效组件源码           │ │
│  │（工作流编排）│  │（设计约束）   │  │ Liquid/Blaze/Glass/...     │ │
│  └──────┬───────┘  └──────────────┘  └────────────────────────────┘ │
│         │                                                           │
│         ▼  Agent 用 write 工具输出                                  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ .deeporca/designs/<name>.html —— 自包含单 HTML（内联 CSS）    │  │
│  └────────────────────────────────────┬─────────────────────────┘  │
└────────────────────────────────────────┼────────────────────────────┘
                                         │
┌────────────────────────────────────────▼────────────────────────────┐
│                  Electron Renderer（已有）                           │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ DesignStudioPanel（新增）                                       │ │
│  │ ┌──────────┐  ┌─────────────────────────────────────────────┐  │ │
│  │ │ 文件列表  │  │ <webview> 实时预览（Electron 自带渲染）       │  │ │
│  │ │ designs/ │  │  file://.../<name>.html                       │  │ │
│  │ │ *.html   │  │  支持：刷新 / 全屏 / 外部浏览器 / 导出 PDF     │  │ │
│  │ └──────────┘  └─────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 与 OpenDesign 的核心差异

| 维度 | OpenDesign | DeepDesign |
|------|-----------|------------|
| 展示层 | Express daemon + SQLite + Next.js + iframe | Electron `<webview>`（已有） |
| Agent | 外部 CLI（Claude Code/Codex/Cursor…） | DeepOrca 内置 Agent（已有） |
| 设计系统 | 151 个 DESIGN.md 包 | 内置 3 个 + 用户自建 |
| 模板 | 100+ design-templates | 内置 5 个核心模板 |
| 依赖 | Node 24 + pnpm + better-sqlite3 + Express | **零新增依赖**（复用 Electron + Agent） |
| 外部进程 | daemon 子进程 | 无（纯文件 + webview） |

---

## 3. 四层文件系统设计

### 3.1 设计系统层 —— `.deeporca/DESIGN.md`

品牌契约，Agent 读取后约束每次生成。格式借鉴 OpenDesign 的 DESIGN.md 规范：

```markdown
# Design System: Modern Minimal

## Color
- Background: #0a0a0a
- Surface: #141414
- Accent: #6366f1（最多每屏用 2 次）
- Text: #fafafa / Muted: #737373

## Typography
- Display: serif（Iowan Old Style / Georgia）
- Body: sans-serif（system-ui）
- Mono: monospace（数值/标签/眉标）

## Layout
- Max-width: 1200px
- Section padding: 80px vertical
- Grid: 12 列，gap 24px

## Motion
- 过渡：200ms ease
- 悬停：translateY(-2px)

## Components
- Button: 圆角 8px，accent 背景，hover 提亮
- Card: 圆角 12px，surface 背景，subtle border
```

**内置 3 个默认设计系统**（`packages/core/templates/design/systems/`）：
- `modern-minimal.md` — 现代简约（中性色/宽松间距）
- `dark-tech.md` — 暗色科技（深色背景/霓虹强调/紧凑，契合 Orca 主题）
- `editorial.md` — 编辑杂志（衬线/强对比/杂志网格）

### 3.2 模板层 —— seed HTML + section 骨架

每种设计类型一个模板目录（`packages/core/templates/design/templates/`）：

```
templates/
├── web-prototype/          ← 落地页/营销页/通用 web 原型
│   ├── seed.html           ← 种子文件（:root 变量 + class 系统 + 默认 chrome）
│   └── layouts.md          ← 可粘贴的 section 骨架（hero/features/stats/cta）
├── dashboard/              ← 仪表盘/管理后台
│   ├── seed.html
│   └── layouts.md          ← sidebar/topbar/kpi-cards/chart
├── deck/                   ← 演示文稿（横向翻页）
│   ├── seed.html
│   └── layouts.md          ← title-slide/content-slide/section-divider
├── mobile-app/             ← 移动端原型（iPhone 框架）
│   ├── seed.html
│   └── layouts.md          ← splash/onboarding/home/detail
└── poster/                 ← 单页海报/社交媒体图
    ├── seed.html
    └── layouts.md
```

**seed.html 的设计**（借鉴 OpenDesign web-prototype）：
- `<style>` 里定义 `:root` CSS 变量（映射 DESIGN.md 的 tokens）
- 预置 class 系统（`.hero`、`.card`、`.btn`、`.ph-img` 等）
- 响应式 media query 已内置（不破坏）
- Agent 的工作：**复制 seed → 替换 :root 变量 → 粘贴 section → 填内容**，不从零写 CSS

**layouts.md 的设计**：
- 每种 section 是一个可粘贴的 HTML 骨架（带 `[REPLACE]` 占位符）
- Agent 按页面类型选择 section 节奏（如 Landing = hero → features → stats → cta）
- 内置自检清单（P0/P1/P2）

### 3.3 Canvas UI 素材层 —— 特效画笔（可选增强）

```
packages/core/templates/design/canvas-ui/
├── registry.json           ← 组件清单（名称/描述/效果说明/适用场景）
├── liquid.js               ← 液体效果（vanilla JS，自包含）
├── blaze.js                ← 火焰效果
├── glass.js                ← 玻璃毛玻璃
├── shatter.js              ← 碎裂效果
├── particle-reveal.js      ← 粒子揭示
├── vhs.js                  ← VHS 复古
└── ...（精选 8-10 个核心组件，非全部 25 个）
```

构建时从 Canvas UI 仓库拉取（`scripts/install-canvas-ui.js`），复制 vanilla JS 版本。
设计 Skill 在 references 里列出可用组件，Agent 按需将组件源码内联到生成的 HTML。

**集成方式**：构建时 vendor（同 codegraph/openwiki 模式），gitcode 镜像兜底。
许可：MIT + Commons Clause（允许用于产品内，禁止转售组件本身——DeepOrca 内置供 Agent 引用合规）。

### 3.4 工作流层 —— deep-design Skill

`packages/core/templates/skills/bundled/deep-design/SKILL.md`：

```yaml
---
name: deep-design
description: >-
  Generate design-grade HTML artifacts (prototypes, dashboards, decks, posters)
  as self-contained single HTML files. Use when users ask for design, 原型,
  落地页, dashboard, 仪表盘, 演示文稿, poster, or UI 设计稿. Reads DESIGN.md
  brand contract, composes from seed templates, optionally inlines Canvas UI
  visual effects.
---
```

**工作流**（借鉴 OpenDesign web-prototype + Bento Slides 模式）：

```
Step 0: 读取 DESIGN.md（如有）→ 映射到 seed 的 :root 变量
Step 1: 分类设计类型（原型/仪表盘/演示文稿/移动端/海报）→ 选择对应模板
Step 2: 复制 seed.html → 替换 :root 变量 + title
Step 3: 规划 section 节奏 → 向用户确认（一句话，可廉价修正）
Step 4: 粘贴 section 骨架 → 填入具体内容（无占位符）
Step 5: 可选——按需内联 Canvas UI 特效组件
Step 6: 自检（P0 全过）
Step 7: write 工具写入 .deeporca/designs/<name>.html
```

---

## 4. 展示层：DesignStudioPanel

### 4.1 组件结构

```
DesignStudioPanel
├── 左侧：设计文件列表
│   ├── .deeporca/designs/*.html
│   ├── "新建设计"提示（引导用户对 Agent 说需求）
│   └── 文件操作：刷新 / 重命名 / 删除
├── 右侧：<webview> 预览
│   ├── webview.src = file://.../<name>.html
│   ├── 工具栏：刷新 / 全屏切换 / 外部浏览器打开 / 导出 PDF
│   └── 安全区：nodeintegration=false, sandbox=true
└── 空状态："告诉 Agent 你想设计什么"
```

### 4.2 webview 安全配置

```typescript
// packages/desktop/src/main/index.ts — 主窗口 webPreferences
webPreferences: {
  webviewTag: true,          // 启用 <webview> 标签
  contextIsolation: true,    // 已有
  nodeIntegration: false,    // 已有
  sandbox: false,            // 已有（主窗口需要）
}

// DesignStudioPanel.tsx — webview 声明
<webview
  src={`file://${designFilePath}`}
  nodeintegration="false"
  sandbox="true"
  disablewebsecurity="false"
  style={{ width: "100%", height: "100%", border: "none" }}
/>
```

设计 HTML 在沙箱 webview 中渲染，无法访问 Node/Electron API——安全隔离。

### 4.3 导出能力

| 格式 | 实现 |
|------|------|
| HTML | 原生（Agent 已写入文件） |
| PDF | webview 的 `webContents.printToPDF()` via IPC |
| 外部浏览器 | `shell.openExternal(`file://${path}`)` |

---

## 5. IPC 设计

```typescript
// shared/ipc.ts
IpcRequest: {
  DesignList: "design:list",           // 列出 .deeporca/designs/*.html
  DesignRead: "design:read",           // 读取 HTML 内容
  DesignDelete: "design:delete",       // 删除设计文件
  DesignExportPdf: "design:exportPdf", // webview printToPDF
  DesignOpenExternal: "design:openExternal", // 外部浏览器打开
}

DesktopApi: {
  designList(): Promise<DesignEntry[]>;
  designRead(filename: string): Promise<string>;
  designDelete(filename: string): Promise<void>;
  designExportPdf(filename: string, savePath: string): Promise<void>;
  designOpenExternal(filename: string): Promise<void>;
}

type DesignEntry = {
  filename: string;   // "saas-landing.html"
  title: string;      // 从 <title> 提取
  modifiedAt: string; // 文件修改时间
  size: number;       // 字节数
};
```

---

## 6. 改动清单

| # | 文件 | 改动 | 优先级 |
|---|------|------|--------|
| 1 | `packages/core/templates/skills/bundled/deep-design/SKILL.md` | **新建** 设计 Skill（工作流编排） | P0 |
| 2 | `packages/core/templates/design/systems/*.md` | **新建** 3 个默认 DESIGN.md | P0 |
| 3 | `packages/core/templates/design/templates/web-prototype/` | **新建** 种子 HTML + layouts.md | P0 |
| 4 | `packages/core/templates/design/templates/dashboard/` | **新建** | P1 |
| 5 | `packages/core/templates/design/templates/deck/` | **新建** | P1 |
| 6 | `packages/core/templates/design/templates/mobile-app/` | **新建** | P2 |
| 7 | `packages/core/templates/design/templates/poster/` | **新建** | P2 |
| 8 | `scripts/install-canvas-ui.js` | **新建** 构建时 vendor Canvas UI 组件 | P1 |
| 9 | `packages/core/templates/design/canvas-ui/` | vendor 的组件源码（gitignored） | P1 |
| 10 | `packages/desktop/src/renderer/components/DesignStudioPanel.tsx` | **新建** 预览面板 | P0 |
| 11 | `packages/desktop/src/main/index.ts` | 启用 `webviewTag` + IPC handler | P0 |
| 12 | `packages/desktop/src/shared/ipc.ts` | Design IPC 类型 | P0 |
| 13 | `packages/desktop/src/preload/index.ts` | 暴露 design API | P0 |
| 14 | `packages/desktop/src/renderer/App.tsx` | rail 入口 "design" 视图 | P0 |
| 15 | `packages/core/templates/builtin-plugins.json` | "DeepDesign" 分组 | P0 |
| 16 | i18n（messages.ts + 4 locale） | 设计面板文案 | P0 |

---

## 7. 与现有能力的关系

| 现有能力 | 关系 |
|----------|------|
| Bento Slides skill | 🟢 **互补**——Bento 专做演示文稿（JSON→bento.html 壳），DeepDesign 做通用设计（HTML 原生）。两者可共存，演示文稿场景用 Bento，其他用 DeepDesign |
| taste-skill（规划中） | 🟢 **互补**——taste-skill 提供设计方法论（布局/排版纪律），DeepDesign 提供模板+品牌系统+预览。taste-skill 的理念可融入 deep-design Skill |
| EditorOverlay | 🟢 互补——编辑器看代码，DesignStudioPanel 看渲染效果 |
| Plan Mode | 🟢 互补——设计需求可先 Plan Mode 对齐再生成 |

### 与路线图 #8 OpenDesign 的关系

**DeepDesign 替代路线图 #8 OpenDesign 集成。** 理由：
1. OpenDesign daemon 太重（Express+SQLite+Node24+pnpm），违背零外部依赖
2. DeepDesign 复用 Electron webview + Agent，零新增依赖
3. 核心能力相同（brief→生成→预览→交付），但实现轻量 10 倍
4. Canvas UI 特效是 OpenDesign 没有的差异化能力

---

## 8. 分阶段实施

### Phase 1（MVP）—— 最小可用设计模块
- deep-design Skill（web-prototype 模板）
- 1 个默认 DESIGN.md（dark-tech，契合 Orca）
- DesignStudioPanel（文件列表 + webview 预览 + 导出 HTML）
- IPC + rail 入口
- **产出**：用户说"设计一个 SaaS 落地页" → Agent 生成 HTML → webview 实时预览

### Phase 2 —— 多模板 + 品牌系统
- dashboard / deck 模板
- 3 个默认 DESIGN.md
- 用户自建 DESIGN.md 支持（`.deeporca/DESIGN.md`）
- 导出 PDF

### Phase 3 —— Canvas UI 特效 + 移动端
- Canvas UI 组件 vendor + Skill 引用
- mobile-app / poster 模板
- 特效组件按需内联

---

## 9. 设计原则

1. **Agent 是画师，webview 是画布，Canvas UI 是画笔** —— 不自研渲染引擎，复用 Electron
2. **单 HTML 文件是唯一产物** —— 自包含、零依赖、任何浏览器可打开（同 Bento 理念）
3. **模板而非从零写** —— seed + section 骨架，Agent 组合而非创造 CSS（同 OpenDesign 理念）
4. **DESIGN.md 是契约** —— 品牌规范约束每次生成，不漂移
5. **零新增运行时依赖** —— 全部复用 Electron + Agent + 文件系统
6. **渐进增强** —— Phase 1 无 Canvas UI 也能用，特效是可选锦上添花
