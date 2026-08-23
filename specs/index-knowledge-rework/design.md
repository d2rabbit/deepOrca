# 索引与知识模块重构 — 梳理与目标态（index-knowledge-rework）

> **日期**：2026-08-23 立稿（梳理先行，未实施——按用户要求先梳理清楚再修）
> **触发**：用户六项反馈（一键串行构建 / openwiki ENOENT / memory+routing 放错位置 / wiki+AGENTS.md 可点开 / 架构图生成走对话行为 / 模块应以工作区为中心而非以源为中心）。
> **定位**：本 spec 只覆盖「索引与知识」（现 IndexLibraryPanel / rail「索引库」）。**记忆（memory L0-L3）与语义路由（routing）不属于本模块**——移出后在别处安家（见 §三）。

---

## 一、现状盘点（代码证据）

### 1.1 面板现状（`IndexLibraryPanel.tsx`，363 行）

- 顶部：当前工作区路径 + **一个**「构建全部」按钮（`index.build-all`，init/update 自适应）
- 主体：**六张并列的"知识源"卡片**，按 `SOURCE_ORDER = [codegraph, openwiki, memory, serena, agents, routing]`，每卡独立状态/计数/新鲜度/单独操作按钮
- memory 卡内嵌 L0-L3 分解 + 语义搜索框；routing 卡是 R4 观测卡

### 1.2 编排现状（`core/src/actions/index-build.ts`）

`index.build-all` 三段串行（对/2 的部分是对的）：
1. CodeGraph 符号索引（SDK，桌面注入）
2. OpenWiki 文档索引（CLI）
3. **arch-scan（仅 init）经 `ctx.runSubagent({skill:"arch-scan"})`** ——子代理会**产生会话消息**（对话行为泄漏进主会话）

### 1.3 openwiki ENOENT 根因（已实证）

- vendored `openwiki@0.3.3` 的 `dist/agent/skills.js` 计算 `bundledSkillsDir = resolve(dist/agent, "../../skills")` → **`vendor/openwiki/skills`**
- `scripts/vendor-openwiki.js:141-145` 只拷 `["dist", "package.json"]` 两个字段；而 npm 包的 `files` 声明里 **`skills/` 在包根**——vendor 脚本漏拷了 `skills`
- 运行时 `readdir(vendor/openwiki/skills)` → ENOENT，`--init` 必炸
- **修复**：vendor 脚本拷贝列表加 `"skills"`（目录存在性守卫）+ 重新 vendoring；旧 vendor 树用 `--force` 重建

### 1.4 其余问题定位

| # | 问题 | 位置 |
|---|---|---|
| P1 | wiki 更新单卡按钮存在但一键按钮未被理解为"串行构建索引+wiki+结构图"的唯一点击 | 面板 + build-all 描述 |
| P2 | openwiki ENOENT | §1.3 |
| P3 | memory / routing 出现在本模块 | `SOURCE_ORDER` + `KnowledgeStatusResponse` 六源 |
| P4 | wiki 页面与 AGENTS.md 无入口直接打开 | 面板无 open-file 通路 |
| P5 | 架构图经 arch-scan 子代理 → **在主会话产生对话消息**；且生成有问题 | `index-build.ts` stage 3 + runSubagent 的消息面 |
| P6 | 模块以"六个源"为中心，不以工作区为中心 | 面板结构 |

---

## 二、目标态：「索引与知识」应该有哪些东西

**一句话**：左侧 = 工作区列表 + 构建按钮；右侧 = **内容区顶部 tab 系统**——主 tab 永远是会话任务工作区，点击左侧工作区按需生成「索引与知识」tab（与任务历史 tab 同一并列机制），其内部三个子 tab：**Wiki / AGENTS / 架构图**。构建一键串行、后台执行、产出物在子 tab 内点开。

