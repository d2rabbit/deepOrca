# GitMCP 本地化独立模块 — 实施计划

## M1 core：本地 server 与索引库

- [x] 1. 仓库标识解析与配置生成（`packages/core/src/gitmcp/resolve.ts`）
  - `parseRepoSlug()` 支持完整 URL / 无协议 / `owner/repo` 三种输入，非法返回 null
  - `GITMCP_SERVER_PREFIX` / `isGitmcpServerName()` / `buildGitmcpMcpServerConfig()`（executor 三级解析仿 codegraph）
  - core `index.ts` 导出上述符号
  - _Requirement: R1, R4, R15_

- [x] 2. SQLite 索引库（`store.ts`）
  - `~/.deepcode/gitmcp/index.db` 建库建表（repos/chunks/chunks_fts，含 embedding BLOB 预留列）
  - `SearchBackend` 抽象接口 + `Fts5Backend` 实现（bm25 排序、repo_id 过滤）
  - `removeGitmcpRepoIndex(slug)` 删除仓库全部索引数据并导出
  - _Requirement: R16, R7_

- [x] 3. 文档抓取与分块入库（`github.ts` + `indexer.ts`）
  - raw 文档拉取：`llms.txt → llms-full.txt → README.md`，HEAD/main/master 分支探测
  - GitHub code search API 封装（可选 `GITHUB_TOKEN`）；URL 抓取 + HTML→纯文本剥离（100KB 上限）
  - markdown 按标题层级分块（500–1500 字符）入库；重建 = 清空后重拉
  - _Requirement: R10, R12, R13, R8_

- [x] 4. stdio MCP server（`rpc.ts` + `tools.ts` + `server.ts`）
  - 手写 newline JSON-RPC：`initialize` / `notifications/initialized` / `tools/list` / `tools/call` / `ping`
  - 4 个工具接线：fetch_documentation（断网回缓存+cached_at）、search_documentation（未索引先自动入库）、
    search_code、fetch_url_content
  - argv 绑定单仓库；异常均返回结构化 JSON-RPC error，不崩进程
  - _Requirement: R10–R15_

- [x] 5. 构建产物接入
  - `scripts/esbuild.config.js` 新增 entry → `dist/gitmcp/server.js`（独立零依赖 bundle）
  - 确认 CLI 打包（prepare-package files 列表）与 desktop 复制流程包含该产物
  - _Requirement: R15_

- [x] 6. core 单测（`packages/core/src/tests/gitmcp.test.ts`）
  - parseRepoSlug 全形态；indexer 分块边界；store 入库/检索/删除/重建（临时 HOME）
  - spawn 真实 server 走一遍握手 + tools/list + tools/call（fetch 打桩）
  - _Requirement: R1, R4, R8, R10, R11, R16_

## M2 desktop：GitMCP 边缘模块

- [x] 7. IPC 契约与主进程实现
  - `shared/ipc.ts`：`GitmcpRepoEntry` 类型 + `GitmcpList/Add/Remove/Reindex` 四个 request + preload 接线
  - `session-bridge.ts`：`gitmcpList/Add/Remove/Reindex` 四方法（Add 写用户级 settings、查重、reload；
    Remove 同步删索引；Reindex 直调 core indexer）
  - `main/index.ts` 注册 4 个 handler
  - _Requirement: R2, R4, R5, R7, R8_

- [x] 8. MCP 页签删除权限限制
  - `session-bridge.ts` `pluginMcpList()`：gitmcp 前缀条目 `builtin: true`
  - `PluginMcpPanel.tsx`：移除上一轮的 `gitmcp` mcp-remote 预置模板
  - 验证 codegraph 行为不回归
  - _Requirement: R9, R18_

- [x] 9. GitMCP 面板（`components/GitMcpPanel.tsx` + `App.tsx`）
  - Rail 新增 `gitmcp` view + `IconGitmcp` 图标（review 旁）
  - 面板：地址输入 + 添加（invalid/exists 错误态）、仓库列表（StatusDot/分块数/更新时间/
    Switch 启停/重建/删除确认）
  - 首次索引进度反馈（添加后轮询 GitmcpList 直至 indexed 或失败）
  - 复用 ui 原语，双主题适配
  - _Requirement: R1, R3, R5, R6, R7, R8_

- [x] 10. i18n 六套字典
  - `rail.gitmcp` + `gitmcp.*` 全部新键：messages.ts（en/zh）+ ja/ko/zh-tw/zh-hk
  - `builtin.git-mcp.desc` 更新为本地版描述
  - _Requirement: R17_

## M3 收尾

- [x] 11. 内置插件文档改写
  - `PLUGIN.md` / `PLUGIN.zh.md`：删除 mcp-remote/gitmcp.io 章节，改为本地工具四件套 +
    `gitmcp:{owner}/{repo}` 命名规则 + 桌面端模块引导 + CLI 手工配置示例
  - _Requirement: R17_

- [ ] 12. 回归验证
  - [x] `npm run typecheck && npm run lint && npm test`（全过；session.test.ts “excludes disabled skills” 为分支既有失败，未扩大）
  - [x] `npm run build` + `npm run desktop:build` 产物验证（cli/dist/gitmcp/server.js、core/dist/gitmcp/*、
    desktop main.js/preload.cjs/renderer.js 均含 gitmcp 接线；新 PLUGIN.md 已复制到 dist 模板）
  - [ ] `npm run desktop:start` 手测清单（待人工）：添加合法/非法/重复 → 启停/重建/删除 → MCP 页签权限 →
    会话内 AI 调用 search_documentation → 断网检索
  - _Requirement: R14, R18_
