# UI/UX 审计报告核对与修复方案（无编码版）

> 日期：2026-08-19 · 对象：[[2026-08-19-ui-ux-audit-report]] 全部 P0/P1/P2 条目
> 方法：逐条按报告所引 `文件:行号` 复核源码，独立重推关键结论（如 P0-1 的 grid
> 自动摆放路径）；行号以 `fix/test-baseline-ui-feedback@da20d16` 为准。
> 性质：核对轮**未改动任何源码**（无编码约束）；批次一+批次二（F1–F5）已于
> 同日另行实施，见 §5 实施记录。

---

## 1. 核对总表

| 编号 | 报告指控 | 判定 | 复核要点 |
|---|---|---|---|
| P0-1 | 右侧预览面板无 grid 归属，可能被挤出窗口 | **属实（真缺陷）** | §2.1 |
| P0-2 | rail 条件显隐导致布局跳动 | **属实** | §2.2 |
| P1-1 | 19 个平级按钮、无分组、无滚动兜底 | **基本属实，计数修正为 18** | §2.3 |
| P1-2 | 编辑器双条件组合是 bug 温床 | **属实** | §2.4 |
| P1-3 | 任务树双入口、主区 tab 不可发现 | **属实** | §2.5 |
| P1-4 | 命令面板仅 11 条、仅子串匹配 | **属实** | §2.6 |
| P1-5 | 权限逐项问答 + deny 静默合并 | **属实** | §2.7 |
| P2-1 | 图标语言断裂（emoji vs SVG） | 属实 | §2.8 |
| P2-2 | ⌘O/⌘J 冗余绑定 | 属实 | §2.8 |
| P2-4 | 主题入口三处且条件显隐 | 属实 | §2.8 |
| P2-5 | i18n 残留硬编码英文 | 属实 | §2.8 |
| P2-6 | tooltip 实现不统一 | 属实 | §2.8 |
| P2-7 | 命名不一致（deepcode-cli 等） | **部分过时** | §2.9 |
| P2-10 | "ten views" 注释实为 11 | 属实 | §2.8 |

结论：**报告可信度高**。2 个 P0 全部坐实，P1 五项全部坐实，P2 十项中九项属实、
一项证据过时（P2-7），一处计数偏差（rail 按钮数）。

---

## 2. 逐项复核记录

### 2.1 P0-1 右侧预览面板丢失 grid 归属 — 属实，且可完整推理出不可见

复核路径（独立于报告重推）：

1. `.ui-shell` 是 4 列 grid：`grid-template-columns: 52px 0 1fr 0`，areas
   `"rail bar bar bar" / "rail panel main rightpanel"`（`ui.css:135-146`）。
   第 4 列在**全部三种状态**下宽度均为 0：基类（137）、`.panel-open`（149）、
   以及 `App.tsx:1158` 的内联 style（拖宽侧栏时重写为 `52px ${panelWidth}px 1fr 0`，
   第 4 列仍钉死 0）。
2. 四个显式定位的子元素各有 `grid-area`：rail（`ui.css:219`）、bar（499）、
   panel（309）、main（669）。
3. `.ui-preview-panel`（`App.tsx:1500、1544` 两处，均为 `.ui-shell` 直接子元素）
   在全 renderer 的样式**只有** `ui.css:8717-8727` 一处：仅宽度（480px /
   min 360px / max 50vw）、边框、背景、入场动画——无 `grid-area`、无
   `grid-column`，无任何主题文件或 media query 补救。
4. 推理：`rightpanel` 单元格（第 2 行第 4 列）虽有名（`ui.css:141`）但
   `.ui-rightpanel` 组件类在全部 TSX 中**零引用**（git grep 证实），即该单元格
   无任何元素占用。CSS Grid 自动摆放（row 稀疏模式）会把未定位的预览面板放进
   第一个空闲单元格 = 第 4 列。该轨道宽 0，面板按 `width: 480px` 从轨道起点
   （= 主区右缘 = 容器右缘）向右溢出 480px——**整个面板在窗口可视区之外**。
5. 互斥缺失属实：两个面板（1499 的 PM-Design/DeepDesign 预览、1543 的
   Architecture Graph）条件独立，可同时挂载；此时第二个面板被挤入隐式轨道，
   同样不可见。
6. 死代码佐证属实：`.ui-shell.right-open`（`ui.css:191-197`）与
   `.ui-rightpanel`（`ui.css:200-209`，含 `grid-area: rightpanel`）在 TSX 中
   零引用——右侧 dock 机制的历史接线确实存在但已断开。

