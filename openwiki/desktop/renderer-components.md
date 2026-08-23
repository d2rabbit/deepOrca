---
type: desktop
title: 渲染层组件
description: components/ 目录按领域分组：对话、设置/插件、知识、设计、任务、工作台组件及其职责与数据流。
tags: [renderer, components, panels]
---

# 渲染层组件

`packages/desktop/src/renderer/components/` 的 35 个组件按领域分组（`App.tsx` 负责装配与状态分发；本页给每个组件一个职责锚点）。

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
| `KnowledgePanel` | 知识仪表盘：CodeGraph/OpenWiki/AGENTS/archmap 状态聚合、构建按钮 |
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

## 任务域

| 组件 | 职责 |
| --- | --- |
| `TaskPanel` / `TaskProgressPanel` | 任务运行与进度 |
| `TaskTreePanel`（25.8KB） | 任务轨迹树：树图、分支、节点、reflog、会话徽标、归档联动 |

## 工作台

| 组件 | 职责 |
| --- | --- |
| `Sidebar`（14KB） | 会话列表 + 工作区分组 |
| `TopBar`（16.5KB） | 模型选择器/思考档位下拉/项目切换 |
| `Toast` | 通知容器 |
| `WorkspaceTrustDialog` | 首开工作区信任询问 |
| `JsonView` | JSON 查看 |

## 测试说明

无独立组件级测试套件——`dom-harness.ts` 驱动 App 级测试（jsdom + @testing-library/react），关键交互（权限卡、Plan 卡、Composer 发送）在 harness 层验证。

## 相关页面

- [renderer](renderer.md)（App 状态机与 hooks）
- [design-system](design-system.md)、[knowledge-indexing](knowledge-indexing.md)、[plugins](plugins.md)
- [core/task-tree](../core/task-tree.md)（TaskTreePanel 数据源）
