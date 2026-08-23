---
type: guide
title: DeepOrca 仓库 Wiki 快速导航
description: 本 wiki 的入口页：仓库是什么、四个包的地图、核心概念索引、任务路由表（意图 → 页面 → 源入口 → 聚焦测试 → 验证）。
tags: [quickstart, navigation, index]
---

# DeepOrca 仓库 Wiki 快速导航

**DeepOrca** 是一个为 DeepSeek 模型调优的 AI 编码 agent harness（Electron 桌面客户端 + 共享核心引擎），npm workspaces monorepo。核心理念：模型与执行框架共同决定 agent 质量，框架应围绕 DeepSeek 的真实行为定制（见 [架构总览](architecture/overview.md)）。

## 仓库地图

| 包 | 角色 | 入口 | 深挖页面 |
| --- | --- | --- | --- |
| `@deeporca/core` | LLM 会话引擎、8 内置工具、MCP、权限、设置、语义路由、Actions、任务树（**无 UI**） | `packages/core/src/index.ts` | [core 总览](core/overview.md) |
| `@deeporca/desktop` | Electron 客户端：main/preload/renderer、Monaco、知识索引、设计工具 | `packages/desktop/src/main/index.ts` | [desktop 总览](desktop/overview.md) |
| `@deeporca/memory` | 进程内 L0–L3 记忆流水线（vendored TDAI Core fork） | `packages/memory/src/index.ts` | [记忆包](memory/overview.md) |
| `@deeporca/embedding` | 本地嵌入（transformers.js + ONNX，Granite 97M R2） | `packages/embedding/src/index.ts` | [嵌入包](embedding/overview.md) |

周边：`docs/` = 用户手册；`specs/` = 功能规格（design.md + tasks.md）；`scripts/` = 构建/发布/vendoring；`.deeporca/` = 产品自身配置（settings/plugins/task-trees/prototypes/AGENTS.md）；`docs-site/` = GitHub Pages 静态站。

## 核心概念与页面索引

**架构层（理解系统如何工作）**

- [架构总览](architecture/overview.md) — 设计理念、四包分层、layer rules、端到端数据流、分支策略
- [会话生命周期](architecture/session-lifecycle.md) — `SessionManager`：创建/回复/激活循环/压缩/持久化/undo + **session-index 防抖不变式**
- [提示词系统](architecture/prompt-system.md) — 缓存稳定前缀、工具文档、Skills 注入、Plan Mode
- [消息转换](architecture/message-conversion.md) — 工具调用配对/修复、thinking 请求
- [权限系统](architecture/permission-system.md) — 10 作用域、决策优先级、quarantine、路径级始终允许
- [沙箱体系](architecture/sandbox.md) — 审计总线、策略引擎、macOS sandbox-exec 后端

**core 包**

- [core 总览](core/overview.md) — 公共 API 导出面、目录布局
- [设置系统](core/settings.md) — 设置 schema、端点、模型族注册表、模型能力
- [内置工具](core/tools.md) — 8 工具 + `ToolExecutor`（含 snippet 编辑契约）
- [MCP 生命周期](core/mcp.md) — `McpManager`、内置服务器、controller seam 模式、GitMCP
- [Actions 能力层](core/actions.md) — `defineAction`/`ActionRegistry`、内置 action 族、三面暴露
- [语义路由](core/routing.md) — SkillRouter/ToolRouter、fail-open、向量索引
- [任务轨迹树](core/task-tree.md) — `TaskTreeService`（树/分支/快照/记忆 fork）
- [公共工具](core/common-utilities.md) — OpenAI 客户端族、路径边界、文件状态、错误诊断等

**desktop 包**

- [desktop 总览](desktop/overview.md) — 三分层架构
- [主进程组合根](desktop/main-process.md) — 启动序列、IPC 注册分组、窗口安全
- [SessionBridge](desktop/session-bridge.md) — desktop↔core 边界（权限中继/事件转发/服务委托）
- [IPC 契约](desktop/ipc-contract.md) — 通道清单与类型
- [Preload 桥](desktop/preload.md) — `window.deeporca` 与原型窗口受限桥
- [渲染层](desktop/renderer.md) — App 状态机、hooks、i18n
- [渲染层组件](desktop/renderer-components.md) — 对话/设置/知识/设计/任务面板
- [插件系统](desktop/plugins.md) — 插件管理器、内置插件模板、技能发现
- [技能评估](desktop/skill-evals.md) — skill-up pin + CI 回归
- [知识索引](desktop/knowledge-indexing.md) — CodeGraph/CRG/OpenWiki/arch-scan、BuildJobManager
- [设计系统](desktop/design-system.md) — A2UI 设计 MCP 服务器（11 工具三族）、.dd 格式、dembrandt
- [主进程工具控制器](desktop/main-tools.md) — ocr/wiki/serena/crg/skill-spector/vision/gitmcp
- [Activity-Frames](desktop/activity-frames.md) — 行为记忆子系统
- [构建与 vendoring](desktop/build-and-vendoring.md) — esbuild 三 bundle、vendor-*.js、打包发布

**memory / embedding 包**

- [记忆包](memory/overview.md) — `MemoryManager`、L0–L3、保留策略、生成审计
- [TDAI Core fork](memory/tdai-core.md) — vendored 依赖边界与集成点
- [嵌入包](embedding/overview.md) — 共享单例、EmbeddingService 契约

**跨系统工作流**

- [LLM 工具循环](workflows/llm-tool-loop.md) — 用户提示 → 工具执行端到端
- [记忆流水线](workflows/memory-pipeline.md) — 捕获/召回/注入/清理
- [知识构建](workflows/knowledge-build.md) — CodeGraph → OpenWiki → AGENTS → archmap
- [设计工作流](workflows/design-pipeline.md) — DesignPanel → action → A2UI/.dd → 交付包

