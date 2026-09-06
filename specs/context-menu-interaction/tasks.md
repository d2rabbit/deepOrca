# 右键菜单与快捷交互（context-menu-interaction）— 任务清单

> 对应设计：[design.md](./design.md)。2026-09-05 立稿，方案稿（未开工）。
> 上游调研：[docs/research/2026-09-05-interaction-redesign.md](../../docs/research/2026-09-05-interaction-redesign.md)。
> 红线：任务树保持现状（零改动）；删除走废纸篓；reveal 全部 root-pinned；消息流工具行不做右键。

## P0 基建 + 高频表面

- [ ] **P0.1** `renderer/components/ContextMenu.tsx`：DOM portal 菜单组件（items/danger/disabled/separator/hint；Esc/外点/滚动关闭；↑↓+Enter 导航复用 FileMentionMenu 逻辑；边缘翻转；150ms 过渡）
- [ ] **P0.2** App 层 `contextMenu` state + `openMenu` context 下发（不做全局 window 监听）
- [ ] **P0.3** `shared/ipc.ts` `IpcRequest.ShellRevealInFolder` + main handler（`shell.showItemInFolder`；`resolveRegisteredRoot` 钉死；renderer 先 existsSync，缺失 toast）
- [ ] **P0.4** Sidebar 会话行右键：重命名/归档·取消归档/复制 ID/引用到输入框/fork/在文件管理器中显示/删除(danger)——复用 onRename·archiveSession·setDraft·taskTreeCreate·onDelete
- [ ] **P0.5** Sidebar 工作区分组头右键（显示工作区根）+ 归档桶行右键（取消归档/删除）
- [ ] **P0.6** EditorPanel 文件树右键（只读四项）：打开/在文件管理器中显示/复制相对·绝对路径/引用到输入框（`@<相对路径>` 注入）
- [ ] **P0.7** i18n：`ctx.session.*`/`ctx.file.*` 键族 ×6 locale
- [ ] **P0.8** 测试：ContextMenu 键盘导航/Esc/翻转真值表（dom-harness）；reveal root-pin 拒绝未注册根；Sidebar 菜单项触发既有回调（spy 断言）

## P1 文件写操作 + tab + 编辑区

- [ ] **P1.1** `EditorFileOps` IPC：create/rename/delete(trashItem)——root-pinned；openFiles 命中先走关闭守卫；回调 revalidate EditorPanel 单目录缓存
- [ ] **P1.2** 文件树写操作菜单：新建文件…/新建文件夹…（名称小浮层）/重命名…/删除（非空目录确认浮层）
- [ ] **P1.3** EditorTabBar 右键：关闭/关闭其他/关闭全部（逐个脏守卫，首个取消即停）/复制路径/在文件管理器中显示
- [ ] **P1.4** cm6-kernel 注册 `EditorView.domEventHandlers({contextmenu})`：有选区→问智能体(PairBar)/引用到输入框/复制；无选区→浏览器默认；gutter→复制行号引用（`file.ts:L42`）；openMenu 经 ref 转发
- [ ] **P1.5** 测试：EditorFileOps root-pin/重命名打开中文件被拒/废纸篓可恢复（mock）；关闭其他遇脏中断；CM6 handler 选区分支

## P2 画布 + 知识库 + 消息流 + Token

- [ ] **P2.1** CheckpointStrip 节点右键：复制快照全文/在文件管理器中显示该文件
- [ ] **P2.2** PairBar review 态 hunk 芯片右键：复制本块 diff/放弃本块；LanePanel 历史行右键：复制指令/重发（回填输入框）
- [ ] **P2.3** KnowledgePanel wiki 行右键（打开/引用/复制 store 路径/reveal）；ReviewWorkspace 报告行右键（打开/引用/reveal JSON/复制 ID）；风险图节点复制 finding
- [ ] **P2.4** assistant 消息右键：引用到输入框（上下文前缀）/复制全文；FlowEventRow 展开区加「在编辑器中打开」按钮（resultMd 含 file_path 时）；用户消息「编辑重发」
- [ ] **P2.5** Token 面板行右键：复制会话 ID/在任务树中打开（消费侧跳转）
- [ ] **P2.6** i18n 补齐 `ctx.pair.*`/`ctx.wiki.*`/`ctx.msg.*`/`ctx.token.*` ×6；测试补 P2 表面菜单真值表

## P3（占位不排期）

gutter 断点 / 图表导出 PNG / 工作区头开终端