**影响面确认**：PM-Design / DeepDesign 预览（产品差异化卖点）与架构图预览在
当前分支上理论上均不可见。建议真机冒烟一次坐实（见 §4 验证清单），但代码层面
证据链已闭合。

### 2.2 P0-2 rail 条件显隐 — 属实

- tasks 按钮：`{hasPlan ? <RailButton …/> : null}`（`App.tsx:1181-1190`）。
  `hasPlan` 由消息流推导（`App.tsx:1057`），流式期间会翻转 → 下方按钮位移。
- 同模式不止一处：明暗切换（`theme !== "orca"`，1267）、line 变体 / glass
  （`theme === "line"` / 平台条件，1272-1285）——切换主题时 rail 同样跳动。
- 无滚动兜底属实：`.ui-rail`（`ui.css:218-228`）无 `overflow` 规则，窗口过矮
  时底部按钮被裁且无法滚到。

### 2.3 P1-1 导航过载 — 基本属实，计数修正

逐个清点 `App.tsx:1160-1297` 的 RailButton：前段 13 个（newSession、sessions、
git、tasks、commands、plugins、tokens、index、review、design、tasktree、
gitmcp、editor）+ 后段 5 个（reasoning、appearance、punk/glass 二选一、undo、
settings）= **最多 18 个**（报告写 19，多计 1）。侧栏视图 11 个属实
（`use-panel-layout.ts:4-15` 逐项可数）。结构性结论（无分组、无层级、无溢出
收纳）不受计数修正影响。

### 2.4 P1-2 视图状态复合 — 属实，且当场坐实一个具体 bug

主区内联编辑器条件：`sidebarView === "editor" && editorFile`
（`App.tsx:1411`）。而 Git 面板 / DiffOverlay 的"打开编辑器"入口直接传
`onOpenEditor={setEditorFile}`（`App.tsx:1324、1566`）——只设文件、不切视图。
从 Git 面板点"打开编辑器"后主区无任何反应，除非用户再手动点 rail 的 editor
按钮。报告举例的缺陷真实存在。

### 2.5 P1-3 任务树双入口 — 属实

- 侧栏入口：rail 🌳 按钮 → `selectView("tasktree")`（`App.tsx:1238-1245`）。
- 主区 tab：仅 `handleOpenTaskTree`（`App.tsx:858-866`）会 `setActiveTaskTabId`，
  该入口由会话徽章触发——无任何可见提示指向它（tab 头部也只有 🌳 emoji，
  `App.tsx:1427`）。

### 2.6 P1-4 命令面板 — 属实

- 注册命令逐条清点（`App.tsx:957-1029`）：new / plan / plugins / settings /
  undo / export / tokens / init / raw / sidebar / shortcuts = **恰 11 条**，
  无一条视图切换类（11 个侧栏视图、任务树 tab、主题/外观切换全部缺席）。
- 匹配算法：`…toLowerCase().includes(q)`（`command-palette.tsx:48-50`），
  纯子串匹配，注释自称 "fuzzy-ish" 名不副实。

### 2.7 P1-5 权限流 — 属实

- 逐 scope 单项问答：`PermissionCard` 以 index 游标逐个展示 prompt
  （`PermissionCard.tsx:42-52`），scope 多时多轮点击。
- composer 整体禁用：`composerDisabled = showQuestion || showPermission ||
  showPlan`（`App.tsx:1120`）。
- deny 静默合并：`handlePermissionResult` 的 deny 分支把结果存入
  `pendingPermissionReply`（`App.tsx:701-710`，仅设一条状态栏文案），随后
  `runPrompt` 在**下一次任意用户输入**时把它并入 prompt 的
  permissions/alwaysAllows（`App.tsx:570-576`）——用户无感知自己的拒绝决定
  被带进了后续请求。

### 2.8 P2 快速复核（全部属实）

| 项 | 证据落点 |
|---|---|
| P2-1 emoji 图标 | 🎯 `App.tsx:1236`、🌳 `1244/1427`、✦ `1507/1513`、◈ `1547`、✕ `1436/1517`，对照 `ui/icons.tsx` 的 SVG 体系 |
| P2-2 快捷键 | ⌘O 与 ⌘J 绑定同一 `toggleProcessPanel`（`use-global-shortcuts.ts:34-47`）；无 ⌘1-9、无 Esc 栈 |
| P2-4 主题入口分散 | 设置面板下拉 + rail 明暗（1267）+ punk/glass（1272-1285）三处，且条件显隐 |
| P2-5 i18n 残留 | `BUILTIN_SLASHES` 17 条描述全部硬编码英文（`Composer.tsx:49-83`）；"N messages"（`MessageList.tsx:180-182`） |
| P2-6 tooltip 不统一 | rail 用 `data-tip` 自定义 CSS tooltip（`rail.tsx:44` + `ui.css:8155-8163`），其余组件混用原生 `title` |
| P2-10 注释腐化 | `use-panel-layout.ts:3` 写 "The ten views"，实际 11 个（4-15） |

