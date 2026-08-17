---
name: work
description: "工作行为插件 — 单文件 HTML 幻灯片生成"
category: work
icon: work
skills:
  - name: bento-slides
    description: "Bento 幻灯片 — JSON 驱动的单文件 .bento.html 演示文稿生成"
actions:
  - { id: "bento.create", description: "从结构化 spec 生成 Bento 演示文稿" }
---

# 工作行为插件

日常工作产出工具。

## 包含能力

### 技能

- **bento-slides** — 使用 Bento 单文件办公套件生成演示文稿。Agent 生成 JSON（文本/形状/图表/表格/图片/morph 动画），注入到 `.bento.html` 模板壳中。输出文件自包含编辑器+放映+导出，浏览器直接打开即可。

### Actions（命令式能力）

- **bento.create** — 从结构化 slide spec 生成 `.bento.html` 演示文稿（读模板 → 注入 deck JSON → 写文件）
