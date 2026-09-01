---
type: desktop
title: 知识索引与知识模块（Knowledge / Index & Knowledge）
description: 四知识源（CodeGraph/OpenWiki/AGENTS/架构图）的聚合状态（内容权重守卫）、BuildJobManager 后台构建（3 阶段可观测、首坏阶段即停、arch 后置验证）、构建前置 git 引导（preflight/bootstrap）、知识 tab 四个子页签、符号关系图（R3-6）与架构图两代产物（Mermaid/JSON）及 KnowledgeReadArchmap 安全围栏。
tags: [desktop, knowledge, codegraph, openwiki, archmap, build]
---

# 知识索引与知识模块（Index & Knowledge）

桌面端把四个知识源聚合进一个知识模块（specs/index-knowledge-rework R2/R3 系列）：**CodeGraph**（符号级）、**OpenWiki**（文档级）、**AGENTS.md**（项目说明）、**架构图**（arch-scan 产物）。索引与知识模块自 2026-08 重做：后台构建进程（R2-1）、会话零残留（R2-2）、AGENTS 就地读取、符号子页签、分阶段可观测（R3-5）、符号关系图（R3-6）、工作区维度任务/知识 tab（R3-7/3-8）。**双语翻译 stage（wiki.translate）已于 2026-08-27 全链路移除**（a17fc6fc）：不再有 原文/译文 切换，旧变体文件经 `isWikiVariantFile` 谓词隐藏。

**命名红线**：UI 永远显示「Wiki」，不显示「OpenWiki」。

## 知识源状态聚合

| 源 | 状态判定 | 详情 |
| --- | --- | --- |
| CodeGraph | **真实符号节点数 > 0** + 新鲜度（2026-08-28 审计：裸 `.codegraph/` 目录、缺 db、0 节点索引都曾点亮「已索引」点而符号 tab 空空） | `count`/`unit: "符号"` 显示节点数；0 节点时区分 `空索引`（目录在、db 空）与 `未构建`；`lastSync` 回退到 `codegraph.db` 的 mtime（内存新鲜度戳只存在于活动工作区的 manager，重启即失，否则非活动/刚重启的行永远显示「未同步」） |
| OpenWiki | `openwiki/` **实质页数**（递归，含子目录；**index.md ≤512B 的残缺骨架不计页**——失败 init 的 37B 残留不得读作「1 页 · indexed」，512B 线与 wiki-cli 后置守卫同一阈值） | 单位「页」；`lastSync` 回退到目录内最新 `.md` mtime |
| AGENTS.md | 存在 + 行数 | 就地读取（containment 校验） |
| 架构图 | `.deeporca/prototypes/arch-*`（**内容权重 >512B**，`.md` 还必须含 ```mermaid 围栏，否则不计数） | **两代产物**：`arch-*.md`（当前，Mermaid 文档）+ `arch-*.json`（legacy A2UI surface）。**`arch-*.html` 分层总览板已于 2026-08-28 退役**（一图一形：只保留 Mermaid 文档），不再列出/读取 |

新鲜度：`SessionBridge.getKnowledgeFreshness`（`lastMutation` 对比各源 `syncTime`）→ `stale`/`indexed`；UI 显示相对时间（刚刚/分钟/小时/天）。**时间戳在同步 settle 后打点**（`session.ts`）：codegraph/wiki/crg 的 `syncTime` 在 sync/update **成功完成后**才写入——在触发时就打点会让整个运行期（可能失败）一直显示新鲜（真机反馈根治，见 [workflows/knowledge-build](../workflows/knowledge-build.md)）。

## 知识 tab（每工作区一个）

知识 tab 在**主区自己的 tab** 里打开（每工作区一个，见 [renderer](renderer.md) 的 MainTab 模型），体内四个子页签。2026-08-25 起 Wiki/AGENTS/架构图三个长文档视图共用 **Oink 阅读外壳**（`components/TocNav.tsx`）：居中 860px 内容列 + 「本页目录」（`useHeadingToc` 后渲染提取标题并分配 slug id，scrollspy 跟随最近滚动容器）+ 上一页/下一页**分页器**（与树共享同一顺序，见下）：

- **Wiki**：页面列表（**frontmatter `title` 作树标签**——`wikiPageTitle` 读页头前 4KB 提取 title，避免英文文件名把中文页面显示成混合语言；无 title 回退美化文件名）+ 内联主从预览（`StreamdownView` 渲染，frontmatter title 作标准页头、与正文 H1 相同则去重）。自动选中第一页（优先 `index.md`——「前言/导航」落地页，否则按树阅读序第一页——不是路径序第一项；2026-08-27 修：路径序第一项常是子目录页）；**分页器按目录分组深度优先顺序**遍历全部页面（wiki 树与 pager 同一根同一序，**页面先于子目录**——目录优先曾让 Index/综合说明沉底）。列表过滤 `*.zh.md`/`*.en.md` 变体（core `isWikiVariantFile` 单一事实源，main 经 `@deeporca/core` 导入）——旧双语构建的残留变体永不显示为重复页。
- **AGENTS**：就地内容预览 + 「在编辑器打开」——与 wiki 页同一阅读外壳（TOC + scrollspy）。
- **架构图**：**图即地图**——自动选中**最新**产物全窗渲染（无产物列表、无中间「root」概念，产品决策；当前产物被删/被新扫描替换时自动改选）。`.md` 产物只渲染 ```mermaid fence（`ArchDiagrams`，无图文档回退全文；**HTML 板形式 2026-08-28 退役**——渲染/读取/围栏三面同步移除，见下）；`.json` 产物经真实 A2UI 渲染器重放（与对话 surface 同一渲染路径）。**分页器按 mtime 降序**（与自动选最新的同一顺序）在产物间前后切换，右上角 meta 标注格式（Mermaid / A2UI v0.9 · surfaceId）。
- **索引关系图**（R3-6）：默认**关系图视图**（`SymbolGraphView`），一键切列表；搜索定位中心、点击节点重定中心、**返回栈提升到面板工具栏**（Back/Home 对图与列表视图都生效；输入搜索不压栈，刻意导航才压）。

