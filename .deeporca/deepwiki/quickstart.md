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
- [会话生命周期](architecture/session-lifecycle.md) — `SessionManager`（六层继承链：session-manager-base/mcp/skills/persistence/lifecycle/tasks）：创建/回复/激活循环/压缩/持久化/undo + **session-index 防抖不变式**
- [提示词系统](architecture/prompt-system.md) — 缓存稳定前缀、工具文档、Skills 注入、Plan Mode
- [消息转换](architecture/message-conversion.md) — 工具调用配对/修复、thinking 请求
- [权限系统](architecture/permission-system.md) — 10 作用域、决策优先级、quarantine、路径级始终允许、首开信任 fail-closed、bash 写原语推断保守化
- [沙箱体系](architecture/sandbox.md) — 审计总线、策略引擎、macOS sandbox-exec 后端

**core 包**

- [core 总览](core/overview.md) — 公共 API 导出面、目录布局
- [设置系统](core/settings.md) — 设置 schema、端点、模型族注册表、模型能力
- [内置工具](core/tools.md) — 8 工具 + `ToolExecutor`（含 snippet 编辑契约）
- [MCP 生命周期](core/mcp.md) — `McpManager`、内置服务器、controller seam 模式、GitMCP
- [Actions 能力层](core/actions.md) — `defineAction`/`ActionRegistry`、内置 action 族（`index.build-all` 三阶段编排、`wiki-variants` 变体过滤）、三面暴露
- [语义路由](core/routing.md) — SkillRouter/ToolRouter、fail-open、向量索引
- [任务轨迹树](core/task-tree.md) — `TaskTreeService`（树/分支/快照/记忆 fork）
- [公共工具](core/common-utilities.md) — OpenAI 客户端族、路径边界、文件状态、错误诊断等

**desktop 包**

- [desktop 总览](desktop/overview.md) — 三分层架构
- [主进程组合根](desktop/main-process.md) — 启动序列、IPC 注册分组、窗口安全
- [SessionBridge](desktop/session-bridge.md) — desktop↔core 边界（权限中继/事件转发/服务委托）
- [IPC 契约](desktop/ipc-contract.md) — 通道清单与类型
- [Preload 桥](desktop/preload.md) — `window.deeporca` 与原型窗口受限桥
- [渲染层](desktop/renderer.md) — App MainTab 模型、hooks、i18n、StreamdownView markdown 安全渲染、mermaid.ts
- [渲染层组件](desktop/renderer-components.md) — 对话/设置（居中模态）/知识（4 子页签）/设计/任务（记录+轨迹）面板、潮汐舞台（HubSheet/QuickDock/画中画/工具活动轨迹/FailureBanner）、ErrorBoundary
- [插件系统](desktop/plugins.md) — 插件管理器、内置插件模板、技能发现
- [技能评估](desktop/skill-evals.md) — skill-up pin + CI 回归
- [知识索引](desktop/knowledge-indexing.md) — CodeGraph/OpenWiki/AGENTS/架构图（Mermaid 文档）、BuildJobManager 3 阶段可观测、构建前置 git 引导、符号关系图
- [设计系统](desktop/design-system.md) — A2UI 设计 MCP 服务器（12 工具，官方 v0.9.1 协议 + save_archmap）、.dd 格式、dembrandt（CDP 隔离子进程）
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
- [知识构建](workflows/knowledge-build.md) — CodeGraph → OpenWiki → arch-scan（Mermaid 架构图）分阶段可观测流水线
- [设计工作流](workflows/design-pipeline.md) — DesignPanel → action → A2UI/.dd → 交付包

## 任务路由表

