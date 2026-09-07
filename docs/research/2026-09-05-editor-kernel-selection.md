# 编辑器内核选型调研 — Monaco vs CodeMirror 6（结对画布）

> **日期**：2026-09-05 · **性质**：为 `specs/editor-copilot/`（编辑器模块交互重设计：「结对画布」视觉稿）服务的内核选型调研。用户问题：「现在的这个（Monaco）好像有些无法实现 demo 效果，需要更轻量且智能、可嵌入的模组」——本纪要给出选型结论与论证。
> **方法**：① 仓库现状一手取证（`EditorWorkspace.tsx` / `EditorAgentFloat.tsx` / `monaco-loader.ts` / `EditorDiagnosticsDrawer.tsx` / `lsp-bridge` / `specs/lsp-diagnostics`）；② CM6 上游一手取证（zread 直读 `codemirror/view` 的 `decoration.ts` / `heightmap.ts` / `tooltip.ts` 源码、`@codemirror/merge` README 与 API、npm registry 真实体积）；③ 可行性实验（`specs/editor-copilot/designs/proof-codemirror6.html`，esm.sh 加载真实 CM6 包，Playwright 实机验证五项核心效果，截图见同目录 `preview-proof-cm6-*.png`）。
> **证据标注惯例**：〔已核实〕= 直读源码/官方仓库/注册表数据；〔实验〕= 本次可行性实验实机结果；〔未实测〕= 待迁移期验证。

---

## §0 结论（TL;DR）

**推荐 CodeMirror 6（`@codemirror/*` 家族）作为编辑器渲染内核**，替换 Monaco，用于承载「结对画布」的全部交互形态。四句论证：

1. **体积差一个数量级**〔已核实，npm registry 2026-09-05〕：`monaco-editor@0.56.0` 解压 **97.9 MB**（含全部语言包与 TS worker）；CM6 全家（`view` 1.25 MB + `state` 0.43 MB + `language` 0.30 MB + `lang-javascript` 0.06 MB + `merge` 0.18 MB + `basic-setup` 0.02 MB）解压合计 ≈ **2.2 MB**，且模块化按需打包后 gzip 常用面仅百 KB 级（`@codemirror/merge` 满配 unpacked 183 KB）。
2. **demo 需要的机制 CM6 全部一等公民，且比 Monaco 更直接**〔已核实 + 实验〕：流式差分事务（`Transaction.changes` + 装饰自动位置映射，Monaco 需手工维护 `deltaDecorations`）、行内/行间装饰（`Decoration.mark/line/widget/replace`）、交互式行间 widget（hunk 芯片）、自定义 gutter 徽章、hover tooltip（自动避让翻转）、`@codemirror/merge` 的**统一 diff 视图自带逐块接受/拒绝按钮**（`mergeControls` 默认开启，`acceptChunk`/`rejectChunk` 官方命令）。
3. **语言智能缺口已被仓库既有基建补位**〔已核实〕：Monaco 最有价值的资产是内建 tsserver worker；但本仓 `lsp-bridge`（typescript-language-server / pyright 等十族，P0/P1 已落地）已把「类型级诊断」从编辑器内核解耦——CM6 场景下诊断走既有 LSP 回灌即可，不损失能力（Monaco 现状的 `getModelMarkers` 只读 ts.worker 语法级 markers）。
4. **可行性实验全绿**〔实验〕：流式逐行写入 / pending→review 装饰切换 / hunk 芯片 widget ✓✕ / gutter 徽章 / hover 诊断 tooltip / 单一 undo 栈整体回退，全部在真实 CM6 API 上跑通（`proof-codemirror6.html`，约 150 行实现 + 3 张实机截图）。

**迁移成本评估**：中等（见 §7），核心工作是把现有「单 Monaco 实例多模型」模型平移为「多 EditorView 按需挂载」或在单 view 内 `setState` 换文档——既有 `use-editor-workspace`（文件级 drafts/dirty）无需改动，改动集中在 `EditorWorkspace.tsx` 的渲染层与 `EditorAgentFloat` 的装饰/widget 化。

---

## §1 需求：结对画布 demo 效果 → 内核能力清单

`specs/editor-copilot/designs/screen-editor-copilot.html`（视觉稿）的交互效果可拆为以下内核能力需求：

