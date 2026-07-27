# GitMCP 本地化独立模块 — 技术设计

## 1. 总体架构

```mermaid
graph LR
  subgraph desktop renderer
    GP[GitMcpPanel<br/>rail view "gitmcp"] --> API[window.deeporca]
    MP[PluginMcpPanel<br/>MCP 页签] --> API
  end
  subgraph desktop main
    API --> SB[SessionBridge<br/>gitmcp* IPC 方法]
    SB --> ST[settings mcpServers<br/>gitmcp:owner/repo]
    SB --> MM[core McpManager]
  end
  subgraph core 子进程 (stdio)
    MM -->|spawn| SV[gitmcp-server<br/>dist/gitmcp/server.js]
    SV --> DB[(~/.deeporca/gitmcp/index.db<br/>SQLite + FTS5)]
    SV --> GH[GitHub raw / API]
  end
```

三条原则：

1. **server 归 core**：`packages/core/src/gitmcp/` 下实现，随 core 构建产出独立入口
   `dist/gitmcp/server.js`，CLI 与 desktop 共用；core 保持 UI-free。
2. **配置即状态**：仓库列表不另设注册表——`settings.mcpServers` 中 `gitmcp:` 前缀条目
   就是仓库清单（单一事实来源），启停复用现有 disable sidecar。
3. **激活复用现有链路**：添加/删除仓库 = `pluginUpsertMcpServer`/`pluginRemoveMcpServer`
   的 gitmcp 特化封装，连接、状态轮询、提示词工具注入全部免费获得。

## 2. core：gitmcp 本地 server

### 2.1 目录与文件

```
packages/core/src/gitmcp/
├── server.ts        # 入口：stdio JSON-RPC 循环（initialize/tools list+call），argv: <owner/repo>
├── rpc.ts           # 极简 MCP stdio 协议实现（Content-Length 无关，按行 JSON-RPC，与 McpClient 对齐）
├── tools.ts         # 4 个工具的 schema 与 handler 分发
├── github.ts        # GitHub 抓取：raw 文档（llms.txt→llms-full.txt→README.md）、code search API、URL 抓取
├── indexer.ts       # markdown 按标题分块（500–1500 字符）、入库、重建
├── store.ts         # SQLite 持久层：node:sqlite + FTS5；SearchBackend 抽象接口（向量化预留）
└── resolve.ts       # 仓库标识解析/归一化 + buildGitmcpMcpServerConfig()（executor 解析仿 codegraph）
```

协议实现说明：现有 `McpClient` 用 newline-delimited JSON-RPC over stdio（与 codegraph server 相同），
`rpc.ts` 手写 ~100 行即可，不引入 `@modelcontextprotocol/sdk`（避免新依赖与打包复杂度）。
需实现方法：`initialize`、`notifications/initialized`、`tools/list`、`tools/call`、`ping`。

### 2.2 工具定义（对齐上游 git-mcp 语义，固定命名不带 repo 后缀）

| 工具 | 参数 | 行为 |
|---|---|---|
| `fetch_documentation` | – | 拉取 `llms.txt` → `llms-full.txt` → `README.md`（HEAD/main/master 分支探测），返回全文并 upsert 入库；断网时返回缓存 + `cached_at` |
| `search_documentation` | `query` | FTS5 `bm25()` 排序检索本仓库分块，返回 top-8（含标题路径、分块内容）；库为空则先自动 fetch 入库 |
| `search_code` | `query`, `page?` | `GET api.github.com/search/code?q={query}+repo:{owner}/{repo}`；有 `GITHUB_TOKEN` 则带 Authorization |
| `fetch_url_content` | `url` | 抓取 URL，`text/html` 用内置正则/启发式剥离为纯文本（不引 html-to-md 依赖），限制 100KB |

server 由 argv 绑定单仓库（`server.js vegamo/deeporca`），工具名固定——AI 通过 server 名
`gitmcp:{owner}/{repo}` 区分仓库，避免上游动态工具名带来的复杂性。

### 2.3 索引库 schema（`~/.deeporca/gitmcp/index.db`，单库多仓库）

