# 交互完善设计案：右键菜单 + 快捷交互（2026-09-05 · 纯设计，无编码）

> 命题（用户）：探索交互层面的完善——右键菜单、快速打开文件目录等；设计在哪里增加右键菜单、增减哪些交互逻辑。
> 现状基线：全仓**零右键菜单**（`grep contextmenu` 仅命中 `autoHideMenuBar`）；复用已有基建——`shell.showItemInFolder` 可走 Electron 原生菜单（main 进程 `Menu.buildFromTemplate` + `webContents.on("context-menu")` 或自定义 IPC 通道），引用桥（`quoteToChat`/`handleQuoteWikiToChat`/`reviewStorePath`）与 `setDraft` 是现成的"注入输入框"通道。
> 设计原则：**每个右键菜单只放"当前对象特有的操作"**——通用操作（复制/全选）交给系统原生行为，不重复造。

---

## 1. Sidebar 会话列表（收益最高的入口）

**现状**：hover 显示 ✕ 删除（两段确认）+ 重命名走单独按钮；无右键。

| 菜单项 | 行为 | 复用 |
| --- | --- | --- |
| 重命名 | 进入既有 rename 编辑态 | `beginRename()` |
| 复制会话 ID | 写剪贴板 | 剪贴板 API |
| 引用到输入框 | 注入 `@<会话摘要>` 到 composer | `setDraft` |
| fork 此会话 | 既有 task-tree fork 流程 | `taskTreeCreate` |
| 在文件管理器中显示 | 打开 `<projectDir>/<id>.jsonl` 所在目录并选中 | `shell.showItemInFolder`（**新 IPC**，见 §7） |
| 删除 | 既有两段确认删除 | `onDelete()` |

**附带**：工作区分组标题（`aggregateByWorkspace` 的组头）右键 → "在文件管理器中打开工作区根目录"。

## 2. 编辑器（CM6 内核 + 结对画布，2026-09-05 深度更新）

> **架构变动**：编辑器内核已从 Monaco 迁移到 **CodeMirror 6**（`cm6-kernel.ts` 单 view 多文档，undo/redo 走 `@codemirror/commands` 的 `undo()/redo()`，`historyFlags` 缓存渲染安全）；新增结对画布组件族（PairBar / LanePanel / CheckpointStrip / EditorPalette / ExplainCard）。悬浮智能体旧组件（EditorAgentFloat）已退役——选区指令由 **PairBar** 承载（`onAskAgent` 旁路保留）。**自动保存 + undo/redo icon bar 已在位**（EditorWorkspace 内 `autoSaveTimerRef` + `kernel.undo()/redo()`）。

### 2.1 文件树（EditorPanel 侧栏，返回对话旁的"编辑器"视图）

| 菜单项 | 行为 |
| --- | --- |
| 打开 | `onOpenFile`（等价左键）→ 打开进 CM6 tab |
| 在文件管理器中显示 | `shell.showItemInFolder`（新 IPC，见 §7） |
| 复制路径 | 相对 / 绝对（二级子菜单） |
| 引用到输入框 | 注入 `@<相对路径>` 到 composer（file 芯片，正则已支持） |
| 新建文件 / 新建文件夹 | 当前目录下创建（走 `editorWriteFile` 空内容 + 刷新树缓存） |
| 重命名 / 删除 | 新 IPC（fs.rename / rm，root-pinned） |

### 2.2 文件 tab（EditorTabBar，右键 tab）

| 菜单项 | 行为 |
| --- | --- |
| 关闭 / 关闭其他 / 关闭全部 | 复用 `onRequestCloseFile`；"其他/全部"需 App 层小扩展 |
| 复制路径 | 同上 |
| 在文件管理器中显示 | 同上 |

### 2.3 编辑区（CM6 EditorView）——**走 CM6 `keymap`/`EventHandlers.dom`，不用 DOM portal**

| 注入项 | CM6 机制 |
| --- | --- |
| 右键自定义项（"问智能体" / "引用到输入框" / "跳到定义(LSP)"） | `EditorView.domEventHandlers({ contextmenu })`——在 kernel 扩展集注册，判断选区后 preventDefault + 自绘菜单；无选区退回浏览器默认 |
| 选区浮动工具条（问智能体/引用/复制） | `tooltips` facet 的 hover tooltip（研究 §1 R5 已验证）或 `coordsAtPos` 锚定的 PairBar 复用 |
| gutter 右键（行号上） | 已有 gutter 装饰基建（R4），加 `domEventHandlers` 同款 |

### 2.4 结对画布新增交互（PairBar / CheckpointStrip / LanePanel）