### 2.9 P2-7 命名不一致 — 部分过时

报告引 `i18n/messages.ts:660` 指控 "App 名 DeepOrca vs 仓库 deepcode-cli"。
复核：`messages.ts:660` 现为 `"app.name": "DeepOrca"`；`deepcode` 在
renderer 全域 **零匹配**（about 文案中的 "DeepCode" 是有意的引擎出处致谢，
`messages.ts:662-664`）。该子项证据已失效（疑为旧版本残留或笔误）。
"index 实为知识仪表盘 / gitmcp 暴露实现名"两条属命名语义批评，成立但为
主观改进项，不构成缺陷。

---

## 3. 修复方案（按批次，本轮不实施）

### 批次一：P0 止损（建议本冲刺内完成）

#### F1 右侧预览面板重新接线（修 P0-1）

**推荐方案：复用既有死代码接线，而非新造机制。**

改动点（4 处，均在 `App.tsx` + `ui.css`）：

1. `App.tsx:1156-1158` shell className 增加右栏状态：当 `previewOpen` 面板或
   `graphHtml` 面板任一挂载时追加 `right-open` 类（该类已存在于
   `ui.css:191-197`，含与 `panel-open` 的组合态）。
2. `App.tsx:1158` 内联 style 同步修正：拖宽侧栏时第 4 列不能再写死 0，需随
   右栏状态取值（如 `${rightOpen ? 480 : 0}px`）——否则内联样式会覆盖
   `right-open` 类，这是本修复最容易漏的坑。
3. `ui.css:8717` `.ui-preview-panel` 增加 `grid-area: rightpanel;`，宽度改由
   轨道控制（删除/收敛 `width/min-width/max-width`，避免 480px 定宽与 340px
   轨道的历史值打架；建议轨道 `minmax(360px, 480px)` 并给窄窗口 media query
   收窄档位）。
4. 互斥收口：两个面板合并为单一"右槽位"状态（`preview | graph | null`），
   后开者顶替先开者；或最简做法——打开 graph 时置 `previewOpen=false`，
   反之亦然。

**验收标准**：跑 `/pm-design` 全流程，右侧出现可见 dock 且可关闭；侧栏拖宽
+ 右栏并存时布局正确；两个预览永不并存；窗口宽 <1000px 时右栏收窄不溢出；
6 主题下边框/背景正常；`right-open`/`.ui-rightpanel` 死代码消除（接线或删除
二选一）。

**风险**：低。`right-open` 仅两条历史规则，无冲突样式；注意 `.ui-main`（1fr）
与右栏并存时的最小宽度，防止聊天流被挤爆（可给 main 设 `min-width`）。

#### F2 rail 布局稳定化（修 P0-2，兼收 P2-4 部分）

1. tasks 按钮**常驻渲染**：无计划时降级为禁用态（降透明度 + tooltip
   "暂无计划"），不得移除节点。`App.tsx:1181-1190`。
2. 明暗 / punk / glass 按钮同理：`theme === "orca"` 等条件改为禁用态而非
   条件卸载（`App.tsx:1266-1285`）；或将其全部收编入命令面板，rail 只留
   常驻集合——二选一，推荐前者（改动最小）。
3. `.ui-rail`（`ui.css:218`）补 `overflow-y: auto` + 细滚动条/隐藏样式，
   作为窗口过矮时的兜底。

**验收标准**：`hasPlan` 翻转、主题切换、平台分支变化时，rail 各按钮的几何
位置零位移；窗口压到 600px 高时底部按钮可达。

### 批次二：P1 快速止血（不依赖重设计，小改动）

- **F3（P1-2）**：`onOpenEditor` 回调（`App.tsx:1324、1566`）从裸
  `setEditorFile` 换成包装函数：设文件的同时 `selectView("editor")`。验收：
  Git 面板 / DiffOverlay 点"打开编辑器"，主区立即呈现编辑器。
