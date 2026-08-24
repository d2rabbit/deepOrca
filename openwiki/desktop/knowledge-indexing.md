---
type: desktop
title: 知识索引与知识模块（Knowledge / Index & Knowledge）
description: 四知识源（CodeGraph/OpenWiki/AGENTS/架构图）的聚合状态、BuildJobManager 后台构建（R3-5 分阶段可观测）、知识 tab 四个子页签、符号关系图（R3-6）与架构图 Mermaid 化产物格式。
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
| 架构图 | `.deeporca/prototypes/arch-*` | **两代产物**：`arch-*.md`（当前，Mermaid 文档）+ `arch-*.json`（legacy A2UI surface） |

新鲜度：`SessionBridge.getKnowledgeFreshness`（`lastMutation` 对比各源 `syncTime`）→ `stale`/`indexed`；UI 显示相对时间（刚刚/分钟/小时/天）。

## 知识 tab（每工作区一个）

知识 tab 在**主区自己的 tab** 里打开（每工作区一个，见 [renderer](renderer.md) 的 MainTab 模型），体内四个子页签：

- **Wiki**：页面列表（**frontmatter `title` 作树标签**——`wikiPageTitle` 读页头前 4KB 提取 title，避免英文文件名把中文页面显示成混合语言；无 title 回退美化文件名）+ 内联主从预览（`StreamdownView` 渲染，frontmatter title 作标准页头、与正文 H1 相同则去重）。
- **AGENTS**：就地内容预览 + 「在编辑器打开」。
- **架构图**：`.md` 产物只渲染 ```mermaid fence（`ArchDiagrams` 提取图表，**图即地图**；无图文档回退全文）；`.json` 产物经真实 A2UI 渲染器重放（与对话 surface 同一渲染路径）。
- **索引关系图**（R3-6）：默认**关系图视图**（`SymbolGraphView`），一键切列表；搜索定位中心、点击节点重定中心、返回栈。

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
- `--print` 结构化输出（progress + results，非 TUI）；心跳进度文案提示「读取符号索引加速生成（LLM 阶段无进度流）」。

### arch-scan（架构图）

- core action `arch-scan.run`（经 `runBackgroundTask` 无会话后台 LLM 循环）产出 **Mermaid 架构图文档**（`.deeporca/prototypes/arch-<name>.md`，经 a2ui MCP `save_archmap` 落盘；技能方法论来自 oh-my-mermaid + diagram-design 编辑纪律，复杂度预算：单图 ≤9 节点/≤12 边）。legacy `arch-*.json`（早期 A2UI surface 输出）仍被列出并经 A2UI 渲染路径显示。
- `KnowledgeReadArchmap` 按扩展名分发：`.md` → markdown，`.json` → surface。

## BuildJobManager（`main/build-job-manager.ts`）

- **R2-1 后台构建**：作业持有在 **main 进程**（renderer 行状态是只读订阅；切行/tab 不丢构建；每工作区一作业幂等，不同 root 并行）。
- **R3-5 分阶段可观测**：每条进度折叠进 `stages[]` 状态机（codegraph → wiki → [arch-scan init only]）+ **500 行 console 环缓冲**（`logs`）+ `updatedAt`（elapsed/活性展示）。wiki 阶段自身无进度流（openwiki --print 缓冲全部输出到退出），阶段视图显示状态+耗时而非冻结 percent——「卡在 36%」曾是 10 分钟 wiki 运行的观感问题。首帧即广播（codegraph 预热可能数秒无进度线）。
- **阶段失败显性化**：`index.build-all` 把阶段错误收进 `stages[]` 报告**正常返回**；manager 逐阶段核对并标 `failed`/`skipped`，整体 `stage: "failed"` + 错误摘要——否则失败构建会显示「完成」而状态永远「未同步」。
- `KnowledgeBuild` (init/update/auto) → `buildJobs.start(root, mode)` → ActionRegistry 组合（[workflows/knowledge-build](../workflows/knowledge-build.md)）。`auto` = 双索引存在 → update，否则 init。
- 取消传播：`ctx.signal` 接入后台 LLM 循环（下一迭代边界中止，已产出 surface 仍落盘）。

## Focused Tests

- `app-boot.test.ts`（knowledge IPC 装配）、`build-job-manager.test.ts`（阶段/日志/失败语义）。
- `knowledge-build-progress.test.ts`（renderer 阶段清单 UI）、`streamdown-view.test.ts`（wiki 预览安全边界）。
- Core 侧：`background-task.test.ts`（零会话残留）、`codegraph.test.ts`、`routing-gating.test.ts`、`phase-actions.test.ts`（arch-scan 通道偏好）。

## Related Pages

- [main-process](main-process.md)（registerKnowledgeIpc/registerCodegraphIpc/registerCrgIpc/registerWikiIpc）
- [renderer-components](renderer-components.md)（KnowledgePanel/SymbolGraphView/KnowledgeBuildProgress）
- [core/actions](../core/actions.md)（wiki/codegraph/crg/index-build/arch-scan action 族）、[core/mcp](../core/mcp.md)（save_archmap/a2ui seam）
- [workflows/knowledge-build](../workflows/knowledge-build.md)（一键构建端到端）