## 任务路由表

| 工程意图 | 阅读页面 | 关键源文件/符号 | 聚焦测试 | 最窄验证 |
| --- | --- | --- | --- | --- |
| 改会话循环/压缩/持久化 | [会话生命周期](architecture/session-lifecycle.md) | `core/src/session.ts` `SessionManager.activateSession`/`compactSession`/`loadSessionsIndex` | `session.test.ts`、`compaction.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/session.test.ts` |
| 改系统提示/技能注入/Plan Mode | [提示词系统](architecture/prompt-system.md) | `core/src/prompt.ts`、`templates/tools/*.md.ejs` | `prompt.test.ts`、`os-link.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/prompt.test.ts` |
| 改工具行为/新增内置工具（慎） | [内置工具](core/tools.md) | `core/src/tools/executor.ts` + `tools/*-handler.ts` | `tool-handlers.test.ts`、`tool-executor.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/tool-handlers.test.ts` |
| 改权限决策/作用域 | [权限系统](architecture/permission-system.md) | `core/src/common/permissions.ts`、`path-boundary.ts` | `permissions.test.ts`、`quarantine.test.ts`、`path-grants.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/permissions.test.ts` |
| 改沙箱后端/审计 | [沙箱体系](architecture/sandbox.md) | `core/src/sandbox/`（audit/policy/backend） | `audit.test.ts`、`sandbox-backend.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/sandbox-backend.test.ts` |
| 改 MCP 生命周期/内置服务器 | [MCP](core/mcp.md) | `core/src/mcp/mcp-manager.ts`、`session.ts augmentMcpServersWithBuiltins` | `mcp-client.test.ts`、`codegraph.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/mcp-client.test.ts` |
| 新增/修改 Action | [Actions](core/actions.md) | `core/src/actions/registry.ts` + `actions/`、`desktop/src/main/action-ipc.ts` | `actions.test.ts`、`action-ipc.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/actions.test.ts` |
| 改语义路由/嵌入召回 | [语义路由](core/routing.md) | `core/src/routing/`、`packages/embedding/` | `routing.test.ts`、`routing-facade.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/routing.test.ts` |
| 改任务树 | [任务轨迹树](core/task-tree.md) | `core/src/tasks/task-tree-service.ts` | `task-tree.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/task-tree.test.ts` |
| 改设置/端点/模型注册 | [设置系统](core/settings.md) | `core/src/settings.ts`、`common/model-capabilities.ts` | `settings-and-notify.test.ts`、`model-capabilities.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/settings-and-notify.test.ts` |
| 改 IPC 通道/契约 | [IPC 契约](desktop/ipc-contract.md) | `desktop/src/shared/ipc.ts`（两端同改） | `ipc-contract.test.ts`、`ipc-security.test.ts` | `node packages/desktop/src/tests/run-tests.mjs packages/desktop/src/tests/ipc-contract.test.ts` |
| 改主进程组合/启动 | [主进程组合根](desktop/main-process.md) | `desktop/src/main/index.ts`、`session-bridge.ts` | `app-boot.test.ts` | `node packages/desktop/src/tests/run-tests.mjs packages/desktop/src/tests/app-boot.test.ts` |
| 改渲染层 UI 逻辑 | [渲染层](desktop/renderer.md) + [组件](desktop/renderer-components.md) | `desktop/src/renderer/App.tsx`、`components/` | `markdown.test.ts`、`permissions-lib.test.ts` | `node packages/desktop/src/tests/run-tests.mjs packages/desktop/src/tests/markdown.test.ts` |
| 改知识索引/一键构建 | [知识索引](desktop/knowledge-indexing.md) | `desktop/src/main/build-job-manager.ts`、`tools/codegraph-sdk.ts`、`tools/wiki-cli.ts` | `app-boot.test.ts`、core `actions.test.ts` | `npm run desktop:build && npm run desktop:start` |
| 改设计系统/A2UI | [设计系统](desktop/design-system.md) + [设计工作流](workflows/design-pipeline.md) | `desktop/src/main/tools/a2ui/a2ui-mcp.ts`、`renderer/dd/`、`tools/design-store.ts` | `dd-parser.test.ts`、`a2ui-processor.test.ts`、`design-dembrandt.test.ts` | `node packages/desktop/src/tests/run-tests.mjs packages/desktop/src/tests/dd-package.test.ts` |
| 改记忆流水线 | [记忆包](memory/overview.md) + [记忆工作流](workflows/memory-pipeline.md) | `memory/src/memory-manager.ts`、`adapter.ts`、`tdai/` | `capture.test.ts`、`runner-toolloop.test.ts` | `node packages/memory/src/tests/run-tests.mjs` |
| 改嵌入服务 | [嵌入包](embedding/overview.md) | `embedding/src/transformers-embedding.ts`、`shared.ts` | `transformers-embedding.test.ts`、`shared-registry.test.ts` | `node packages/embedding/src/tests/run-tests.mjs` |
| 改构建/vendoring/发布 | [构建与 vendoring](desktop/build-and-vendoring.md) | `desktop/build.mjs`、`scripts/vendor-*.js`、`electron-builder.yml` | — | `npm run desktop:build && npm run check` |

## 通用命令（仓库根）

| 命令 | 用途 |
| --- | --- |
| `npm run check` | build + typecheck + lint + format:check（提交前） |
| `npm test` | 全部 workspace 测试（node:test + tsx） |
| `npm run desktop:build` / `desktop:dev` / `desktop:start` | Electron 构建 / 开发 / 构建并启动 |
| `npm run build` | 按依赖拓扑构建全部 tsc 包（desktop 除外） |

## Backlog（延迟项）

无。所有实质组件均已检视并纳入本 wiki。
