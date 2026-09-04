# 代码审查模块（Review Module）— 详细设计

> **状态**：**设计中 —— 视觉稿与交互已定稿**（`./screen-review.html`），
> 实现按 §6 任务清单分阶段执行；CRG 上游挖矿项见 §5（研究笔记已落地）。
> **✅ 已归档（2026-09-03 用户拍板）**——审查模块主体与 G1-G10 前置修复落地（CodeReviewPanel / ReviewWorkspace / review-store / review-fix 等在树），理论完备收官。
> **日期**：2026-09-01
> **需求来源**：审查 Tab 三提交（805ec73/cb4486e/f3dd487）后的产品迭代拍板
> （范围追随工作区 / 图谱-报告结合定位 / 排除卡落地）；三提交审查报告（P0/P1/P2 清单）
> **前置**：审查管线（ocr 委托 + CRG 直读 SQLite）已上线；风险图谱自研渲染已上线
> **受众**：deepcodeUI 维护者；实现需熟悉 CodeReviewPanel / ReviewWorkspace / 共享 IPC 通道
> / crg-query / review-store

---

## §0 拍板记录（2026-09-01）

| 项 | 结论 |
| --- | --- |
| 范围选择条位置 | **范围条追随「当前工作区」**：位于激活工作区行下方（`ui-review-scope` 行下细控件形态），切换工作区时随行移动，**每工作区独立记忆**设置（用户拍板：范围是工作区的属性，不是面板全局设置） |
| 图谱与审查报告结合 | **采纳双向定位**：报告内可定位 CRG 芯片 → 切图谱选中节点；图谱侧卡「相关审查意见」→ 回报告滚动高亮。绑定规则 = **行级区间匹配**（见 §4.3） |
| 报告历史 | 工作区独立（切换工作区 = 切换历史与图谱）；未建图谱的工作区禁用图谱页签（门控） |
| 排除卡落地 | **采纳**：全排除运行必须在原生报告视图给出解释卡（复用 `review.rpExcluded/rpExcludedNote` 死键） |
| 视觉体系 | **否决 designs/redesign 旧稿（脏数据）**；按真实产品 Tide Stage 外壳 + Aqua 主题 token 重构，设计稿已重绘 |
| CRG 上游挖掘 | 深潜完成（`docs/research/2026-09-01-crg-source-deep-dive.md`）；挖矿项按 §5 排期，P0 项与修复合并 |
| core 直接调用 git | **保持现状（基础边界，不做 Seam 整改）**：`getGitChangedFiles` / `getGitChangedRanges` / `getChurnCounts` / `detectStaleFiles` 在 core 直接 `execFileSync` git/读文件，与 `node:sqlite`、文件系统同属 work 区基础设施边界（git 为仓库根基：preflight、undo、diff 全部直接走 git）；OCR/Electron 类终端能力才走 controller 注入 |

---

## §1 现状盘点与差距

### 1.1 已上线（三提交后）

- 审查管线：`review.full`（core 编排）→ OCR 委托（preview/rule + 宿主模型逐文件审查）+
  CRG 结构富化（`crg-query` 直读 SQLite）
- 报告历史：`.deeporca/reviews/<id>.{html,json}`，上限 10 份；`review-store` 已落地
- 原生报告视图：severity 芯片 / 按文件分组 / 现状-建议代码块（`ReviewWorkspace`）
- 风险图谱：分组卡片 + CALLS 贝塞尔边 + 侧卡 Top1 预填 + 点选联动（`crg-risk-graph`）
- 生成物集中化：`.deeporca/{crg,codegraph,deepwiki,reviews}` 单一常量源 + 双路径只读兼容

### 1.2 审查发现的差距（实现前置项）

