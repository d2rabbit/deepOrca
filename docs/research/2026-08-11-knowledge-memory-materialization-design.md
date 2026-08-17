# 索引与知识 + 记忆模块具现化设计方案

> **日期**：2026-08-11
> **状态**：已实施（2026-08-13 落地，见下方状态回写）
> **背景**：当前"知识源"只是系统提示词中的 5 行文字，零功能化。索引面板只有 1 个按钮 + 1 个绿点。记忆模块完全不可见。

> **状态回写（2026-08-17）**：本方案 4 项改造已于 2026-08-13 全部实施（提交 `3073cd0`）；随后补全设计文档 3 个遗漏项（`a844060`：清除/文案/embedding）并落地审计修复（`0b5a4bc`：L2 目录名 + 过时注释 + memory 单位）。消费台账见 [README.md](./README.md)；以下正文保留原设计表述，未随实施回改。

---

## 第一部分：现状诊断（codebase-design 词汇）

### Module: IndexLibraryPanel — 浅模块

| 维度 | 现状 | 问题 |
|---|---|---|
| **Interface** | 1 个按钮 + 1 个状态点 + 1 个进度条 | `index.build-all` 返回结构化 `stages[]` 但被完全丢弃 |
| **Depth** | 浅 | 面板接口宽度（1 个绿点）≈ 用户可获得的信息量 |
| **Seam** | `api.codegraphList()` + `api.wikiCheckAvailable()` + `api.wikiListPages()` | 仅查 2 个源；Serena / AGENTS.md / Memory 完全不查 |
| **Delete test** | 删掉面板 → 初始构建无法触发（auto-sync 只做增量） | 初始构建触发器是真实价值，但仅此而已 |

**关键代码位置**：
- `packages/desktop/src/renderer/components/IndexLibraryPanel.tsx:20-30`（state）
- `:40-55`（reload — 3 个 IPC 并行）
- `:119`（`indexReady = cgInitialized && (!wikiAvailable || wikiExists)`）
- `:140-142`（唯一的状态点）
- `:158-165`（唯一的按钮）

**过时注释**：`:9-11` 声称 "auto-syncs via file watcher + post-turn hook"，但**没有 file watcher**（`SdkCodegraphController` 只有 `reindex`/`sync`/`getMcpServer`）。

### Module: Memory — 深管线，零接口

| 维度 | 现状 | 问题 |
|---|---|---|
| **Interface** | 2 个 IPC（`memory:checkAvailable` / `memory:setEnabled`） | `MemoryManager.searchMemories()` 已实现但**零 IPC 暴露** |
| **Depth** | 管线极深（L0-L3，TdaiCore 17k LOC），用户接口为零 | 读写全自动，用户看不到记忆了什么、无法搜索、无法修正、无法遗忘 |
| **Delete test** | 删掉 Memory UI → 仅丢失一个 enable 开关 | 开关是唯一价值 |

**关键代码位置**：
- `packages/desktop/src/shared/ipc.ts:141-142`（仅 2 个 memory 通道）
- `packages/desktop/src/main/index.ts:882-900`（`registerMemoryIpc` — 仅 2 个 handler）
- `packages/memory/src/memory-manager.ts:118-127`（`searchMemories` 已实现，不可达）
- `packages/desktop/src/renderer/components/SettingsPanel.tsx:858-860`（**死代码**："Gateway port" 8420 是旧 HTTP 侧边车遗物，memory 已改为进程内）
- `packages/core/src/session.ts:2487-2502`（recall 注入，2 秒竞速，超时静默丢弃）

### Module: System Prompt — 知识源碎片化

5 个知识源中**只有 3 个**在提示词中提及。`<memory-context>` 被注入但 Agent 从未被告知它存在。

| 知识源 | 面板可见？ | 提示词提及？ | Agent 可查？ | 用户可管？ |
|---|---|---|---|---|
| CodeGraph `.codegraph/` | ✅ 1 个绿点 | ⚠️ 仅在工具选择部分 | ✅ MCP 工具 | ❌ 无法单独重建 |
| OpenWiki `openwiki/` | ✅ 同上 | ✅ | ✅ `wiki.read-page` | ❌ 无法单独更新 |
| Serena `.serena/memories/` | ❌ | ✅ | ⚠️ 目录当前为空 | ❌ |
| AGENTS.md | ❌ | ✅ | ✅ 自动加载 | ✅ 手编 |
| DeepOrca `<memory-context>` | ❌ | ❌ **从未提及** | ❌ | ❌ |

