# 交互体系重设计案：右键菜单 + 快捷操作（2026-09-05 · 完整版 · 纯设计无编码）

> **命题**（用户）：探索交互层面的完善——右键菜单、快速打开文件目录等；设计在哪里增加右键菜单、增减哪些交互逻辑。
> **方法**：对当前全部 UI 表面做一手盘点（每处列出既有交互→缺口→设计），再给出统一基建与排期。
> **核心立场**：
> 1. **任务树 = 历史记录**（用户定调）——它的交互是"回看/溯源/引用"，**不设任何改变任务状态的操作**（无放弃、无删除、无改状态）。
> 2. 每个右键菜单只放"当前对象特有的操作"；通用复制/粘贴交给系统默认。
> 3. 交互设计跟随现有心智模型：会话是"对话对象"（可删可改名）、任务是"已发生的事实"（只读+引用）、文件是"工作物"（可打开可定位）。

---

## §0 现状基线（一手盘点）

| 表面 | 既有交互 | 缺口 |
| --- | --- | --- |
| Sidebar 会话列表 | 左键选中 / hover 出 ✕（两段确认删除）/ 重命名按钮 / 归档（`onArchive` IPC 已有） | 无右键；fork 无入口 |
| 编辑器（CM6 内核+结对画布） | 文件树（EditorPanel）左键打开+懒展开缓存 / tab 点击切换 / PairBar 选区指令 / CheckpointStrip 点击回滚 / 自动保存+undo·redo icon | 无右键；无"在文件管理器中显示"；无关闭其他 tab |
| 聊天消息流 | 工具行点击展开 / copy 按钮 / Fork 回合（onTurnFork） | 无右键；无法从工具行直接跳编辑器 |
| 任务树 hub | 节点点击→右侧 timeline；轨迹行为行点击→详情面板（hover 已有） | **保持现状（用户定调）** |
| 知识库 wiki / 审查报告 | 行点击打开；「引用到聊天」按钮（quoteToChat 桥） | 无右键；无法定位 store 文件 |
| Token 面板 / 热力图 | hub 头部按钮打开全域弹窗 | 无行级操作 |
| 全局 | ⌘K 命令面板 + 全局快捷键 hook 已在位 | 无 shell.reveal；无统一菜单组件 |

**全仓零右键菜单**（grep 证实）；`archiveSession`/`unarchiveSession` IPC、`setDraft` 注入、`quoteToChat` 桥、`taskHubChatTrace` 全部现成。

---

## §1 统一基建（一次性，全表面共享）

### 1.1 `<ContextMenu>` 组件（DOM 自绘，portal 挂 body）

```
Props: items: Array<{
  label: string;
  icon?: JSX;           // 16px SVG，取自 ui/icons
  hint?: string;        // 右侧快捷键提示（如 ⌘⇧F）
  danger?: boolean;     // 红色（删除类）
  disabled?: boolean;
  onSelect(): void;
  separator?: true;     // 分隔线项
}>, x, y, onClose
```

行为：Esc/外点/滚动/resize 关闭；↑↓ 键盘导航 + Enter 触发；贴近屏幕边缘自动翻转；出现动画（150ms，对齐既有 pill 过渡）。**键盘导航直接复用 FileMentionMenu 已验证的逻辑**。

菜单注册方式：各表面 `onContextMenu={(e) => { e.preventDefault(); openMenu(e, items); }}`——App 持有一个 `contextMenu` state（`{x, y, items} | null`），经 context 下发 `openMenu`。**不做**全局 `window.contextmenu` 监听（要精确控制哪些表面响应）。

### 1.2 新 IPC：`ShellRevealInFolder`

`IpcRequest.ShellRevealInFolder (absolutePath)` → `shell.showItemInFolder(path)`。**安全**：main 侧 `resolveRegisteredRoot` 钉死（与 wiki/review 同一纪律）——未注册根内的路径返回 `{ok:false}`，renderer toast「无法定位该文件」。文件不存在时同样 fail-open（会话 transcript 在首次持久化前可能不存在）。

