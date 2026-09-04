# doc-wiki 文档知识编译层 — 技术设计

> 状态：**设计定稿（2026-08-19，待 `next/*` 启动）** · 归属：下一版本主线 D（`docs/features/next-version-plan.md`）
> 来源：llm_wiki 预研（`docs/research/2026-08-19-llm-wiki-prestudy.md`）——**GPL-3.0，净室借鉴，零代码继承**。
> 命名约定：spec/目录名 `doc-wiki`（kebab-case）；代码前缀 `docwiki`（模块 `packages/core/src/docwiki/`、action `docwiki.*`、IPC `docwiki:*`），与 `gitmcp` 先例一致。

## 1. 定位：补齐六源知识栈的唯一空白

现状（`knowledge:status` 六源）：memory 只吃**对话**（L0–L3），OpenWiki 只吃**代码**，
GitMCP 只吃**外部 repo 文档**——没有任何一源消费"用户的资料"（本地 MD/PDF/网页剪藏）。
`book-distill` 技能的产物是 SKILL.md（行为指令），不是可检索的知识条目。

doc-wiki 引入**编译型知识层**（Karpathy 方法论核心论点）：RAG 每次查询从原始文档重新
检索、重新推导，知识无积累；编译层让 LLM 把资料**增量编译为互链的 Wiki 页**——知识
编译一次、持续维护，交叉引用已建好、矛盾已标记、综述已反映全部已读资料。agent 优先
读编译产物而非每次翻原始资料（与 OpenWiki「读 wiki 省 token」同一逻辑，对象从代码
换成资料）。

三层分工与角色（沿方法论，表述自研）：

| 层 | 内容 | 写权 |
| --- | --- | --- |
| 原始资料 `raw/` | 用户导入的文档，**不可变**，事实之源 | 仅用户 |
| Wiki `wiki/` | LLM 编译的互链 Markdown（摘要页/实体页/概念页/综述） | 仅 LLM（管线） |
| 约定层 | `purpose.md`（知识意图：目标/关键问题/范围）+ 页面类型约定 | 人机共演化 |

## 2. 许可边界（净室红线）

- llm_wiki LICENSE 本体为 **GPL-3.0**（版权人 Yong Su，预研已核证）：**不 vendor、不
  拷贝任何代码**（含其 `mcp-server/`、`extension/`），不逐字复用其提示词与 schema 文本。
- 可合法借鉴（思想/算法不受版权保护）：两步摄入、SHA256 增量缓存、串行队列语义、
  `sources[]` 溯源、四信号关联度、图扩展检索、孤儿/稀疏/桥接洞察、比例预算分配。
- Karpathy 的 `llm-wiki.md` gist 无明确许可：方法论可用，文本自研表述。
- 立场与 MemBrain 先例（`docs/research/2026-08-17-hallmark-codebrain-membrain-prestudy.md`
  许可红线节）及依赖树 license 合规门禁一致。

## 3. 总体架构

```mermaid
graph LR
  subgraph 输入
    IMP[导入文件/文件夹<br/>面板 pickFolder] --> RAW[.deeporca/docwiki/raw/<br/>不可变]
    URL[URL 抓取 D2+<br/>复用 WebFetch] --> RAW
  end
  subgraph core docwiki 模块（进程内）
    RAW --> SCAN[扫描器<br/>SHA256 增量缓存]
    SCAN --> Q[持久化串行队列<br/>.metadata/queue.json]
    Q --> S1["Step1 分析（LLM-flash）<br/>实体/概念/矛盾/结构建议"]
    S1 --> S2["Step2 生成（LLM-flash）<br/>页面写入+更新 index/log"]
    S2 --> PAGES[wiki/*.md<br/>OKF frontmatter + sources[] + [[wikilink]]]
    PAGES --> IDX[索引器 SearchBackend<br/>FTS5（+可选向量）]
    PAGES --> GR[图构建器<br/>wikilink 边 + sources 重叠边]
    REV[审核队列 .metadata/review.json<br/>D2] 
  end
  subgraph 消费
    ACT[docwiki.* actions<br/>defineAction 三面] --> AGENT[会话 Agent]
    IDX --> ACT
    GR --> ACT
    PANEL[知识面板第七源卡 + 队列进度] 
  end
```