**关键代码位置**：`packages/core/src/prompt.ts:352-357`（"项目知识源"段，仅 3 个源）

---

## 第二部分：四个改造方向

### 改造 1：Prompt 知识源统一（P0 — 最小改动，最大收益）

**目标**：从 3 个源扩展为 6 个，明确告诉 Agent `<memory-context>` 的存在。

**改 `packages/core/src/prompt.ts` 的 "项目知识源" 段**（当前 L352-357）：

```markdown
## 知识源（你拥有的全部信息渠道）

DeepOrca 为你提供以下知识来源，按需利用：

1. **`<memory-context>`（跨会话记忆）** — 系统自动注入的用户偏好、历史事实、
   场景记忆。你不需要主动查询——它在会话开始时已包含在上下文中。

2. **CodeGraph 图谱工具** — 通过 MCP 工具查询项目符号调用关系
   （`codegraph_search` / `codegraph_impact` / `codegraph_callers`）

3. **Serena 语义工具** — 通过 MCP 工具进行 LSP 级符号操作
   （`find_symbol` / `rename_symbol` / `replace_symbol_body`）

4. **`openwiki/` 目录** — 结构化项目文档（architecture.md、modules/*.md、
   workflows/*.md），用 `read` 工具查看

5. **`.serena/memories/` 目录** — Serena 项目记忆（架构理解、模块依赖、
   构建方式），Markdown 格式，可提交 Git，用 `read` 工具查看

6. **AGENTS.md** — 项目编码指南和架构约束（已自动加载到上下文）

### 查询路由
- "这个项目的架构是怎样的？" → 读 `openwiki/architecture.md`
- "这个函数被谁调用？" → 用 `codegraph_callers`
- "这个符号在哪定义？" → 用 Serena `find_symbol`
- "用户之前说过什么偏好？" → 已在 `<memory-context>` 中，直接使用
```

**工作量**：小（单文件，~30 行）
**收益**：Agent 立即知道它有 6 个知识渠道，包括之前完全不知道的 `<memory-context>`

---

### 改造 2：IndexLibraryPanel → 多源知识仪表盘（P1 — 核心改造）

**目标**：深化模块——从 1 个绿点变为多源状态卡片，暴露 `stages[]` 结构。

#### 2.1 新增 IPC：`KnowledgeStatus`

```ts
// packages/desktop/src/shared/ipc.ts
KnowledgeStatus: "knowledge:status"

export type KnowledgeSourceStatus = {
  /** 已索引 / 空 / 未启用 / 过期 */
  state: "indexed" | "empty" | "disabled" | "stale";
  /** 内容统计（符号数 / 页面数 / 记忆条数 / 行数） */
  count?: number;
  /** 统计单位标签（"符号" / "页" / "条" / "行"） */
  unit?: string;
  /** 最后同步时间（ISO 字符串） */
  lastSync?: string;
  /** 补充信息（如 "arch+modules" / ".serena/"） */
  detail?: string;
};

export type KnowledgeStatusResponse = {
  codegraph: KnowledgeSourceStatus;
  openwiki: KnowledgeSourceStatus;
  serena: KnowledgeSourceStatus;
  agents: KnowledgeSourceStatus;
  memory: KnowledgeSourceStatus & {
    stats?: { l0: number; l1: number; l2: number; l3: boolean };
  };
};
```

#### 2.2 main handler（`packages/desktop/src/main/index.ts`）

聚合 5 个源的状态：
- **codegraph**：`existsSync(root/.codegraph)` + `getCodegraphController()?.hasProject(root)` + 符号数（从 SQLite 查）
- **openwiki**：`existsSync(root/openwiki)` + 页面数（`readdirSync` 计数）
- **serena**：MCP 连接状态 + `.serena/memories/` 文件数
- **agents**：`existsSync(root/AGENTS.md)` + 行数
- **memory**：`memoryManager?.isAvailable()` + L0-L3 统计（需要 `MemoryManager` 新增 `getStats()`）