| # | demo 效果 | 需要的内核机制 |
|---|-----------|---------------|
| R1 | 流式逐行写入（琥珀 pending 行逐行出现） | 大量小事务追加文档；装饰随文档自动映射，**不能**每行手工重算装饰 |
| R2 | 画布内 diff：绿 add / 红 ghost del 整行 | 行级范围装饰（可叠加于语法高亮之上）、删除行以幽灵形态呈现 |
| R3 | hunk 芯片（✓/✕ 按钮）悬浮于差异块首 | 行间 block widget（交互式 DOM 组件，不走绝对定位浮层） |
| R4 | gutter 徽章 / 差异块序号 | 自定义 gutter marker（按行查询装饰状态） |
| R5 | 诊断波浪线 + hover 灯泡「AI 修复」 | mark 装饰（CSS 波浪线）+ hover tooltip（异步 source、自动避让/翻转） |
| R6 | 接受/拒绝/全部应用/导航 | 逐块接受拒绝（官方命令或自造）、块间导航、undo 栈覆盖 AI 编辑（⌘⌫ 整体回滚） |
| R7 | 检查点回滚 | 文档快照/undo 协同（历史栈 + 状态快照） |
| R8 | 行内协作条锚定选区 | 选区坐标 → 浮层锚点（`coordsAtPos`）、文档变化时重定位 |
| R9 | 大文件不卡（现有 512K 上下文亦可能打开大文件） | 只渲染可视区（虚拟化/高度映射），长文档响应 |

---

## §2 现状核实：Monaco 集成与真正的"贵"在哪里

### 2.1 现状集成面〔已核实〕

- `EditorWorkspace.tsx`：单一 `MonacoEditor` 实例（`@monaco-editor/react`），`path` prop 换模型服务多文件子 tab；`use-editor-workspace`（文件级 drafts/dirty）与内核无关，迁移不动。
- `monaco-loader.ts`：`ensureMonacoLoaded()` 动态加载（编辑器首次打开才拉 ~5MB JS）+ 五类 worker（json/css/html/ts 编辑）→ 说明 Monaco 体积已是产品侧显式负担。
- `EditorDiagnosticsDrawer`：读 `monaco.editor.getModelMarkers()`——**这是 Monaco 内建语言能力对 UI 的唯一出口**（语法/类型级），被 C 线 lsp-bridge 替代后此出口退役。
- `EditorAgentFloat`：选区跟踪依赖 Monaco 事件；结果 diff 是**自写 LCS**（`diffLines()`，无依赖）；pending 装饰是 `createDecorationsCollection` 单点装饰；「应用到选区」`executeEdits`——装饰与 diff 全手造，正是"Monaco 能做但很费劲"的部分。

### 2.2 体积数据〔已核实，npm registry unpackedSize，2026-09-05〕

| 包 | 版本 | 解压体积 | 说明 |
|----|------|---------|------|
| `monaco-editor` | 0.56.0 | **97.9 MB** | 全语言包 + ts worker + editor.api |
| `@monaco-editor/react` | 4.7.0 | 0.15 MB | 封装层（不含 Monaco 本体） |
| `@codemirror/view` | 6.43.11 | 1.25 MB | 内核（含全部装饰/高度映射/tooltip） |
| `@codemirror/state` | 6.7.4 | 0.43 MB | 状态/事务/效果 |
| `@codemirror/language` | 6.12.4 | 0.30 MB | Lezer 高亮/语法树 |
| `@codemirror/lang-javascript` | 6.2.5 | 0.06 MB | JS/TS/JSX 语法包（Lezer） |
| `@codemirror/merge` | 6.12.2 | 0.18 MB | diff/merge 视图（≈1840 行纯 TS，官方包） |
| `@codemirror/search` / `autocomplete` | 6.7.2 / 6.20.3 | 0.13 / 0.25 MB | 搜索补全（按需） |
| `codemirror` / `basic-setup` | 6.0.2 / 0.20.0 | 0.02 / 0.02 MB | 汇总壳 |

**结论**：CM6 全家解压 ≈ Monaco 的 **1/45**；按需打包后（只引 view+state+language+lang-js+merge+commands）常用面 gzip 约百 KB 量级——`EditorAgentFloat` 场景下甚至可与渲染 bundle 同包，不再需要"编辑器动态加载"这道工序。