| 表面 | 交互 |
| --- | --- |
| CheckpointStrip 节点 | 左键 = 回滚（已有 `onRollback`）；右键 = 复制快照全文 / 在文件管理器中显示该文件 |
| PairBar 流式行（pending→review→applied） | 点击 review 态 hunk 芯片 = 逐块接受/拒绝（CM6 merge 原生）；右键 = 复制整块 / 放弃本块 |
| LanePanel 历史行 | 点击 = 展开该轮的 prompt/输出详情；右键 = 复制 / 重发该指令 |

### 2.5 自动保存与 undo/redo（已落地，右键设计的对齐项）

- 自动保存 debounce 在位（EditorWorkspace `autoSaveTimerRef`），AI 编辑行走装饰域**不触发**自动保存（干净基线）
- undo/redo：kernel `undo()/redo()` + `historyFlags`；⌘⌫ 整体回滚 AI 编辑已由 checkpoint 机制覆盖
- 右键菜单的"撤销/重做"项 disabled 态直接读 `handle.historyFlags`——无需新增状态

## 3. 聊天消息流

**assistant 消息右键**：复制全文（既有 copy 按钮）/ 复制选区（浏览器原生）/ 引用到输入框（整段作为上下文注入）。
**tool 行（FlowEventRow）右键**：复制工具参数 JSON / 复制结果 / 在编辑器中打开（resultMd 含文件路径时）。**不做**——消息流右键与文本选择冲突，第一版只做"编辑器中打开"挂到工具卡已有的展开区，降低误触。

## 4. 任务树 hub（SESSION/CHAT 节点）

**节点右键**（现在只剩点击，操作入口太深）：

| 菜单项 | 依据 source.kind | 复用 |
| --- | --- | --- |
| 打开时间线 | session-tree | `onOpenQuick(kind:timeline)` |
| fork 分支 | session-tree | 既有 fork 表单 |
| 引用到输入框 | session-chat/tree | 注入会话摘要 |
| 复制会话 ID | 全部 | 剪贴板 |
| 放弃此任务 | session-tree（status=running 时） | 既有 taskTree abandon 流程 |
| 在文件管理器中显示 transcript | 全部 | `shell.showItemInFolder` |

**轨迹行为行右键**（上一轮已做点击→详情）：复制参数 JSON / 复制结果 / 在编辑器中打开（arg 含 file_path 时）。

## 5. 知识库 / 审查报告列表

| 对象 | 菜单项 |
| --- | --- |
| wiki 页行 | 打开 / 引用到输入框（已有桥）/ 复制 store 路径 / 在文件管理器中显示 |
| 审查报告行 | 打开报告 / 引用到输入框（已有桥）/ 在文件管理器中显示 JSON |

## 6. Token 消耗面板 / 热力图

- 会话行右键：在任务树中打开 / 复制会话 ID
- 热力图格子右键：复制该时段请求数（低优先）

## 7. 基建设计（一次性，全部右键共享）

1. **新 IPC**：`IpcRequest.ShellRevealInFolder (filePath)` → main 里 `shell.showItemInFolder(absolute)`；入参必须 `resolveRegisteredRoot` 钉死（与 wiki/review 同一安全纪律），非法根返回 false。
2. **菜单实现选型**：用 **DOM 自绘菜单**（renderer 内 `<ContextMenu>` 组件 + portal）而非 Electron `Menu.buildFromTemplate`——理由：菜单项是 renderer 状态驱动（per-surface 不同），DOM 方案无需每个表面向 main 发菜单描述；样式与现有 pill/主题一致。`shell.showItemInFolder` 走单条 IPC。
3. **统一组件**：`<ContextMenu items={[{label, icon?, danger?, onSelect, disabled?}]} x y onClose>`——Esc/外点/滚动关闭，键盘上下选择；FileMentionMenu 的键盘导航逻辑可复制。
4. **不做**：系统级全局右键覆写（编辑区文本复制/粘贴交给 Monaco 与浏览器默认）；触屏长按。

## 8. 优先级与排期

| 批次 | 内容 | 理由 |
| --- | --- | --- |
| P0 | `ContextMenu` 组件 + `ShellRevealInFolder` IPC + Sidebar 会话右键 + 编辑器文件树/tab 右键（EditorPanel + EditorTabBar） | 使用频率最高、复用面最大 |
| P1 | 任务树节点右键 + 文件 tab 右键 | 需 App 层小扩展（关闭其他/全部） |
| P2 | 知识库/审查行右键 + 轨迹行右键 + Monaco addAction | 锦上添花 |
| 暂缓 | 消息流全量右键、热力图格子右键 | 与文本选择/低频冲突 |

**风险**：CM6 编辑区右键走 `EditorView.domEventHandlers({ contextmenu })`（kernel 扩展集注册，DOM portal 菜单被 editor 捕获）；`showItemInFolder` 只能 reveal 已存在的文件——任务树 transcript 在会话首次持久化后才可 reveal（fail-open：文件不存在时 toast 提示）。