三原则（对齐 gitmcp spec 风格）：

1. **引擎归 core，LLM 走注入 seam**：`packages/core/src/docwiki/` 全部纯逻辑 +
   `configureDocwikiLlmRunner` 注入点（仿 `configureRoutingModelDir` 的 host 注入惯例），
   desktop main 启动时绑到**辅助模型 flash 通道**（对齐路线图 §十「辅助模型迁移」：
   索引/摄入类调用走 secondary client）。core 保持 UI-free。
2. **文件即事实之源**：wiki 页是磁盘上的 Markdown（Obsidian 可直接打开 vault），
   `.metadata/` 里的索引/图/队列全部是**可重建的派生物**——删掉 `.metadata/` 重建即可，
   永远不承担权威状态。
3. **fail-open**：docwiki 缺失/模型不可用/索引损坏一律降级（检索退化为纯文件读取或
   直接跳过该源），绝不阻断会话与 `index.build-all`。

## 4. 数据布局与页面格式

```
<projectRoot>/.deeporca/docwiki/
├── purpose.md          # 知识意图（目标、关键问题、范围、演进论点）——D0 即生效
├── raw/                # 原始资料（不可变；默认 gitignore，见 §11 开放问题）
├── wiki/               # LLM 编译产物
│   ├── index.md        # 内容目录（agent 检索第一入口；按类型分组 + 一行摘要）
│   ├── log.md          # 时序操作记录，`## [YYYY-MM-DD] ingest | <标题>` 可 grep 前缀
│   ├── overview.md     # 全局综述（每次摄入后重生成）
│   ├── sources/        # 资料摘要页（每份 raw 文件一页，兜底保证生成）
│   ├── entities/       # 实体页（人物/组织/产品/模块）
│   └── concepts/       # 概念页（理论/方法/技术）
└── .metadata/          # 派生物：hashes.json / queue.json / review.json / index.db / graph.json
```

页面格式：**沿用 OpenWiki 的 OKF frontmatter，扩展两个字段**——两种 wiki 页面格式保持
同族，`wiki.list-pages/read-page`（`packages/core/src/actions/wiki.ts`）泛化时零分叉：

```yaml
---
type: entity            # OKF 既有：entity | concept | source-summary | synthesis
title: Karpathy 编译型知识库
tags: [knowledge-base, methodology]
sources:                # 新增：溯源数组，回链贡献的 raw 文件（相对路径）
  - raw/llm-wiki-gist.md
