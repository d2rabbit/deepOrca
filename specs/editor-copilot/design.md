# deepOrca 编辑器模块重构 — 结对画布（Pair Canvas）· 技术设计

> **状态**：方案稿（只出方案，不改代码）· **日期**：2026-09-05 · 分支 `feat/modern-ui-redesign`。
> **上游**（三件套）：
> ① 视觉交互稿 [`designs/screen-editor-copilot.html`](./designs/screen-editor-copilot.html)（13 项可点击演示，交互形态的唯一基准）；
> ② 内核选型调研 [`docs/research/2026-09-05-editor-kernel-selection.md`](../../docs/research/2026-09-05-editor-kernel-selection.md)（结论：**CodeMirror 6** 替换 Monaco）；
> ③ 可行性实验 [`designs/proof-codemirror6.html`](./designs/proof-codemirror6.html) + 验证截图 ×3（流式/审阅态红绿与 hunk 芯片/gutter/tooltip/undo 全部真实 API 跑通）。
> **用户拍板**（2026-09-05）：内核替换为 CM6；**LSP 深入化采用官方客户端 `@codemirror/lsp-client`**（本稿 §4）。
> **性质**：编辑器模块（`packages/desktop/src/renderer/components/editor/`）唯一重构方案；不含任务分解（tasks.md 待定稿后另出）。

---

## §0 执行摘要

编辑器模块从「Monaco 单体 + 选区聊天浮窗」重构为「**CM6 渲染内核 + 结对画布交互形态 + 官方 LSP 深入化**」三层：

| 层 | 现状 | 目标 |
|----|------|------|
| 渲染内核 | Monaco（`@monaco-editor/react` 惰性 ~5MB；`monaco-loader` + 5 worker） | **CodeMirror 6**（~2.2 MB 全家 unpacked 常驻包，无 worker 面；装饰/布局/tooltip 机制下沉内核） |
| 协作形态 | `EditorAgentFloat` 浮窗式一问一答（textarea + 转圈 + 结果 diff + 应用按钮） | **结对画布**：行内协作条（⌘I）/ 画布内 diff 与 hunk 芯片 / 审阅工具条 / 结对栏 / 检查点轨 / 状态栏（视觉稿全套） |
| 语言智能 | `getModelMarkers` 只读 ts.worker 语法级 | **`@codemirror/lsp-client`**（官方，2025-07 发布）消费主进程 `lsp-bridge` 的十族 language server：诊断/hover/补全/签名/定义/重命名/格式化/引用入画布 |
| 快速定位 | 无跳转动作面（`SymbolGraphView` 纯展示；索引只服务知识面板） | **索引驱动的 Quick Navigation**（⌘P 文件 / ⌘T 工作区符号 / ⌘⇧O 文件内符号）：`codegraph` 索引（nodes 表）→ EditorPalette 模式化模糊定位 → 打开到行（§6） |

**三条主线**：① 内核并轨——`use-editor-workspace`（多文件 drafts/dirty）与 IPC 契约不动，替换渲染面；② 交互重建——按视觉稿演示清单逐项落地，全部以 decoration/widget/tooltip 形态实现（浮窗退出舞台）；③ LSP 深入化——渲染器直连 LSP 协议，编辑器从「高亮 + 自写 diff」升级为「类型级智能在画布内可交互」。

---

## §1 现状盘点（2026-09-05 一手）

### 1.1 模块文件面（`components/editor/`）

