# CRG（code-review-graph）上游源码深潜 — 能力全景与挖矿方案

> **日期**：2026-09-01
> **来源**：审查模块三提交（805ec73/cb4486e/f3dd487）审查后，对风险图谱依赖的上游仓库
> [tirth8205/code-review-graph](https://github.com/tirth8205/code-review-graph) 的源码级深潜
> **克隆**：`vendor-src/code-review-graph`（浅克隆，`b586687` v2.3.8，2026-08-26；与 vendored
> wheel `packages/desktop/vendor/crg/code_review_graph-2.3.8-py3-none-any.whl` 逐文件一致，
> 含 `tools/build.py` 内同款 `risk_index` 写入 SQL —— 双源交叉核对成立）
> **结论速览**：上游存在**两套并行且不一致的评分体系**；deeporca 直读的是简化版
> `risk_index`；完整六因子模型与行级变更匹配、影响流、社区等能力均未接入。本文给出
> 逐项挖矿方案与优先级。

---

## §1 CRG 架构分层

本地优先、增量维护的结构化代码知识图谱，SQLite 单文件（WAL 模式）：

| 层 | 模块 | 说明 |
| --- | --- | --- |
| 解析 | `parser.py`（16k 行） | Tree-sitter 多语言 AST + 定向 fallback；Java/Spring 富化合成节点（Endpoint / Scheduler / ConfigProperty）与边（HANDLES / TRIGGERS / INJECTS / PUBLISHES / DEPENDS_ON_CONFIG）；自定义语言（languages.toml）；ReScript / HCL / TS 路径别名解析 |
| 构建 | `graph.py` / `incremental.py` / `migrations.py` | SQLite store；git 增量（`update`）+ 文件监听（`watch`/hooks）；**schema 迁移 v1–v9** |
| 消费 | `cli.py`（20 子命令）+ `main.py`（FastMCP：**30 tools + 5 prompt 模板**） | build / update / postprocess / embed / watch / status / visualize / wiki / detect-changes / impact / query / search / flows / communities / architecture / large-functions / refactor / enrich / serve / register / eval |

graph.db 关键表（`docs/schema.md`）：`nodes`（含 `community_id`、`file_hash`、`extra` JSON、
`updated_at`）、`edges`（含 `confidence`/`confidence_tier`）、`flows` + `flow_memberships`、
`flow_snapshots`（critical_path）、`communities` + `community_summaries`、`risk_index`、
`nodes_fts`（FTS5：name/qualified_name/file_path/signature）、`metadata`。
**deeporca 从未读过的表**：flows/flow_snapshots、communities/community_summaries、nodes_fts。

## §2 两套评分体系（最重要的发现）

### 2.1 全量六因子模型 — `changes.py:compute_risk_score`

detect-changes / MCP `detect_changes_tool` 专用，**按需计算**（非预计算）：

```
flow 参与      min(Σ flow criticality, 0.25)   （无 flow 数据时 count×0.05 兜底）
跨社区调用    min(跨社区 CALLS 调用者数 × 0.05, 0.15)
测试覆盖      0.30 − min(传递测试数 / 5, 1) × 0.25   （传递 = 沿 CALLS ≤1 跳，frontier≤50）
安全关键词    0.20（constants.SECURITY_KEYWORDS，24 词）
调用者数      min(callers / 20, 0.10)
变更频率      min(churn / 10, 1) × 0.15（opt-in，CRG_CHURN_WINDOW_DAYS=90）
累计 clamp 到 [0,1]
```

### 2.2 预计算简化版 — `tools/build.py` postprocess 写的 `risk_index`

**deeporca `getRiskOverview` 直读的正是这张表**：

```
callers > 10 → +0.30；3 < callers ≤ 10 → +0.15
未测试       → +0.30（二元 tested/untested，无梯度、无传递）
安全关键词   → +0.40（仅 11 词：auth/login/password/token/session/crypt/
             secret/credential/permission/sql/execute —— 少了 query/validate/
             sanitize/encrypt/hash/sign/verify/admin/privilege/connect/socket/request/http）
clamp 1.0；无 flow 参与、无跨社区、无 churn、无传递测试
```

**含义**：deeporca 图谱的"风险分"是最粗糙一档的代理指标；两套体系在上游也互不引用。
与六因子模型在因子构成、阈值、词表、测试语义上全部不同 —— 这是 deeporca 的差异化机会，
不是缺陷兼容问题。

### 2.3 flow criticality（flow_snapshots.criticality 的来源）— `flows.py:compute_criticality`

```
文件跨域 0.30（(文件数−1)/4 归一） · 外部调用 0.20（外呼数/5 归一）
安全敏感 0.25（命中安全词的节点占比） · 测试缺口 0.15 · 深度 0.10（depth/10）
```
社区检测：igraph `community_leiden`（`communities.py:_detect_leiden`），build postprocess 写入
`community_id` 与 `community_summaries`。

## §3 路径与匹配语义（此前审查 P1 的源码级定案）

上游完整机制（`changes.py:analyze_changes` + `graph.py:get_files_matching` + `map_changes_to_nodes`）：

1. git diff 产出**相对路径** → `normalize_file_path(root / key)` 归一为**正斜杠绝对路径**
   （Windows 上 `C:/repo/...`，issue #774 的图身份约定）；
2. 精确匹配失败时 **LIKE 后缀兜底**（`%` + 归一化 pattern，`get_files_matching`）——
   针对 issue #528（Windows 分隔符）与 #848（detect-changes 报 0 flow）的官方修补；
3. **行级匹配**：`parse_git_diff_ranges` 用 `git diff --unified=0` 提取变更行区间，
   `map_changes_to_nodes` 以 `node.line_start ≤ end && node.line_end ≥ start` 做**区间重叠**判断；
4. 变更函数上限 `CRG_MAX_CHANGED_FUNCS=500`，**在筛选之后截断**。

对比 deeporca（`crg-query.ts`）：`detectChanges` 只有 `file_path IN (...)` 精确匹配 ——
① 文件级粒度（整文件所有函数被标为"变更"，比上游粗一个层级）；② Windows 上
`path.resolve` 出反斜杠 vs 库内正斜杠 → 精确匹配落空且**无 LIKE 兜底**（P1 成立）；
③ `getGitChangedFiles` 的 `slice(0,800)` 在 dot 过滤之前（审查报告 P1-2 依旧成立，
上游在筛选后截断的顺序值得抄）。

## §4 测试覆盖的真实语义（deeporca `getTestGaps` 的差距）

上游 `graph.py:get_transitive_tests`：直接 TESTED_BY + **沿 CALLS 的间接测试**
（默认 1 跳、frontier≤50 防爆炸），支持类/文件节点展开（CONTAINS 子符号）；
TESTED_BY 边方向约定：**source=被测生产函数，target=测试函数**（issue #515）。
deeporca `getTestGaps` 只查直接边、无传递、无类展开（方向本身一致）。

## §5 能力清单 vs deeporca 利用面

| 能力 | 上游对象 | deeporca 现状 |
| --- | --- | --- |
| 风险 Top-N + CALLS 边 | risk_index（简化版） | ✅ `getRiskOverview` |
| 变更检测 | detectChanges | ✅ 但文件级、无路径归一/兜底、无行级 |
| 测试缺口 | getTestGaps | ✅ 但仅直接边 |
| 影响半径 | `getImpactRadius`（加权 BFS：CALLS 1.0 / INHERITS 0.9 / IMPLEMENTS 0.9 / TESTED_BY 0.7 / REFERENCES 0.6 / DEPENDS_ON 0.6 / IMPORTS_FROM 0.5 / CONTAINS 0.3；深度衰减 0.6、分数下限 0.05、MAX_IMPACT_DEPTH=2、SQL/networkx 双引擎） | ⚠️ 自建无权重无衰减 BFS，且 review.full 从未调用 |
| 完整风险模型 | detect_changes（六因子 + review_priorities top10 + summary 文案） | ❌ |
| 受影响执行流 | get_affected_flows + flow_snapshots.critical_path | ❌ |
| 社区/架构 | Leiden 社区 + community_summaries + architecture overview | ❌ |
| Token 优化审查上下文 | get_review_context（变更子图 + 影响半径 2 跳 + 源码片段预算 + minimal 档 ~100 token） | ❌ |
| 规则化审查指引 | `tools/review.py:_generate_review_guidance`（未测试函数 / 爆炸半径>20 / 继承实现边 / 跨文件>3） | ❌ |
| FTS5 检索 | query / search（nodes_fts + postprocess 签名） | ❌ |
| 图谱新鲜度 | watch / git hooks 增量更新 | ❌（手动 reindex） |
| 可视化 | visualize：full 力导 / community 聚合 / file 聚合；导出 html/json/graphml/cypher/obsidian/svg | ⚠️ 自研 file 分组版（风格更贴产品，但缺社区视角与导出面） |
| MCP 侧能力 | 30 tools + 5 prompts（review_changes / architecture_map / debug_issue / onboard / pre_merge） | ❌（deeporca 已弃用 Python MCP，直读 SQL —— 决策本身合理，差距在 SQL 面没写全） |

## §6 挖矿方案（按性价比排序）

### ① 行级富化 + 路径归一（修复 P1 的正解，同时升级粒度）— P0
`git diff --unified=0` 解析变更行区间 → `WHERE file_path = ? AND line_start <= ? AND line_end >= ?`
区间重叠匹配；两侧路径统一 posix 归一（双形态 IN 兜底）。收益：Windows 富化复活 +
只标真正被改的函数。落点：`crg-query.ts:detectChanges` 签名扩展 + `review.ts:getGitChangedFiles`
返回行区间 + review-changed-files / crg-query 测试补行级用例。

### ② 六因子评分纯 SQL 化 — P1
flow 参与 / 跨社区（`communities`+`community_id`）/ 传递测试（递归 CTE，仿上游 frontier 上限）
均可 SQL 化；churn（`git log --numstat`，90 天，opt-in）走一次 execFile。
产出：`getRiskOverview` 的排序键从 risk_index 升级为可插拔评分器（默认仍回退简化版，
旧图兼容）。此即"风险分可信化"。

### ③ 受影响执行流进报告 — P1（依赖 ①的部分产物）
`flow_snapshots.critical_path` + `flow_memberships` join 变更文件 → 报告新增
"受影响执行流"卡片（entry point → 关键路径 + criticality），finding 可挂"所在流"。
与原生报告视图的按文件分组结构天然兼容。

### ④ 社区视角进风险图谱 — P2
风险图谱分组维度"按文件"与"按社区"可切换（上游 visualize 的 auto 模式即此思路：
超预算优先社区聚合）；跨社区调用连线高亮（对应六因子中的跨社区项，可视化印证）。
与现有分组卡片设计兼容（per-file 卡 → per-community 卡，节点行不变）。

### ⑤ review.full 背景注入升级为 get_review_context 式 — P2
`formatCrgContextForOcr` 现在只有文本摘要；上游模式 = 变更子图 + 影响半径 2 跳 +
规则化审查指引（未测试/爆炸半径/继承/跨文件四条规则，直接可译成中文段落注入
`--background`）。成本极低（纯函数）。

### ⑥ 图谱新鲜度提示 — P3
不引入 Python watch 常驻（与架构相冲）；`review.full` 前用 `nodes.file_hash` 对照
工作区文件 mtime/hash 探"图谱落后"，落后时提示 reindex。

### 明确不挖
embeddings（deeporca 自带 Granite 路由嵌入）、registry 跨仓库、daemon/watch 常驻、
VS Code 扩展、graphml/cypher/obsidian 导出面。

## §7 风险提示

- **schema 版本漂移**：上游 migrations v1–v9 会增删列/表（signature、community_summaries
  都是后加的）。deeporca 直读 SQL 应对缺列/缺表 fail-open —— 现仅 `getRiskData` 对
  risk_index 缺表做了 try/catch，其余查询裸奔。建议读取侧统一 `safe` 包装。
- 上游 `risk_index` 与六因子模型不一致是**上游自身现状**，deeporca 升级评分时应以
  六因子语义为准，不要反向对齐简化表。

## §8 关联文档

- 审查模块设计文档：[specs/review-module/design.md](../specs/review-module/design.md)
- 审查 Tab 视觉设计稿：`designs/review-module/screen-review.html`
- 上游 schema：[vendor-src/code-review-graph/docs/schema.md](../../vendor-src/code-review-graph/docs/schema.md)