| 编号 | 问题 | 位置 | 严重度 |
| --- | --- | --- | --- |
| G1 | `mergeReviewWithCrgRisk` 路径形态不匹配（相对 vs 绝对）→ CRG 标签永不显示；Windows 上 `detectChanges` 反斜杠 vs 库内正斜杠 → 富化整体为空 | `crg-query.ts:508-523` / `detectChanges` | P1 |
| G2 | 全域审查 `slice(0,800)` 在 dot 过滤之前 → 大仓库富化系统性为空且状态误导 | `review.ts:323-334` | P1 |
| G3 | ReviewWorkspace 跨 root 串台（图谱/错误状态不随 root 重置） | `ReviewWorkspace.tsx:92-148` / `App.tsx` 无 `key` | P1 |
| G4 | HEAD 回退时结构背景注入迟于语义审查，状态却报 active | `review.ts:199-246` | P2 |
| G5 | 排除计数双重计算（`excludedByPolicy` 已含 unsupported） | `ocr-cli.ts:523-524,650-653` / `review-report.ts:152` | P2 |
| G6 | 报告 id 毫秒粒度并发覆盖；review.full 无串行化（并发双重建图） | `review-store.ts:53-70` / `review.ts:137-149` | P2 |
| G7 | 半指定 range 静默回退 workspace（模式标签错误） | `review.ts:153-159` / `CodeReviewPanel.tsx:118-125` | P2 |
| G8 | en 状态标签缺失（STATUS_LABELS 无 en/zh-TW） | `ReviewWorkspace.tsx:16-35` | P2 |
| G9 | 报告自动刷新后不自动选中新报告；每次刷新全量传输 findings | `ReviewWorkspace.tsx:124-128` / `main/index.ts:1357` | P3 |
| G10 | App.tsx 2577 行持续超 2500 硬限制 | `App.tsx` | P3 |

### 1.3 CRG 侧差距（上游能力未接入，详见研究笔记 §5-§6）

- 行级变更匹配与路径归一（上游 `map_changes_to_nodes` / `normalize_file_path` / LIKE 兜底）
- 六因子评分模型（deeporca 只读简化版 `risk_index`）
- 受影响执行流（flows / flow_snapshots）
- 社区视图与跨社区因子（Leiden / community_id）
- 规则化审查指引（上游 `_generate_review_guidance` 模式）

---

## §2 设计原则

1. **审查是工作区的属性**：范围、报告历史、风险图谱、设置记忆全部按工作区（root）隔离
   与追随；面板只做"当前工作区"的入口与状态展示（行为对齐索引库）。
2. **报告即证据，图谱即断层**：原生报告视图是唯一阅读面（弃 iframe 套 HTML）；风险图谱
   是报告的结构化断层 —— 每个 finding 可定位到图谱节点，每个节点可回溯其全部意见。
3. **解释优先于猜测**：空审查（全排除）必须给解释卡；degraded 状态必须如实说明
   （语义 → 语义+结构 的等级如实呈现，不承诺未发生的富化）。
4. **安全与主题纪律**：图谱内页在 `sandbox="allow-scripts"` iframe 内渲染，全部插值转义；
   图谱/报告跟随 `[data-appearance]` 双主题；代码井浅 `#f1f3f5` / 深 `#2b2e34`（严禁黑色）。

---

## §3 信息架构与交互规范（对应设计稿 `./screen-review.html`）

### 3.1 侧栏面板（CodeReviewPanel，Hub flyout 内）

- 头部：标题「代码审查」+ 刷新
- **范围条（追随当前工作区）**：位于激活工作区行下方（`ui-review-scope` 行下细控件，
  左缩进 26px 对齐行内容），标签 `审查范围 · {工作区名}`；原生 `<select>`（未提交变更 /
  单个提交 / 引用范围 / 全域）+ 条件显隐的 mono ref 输入（commit / from-to）。
  **切换工作区行 → 范围条随行移动并载入该工作区记忆的范围。**
- 工作区行（`ui-ik-row` 语义）：状态点（图谱已构建 = accent / 未构建 = dim / 运行中 = 脉冲）、
  名称、路径、上次审查相对时间、行内「一键代码审查」按钮（仅激活根可用，其余禁用 +
  hint）
