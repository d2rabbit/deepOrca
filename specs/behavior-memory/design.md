# DeepOrca 行为记忆系统设计方案（轻量版）

> 日期：2026-08-04 · 状态：**❌ 已废弃（2026-08-17 拍板）**——记忆能力由 `@deeporca/memory`（vendored TDAI Core L0–L3 管线，`packages/memory/`）承接，本 spec 不再排期；旁系成果 activity-frames 双管线与行为 boot context 已另行落地（见 `docs/research/README.md` 台账作废记录）。保留本文供溯源，不作为实现依据。
> 模块：`activity-frames` 演进
> 基础：[MemOS 预研报告](../../docs/research/archive/2026-08-04-memos-memory-operating-system.md) · [activity-frames 设计](../archive/activity-frames/design.md)
> 原则：**零外部运行时依赖**（不加向量库/图库/Redis），复用 Node 22 `node:sqlite` + FTS5

---

## 0. 设计目标

把 activity-frames 从**「行为数据 ETL + 只读查询」**升级为**「行为记忆系统」**：

```
当前：  采集 → sessionize → 只读查询（时间窗口扫描）
目标：  采集 → sessionize → 提炼写回 → 语义检索 + 时间衰减 → 遗忘/整合
```

**不做的**（明确放弃，与 MemOS 划清边界）：

- ❌ 向量库（Qdrant/Milvus/Chroma）——用 FTS5 全文检索替代语义检索
- ❌ 图数据库（Neo4j）——用 SQL JOIN + JSON 数组替代
- ❌ Redis 异步队列——用进程内节流 + setTimeout
- ❌ Memory³ 激活/参数记忆（KV cache / LoRA）——本地 Agent 无训练管线
- ❌ 嵌入模型（embedding）——FTS5 BM25 足够，省去模型依赖

---

## 1. 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                    BehaviorMemory（新增）                      │
│                                                              │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐  │
│  │ L1 Trace    │───▶│ L2 Summary   │───▶│ L3 Pattern      │  │
│  │ 原始事件流   │    │ 日/会话摘要   │    │ 行为模式/偏好    │  │
│  │ (只读，现有) │    │ (可写，新增)  │    │ (可写，新增)     │  │
│  └─────────────┘    └──────────────┘    └─────────────────┘  │
│       │                   │                     │             │
│       ▼                   ▼                     ▼             │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │     search_behavior(query) — FTS5 + 时间衰减排序         │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
         │                                      ▲
         ▼                                      │
┌─────────────────┐                    ┌────────────────┐
│ activity.db     │  ◄── 派生写入 ───  │ behavior.db    │
│ (nocta 原始库)   │                    │ (新增，可写)    │
│ 只读，不修改     │                    │ 摘要/模式/反馈  │
└─────────────────┘                    └────────────────┘
```

**关键决策：双库分离**

- `activity.db`：nocta-recorder 写入的原始帧/事件，**只读**（现有 `db.ts` 不变）
- `behavior.db`：deepOrca 自己管理的**派生记忆库**，可读写（新增）

这样不污染原始数据，派生记忆可以随时重建。

---

## 2. 派生记忆库 Schema（behavior.db）

```sql
-- 核心表：一条记忆 = 一个提炼后的知识单元
CREATE TABLE memories (
  id          INTEGER PRIMARY KEY,
  layer       TEXT NOT NULL,           -- 'summary' | 'pattern' | 'preference'
  summary     TEXT NOT NULL,           -- 人类可读摘要（1-3 句话）
  detail      TEXT,                    -- 详细内容（markdown，可选）
  -- 检索
  fts_text    TEXT NOT NULL,           -- FTS5 索引文本（summary + 关键词拼接）
  -- 时间衰减
  created_at  TEXT NOT NULL,           -- ISO 时间戳
  last_used   TEXT NOT NULL,           -- 最后被检索命中时间
  use_count   INTEGER DEFAULT 0,      -- 被检索命中次数
  -- 生命周期
  status      TEXT DEFAULT 'active',   -- 'active' | 'archived' | 'forgotten'
  confidence  REAL DEFAULT 1.0,        -- 置信度（0-1，反馈时衰减）
  -- 溯源
  source_type TEXT,                    -- 'session' | 'git' | 'shell' | 'file' | 'agent'
  source_refs TEXT                     -- JSON 数组：原始帧 ID / commit / session id
);

-- FTS5 虚拟表（全文检索，Node 22 内置）
CREATE VIRTUAL TABLE memories_fts USING fts5(
  fts_text,
  content='memories',
  content_rowid='id',
  tokenize='unicode61'                 -- 支持中文分词（unicode61 按 Unicode 边界切）
);

