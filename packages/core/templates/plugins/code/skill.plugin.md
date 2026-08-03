---
name: code
description: "代码行为插件 — 符号导航、风险分析、语义重构、AI 代码审查"
category: code
icon: code
skills:
  - name: codegraph-cli
    description: "CodeGraph CLI 驱动 — init/index/sync/serve 代码图谱构建与查询"
plugins:
  - open-code-review
mcp:
  - codegraph
  - code-review-graph
  - serena
cli:
  - name: codegraph
    description: "CodeGraph 二进制 — 代码知识图谱"
    commands:
      - init
      - index
      - sync
      - "serve --mcp"
      - reset
---

# 代码行为插件

代码智能全栈：符号导航、变更风险分析、语义级重构、AI 代码审查。

## 包含能力

### 技能

- **codegraph-cli** — CodeGraph CLI 驱动文档。指导 Agent 使用 `codegraph init`、`codegraph index`、`codegraph sync`、`codegraph serve --mcp` 等命令构建和查询代码知识图谱。

### 插件

- **open-code-review** — 通过 `ocr` CLI（阿里巴巴 Open Code Review）进行 AI 驱动的代码审查。读取 Git diff，将变更文件发送至 LLM，生成具有行级精度的结构化审查意见。**内置** — `ocr` 已随 DeepOrca 内置，通过 Electron 的 Node 运行。

### MCP 服务器

- **codegraph** — 代码知识图谱服务器。提供符号检索、调用链分析、定义跳转。项目需先运行 `codegraph init` 创建 `.codegraph/` 目录。
- **code-review-graph** — 代码审查图谱（CRG）分析层。基于 Git 变更进行风险评分和影响分析。项目需先运行 CRG 构建。
- **serena** — 语义代码操作服务器（40+ 语言，通过 SolidLSP）。提供符号查找、引用、重命名、函数体替换。

### CLI 工具

- **codegraph** — 代码图谱二进制命令。主要操作：
  - `codegraph init` — 在当前项目初始化 `.codegraph/` 知识图谱
  - `codegraph index` — 索引源代码到图谱
  - `codegraph sync` — 增量同步变更
  - `codegraph serve --mcp` — 启动 MCP 模式（由内置 MCP 注册自动管理）
  - `codegraph reset` — 重置图谱数据