#### 2.3 面板布局

```
┌─ 知识库 ──────────────────────────────────────────┐
│ [🚀 全部构建]  [⟳ 刷新]         上次同步: 2分钟前  │
│                                                   │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│ │📊CodeGraph│ │📚OpenWiki│ │🧠记忆    │           │
│ │✅ 已索引  │ │✅ 12页   │ │⚫ 未启用  │           │
│ │1,247符号 │ │arch+mods │ │          │           │
│ │[重建]    │ │[更新]    │ │[启用]    │           │
│ └──────────┘ └──────────┘ └──────────┘           │
│ ┌──────────┐ ┌──────────┐                       │
│ │🔍Serena  │ │📋AGENTS  │                       │
│ │⚪ 无记忆 │ │✅ 存在   │                       │
│ │.serena/  │ │2,847行   │                       │
│ └──────────┘ └──────────┘                       │
└───────────────────────────────────────────────────┘
```

**每个卡片**：
- 状态指示：✅ 已索引 / ⚪ 空 / ⚫ 未启用 / ⚠️ 过期
- 内容统计 + 单位
- 单独操作按钮（重建 / 更新 / 启用 / 查看）
- 新鲜度文本（"2分钟前同步" / "⚠️ 可能过期"）

#### 2.4 新鲜度追踪

在 core 中记录两个时间戳：
- `recordFileMutationCheckpoint` 中记录 `lastMutationTime`（每个源共用）
- `maybeSyncCodegraphIndex` / `maybeSyncWikiIndex` / `maybeSyncCrgIndex` 中记录各自的 `lastSyncTime`

UI 比较：`lastMutationTime > lastSyncTime` → 显示 "⚠️ 可能过期"

**新增 core API**：
```ts
// packages/core/src/session.ts
getKnowledgeFreshness(): {
  lastMutation?: string;
  codegraphSync?: string;
  wikiSync?: string;
  crgSync?: string;
};
```

#### 2.5 单源操作

每个卡片的按钮触发单源 action（而非全量 `index.build-all`）：
- CodeGraph [重建] → `api.actionRun("codegraph.reindex")`
- OpenWiki [更新] → `api.actionRun("wiki.update")`
- 记忆 [启用] → `api.memorySetEnabled(true)`
- Serena / AGENTS [查看] → 打开文件浏览器或注入 read 提示

**工作量**：中（新 IPC + main handler + 面板重写 + i18n）
**收益**：用户第一次能看到 5 个知识源的完整状态和新鲜度

---

### 改造 3：Memory 可见化（P2）

**目标**：利用已实现的 `searchMemories()`，补齐 IPC + UI。

#### 3.1 新增 IPC

```ts
// packages/desktop/src/shared/ipc.ts
MemorySearch: "memory:search"
MemoryStats: "memory:stats"
```

#### 3.2 main handler

```ts
// packages/desktop/src/main/index.ts registerMemoryIpc
handle(IpcRequest.MemorySearch, async (_e, query: string, limit?: number) => {
  if (!memoryManager) return { text: "", total: 0 };
  return (await memoryManager.searchMemories(query, limit ?? 5)) ?? { text: "", total: 0 };
});

handle(IpcRequest.MemoryStats, async () => {
  if (!memoryManager) return null;
  return memoryManager.getStats();  // 需要 MemoryManager 新增此方法
});
```

#### 3.3 `MemoryManager.getStats()`（新增）

```ts
// packages/memory/src/memory-manager.ts
async getStats(): Promise<{ l0: number; l1: number; l2: number; l3: boolean } | null> {
  if (!this.initialized || !this.core) return null;
  // 从 TdaiCore 的 store 查询各层计数
  // L0: 原始对话数 / L1: 原子事实数 / L2: 场景片段数 / L3: 用户画像是否已生成
}
```

#### 3.4 UI（在知识仪表盘的记忆卡片中展开）

```
🧠 记忆
├── L0 原始对话: 142 条
├── L1 原子事实: 37 条
├── L2 场景片段: 8 条
├── L3 用户画像: 已生成
├── [🔍 搜索记忆...]      ← 输入框 + 结果列表
└── [🗑 清除项目记忆]     ← 危险操作，需二次确认
```

