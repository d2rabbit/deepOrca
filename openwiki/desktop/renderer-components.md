---
type: desktop
title: 渲染层组件
description: components/ 目录按领域分组：对话、设置/插件、知识、设计、任务、工作台组件及其职责与数据流。
tags: [renderer, components, panels]
---

# 渲染层组件

`packages/desktop/src/renderer/components/` 的 40+ 个组件按领域分组（`App.tsx` 负责装配与状态分发；本页给每个组件一个职责锚点）。

## 对话域

| 组件 | 职责 |
| --- | --- |
| `Composer` | 输入框：draft、图片、技能选择、@文件提及（FileMentionMenu）、Plan 模式、enhance、发送 |
| `Message`（36KB） | 单条消息渲染：文本/思考/工具调用/富工具结果（RichToolResult）/图片/OpenUI 内联块 |
| `MessageList` | 消息列表与滚动管理 |
| `PermissionCard` | 权限询问卡（scope 列表、allow/deny/始终允许、路径级授予） |
| `QuestionCard` | AskUserQuestion 回答卡 |
| `PlanCard` | `<proposed_plan>` 审批/实现提示 |
| `ContextProgress` | 上下文 token 进度 |
| `TokenStatsPanel` | usage 统计（aggregateUsage、cacheHitRate） |
| `ProcessOutputPanel` | 后台进程输出 |
| `UndoModal` | /undo 目标选择（conversation / code-and-conversation） |
| `DiffOverlay` | diff 覆盖层 |
| `RichToolResult` | 工具结果富渲染 |
| `EditorOverlay` / `EditorPanel` | Monaco 编辑器覆盖层/面板 |

## 设置/插件域

| 组件 | 职责 |
| --- | --- |
| `SettingsPanel`（45KB） | 全部设置：模型/端点/思考档位/权限/记忆/路由/状态行/通知/压缩阈值 |
| `PluginMcpPanel` | MCP 服务器管理与状态 |
| `PluginDetail`（23KB） | 插件详情：技能文档、内置插件组（browser/code/design/knowledge/memory/meta-skills/vision/work） |
| `ActionsPanel` | 已注册 Action 查看/运行（无参）+ 进度与原始结果 |
| `ShortcutsModal` | 快捷键说明（⌘/Ctrl 按平台） |

## 知识域

| 组件 | 职责 |
| --- | --- |
| `IndexLibraryPanel` | 代码索引库（工作区列表 + 行内构建 + 状态） |
| `KnowledgePanel`（25KB） | 知识 tab（每工作区一个）：**4 个子 tab — Wiki / AGENTS / 架构图 / 索引关系图**；Wiki 内联主从预览（frontmatter title 标准页头 + H1 去重）；架构图子 tab 只渲染 ```mermaid fence（无图的文档回退全文）；活动构建时叠加 `KnowledgeBuildProgress` |
| `SymbolGraphView` | 只读符号关系图（R3-6）：callers/focus/callees 三列 + 按 kind 着色的边 + 点击节点重定中心 + 返回栈；数据来自 `knowledgeSymbolGraph` IPC（不改 agent 侧 CodeGraph MCP） |
| `KnowledgeBuildProgress` | 构建阶段清单（符号索引→文档 Wiki→架构图 状态标记 + console tail 环缓冲），mode-aware 首阶段文案 |
| `CodeReviewPanel` | OCR 代码评审（运行/进度/评论）、View Graph 入口 |
| `GitMcpPanel` | GitMCP 模块管理 |
| `SourceControlPanel` | Git 面板：status/stage/diff/commit/branches |

## 设计域

| 组件 | 职责 |
| --- | --- |
| `DesignPanel`（16.5KB） | 设计生成面板（DeepDesign/PM-Design、drift 闸门、materialize/extract） |
| `DesignPreview` | .dd 文档预览 |
| `PrototypePanel` / `PrototypeWindow` | A2UI 原型渲染与弹出窗口 |
| `ComparisonMatrix` | 设计对比矩阵 |
| `MermaidDiagram` | ```mermaid fence → 主题化 SVG（串行队列渲染，失败回退源码文本） |

## 任务域

| 组件 | 职责 |
| --- | --- |
| `TaskPanel` / `TaskProgressPanel` | 任务运行与进度 |
| `TaskTreePanel`（9.4KB，R3-7 重设计） | **工作区维度任务历史**：树/分支/reflog 列表 + 从会话徽标直切任务 tab；树本体与操作轨迹移到内容区 tab（见下） |
| `TaskRecordPanel`（14KB） | 内容区任务记录 tab：任务 RECORD（分支、节点树 with why/status/产物）+ 操作 TRAJECTORY（`taskTreeTrajectory`：工具调用轨迹 tool/ok/summary/触及文件 + 树的 reflog）——**刻意不是会话视图**，不渲染聊天内容 |

## 工作台

| 组件 | 职责 |
| --- | --- |
| `Sidebar`（14KB） | 会话列表 + 工作区分组 |
| `TopBar`（16.5KB） | 模型选择器/思考档位下拉/项目切换 |
| `Toast` | 通知容器 |
| `WorkspaceTrustDialog` | 首开工作区信任询问 |
| `JsonView` | JSON 查看 |
| `ErrorBoundary` / `ErrorFallback` | **面板级崩溃围栏**（黑屏根治）：A2UI surface/markdown 预览的动态内容抛错时只卸载面板，不卸载整棵 React 树；包裹在 KnowledgePanel 预览区等动态渲染点 |
| `StreamdownView` | markdown → React 元素树渲染器（见 [renderer](renderer.md)）；`Message` 的 `Md`、wiki/AGENTS 预览、架构图回退全文等所有 markdown 展示均经它（Mermaid fence 交给 `MermaidDiagram`） |

## 测试说明

组件级测试走 `dom-harness.ts`（jsdom + @testing-library/react）：`streamdown-view.test.ts`（markdown 安全边界）、`knowledge-build-progress.test.ts`（构建阶段清单）。关键交互（权限卡、Plan 卡、Composer 发送）在 harness 层验证。

## 相关页面

- [renderer](renderer.md)（App 状态机与 hooks）
- [design-system](design-system.md)、[knowledge-indexing](knowledge-indexing.md)、[plugins](plugins.md)
- [core/task-tree](../core/task-tree.md)（TaskTreePanel 数据源）
