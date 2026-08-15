# Activity-Frames TypeScript 重写 — 设计方案

> 日期：2026-08-02 · 状态：已实现（2026-08-15 对账回写，见文末"实现状态对账"）
>
> 源项目：[nossa-y/activity-frames](https://github.com/nossa-y/activity-frames)（MIT，423 stars，Python ~2500 行零依赖）
>
> 重写理由：DeepOrca「零外部运行时依赖」原则要求 TS 原生实现，不走 Python 子进程。

---

## 〇、实现状态对账（2026-08-15 回写）

**定位重申**：行为记忆——给 **agent** 看的（消费者是机器），与任务轨迹（task-tree，给人看）是受众相反的两个产品。详见 `docs/research/2026-08-15-trajectory-design-exploration.md`。

与本文原设计的偏差（均已按实际落定）：

| 项                             | 原设计                               | 实际实现                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模块位置                       | `packages/core/src/activity-frames/` | `packages/desktop/src/main/tools/activity-frames/`（core 仅留 `mcp/activity-frames-seam.ts` 常量 + builder 注入——与 controller-seam 迁出方向一致，**原设计过时**）                                                                                                                                                                                                           |
| 管线                           | 单管线（屏幕行为）                   | **双管线**：A 屏幕行为（本文 §二-§五 原样）；B DeepOrca 自身活动画像（`collectors/`：session/shell/git/file → aggregator → `BehavioralProfile`，原设计未含）                                                                                                                                                                                                                 |
| MCP 工具                       | 6 个                                 | **9 个**：get_activity / day_summary / steps / patterns / communications / context + **get_hotspots / get_workflows / get_profile**（管线 B）                                                                                                                                                                                                                                |
| nocta-recorder                 | Phase 4 vendor                       | **决策：不 vendor**。管线 A 为"用户自装可选"（识别 `~/.deeporca/activity.db` 或 `~/.nocta/db.sqlite`），无 DB 时工具返回空/引导文案。桌面产品不捆绑屏幕捕获二进制                                                                                                                                                                                                            |
| enrich/steps/patterns 独立文件 | §二 架构图                           | 输入事件归并在 `frames.ts#attributeEvents`（纯函数）；patterns 并入 `mcp.ts` 的 SQL 查询；steps 未单独成文件                                                                                                                                                                                                                                                                 |
| 测试                           | Phase 5                              | **2026-08-15 补齐**（`desktop/src/tests/activity-frames-core.test.ts`，13 用例，fake-db 接缝——不依赖 node:sqlite）。该批次同时修复两个移植缺陷：①闪烁合并条件比较了错误的一侧（Pass 2 死代码，A→B→A 从不合并）；②Pass 1 断段判定用了"当前帧→下一帧"间隙（breakReason 误标 + 末帧总被甩成零活跃独立段）——现按本文 §5.1 语义修正（到当前帧的间隙判定断段，向后间隙只计 dwell） |

**待评估（不实施）**：BehavioralProfile 的 `formatContextBlock` 是否作为可选 boot context 注入（对齐 memory recall 的 prepend 模式）——token 成本 vs 背景收益的产品决策。

---

## 一、目标

将 activity-frames 的核心数据变换逻辑用 TypeScript 重写，作为 DeepOrca 内置 MCP server（InMemoryTransport），为 Agent 提供**行为记忆**能力。

**三层记忆体系定位**：

- TDAM（已集成）= 对话记忆，"用户说了什么"
- **activity-frames（本次）= 行为记忆，"用户做了什么"**
- openwiki（已集成）= 知识记忆，"项目是什么"

---

## 二、架构

```
nocta-recorder（原生 macOS 二进制，vendor 模式，同 codegraph/uv）
  ↓ 屏幕活动捕获 → SQLite DB（~/.deeporca/activity.db）
  ↓
DeepOrca activity-frames 模块（TypeScript，packages/core/src/activity-frames/）
  ├── db.ts           — node:sqlite 只读访问
  ├── sessionize.ts   — 活动分段（DWELL_CAP / SESSION_GAP / MERGE_FLICKER）
  ├── entities.ts     — 35+ 站点 URL 解析器（GitHub/Slack/Linear/Notion/...）
  ├── frames.ts       — ActivityDocument / ActivityFrame 编译器
  ├── enrich.ts       — 点击解析 + 输入事件归因
  ├── steps.ts        — 回放脚本生成
  ├── patterns.ts     — 行为模式识别（重复点击/URL 模式/操作序列）
  ├── time.ts         — DST 安全的时区工具
  ├── emit.ts         — 格式化输出（JSON/markdown/context block）
  └── mcp.ts          — InMemoryTransport MCP server（6 工具）
  ↓
Agent 通过 MCP 工具获得行为记忆
```

---

## 三、SQLite Schema

来源：`nocta-recorder` 写入，activity-frames 只读。Schema 对应原项目 `tests/conftest.py`。

```sql
-- 核心表：每次屏幕变化一行
CREATE TABLE frames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,       -- UTC ISO-8601
  app_name TEXT,
  window_name TEXT,
  focused INTEGER,               -- boolean
  browser_url TEXT,
  document_path TEXT,
  device_name TEXT DEFAULT 'monitor_1'
);

-- 可选：输入事件（编译器优雅降级）
CREATE TABLE ui_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,      -- click / key / text / clipboard / app_switch
  x INTEGER, y INTEGER,
  text_content TEXT,
  app_name TEXT, window_title TEXT, browser_url TEXT,
  element_name TEXT, element_role TEXT
);

-- 可选：无障碍元素（点击解析）
CREATE TABLE elements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  frame_id INTEGER NOT NULL,
  role TEXT DEFAULT 'AXButton',
  text TEXT,
  left_bound REAL, top_bound REAL, width_bound REAL, height_bound REAL  -- 归一化 0..1
);
```

---

## 四、6 个 MCP 工具

| 工具                 | 输入                                 | 输出                                        | 核心逻辑                            |
| -------------------- | ------------------------------------ | ------------------------------------------- | ----------------------------------- |
| `get_context`        | `hours` (默认 2)                     | 纯文本摘要                                  | 帧编译 → markdown context block     |
| `get_activity`       | `day` 或 `hours`                     | JSON ActivityDocument                       | 帧编译 → 结构化 frames              |
| `get_steps`          | `frame` (必填), `hours`, `max_steps` | JSON 回放脚本 `{task, steps[], step_count}` | 点击坐标 → 元素 hit-test → 有序步骤 |
| `get_day_summary`    | `day` (默认今天)                     | JSON `{coverage, apps[]}`                   | sessionize → 覆盖率 + 应用用量      |
| `get_patterns`       | `days` (默认 7)                      | JSON `[{kind, label, count}]`               | SQL GROUP BY + n-gram 挖掘          |
| `get_communications` | `hours` (默认 24), `kind`            | JSON 通信面列表                             | URL 解析 → 邮件/消息/通知分类       |

---

## 五、核心算法

### 5.1 Sessionize（活动分段）

确定性常量（SPEC.md 合约）：

- `DWELL_CAP = 90s` — 每帧活跃时间上限
- `SESSION_GAP = 300s` — 断帧间隙
- `MERGE_FLICKER = 20s` — A→B→A 闪烁合并阈值

**Pass 1（原始分段）**：按 `(app, domain)` 变化或 `gap > SESSION_GAP` 分段。

**Pass 2（闪烁合并）**：贪心——当 B 的跨度 ≤ 20s 且两侧无 session gap 时，A→B→A 合并为一个 A 段。B 记为 Interruption。

### 5.2 Entity Typing（站点解析器）

纯 URL 字符串解析，~35 个站点函数。解析顺序：

1. `new URL(url)` → host (strip www.) + path segments + query params
2. 查找 `_SITE_PARSERS[exact_host]` → `_SITE_PARSERS[apex_domain]`
3. 无匹配 → 搜索检测（`q`/`query`/`search_query` 参数）
4. 子域名/路径启发式（login/signin → sign_in，dashboard/admin → dashboard）
5. 兜底 → `kind="page"`, entity = 首段路径

### 5.3 Frame 编译

从分段 + 实体类型构建 `ActivityFrame`：

- `active_seconds` = Σ min(gap_to_next, DWELL_CAP) for gaps ≤ SESSION_GAP
- `pages[]` = 同段内的 URL → PageRef 列表
- `input` = 关联的 ui_events（bisect 最近帧分配，避免多显示器重复计数）
- `wall_min` 仅当 |wall - active| > 1min 时输出

---

## 六、重写风险与缓解

| 风险                | 严重度 | 缓解                                                                                                   |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| DST 时区计算        | ⚠️ 中  | `_time.py` 的 `local_day_window_utc` 需精确 DST 转换。TS 用 `Intl.DateTimeFormat({timeZone})` 或 luxon |
| `round()` 浮点格式  | 低     | Python `round(x, 1)` → TS `Math.round(x * 10) / 10`                                                    |
| bisect 最近帧分配   | 低     | Python `bisect.bisect_right` → TS 手写二分查找                                                         |
| nocta-recorder 平台 | 信息   | macOS 优先（同 codegraph/uv vendor 模式），Linux/Windows 后续                                          |

---

## 七、开发计划

### Phase 1：核心数据层（~1 天）

| 文件            | 内容                                                                         | 对应 Python 源           |
| --------------- | ---------------------------------------------------------------------------- | ------------------------ |
| `db.ts`         | node:sqlite 只读连接 + 表存在性检测                                          | `db.py` (92 行)          |
| `time.ts`       | DST 安全时区工具（`localDayWindowUtc` / `hoursAgoWindowUtc` / `fmtLocalHm`） | `_time.py` (82 行)       |
| `sessionize.ts` | RawFrame → Segment（dwell/gap/flicker merge）+ Coverage 计算                 | `sessionize.py` (367 行) |
| `frames.ts`     | ActivityDocument / ActivityFrame 数据模型 + `buildFrames()` 编译器           | `frames.py` (362 行)     |

**交付物**：能从 SQLite 读取原始帧 → 编译为 ActivityDocument JSON。

### Phase 2：实体识别 + 富化（~1 天）

| 文件          | 内容                                              | 对应 Python 源         |
| ------------- | ------------------------------------------------- | ---------------------- |
| `entities.ts` | 35+ 站点 URL 解析器 + 通用启发式 + 搜索检测       | `entities.py` (613 行) |
| `enrich.ts`   | ui_events 归因（bisect）+ 点击解析 + 键盘布局解码 | `enrich.py` (342 行)   |

**交付物**：URL → PageRef 解析正确，点击事件正确归因到帧。

### Phase 3：高级功能（~0.5 天）

| 文件          | 内容                                          | 对应 Python 源         |
| ------------- | --------------------------------------------- | ---------------------- |
| `steps.ts`    | 点击回放脚本生成（坐标 hit-test）             | `steps.py` (320 行)    |
| `patterns.ts` | 行为模式检测（SQL GROUP BY + n-gram）         | `patterns.py` (227 行) |
| `emit.ts`     | 格式化输出（JSON / markdown / context block） | `emit.py` (~200 行)    |

**交付物**：6 个 MCP 工具的核心逻辑全部完成。

### Phase 4：MCP 集成 + nocta-recorder vendor（~0.5 天）

| 文件                               | 内容                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- |
| `mcp.ts`                           | InMemoryTransport MCP server，注册 6 个工具                          |
| `session.ts` 集成                  | 在 session manager 中注册 activity-frames MCP server（同 a2ui 模式） |
| `scripts/vendor-nocta-recorder.js` | 下载 nocta-recorder 二进制（SHA-256 校验，macOS arm64/x64）          |
| `build.mjs`                        | 加入 vendor 调用                                                     |

**交付物**：Agent 可通过 MCP 工具查询行为记忆。

### Phase 5：测试 + 验证（~0.5 天）

- 单元测试：sessionize、entities、frames 核心逻辑（使用原项目 `tests/conftest.py` 的 fixture 数据作为 port-validation oracle）
- 端到端测试：MCP 工具调用 → 正确 JSON 输出
- typecheck + lint + format + build + tests 全绿

### 总工期：~3.5 天

---

## 八、不做的事

- **不移植 capture.py 的 nocta-recorder 下载逻辑到 TS** — vendor 脚本处理
- **不做 Linux/Windows 屏幕捕获** — nocta-recorder 是 macOS 二进制，其他平台后续
- **不做 OAuth App 连接** — 先做核心行为记忆
- **不做 Python → WASM** — TS 重写更干净
- **不引入 luxon/date-fns** — 先用 `Intl.DateTimeFormat`，如果 DST 测试失败再考虑
