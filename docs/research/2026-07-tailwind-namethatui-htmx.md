# Tailwind CSS + NameThatUI/styles + htmx 调研报告

> 日期：2026-07-30 · 状态：调研完成
> 目的：评估 Tailwind CSS 作为 DeepDesign 实现方案、NameThatUI/styles 作为风格提示词来源、htmx 对本项目的价值。

---

## 一、Tailwind CSS：作为 DeepDesign 的实现方案（非替换主 UI）

### 定位修正

**不替换 DeepOrca 主 UI 的原生 CSS**（`--ui-*` token + 6 主题运行时切换是核心价值，Tailwind 无法表达）。Tailwind 的角色是 **DeepDesign 产出 HTML 文件时的一种实现选择**——生成的 HTML 可以用 Tailwind utility classes 而非手写 CSS 来落地设计。

### 与 DeepDesign 的关系

DeepDesign 当前产出自包含 HTML 文件（`.deeporca/designs/*.html`），样式全部内联。引入 Tailwind 意味着：

| 方案 | 实现 | 优势 | 劣势 |
|------|------|------|------|
| **Tailwind CDN** | HTML `<head>` 加 `<script src="https://cdn.tailwindcss.com"></script>` | 零构建、Agent 只写 class 名 | 依赖 CDN（离线不可用）、~400KB 运行时 |
| **Tailwind Play CDN** | 同上但用 `@tailwindcss/browser` | 同上 | 同上 |
| **内联 Tailwind utility** | 构建时编译 Tailwind → 把生成的 CSS 内联到 HTML | 离线可用、自包含 | 需要构建步骤、增加复杂度 |
| **手写 CSS（当前）** | Agent 直接在 `<style>` 中写 CSS | 零依赖、完全自包含 | Agent 需要理解 CSS、产出质量不稳定 |

**推荐方案**：**Tailwind CDN**——DeepDesign 产出的 HTML 是设计稿/原型，不是生产应用。CDN 依赖在设计场景可接受（用户演示时基本在线），而 Agent 写 `class="flex gap-4 p-6 rounded-xl"` 比写完整的 CSS 规则更可靠、更一致。

### 与 NameThatUI/styles 的协同

Tailwind 的 utility classes 是实现 NameThatUI 风格提示词的**理想工具**。例如 Neobrutalism 风格的提示词说"2-3px 黑边 + 硬偏移阴影 + 饱和色块"，用 Tailwind 实现：

```html
<button class="border-2 border-black bg-yellow-400 px-4 py-2 shadow-[4px_4px_0_#000] 
               font-bold hover:translate-x-1 hover:translate-y-1 hover:shadow-none 
               transition-all">
  Click Me
</button>
```

比手写 CSS 更简洁、Agent 更不容易出错。

---

## 二、NameThatUI/styles：DeepDesign 风格提示词目录

### 概况

NameThatUI/styles 是一个**设计风格图谱**——14 个 UI 风格，每个包含：
- **定义信号**（3-5 个关键视觉属性）
- **Agent 提示词**（paste-ready brief，含具体 CSS 值、颜色指南、排版指令、无障碍约束）
- **视觉样本**（交互式 mock）

### 14 个风格完整清单

| # | 风格 | 口语描述 | 定义信号 |
|---|------|----------|----------|
| 1 | **Skeuomorphism** | "像真皮笔记本" | 模拟真实材质；物理光照模型；实物隐喻 |
| 2 | **Neumorphism** | "从背景里挤出的软按钮" | 单一连续表面；双重柔和阴影；按压内凹态 |
| 3 | **Glassmorphism** | "彩色壁纸上的磨砂卡片" | 半透明磨砂面板；背景透出；薄光边缘 |
| 4 | **Liquid Glass** | "Apple 新设计，按钮像水滴" | 玻璃=控制层；透镜效果（非纯模糊）；自适应着色 |
| 5 | **Web Brutalism** | "丑陋的原始 HTML" | 浏览器默认材质；暴露文档结构；零装饰渲染 |
| 6 | **Neobrutalism** | "亮色块+黑边+硬阴影" | 粗黑边框；硬偏移阴影（0 blur）；饱和色块 |
| 7 | **Y2K Digital** | "铬色泡泡糖千禧界面" | 液态铬金属；凝胶光泽塑料；蓝银彩虹色 |
| 8 | **Frutiger Aero** | "光泽草地气泡 Windows 未来" | 自然+科技融合；光泽玻璃+水绿色表面；天蓝/草绿色 |
| 9 | **Flat Design** | "纯色无阴影" | 实色 2D 填充；无深度模拟；简单字形图标 |
| 10 | **Minimalism** | "几乎空白的页面" | 负空间作为材质；限制元素数量；有限/单色调色板 |
| 11 | **Claymorphism** | "像橡皮泥的蓬松 3D 按钮" | 双内阴影+外阴影；超大圆角；独立着色的浮动对象 |
| 12 | **Vernacular Web** | "老 Geocities 闪烁 GIF 页面" | 平铺背景纹理；GIF 装饰；徽章和计数器 |
| 13 | **Aqua** | "Mac 蓝糖果按钮" | 糖果凝胶控件；条纹表面；橡皮糖窗口控件 |
| 14 | **Windows Aero** | "Win7 透明窗框" | 透明模糊窗框；镜面扫光反射；发光热控 |