| 文件 | 职责 | 重构处置 |
|------|------|---------|
| `EditorWorkspace.tsx`（301 行） | 单 Monaco 实例 + `path` 换模型；子 tab 状态经 hook 保活；⌘S/自动保存/undo-redo 图标 | 渲染面整段替换为 CM6 view（§3）；外围（tab 条/标题/动作）保留 |
| `EditorAgentFloat.tsx`（499 行） | 选区浮窗：textdata 问答、A2UI 澄清、LCS diff、`executeEdits` 应用、pending 装饰 | **重构为协作形态组件族**（§7）：`PairBar` + `BufferDiff` + 装饰 StateField；`diffLines` LCS 退役（由编辑器内核范围集表达） |
| `EditorTabBar.tsx` | 子 tab（脏点） | 保留 + 增 AI 待审点（视觉稿 tab.has-ai） |
| `EditorDiagnosticsDrawer.tsx` | 读 Monaco markers 的底部抽屉 | 数据源换 `@codemirror/lsp-client` 诊断面（§4）；交互升级为状态栏诊断计数 + 行内灯泡（视觉稿 ⑤） |
| `monaco-loader.ts` | 惰性加载 + worker 分发 | **退役**（P2 移除 `monaco-editor` 依赖） |
| `use-editor-workspace.ts` | 多文件状态（与内核无关） | **不动** |

### 1.2 问题清单（上一轮诊断，视觉稿头注释 P1–P6）

P1 AI 与画布物理分离（结果在浮窗，画布只有一块 pending 装饰）；P2 聊天式指令（非流式、无计划/工具可见性）；P3 单一路径触发（无 ⌘I/⌘K/快捷意图/诊断灯泡）；P4 上下文黑盒（无 @file/#symbol 编排）；P5 无检查点/回滚表达；P6 「到会话」旁路让编辑器让位于聊天。重构方案逐条关闭（§7 映射）。

---

## §2 设计哲学：结对画布（承接视觉稿）

命题：**代码画布是唯一真相源，AI 的一切动作都发生在画布上，人始终握着笔**。
四原则：**入画**（AI 输出直接渲染进画布——mark/line/widget 装饰，无结果浮窗）、**意图**（选中即意图、诊断即意图、快捷意图卡、A2UI 就地澄清）、**流痕**（逐行流入 + 计划/工具流推进，无转圈黑盒）、**护栏**（hunk 级 ✓/✕、Tab 接受 Esc 丢弃、跨文件审批队列、检查点回滚）。键盘为第五载体：`⌘I` 行内 / `⌘K` 命令 / `Tab` 接受 / `Esc` 丢弃 / `⌘⏎` 应用 / `⌘⌫` 整体回滚。
**VSCode 底座**：面包屑（符号级）、状态栏（分支/诊断/光标/编码）、行号 gutter、括号配对标尺、⌘K 面板——保留并 AI 化。

---

## §3 内核替换设计（CodeMirror 6）

### 3.1 采纳依据（详见调研纪要 §4/§5）

- **机制即需求**：`Decoration.mark/line/widget/replace`（R2/R3/R5）、`StateField + RangeSet` 随 `Transaction.changes` **自动位置映射**（R1，Monaco 需手造 `deltaDecorations`）、`block widget`（R3 hunk 芯片，文档流内交互 DOM）、`GutterMarker`（R4）、`hoverTooltip`（R5，异步/翻转/避让内建）、`HeightMap` 虚拟化（R9，官方 million-line 示例）。
- **体积**：`monaco-editor@0.56` unpacked **97.9 MB** vs CM6 全家 ≈ **2.2 MB**（registry 数据，报告 §2.2）；按需打包后常用面 gzip 百 KB 级，可取消「编辑器惰性加载」工序。
- **实验证明**（proof-codemirror6.html，全部真实 API）：流式 8 行逐行写入 + 装饰自动映射；审阅态 8 绿 + 2 红删除线 + hunk 芯片 ✓/✕（block widget）；gutter 徽章；hover 诊断 tooltip（含修复按钮）；单一 undo 栈整体回退。**审阅态红绿与芯片与视觉稿逐像素一致**。

### 3.2 多文件模型平移（关键决策）

现状「单实例换模型」的保活收益（undo/滚动/光标按文件保留）在 CM6 以**单 view + `view.setState(EditorState.create({doc}))` 换文档**等价实现（undo 栈随文档重挂）；更推荐**多 EditorView 惰性挂载**（每文件一个 view，挂载到同一容器，切 tab 时 detach/attach，DOM 成本低）——两者均可保留 `use-editor-workspace` 的 drafts/dirty 语义不变。**选定：单 view + setState 换文档 + per-path 扩展缓存**（扩展数组含语言/装饰/LSP 面按文件构造，P0 落地时以实测 10 万行文件切换的帧率选型）。