#### 3.5 清理死代码

- **删除** `SettingsPanel.tsx:858-860` 的 "Gateway port" 输入框（`MEMORY_PORT = 8420` 是旧 HTTP 侧边车遗物）
- **更新 i18n**：`messages.ts:345-347` "Memory gateway" → "记忆系统"
- **删除** `SettingsPanel.tsx:67` 的 `MEMORY_PORT` 常量

#### 3.6 embedding 配置暴露（可选）

当前 `settings.memory.embedding === "local-onnx"` 被 `startMemory()` 读取（`index.ts:477`），但：
- 不在 `EditableSettings` 类型中
- 无默认值
- **无 UI 控件**

结果：通过 UI 配置时 embedding 永远是 `none`，Granite 向量召回不可达。

**方案**：在 `EditableSettings.memory` 中增加 `embedding: "none" | "local-onnx"`，SettingsPanel 增加一个下拉框。

**工作量**：中
**收益**：用户能看到记忆了什么、能搜索、能清除；Granite 向量召回可达

---

### 改造 4：arch-scan 增强（P3）

#### 4.1 索引消费（已部分完成）

`SKILL.md` 的 Step 1 已改写为优先消费索引（**已修改未提交**）：

```
知识获取优先级：
1. OpenWiki 文档（openwiki/architecture.md, modules/*.md）— 最高效
2. CodeGraph 图谱（codegraph_explore / callers / callees / impact）— 调用关系
3. Serena 符号结构（get_symbols_overview / find_symbol）— 模块大纲
4. 原始文件读取 — 仅补充索引未覆盖的细节
```

#### 4.2 融入 diagram-design 方法论（待实施）

