# 右键菜单与快捷交互体系（context-menu-interaction）· 技术设计

> **状态**：**方案稿（只出方案，不改代码）** · **日期**：2026-09-05 · 分支 `feat/modern-ui-redesign`。
> **上游调研**：[`docs/research/2026-09-05-interaction-redesign.md`](../../docs/research/2026-09-05-interaction-redesign.md)（全部表面一手盘点 + 设计论证，本 spec 的直接依据）。
> **用户定调**：① 任务树**保持现状**——现有交互（节点点击→timeline、轨迹行→详情面板）已够用，本 spec 完全不涉及；② 每个右键菜单只放"当前对象特有的操作"；③ 删除走**废纸篓语义**（`shell.trashItem`，可恢复）。
> **对应实现域**：`packages/desktop/src/renderer/`（ContextMenu 组件 + 各表面接线）与 `packages/desktop/src/main/`（ShellRevealInFolder / EditorFileOps 两个 IPC）。**活跃 spec，不属 next-version 规划区。**

---

## §0 执行摘要

全仓目前**零右键菜单**。本方案建立三层基建（统一菜单组件 + reveal IPC + 文件操作 IPC），然后在五个表面接入：Sidebar 会话列表、编辑器文件树/tab/编辑区（CM6）、聊天消息流、知识库/审查列表、Token 面板。**任务树不在范围内（保持现状）**。

| 层 | 内容 | 新增/复用 |
|----|------|-----------|
| 基建 | `<ContextMenu>` DOM portal 组件（键盘导航/Esc 关闭/边缘翻转）；`ShellRevealInFolder` IPC（root-pinned）；`EditorFileOps` IPC（新建/重命名/废纸篓） | 新增 |
| 表面 ×5 | §2-§7 逐表面菜单表 | 复用 `archiveSession`、`setDraft`、`quoteToChat`、`taskTreeCreate` 等既有通道 |

## §1 统一基建

### 1.1 `<ContextMenu>` 组件

```
Props: items: Array<{
  label: string; icon?: JSX; hint?: string;   // hint = 右侧快捷键提示
  danger?: boolean; disabled?: boolean;
  onSelect(): void; separator?: true;
}>, x, y, onClose
```

- portal 挂 `document.body`；Esc/外点/滚动/resize 关闭；↑↓ + Enter 键盘导航（**复用 FileMentionMenu 已验证的导航逻辑**）；150ms 过渡对齐既有 pill 动效。
- App 持单一 `contextMenu` state，经 context 下发 `openMenu(x, y, items)`——各表面 `onContextMenu={e => { e.preventDefault(); openMenu(e.clientX, e.clientY, items); }}`。**不做**全局 window 监听。
- i18n：菜单文案键按表面登记（`ctx.session.*` / `ctx.file.*` / `ctx.tab.*` / `ctx.wiki.*` …），6 locale 全覆盖。

### 1.2 IPC `ShellRevealInFolder`

`IpcRequest.ShellRevealInFolder(absolutePath)` → main `shell.showItemInFolder`。**安全**：`resolveRegisteredRoot` 钉死，未注册根内路径返回 `{ok:false}`；renderer 端先 `existsSync` 校验，不存在 toast「无法定位该文件」（会话 transcript 首次持久化前可能不存在）。

### 1.3 IPC `EditorFileOps`

`{op:"create"|"rename"|"delete", root, path, newName?}`，全部 root-pinned：
- create：空文件/空目录（`editorWriteFile` 空内容或 `mkdir`）
- rename：`fs.rename`
- delete：**`shell.trashItem`**（废纸篓，可恢复——不直接 rm）
- rename/delete 前检查目标未被当前编辑器打开（openFiles 命中→先走既有关闭守卫）
- 完成后回调刷新 EditorPanel 该目录懒加载缓存（revalidate 单目录）

## §2 Sidebar 会话列表（对话对象：完整 CRUD + 引用）

| 菜单项 | 行为 | 通道 |
|--------|------|------|
| 重命名 | 既有行内 rename 编辑态 | `onRename` |
| 归档 / 取消归档 | 侧栏收纳 | `archiveSession` IPC（已有） |
| — 分隔 — | | |
| 复制会话 ID | 剪贴板 | clipboard |
| 引用到输入框 | 注入提示词缀到 composer | `setDraft` |
| fork 此会话 | 以该会话为源建任务树分支 | `taskTreeCreate`+`bindSession` |
| — 分隔 — | | |
| 在文件管理器中显示 | 定位 `<id>.jsonl` | `ShellRevealInFolder` |
| 删除（danger） | 既有两段确认 | `onDelete` |

