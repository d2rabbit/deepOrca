---
type: desktop
title: 渲染层（renderer）
description: React 渲染层架构：App 状态机、hooks、i18n、lib 工具、markdown 渲染与 UI 组件库。
tags: [renderer, react, hooks, i18n]
---

# 渲染层（renderer）

`packages/desktop/src/renderer/` 是浏览器 bundle（无 Node/Electron 访问），唯一入口是 `window.deeporca`（[preload](preload.md)）。

## App.tsx（~2500 行，2026-08 潮汐舞台重设计）

`App()` 是唯一顶层组件，管理：

- **状态**：projectRoot、homeDir（避免把用户主目录当工作区呈现）、sessions、activeId、messages、draft、imageUrls、busy/enhancing、permission 待办、plan、设计产物、知识状态、任务树、**pipStack（画中画栈）**。
- **主区 tab 模型**（`MainTab`）：会话 tab 是固定首 tab（不可关闭）；设置/插件/编辑器文件/知识/任务记录各自开 **自己的 tab**（`auxTabs` + `taskTabs` + `knowledgeTabs`），互不覆盖——取代了旧的 `mainView` 三态（其 bug：设置/插件占据主区时，其他面板开的 tab 在底下永远够不到）。`mainView` 仅保留为后向兼容派生值。关闭辅助 tab 回落到会话 tab。
- **潮汐舞台布局**（00d80266 起）：对话是舞台**基础层**，辅助 surface（设置/插件/编辑器/知识/任务记录）作为**同一平面的平铺工作区面板**渲染（`ui-shell` + shell.css docking 规则），不再是遮挡式整幅覆盖；**HubSheet 浮岛**（`components/HubSheet.tsx`）取代旧的 rail + docked sidebar——**L1 竖排 icon 栏**（12 个模块：sessions/git/tasks/tokens/index/review/prototype/design/tasktree/gitmcp/editor/plugins）由**潮汐小球（tide orb）/ ⌘B** 召唤，**L2 内容浮层**在点选图标后从栏旁展开（可拖宽、宽度持久化）；**QuickDock**（左上常驻胶囊：会话切换/新建会话/打开工作区三件套，枢纽打开时隐藏）；**工作区画中画**（872d7a6f）——切走的会话收缩为右下小窗（`pipStack`，冻结消息摘要、可快速切回；`ask_permission`/`waiting_for_user` 阻塞时标 `blocked` 并显示恢复提醒条）；`panelOpen`/`viewExtended`/CSS 变量（`--ui-panel-w`/`--ui-right-w`）保持轨道偏移、舞台回流与伴航卡宽度联动。
- **工具活动轨迹浮窗**（`ToolActivityPanel`，20a36508）：右侧浮动 A2UI 小窗实时流式展示 bash/read/write/edit/skill/MCP 调用（surfaceId `"tool-activity"`，renderer-local 不落盘、不进入主进程 surface map，最新 12 条 + 总数）。**模型异常弹窗**（`lib/llm-error.ts` + 后台构建错误分类）：对 `looksLikeLlmTransportError` 特征（openai SDK/undici 连接错误、HTTP 状态码形状、auth/quota 文案）弹出诊断入口，wiki CLI 退出或 mermaid 解析错误绝不误弹（属于构建控制台）。**FailureBanner**（e1cadb38）：会话失败态常驻横幅——重发最后用户消息 / 跳设置端点页 / 关闭；重启后仍由 live session status + 持久化 `failReason` 驱动。
- **懒加载**：CodeReviewPanel、DiffOverlay、EditorOverlay、PrototypePanel、DesignPreview、DesignPanel、KnowledgePanel、TaskTreePanel、TaskRecordPanel（Monaco + markdown 渲染器 ~5MB+ 延迟到需要时）。
- **辅助函数**：`findLatestPlan`、`syntheticUserMessage`、`findPendingAskUserQuestion`、`extractOpenuiFence`（OpenUI 内联块提取）、`extractProposedPlan`/`getImplementationPrompt`（Plan 审批）。
- **命令面板**：CommandPalette（rail 命令、全局快捷键）。

## hooks/

| hook | 职责 |
| --- | --- |
| `use-tree-refresh` | 会话/消息树的定时刷新 |
| `use-document-title` | 文档标题（会话摘要） |
| `use-composer-dock-height` | Composer dock 高度 |
| `use-panel-layout` | **枢纽/面板布局持久化**（`SidebarView` 枚举：explorer/scm/tasks/tokens/index/review/prototype/design/tasktree/gitmcp/plugins/editor——HubSheet 的 12 个模块视图） |
| `use-companion-width` | 伴航卡宽度（拖宽持久化） |
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

- **样式组织**（07e03967）：`styles-*.css`（主题变体）+ `ui.css` 拆为 **`@import` 索引 + `ui-css/` 12 模块目录**（tokens/primitives/shell/chat/composer/side-panels/editor-panel/settings/knowledge-views/skill-cards/wiki-reading/vscode.css）——每个模块按面板域自包含，改样式先定位对应 `ui-css/*.css`。
- **图标去 emoji**（b2228d83）：所有 icon 统一 SVG 绘制（`ui/icons.tsx` + `ui/file-icon.tsx` 语言徽标 glyph），不再使用 emoji 字符（`background-task-badge.test.ts` 断言 SVG 结构）。
- **markdown 渲染**：`components/StreamdownView.tsx`（streamdown：remark/rehype → React 元素树，**无 `dangerouslySetInnerHTML`**；rehype-sanitize GitHub schema + rehype-harden URL allowlist；流式模式 remend 增量解析不闪断；remark-breaks 保留单换行 `<br>`；JSON 块 pretty-print；`MermaidBlock` 自定义渲染器把 ```mermaid fence 交给 mermaid.ts）。`Message`/`MessageList` 经 `streaming`/`isAnimating` 传流式与打字光标状态。`lib/frontmatter.ts` 提供共享 `FRONTMATTER_RE`/`stripFrontmatter`（wiki 页/技能文档的 YAML 头剥离）。旧 `markdown.ts`（marked + DOMPurify 字符串管线）已删除。
- **mermaid.ts**：Mermaid 动态 import（~1MB，不进首包；CSP 禁止 CDN）+ `renderMermaidSvg`——主题取 `--ui-*` token（随明暗主题），渲染**串行队列**（mermaid.render 不能并行），`MermaidDiagram.tsx` 组件失败回退原始文本。
- `ui/`：自绘 UI 组件库（Rail、Modal、Button、Dropdown、Tooltip（portal）、FileIcon（语言徽标 glyph）、icons、command-palette、controls、inputs、layout、surfaces、feedback）。
- `main.tsx`：ReactDOM 挂载（2026-08-27 起 window 级错误监听 + 根级 ErrorBoundary）。

## 聚焦测试

- `streamdown-view.test.ts`：**markdown 安全边界**（script/iframe/事件处理器净化、GFM 存活；jsdom + @testing-library/react）。
- `knowledge-build-progress.test.ts`：知识 tab 构建阶段清单（索引→Wiki→架构图 状态标记、console tail）。
- `permissions-lib.test.ts`：权限答复解析。
- `dom-harness.ts`（8.5KB）：jsdom 测试 harness（App 级组件测试基础设施）。

## 相关页面

- [renderer-components](renderer-components.md)（组件目录）
- [ipc-contract](ipc-contract.md)、[preload](preload.md)