-- 触发器：写入 memory 时自动同步 FTS
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, fts_text) VALUES (new.id, new.fts_text);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, fts_text) VALUES('delete', old.id, old.fts_text);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, fts_text) VALUES('delete', old.id, old.fts_text);
  INSERT INTO memories_fts(rowid, fts_text) VALUES (new.id, new.fts_text);
END;
```

---

## 3. 三层记忆定义

| 层             | 来源                | 内容                                                                             | 写入时机                              |
| -------------- | ------------------- | -------------------------------------------------------------------------------- | ------------------------------------- |
| **L1 Trace**   | activity.db（现有） | 原始屏幕帧 + UI 事件 + git/shell/file 日志                                       | nocta-recorder 实时写入（不变）       |
| **L2 Summary** | behavior.db（新增） | 「今天在 deepOrca 项目做了 X：修了 Serena 配置 bug、审了插件分组、清了测试残留」 | Agent 主动写回 / 会话结束时自动生成   |
| **L3 Pattern** | behavior.db（新增） | 「用户习惯：每次 commit 前跑 `npm run check`；偏好用中文回复」                   | 离线整合（检测到 N 次重复行为时蒸馏） |

---

## 4. MCP 工具设计（新增 3 个，不改现有 6 个）

### 4.1 search_behavior —— 语义检索行为记忆

```
工具名：search_behavior
参数：
  query: string       — 自然语言查询（"上次修 Serena 时怎么做的"）
  hours?: number      — 时间窗口（默认 168h = 7 天）
  layer?: string      — 限定层：summary | pattern | preference
返回：
  [{ summary, detail, score, created_at, source_refs }]
排序：score = fts_rank × time_decay(now - created_at)
```

**检索算法**（FTS5 BM25 + 时间衰减，无向量）：

```ts
function searchBehavior(query: string, hours: number): MemoryHit[] {
  // 1. FTS5 BM25 全文检索
  const ftsHits = db.rows(
    `SELECT m.*, bm25(memories_fts) AS rank
     FROM memories_fts JOIN memories m ON m.id = memories_fts.rowid
     WHERE memories_fts MATCH ? AND m.created_at >= ? AND m.status = 'active'
     ORDER BY rank LIMIT 50`,
    ftsQuery(query),
    sinceIso(hours)
  );
  // 2. 时间衰减重排：score = (1 / (1 + bm25_rank)) × decay(ageHours)
  return ftsHits
    .map((h) => ({
      ...h,
      score: (1 / (1 + Math.abs(h.rank))) * decayFn(ageHours(h.created_at)),
    }))
    .sort((a, b) => b.score - a.score);
}
```

**时间衰减函数**（艾宾浩斯遗忘曲线简化版）：

```ts
// 半衰期 72 小时：3 天前的记忆权重减半，7 天后降到 1/4
function decayFn(ageHours: number): number {
  return Math.pow(0.5, ageHours / 72);
}
```

### 4.2 remember —— 写回行为记忆

```
工具名：remember
参数：
  summary: string     — 摘要（1-3 句话）
  layer: string       — summary | pattern | preference
  detail?: string     — 详细内容
  source_refs?: string[] — 原始帧 ID / commit / 文件路径
效果：写入 behavior.db，自动同步 FTS 索引
```

Agent 在完成任务后主动调用，把「做了什么、怎么做的、为什么这么做」写回。

### 4.3 forget —— 标记过时记忆

```
工具名：forget
参数：
  query: string       — 要遗忘的内容（模糊匹配 summary）
  layer?: string
效果：匹配的记忆 status → 'archived'，confidence × 0.3
      （不物理删除，保留可恢复）
