---
type: desktop
title: 渲染层（renderer）
description: React 渲染层架构：App 状态机、hooks、i18n、lib 工具、markdown 渲染与 UI 组件库。
tags: [renderer, react, hooks, i18n]
---

# 渲染层（renderer）

`packages/desktop/src/renderer/` 是浏览器 bundle（无 Node/Electron 访问），唯一入口是 `window.deeporca`（[preload](preload.md)）。

## App.tsx（74KB）

`App()` 是唯一顶层组件，管理：

- **状态**：projectRoot、homeDir（避免把用户主目录当工作区呈现）、sessions、activeId、messages、draft、imageUrls、busy/enhancing、permission 待办、plan、设计产物、知识状态、任务树。
- **主区 tab 模型**（`MainTab`）：会话 tab 是固定首 tab（不可关闭）；设置/插件/编辑器文件/知识/任务记录各自开 **自己的 tab**（`auxTabs` + `taskTabs` + `knowledgeTabs`），互不覆盖——取代了旧的 `mainView` 三态（其 bug：设置/插件占据主区时，其他面板开的 tab 在底下永远够不到）。`mainView` 仅保留为后向兼容派生值。关闭辅助 tab 回落到会话 tab。
- **布局**：左 rail（导航：会话/Git/任务/命令/插件/token/索引/评审/设计/任务树/GitMCP/编辑器/主题/撤销/设置）→ Sidebar → 主区（MessageList + Composer 或各面板 tab）→ 右 dock（ContextProgress/TokenStats/ProcessOutput）。
- **懒加载**：CodeReviewPanel、DiffOverlay、EditorOverlay、PrototypePanel、DesignPreview、DesignPanel、KnowledgePanel、TaskTreePanel、TaskRecordPanel（Monaco + markdown 渲染器 ~5MB+ 延迟到需要时）。
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

- **markdown 渲染**：`components/StreamdownView.tsx`（streamdown：remark/rehype → React 元素树，**无 `dangerouslySetInnerHTML`**；rehype-sanitize GitHub schema + rehype-harden URL allowlist；流式模式 remend 增量解析不闪断；remark-breaks 保留单换行 `<br>`；JSON 块 pretty-print；`MermaidBlock` 自定义渲染器把 ```mermaid fence 交给 mermaid.ts）。`Message`/`MessageList` 经 `streaming`/`isAnimating` 传流式与打字光标状态。`lib/frontmatter.ts` 提供共享 `FRONTMATTER_RE`/`stripFrontmatter`（wiki 页/技能文档的 YAML 头剥离）。旧 `markdown.ts`（marked + DOMPurify 字符串管线）已删除。
- **mermaid.ts**：Mermaid 动态 import（~1MB，不进首包；CSP 禁止 CDN）+ `renderMermaidSvg`——主题取 `--ui-*` token（随明暗主题），渲染**串行队列**（mermaid.render 不能并行），`MermaidDiagram.tsx` 组件失败回退原始文本。
- `ui/`：自绘 UI 组件库（Rail、Modal、Button、Dropdown、Tooltip（portal）、FileIcon（语言徽标 glyph）、icons、command-palette、controls、inputs、layout、surfaces、feedback）。
- `main.tsx`：ReactDOM 挂载。

## 聚焦测试

- `streamdown-view.test.ts`：**markdown 安全边界**（script/iframe/事件处理器净化、GFM 存活；jsdom + @testing-library/react）。
- `knowledge-build-progress.test.ts`：知识 tab 构建阶段清单（索引→Wiki→架构图 状态标记、console tail）。
- `permissions-lib.test.ts`：权限答复解析。
- `dom-harness.ts`（8.5KB）：jsdom 测试 harness（App 级组件测试基础设施）。

## 相关页面

- [renderer-components](renderer-components.md)（组件目录）
- [ipc-contract](ipc-contract.md)、[preload](preload.md)
