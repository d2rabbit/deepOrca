# 架构图强化层（arch-map-reinforce）— 技术设计

> **状态**：**设计稿 v2（2026-09-06，未实施）**——上游：对 [plannotator/effective-html](https://github.com/plannotator/effective-html) 的对比调研（会话内完成，按约定不落地调研报告）。v2 增补（2026-09-06）：编辑器侧换核复核——`specs/editor-copilot` 拍板 CM6 替换 Monaco 且已在本分支落地（Monaco loader / EditorAgentFloat / EditorDiagnosticsDrawer 已删除，`cm6-kernel/cm6-lsp/PairBar` 等就位），据此催生 **R6 图板 → 编辑器跳转联动**。
> **命题**：给 archify 架构图管线加一层「强化」——**不动管线架构、不改 IR schema、不 fork 渲染器、不碰安全机制**，把 effective-html 这套已被社区验证的方法论（范例语料锚定、叙事优先、轻量触发）移植到我们的**生成侧提示词层**与**既有 post-deliver patch 层**，并把编辑器换核带来的既有「打开代码」通道接进图板（R6，纯接线）。
> **对应实现域**：`packages/core/templates/plugins/code/skills/arch-scan/SKILL.md`（提示词层主体）、`packages/core/src/actions/arch-scan.ts` + `packages/core/src/session-manager-tasks.ts`（加性参数与任务提示词段落）、`packages/desktop/src/main/tools/archify-cli.ts`（patch 块家族）、`packages/desktop/src/renderer/components/KnowledgePanel.tsx` arch pane（R6 消息监听与打开接线）、`<targetRoot>/.deeporca/prototypes/golden/`（golden 语料约定，仅目录约定无代码）。
> **硬约束**：① 零管线改动——`archify deliver` 门禁、receipt/HMAC 链、viewer 渲染器、IPC 形状全部零触碰；② 零新依赖；③ **vendored 树零手工改动**（`scripts/vendor-archify.js` 在上游 HEAD 变化时整树重生成，任何塞进 `vendor/archify/` 的自有文件都会被冲掉——本 spec 所有自有资产一律放 core templates 或 patch 注入）；④ 新增用户可见文案落全 6 个 locale；⑤ 单文件长度标准（2500±10%）不破，SKILL.md 当前 177 行、arch-scan.ts 当前 110 行，余量充足。

---

## 0. 背景与结论

### 0.1 提案是什么（一句话）

archify 管线在**交付可靠性与安全**上已全面领先 effective-html（确定性验收门、HMAC receipt、增量交付、viewer patches），差距集中在三件"生成侧软实力"：**模型落笔前没有成品视觉锚**、**story 叙事能力在提示词侧没被用满**、**缺一个"随手讲解一张图"的轻触发**。本 spec 用纯提示词层改动 + 既有 patch 机制补齐这三件事，外加一个 golden 语料自蒸馏约定与一处主题持久化收敛。

### 0.2 与 effective-html 的分界（adopt / reject）

| effective-html 的做法 | 判定 | 本 spec 的承接方式 |
| --- | --- | --- |
| 范例语料锚定（20 个成品 HTML 作为 few-shot 风格锚） | **采纳方法论** | 不搬语料（第三方授权 + token 代价），改为 R2 成品质感规约 + R4 golden 自蒸馏；成品锚用 vendored 自带的 5 个 rendered 孪生的**人工提炼结论**，不喂源码 |
| 模型直写成品 HTML（无 schema、无验收门） | **拒绝** | 我们是 iframe 嵌入模型产物的场景，无门禁的自由 HTML 正是 receipt 要防的注入面；IR + deliver 门禁不动 |
| 叙事优先（"diagram 能动画演示行为序列"，flow chip 点亮请求路径） | **采纳** | 我们的 viewer 本就有 guided views / story / beat / moment（比它强），只补提示词侧把 `meta.views` 用满（R1） |
| 用户显式轻触发（`disable-model-invocation: true`，随手画一张讲解图） | **采纳** | 复用 `arch-scan.run` action 加性扩参，不新增后台 skill 名（见 R3 的门约束） |
| 暗色模式硬要求（CSS 变量 + localStorage + 防 FOUC） | **已有且更优** | 复核发现 vendored 模板已内置同款启动脚本（见 §1 证据 1），缺口收窄为 host 同步不回写 localStorage（R5，一处 patch 内的一行） |
| 报告 / PR 评审 / 事故页等 HTML 交付物外溢 | **不做（留痕）** | scope 变化，openui/a2ui 与 archify 门禁的合流是独立立项，见 §3 |

### 0.3 强化点一览（R1–R6 与分期）

| # | 强化点 | 落点 | 分期 | 改动量级 |
| --- | --- | --- | --- | --- |
| R1 | 叙事层强化：guided views 从"可选加分"升级为"按 perspective 强制覆盖关键叙事路径" | SKILL.md 提示词层 | **P0** | 纯文本 |
| R2 | 成品质感规约：给模型一个"画好了长什么样"的提炼锚，替代它读不到的成品 | SKILL.md 提示词层 | **P0** | 纯文本 |
| R3 | 聚焦单图入口：会话内"画个图解释 X"走单图聚焦路径，跳过全量扫描心智 | arch-scan.ts 加性参数 + 任务提示词段落 | **P1** | 小型加性 |
| R6 | 图板→编辑器跳转：viewer patch 出站节点 focus 消息，宿主经既有通道解析 `sources` 锚 → `onOpenFile`（编辑器换核后的现成通道接线） | archify-cli.ts patch 块 + KnowledgePanel arch pane | **P1** | patch + renderer 接线，零 IPC 变更 |
| R5 | 主题持久化收敛：host postMessage 同步的主题回写 `localStorage('archify-theme')` | archify-cli.ts `themeSyncPatch()` | **P1** | patch 块内约一行 |
| R4 | golden 语料自蒸馏：已交付 showcase 图回流为下一轮的风格锚 | `.deeporca/prototypes/golden/` 目录约定 + SKILL.md/提示词提及 | **P2** | 约定 + 提示词，代码近零 |

### 0.4 明确不做（决策留痕）

1. **不新增后台 skill 名**：`session-manager-tasks.ts` 的 `countArtifacts()` 对非 `arch-scan` skill 直接 `return 1`（no-artifact 语义），任务提示词构建也是 arch-scan 专属分支——聚焦入口必须**复用 `skill: "arch-scan"` + 输入扩参**，不碰这道门。
2. **不把 rendered 孪生 HTML 喂给模型**：自包含成品 HTML 内联了整个 viewer 运行时（数百 KB），read 一次的 token 代价远超收益；锚定走人工提炼的规约文本（R2），成品源码永远只是提炼的**出处**，不是输入。
3. **不搬 effective-html / html-effectiveness 语料**：第三方语料（Thariq Shihipar，仓库自带独立 LICENSE）授权与署名未核，且其范式（自由 HTML）与我们的 IR 管线不同构；其价值已被 R2 的规约化吸收。
4. **不做渲染质量自动评估器**：archify 自带 `bin/visual-check.mjs` 且 deliver 门禁已强制 9 项检查 0 warning；"好看与否"的闭环用 R4 的 golden 对拍人工走查，不新造评估器。
5. **不动 viewer 渲染器与 schema**：R1/R2 全部通过既有 schema 能力（`meta.views`、`cards`、`variant`、`brand`）表达——**强化的是模型对已有 surface 的利用率，不是 surface 本身**。

---

## 1. 现状与证据（本设计的前置复核，含对调研期两处假设的修正）

1. **修正：暗色兜底已存在**。`vendor/archify/assets/template.html:24-31` 的 `<head>` 启动脚本已实现 `?present=1` 处理 + `localStorage.getItem('archify-theme')` + `prefers-color-scheme` 兜底 + apply-before-paint——effective-html 的暗色硬要求我们**原生已达标**。真实缺口只剩：`themeSyncPatch()`（archify-cli.ts:186-202）收到 host `{type:"deeporca-theme"}` 后只设 `data-theme` 属性与按钮态，**不回写 `localStorage('archify-theme')`**——用户在 app 内切到 dark 后，导出/独立打开的 HTML 仍会按陈旧的 localStorage 值（或系统偏好）起底，与宿主最后状态脱节。
2. **修正：成品孪生已存在但不进契约**。`vendor/archify/examples/` 除 IR 外带 5 个 rendered 成品（`web-app-rendered.html`、`dataflow-product-analytics.html`、`workflow-agent-tool-call-rendered.html`、`lifecycle-agent-run.html`、`sequence-cache-miss-request.html`），五类图型全覆盖。但 SKILL.md 第 2 步"Read the contract inputs — **only these**"（skillDoc + 一个 schema + 一个 IR 例子）把模型挡在成品之外——模型的全部视觉想象来自合同文档与 IR 样例，**没有任何"最终渲染效果"的概念**。这是与 effective-html 的核心差距：它的质量天花板由范例语料决定，不由指令措辞决定。
3. **后台任务 skill 门**。`session-manager-tasks.ts:216` `if (skill !== "arch-scan") return 1;`——聚焦入口扩参必须挂在 `arch-scan` 名下（§0.4-1）。
4. **交付门禁天然免疫 golden 语料**。`listArchifyArtifacts()` 只平面扫描 `prototypes/` 下匹配 `arch-*.<type>.json` 的文件；`golden/` 子目录或无 `arch-` 前缀的文件永不被 deliver（deliverAllPending 的 stale 对比也不感知它们）。golden IR 若被污染，最坏后果是"坏的风格锚"，且它自己也要过 validate 才有意义——不构成注入面。
5. **增量交付已就位**。`deliverAllPending()` 按 IR mtime > HTML mtime 判 stale，只重渲染新/变更物——R3 的聚焦单图天然只交付它自己写的 IR，不需要任何门禁侧配合。
6. **UI 出口已存在**。`ActionsPanel.tsx` 已暴露 `arch-scan.run`，i18n 已有 `builtin.arch-scan.desc` / `action.arch-scan.run.desc`——R3 主要是语义扩参而非新出口。
7. **eval 底座已存在**。`templates/plugins/code/evals/cases/arch-scan-positive.yaml` 是 R1/R2 提示词改动的回归锚点。
8. **编辑器侧已换核（2026-09-06 复核）**。`specs/editor-copilot`（结对画布）拍板 CM6 替换 Monaco，且已在本分支落地：`components/editor/` 下 `cm6-kernel/cm6-deco/cm6-lsp/cm6-buffer-stream/PairBar/EditorReviewBar/CheckpointStrip/EditorStatusBar/EditorPalette` 就位，`monaco-loader.ts` / `EditorAgentFloat.tsx` / `EditorDiagnosticsDrawer.tsx` 已删除，语言智能走 `@codemirror/lsp-client` + 主进程 `lsp-bridge`。对本 spec 的影响是**增加**而非修正：① 编辑器形成了索引驱动的 Quick Nav（⌘P/⌘T/⌘⇧O，「打开到行」）；② 右键菜单设计案（`docs/research/2026-09-05-interaction-contextmenu-design.md`）确立了「在编辑器中打开」的全仓交互范式；两者把"架构图 → 代码"的联动从"需要新建通道"降级为"接线既有通道"——催生 R6。反向影响：结对画布高频改码使图的时效性问题显性化（§5 风险表）。

---

## 2. 设计

### R1 叙事层强化 — guided views 用满（P0，纯提示词）

**缺口**：SKILL.md 对 `meta.views` 的全部要求是"2–5 章 + 一行 note"。viewer 的 story/beat/moment/follow-camera 全是现成的，但模型按最低线交卷时，一张图往往只有一条"主路径"章——叙事播放器等于闲置。

**方案**（全部是对 SKILL.md「Showcase surface」段的改写，零 schema 变化）：

1. **按 perspective 定叙事底线**：`architecture` 至少覆盖「主请求路径 / 写路径或数据落地 / 信任边界或故障路径」三条；`dataflow` 覆盖「端到端主链路 / 分叉或汇聚点 / 异常支路」；`sequence` 的 views 与其消息分组的阶段一一对应；`workflow` 覆盖「正常流 / 异常或重试 lane」；`lifecycle` 覆盖「happy path / 失败与恢复」。schema 上限仍是 5 章，底线是 3 章（现文本为 2）。
2. **每章 note 必须指名道姓**：note 里出现真实的组件/边 id 或代码标识（"从 `main/index.ts` 的 app bootstrap 到 `session-bridge` 的 IPC 面"），不许"数据处理流程"这类空话——与既有"every card line must trace to code you read"同一纪律延伸到 views。
3. **章序即叙事序**：`meta.views` 的数组顺序就是 story 播放顺序，按读者理解顺序编排（入口 → 主干 → 分支/边界 → 结论），不按组件字母序随手排。
4. **cards 与 views 收尾呼应**：最后一张 card 的结论应与最后一个 view 的落点一致（图讲完的故事，卡片给出留存结论）。

**触点**：`SKILL.md` 「Showcase surface」guided views bullet 重写 + 「Hard rules」加一条 views 纪律。
**验收**：eval（arch-scan-positive.yaml）断言产出 IR 的 `meta.views.length ≥ 3` 且 note 含至少一个真实标识符；真机走查一次 story 播放，三张图（architecture/dataflow/sequence 各一）叙事连贯。

### R2 成品质感规约 — 视觉锚定（P0，纯提示词）

**缺口**：§1 证据 2——模型读不到任何成品，"showcase"对它只是 9 项检查 0 warning 的抽象数字。effective-html 证明：**视觉质量上限 = 范例锚的密度**，指令措辞只是下限。

**方案**：在 SKILL.md 新增「Delivered look」一节（约 25–35 行），内容是对 vendored 5 个 rendered 孪生 + 我们真机已交付 showcase 图的**人工一次性提炼**（提炼动作是本 spec 实施期的一次性人工/AI 辅助工序，产物只有规约文本，成品源码不进任何 prompt）。规约锚定六个可判读的维度，每条都对应模型在 IR 里**实际可控**的杠杆：

1. **版面骨架**：grid 骨架的呼吸感——主链纵贯、边界横分、hub 居中邻接；首屏 3 秒能读出"哪条是主干"（对应 layout/row/col 杠杆）。
2. **配色语义**：semantic type 调色板的克制感——type 准确度即配色准确度，装饰性用色为零（对应 `type`/`variant: emphasis|security|dashed` 杠杆）。
3. **密度分层**：sublabel/tag 两行深度的信息梯度——一行说角色、tag 给运行时事实，卡片只留结论（对应 sublabel/tag/cards 杠杆）。
4. **走廊纪律**：边走线横平竖直、标签不叠、双向对共享走廊是合法形态（对应既有 via/labelAt 纪律的"为什么"——规约把 repair 日志里的教训前置成审美语言）。
5. **叙事质感**：views 编排的"导览感"——每章镜头落在哪、note 怎么说话（与 R1 呼应）。
6. **品牌点睛**：`brand` 标记只在真实产品名上出现，密度 ≤ 组件数的 1/3，多则廉价（对应 `brands` lookup 纪律）。

规约末尾固定一句定位语：*"这些是已交付成品的共性，不是新增 schema 能力——检查全绿的图可能仍然平庸，平庸的根源几乎总是语义填充不足。"*

**触点**：`SKILL.md` 新增一节；「Authoring loop」第 2 步的 "only these" 白名单**保持不变**（规约在 SKILL.md 正文内，不新增外部输入路径）。
**验收**：规约文本 ≤ 40 行（防 prompt 膨胀）；对照实施前后各真机产 3 张图，人工走查按六维度打盲评；eval 不回归。

### R3 聚焦单图入口（P1，小型加性）

**缺口**：`arch-scan.run` 绑定的是"全仓扫描"心智（subagent + 全量探索 + index.build-all 同款流程）。用户在会话里说"画个图解释 X 模块"时，应该得到一张**聚焦、单图、快**的讲解图，而不是触发一次全量重建。

**方案**（复用一切既有件，唯一新代码是一个可选参数及其注入）：

1. `ArchScanInput` 增加可选 `focus?: string`（自由文本，如"desktop 渲染层的 IPC 面板体系"；与既有 `perspective` 正交——perspective 定图型视角，focus 定范围）。
2. `session-manager-tasks.ts` 的 arch-scan 任务提示词构建处：`focus` 非空时注入一段「Focused mode」指令——*只画 focus 指名的子系统；产出恰好一张图（一个 slug）；探索范围限定在 focus 相关的入口与依赖边界；证据不足就画更小的真图，不外溢*。空缺省时行为与今日完全一致。
3. **零门禁改动**：focused 任务照常写 `arch-<slug>.<type>.json`，`deliverAllPending()` 的增量 stale 判定只渲染新 IR（§1 证据 5）；图落 Knowledge 面板 arch 页，与全量图同一查看面。
4. 用户路径：会话内对话触发（模型调 `arch-scan.run { focus: "..." }`）或 ActionsPanel 手动触发（参数透传为后续 UI 项，非本 spec 必做项——聊天路径是主路径）。
5. i18n：`ctx.emit` 进度文案沿用既有双语模式（"架构图渲染门禁 — N 张已渲染 / render gate — N artifact(s)"），focused 模式起始文案补双语一条，落全 6 locale。
6. **触发面边界（v2 补）**：编辑器模块（`specs/editor-copilot` 结对画布）**不反向依赖本入口**——若未来编辑器要加「本文件架构」类触发（状态栏/命令面板/右键），属 editor-copilot spec 的领地，本 spec 只保证 `focus` 参数语义稳定、可被外部复用，不向编辑器模块伸出任何钩子。

**触点**：`arch-scan.ts`（类型 + 描述）、`session-manager-tasks.ts`（提示词分支）、`en/zh/zh-tw/zh-hk/ja/ko` 各一条 emit 文案。
**验收**：focused 调用真机产**恰好一张**聚焦图（slug 独立、不覆盖全量图）；全量路径回归不变；`background-task.test.ts` 补 focused 提示词分支断言。

### R5 主题持久化收敛（P1，patch 块内一行）

**缺口**：§1 证据 1——host 主题同步不回写 localStorage，导出物独立打开时按陈旧值起底。

**方案**：`themeSyncPatch()` 在 `setAttribute('data-theme', …)` 之后补 `try{localStorage.setItem('archify-theme',d.theme)}catch(_){}`——key 名与模板启动脚本读的 `archify-theme`（template.html:25）严格一致；宿主消息到达晚于首帧，回写只影响下一次独立打开的起底，不影响本次渲染。沿用 strip-and-reinsert 幂等模式，新 patch 随下一次 `refreshViewerPatches()` 扫描收敛到全部已交付图。

**触点**：`archify-cli.ts` `themeSyncPatch()` 字符串。
**验收**：`archify-cli.test.ts` 补断言：patch 后的 HTML 含 `localStorage.setItem('archify-theme'`；对已交付样图跑一次 sweep，确认旧块剥离、新块就位、receipt 重钉。

### R6 图板 → 编辑器跳转联动（P1，v2 新增；patch + renderer 接线，零 IPC 变更）

**缺口**：架构图的每个组件在 `sources[]` 里锚定了它代表的代码，但图板是叙事终点——读者从图上点不开任何代码。编辑器换核后，"从任意面板打开代码"已是全仓现成通道（§1 证据 8）：KnowledgePanel 的 `onOpenFile(path)` 出口（wiki 页与符号图的 `index.openInEditor` 已在用）、IR JSON 的受控读取通道 `knowledgeArchReadJson`（in-pane 动态地图已用）。缺的只是把两者接起来。

**前置事实（一手核实）**：

- archify `sources[]` = **repo-relative POSIX path + 可选 `line`/`endLine`**，仅在 `meta.repository`（https://github.com origin + 40 位 SHA）存在时合法，由门禁对本地 checkout 做验证（`renderers/shared/repository-evidence.mjs`：路径合法性/逃逸校验、git toplevel、origin 比对）——**IR 本身就是"门禁验证过的跳转锚"，无需我们造锚、无需改 schema**。
- `detectArchRepositoryHint`（session-manager-tasks.ts:94）在目标 root 的 git origin 为 github.com 时自动提供 `meta.repository`——真实 github 项目默认带锚。
- 上游边界：repository evidence **仅 `architecture` 类型支持**；其余四类图的组件锚只能落在 sublabel/tag 文本里（不机器可读）。
- 图板嵌入有 panel iframe（`?present=1`）与 sandbox 预览窗（`knowledgeOpenArchHtml`）两种；既有 patch 家族已依赖 iframe 的 `window.parent` 通道——theme sync 是**入站**，本条补**出站**，方向对称。

**方案**（三层，全部落在既有面上）：

1. **viewer patch 出站桥**（`archify-cli.ts` 新 patch 块 `deeporca-node-anchor`，沿用 strip-and-reinsert 幂等模式）：监听 focus 节点变化（与 passport patch 同一数据源：`[data-node-id][data-focus-selected]` / `svg[data-focus-active]`），向 `window.parent.postMessage({type:"deeporca-node-focus", nodeId})` 发送。**只出站 nodeId、不出站路径**——路径解析留在宿主侧，iframe 内不引入新数据面，与 theme sync 的严格 payload 纪律同款（本补丁的接收端是宿主，伪造面与既有入站通道同级）。
2. **宿主解析与打开**（KnowledgePanel arch pane，renderer 侧）：加载图板时经既有 `knowledgeArchReadJson` 读取 IR，建 `nodeId → sources[]` 映射；收到 focus 消息后取第一个 source 的 `path`（+ `line`）调既有 `onOpenFile`——行号作为附加可选参数传给打开流，打开流不支持行号时退化为仅打开文件（不为此改编辑器内部）。payload 校验同 theme sync 纪律：type/形状不符即忽略。**零新 IPC**。
3. **i18n**：v1 目标是零新增文案（跳转动作复用既有 `index.openInEditor` 键；若走查后决定加 hover 提示，落全 6 locale）。

**边界（明示接受，不做补救）**：

- 锚点仅覆盖 **github-origin 工作区的 architecture 图**——上游 sources 语义决定，不为覆盖率扩 schema 或加替代锚（见 §3 不做清单）。
- `line` 锚定的是 pinned SHA 时刻的行，结对画布高频改码后可能漂移——跳转语义定为「打开该文件，行号尽力而为」；不做行号自动重映射（那是 codegraph↔IR 对齐问题，属观察项）。
- sandbox 预览窗的反向通道（独立 BrowserWindow → app renderer 需 main 侧中继）**v1 不做**，只覆盖 panel iframe；预览窗保持纯查看。

**触点**：`archify-cli.ts`（一个 patch 块）、`KnowledgePanel.tsx` arch pane（消息监听 + 打开接线，不改任何 IPC 契约）。
**验收**：真机在带 github origin 的仓库跑 architecture 图 → panel 内点选组件 → 编辑器打开对应文件；无 sources 的图/其他四类图零变化（patch 幂等、消息无锚即静默忽略）；`archify-cli.test.ts` 补 patch 块存在性 + 出站 payload 形状断言； KnowledgePanel 组件测试补「无锚消息不触发 onOpenFile」回归。

### R4 golden 语料自蒸馏（P2，约定 + 提示词）

**缺口**：R2 的规约是静态的一次性提炼；随管线与 vendored 版本演进，"什么是好图"应从**我们自己的交付历史**持续回流。

**方案**（目录约定为主，代码近零）：

1. **约定**：`<targetRoot>/.deeporca/prototypes/golden/<slug>.<type>.json`——人工（或经用户确认）把真机交付过的最佳 showcase IR 逐类型收入 1–2 件。命名**不带 `arch-` 前缀**，`listArchifyArtifacts()` 天然不感知（§1 证据 4），deliver 门禁零接触。
2. **注入**：任务提示词与 SKILL.md 各加一句：*"若 `golden/` 下存在与你所选类型相同的 IR，先读它作为质感与密度的锚；golden 是参照不是模板——拓扑必须来自你实际读到的代码。"*
3. **安全边界**：golden IR 最坏后果是坏的风格锚（它不执行、不渲染、不进交付）；模型写权限虽覆盖 prototypes/，但污染件过不了 validate 就没有参照价值，风险定性为"低 + 自愈"（重新收一件即修复）。skillDoc 同款纪律："Do not modify … other files in prototypes/" 已禁止任务动 golden。
4. **闭环**：实施后每收敛一批新 showcase 图，人工挑优回灌 golden；R2 规约文本随之小步修订。**评估口径**：golden 回灌前后各真机产 3 张图盲评对照（人评，不建自动评估器，§0.4-4）。

**触点**：SKILL.md 一句 + 提示词一句 +（docs 层面）prototypes 目录约定说明。
**验收**：golden 命中时模型确实读取（任务 transcript 可查）；deliverAllPending 对 golden 零感知（test 断言 listing 不含 golden/）。

---

## 3. 不做清单（继承 §0.4，实施期红线）

- 不改 `ARCHIFY_TYPES`、schema、validator、renderer——强化只动"模型怎么用 surface"，不动 surface。
- 不动 receipt/HMAC/写入权限边界——R3 的 focus 参数不扩大任何写授权。
- 不在 vendored 树落任何文件（§硬约束③）。
- 不引入 effective-html 语料与其自由 HTML 范式（§0.4-2/3）。
- **不做「编辑器 → 架构图」反向联动**（符号 → 组件归属高亮、编辑器内嵌图板等）：R6 v1 只做图 → 代码单向；反向需要 codegraph↔IR 的符号对齐，属观察项（编辑器模块自身归 editor-copilot spec）。
- **不为非 github-origin 工作区造替代锚点**（解析 sublabel 文本、自造本地锚字段等）：上游 sources 语义是跳转锚的唯一可信来源，覆盖率缺口明示接受。
- 报告类 HTML 交付物与 openui/a2ui 的合流**不在本 spec**（scope 变化，留作独立立项的观察项）。

## 4. 分期与验收汇总

| 期 | 内容 | 验收口径 |
| --- | --- | --- |
| **P0** | R1 + R2（SKILL.md 两处改写） | eval 通过 + 真机 3 图盲评对照改善 + SKILL.md ≤ 230 行 |
| **P1** | R3（focus 参数）+ R5（主题回写）+ R6（图板→编辑器跳转） | focused 真机恰产 1 图；R6 真机点选组件即打开对应文件（无锚图零变化）；archify-cli.test / background-task.test / KnowledgePanel 组件测试补断言全绿；6 locale 齐 |
| **P2** | R4（golden 回灌首轮） | golden 命中读取可证；deliver 对 golden 零感知断言；回灌前后盲评对照 |

**实施纪律**（继承仓库既有约定）：提示词层改动属行为变更，回归以 eval + 真机对照为准，不满足"恰一张图 / views≥3"等可判读口径即回退；patch 改动走既有 strip-and-reinsert 幂等链，sweep 后全量已交付图收敛。

## 5. 风险与缓解

| 风险 | 定性 | 缓解 |
| --- | --- | --- |
| SKILL.md 持续膨胀（R1/R2 各加一节） | 中 | 硬顶 230 行（现 177）；每次增补同步删并已被吸收的重复表述；规约只写"可判读 + 可杠杆"的条目 |
| 规约提炼失真（人工提炼的 R2 不代表真实观感） | 中 | 提炼工序必须对照 rendered 孪生 + 真机已交付图进行，留对照截图于本 spec 目录；P2 golden 回流持续纠偏 |
| focus 参数被模型滥用为"全量扫描的别名" | 低 | Focused mode 指令硬性约束"恰一张图 + 探索范围限定"；countArtifacts 机制天然 nudges（text-only turn 时按产物计数催写） |
| vendored 升级改 viewer DOM id 打破 patch | 低（既有风险，本 spec 不新增） | R5/R6 依赖的 id（theme-label/btn-theme、data-node-id/data-focus-selected）均为 viewer 稳定面；patch 家族本就 best-effort，失效只是退回 stock 行为 |
| R6 锚点覆盖率有限（仅 github-origin + architecture 类型） | 中 | 明示接受（§2-R6 边界 + §3 不做清单）；覆盖率随上游 sources 语义演进，不为覆盖率扩 schema |
| R6 行号随结对画布高频改码漂移 | 低 | 跳转语义定为「打开该文件 + 尽力行号」；时效靠既有增量重扫收敛（IR 变更触发重渲染的机制已存在），不做行号自动重映射 |
| R6 postMessage 通道伪造（panel iframe 内注入假 focus 消息） | 低 | 宿主按 theme sync 同款严格 payload 校验；消息只携带 nodeId（无路径），路径仅来自宿主自读的门禁验证 IR——伪造消息最多触发一次无效打开 |
| prompt token 成本上升（R1/R2/R4 合计约 +70 行指令） | 低 | 相对 arch-scan 任务的探索读取量（schema + 合同 + 代码）占比很小；规约以密度换轮次——目标是减少 repair 轮数而非增加 |