### 3.3 依赖与打包

- 固定版本精确 pin（AGENTS.md 供应链纪律）：`@codemirror/view` / `state` / `language` / `commands` / `lang-javascript`（+ 按语言面扩充 lang-*）× N；`@codemirror/lsp-client`（§4）。
- 常驻 bundle（不再动态 import）；`monaco-editor` 依赖移除于 P2（P0/P1 并轨期共存可接受，`npm run desktop:build` 双核并存）。

---

## §4 LSP 深入化：官方 `@codemirror/lsp-client`（用户拍板）

### 4.1 官方事实（一手）

`@codemirror/lsp-client@6.2.5`（官方包，Marijn 开发，zoo.dev 赞助，2025-07 发布 announce；284 KB unpacked）：
- **内建 LSP 面**〔announce 帖〕：autocompletion、hover tooltips、signature hints、**go-to-definition、symbol rename、reformatting、find references**；诊断（publishDiagnostics）经 @codemirror/lint 契约进画布。
- **自定义请求 API**〔announce 帖〕：可发起自定义协议方法（客户自定义扩展/未支持能力在客户端代码实现）。
- **异步安全**〔announce 帖〕：响应通过位置映射重解释到**当前文档**版本（编辑不失效），UI 用内核 tooltips/panels 保持一致（文档变化时 UI 同步）。
- **多文件**〔announce 帖〕：为多文件场景设计；社区已验证 tsserver（web worker 运行）与 regal（Styra）接入。

### 4.2 架构：主进程 lsp-bridge 为 server 宿主，渲染器 lsp-client 为协议消费者

```text
renderer（CM6 + @codemirror/lsp-client）              main（lsp-bridge 现有资产）
  lspClient<Server> ──IPC transport──▶ lsp:client  ──▶ lsp-bridge controller
  ├─ hover/补全/签名/定义/重命名/引用                    ├─ server-specs（十族 binary 定位/参数）
  ├─ diagnostics → lint 装饰（波浪线/灯泡）               ├─ server.ts（进程生命周期：按需拉起/回合回收/空闲回收）
  └─ 自定义请求（编辑器专用协议面）                      ├─ lsp-client.ts（已有握手/初始化/读写）
                                                       └─ frames.ts（Content-Length 编解码已有）
```

- **分工**：`lsp-bridge`（main）保持「进程纪律 + 协议服务」；渲染器消费协议不再自造薄层——`@codemirror/lsp-client` 的 `Server` 抽象实现一个 **IPC transport**（renderer → preload `lsp:request` → main → bridge 进程），复用 `frames.ts` 的 `encodeFrame/createFrameParser`（已有单测）作为帧层。
- **工作区语义**：lsp-client 的多文本同步（didOpen/didChange/didClose）按 activeFile 切换驱动；跨文件项目上下文（tsserver 的 project 缓存）天然受益——编辑器 open 的文件即 LSP 工作区成员。
- **与既有诊断环关系**：会话诊断环（Serena MCP `get_diagnostics_for_file`）**保持不动**（agent 侧）；编辑器画布内的实时诊断/灯泡改用 lsp-client 面（用户侧），两者并存、口径各表——避免把 agent 工具面卷入 UI 协议（AGENTS.md「外部能力走 MCP」纪律不破）。
- **首期语言面**：与 lsp-diagnostics 十族一致（TS/JS、Python、Rust、Go、C/C++、C#、Java、Kotlin、Swift、Dart），按受信项目显式开启（与 bridge 的 default-off 纪律一致）；未开启或 server 未就绪时退化：Lezer 语法高亮 + 编辑器内 lint 兜底，fail-open 不阻断。

### 4.3 深入化面（超出「诊断回灌」的增量）