### Agent 提示词示例（Neobrutalism）

> "Create the surface using Neobrutalism. Defining signals: a uniform 2–3px solid black border on every element; hard offset shadows — solid black, displaced ~4px down-right, zero blur (box-shadow: 4px 4px 0 #000); flat saturated color blocks (e.g. yellow, hot pink, lime) on a cream or white ground with no gradients; bold chunky display type for headings. Active states translate the element into its shadow (transform: translate(4px,4px) with the shadow removed). Preserve 4.5:1 text contrast on every colored block, visible focus indicators distinct from the decorative borders, and reduced-motion support for press animations."

### DeepDesign 集成方案

将 14 个风格转化为 DeepDesign 的**风格提示词目录**——作为 SKILL.md 的参考文档或内置设计系统：

**路径 1：参考文档**（推荐，零运行时成本）
- `packages/core/templates/design/references/ui-styles.md` — 手工整理 14 个风格的定义信号 + Agent 提示词
- DeepDesign SKILL.md 引用此文件，Agent 根据用户描述的风格选择对应提示词

**路径 2：内置设计系统**（更重但更完整）
- 每个风格一个 `.md` 文件放入 `packages/core/templates/design/systems/`
- 与现有 `dark-tech.md` / `editorial.md` / `modern-minimal.md` 并列
- 每个文件包含完整的 Color/Typography/Layout/Motion/Components 规范（基于 NameThatUI 提示词 + Apple HIG/MDN 补充实际 token 值）

**推荐路径 1**——NameThatUI 的提示词不是完整的设计系统（缺少精确颜色 hex/字体栈/间距 token），而是**风格指导**。作为参考文档让 Agent 理解风格意图，然后结合 Tailwind 或手写 CSS 落地，比硬塞成不完整的"设计系统"更合理。

---

## 三、htmx：对本项目零贡献

| 评估维度 | 结论 |
|----------|------|
| 核心机制 | 服务端返回 HTML 片段 + 前端 `hx-*` 属性局部刷新 |
| 与 DeepOrca 匹配 | ❌ 完全不匹配。DeepOrca 是 JSON-over-IPC 的客户端渲染 Electron 应用，没有 HTTP 服务器 |
| 主 React UI | ❌ 替换 React = 重写 50+ 组件 + 新建 HTTP 服务器 |
| DeepDesign/Bento | ❌ 自包含无服务器 HTML 文件，htmx 需要后端 |
| Remote Access | ❅ 规划明确"复用现有 React bundle"，htmx 打破此设计 |
| A2UI 替代 | ❌ A2UI 用 JSON+MCP 已更好地解决 agent 驱动 UI |
| **最终判定** | **不采纳** |

---

## 四、综合建议

### 做的

1. **NameThatUI/styles → DeepDesign 参考文档**：手工整理 14 个 UI 风格的定义信号 + Agent 提示词，放入 `design/references/ui-styles.md`
2. **Tailwind CDN → DeepDesign 可选实现**：DeepDesign SKILL.md 中增加 Tailwind CDN 作为推荐的样式实现方式（`<script src="https://cdn.tailwindcss.com"></script>`），配合 NameThatUI 风格提示词产出更一致的 HTML

### 不做的

1. ❌ 不用 Tailwind 替换 DeepOrca 主 UI 的原生 CSS（`--ui-*` token 系统 + 6 主题运行时切换不可替代）
2. ❌ 不引入 htmx（架构完全不匹配）

---

> 关联文档：
> - [DeepDesign 内核设计](../../specs/deep-design/design.md)
> - [功能路线图](../features/feature-roadmap.md)
> - NameThatUI/styles: https://namethatui.com/styles
> - Tailwind CSS: https://www.tailwindcss.cn/docs/installation
> - htmx: https://htmx.org/