## Per-Source Implementation

### CodeGraph（`main/tools/codegraph-sdk.ts`）

- **Index/sync**: `SdkCodegraphController`（SDK，`@colbymchenry/codegraph` 依赖）；MCP 工具仍经子进程（npm-shim.js——SDK 的 MCPServer 尚未提供 connect(transport) 供进程内桥接）。**2026-08-28 可靠性批**：`reindex` 改用 `close()` 释放旧句柄 + `CodeGraph.recreate(root)` 重建（`init()` 对已在盘上索引的项目抛 "already initialized"——重启后无内存实例可 uninitialize 的旧错，recreate 是 SDK 文档化的 `codegraph index` 等价路径，O(1) 丢弃 db+WAL sidecar）；`hasProject` 现在是**可用索引**判定（SDK `isInitialized` = 目录 + db 存在，再叠加 `countIndexedSymbols` > 0——hollow/0 符号残留路由到**全量重建**而非 sync-over-nothing）；`reindex` 完成后**后置校验**（`countIndexedSymbols` 只读 SQLite 计数 `kind NOT IN ('import','unknown','file')` 的节点），0 符号抛 "CodeGraph indexed 0 symbols"（空 parse 不再读作绿色阶段）。
- **符号列表**: `KnowledgeListSymbols` 直接只读查询 `.codegraph/codegraph.db`（`node:sqlite`，Node ≥ 22.5 惰性加载，失败回退空结果）。
- **符号关系图**: `KnowledgeSymbolGraph` → `main/symbol-graph-query.ts` 的 `buildSymbolGraph(db, query)`——focus 集（查询命中或入度 hub 前 10）→ 进出边（`calls/references/instantiates/implements`，每向 300 条上限，超出标 `truncated`）→ caller/callee 角色判定。**纯展示层**，agent 侧 CodeGraph MCP 工具完全不动（角色判定按入边 source 判定——原内联实现的 `e.target` 判定 bug 由功能测试捕获）。

### CRG（`main/tools/crg-cli.ts`）

- Build/visualize: `CrgCliController`（vendored CRG 二进制）；查询走 core `CrgGraphQuery`（Node 直读 SQLite；MCP surface 已退役隐藏，commit b137ac17）。
- 索引存储：`.code-review-graph/` 目录存在。

### OpenWiki（`main/tools/wiki-cli.ts`）

