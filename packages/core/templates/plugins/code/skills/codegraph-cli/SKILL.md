---
name: codegraph-cli
description: >-
  CodeGraph CLI 驱动 — 使用 codegraph 命令构建和查询代码知识图谱。
  Use when the user asks to index code, build a code graph, analyze call chains,
  find symbol definitions/references, or when CodeGraph needs initialization.
  Triggers: codegraph, code graph, 代码图谱, 索引代码, 符号导航, 调用链.
---

# CodeGraph CLI 驱动

CodeGraph 是一个代码知识图谱工具，将源代码解析为可查询的符号图谱。Agent 通过 CLI 命令构建图谱，通过 MCP 服务查询。

## 何时使用

- 初始化项目的代码图谱（首次使用 CodeGraph）
- 代码变更后同步更新图谱
- 需要符号导航/调用链分析时（先确保图谱已构建）
- 重置图谱数据

## 命令

| 命令                    | 用途                                             |
| ----------------------- | ------------------------------------------------ |
| `codegraph init`        | 在当前项目初始化 `.codegraph/` 目录              |
| `codegraph index`       | 索引源代码到图谱（全量）                         |
| `codegraph sync`        | 增量同步代码变更到图谱                           |
| `codegraph serve --mcp` | 启动 MCP 服务模式（通常由内置 MCP 注册自动管理） |
| `codegraph reset`       | 重置图谱数据（删除并重建）                       |

## 工作流

工作区索引三步走：**索引 → Wiki → 架构图**。

1. **初始化**: 在项目根目录运行 `codegraph init`，创建 `.codegraph/` 目录。
2. **索引**: 运行 `codegraph index` 解析所有源文件，构建符号表和调用关系（符号级索引）。
3. **Wiki**: 索引完成后，运行 OpenWiki 构建项目文档索引（文档级索引）。
4. **架构图**: Wiki 完成后，运行 `arch-scan` 技能构建工作区的 A2UI 架构图（架构级索引，多视角 + 递归分析）。三步构成完整的工作区索引：CodeGraph（符号在哪）→ OpenWiki（文档说了什么）→ arch-scan（整体架构长什么样）。
5. **增量同步**: 代码变更后运行 `codegraph sync` 增量更新符号索引；架构变更较大时可重新运行 `arch-scan` 刷新架构图。
6. **查询**: 图谱构建完成后，CodeGraph MCP 服务器自动激活，Agent 可通过 MCP 工具查询符号、调用链等。

## 注意事项

- CodeGraph 需要 Node.js 22.5+（使用 `node:sqlite`）。
- 大型项目首次索引可能需要几分钟。
- `codegraph serve --mcp` 通常不需要手动运行 — 当项目包含 `.codegraph/` 目录时，DeepOrca 自动注册并启动 MCP 服务。
- 图谱数据存储在项目本地的 `.codegraph/` 目录中。