### 2.3 Monaco 的"贵"不在体积，而在组合面

Monaco 提供的是**单体编辑器**：装饰 = `deltaDecorations` 手工区间集（每次内容变更后需重算并 diff 提交），交互物 = 绝对定位 DOM/CSS（widget 宽度/位置要自行维护），hover = `registerHoverProvider` + 自管浮层，hunk 级 diff = 自写 LCS（现状 `diffLines()` 即证）。demo 效果不是"做不到"，是**每个效果都要在编辑器之上再造一层状态机**——这正是视觉稿出来后用户感知到的实现风险。CM6 相反：装饰是**状态的一部分**（`StateField` + `RangeSet`），随 `Transaction` 自动映射（`deco.map(tr.changes)`），widget 是文档流内一等 DOM 组件——交互形态下沉到内核层。

---

## §3 候选扫描与排除

| 候选 | 判定 | 一句话理由 |
|------|------|-----------|
| **CodeMirror 6** | ✅ 采纳 | §4/§5 |
| Monaco（现状） | 保留作对照 | 能力齐全但组合成本高、体积大；「智能」资产（ts.worker）已被 lsp-bridge 替代 |
| Ace | 排除 | API 老化，装饰/widget 体系弱，长文档与 React 生态差；无 hover/块 widget 一等支持 |
| ProseMirror | 排除 | 文档模型面向富文本/协作，代码编辑的高亮/装饰/性能特性要自行搭建 |
| CodeJar / contenteditable 系 | 排除 | 演示级，无解析树、无选区坐标体系、无法承载 R2-R9 |
| 自研（Lezer + 自绘视图） | 排除 | EditorView 本身即成熟的"Lezer 语法树 + 高度映射虚拟化"实现，自研 = 重造 CM6 |
| **CodeMirror 6 + 既有 lsp-bridge** | ✅ 最终形态 | 语言智能继续走 MCP/LSP 通道，渲染层完全解耦 |

---

## §4 CodeMirror 6 一手证据（上游源码取证）

### 4.1 装饰系统〔已核实，`codemirror/view/src/decoration.ts`〕

- `Decoration.mark({class})`——范围 mark（R2 绿/红、R5 波浪线：class 里放 `text-decoration:underline wavy` 即可）。
- `Decoration.line({class})`——整行装饰（R1 pending 底、R2 幽灵行），**零长度合法**（`line` 与 `mark` 不同，文档明示 `ranges must be zero-length`）。
- `Decoration.widget({widget, block})`——**行间 block widget**（R3 hunk 芯片）：`WidgetType` 抽象类（`toDOM`/`eq`/`ignoreEvent`——文档明示 widget 内事件默认忽略、可覆写为 false 放行交互，实验中已用）。
- `Decoration.replace({block, widget})`——范围替换/隐藏（删除块呈现形态）。
- 全部继承 `RangeValue`，进 `RangeSet`：**装饰作为 StateField 状态，随 `Transaction.changes` 自动映射**（`deco.map(tr.changes)`，`LineDecoration.mapMode = TrackBefore` 等）——R1 的核心，Monaco 的增量装饰维护在此处直接消失。

### 4.2 大文档/虚拟化〔已核实，`codemirror/view/src/heightmap.ts`〕

- `HeightMap` = 平衡树 + `HeightMapGap`（未渲染区间只存估算高度，`heightForGap` 按行数/行长估计，实测高度增量回流 `MeasuredHeights`）；`BlockInfo.top/height/bottom` 供坐标查询——**只渲染视口附近行**是内核内建行为，官方文档亦以 million-line 示例为特性（codemirror.net 首页「Speed — Remains responsive even on huge documents and long lines」，R9 满足）。
- 动态 block 高度变化有 `requestMeasure` 契约（widget 高度未知时的测量回环），与 R3 的交互 widget 配套。

### 4.3 hover tooltip〔已核实，`codemirror/view/src/tooltip.ts`〕

- `hoverTooltip(source)`：300ms 悬停、**source 可返回 Promise**（异步诊断/LLM 预热）、多 tooltip 同室合并、`above/below` 自动翻转（`strictSide` 控制）、视口外自动隐藏（`clip`）、离开范围自动关闭——R5 的灯泡/修复按钮宿主，无需自管浮层定位。
- `TooltipView` 提供 `offset/getCoords` 等微调面，`getCoords` 可为 `WidgetView` 定制锚点。