```sql
CREATE TABLE repos (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,          -- "owner/repo"
  doc_source TEXT,                    -- llms.txt | llms-full.txt | readme
  fetched_at INTEGER,                 -- unix ms
  chunk_count INTEGER DEFAULT 0
);
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  heading TEXT,                       -- "Install > macOS" 标题路径
  content TEXT NOT NULL,
  embedding BLOB                      -- 预留：sqlite-vec 向量（本期恒 NULL）
);
CREATE VIRTUAL TABLE chunks_fts USING fts5(heading, content, content=chunks, content_rowid=id);
```

`store.ts` 暴露 `SearchBackend` 接口（`index(chunks)` / `search(query, limit)`），本期唯一实现
`Fts5Backend`；下期新增 `VecBackend`（加载 sqlite-vec 扩展 + embedding 来源）时上层零改动。

### 2.4 配置生成与构建

- `resolve.ts` 提供：
  - `parseRepoSlug(input): string | null` — 归一化 R1/R4 的三种输入形态
  - `GITMCP_SERVER_PREFIX = "gitmcp:"`、`isGitmcpServerName(name)`
  - `buildGitmcpMcpServerConfig(slug): McpServerConfig` — executor 解析仿照 codegraph 的
    `resolveSqliteCapableNode()` 三级策略（自身 Node → 系统 sqlite-capable Node → 报错，无 npx 回退），
    args 为 `[<core dist>/gitmcp/server.js, slug]`
- 构建：`scripts/esbuild.config.js` 增加 entry `core/src/gitmcp/server.ts → dist/gitmcp/server.js`
  （独立 bundle，零外部依赖）；desktop 打包经由现有 core dist 复制流程带上
- core `index.ts` 导出 `parseRepoSlug` / `isGitmcpServerName` / `buildGitmcpMcpServerConfig` /
  `GITMCP_SERVER_PREFIX` / `removeGitmcpRepoIndex(slug)`（删除索引数据用）

## 3. desktop：GitMCP 边缘模块

### 3.1 IPC 契约（`shared/ipc.ts`）

```ts
/** GitMCP 面板单条仓库条目（由 mcpServers 的 gitmcp: 条目派生） */
export type GitmcpRepoEntry = {
  slug: string;              // "owner/repo"
  serverName: string;        // "gitmcp:owner/repo"
  enabled: boolean;
  status?: McpServerStatus;  // 运行状态（复用）
  indexed: boolean;          // 索引库中是否有分块
  chunkCount: number;
  fetchedAt?: number;
};

// IpcRequest 新增：
GitmcpList        → GitmcpRepoEntry[]
GitmcpAdd(input)  → { ok: boolean; slug?: string; error?: "invalid" | "exists" }
GitmcpRemove(slug)→ void        // 移除 mcpServers 条目 + 删除索引数据
GitmcpReindex(slug)→ { ok: boolean; error?: string }   // 触发重建（经 server 或直接调 core indexer）
// 启停直接复用 PluginSetMcpEnabled(serverName, enabled)
```

### 3.2 main 进程（session-bridge.ts）

- `gitmcpList()`：读 `resolveCurrentSettings().mcpServers` 过滤 `gitmcp:` 前缀 + disable sidecar +
  `manager.getMcpStatus()` + core 索引库元数据（`repos` 表）合成 `GitmcpRepoEntry[]`
- `gitmcpAdd(input)`：`parseRepoSlug` 校验（R4）→ 查重（R5）→ 写用户级 settings（R2，
  gitmcp 条目统一落**用户级** `~/.deeporca/settings.json`，因索引库本就跨项目共享）→ reload 连接
- `gitmcpRemove(slug)`：复用 `pluginRemoveMcpServer("gitmcp:"+slug)` 逻辑 + `removeGitmcpRepoIndex(slug)`（R7）
- `gitmcpReindex(slug)`：调 core 的 indexer 直接重建（不经 MCP 调用，避免依赖 server 存活）（R8）
- `pluginMcpList()` 一处修改：`builtin: name === CODEGRAPH_MCP_SERVER_NAME || isGitmcpServerName(name)`（R9，
  复用现有 builtin=不可删语义）

### 3.3 renderer

