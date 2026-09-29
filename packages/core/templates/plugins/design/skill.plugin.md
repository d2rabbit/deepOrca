---
name: design
description: "设计行为插件 — UI 设计稿（.dd / Leafer）、交互原型（MoonViz）、设计纪律"
category: design
icon: design
skills:
  - name: deep-design
    description: "DeepDesign — .dd 格式 UI 设计稿（自包含 HTML，可脱离宿主交付）"
  - name: pm-designer-moonviz
    description: "MoonViz 交互原型 — Designer 默认原型管线（单文档多画板，op 计划驱动）"
  - name: taste
    description: "设计纪律规范 — 减少常见设计错误"
  - name: spec-writer
    description: "Standardized PRD specialist for the prototype module (原型设计 step 1) — expands a requirement into a standardized PRD (信息表/功能清单表/页面清单表/Mermaid 图) via the render_spec tool."
  - name: arch-writer
    description: "标准化技术架构文档专家 (原型设计 step 4) — 从验收通过的原型 suite 派生技术选型/系统架构/数据模型/流程图文档,经 save_suite_arch 持久化。"
mcp:
  - a2ui
---

# 设计行为插件

从 brief 到生成到预览到迭代的全流程设计能力。

## 包含能力

### 技能

- **deep-design** — DeepDesign 格式 UI 设计稿。使用 `.dd` 格式 + Tailwind CSS 生成自包含 HTML 设计稿，可脱离 DeepOrca 独立交付。适用于落地页/海报/品牌页等纯展示场景。
- **pm-designer-moonviz** — MoonViz 交互原型（**Designer 默认管线**，specs/moonviz-engine-replacement）。单份 canonical `.mbt.md` 文档承载多画板（三端 = `<page>@<device>`），通过引擎 op 计划驱动（create/template/place/interact/flow/theme/token），AgentGate 随 op 护航。适用于表单/看板/仪表盘/多页面等交互场景。
- **spec-writer** — 标准化 PRD 专家（原型设计 step 1）。把一句话需求展开为结构化标准化 PRD（信息表/功能清单表/页面清单表/Mermaid 导航与流程图/验收标准/待确认），作为原型设计与技术架构文档的输入契约。
- **arch-writer** — 标准化技术架构文档专家（原型设计 step 4，验收通过后可用）。从批准的 PRD 派生技术选型表/系统架构 Mermaid/数据模型 erDiagram/核心流程图/模块拆分表/风险与对策。
- **taste** — 设计质量纪律规范。19 条 P0 规则（含 anti-slop 多样性）+ 排版阶梯 + 五维自评评分卡 + 颜色/动效/布局规范，适用于所有 UI 生成。

### MCP 服务器

- **a2ui** — 提供 `render_moonviz`/`update_moonviz`（MoonViz canonical 原型文档）、`render_leafer`（Leafer UI 设计稿）、`render_design`/`update_design`（.dd 设计稿）工具。A2UI 的 `render_surface` 等批注工具由 meta-skills 组的 a2ui-annotation 技能管理。
