---
name: code
description: "代码行为插件 — 工作区索引（符号/文档/架构）、风险分析、语义重构、AI 代码审查"
category: code
icon: code
skills:
  - name: codegraph-cli
    description: "CodeGraph CLI 驱动 — init/index/sync/serve 代码图谱构建与查询"
  - name: smart-code-review
    description: "智能代码审查 — CRG 风险分析 + OCR 语义审查联合编排"
  - name: arch-scan
    description: "架构扫描 — 多视角递归分析代码库，生成 A2UI 交互式架构图"
plugins:
  - open-code-review
mcp:
  - codegraph
  - serena
actions:
  - { id: "review.run", description: "快速代码审查（仅 OCR）" }
  - { id: "review.check-available", description: "检查 OCR 可用性" }
  - { id: "review.full", description: "完整代码审查（CRG 风险 + OCR 语义联合）" }
  - { id: "crg.reindex", description: "重建代码风险图谱" }
  - { id: "crg.visualize", description: "可视化代码风险图谱" }
  - { id: "codegraph.reindex", description: "重建符号索引" }
  - { id: "codegraph.list", description: "列出索引条目" }
  - { id: "arch-scan.run", description: "架构扫描（生成 A2UI 架构图）" }
---

# 代码行为插件

代码智能全栈：符号导航、变更风险分析、语义级重构、AI 代码审查。

## 包含能力

### 技能

- **codegraph-cli** — CodeGraph CLI 驱动文档。指导 Agent 使用 `codegraph init`、`codegraph index`、`codegraph sync`、`codegraph serve --mcp` 等命令构建和查询代码知识图谱。
- **smart-code-review** — 智能代码审查编排。通过 `review.full` action 自动编排 CRG 风险分析 + OCR 语义审查，输出带风险标注的统一审查报告。
- **arch-scan** — 架构扫描。12 视角递归分析代码库，消费 CodeGraph + OpenWiki 索引，生成 A2UI 可交互架构图。

### 插件

- **open-code-review** — 通过 `ocr` CLI（阿里巴巴 Open Code Review）进行 AI 驱动的代码审查。读取 Git diff，生成结构化行级审查意见。**内置** — 随 DeepOrca 打包。

### MCP 服务器

- **codegraph** — 代码知识图谱服务器。提供符号检索、调用链分析、定义跳转。项目需先运行 `codegraph init` 创建 `.codegraph/` 目录。
- **serena** — 语义代码操作服务器（40+ 语言，通过 SolidLSP）。提供符号查找、引用、重命名、函数体替换。

### Actions（命令式能力）

- **review.full** — 一键完整代码审查（CRG 结构风险 + OCR 语义审查联合编排）
- **review.run** — 快速审查（仅 OCR）
- **crg.reindex** / **crg.visualize** — 代码风险图谱重建与可视化
- **codegraph.reindex** / **codegraph.list** — 符号索引重建与列表
- **arch-scan.run** — 架构扫描