### 1.3 新 IPC：`EditorFileOps`（新建/重命名/删除，仅文件树用）

`{op:"create"|"rename"|"delete", root, path, newName?}`——全部 root-pinned；rename/delete 前检查文件未被当前编辑器打开（在 openFiles 里则先走关闭守卫）；删除走系统回收站语义（`shell.trashItem`，可恢复，不直接 rm）。

---

## §2 Sidebar 会话列表（对话对象：完整 CRUD + 引用）

会话是唯一"用户拥有"的可变对象，菜单最丰富：

| 菜单项 | 行为 | 复用 |
| --- | --- | --- |
| 重命名 | 进入既有行内 rename 编辑态 | `onRename` |
| 归档 / 取消归档 | 侧栏收纳，不删除 | `archiveSession` IPC（已有） |
| ── 分隔线 ── | | |
| 复制会话 ID | 剪贴板 | clipboard |
| 引用到输入框 | 注入 `@<摘要前60字>` 提示词缀到 composer | `setDraft` |
| fork 此会话 | 以该会话为源建任务树分支 | `taskTreeCreate` + `bindSession` |
| ── 分隔线 ── | | |
| 在文件管理器中显示 | 打开 `projects/<code>/` 并选中 `<id>.jsonl` | `ShellRevealInFolder` |
| 删除 | 既有两段确认删除（danger 红） | `onDelete` |

**工作区分组头**（`aggregateByWorkspace` 组标题）右键：「在工作区根目录打开终端」（低频，P2）、「在文件管理器中显示工作区根」。

**归档桶行**右键：取消归档 / 删除。

## §3 编辑器（CM6 + 结对画布）

### 3.1 文件树（EditorPanel，密度最高的右键面）

| 菜单项 | 文件 | 目录 |
| --- | :-: | :-: |
| 打开 | ✓（=左键，进 CM6 tab） | — |
| 在文件管理器中显示 | ✓ | ✓（目录本身） |
| 复制相对路径 / 复制绝对路径 | ✓ | ✓ |
| 引用到输入框 | ✓（注入 `@<相对路径>`，file 芯片正则已支持） | ✓ |
| ── | | |
| 新建文件…（输入名弹小浮层） | — | ✓ |
| 新建文件夹… | — | ✓ |
| 重命名… | ✓ | ✓ |
| 删除（移到废纸篓，danger） | ✓ | ✓（非空目录需确认浮层） |

新建/重命名完成后刷新该目录的懒加载缓存（EditorPanel 已有 per-dir cache，revalidate 单目录即可）。

### 3.2 文件 tab（EditorTabBar）

| 菜单项 | 行为 |
| --- | --- |
| 关闭 | `onRequestCloseFile`（脏守卫在 App） |
| 关闭其他 | App 层扩展：循环关闭非当前 tab（逐个走脏守卫，全部干净时才批量） |
| 关闭全部 | 同上，关完回到空态 |
| 复制路径 / 在文件管理器中显示 | 同 3.1 |

### 3.3 编辑区（CM6 EditorView）——走 kernel 的 `EditorView.domEventHandlers`

在 `cm6-kernel.ts` 扩展集注册 `contextmenu` handler（**不能**用 DOM portal——会被 editor 捕获）：

- **有选区时** preventDefault + 自绘菜单：「✦ 问智能体（结对画布）」（把选区喂 PairBar）/「引用到输入框」（代码块注入 composer）/「复制」
- **无选区** 交回浏览器默认菜单（拼写检查等原生能力保留）
- **gutter 上右键**：切换断点（P3，先占位不做）、「复制行号引用」（`file.ts:L42` 格式，恰好是引用桥子集）

### 3.4 结对画布（PairBar / CheckpointStrip / LanePanel）

