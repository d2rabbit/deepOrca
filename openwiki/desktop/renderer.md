---
type: desktop
title: 渲染层（renderer）
description: React 渲染层架构：App 状态机、hooks、i18n、lib 工具、markdown 渲染与 UI 组件库。
tags: [renderer, react, hooks, i18n]
---

# 渲染层（renderer）

`packages/desktop/src/renderer/` 是浏览器 bundle（无 Node/Electron 访问），唯一入口是 `window.deeporca`（[preload](preload.md)）。

## App.tsx（68KB）

`App()` 是唯一顶层组件，管理：

- **状态**：projectRoot、homeDir（避免把用户主目录当工作区呈现）、sessions、activeId、messages、draft、imageUrls、busy/enhancing、permission 待办、plan、设计产物、知识状态、任务树。
- **布局**：左 rail（导航：会话/Git/任务/命令/插件/token/索引/评审/设计/任务树/GitMCP/编辑器/主题/撤销/设置）→ Sidebar → 主区（MessageList + Composer 或各面板）→ 右 dock（ContextProgress/TokenStats/ProcessOutput）。
- **懒加载**：CodeReviewPanel、DiffOverlay、EditorOverlay、PrototypePanel、DesignPreview、DesignPanel、KnowledgePanel、TaskTreePanel（Monaco + markdown 渲染器 ~5MB+ 延迟到需要时）。
- **辅助函数**：`findLatestPlan`、`syntheticUserMessage`、`findPendingAskUserQuestion`、`extractOpenuiFence`（OpenUI 内联块提取）、`extractProposedPlan`/`getImplementationPrompt`（Plan 审批）。
- **命令面板**：CommandPalette（rail 命令、全局快捷键）。

## hooks/

| hook | 职责 |
| --- | --- |
| `use-tree-refresh` | 会话/消息树的定时刷新 |
| `use-document-title` | 文档标题（会话摘要） |
| `use-composer-dock-height` | Composer dock 高度 |
| `use-panel-layout` | 面板布局持久化 |
| `use-appearance` | 主题/外观 |
| `use-preview` | 富工具结果预览 |
| `use-skills` | 技能列表/选择/刷新 |
| `use-process-panel` | 进程输出面板 |
| `use-git` | Git 面板状态 |
| `use-global-shortcuts` | 全局快捷键（⌘/Ctrl 按平台显示） |
| `use-settings-data` | 设置数据与保存 |

## i18n

- `i18n/index.tsx`：useI18n 上下文（zh/en）。
- `i18n/messages.ts`（98KB）：全部文案；顶层 `configureSessionLocale` 只负责 core 侧会话提示键（zh/en），渲染层这里是 UI 文案。
- `lib/session-prompts` 对应关系：会话提示模板键在 core `common/session-prompts.ts`。

## lib/

| 模块 | 职责 |
| --- | --- |
| `permissions.ts` | 权限答复构造（allow/deny、alwaysAllows、alwaysAllowPaths） |
| `plan.ts` | `<proposed_plan>` 提取与实现提示 |
| `ask-question.ts` | AskUserQuestion 待办与答案格式化 |
| `token-usage.ts` | usage 聚合、缓存命中率 |
| `messages.ts` | 工具摘要、计划行提取 |
| `appearance.ts` | 主题/外观工具 |
| `model-utils.ts` | 模型选择 UI 工具 |

## 其他

- `markdown.ts`：marked + DOMPurify 安全渲染管线（`markdown.test.ts`）。
- `ui/`：自绘 UI 组件库（Rail、Modal、Button、Dropdown、Tooltip（portal）、FileIcon（语言徽标 glyph）、icons、command-palette、controls、inputs、layout、surfaces、feedback）。
- `main.tsx`：ReactDOM 挂载。

## 聚焦测试

- `markdown.test.ts`（8.5KB）：渲染/净化。
- `permissions-lib.test.ts`：权限答复解析。
- `dom-harness.ts`（8.5KB）：jsdom 测试 harness（App 级组件测试基础设施）。

## 相关页面

- [renderer-components](renderer-components.md)（组件目录）
- [ipc-contract](ipc-contract.md)、[preload](preload.md)