- **F4（P1-4）**：命令注册扩容——11 个侧栏视图切换、任务树、6 主题 + 明暗
  切换、外观变体、进程面板，目标 ≥30 条，做到"每个 rail 按钮的能力都能从
  ⌘K 到达"；匹配算法从 `includes` 升级为子序列模糊匹配（可选增强）。
- **F5（P1-5 拒绝可见化）**：deny 分支（`App.tsx:701-710`）在状态栏文案之外
  增加 toast/横幅，明示"已拒绝，该决定将随下次发送生效"；批量权限队列
  （按工具分组一次展示）留待批次三。

### 批次三：结构性重构（依重设计文档推进，本方案不展开）

导航收编（18 → 5 区）、统一浮层 Esc 栈、声明式 view router、阶段指挥舱
消息流——以 [[2026-08-19-ui-ux-redesign-vision]] 与
[[2026-08-19-ui-ux-redesign-wireframes]] 为准。P2 各项（图标统一、快捷键
重排、i18n 补全、tooltip 统一）随批次三批量处理，P2-7 的 deepcode-cli 子项
**撤销**（证据已失效）。

---

## 4. 真机验证清单（批次一合入前执行）

1. `/pm-design` 生成原型 → 右侧 dock 可见、可关、可拖宽侧栏共存（F1 核心场景）。
2. `$` 菜单触发 Architecture Graph → 图谱可见，且不与 PM-Design 预览并存。
3. 会话内产生/清除计划 → rail 按钮位置无跳动（F2）。
4. 窗口压至最矮 → rail 底部（settings）仍可点达（F2 兜底）。
5. Git 面板打开文件 → 主区编辑器立即出现（F3）。

---

## 5. 实施记录（2026-08-19 · 批次一 + 批次二）

| 项 | 状态 | 落点 |
|---|---|---|
| F1 右栏接线 | ✅ | `App.tsx`（shell 增 `right-open`、内联 style 改 `--ui-panel-w` 变量、`rightPanelOpen` 派生）、`ui.css`（`.ui-preview-panel` 补 `grid-area: rightpanel` 并去定宽；右栏轨道 `--ui-right-w` 480px / ≤1100px 窗口 380px；删除 `.ui-rightpanel` 死类与 `ui-panel-content-in-right` keyframes）、`use-preview.ts`（预览打开即清 `graphHtml`，单槽互斥） |
| F2 rail 稳定化 | ✅ | tasks/明暗/punk/glass 四按钮全部**常驻 + 禁用态**（保留原启用条件语义：glass 在 line/orca/Win32 下禁用）；`.ui-rail` 加 `overflow-y: auto` 兜底 + 隐藏滚动条；`.ui-rail-btn:disabled` 降透明度样式 |
| F3 编辑器联动 | ✅ | `handleOpenEditor`（setEditorFile + setSidebarView("editor")），侧栏包装器 / EditorPanel / DiffOverlay 三入口接入 |
| F4 命令扩容 | ✅ | 命令面板 11 → **30 条**（9 个视图 + 6 个主题 + 外观 / Line 变体 / 进程面板 / 停止生成）；标签全部走 i18n，复用既有 `rail.*` / `theme.*` / `shortcuts.*` 键 |
| F5 拒绝可见化 | ✅ | deny 分支新增 `pushToast("info", t("app.permissionDeniedToast"))` |
| i18n | ✅ | 新增 3 键（`command.appearance.label` / `command.lineVariant.label` / `app.permissionDeniedToast`）× 6 语言字典（messages.ts en+zh 内联 + ja/ko/zh-hk/zh-tw） |

**门禁**：typecheck ✅ · lint ✅ · format ✅ · 全仓测试 ✅（core 597 / desktop 195 /
embedding 10 / memory 37，0 失败）。

**实施中的附带发现**：

1. 拉取的 `e549a47` 之后 core dist 未重建，desktop typecheck 对旧类型产物报
   3 个假错（`restoreNodeSnapshot` / `meta.snapshot` 不存在）——重建 core dist
   后消失，非代码缺陷，代码本身正确。
2. **遗留断线**：`graphHtml` 在 renderer 中没有任何赋值入口（`onShowGraph`
   仅存在于 `use-preview.ts` 注释里）——架构图面板的触发链路本身是断的，
   即 P0-1 修复后面板"有数据即可见"，但生产数据的入口需要后续接线（批次三
   或单独小项）。

**未竟事项**：§4 真机验证清单待人工冒烟（Electron 真机不在本轮自动化范围）；
P2 各项与批次三结构性重构未动。