| 工程意图 | 阅读页面 | 关键源文件/符号 | 聚焦测试 | 最窄验证 |
| --- | --- | --- | --- | --- |
| 改会话循环/压缩/持久化 | [会话生命周期](architecture/session-lifecycle.md) | `core/src/session-manager-lifecycle.ts`（activateSession）、`session-manager-persistence.ts`（index 防抖/原子写/sweep）、`session-manager-base.ts`（字段/构造）、`session.ts`（组合根） | `session.test.ts`、`session-persistence.test.ts`、`session-skills-mcp.test.ts`、`compaction.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/session.test.ts packages/core/src/tests/session-persistence.test.ts` |
| 改系统提示/技能注入/Plan Mode | [提示词系统](architecture/prompt-system.md) | `core/src/prompt.ts`、`templates/tools/*.md.ejs` | `prompt.test.ts`、`os-link.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/prompt.test.ts` |
| 改工具行为/新增内置工具（慎） | [内置工具](core/tools.md) | `core/src/tools/executor.ts` + `tools/*-handler.ts`（read 快路径/流式切片、WebFetch DNS 钉扎） | `tool-handlers.test.ts`、`tool-executor.test.ts`、`web-fetch.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/tool-handlers.test.ts` |
| 改权限决策/作用域/信任模型 | [权限系统](architecture/permission-system.md) | `core/src/common/permissions.ts`、`path-boundary.ts`、`settings.ts`（`effectiveWorkspaceTrust`/fail-closed 夹紧） | `permissions.test.ts`、`quarantine.test.ts`、`path-grants.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/permissions.test.ts` |
| 改沙箱后端/审计 | [沙箱体系](architecture/sandbox.md) | `core/src/sandbox/`（audit/policy/backend） | `audit.test.ts`、`sandbox-backend.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/sandbox-backend.test.ts` |
| 改 MCP 生命周期/内置服务器 | [MCP](core/mcp.md) | `core/src/mcp/mcp-manager.ts`、`session-manager-mcp.ts`（`augmentMcpServersWithBuiltins`） | `mcp-client.test.ts`、`codegraph.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/mcp-client.test.ts` |
| 新增/修改 Action | [Actions](core/actions.md) | `core/src/actions/registry.ts` + `actions/`、`desktop/src/main/action-ipc.ts` | `actions.test.ts`、`action-ipc.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/actions.test.ts` |
| 改语义路由/嵌入召回 | [语义路由](core/routing.md) | `core/src/routing/`、`packages/embedding/` | `routing.test.ts`、`routing-facade.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/routing.test.ts` |
| 改任务树 | [任务轨迹树](core/task-tree.md) | `core/src/tasks/task-tree-service.ts`、desktop `main/task-trajectory.ts`（操作轨迹） | `task-tree.test.ts`、`task-trajectory.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/task-tree.test.ts` |
| 改设置/端点/模型注册 | [设置系统](core/settings.md) | `core/src/settings.ts`、`common/model-capabilities.ts` | `settings-and-notify.test.ts`、`model-capabilities.test.ts` | `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/settings-and-notify.test.ts` |
| 改 IPC 通道/契约 | [IPC 契约](desktop/ipc-contract.md) | `desktop/src/shared/ipc.ts`（两端同改） | `ipc-contract.test.ts`、`ipc-security.test.ts` | `node packages/desktop/src/tests/run-tests.mjs packages/desktop/src/tests/ipc-contract.test.ts` |
| 改主进程组合/启动/安全兜底 | [主进程组合根](desktop/main-process.md) | `desktop/src/main/index.ts`（单实例锁/dembrandt 子进程/全局错误兜底）、`session-bridge.ts` | `app-boot.test.ts`、`ipc-contract.test.ts` | `node packages/desktop/src/tests/run-tests.mjs packages/desktop/src/tests/app-boot.test.ts` |
| 改渲染层 UI 逻辑 | [渲染层](desktop/renderer.md) + [组件](desktop/renderer-components.md) | `desktop/src/renderer/App.tsx`（潮汐舞台/HubSheet/画中画）、`components/`（HubSheet/QuickDock/ToolActivityPanel/FailureBanner）、`ui-css/`（12 模块）、`mermaid.ts` | `streamdown-view.test.ts`、`knowledge-build-progress.test.ts`、`permissions-lib.test.ts`、`build-error.test.ts`、`llm-error.test.ts` | `node packages/desktop/src/tests/run-tests.mjs packages/desktop/src/tests/streamdown-view.test.ts` |
| 改知识索引/一键构建 | [知识索引](desktop/knowledge-indexing.md) + [知识构建工作流](workflows/knowledge-build.md) | core `actions/index-build.ts`（3 阶段编排/内容权重路由/首坏阶段即停/arch 后置验证）、`desktop/src/main/build-job-manager.ts`、`tools/codegraph-sdk.ts`（recreate/0 符号校验）、`tools/wiki-cli.ts`（实质页数守卫）、`main/symbol-graph-query.ts` | `build-job-manager.test.ts`、`app-boot.test.ts`、core `background-task.test.ts`/`phase-actions.test.ts` | `node packages/desktop/src/tests/run-tests.mjs packages/desktop/src/tests/build-job-manager.test.ts` |
| 改构建前置引导（git preflight/bootstrap、构建失败提示） | [知识索引](desktop/knowledge-indexing.md) + [IPC 契约](desktop/ipc-contract.md) | `desktop/src/main/git-preflight.ts`（`gitPreflight`/`gitBootstrap`）、`renderer/components/IndexLibraryPanel.tsx`（git 询问模态）、`renderer/lib/build-error.ts`（`wiki-git` hint）、`shared/ipc.ts`（`KnowledgeGitPreflight`/`KnowledgeGitBootstrap`） | desktop `git-preflight.test.ts`、`build-error.test.ts`、`ipc-contract.test.ts`、`app-boot.test.ts` | `node packages/desktop/src/tests/run-tests.mjs packages/desktop/src/tests/git-preflight.test.ts` |
| 改架构图扫描（arch-scan） | [知识索引](desktop/knowledge-indexing.md) + [Actions](core/actions.md) | `core/src/session-manager-tasks.ts`（`runBackgroundLlmTask`——预算耗尽抛错而非假成功，经 `ActionContext.runBackgroundTask` 暴露）、`actions/arch-scan.ts`、`templates/plugins/code/skills/arch-scan/SKILL.md`（五阶段管线，无 HTML 板步骤）、`main/tools/a2ui/a2ui-mcp.ts save_archmap`（仅 Mermaid 文档） | `phase-actions.test.ts`（链停/后置验证）、`background-task.test.ts`、`background-arch-flush.test.ts`、`a2ui-persist-race.test.ts` | `node scripts/test-arch-scan.mjs` |
| 改设计系统/A2UI | [设计系统](desktop/design-system.md) + [设计工作流](workflows/design-pipeline.md) | `desktop/src/main/tools/a2ui/a2ui-mcp.ts`、`renderer/a2ui/processor.ts`、`shared/a2ui-legacy.ts`、`tools/design-store.ts` | `dd-parser.test.ts`、`a2ui-processor.test.ts`、`a2ui-normalize.test.ts`、`a2ui-persist-race.test.ts`、`design-dembrandt.test.ts` | `node packages/desktop/src/tests/run-tests.mjs packages/desktop/src/tests/a2ui-processor.test.ts` |
| 改记忆流水线 | [记忆包](memory/overview.md) + [记忆工作流](workflows/memory-pipeline.md) | `memory/src/memory-manager.ts`、`adapter.ts`、`tdai/` | `capture.test.ts`、`runner-toolloop.test.ts` | `node packages/memory/src/tests/run-tests.mjs` |
| 改嵌入服务 | [嵌入包](embedding/overview.md) | `embedding/src/transformers-embedding.ts`、`shared.ts` | `transformers-embedding.test.ts`、`shared-registry.test.ts` | `node packages/embedding/src/tests/run-tests.mjs` |
| 改构建/vendoring/发布 | [构建与 vendoring](desktop/build-and-vendoring.md) | `desktop/build.mjs`（5 bundle，含 dembrandt-provider.cjs）、`scripts/vendor-*.js`（bsk 钉 0.1.9 + sha256）、`electron-builder.yml` | — | `npm run desktop:build && npm run check` |

## 通用命令（仓库根）

| 命令 | 用途 |
| --- | --- |
| `npm run check` | build + typecheck + lint + format:check（提交前） |
| `npm test` | 全部 workspace 测试（node:test + tsx） |
| `npm run desktop:build` / `desktop:dev` / `desktop:start` | Electron 构建 / 开发 / 构建并启动 |
| `npm run build` | 按依赖拓扑构建全部 tsc 包（desktop 除外） |

## Backlog（延迟项）

无。所有实质组件均已检视并纳入本 wiki。