工作区分组头右键：「在文件管理器中显示工作区根」。归档桶行右键：取消归档 / 删除。

## §3 编辑器（CM6 + 结对画布）

### 3.1 文件树（EditorPanel）

| 菜单项 | 文件 | 目录 |
|--------|:----:|:----:|
| 打开 | ✓ | — |
| 在文件管理器中显示 | ✓ | ✓ |
| 复制相对路径 / 绝对路径 | ✓ | ✓ |
| 引用到输入框（`@<相对路径>`） | ✓ | ✓ |
| 新建文件… / 新建文件夹… | — | ✓ |
| 重命名… | ✓ | ✓ |
| 删除（移到废纸篓，danger；非空目录加确认） | ✓ | ✓ |

### 3.2 文件 tab（EditorTabBar）

关闭 / **关闭其他** / **关闭全部**（逐个走脏守卫，首个被取消即停）/ 复制路径 / 在文件管理器中显示。

### 3.3 编辑区（CM6 `EditorView.domEventHandlers`）

在 `cm6-kernel.ts` 扩展集注册 `contextmenu` handler（DOM portal 会被 editor 捕获，必须走 kernel）：
- **有选区**：preventDefault + 自绘菜单——「✦ 问智能体（喂 PairBar）」「引用到输入框（代码块注入）」「复制」
- **无选区**：交回浏览器默认（拼写检查等原生能力保留）
- **gutter 右键**：「复制行号引用」（`file.ts:L42` 格式）

### 3.4 结对画布

| 表面 | 右键 |
|------|------|
| CheckpointStrip 节点 | 复制此快照全文 / 在文件管理器中显示该文件 |
| PairBar review 态 hunk 芯片 | 复制本块 diff / 放弃本块（等价 ✕ 免瞄准） |
| LanePanel 历史行 | 复制该轮指令 / 重发此指令（回填 PairBar 输入框） |

### 3.5 边界

自动保存/undo·redo/⌘S 已在位——菜单不放"保存"；AI 装饰不触发自动保存的基线不受影响。

## §4 任务树 —— **不在范围内（保持现状）**

用户定调：现有交互已够用。本 spec 不为其增加任何菜单或交互。

## §5 聊天消息流

- assistant 消息右键：「引用到输入框」（整段作为上下文前缀注入 composer 草稿——与"到会话"旁路互补）/「复制全文」。
- 工具行（FlowEventRow）：**不做右键**（与文本选择冲突）；在展开区加「在编辑器中打开」小按钮（resultMd 含 file_path 时）。
- 用户消息右键：「编辑重发」（P2，若 retry 入口已有则等价复用）。

## §6 知识库 / 审查报告

| 对象 | 菜单 |
|------|------|
| wiki 页行 | 打开 / 引用到输入框（quoteToChat 桥）/ 复制 store 路径 / 在文件管理器中显示 |
| 审查报告行 | 打开 / 引用到输入框（review 桥）/ 在文件管理器中显示 JSON / 复制报告 ID |
| 风险图节点 | 复制 finding 文本（定位已有） |

## §7 Token 面板（低优先）

会话/模型行右键：复制会话 ID；「在任务树中打开」（消费侧跳转，不改变任务树本身）。热力图格子：不做。

## §8 分期

| 批次 | 内容 | 验收 |
|------|------|------|
| **P0** | ContextMenu 组件 + ShellRevealInFolder + Sidebar 会话右键（§2 全表）+ 文件树只读项（3.1 前四行） | 每表面可右键执行；Esc/键盘导航；reveal 有 root-pin 测试 |
| **P1** | EditorFileOps（新建/重命名/废纸篓）+ tab 右键 + CM6 编辑区 contextmenu | 写操作 root-pinned 测试；删除可从废纸篓恢复；"关闭其他"遇脏逐个守卫 |
| **P2** | 结对画布右键（3.4）+ 知识库/审查（§6）+ assistant 引用 + 工具行"在编辑器中打开" + Token 行 | — |
| P3 占位 | gutter 断点 / 图表导出 / 工作区头开终端 | 不排期 |

## §9 风险与对策

| 风险 | 对策 |
|------|------|
| CM6 `domEventHandlers` 与 React 生命周期 | kernel mount 时注册，openMenu 经 ref 转发（kernel 不持 React state） |
| reveal 对不存在文件静默无效 | 统一先 existsSync，不存在 toast |
| "关闭其他"批量强关风险 | 逐个走脏守卫，首个取消即停 |
| 菜单与文本选择冲突（消息流） | 消息流只做 assistant 右键，工具行走展开按钮 |

## §10 明确不做

系统级全局右键覆写；Monaco 遗留方案；任务树任何改动（保持现状）；热力图格子右键。
