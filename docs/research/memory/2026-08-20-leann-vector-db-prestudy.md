# LEANN 预研 — 能否替代 sqlite+vfs 作底层持久化向量数据库（StarTrail-org/LEANN）

> 日期：2026-08-20 · 状态：**⬜ 未消费（结论型调研：不替代——运行时形态、查询能力、规模三重错配；分层 HNSW 思想与 MCP 服务形态记观察项）**
> 仓库：`github.com/StarTrail-org/LEANN`（"Memory is all you need"，本地优先轻量向量库引擎：Python 核心分层 HNSW + MCP server + CLI + Python SDK；TypeScript 客户端官方标注 *planned* 未交付；Rust 核心重写进行中；双许可 Apache-2.0 + 商用附加条款）
> 评估对象：本仓现行 "node:sqlite + sqlite-vec(vec0) + FTS5 + JSONL" 持久化路线（memory 包 L0–L3 / routing / doc-wiki 设计）

---

## 1. LEANN 是什么

面向本地优先 AI 应用的轻量向量库：**只存原文（raw text）+ 嵌入**，检索后用原文字符串二次验证（过滤幻觉相似度）；索引为**分层 HNSW**（M=8/L=16 小图 + 分层记忆映射）——GB 级语料索引仅 ~2.6MB、内存有界（百万 chunk 时代价 O(L·M)）、双 hop 邻居 probe 提召回（但本质是**近似**检索）；存储为 mmap 分层文件 + parquet 原文，无 SQL/FTS/结构化过滤；交付形态 Python 引擎 + **MCP server 子进程**（stdin/stdio JSON-RPC）。

## 2. 与现行方案对照（逐维度）

| 维度 | 本仓现行（sqlite+vfs） | LEANN | 判断 |
| --- | --- | --- | --- |
| 运行时形态 | `node:sqlite` DatabaseSync **进程内**，零子进程零服务（`memory/src/tdai/core/store/sqlite.ts`） | Python 引擎 + MCP server 子进程；TS 客户端未交付 | **错配**：引入 = 每数据目录多一个 Python 进程管理面（spawn 生命周期/崩溃恢复/Windows 兼容），违反 vendor Node-first 形态；core/memory 全 TS 链路断为跨语言 |
| 检索能力 | 向量（sqlite-vec vec0 **精确** KNN）+ BM25（FTS5+jieba）+ 元数据 SQL 过滤，RRF 混合（`auto-recall.ts`） | 仅向量近似检索；无 FTS、无 SQL 过滤 | **错配**：我们 auto-recall 的 hybrid 与结构化过滤在 LEANN 无对应物，替换 = 功能倒退 |
| 规模适配 | 个人会话记忆：千~万级记录，暴力扫描足够 | 卖点在 10万+ chunk、内存有界 | **错配**：目标规模错一级；分层剪枝复杂度在小规模无回报，且把精确 KNN 换成近似 |
| 持久化/一致性 | 单文件 `vectors.db`（WAL）+ 按日 JSONL 双写；tmp+rename 原子写惯例全仓统一 | mmap 分层文件 + parquet 原文 | 大体等价；但 LEANN **原文明文存储**对我们是安全减分（记忆含隐私，本仓已有隐私剔除线） |
| 许可 | 全仓 MPL-2.0 口径 | Apache-2.0 + 商用附加条款（双许可） | 引依赖需单独法务口径 |
| 工具持久化（CodeGraph/CRG/task-tree/session） | 各自 sqlite/JSONL，与 memory 不共享后端 | — | 这些根本不是向量库问题，LEANN 不沾边 |

## 3. 结论：不替代（2026-08-20 定稿）

**No。** 三重错配（进程外 Python 服务 vs 进程内 TS；纯向量近似 vs 向量+BM25+SQL 混合；超大规模卖点 vs 个人记忆规模），外加双许可与原文明文存储两个减分项。现行 sqlite+vec0+FTS5 路线在本仓规模下**精确、零服务、可备份、与 doc-wiki 设计（Fts5Backend 必选 + embedding BLOB 预留）一致**，替换无收益纯增险。

## 4. 记观察项（不立项）

1. **分层 HNSW / 内存有界 mmap 索引思想**：当 doc-wiki 知识编译达到 10万+ chunk 且内存/延迟实测成瓶颈时的备选路径之一——但届时优先评估 sqlite-vec 升级或 usearch 等原生 TS/Rust 库，而非引 Python 服务。
2. **MCP 记忆服务形态**：若 M 线（远程访问）演进到"多端共享记忆、独立记忆服务"，LEANN 的 MCP server 形态是候选外部选项之一（同场竞争的还有 tcvdb 远端后端，`factory.ts` 已有开关）。
3. **原文二次验证思想**（存原文、检索后重验）本仓已等价具备（JSONL 原文 + 向量双存），无需动作。

## 5. 未核验项

- 分层剪枝的召回率上界（其文档承认 probing 是启发式）未独立复现——不影响"不替代"结论（我们要求精确 KNN）。
- Rust 核心重写与 TS 客户端均为 roadmap 未交付项——若未来交付，重评触发条件见 §4。