---
正文……互链用 [[concepts/rag]] 语法。
```

`sources[]` 是溯源、图构建（来源重叠边）、级联删除三者的共同基础——对应 memory L1
record 的 `source_message_ids`，同一设计思想在不同数据域的实例。

## 5. core 模块设计

```
packages/core/src/docwiki/
├── layout.ts          # 路径解析/保证目录结构/purpose.md 读取；projectRoot 派生（host 不另行注入）
├── runner.ts          # DocwikiLlmRunner 接口 + configureDocwikiLlmRunner/getDocwikiLlmRunner 单例
├── scanner.ts         # raw/ 扫描 + SHA256 缓存比对（.metadata/hashes.json），产出待摄入清单
├── queue.ts           # 持久化串行队列状态机：落盘/崩溃恢复/重试≤3/取消；进度回调
├── ingest.ts          # 两步摄入编排（Step1 分析 → Step2 生成）；资料摘要页兜底；overview 重生成
├── pages.ts           # OKF+sources[] frontmatter 解析/序列化（gray-matter，复用 wiki.ts 依赖）
├── graph.ts           # 图构建：解析 [[wikilink]] + sources[] 重叠 → 邻接表（.metadata/graph.json）
├── search.ts          # SearchBackend 抽象（Fts5Backend 必选 / VecBackend 可选）+ 图扩展合并
├── insights.ts        # D2：孤儿页（度≤1）/ 桥接节点 / 稀疏域近似（详见 §8）
├── review.ts          # D2：审核项追加/列出/解决（预定义操作：create-page|research|skip）
└── store.ts           # node:sqlite 持久层（仿 gitmcp store.ts：FTS5 虚表 + embedding BLOB 预留）
```

LLM seam（core 不自带任何模型客户端）：

```ts
export interface DocwikiLlmRunner {
  /** 单轮补全。opts.json=true 时要求模型仅输出 JSON（摄入两步的机器可读产物）。 */
  complete(prompt: string, opts?: { maxTokens?: number; json?: boolean }): Promise<string>;
}
```

嵌入复用 routing 的进程级单例（`routing/embedding-loader.ts` 的 `getEmbeddingService`，
模型目录已由 host 注入）——不新增模型实例、不新增 vendor；嵌入不可用时 `VecBackend`
为 null，检索退化为 FTS5 + 图扩展（fail-open）。

## 6. 两步摄入管线

| 环节 | 设计 |
| --- | --- |
| 触发 | ① 面板导入（文件/文件夹，`pickFolder` 现有 channel）② `docwiki.ingest` action（LLM/IPC 面）③ D2+：`raw/` 目录监听（外部放入文件自动入队） |
| Step1 分析 | 输入 = 资料文本 + `index.md` + `purpose.md` + 相关既有页（标题级）；输出 JSON：关键实体/概念、与现有知识的矛盾与张力、结构建议、审核项、（可选）研究查询 |
| Step2 生成 | 基于分析写页：资料摘要页（**兜底保证**：Step2 遗漏时由 ingest.ts 直接合成最小摘要页）、实体/概念页新建或更新、`[[wikilink]]` 交叉引用、frontmatter `sources[]`；随后更新 `index.md`/`log.md`/重生成 `overview.md` |
| 缓存 | 摄入前比对 raw 文件 SHA256 与 `.metadata/hashes.json`，未变更跳过（省 token 的第一道闸） |
| 队列 | 串行（防并发 LLM 调用）、状态落盘、启动时恢复未完成项、失败重试 ≤3、可取消；进度经现有 `event:actionProgress` 流式到面板 |
| 删除级联 | 删 raw 文件时三重匹配（`sources[]` / 摘要页名 / 章节引用）找关联页；**共享实体保护**——被多份资料引用的页只从 `sources[]` 移除该资料，仅当数组为空才删页；同步清理 index 条目与失效 wikilink |
| 语言 | 生成语言跟随会话语言设置（资料语言不决定输出语言） |

两步拆分的价值（预研结论）：分析步让模型先建立"新资料 vs 既有知识"的关系图景，
生成步只在结构化分析之上落笔——相比单步"边读边写"显著减少漏更新与自相矛盾。

## 7. 检索管线

```
① FTS5 关键词（node:sqlite，中文按既有 FTS5 zh 处理，标题命中加权）
② 可选向量（VecBackend，嵌入来自 routing 单例；结果与 ① 合并去重：增强已有命中 + 补充新发现）
③ 图扩展：①② 的 top 结果为种子，沿 graph.json 邻接做 2 跳遍历带衰减
   （衰减权重 w = 边权 × hop^(-1)；边权两信号起步：直接链接 3.0 / 来源重叠 4.0，
   Adamic-Adar 1.5 与类型亲和 1.0 留 D2 末视召回增益再决定）
④ 预算装配：可配置 token 预算（默认 8K）内按「检索分 + 图关联分」排序装配页面全文，
   附编号引用（[1][2]…），同批返回 index.md 节选与 purpose.md 摘要