| 能力 | 形态 | 与结对画布的结合 |
|------|------|-----------------|
| 诊断 → 画布 | lint 契约 mark（波浪线）+ gutter 图标 + 状态栏计数 | 视觉稿 ⑤：灯泡 hover → 「用 AI 修复」「解释此错误」→ 走协作条/修复流 |
| Hover | 内核 tooltip（符号签名/文档/类型） | 与「数字体上下文」区分：LSP hover = 客观智能，AI tooltip = 协作动作 |
| 补全 | 官方 autocomplete 集成 | 保持「人先写、AI 策应」的心流；AI 生成期间补全抑制（防抖动） |
| 定义/引用/重命名/格式化 | 命令（⌘F12 等） | 重构意图快捷键直达；「数字体重构」与「LSP 重命名」互为备选路径 |
| 自定义请求 | `request` 面 | 编辑器专属协议扩展（如：选区语义上下文提取供数字体引用）——留 P2 观察 |

---

## §6 索引驱动的快速定位（Quick Navigation）

> 用户拍板（2026-09-05）：**利用既有索引模块（CodeGraph 符号索引）实现 IDEA/VSCode 式的文件/函数快速定位**，一并纳入编辑器重构。

### 6.1 目标与口径

对标 VSCode ⌘P（Quick Open）/ ⌘T（Go to Symbol in Workspace）/ ⌘⇧O（Go to Symbol in File，IDEA 的 Navigate→Symbol / Search Everywhere）——形态统一为 **EditorPalette（⌘K，§7 D13）的模式化扩展**：同一个 fzf 面板，前缀切换模式。快速定位的三种数据源口径：

| 模式 | 快捷键 | 数据源 | 产出 |
|------|--------|--------|------|
| `@` 文件 | ⌘P | CodeGraph 索引 `nodes(kind='file')`（已索引全部文件路径） | 打开文件（既有 `editor:readFile` 链路） |
| `#` 工作区符号 | ⌘T | 索引 `nodes` 全表（name/qualified_name/kind/file_path/start_line/signature） | 打开文件**并跳转 startLine**（CM6 光标 + reveal） |
| `.` 当前文件符号 | ⌘⇧O | 当前文档 CM6 Lezer 语法树（`syntaxTree` 顶层声明）优先，索引同文件行过滤兜底 | 文件内跳行 |

不引入第三方 fzf/模糊库（见 §10）：子序列模糊匹配自写，三个模式共享同一评分器。

### 6.2 存量资产（一手核实，2026-09-05）

- **索引库**：每工作区 `<root>/.codegraph/codegraph.db`（node:sqlite 只读打开模式已有先例）；`nodes` 表字段 `name / qualified_name / kind / file_path / start_line / signature`；`edges` 表（calls/references/instantiates/implements）。
- **现成 IPC**：`knowledge:listSymbols`（root + query → `KnowledgeSymbol[]`，`name LIKE ? OR qualified_name LIKE ?` + `ORDER BY name LIMIT 300`）与 `knowledge:symbolGraph` 均已实现（`main/knowledge-ipc.ts` / `symbol-graph-query.ts`，registered-root 纪律）。
- **缺口**：全部结果停在"展示"——无任何 `跳转动作`（SymbolGraphView 是纯 display；IndexLibraryPanel 只管索引状态）；文件级快速打开也没有（目录树另走 fs 枚举通道）。
- **性能基线**：符号查询 SQL 单点 LIKE + LIMIT 300；10 万节点量级实测在 P1 验收（§9）。

### 6.3 交互设计

**入口与手势**：⌘P / ⌘T / ⌘⇧O 三键直达（打开即 prefill 对应前缀）；⌘K 面板内可随时键入前缀切换；Esc 统一关闭；**结果行键盘流**：↑↓ 选择 / ⏎ 正式打开 / **Tab 预览**（光标定位到行但不开新 tab，VSCode 同款）/ Esc 关闭返回编辑器。

**结果行内容**（每行 = 命中符号或文件）：
```
[class]  UsageSummary             core/src/common/token-counter.ts :58   ✦
[fn]     summarizeUsage           core/src/common/usage-ledger.ts  :22   ✦
         usage-ledger.ts          core/src/common/                 :1
```
- kind 徽章（class/fn/interface/…沿用索引 kind，配色走工具点色）；路径 + 行号（mono，右对齐）；signature 可作副行（hover 展示完整）。
- **编辑器状态面色**：该文件含未决 AI 改动（tab AI 待审点）时行尾显琥珀 `✦`（§7 D5 状态源）；含诊断的行显 ⚡ 计数。