- `App.tsx`：`selectView` 联合类型 + Rail 增加 `"gitmcp"` view（位置在 review 旁），新图标 `IconGitmcp`
- 新组件 `components/GitMcpPanel.tsx`：
  - 顶部输入框 + 添加按钮（回车提交；错误态提示 invalid/exists）
  - 列表项：slug、StatusDot 运行状态、索引信息（`chunkCount` / `fetchedAt` 相对时间）、
    Switch 启停、重建索引按钮、删除按钮（带确认）
  - 复用 `ui/index` 原语（Button/Input/Switch/StatusDot），双主题自动适配
- `PluginMcpPanel.tsx`：`MCP_PRESETS` 移除上一轮加的 `gitmcp` mcp-remote 预置（被本模块取代）；
  gitmcp 条目显示时标注来源（名称已带前缀，删除按钮因 builtin 隐藏）
- i18n：`rail.gitmcp`、`gitmcp.title`、`gitmcp.placeholder`、`gitmcp.add`、`gitmcp.invalid`、
  `gitmcp.exists`、`gitmcp.reindex`、`gitmcp.delete`、`gitmcp.indexed`、`gitmcp.notIndexed`
  等键 × 6 套字典；`builtin.git-mcp.desc` 更新为本地版描述

## 4. 内置插件文档改写

`templates/plugins/git-mcp/PLUGIN.md` + `PLUGIN.zh.md`：删除 mcp-remote/gitmcp.io 注册章节，
改为：工具四件套说明（固定名）、server 命名规则 `gitmcp:{owner}/{repo}`、
引导用户在桌面端 GitMCP 模块添加仓库（CLI 用户给出 `buildGitmcpMcpServerConfig` 等效的 JSON 配置示例）、
何时使用/不使用保持不变（R17）。

## 5. 关键权衡记录

| 决策 | 备选 | 理由 |
|---|---|---|
| 自研 server 而非 vendor 上游 | vendor idosal/git-mcp | 上游是 Cloudflare Workers 应用（wrangler/@remix-run/cloudflare/agents），无 stdio 模式，移植成本 >> 自研 4 个工具 |
| 手写 stdio JSON-RPC | @modelcontextprotocol/sdk | 现有 McpClient 协议面很小（5 个方法），手写 ~100 行，避免新依赖进 core |
| FTS5 BM25 首版 | sqlite-vec 向量 | 用户已拍板；SearchBackend 接口预留，embedding BLOB 列已建 |
| 单库多仓库（index.db） | 每仓库一个 db 文件 | 元数据查询（面板列表）一次搞定；FTS5 按 repo_id 过滤零成本 |
| 配置即状态（无独立注册表） | gitmcp.json 注册表 | 消灭双源同步 bug；启停/状态/激活全部复用现有 MCP 链路 |
| server 绑定单仓库（argv） | 一个 server 服务全部仓库 | 与"每仓库独立启停/删除"的产品语义一致；进程隔离，面板状态即 server 状态 |
| 索引/配置落用户级 | 项目级 settings | 外部仓库文档与项目无关，跨项目复用索引 |

## 6. 测试策略

- core 单测（`packages/core/src/tests/gitmcp.test.ts`）：
  - `parseRepoSlug` 三种形态 + 非法输入
  - `indexer` 分块（标题层级、长度边界）
  - `store` FTS5 入库/检索/删除/重建（临时 HOME）
  - `rpc` 协议握手 + tools/list + tools/call（spawn 真实 server 子进程，github.ts 以注入 fetch stub）
- desktop 手测清单：添加(合法/非法/重复) → 面板启停/重建/删除 → MCP 页签验证不可删可启停 →
  会话中 AI 调用 `search_documentation` 走通 → 断网检索已索引仓库
- 回归：`npm run typecheck && npm run lint && npm test`；`session.test.ts` 既有 1 失败为分支既有问题（bundled flutter skills），与本特性无关

## 7. 里程碑划分

- M1：core server + 索引库 + 构建产物（可用 CLI 手工配置验证）
- M2：desktop GitMCP 模块 + MCP 页签权限 + i18n
- M3：内置插件文档改写 + 回归验证
