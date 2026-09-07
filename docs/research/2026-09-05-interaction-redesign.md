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

## §3 编辑器（CM6 + 结对画布）——**以 specs/editor-copilot 为唯一权威，本方案不另立编辑器交互**

> **2026-09-06 重新梳理（用户纠偏）**：编辑器交互已有完整体系且仍在快速演进（右键菜单/结对画布/多 hunk 审阅/检查点/⌘P 导航/面包屑均为 2026-09-05~06 新落地）。本方案对编辑器**只做两件不与之冲突的事**：① 文件树侧栏（EditorPanel）与 tab 条的右键——这两个表面不在 editor-copilot 范围内且无既有菜单；② 向**既有**编辑区右键菜单（`ui-edctx`）按其既有模式**追加**菜单项，不替换、不重构。此前草案中"走 kernel domEventHandlers"的技术判断是错的（现有 wrapper DOM portal 实现已验证可行），结对画布右键设计（CheckpointStrip/PairBar/LanePanel）全部撤回——这些表面的交互归 editor-copilot 管。

### 3.1 文件树（EditorPanel 侧栏，返回对话旁的"编辑器"视图）

| 菜单项 | 文件 | 目录 |
| --- | :-: | :-: |
| 打开 | ✓（=左键，进 CM6 tab） | — |
| 在文件管理器中显示 | ✓ | ✓ |
| 复制相对路径 / 复制绝对路径 | ✓ | ✓ |
| 引用到输入框 | ✓（注入 `@<相对路径>`，file 芯片正则已支持） | ✓ |
| 新建文件… / 新建文件夹… | — | ✓ |
| 重命名… | ✓ | ✓ |
| 删除（移到废纸篓，danger；非空目录确认） | ✓ | ✓ |

新建/重命名/删除完成后 revalidate EditorPanel 该目录懒加载缓存（已有 per-dir cache）。

### 3.2 文件 tab（EditorTabBar）

| 菜单项 | 行为 |
| --- | --- |
| 关闭 | `onRequestCloseFile`（脏守卫在 App） |
| 关闭其他 / 关闭全部 | App 层扩展：逐个走脏守卫，首个被用户取消即停 |
| 复制路径 / 在文件管理器中显示 | 同 3.1 |

### 3.3 编辑区右键 —— **既有 `ui-edctx` 菜单是权威实现，只追加不替换**

现状（2026-09-06 已落地）：`EditorWorkspace` 在 `ui-editor-cm6-wrap` 上 `onContextMenu` → DOM portal 渲染 `ui-edctx` 菜单，项含：✦ 行内协作(⌘I) / ◌ 解释选中 / ⟲ 重构选中 / ↑ 优化它 / ⇱ 发送到会话（选区指令注入主会话）/ 复制 / 粘贴 / 全选——无选区时 AI 项 disabled，剪贴板项常可用。

本方案仅追加一项（遵循既有模式：portal 渲染、disabled 无选区、i18n `editor.ctx.*` 键族 ×6）：

| 追加项 | 行为 |
| --- | --- |
| ⇨ 引用到输入框 | 选区代码块注入 composer 草稿（`setDraft`，与"发送到会话"互补：那个走流式执行，这个只填草稿） |

**不做的**：替换菜单实现；改触发机制（wrapper portal 已验证可行，无需迁 kernel `domEventHandlers`）；增删既有八项的任何一项。

### 3.4 结对画布（PairBar / EditorReviewBar / CheckpointStrip / LanePanel / EditorPalette / ExplainCard）——**交互归 specs/editor-copilot，本方案零改动**

这些表面的交互设计（⌘I 协作条、多 hunk ✓✕ 芯片与导航、检查点回滚、⌘P/⌘T/⌘⇧O、解释卡不落盘）全部是 editor-copilot 的领域且已实现。本方案不为其添加任何右键或新交互——此前草案的相关设计**全部作废**。

### 3.5 与既有编辑器逻辑的对齐声明

- 自动保存（debounce）/⌘S/undo·redo icon——已在位，菜单不放"保存"
- AI 编辑走装饰域不触发自动保存的干净基线——不受影响
- "解释永不改写 buffer"（ExplainCard 浮卡）——追加项"引用到输入框"同样零 buffer 写入
- 面包屑/诊断跳转/LSP——不动

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
| **P1** | 文件树写操作（新建/重命名/废纸篓，§1.3 IPC）+ tab 右键（关闭其他/全部）+ 既有 `ui-edctx` 菜单追加"引用到输入框"项（§3.3） | 写操作 root-pinned 有测试；删除可从废纸篓恢复；追加项 disabled 态一致 |
| **P2** | 知识库/审查右键（§6）+ assistant 引用到输入框 + 工具行"在编辑器中打开" | — |
| **P3 占位** | gutter 断点、图表导出 PNG、工作区头开终端、用户消息编辑重发 | 不排期 |

**风险与对策**：
- ~~CM6 `domEventHandlers` 方案~~ 已废弃——既有 `ui-edctx` wrapper portal 实现验证可行，追加项沿用同一模式（2026-09-06 重梳理更正）。
- `showItemInFolder` 对不存在文件静默无效——统一先 `existsSync` 校验，不存在 toast。
- "关闭其他"遇脏文件——逐个走既有脏守卫，第一个被用户取消即停止（不批量强关）。
- macOS 触控板轻点右键手势天然兼容（contextmenu 事件一致）。

**明确不做**：系统级全局右键覆写；替换/重构既有 `ui-edctx` 编辑区菜单；结对画布组件任何改动（归 specs/editor-copilot）；任务树任何改动（保持现状）。