```

Agent 发现某条记忆过时/错误时调用。

---

## 5. 离线整合（consolidation）

**触发时机**：deepOrca 启动时检查 last_consolidate 时间，如果距上次 > 24h，异步跑一次。

**整合逻辑**：

```ts
async function consolidate(): Promise<void> {
  // 1. 读取 activity.db 最近 24h 的 frames
  // 2. 用辅助模型（createSecondaryClient，flash）生成日摘要
  //    prompt: "总结今天的行为：修了什么 bug、做了什么决策、有什么模式"
  // 3. 写入 behavior.db 的 L2 Summary 层
  // 4. 检测重复模式（同一 app + 同一操作序列出现 ≥3 次）→ 蒸馏为 L3 Pattern
  // 5. 更新 last_consolidate 时间戳
}
```

**辅助模型**：用 `createSecondaryClient()`（已实现），flash 模型 + thinking 关闭——摘要/模式识别不需要深度推理。

---

## 6. 与现有系统的集成点

| 集成点                         | 方式                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| **session.ts activateSession** | 启动时异步触发 `consolidate()`（不阻塞对话）                 |
| **session.ts 会话结束**        | 提示 Agent 调 `remember` 写回本次会话摘要                    |
| **get_context 工具**（现有）   | 先查 L2/L3 派生记忆，再查 L1 原始帧（分层降级）              |
| **TDAM 对话记忆**（现有）      | 与行为记忆正交——对话说「说了什么」，行为记「做了什么」       |
| **openwiki 知识库**（现有）    | 与行为记忆正交——知识是「项目是什么」，行为是「我怎么操作它」 |

---

## 7. 实现计划

### Phase 1：存储 + 写入（1-2 天）

- 新增 `packages/core/src/activity-frames/behavior-db.ts`
  - `BehaviorDb` 类：打开/创建 `~/.deeporca/behavior.db`，建表 + FTS5 + 触发器
  - `addMemory(summary, layer, ...)` / `searchMemory(query)` / `forgetMemory(query)`
- 在 `mcp.ts` 注册 3 个新工具（search_behavior / remember / forget）

### Phase 2：检索 + 衰减（1 天）

- 实现 FTS5 BM25 + 时间衰减混合排序
- 给 `get_context` 工具加一层：先查 L2/L3，无果再查 L1

### Phase 3：离线整合（1-2 天）

- `consolidation.ts`：启动时检查 + 异步执行
- 用 `createSecondaryClient()` 生成日摘要
- 重复模式检测 → L3 蒸馏

### Phase 4：Agent 提示引导（半天）

- 在 session prompt 里加引导：「任务完成后调用 remember 写回关键决策」
- 在 `get_context` 返回里标注记忆来源层（L1/L2/L3），帮 Agent 判断可信度

---

## 8. 数据流示例

```
用户在 deepOrca 项目修了 Serena 弹窗 bug
  │
  ├─ L1 Trace（自动）：nocta-recorder 记录屏幕帧、VSCode 操作、git commit
  │
  ├─ 会话结束时：
  │    Agent 调 remember("修了 Serena 配置缺 projects 键导致弹窗的 bug，
  │                       根因是 ensureSerenaHeadlessHome 漏写 projects:[]，
  │                       改法是补键 + 存量文件升级保护",
  │                       layer="summary",
  │                       source_refs=["commit:6b42a6f", "session:sess_xxx"])
  │    → behavior.db L2 写入
  │
  ├─ 下次启动时 consolidation：
  │    检测到「修配置 bug → 补必需字段 → 加升级保护」这个模式出现 3 次
  │    → 蒸馏为 L3 Pattern："配置缺失类 bug 的修复模式：补字段+存量升级"
  │
  └─ 一周后用户遇到类似配置 bug：
       Agent 调 search_behavior("配置 缺失 bug")
       → 命中 L2 Summary（Serena 修复）+ L3 Pattern（通用修复模式）
       → 时间衰减后 L3 权重更高（模式比具体事件更持久）
       → Agent 直接套用「补字段 + 升级保护」模式
```

---

## 9. 与 MemOS 的对照（取舍说明）

| MemOS 特性                     | deepOrca 方案                                  | 取舍理由                                          |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------- |
| Memory³ 三态（明文/激活/参数） | 仅明文层（L1/L2/L3 都是文本）                  | 本地 Agent 无 GPU 训练管线，激活/参数层无落地条件 |
| Neo4j 图数据库                 | SQLite + JSON 数组                             | 零外部依赖原则；图查询用 SQL JOIN 替代            |
| 向量检索（Qdrant）             | FTS5 BM25 + 时间衰减                           | 零依赖；BM25 对行为摘要这种短文本足够好           |
| Redis 异步队列                 | 进程内 setTimeout + 节流                       | 本地单进程，无需分布式队列                        |
| MemScheduler 9 类任务          | 3 个操作（search/remember/forget）+ 1 个整合   | 覆盖 80% 场景的 20% 功能                          |
| mem_feedback 反馈闭环          | forget 工具（标记 archived + 降低 confidence） | 轻量版反馈：不修正内容，只降权/归档               |

**一句话**：取 MemOS 的**分层思想 + 检索衰减 + 写回闭环**，弃其**重基础设施**。用 SQLite + FTS5 实现 80% 的价值，投入只有 MemOS 的 5%。