| 表面 | 左键（已有/新增） | 右键 |
| --- | :-: | --- |
| CheckpointStrip 节点 | 回滚到该快照（已有 `onRollback`） | 「复制此快照全文」「在文件管理器中显示该文件」 |
| PairBar review 态 hunk 芯片 | ✓ 接受 / ✕ 拒绝（CM6 merge 原生） | 「复制本块 diff」「放弃本块」（等价 ✕ 但免瞄准） |
| LanePanel 历史行 | 展开该轮 prompt/输出 | 「复制该轮指令」「重发此指令」（重新进 PairBar 输入框） |

### 3.5 与既有编辑器交互的边界

- **自动保存/undo·redo/⌘S 已在位**——右键菜单不放"保存"（自动保存已废除手动保存心智）
- AI 编辑装饰不触发自动保存（干净基线）不受右键影响；undo 栈由 checkpoint + history 双轨覆盖

## §4 任务树 hub —— **保持现状，本方案不动**

> **设计决定**（用户定调 2026-09-05 二次确认）：任务树交互维持原样——节点点击→右侧 timeline、轨迹行为行 hover+点击→详情面板均已够用。本方案不为任务树增加任何右键菜单或新交互。此前草案中的节点右键/轨迹行右键/图表右键设计全部作废。

## §5 聊天消息流

- **assistant 消息**：右键「引用到输入框」（整段作为上下文前缀注入 composer——与"到会话"旁路互补：那个走流式执行，这个只填草稿）；「复制全文」已有按钮，菜单里重复放一条（肌肉记忆）。
- **工具行（FlowEventRow）**：**不做右键**——与文本选择冲突且已有点击展开；但在展开区加一枚「在编辑器中打开」小按钮（resultMd 含 file_path 时）。P2。
- **用户消息**：右键「编辑重发」（等价现有 retry 入口，若没有则 P2 补）。

## §6 知识库 / 审查报告列表

| 对象 | 菜单项 |
| --- | --- |
| wiki 页行 | 打开 / **引用到输入框**（quoteToChat 桥已有）/ 复制 store 路径 / 在文件管理器中显示 |
| 审查报告行 | 打开报告 / **引用到输入框**（review 桥已有）/ 在文件管理器中显示 JSON / 复制报告 ID |
| 风险图节点 | 定位到报告该 finding（既有 locate）+ 右键「复制 finding 文本」 |

## §7 Token 面板 / 热力图（低优先）

- 会话/模型行右键：「复制会话 ID」（“在任务树中打开”是消费侧跳转入口、不改变任务树本身，P2 一并做）。
- 热力图格子右键：**不做**（低频，且已有 hover 数值）。

## §8 基建排期与验收

| 批次 | 内容 | 验收 |
| --- | --- | --- |
| **P0** | `ContextMenu` 组件 + `ShellRevealInFolder` IPC + Sidebar 会话右键（§2 全表）+ 文件树右键（§3.1 只读部分：打开/reveal/复制路径/引用） | 每表面至少一处可右键打开菜单并执行；Esc 关闭；键盘导航可用 |
| **P1** | 文件树写操作（新建/重命名/废纸篓，§1.3 IPC）+ tab 右键（关闭其他/全部）+ CM6 编辑区 contextmenu handler（§3.3） | 写操作 root-pinned 有测试；删除可从废纸篓恢复 |
| **P2** | 结对画布右键（§3.4）+ 知识库/审查右键（§6）+ assistant 引用到输入框 + 工具行"在编辑器中打开" | — |
| **P3 占位** | gutter 断点、图表导出 PNG、工作区头开终端、用户消息编辑重发 | 不排期 |

**风险与对策**：
- CM6 `domEventHandlers` 与 React 生命周期——kernel 扩展在 mount 时注册，菜单 openMenu 回调经 ref 转发（kernel 不持 React state）。
- `showItemInFolder` 对不存在文件静默无效——统一先 `existsSync` 校验，不存在 toast。
- "关闭其他"遇脏文件——逐个走既有脏守卫，第一个被用户取消即停止（不批量强关）。
- macOS 触控板轻点右键手势天然兼容（contextmenu 事件一致）。

**明确不做**：系统级全局右键覆写；Monaco 时代遗留方案（内核已换 CM6）；任务树任何状态变更操作（历史只读定调）。