### 4.4 merge / diff〔已核实，`@codemirror/merge` README + API，v6.12.2〕

- `MergeView`（分栏比照）与 **`unifiedMergeView({original})`**（单编辑器内联 diff）：新增行内联高亮、**被删行以不可编辑 widget 呈现在新行上方**、`mergeControls`（默认 true）**为每个 chunk 渲染接受/拒绝按钮**、`acceptChunk/rejectChunk` 官方命令（参数 pos 或光标定位）、`goToNextChunk/goToPreviousChunk` 导航、`gutter` 变更行标记、`collapseUnchanged` 折叠、`diff()`（`scanLimit` 防大文档二次方）与 `presentableDiff()`（词边界对齐）工具导出。
- **R2/R3/R6 的直接落点**：AI 结果流写入后，`unifiedMergeView({original: 选区前文本})` = 画布内 diff + 逐块 ✓✕ + 导航，全部官方；「全部应用」= 逐个 `acceptChunk` 或干脆应用事务清空 original 基线。

### 4.5 语言与「智能」边界〔已核实〕

- `@codemirror/lang-*` 系列（JS/TS、Python、Rust、Go、C++、Java、SQL、Vue 等 20+，官方主页清单）提供 **Lezer 语法树 + 高亮 + 局部语法 lint/补全钩子**——**不含类型检查/跨文件分析**；类型级智能需 LSP。
- 本仓已有 `lsp-bridge`（typescript-language-server / pyright 等十族，P0+P1 落地，`specs/lsp-diagnostics`）：诊断经 MCP 桥进会话环，P2 计划 hover/definition——CM6 侧只需一个薄 ViewPlugin 把 `publishDiagnostics` 回灌成 mark 装饰（诊断回灌机制 = CM6 内建 `@codemirror/lint` lintSource 契约，与本仓 MCP 诊断数组结构同构），**不损失任何类型级能力**（Monaco 现状 `getModelMarkers` 的语法级 markers 可由 Lezer linter 平替）。

---

## §5 能力映射：需求 × CM6 × Monaco（对照）

| 需求 | CM6（已核实/实验） | Monaco（现状实现面） |
|------|--------------------|----------------------|
| R1 流式 + 自动映射 | `Transaction.changes` + `StateField` 自动映射〔实验：12 行连续事务无手工装饰维护〕 | `deltaDecorations` 每事务手工提交；本次视觉稿 pending 槽位是手造定时器+装饰 |
| R2 画布内 diff | `mark/line/replace` 三方组合；或 `unifiedMergeView`〔实验〕 | 单点 `createDecorationsCollection` + 自写 LCS（现状 `diffLines`） |
| R3 hunk 芯片 | `block widget`（文档流内 DOM，`ignoreEvent` 放行）〔实验〕 | 需绝对定位 DOM 浮层 + 滚动/重排同步 |
| R4 gutter 徽章 | `GutterMarker` 按行查装饰〔实验〕 | 需 `glyphMargin` + 手工 marker DOM |
| R5 hover 灯泡 | `hoverTooltip`（异步/Promise/自动翻转）〔实验〕 | `registerHoverProvider` + 自管浮层定位 |
| R6 接受/拒绝/导航 | `@codemirror/merge` 官方命令与按钮〔已核实〕 | 无内建；全自造 |
| R7 检查点/回滚 | `history` + 状态快照同栈〔实验：⌘Z 整体回退 7 行写入〕 | `undo()` 内建但 AI 事务与人编辑混栈无标记 |
| R8 锚定浮层 | `coordsAtPos` + `view.posAtCoords` 双向坐标 | `getScrolledVisiblePosition`（现状已手写 `computeFloatPlacement`） |
| R9 大文档 | HeightMap 虚拟化（官方 million 行示例） | 有虚拟化但体积/内存开销大 |
| 语言智能 | Lezer 语法（20+ 语言）+ **lsp-bridge 类型级** | ts.worker 内建（将退役） |

---

## §6 差距、风险与对策