- `WikiCliController` spawn **vendored openwiki CLI**（`packages/desktop/vendor/openwiki/dist/cli.js`，自带隔离 node_modules ~187MB，避免 @langchain/* 进入依赖图）。
- LLM 凭据经 env 传入（`OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENWIKI_MODEL_ID`——注意是 **MODEL_ID**，不是 `OPENWIKI_MODEL`：错误的 env 名会让 CLI 停留在内置默认模型，被配置的 OpenAI 兼容端点以 400 拒绝）。**模型池时代凭据取自主端点**（2026-08-28 真机修复）：`resolveCurrentSettings(root)` → `primaryEndpointId`（或 `endpoints[0]`）的 `apiKey`/`baseURL`，模型为 `s.model || primary.models[0].id || "deepseek-v4-flash"`——池化设置文件的顶层 `apiKey`/`baseURL` 是空串，喂给 CLI 会让 OpenAI 客户端回落到 api.openai.com（不可达 → "Request timed out."）；**`OPENWIKI_LANGUAGE` 取应用 UI locale**（`SessionLocaleSet` 同步 → `APP_LOCALE_TO_BCP47` 映射 zh→zh-CN/zh-TW/zh-HK/ja/ko/en，**不是 OS locale**——否则 wiki 页与用户阅读语言混合）。
- **辅助模型重试**（2026-08-28，`getAuxLlmCreds`）：主模型 LLM 流中途死亡（undici "terminated"，网关长流约 5 分钟掉线）自动**重跑一次**（`MAX_ATTEMPTS = 2`）——重试切换设置里的「辅助模型」（`secondaryModel` + `secondaryEndpointId`，未配置或与主端点+模型相同则不可用——切到孪生只是撞同一堵墙）；页面增量写盘，重跑要么补完要么带同样的局部化提示失败，绝不比直接失败更差。
- 写 OpenWiki connector 配置（`~/.openwiki/connectors/`）：让 wiki agent 消费 CodeGraph MCP 与 Serena MCP（非致命，失败继续）。
- `--print` 结构化输出（progress + results，非 TUI）；运行经 **`spawnTracked`**（core `common/spawn-tracked.ts`）——`exit` 权威结算 + 2s stdout 冲刷宽限、60 分钟硬超时（`DEEPORCA_WIKI_TIMEOUT_MS` 可覆盖）、20s 心跳。**进度行双语化**（2026-08-26）：心跳/卡住强制结束/完成标记等中文进度行改为「中文 / English」双语格式。
- **完成信号根治**（真机反馈「wiki 完成但状态永远不变」）：心跳读 **wiki-marker**（`main/tools/wiki-marker.ts` 的 `readWikiCompletionMarker`）——openwiki 以 `openwiki/.last-update.json`（`status: "complete"` + model + gitHead）为最后动作；标记出现后 CLI 退出若卡住（pipe 继承的 MCP connector 子进程占住 stdio）超过 60s，`finishOk()` **强制按成功结算**。心跳文案带**真实产出计数**（`已生成 N 个页面`，按文件系统统计本次运行新写页面），不是纯计时器。
- **实质产出守卫**（2026-08-28 审计，`countSubstantialWikiPages`）：退出码与完成标记都会说谎（真机：exit 0 + status "complete" 覆在一个 37 字节骨架 index.md 上）——**内容权重才是「到底产没产出」的唯一可信信号**。健康页 3-5KB+，frontmatter-only 骨架 <100B，512B 为界（与 core `hasExistingWikiArtifacts`、main 状态页计数同一阈值）；**init 与 update 双模式**都检查：0 个实质页 → 抛错 `[hint:wiki-empty]`；若仓库**尚无任何提交**（`repoHasCommits` 探测），提示改为 `[hint:wiki-git]`——生成器依赖 git 历史，无提交的仓库只会写出骨架，指引用户先 commit 而不是换模型（见下「构建前置 git 引导」）。

### arch-scan（架构图）

- core action `arch-scan.run`（经 `runBackgroundTask` 无会话后台 LLM 循环）产出 **Mermaid 架构图文档**（`.deeporca/prototypes/arch-<name>.md`），经 a2ui MCP `save_archmap`（**仅 markdown——`format`/`html` 参数与 `arch-*.html` 产物 2026-08-28 一并退役**，「一图一形」）落盘；arch-scan 技能提示词同步收紧（`session-manager-tasks.ts`：never A2UI surfaces, never HTML boards）。技能方法论（2026-08-26 对标 showapi 升级为**五阶段管线**，commit f57cb6fb）：**架构风格识别 → 结构化抽取 → 图生成 → 架构师评审 → 文档融合**——评审必须**证据驱动**，产出文档以「架构分析」评审章节 +「优化建议」问题→建议→优先级章节收尾（署名见 NOTICE「Methodology acknowledgements」）；复杂度预算为区间（每图 6-12 节点/6-12 边、flowchart ≥2 个 subgraph、`overall-architecture` 首页取上限 8-12 节点 + 2-4 subgraph）；**语义 kind 固定色相**（entry/frontend/backend/store/bus/cloud/external/concern，每张 flowchart 必须原样携带标准 classDef 图例块——渲染端按 kind 名映射固定色相，禁自创 classDef/禁 fill）。legacy `arch-*.json`（早期 A2UI surface 输出）仍被列出并经 A2UI 渲染路径显示。
- **`KnowledgeReadArchmap` 安全围栏**（2026-08-25 审计 P0 修复，commit e061e062）：该通道曾对渲染层传入 path 直接 `readFileSync`——兄弟通道（editor/wiki）都有包含校验唯独它没有，被攻破的渲染进程可任意读文件（~/.ssh、.env）。现按**多工作区围栏 + 命名 + 词法/realpath 双层包含**三层拒绝：① 目标必须位于某个**已注册工作区**（workspace registry ∪ 当前 projectRoot）的 `.deeporca/prototypes/` 之下（`artPath` 内嵌双重 marker 也因集合精确匹配 + realpath 拒绝）；② basename 必须匹配 `arch-*.{md,json}`（`safe-path.ts` 新增 `safeArchmapPath`；**`.html` 随形式退役从命名白名单移除**，2026-08-28 `safe-path.test.ts` 改为断言 html 拒绝）；③ `safePathWithinRoot` 词法 + realpath 防 `../`、绝对路径、symlink 逃逸。非法路径返回 `{ ok: false, error }` 而非抛错。`safe-path.test.ts` 锁定守卫（合法 md/json、任意密钥读取拒绝、伪装修 archmap 名穿越拒绝、他树绝对路径拒绝、html 拒绝）。

## BuildJobManager（`main/build-job-manager.ts`）

- **R2-1 后台构建**：作业持有在 **main 进程**（renderer 行状态是只读订阅；切行/tab 不丢构建；每工作区一作业幂等，不同 root 并行）。
- **R3-5 分阶段可观测**：每条进度折叠进 `stages[]` 状态机（**3 阶段：codegraph → wiki → arch-scan，每次构建都跑**——update 跳过 arch 曾被真机反馈为「架构图没有执行」；`wiki-translate` 已随 a17fc6fc 删除，无 `[n/4]` 前缀）+ **500 行 console 环缓冲**（`logs`）+ `updatedAt`（elapsed/活性展示）。**首帧即广播**（`start()` 立即 `broadcast(job)`，codegraph 预热可能数秒无进度线）；**首阶段初始 `running`**（首帧即显示「正在生成/更新索引」而非泛化「构建中…」）。wiki 阶段自身无进度流（openwiki --print 缓冲全部输出到退出），阶段视图显示状态+耗时而非冻结 percent——「卡在 36%」曾是 10 分钟 wiki 运行的观感问题。
- **阶段失败显性化**：`index.build-all` 把阶段错误收进 `stages[]` 报告**正常返回**；manager 逐阶段核对并标 `failed`/`skipped`，整体 `stage: "failed"` + 错误摘要——否则失败构建会显示「完成」而状态永远「未同步」。任一阶段仍 `running` 而 action 抛错时统一补标 failed。
- **首坏阶段即停**（2026-08-28，spec design B1）：`codegraph` **真实失败**（非 skipped）→ wiki 与 arch-scan 标 `skipped`（错误注明 "earlier stage failed"）——arch-scan 消费 wiki+codegraph 证据，在残缺证据上跑会白烧 LLM token；wiki 失败同理停 arch-scan。**仅「控制器未注入」的 skipped 不阻断**（无控制器是环境缺失而非失败）。
- **arch-scan 后置验证**（2026-08-28）：后台任务 resolve 本身证明不了什么——模型可能全程没调 `save_archmap`。结束后复查 `hasExistingArchmaps`（实质地图：>512B，`.md` 含 mermaid fence；增量 no-change 运行中先前产物即满足），否则该阶段标失败（"without any substantive architecture maps — try another model"）。`runBackgroundLlmTask` 同时新增**预算耗尽显式失败**（`finalContent === null` 即 80 轮上限内没产出最终答复——通常是工具错误循环 → 抛错，不再读作成功）。
- `KnowledgeBuild` (init/update/auto) → `buildJobs.start(root, mode)` → ActionRegistry 组合（[workflows/knowledge-build](../workflows/knowledge-build.md)）。`auto` = 双索引存在 → update，否则 init；**action 内部按产物自动判别**（`hasExistingWikiArtifacts`/`hasExistingArchmaps` 用**内容权重**判真产物——已存在 wiki/arch 产物 → 增量 update/refresh-in-place，无论按哪个按钮；残缺 init 留下的骨架/空文件不算已初始化，下次构建重生成，83cc41a5 起）。
- 取消传播：`ctx.signal` 接入后台 LLM 循环（下一迭代边界中止，已产出 surface 仍落盘）。

## 构建前置 git 引导（2026-08-28）

vendored wiki 生成器把**提交历史**当核心输入（update pass 对比 `gitHead..HEAD`）。无 HEAD（零提交）的仓库里 agent 没有锚点，实践中只写出骨架却报告成功（真机 2026-08-28：37 字节 index.md，exit 0）。因此构建前先探测、询问，绝不静默「成功」：

- **`knowledgeGitPreflight(root)`**（`main/git-preflight.ts` 的 `gitPreflight`，IPC `KnowledgeGitPreflight`）：`git rev-parse --is-inside-work-tree` + `--verify HEAD` → `{ isRepo, hasCommits }`。`IndexLibraryPanel` 在**每次构建前**调用：正常仓库直接 `startBuild`；非仓库/零提交 → 弹**居中模态询问**（i18n `index.gitNoRepoTitle/Body`、`index.gitNoCommitsTitle/Body`），「提交并构建」/取消。preflight 自身失败（git 缺失/IPC 断）**绝不阻断构建**——wiki 阶段的零实质页守卫仍会以可操作的 hint 兜底。
- **`knowledgeGitBootstrap(root)`**（`gitBootstrap`，IPC `KnowledgeGitBootstrap`，仅显式确认后执行）：无仓库先 `git init` → `git add -A` → 首次提交（`"Initial commit (DeepOrca knowledge build)"`）。提交身份**只作用到本次调用**（`-c user.name=DeepOrca -c user.email=deeporca@local` 重试，永不写用户全局 config）；「nothing to commit」（空工作区）返回明确错误而非假成功。两通道都经 `resolveRegisteredRoot` pin 到注册工作区。
- **失败提示分类**（`renderer/lib/build-error.ts` 的 `BuildHintKind`）：wiki-cli 抛出的 `[hint:wiki-empty]`/`[hint:wiki-git]` 分别翻译为「模型不兼容工具协议，换模型重试」/「仓库还没有提交，先提交再构建」（i18n `buildHint.wikiEmpty`/`buildHint.wikiGit`，`build-error.test.ts` 锁定解析）。

## Focused Tests

- `app-boot.test.ts`（knowledge IPC 装配，含 git preflight/bootstrap handlers）、`build-job-manager.test.ts`（阶段/日志/失败语义）、`git-preflight.test.ts`（gitPreflight 探测矩阵/gitBootstrap 身份回退/nothing-to-commit）。
- `knowledge-build-progress.test.ts`（renderer 阶段清单 UI）、`streamdown-view.test.ts`（wiki 预览安全边界）、`build-error.test.ts`（wiki-empty/wiki-git hint 解析）。
- **`safe-path.test.ts`**（`safeArchmapPath` 守卫：合法 md/json、`.html` 拒绝（2026-08-28 退役）、任意密钥读取拒绝、伪装修 archmap 名穿越拒绝、他树绝对路径拒绝）、**`wiki-marker.test.ts`**（完成标记 mtime/半写容错）、**core `spawn-tracked.test.ts`**（管道持有/超时/forcedOk 语义）。
- Core 侧：`background-task.test.ts`（零会话残留 + 预算耗尽显式失败）、`codegraph.test.ts`、`routing-gating.test.ts`、`phase-actions.test.ts`（arch-scan 通道偏好 + **链停回归**（codegraph 失败 → wiki/arch skipped 且 wiki controller 从未被调）+ **arch 后置验证**（hollow run 失败/实质地图通过，incremental no-change 由先前产物满足））。

## Related Pages

- [main-process](main-process.md)（registerKnowledgeIpc/registerCodegraphIpc/registerCrgIpc/registerWikiIpc，KnowledgeReadArchmap 多工作区围栏）
- [renderer-components](renderer-components.md)（KnowledgePanel/SymbolGraphView/KnowledgeBuildProgress/TocNav）
- [core/actions](../core/actions.md)（wiki/codegraph/crg/index-build/arch-scan action 族）、[core/mcp](../core/mcp.md)（save_archmap/a2ui seam）
- [workflows/knowledge-build](../workflows/knowledge-build.md)（一键构建端到端）