```

Agent 消费面：`docwiki.search` / `docwiki.read-page` action（defineAction 三面到达）
+ 内置 `docwiki-qa` skill（镜像 `wiki-qa` 形态，教 agent 先 search 再 read-page）。
直接读路径同样成立：页面在 `<projectRoot>/.deeporca/` 下，现有 `read` 工具的路径权限
推断即可覆盖，零新权限面。

## 8. Actions / IPC / 面板（desktop 接线）

| 面 | 内容 |
| --- | --- |
| actions（core，defineAction 静态注册，B1 动态化后免费获益） | `docwiki.ingest`（扫描+入队）、`docwiki.search`、`docwiki.read-page`、`docwiki.graph`（返回邻接子图）、`docwiki.lint`（D2）、`docwiki.insights`（D2） |
| `index.build-all` | 三阶段 → **四阶段**：codegraph → openwiki → arch-scan（gated）→ docwiki（update 模式刷新 codegraph+openwiki+docwiki） |
| IPC（`shared/ipc.ts`） | 请求 `docwiki:ingest/status/search/listPages/readPage/reviewList/reviewResolve`；进度复用 `event:actionProgress` |
| `knowledge:status` | `KnowledgeSourceStatus` 增第七源 `docwiki`（state: `empty \| indexing \| indexed \| stale`，对齐六源协议） |
| 面板 | `IndexLibraryPanel` 第七源卡：导入入口（文件/文件夹）+ 队列进度 + `docwiki.search` 试搜；D2 加审核 tab 与图谱洞察卡 |

## 9. D2 增量：洞察、审核、研究闭环

- **图谱洞察（insights.ts）**：MVP 不做 Louvain——孤儿页（度 ≤1）、桥接节点（跨
  `type` 边数 top）、稀疏域（按 tags 聚合的组内互链密度近似，密度 < 阈值告警）三项
  用纯图统计即可产出；Louvain 社区检测留观察项（引入 graphology 级依赖前先验证前三
  项的用户价值）。
- **审核队列（review.ts）**：Step1 产出的"需人工判断项"落 `.metadata/review.json`，
  预定义操作 `create-page | research | skip` + 预生成搜索查询；面板处理，不阻塞摄入。
- **Deep Research 闭环**：实现为 **skill（`docwiki-research`）而非 action**——读
  `docwiki.insights` + overview + purpose 生成研究主题 → `AskUserQuestion` 确认可编辑 →
  循环调用内置 `WebSearch`/`WebFetch` → 结果落 `raw/research/` 作为新资料自动入队摄入。
  llm_wiki 需外接 Tavily/SerpApi，本仓内置联网工具使闭环后半段零新依赖。

## 10. 与现有子系统的边界

| 子系统 | 数据域 | 与 doc-wiki 关系 |
| --- | --- | --- |
| OpenWiki（`wiki.*`） | 代码 → 文档 | 平行编译器：openwiki 吃代码、docwiki 吃资料；页面格式同族（OKF+sources[]），controller/actions 分立 |
| @deeporca/memory | 对话 → 记忆 | 互补不合并：L1 碎片事实 vs wiki 结构化互链页；recall 注入各自独立（配额归开放问题） |
| GitMCP | 外部 repo 文档 → 检索索引 | 检索型（不编译）；`SearchBackend` 抽象同源（gitmcp store.ts 先例） |
| book-distill | 文档 → SKILL.md | 产物是行为指令非知识条目；用户可选"同一资料先蒸馏技能再编译知识页" |
| D3（出本版范围） | — | 反向 MCP server 暴露 memory+docwiki 检索、PDF/DOCX/EPUB 多格式解析、Chrome 剪藏——记入 next-version-plan 主线 D 表格留后续版本 |

## 11. 测试策略

- 纯函数单测（node:test + tsx，fake `DocwikiLlmRunner`）：scanner 哈希缓存矩阵、
  pages frontmatter 解析/序列化往返、graph 构建（wikilink + sources 重叠边）、queue
  状态机（落盘/恢复/重试/取消）、级联删除三重匹配与共享实体保护、search 装配预算
  截断、insights 三项统计。
- 集成：临时目录跑通 `raw 两文件 → ingest → wiki 页面 + index/log + 索引/图 → search
  召回 → 删除一文件 → 级联清理` 全链（fake runner，零网络）。
- 回归：`index.build-all` 四阶段在 docwiki 未配置时第三/四阶段 skipped 不失败。

## 12. 开放问题（实现前需拍板）

1. `raw/` 默认 gitignore、`wiki/` 默认可提交——是否在首摄时自动写 `.gitignore` 条目？
2. memory recall 与 docwiki 检索的**注入配比**（共享系统提示预算时的分配）——留待 D2
   实测召回增益后定，本期各自独立注入。
3. overview.md 重生成频率（每次摄入 vs 每 N 次）——token 成本与新鲜度的折中。
4. B1（module-system 动态化）落地后，docwiki 是否转为可插拔 module——本期按静态
   defineAction 注册设计，接口上不提前缴纳动态化成本。