1. **React 封装**〔未实测〕：CM6 无官方 React 组件（`@uiw/react-codemirror` 社区封装 4.25.11 可用但不必需）。建议自写 ~40 行 thin wrapper（`useRef` 挂 view + extension 数组），与现有 `@monaco-editor/react` 用法对等——本仓渲染层本就是自持 hooks，无迁移摩擦。
2. **多文件模型平移**〔设计稿内〕：现状「单实例换模型保住 undo/滚动状态」；CM6 推荐「单 view 常驻 + `setState(EditorState.create(doc))` 换文档」（undo 栈按文档重挂）或按 tab 挂多 view 均可行——沿用 `use-editor-workspace` 不变。
3. **行内 diff 两套语义并存**〔决策点〕：a) 自造装饰 diff（完全对齐视觉稿的「绿/红 ghost + hunk 芯片」）；b) `unifiedMergeView`（官方按钮/折叠/导航一步到位，但被删行以 widget「上方叠显」形态呈现，与视觉稿的 ghost 删除线形态有出入）。建议：**视觉稿保鲜用 a**（差异仅在装饰层，网格与视觉稿完全一致），b 作为「PR 式 diff 视图」的进阶选项。
4. **TS 类型检查的路径变化**〔已核实为不损失〕：Monaco 的 ts.worker 语义（语法 + 轻类型）→ CM6 由 lsp-bridge 的 tsserver 提供真实类型级诊断；首期若 lsp 未覆盖全部语言，Lezer linter 兜底语法级。渲染器侧需要把 lsp-bridge 输出接到装饰（`getModelMarkers` → `lintSource`/mark 回灌，P2 lsp-diagnostics 计划内）。
5. **IME/中文输入**：CM6 原生支持组合输入（官方 a11y 特性），现状 Monaco 也无特殊处理；`no-unguarded-ime-keydown` 纪律照旧适用于自写 keymap。
6. **性能回归测试**〔未实测，迁移期必须〕：大文件（≥10 万行）打开/流式 1k+ 行连续追加的帧率基线，与 Monaco 对照留档。

---

## §7 结论与迁移路径

**结论**：采纳 **CodeMirror 6** 作为编辑器渲染内核；语言智能由官方 **`@codemirror/lsp-client`**（2026-09-05 用户拍板，正式方案见 `specs/editor-copilot/design.md` §4）承载——渲染器直连 LSP 协议，主进程 `lsp-bridge` 保持 server 宿主与进程纪律，「轻量渲染内核 + 官方协议客户端」即用户所求"更轻量且智能、可嵌入"的组合。

**迁移路径（与 specs/editor-copilot 视觉稿验收无关，独立推进）**：

- **P0 并轨（候选内核验证）**：`proof-codemirror6.html` 扩展为与视觉稿同构的完整渲染层（选区锚定协作条 / pending→review 全态 / hunk 芯片 / 检查点轨联调）；跑大文件与长流式基线。
- **P1 渲染层替换**：`EditorWorkspace` 的 Monaco 渲染面替换为 CM6（保留 `use-editor-workspace` 与 IPC 契约不动）；`EditorAgentFloat` 改写成 decoration/widget/tooltip 形态；诊断回灌接 lsp-bridge（`lint` 契约）；依赖按 AGENTS.md 精确 pin（无 `^`）。
- **P2 移除 Monaco**：`monaco-loader` 退役、`monaco-editor` 依赖卸载（Δ 体积 ≈ **-97 MB unpacked / -5 MB 动态加载**），worker 治理面收缩。
- 不做：Ace/ProseMirror 迁移、自研视图、编辑器级多人协作（与仓库既定方向一致）。

## 附录 证据清单

- CM6 源码：`github.com/codemirror/view` `src/decoration.ts` / `src/heightmap.ts` / `src/tooltip.ts`（zread 直读）；`@codemirror/merge` README+API（v6.12.2）；`codemirror.net` 官方首页（huge documents 特性、语言清单）。
- 体积：npm registry `dist.unpackedSize`（2026-09-05 拉取，见 §2.2 表）。
- 实验：`specs/editor-copilot/designs/proof-codemirror6.html` + `preview-proof-cm6-streaming/review/tooltip.png` ×3（Playwright 实机验证：流式追加/装饰自动映射/hunk widget/gutter/hover tooltip/undo 回退）。
- 仓库现状：`packages/desktop/src/renderer/components/editor/*`、`main/tools/lsp-bridge/*`、`specs/lsp-diagnostics/design.md`。