**产品命名红线**：对外一律说 **Wiki**（"项目 Wiki"/"Wiki 页面"）——**"OpenWiki" 是内部引擎名，禁止出现在任何 UI 文案**（i18n 键值、按钮、状态、进度消息同此）。同理 CodeGraph 符号索引对外只说「符号索引」。

### 2.1 结构（左列表 + 右侧内容区 tab）

**左侧面板（rail「索引与知识」视图）**——只有两样东西：

```
┌─ 左侧（索引与知识）──────────┐
│ 工作区列表（只列工作区）：     │
│   ● deepcode-cli        2h │
│   ● other-project       3d │
│                              │
│ [ 构建索引与知识 ]            │
│   （作用于选中工作区，         │
│     串行 符号→Wiki→图）       │
└──────────────────────────────┘
```

**右侧内容区**——顶部 tab 栏（复用现有任务历史的 tab 并列机制 `ui-tasktab`）：

```
┌─ 内容区 ────────────────────────────────────────────┐
│ [💬 deepcode-cli 会话] [🗂 任务历史] [📚 索引与知识] × │  ← 顶部 tab 栏
│─────────────────────────────────────────────────────│
│ （主 tab 永远 = 会话任务工作区，不可关闭；             │
│   索引与知识 tab 点击左侧工作区时按需生成，可关闭；     │
│   与任务历史 tab 同级并列）                           │
│                                                     │
│ ┌ 索引与知识 tab 内部：三个子 tab ──────────────────┐ │
│ │ [ Wiki ] [ AGENTS ] [ 架构图 ]                    │ │
│ │──────────────────────────────────────────────────││
│ │ Wiki 子 tab：页面列表（标题/新鲜度），点击→编辑器  ││
│ │ AGENTS 子 tab：AGENTS.md 预览/编辑                ││
│ │ 架构图 子 tab：图列表，点击→内嵌预览              ││
│ │ （符号索引是内部资产，不设子 tab——状态汇总显示在   ││
│ │  左侧工作区条目/构建按钮旁）                       ││
│ └──────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

- 左侧**只展示工作区**（不展示 codegraph/openwiki/agents.md 等源概念）；每个工作区条目带汇总状态（索引是否就绪/上次构建时间）。
- **tab 生命周期**：主 tab（会话）常驻；索引与知识 tab 每工作区至多一个，点击左侧条目打开/聚焦，× 关闭；切换工作区时 tab 内容跟随或复用同工作区的既有 tab。
- 构建按钮作用于**当前选中的工作区**（左侧高亮项），进行中显示分段进度，完成后刷新对应 tab 内容。

### 2.2 模块边界（明确进出）

| 属于本模块 | 不属于（移出） |
|---|---|
| 符号索引（内部引擎 CodeGraph；资产，供 agent 消费；UI 只称「符号索引」） | **memory L0-L3**（→ 记忆域：桌面记忆面板/设置；其状态卡从本模块删除） |
| 项目 Wiki（内部引擎 OpenWiki；索引 + 页面浏览/打开；UI 只称「Wiki」） | **语义路由 routing**（→ 属于"系统运行观测"，挪到设置-诊断或状态页；R4 观测卡随之迁移） |
| 架构图（arch-scan 产物 + 预览） | serena 项目记忆（.serena/memories 是 agent 自用记忆，非人读资产——卡片移出到插件中心 serena 组详情，或并入记忆域；不在本面板） |
| AGENTS.md（存在性 + 打开） | |
| 一键串行构建（符号→Wiki→图） | |

### 2.3 行为规约

- **B1 一键串行**：「构建索引与知识」= `index.build-all` 单入口，作用于左侧选中工作区，严格串行 符号索引 → Wiki → 架构图（现状编排顺序正确，保留）；按钮态：进行中显示分段进度 `[2/3] Wiki…`（**进度文案禁用引擎名**，见命名红线），任一段失败即停并显示错误（后续段跳过，标 skipped）。
- **B2 后台执行，零对话行为**：构建是**后台任务**（action 通道 + 进度事件），**不产生任何主会话消息**。arch-scan 段改为**静默子代理**（`runSubagent` 需新增 `silent: true` 语义：结果只回传 action 输出，不注入会话消息流）或改为直接调用 arch-scan 的产物生成器（不经会话）。架构图生成失败只在模块 UI 报错。
- **B3 产出物在子 tab 内点开**：
  - Wiki 子 tab：页面列表（标题/新鲜度），点击 → 复用现有编辑器打开（`onOpenFile` 通路）；
  - AGENTS 子 tab：AGENTS.md 直接展示（预览/编辑入口）；
  - 架构图子 tab：图列表，点击 → 子 tab 内预览区（或复用右侧 dock 单槽——实施时按 dock 互斥规则定，倾向子 tab 内嵌预览，避免与 CRG 图抢槽）；
  - 符号索引：不设子 tab（内部资产），状态/重建入口放左侧工作区条目。
- **B4 左列表 + 右 tab**：左侧只列工作区（含汇总状态）；点击 → 内容区顶部 tab 系统按需生成「索引与知识」tab（与任务历史 tab 同级并列，复用 `ui-tasktab` 机制）；主 tab（会话任务）永远常驻不可关闭。
- **B5 状态来源**：`KnowledgeStatusResponse` 收敛为 4 键：`codegraph / openwiki / agents / archmaps`（archmaps 新增：扫描工作区架构图产物目录）；`memory` 移至记忆域自己的状态接口；`routing` 移至诊断；`serena` 移除（见 2.2）。**键名是内部 API 命名，UI 文案层再映射为中性词（openwiki→"Wiki"，codegraph→"符号索引"）。**

### 2.4 修复清单（对应用户六点）

| 用户点 | 修复 |
|---|---|
| 1 一键串行 | B1（入口已存在，强化为唯一入口 + 单源按钮降级为二级） |
| 2 openwiki ENOENT | vendor-openwiki.js 拷 `skills/` + `--force` 重建 vendor 树；构建失败信息在面板显示（不再静默） |
| 3 memory/routing 放错 | §2.2 边界：状态接口拆分 + 面板卡片移除 |
| 4 wiki/AGENTS.md 可点开 | B3（编辑器打开通路） |
| 5 架构图对话行为 | B2（silent subagent 或直调产物生成）+ 架构图生成问题单独排查（生成有问题=arch-scan 消费索引失败？列为实施时首个排查项） |
| 6 以工作区为中心 | B4 + B5（面板重构为 工作区卡片 + 产出物列表） |

### 2.5 实施顺序建议

1. **修 ENOENT**（vendor 脚本一行 + 重建）——独立且立刻恢复 wiki 构建
2. **arch-scan 静默化**（silent subagent 语义）——消除对话行为泄漏
3. **面板重构**（工作区卡片 + 4 产出物 + 点开通路 + 移除 memory/routing/serena 卡）
4. **状态接口拆分**（ipc `KnowledgeStatusResponse` 收敛 + memory/routing 新家）
5. 架构图生成质量排查（依赖 1/2 完成后实测）

## 三、memory 与 routing 的新家（移出方案）

- **memory L0-L3**：其状态/启用/统计已在桌面记忆相关面板与设置中有落点；本模块只删卡。若记忆域还没有状态卡安放点，收进「设置 → 记忆」或顶部 Token 面板的记忆分区（实施时定，不在本 spec 扩面）。
- **routing（语义路由观测）**：R4 观测性质 → 「设置 → 诊断」或命令面板 `routing.status` 查询；不再常驻任何侧栏面板。

## 四、Non-goals

- 不改 codegraph/openwiki/arch-scan 的引擎与索引格式
- 不做多工作区并列管理（跟随顶栏工作区切换）
- 不在本 spec 内做记忆域/诊断域的新 UI（只移出，不新造）
