---
name: design
description: "设计行为插件 — UI 设计稿（.dd）、交互原型（OpenUI Lang）、设计纪律"
category: design
icon: design
skills:
  - name: deep-design
    description: "DeepDesign — .dd 格式 UI 设计稿（自包含 HTML，可脱离宿主交付）"
  - name: pm-designer-openui
    description: "OpenUI Lang 交互原型 — Designer 默认原型管线"
  - name: taste
    description: "设计纪律规范 — 减少常见设计错误"
mcp:
  - a2ui
---

# 设计行为插件

从 brief 到生成到预览到迭代的全流程设计能力。

## 包含能力

### 技能

- **deep-design** — DeepDesign 格式 UI 设计稿。使用 `.dd` 格式 + Tailwind CSS 生成自包含 HTML 设计稿，可脱离 DeepOrca 独立交付。适用于落地页/海报/品牌页等纯展示场景。
- **pm-designer-openui** — OpenUI Lang 交互原型（**Designer 默认管线**）。紧凑行式 DSL，支持 11 组件库、增量编辑。适用于表单/看板/仪表盘/多页面等交互场景。
- **taste** — 设计质量纪律规范。10 条 P0 规则 + 排版阶梯 + 颜色/动效/布局规范，适用于所有 UI 生成。

### MCP 服务器

- **a2ui** — 提供 `render_openui`/`update_openui`（OpenUI Lang 原型）、`render_design`/`update_design`（.dd 设计稿）工具。A2UI 的 `render_surface` 等批注工具由 meta-skills 组的 a2ui-annotation 技能管理。
