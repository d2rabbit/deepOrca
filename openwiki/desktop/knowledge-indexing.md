---
type: desktop
title: 知识索引与知识模块（Knowledge / Index & Knowledge）
description: 四知识源（CodeGraph/OpenWiki/AGENTS/架构图）的聚合状态、BuildJobManager 后台构建（R3-5 分阶段可观测）、知识 tab 四个子页签（Oink 阅读外壳 + TOC + 分页器）、符号关系图（R3-6）与架构图三种产物格式（Mermaid/JSON/HTML board）及 KnowledgeReadArchmap 安全围栏。
tags: [desktop, knowledge, codegraph, openwiki, archmap, build]
---

# 知识索引与知识模块（Index & Knowledge）

桌面端把四个知识源聚合进一个知识模块（specs/index-knowledge-rework R2/R3 系列）：**CodeGraph**（符号级）、**OpenWiki**（文档级）、**AGENTS.md**（项目说明）、**架构图**（arch-scan 产物）。索引与知识模块自 2026-08 重做：后台构建进程（R2-1）、会话零残留（R2-2）、AGENTS 就地读取、符号子页签、分阶段可观测（R3-5）、符号关系图（R3-6）、工作区维度任务/知识 tab（R3-7/3-8）。

**命名红线**：UI 永远显示「Wiki」，不显示「OpenWiki」。

## 知识源状态聚合

| 源 | 状态判定 | 详情 |
| --- | --- | --- |
| CodeGraph | `.codegraph/` 存在 + 新鲜度 | 符号计数等；`lastSync` 回退到 `codegraph.db` 的 mtime（内存新鲜度戳只存在于活动工作区的 manager，重启即失，否则非活动/刚重启的行永远显示「未同步」） |
| OpenWiki | `openwiki/` 页数（递归，含子目录） | 单位「页」；`lastSync` 回退到目录内最新 `.md` mtime |
| AGENTS.md | 存在 + 行数 | 就地读取（containment 校验） |
| 架构图 | `.deeporca/prototypes/arch-*` | **三代产物**：`arch-*.md`（当前，Mermaid 文档）+ `arch-*.html`（分层总览板，2026-08 起）+ `arch-*.json`（legacy A2UI surface） |

新鲜度：`SessionBridge.getKnowledgeFreshness`（`lastMutation` 对比各源 `syncTime`）→ `stale`/`indexed`；UI 显示相对时间（刚刚/分钟/小时/天）。**时间戳在同步 settle 后打点**（`session.ts`）：codegraph/wiki/crg 的 `syncTime` 在 sync/update **成功完成后**才写入——在触发时就打点会让整个运行期（可能失败）一直显示新鲜（真机反馈根治，见 [workflows/knowledge-build](../workflows/knowledge-build.md)）。

## 知识 tab（每工作区一个）

知识 tab 在**主区自己的 tab** 里打开（每工作区一个，见 [renderer](renderer.md) 的 MainTab 模型），体内四个子页签。2026-08-25 起 Wiki/AGENTS/架构图三个长文档视图共用 **Oink 阅读外壳**（`components/TocNav.tsx`）：居中 860px 内容列 + 「本页目录」（`useHeadingToc` 后渲染提取标题并分配 slug id，scrollspy 跟随最近滚动容器）+ 上一页/下一页**分页器**（与树共享同一顺序，见下）：