**匹配算法（~60 行，零依赖）**：查询词按字符拆分子序列匹配（`%a%b%c…%` 的 SQL 子序列化 + 内存评分），评分：完全前缀 > 驼峰首字母（`suU`→`summarizeUsage`）> 子序列；`LIMIT 300` 保持（现状）；符号名等权、文件路径按目录深度降权。**降级链**：索引不存在/损坏 → `@` 模式降级为目录树 fs 枚举（现有通道），`#` 模式据实提示"尚未建索引（可触发 index-build）"；stale 索引继续可用并注明。

### 6.4 与协作面的衔接（本模块差异化）

- **定位即意图**：结果行尾 `✦ 问数字体` 按钮——把「符号 + 行 + 当前上下文」作为意图投给行内协作条（例：定位 `summarizeUsage` 后一键「解释这个函数」）——**快速定位与 AI 协作首尾相连**，而非孤立跳转。
- **回跳**：⌥←（在打开的定位跳转间回退，编辑器内导航栈，P1 观察项）。

### 6.5 契约与分期

- IPC **零新增**（复用 `knowledge:listSymbols`；文件行过滤在渲染端读 `KnowledgeSymbol[]` 按 filePath 过滤，300 条内直接内存过滤——超限再议页化）；`use-editor-workspace` 的 `openFile` 不动，跳转 = openFile + CM6 `dispatch(selection/reveal)`。
- 落地：**P1 内**（与 EditorPalette 同批，§9 ⑤）；验收：10 万节点查询 ≤ 30ms、跳转行号精确、stale/缺索引降级无异常、三模式键盘流全通。

## §7 协作形态设计（视觉稿映射 → 内核机制）

### 5.1 组件族重构地图

| 视觉稿演示 | 组件 | CM6 机制 | 现状（Monaco）处置 |
|-----------|------|---------|-------------------|
| D3 行内协作条（⌘I） | `PairBar`（行内 block widget + tooltip 定位） | `Decoration.widget({block})` 锚定选区首行下方；`coordsAtPos` 锚点 | 浮窗 portal 退役 |
| D4 流式生成 | `BufferStream` | `Transaction.changes` 逐行事务 + `addAi` 增量装饰（pending 琥珀）〔实验〕 | 定时器+手工装饰退役 |
| D5 画布内审阅 + hunk ✓/✕ | `BufferDiff` 状态机 | 完成时 `setAi` 整体替换：del mark（红+删除线）/ add line（绿）/ hunk chip（block widget）〔实验〕 | `createDecorationsCollection` 单点装饰退役 |
| D6 快捷意图 | `QuickIntent`（chip 行，hover/圆钮） | widget 内按钮 → PairBar 预填 | 「意图芯片」从浮窗挪入协作条与选区 hover |
| D7 诊断灯泡 | `DiagBulb`（gutter widget + hover menu） | `GutterMarker` + `hoverTooltip`〔实验〕；数据源 lsp-client lint | `EditorDiagnosticsDrawer` 读取端替换 |
| D8 跨文件任务 + 审批队列 | `LaneTask`（结对栏） | 渲染层（非内核）：change 文件清单/审批队列（复用 Orca Deck §3.3 权限队列化） | 新增（现状无跨文件任务面） |
| D10 检查点轨 | `CheckpointStrip` | 应用/回滚 = `history` 栈 + 文档快照（checkpoint = 提交点标注）；⌘⌫ = `undo` 批量〔实验〕 | 新增 |
| D11 上下文编排 | `CtxChips`（PairBar 内 chips） | widget 渲染；`@file/#symbol` 选择器 → prompt 组装 | 上下文 chips 新形态 |
| D12 A2UI 澄清 | `PairClarify`（PairBar 内表单） | widget 内表单（现有 A2uiSurface 复用在 widget 容器） | A2uiSurface 保留、宿主换 widget |
| D13 ⌘K 编辑器命令面板 | `EditorPalette` | Panel/系统浮层 | 新增（编辑器域命令注册表） |

