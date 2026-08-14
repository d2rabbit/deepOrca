---
name: knowledge
description: "知识行为插件 — GitHub 仓库文档索引、项目 Wiki 生成"
category: knowledge
icon: knowledge
plugins:
  - git-mcp
mcp:
  - gitmcp:*
skills:
  - name: openwiki
    description: "项目 Wiki 知识图谱自动生成与维护"
  - name: wiki-qa
    description: "通过 Wiki 知识库回答架构/模块/工作流问题"
actions:
  - { id: "wiki.init", description: "初始化项目 Wiki" }
  - { id: "wiki.update", description: "增量更新项目 Wiki" }
  - { id: "wiki.list-pages", description: "列出 Wiki 页面" }
  - { id: "wiki.read-page", description: "读取 Wiki 页面" }
  - { id: "index.build-all", description: "一键构建全部索引（CodeGraph + Wiki + arch-scan）" }
---

# 知识行为插件

将外部知识源（GitHub 仓库文档、项目 Wiki）转化为 Agent 可查询的 MCP 工具。

## 包含能力

### 插件

- **git-mcp** — GitMCP 模块入口。用户添加 GitHub 仓库后，自动拉取文档并在本地建立索引，作为 MCP 工具提供。

### MCP 服务器

- **gitmcp:\*** — 动态 GitMCP 服务器。每个用户添加的 GitHub 仓库生成一个 `gitmcp:<owner>/<repo>` 服务器，提供文档检索工具。基于本地 SQLite + sqlite-vec 向量索引。

### 技能

- **openwiki** — 使用 `openwiki` CLI 生成和维护项目级 Wiki 知识图谱。分析代码结构、生成文档、维护索引。
- **wiki-qa** — 通过 Wiki 知识库回答项目架构、模块职责、工作流问题。

### Actions（命令式能力）

- **wiki.init** / **wiki.update** — 初始化或增量更新项目 Wiki
- **wiki.list-pages** / **wiki.read-page** — 列出和读取 Wiki 页面
- **index.build-all** — 一键构建全部索引（CodeGraph → OpenWiki → arch-scan 三阶段编排）