- 运行中：行内进度 `43% — [2/5] 委托审查 src/auth.ts`；完成后行下出现
  「✦ 一键修复 / 💬 追问」chips + 意见数
- 工作区切换：点击行 = 切换当前工作区 —— 激活态迁移、范围条跟随、报告历史 / 图谱 /
  surface chip 标签联动（未建图谱的工作区图谱页签禁用）

### 3.2 审查 Tab（ReviewWorkspace，主区 sheet）

- sheet 右上「✕ 返回对话」pill；tab 头部：pill 页签（审查报告 / 风险图谱）+ 当前工作区
  徽标 + 当前范围提示
- **报告子视图**：左 rail（230px，时间 + 状态 + 文件/意见数，最新在上）+ 右侧原生文档：
  标题 / meta 行（范围-生成-状态）/ 统计卡（审查文件 / 审查意见 / 策略排除卡）/ 按文件
  分组 findings（severity 实色芯片 `#7f1d1d/#c2410c/#b45309/#64748b`、CRG 芯片、定位入口、
  定位行、正文、现状-建议色块）/ 空态（无报告 / 全排除解释卡）
- **图谱子视图**：图谱独占内容画布（历史 rail 让位）；顶部「Top N 风险节点 · M 条调用边 ·
  简化视图」+ 图例（高/中/低 + 安全相关）；分组卡片棋盘 + 贝塞尔 CALLS 边；右侧 side card
  （Top1 服务端预填：位置 / 风险分 / 调用者数 / 测试覆盖 / 安全 / 调用邻居 /**相关审查意见**）；
  点选/悬停 → 其余节点变暗、连线高亮、侧卡联动；移出棋盘复位

### 3.3 双向定位（图谱 ↔ 报告）

- **报告 → 图谱**：可定位的 CRG 芯片 = 内描边 + 「定位 ◎」提示（`chip.crg.locate`），
  点击 → 切图谱页签 + 选中该节点（高亮 + 连线高亮 + 侧卡联动）
- **图谱 → 报告**：侧卡「相关审查意见」区块（severity 色点 + 摘要列表）→ 点击回报告：
  选中所在报告 → `scrollIntoView` → accent 光圈闪烁 1.8s（`.flash`）
- 无绑定节点：芯片保持不可点（无 locate 内描边）；侧卡显示「该节点无对应审查意见」
- 绑定规则见 §4.3（行级区间匹配）

### 3.4 门控与状态

- 审查仅对激活根发起（按钮 disabled + JS 双保险）
- 图谱页签随工作区图谱构建状态门控（未构建 → 禁用 + 提示）
- 范围半指定（只填 from/to 之一）应阻止运行并提示（G7）
- 图谱构建失败/无风险数据 → 图谱页签内错误态 + 可重试（不永久短路）

---

## §4 数据契约

### 4.1 报告元数据（已有，续用）

`ReviewReportMeta`：`id / generatedAt / status / filesReviewed / comments / statusNote /
scopeLabel? / excludedByPolicy? / unsupportedFiles? / findings?`（findings 全量随 meta，
供原生视图直渲；G9 优化项：列表接口可剥离 findings，选中时单读）。

### 4.2 findings 形状（续用）

```
{ path, startLine, endLine?, content, existingCode?, suggestionCode?, crgRisk? }
```
- `content` 带 `[SEVERITY] ` 大写前缀（严重/高/中/低由渲染层剥离并出芯片）
- `crgRisk` 标签修复（G1）后由 merge 填充，形如 `HIGH (12 callers)`

### 4.3 双向定位绑定规则（新增，纯函数 `bindFindingsToNodes`）

1. 主匹配：`finding.path === node.filePath`（归一化后比较）且
   `finding.startLine ∈ [node.lineStart, node.lineEnd]`（**行级区间**，采纳 CRG 上游
   `map_changes_to_nodes` 语义）
2. 兜底：同文件仅有文件级证据时，取 `startLine` 最近的前置节点；仍无 → 判定「无绑定」，
   芯片不可点
3. 输入：`findings[]` + `CrgRiskNode[]`；输出：`Map<nodeQn, findingId[]>` 与
   `Map<findingId, nodeQn | null>`
4. 单测：区间边界（startLine = lineStart / lineEnd）、跨文件重名、无绑定、路径分隔符差异

### 4.4 范围记忆（新增，面板级纯状态）

```
scopes: Map<root, { mode: "workspace"|"commit"|"range"|"all", commit?, from?, to? }>
```
- 读写随激活根切换；持久化位置与工作区设置一致（后续可落盘，首版内存态即可）
- 报告头部「当前范围」提示由该状态实时生成；历史报告的 scopeLabel 是快照，两者区分

### 4.5 评分来源优先级（CRG 挖矿 §6-②）

```
六因子评分器（新，可插拔） > risk_index 简化版（现状） > 无评分
```
默认回退保持现图可用；评分器失败不阻塞图谱渲染（fail-open）。

---

## §5 CRG 上游挖矿映射（详见 `docs/research/2026-09-01-crg-source-deep-dive.md`）

| 项 | 内容 | 优先级 | 对接点 |
| --- | --- | --- | --- |
| ① 行级富化 + 路径归一 | `git diff --unified=0` 区间重叠；posix 归一 + 双形态兜底 | P0（与 G1 合并） | `crg-query.ts:detectChanges`、`review.ts:getGitChangedFiles` |
| ② 六因子 SQL 评分器 | flow 参与 / 跨社区 / 传递测试（递归 CTE）/ 安全词（24 词表）/ 调用者 / churn(opt-in) | P1 | `crg-query.ts` 新增 `getRiskScores`，`getRiskOverview` 排序切换 |
| ③ 受影响执行流 | `flow_snapshots.critical_path` join 变更文件 → 报告「受影响执行流」卡片 | P1 | **实际落地（2026-09-01）**：flows 注入 OCR 审查背景（`review.ts` ① 段 + `formatCrgContextForOcr` 的 IMPACTED FLOWS 段），`getRiskOverview` 未扩展——稿中"报告视图新增区块"未实现 |
| ④ 社区分组图谱 | 按文件 / 按社区 分组切换 + 跨社区连线高亮 | P2 | `crg-risk-graph.ts` 布局参数化 |
| ⑤ 规则化审查指引注入 | 未测试/爆炸半径/继承/跨文件 四条规则译入 `--background` | P2 | `formatCrgContextForOcr` 扩展 |
| ⑥ 图谱新鲜度 | `nodes.file_hash` vs 工作区文件探测 | P3 | review.full 前置提示 |
| 全表 fail-open | 缺列/缺表统一 safe 包装（防上游 schema 迁移漂移） | P1 | `crg-query` 各查询 |

---

## §6 实现任务清单（分阶段，文件级）

> 状态（2026-09-01 复核）：M0-M2 与 M3 的 ①②⑤⑥ 已随 97fcbbf / 7fc3908 落地（勾选项）；
> 未勾选项为仍开放的工作。③ 的实际落点见 §5 表格修订。

### M0 前置修复（三提交审查的 P0/P1/P2 收敛）

- [x] G1：`crg-query.ts` — `detectChanges` 行级匹配 + 路径归一（posix 双形态）；
      修复 `mergeReviewWithCrgRisk` 的 fileRiskMap 键（相对↔绝对统一）；补 merge 单测
      （当前完全无测试）；crg-query 单测补相对路径与 Windows 分隔符用例
- [x] G2：`review.ts:getGitChangedFiles` — 先 filter 后 slice；review-changed-files 测试
      补 commit/range/all 三模式与 dot 文件占位用例
- [x] G3：`App.tsx` 给 ReviewWorkspace 加 `key={root}`（或 root 变化 effect 重置
      graphHtml/graphError/subView）
- [x] G5：`ocr-cli.ts` 排除计数去重（unsupported 从 excludedByPolicy 扣减或文案不求和）；
      `review-report.ts` / 空审查文案同步
- [x] G6：报告 id 加随机后缀；review.full 按 root 串行化（复用 wiki 的 serialized 模式）
      （实现取毫秒碰撞前推，串行化取 Promise 链，等效）
- [x] G7：半指定 range 前端阻止 + core 参数校验（抛错而非静默回退）
- [x] G8：STATUS_LABELS 补 en / zh-TW / zh-HK 组
- [x] G10：App.tsx 按特征模块拆分（不超 2500 行）

### M1 交互补齐（设计稿定稿项）

- [x] `CodeReviewPanel.tsx`：范围 per-root 记忆（4.4）+ 范围条「追随」渲染（行下 + owner 标签）
- [x] `ReviewWorkspace.tsx`：排除卡落地（`excludedByPolicy + unsupportedFiles > 0 &&
      findings.length === 0` 时渲染，复用 rpExcluded/rpExcludedNote 键）；图谱错误态可重试；
      完成后自动选中最新报告（G9）；列表接口 findings 剥离（G9）
- [x] 图谱门控细化：`hasCrgProject`（目录存在）与「有 risk 数据」区分，页签禁用/错误态一致
      （收紧为 graph.db 存在性）
- [x] 工作区切换联动：图谱页签门控、surface chip 标签、当前范围提示（对应设计稿交互）

### M2 图谱 ↔ 报告双向定位

- [x] 4.3 绑定纯函数 `bindFindingsToNodes` + 单测（落地于 `main/tools/review-bind.ts`）
- [x] 报告：可定位芯片（`chip.crg.locate`）→ `switchView("graph")` + 选中节点
- [x] 图谱侧卡：「相关审查意见」区块 → 回报告 + 滚动 + `.flash` 高亮
- [x] 设计稿演示路径全量对齐（面板范围追随 / 双定位 / 门控 / 空态）

### M3 CRG 挖矿（§5 按优先级）

- [x] ① 行级富化（如与 G1 分开评估则在此收尾）+ 状态文案如实化（G4 一并）
- [x] ② 六因子评分器 + 排序切换 + 旧图回退
- [ ] ③ 受影响执行流卡片（报告视图卡片未做；当前经 OCR 背景注入生效，见 §5 修订）
- [x] ⑤ 规则化指引注入 `formatCrgContextForOcr`
- [x] ④ 社区分组图谱（可选） / ⑥ 新鲜度提示（可选）

---

## §7 测试与验收

- 纯函数单测优先：`bindFindingsToNodes`（区间/兜底/无绑定）、路径归一、范围记忆读写、
  `getGitChangedFiles` 行级输出、六因子评分器（对 fixture 图断言因子分解）
- 回归：core 30 项 + desktop 38 项全绿（接 CRG 上游迁移后重跑）
- 手动验收路径（对应设计稿演示）：
  1. 切换工作区 → 范围条跟随且记忆恢复（workspace ↔ commit HEAD）
  2. 新工作区（图谱未建）→ 图谱页签禁用；跑一次审查 → 历史插顶选中、空态转报告
  3. 报告 A → 点 `CRG: HIGH (12 callers) · 定位 ◎` → 图谱选中 login，侧卡含 2 条意见
  4. 图谱点 storeSession → 侧卡意见回跳 → 报告滚动高亮闪烁
  5. 全排除报告 → 排除卡计数与文案正确（不双重计数）
  6. 浅色/深色切换 → 图谱内页与报告配色跟随；代码井不出现纯黑

## §8 不在范围内

CRG Python 常驻（watch/daemon）、上游 embeddings 供应商、跨仓库 registry、
VS Code 扩展、graphml/cypher/obsidian 导出 —— 与 deeporca 模块边界冲突或已有替代。

## §9 关联文档

- 视觉稿：`./screen-review.html`
- CRG 深潜：`docs/research/2026-09-01-crg-source-deep-dive.md`
- 审查三提交审查结论（G1–G10 出处）：会话审查报告（805ec73/cb4486e/f3dd487）