- **Wiki**：页面列表（**frontmatter `title` 作树标签**——`wikiPageTitle` 读页头前 4KB 提取 title，避免英文文件名把中文页面显示成混合语言；无 title 回退美化文件名）+ 内联主从预览（`StreamdownView` 渲染，frontmatter title 作标准页头、与正文 H1 相同则去重）。自动选中第一页；**分页器按目录分组深度优先顺序**遍历全部页面（wiki 树与 pager 同一根同一序）。
- **AGENTS**：就地内容预览 + 「在编辑器打开」——与 wiki 页同一阅读外壳（TOC + scrollspy）。
- **架构图**：**图即地图**——自动选中**最新**产物全窗渲染（无产物列表、无中间「root」概念，产品决策；当前产物被删/被新扫描替换时自动改选）。`.md` 产物只渲染 ```mermaid fence（`ArchDiagrams`，无图文档回退全文）；`.html` 产物（分层总览板）在**全沙箱 iframe** 渲染（`sandbox=""` + `srcDoc`，无脚本/无同源/无导航——板是纯 CSS）；`.json` 产物经真实 A2UI 渲染器重放（与对话 surface 同一渲染路径）。**分页器按 mtime 降序**（与自动选最新的同一顺序）在产物间前后切换，右上角 meta 标注格式（Mermaid / HTML Board / A2UI v0.9 · surfaceId）。
- **索引关系图**（R3-6）：默认**关系图视图**（`SymbolGraphView`），一键切列表；搜索定位中心、点击节点重定中心、**返回栈提升到面板工具栏**（Back/Home 对图与列表视图都生效；输入搜索不压栈，刻意导航才压）。

## Per-Source Implementation

### CodeGraph（`main/tools/codegraph-sdk.ts`）

- **Index/sync**: `SdkCodegraphController`（SDK，`@colbymchenry/codegraph` 依赖）；MCP 工具仍经子进程（npm-shim.js——SDK 的 MCPServer 尚未提供 connect(transport) 供进程内桥接）。
- **符号列表**: `KnowledgeListSymbols` 直接只读查询 `.codegraph/codegraph.db`（`node:sqlite`，Node ≥ 22.5 惰性加载，失败回退空结果）。
- **符号关系图**: `KnowledgeSymbolGraph` → `main/symbol-graph-query.ts` 的 `buildSymbolGraph(db, query)`——focus 集（查询命中或入度 hub 前 10）→ 进出边（`calls/references/instantiates/implements`，每向 300 条上限，超出标 `truncated`）→ caller/callee 角色判定。**纯展示层**，agent 侧 CodeGraph MCP 工具完全不动（角色判定按入边 source 判定——原内联实现的 `e.target` 判定 bug 由功能测试捕获）。

### CRG（`main/tools/crg-cli.ts`）

- Build/visualize: `CrgCliController`（vendored CRG 二进制）；查询走 core `CrgGraphQuery`（Node 直读 SQLite；MCP surface 已退役隐藏，commit b137ac17）。
- 索引存储：`.code-review-graph/` 目录存在。

### OpenWiki（`main/tools/wiki-cli.ts`）

- `WikiCliController` spawn **vendored openwiki CLI**（`packages/desktop/vendor/openwiki/dist/cli.js`，自带隔离 node_modules ~187MB，避免 @langchain/* 进入依赖图）。
- LLM 凭据经 env 传入（`OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENWIKI_MODEL`）；**`OPENWIKI_LANGUAGE` 取应用 UI locale**（`SessionLocaleSet` 同步 → `APP_LOCALE_TO_BCP47` 映射 zh→zh-CN/zh-TW/zh-HK/ja/ko/en，**不是 OS locale**——否则 wiki 页与用户阅读语言混合）。
- 写 OpenWiki connector 配置（`~/.openwiki/connectors/`）：让 wiki agent 消费 CodeGraph MCP 与 Serena MCP（非致命，失败继续）。
- `--print` 结构化输出（progress + results，非 TUI）；运行经 **`spawnTracked`**（core `common/spawn-tracked.ts`）——`exit` 权威结算 + 2s stdout 冲刷宽限、60 分钟硬超时（`DEEPORCA_WIKI_TIMEOUT_MS` 可覆盖）、20s 心跳。
- **完成信号根治**（真机反馈「wiki 完成但状态永远不变」）：心跳读 **wiki-marker**（`main/tools/wiki-marker.ts` 的 `readWikiCompletionMarker`）——openwiki 以 `openwiki/.last-update.json`（`status: "complete"` + model + gitHead）为最后动作；标记出现后 CLI 退出若卡住（pipe 继承的 MCP connector 子进程占住 stdio）超过 60s，`finishOk()` **强制按成功结算**。心跳文案带**真实产出计数**（`已生成 N 个页面`，按文件系统统计本次运行新写页面），不是纯计时器。

### arch-scan（架构图）

- core action `arch-scan.run`（经 `runBackgroundTask` 无会话后台 LLM 循环）产出 **Mermaid 架构图文档**（`.deeporca/prototypes/arch-<name>.md`）与 **HTML 分层总览板**（`arch-<name>.html`，arch-scan SKILL Step 3.5：横向能力层色带、纯 CSS 零 JS、`prefers-color-scheme` 亮暗自适应），均经 a2ui MCP `save_archmap`（`format: "md" | "html"`）落盘。技能方法论：oh-my-mermaid + diagram-design 编辑纪律；**复杂度预算为区间**（每图 6-12 节点/6-12 边、flowchart ≥2 个 subgraph、`overall-architecture` 首页取上限 8-12 节点 + 2-4 subgraph）；**语义 kind 固定色相**（entry/frontend/backend/store/bus/cloud/external/concern，每张 flowchart 必须原样携带标准 classDef 图例块——渲染端按 kind 名映射固定色相，禁自创 classDef/禁 fill）。legacy `arch-*.json`（早期 A2UI surface 输出）仍被列出并经 A2UI 渲染路径显示。
- **`KnowledgeReadArchmap` 安全围栏**（2026-08-25 审计 P0 修复，commit e061e062）：该通道曾对渲染层传入 path 直接 `readFileSync`——兄弟通道（editor/wiki）都有包含校验唯独它没有，被攻破的渲染进程可任意读文件（~/.ssh、.env）。现按**多工作区围栏 + 命名 + 词法/realpath 双层包含**三层拒绝：① 目标必须位于某个**已注册工作区**（workspace registry ∪ 当前 projectRoot）的 `.deeporca/prototypes/` 之下（`artPath` 内嵌双重 marker 也因集合精确匹配 + realpath 拒绝）；② basename 必须匹配 `arch-*.{md,json,html}`（`safe-path.ts` 新增 `safeArchmapPath`）；③ `safePathWithinRoot` 词法 + realpath 防 `../`、绝对路径、symlink 逃逸。非法路径返回 `{ ok: false, error }` 而非抛错。`safe-path.test.ts` 锁定 5 条守卫（合法 md/html/json、任意密钥读取拒绝、伪装修 archmap 名穿越拒绝、他树绝对路径拒绝）。

## BuildJobManager（`main/build-job-manager.ts`）

- **R2-1 后台构建**：作业持有在 **main 进程**（renderer 行状态是只读订阅；切行/tab 不丢构建；每工作区一作业幂等，不同 root 并行）。
- **R3-5 分阶段可观测**：每条进度折叠进 `stages[]` 状态机（codegraph → wiki → [arch-scan init only]）+ **500 行 console 环缓冲**（`logs`）+ `updatedAt`（elapsed/活性展示）。**首帧即广播**（`start()` 立即 `broadcast(job)`，codegraph 预热可能数秒无进度线）；**首阶段初始 `running`**（首帧即显示「正在生成/更新索引」而非泛化「构建中…」）。wiki 阶段自身无进度流（openwiki --print 缓冲全部输出到退出），阶段视图显示状态+耗时而非冻结 percent——「卡在 36%」曾是 10 分钟 wiki 运行的观感问题。
- **阶段失败显性化**：`index.build-all` 把阶段错误收进 `stages[]` 报告**正常返回**；manager 逐阶段核对并标 `failed`/`skipped`，整体 `stage: "failed"` + 错误摘要——否则失败构建会显示「完成」而状态永远「未同步」。
- `KnowledgeBuild` (init/update/auto) → `buildJobs.start(root, mode)` → ActionRegistry 组合（[workflows/knowledge-build](../workflows/knowledge-build.md)）。`auto` = 双索引存在 → update，否则 init。
- 取消传播：`ctx.signal` 接入后台 LLM 循环（下一迭代边界中止，已产出 surface 仍落盘）。

## Focused Tests

- `app-boot.test.ts`（knowledge IPC 装配）、`build-job-manager.test.ts`（阶段/日志/失败语义）。
- `knowledge-build-progress.test.ts`（renderer 阶段清单 UI）、`streamdown-view.test.ts`（wiki 预览安全边界）。
- **`safe-path.test.ts`**（`safeArchmapPath` 五守卫：合法 md/html/json、任意密钥读取拒绝、伪装修 archmap 名穿越拒绝、他树绝对路径拒绝）、**`wiki-marker.test.ts`**（完成标记 mtime/半写容错）、**core `spawn-tracked.test.ts`**（管道持有/超时/forcedOk 语义）。
- Core 侧：`background-task.test.ts`（零会话残留）、`codegraph.test.ts`、`routing-gating.test.ts`、`phase-actions.test.ts`（arch-scan 通道偏好）。

## Related Pages

- [main-process](main-process.md)（registerKnowledgeIpc/registerCodegraphIpc/registerCrgIpc/registerWikiIpc，KnowledgeReadArchmap 多工作区围栏）
- [renderer-components](renderer-components.md)（KnowledgePanel/SymbolGraphView/KnowledgeBuildProgress/TocNav）
- [core/actions](../core/actions.md)（wiki/codegraph/crg/index-build/arch-scan action 族）、[core/mcp](../core/mcp.md)（save_archmap/a2ui seam）
- [workflows/knowledge-build](../workflows/knowledge-build.md)（一键构建端到端）