来源：[diagram-design](https://github.com/cathrynlavery/diagram-design)（MIT，Cathryn Lavery）

**新增"设计原则"段**（Step 0 之后）：

```markdown
## 设计原则（编辑级质量纪律）

> 以下原则采纳自 diagram-design（MIT，Cathryn Lavery）。

### 密度目标 4/10
"最高质量的操作通常是删除。" 每个节点都要有存在的理由。

### 复杂度预算（硬约束）
- 单图最多 **9 个节点**
- 单图最多 **12 条边**
- 最多 **2 个强调元素**（focal elements）
- 超出预算 → 递归下钻，不要在一张图里塞 30 个节点

### 删除测试（成稿前必做）
自问：能合并或删除任何节点/边/标签吗？如果能，就删。

### 强调色纪律
1 个强调色，1-2 个焦点元素。第二个强调色会抹除焦点信号。

### 何时不画图
如果一段好文字比这张图传达更多信息，就写文字。不要为"列表"、
"前后对比"、"单一概念"画图。
```

**新增"视角→图表类型映射"表**（Step 3 增强）：

当前问题：所有视角都用同一种 A2UI `graph`（节点+边），不管视角语义。

```markdown
### 视角 → 最优图表类型

采纳 diagram-design 的"先选语义模式，再选视觉类型"方法论：

| 视角 | 语义 | A2UI 组件 | 理由 |
|---|---|---|---|
| `overall-architecture` | 模块 + 连接 | `graph` (LR) | 网状关系 |
| `data-flow` | 有向管道 | `column` 流式卡片 | 线性流动 |
| `dependency-map` | 层级依赖 | `graph` (TD) | 树状结构 |
| `request-lifecycle` | 时序步骤 | `list` 编号 | 顺序执行 |
| `state-transitions` | 状态机 | `graph` + 转换标注 | 状态 + 触发条件 |
| `external-integrations` | 信任边界 | `graph` + 外部节点分组 | 内外区分 |
| `storage` | 分层存储 | `column` 堆叠卡片 | 层次结构 |
| `command-surface` | 命令树 | `tree` 或 `graph` (TD) | 层级分发 |
| `extension-points` | 注册表 | `list` + `card` | 枚举式 |

不要所有视角都用 `graph`——选择最贴合语义的组件类型。
```

**更新致谢块**：

```markdown
> **Editorial design discipline**: The density target (4/10), complexity budgets
> (max 9 nodes), remove test, accent-color discipline, and the "semantic pattern
> first, visual type second" routing methodology are adopted from
> [diagram-design](https://github.com/cathrynlavery/diagram-design) (MIT, by
> Cathryn Lavery). DeepOrca adapts these editorial principles to A2UI component
> trees instead of self-contained HTML/SVG files.
```

#### 4.3 清理过时内容（已修改未提交）

- `arch-scan.ts:49-55` — 删除 "§十 Subagent (P2) not yet wired" 注释（`runSubagent` 已注入）
- `index-build.ts:89-100` — 更新 skip 消息，删除 "§十 Subagent pending"
- `IndexLibraryPanel.tsx:9-11` — 删除 "file watcher" 虚假声称

**工作量**：小（单文件 SKILL.md + 2 个清理）
**收益**：架构图质量显著提升（不再是 30 节点的意面图）；正确复用索引

---

## 第三部分：执行顺序与工作量

| 顺序 | 改造 | 工作量 | 收益 | 文件数 |
|---|---|---|---|---|
| 1 | 改造 1：Prompt 知识源统一 | 小 | 高 | 1 |
| 2 | 改造 4：arch-scan 增强 + 清理 | 小 | 高 | 3 |
| 3 | 改造 3：Memory 可见化 + 清理死代码 | 中 | 中 | 6 |
| 4 | 改造 2：多源知识仪表盘 | 大 | 高 | 8 |

### 文件变动总览

| 文件 | 改造 | 变更 |
|---|---|---|
| `core/prompt.ts` | 1 | 重写"项目知识源"段（3→6 源，含 memory-context + 查询路由） |
| `core/templates/.../arch-scan/SKILL.md` | 4 | 设计原则段 + 视角→类型映射 + diagram-design 致谢 |
| `core/actions/arch-scan.ts` | 4 | 清理过时 skip 消息 ⚠️ 已修改未提交 |
| `core/actions/index-build.ts` | 4 | 清理过时注释 ⚠️ 已修改未提交 |
| `desktop/shared/ipc.ts` | 2+3 | 新增 KnowledgeStatus + MemorySearch + MemoryStats |
| `desktop/main/index.ts` | 2+3 | 新增 knowledge:status + memory:search/stats handler |
| `desktop/preload/index.ts` | 2+3 | 暴露新 IPC API |
| `desktop/components/IndexLibraryPanel.tsx` | 2+3 | 重写为多源仪表盘 |
| `desktop/components/SettingsPanel.tsx` | 3 | 删除死 Gateway port + 增加 embedding 下拉 |
| `desktop/i18n/messages.ts` + 4 locale | 2+3 | 新增知识面板 i18n keys |
| `memory/src/memory-manager.ts` | 3 | 新增 getStats() |
| `core/src/session.ts` | 2 | 新增 getKnowledgeFreshness() + 时间戳记录 |

---

## 第四部分：不改动

- `@deeporca/memory` 包内部 L0-L3 管线逻辑
- Memory 的自动 capture/recall 机制（`session.ts:2487-2502` / `:3478-3528` 已正常工作）
- CodeGraph / OpenWiki / Serena / CRG / OCR 的 controller-seam 架构
- `index.build-all` action 的三阶段编排逻辑
- A2UI 渲染器（已支持 graph / column / list / card 组件类型）
- Serena 的 stdio 传输方式

---

## 附录：致谢

| 方法论 | 来源 | 采纳内容 |
|---|---|---|
| 视角目录 + 递归下钻 | [oh-my-mermaid](https://github.com/oh-my-mermaid/oh-my-mermaid) | 12 视角 catalog、递归元素分析 |
| 编辑设计纪律 | [diagram-design](https://github.com/cathrynlavery/diagram-design)（MIT, Cathryn Lavery） | 密度 4/10、复杂度预算（9 节点/12 边）、删除测试、强调色纪律、"先语义模式后视觉类型"路由、"何时不画图"判断 |
| 记忆管线 L0-L3 | TDAI Core（MIT，vendored） | 原始对话→原子事实→场景片段→用户画像 |
| 符号级语义操作 | [Serena](https://github.com/oraios/serena) | SolidLSP 40+ 语言符号检索/编辑/重构 |