### 5.2 编辑器 AI 状态机（核心不变式）

```
idle ──⌘I/选区意图──▶ pair(输入/澄清) ──发送──▶ streaming(逐行 pending + 计划/工具流)
   └─◀──Esc/丢弃──────── ✕ ── reviewer ──Tab 逐 hunk 或 ⌘⏎ 全部 ──▶ applied(检查点+可⌘⌫回滚)
```
- 装饰域：`StateField<RangeSet>` 三 effect（`addAi` 增量 / `setAi` 替换 / `clearAi` 清除）〔实验定型〕。
- 写盘纪律保持：应用 → 自动保存（现状 800ms 栈）不动；「AI 事务」与「人编辑」同栈但以检查点标注可整体回滚。
- 结对栏（Lane）数据面复用 `use-editor-workspace` 文件态 + 新增 `use-pair-lane`（计划步骤/工具流/变更文件/审批队列），纯渲染层新增，与 IPC 契约无关。

---

## §8 文件与契约变化清单

### 6.1 `components/editor/` 目标布局

```
editor/
  cm6-kernel.ts      # view 工厂、扩展组装（语言/主题/装饰域/lint/lsp-client）、文档切换
  cm6-deco.ts        # addAi/setAi/clearAi、BufferDiff 状态机、hunk chip widget、gutter marker
  PairBar.tsx        # 行内协作条（输入/意图/ctx chips/A2UI/PairClarify）
  BufferStream.ts    # 流式管线（回边：editor:agentRun 流式桥）
  LanePanel.tsx      # 结对栏（计划/工具流/变更文件/审批队列）
  CheckpointStrip.tsx# 检查点轨
  EditorPalette.tsx  # ⌘K 编辑器命令面板
  EditorStatusBar.tsx# 状态栏（AI 三态/诊断计数/上下文预算）
  EditorWorkspace.tsx# 组合根（tab 条/面包屑/上述组件；外围不可变部分保留）
  use-pair-lane.ts   # 结对栏状态 hook
```

### 6.2 IPC/契约变化（最小面）

- **新增** `lsp:clientRequest`（renderer → main，lsp-client transport；privileged；参数校验 + 根钉死沿用 `resolveRegisteredRoot` 纪律）；`EditorAgentStream: "editor:agentRunStream"`（流式回流，取代一次性 `editor:agentRun`——现状非流式缺口在此关闭）——`ipc.ts` 契约文件同步扩展。
- **不变**：`editor:readFile` / `editor:writeFile`、编辑器打开链路、`use-editor-workspace` 语义、A2UI 面（`a2ui:` 通道）。

---

## §9 分期与验收

### P0 — 内核并轨（CM6 渲染面替换，形态最小区块）
- ① `cm6-kernel.ts` 单 view + 多文档切换，替换 EditorWorkspace 渲染面（Monaco 并轨共存）；② 装饰域 + 流式/审阅/应用/撤销闭环（proof 移植）；③ tab 条 AI 待审点、面包屑、状态栏壳。
- **验收**：`npm run check && npm test` 全绿；原有用例（打开/编辑/保存/undo/auto-save/诊断抽屉读 markers）不回归；10 万行文件打开与流式 1k 行追加帧率 ≥ 45fps；proof 效果逐项在真机可复现。

### P1 — LSP 深入化 + 协作形态 + 快速定位完整落地
- ④ lsp-client transport + 十族 server 接线（呼吸与 lsp-bridge 一致）；诊断→画布/灯泡/状态栏；hover/补全/定义/重命名/格式化接入；⑤ PairBar/QuickIntent/CtxChips/PairClarify（A2UI）/D8 审批队列；⑥ ⌘K 编辑器命令面板；⑦ **Quick Navigation（§6：⌘P/@ · ⌘T/# · ⌘⇧O/. 三模式 + fuzzy + Tab 预览 + 定位即意图）**；⑧ 检查点轨与 ⌘⌫；⑨ agentRun 流式桥。
- **验收**：视觉稿 D1–D15 全项可点；快速定位 10 万节点查询 ≤ 30ms、跳转行号精确、缺索引降级无异常；LSP 面受信项目手动开启后可挖 hover/补全/定义；monaco 依赖可整体卸载（P2 收尾）；i18n 六语全量（视觉稿文案 12+ 条入 locales）。

### P2 — 收尾与演进
- ⑨ 移除 `monaco-loader`/`monaco-editor`（Delta：-97.9 MB unpacked / -~5 MB 动态加载）；⑩ 自定义 LSP 请求面（选区语义上下文）；⑪ 长文档/大 diff 基线与退化开关。
- **验收**：`git grep monaco` 零命中；构建体积与首帧基线留档对比。

---

## §10 不做与风险

| 项 | 处置 |
|----|------|
| `@uiw/react-codemirror` 社区封装 | 不引入，自写 ~40 行 thin wrapper（与现状 `@monaco-editor/react` 用法对等） |
| `@codemirror/merge` 作审阅主形态 | 审阅态以自绘装饰（视觉稿一致）为基准；merge 视图保留为「PR 式 diff」可选命令（官方按钮/折叠现成） |
| 第三方 fzf/模糊匹配库 | 不引入；子序列 + 驼峰首字母评分自写（~60 行，三模式共享；fzf 风格） |
| 编辑器级多人协作 / CRDT | 与仓库既定方向一致，不做 |
| 多语言 server 全部常驻 | 只在受信项目显式开启；按需拉起 + 空闲回收（bridge 纪律保持） |
| 快速定位脱离索引自建文件枚举 | 不脱离；`@` 文件模式即索引 nodes(kind='file')，缺索引才降级 fs 枚举（§6.3 降级链） |

| 风险 | 缓解 |
|------|------|
| lsp-client 为较新官方包（2025-07 发布，使用面尚窄） | 已获官方保修（作者维护）；社区 tsserver/regal 实证；P1 前以 lang-servers 十族各验一枚 |
| 单 view 换文档的保活差异 | P0 以 A/B 实测（setState 换文档 vs 多 view 挂载）选型；保活收益降级可接受的依据 = undo 栈随文档本应独立 |
| 自动保存与 AI 审阅的写盘窗口 | 视觉稿已定「应用后才入自动保存栈」；检查点标注独立于 auto-save |
| 大文件 + 流式同时进行 | HeightMap 虚拟化 + transaction 合并（rAF 内批量），P0 性能验收覆盖 |

---

## 附录 A 证据清单

- 视觉稿：`designs/screen-editor-copilot.html`（13 项演示 + P1–P6 诊断 + 四原则）。
- 内核调研：`docs/research/2026-09-05-editor-kernel-selection.md`（CM6 源码一手：decoration/heightmap/tooltip/merge；npm 体积账）。
- 可行性实验：`designs/proof-codemirror6.html` + `preview-proof-cm6-streaming/review/tooltip.png`（真实 API 验证：流式/自动映射/审阅红绿/block widget 芯片/gutter/tooltip/undo）。
- lsp-client 一手：npm registry（6.2.5, 284 KB）+ discuss.codemirror.net announce（能力面/自定义请求/异步映射/社区实证）。
- 仓库现状：`editor/` 五文件、`use-editor-workspace.ts`、`lsp-bridge/*`、`specs/lsp-diagnostics/design.md`。
- 快速定位存量（§6 一手）：`main/knowledge-ipc.ts`（`knowledge:listSymbols` SQL：`name/qualified_name LIKE` + `LIMIT 300`）、`symbol-graph-query.ts`、`.codegraph/codegraph.db` nodes 表字段（name/qualified_name/kind/file_path/start_line/signature）；视觉稿 D14/D15 演示（`preview-editor-copilot-quicknav.png`：⌘P 文件模式 / ⌘T `#ledg` fuzzy → L22 跳转脉冲）