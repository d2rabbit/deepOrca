# GitMCP 本地化独立模块 — 需求文档

## 1. 问题与背景

当前 git-mcp 集成只有「提示词插件 + 手动预置模板」，且依赖官方远程服务 gitmcp.io（须经 `mcp-remote` 桥接）。
目标是把该能力产品化为 DeepOrca 的独立模块：**自研本地 stdio MCP server**（不依赖 gitmcp.io），
用户输入外部 GitHub 仓库地址即可一键生成并激活对应 MCP，文档在本地建立可检索的索引库。

上游参考：[idosal/git-mcp](https://github.com/idosal/git-mcp)（Cloudflare Workers 应用，无法直接本地运行，
故仅对齐其 4 个工具的语义，实现完全自研）。

## 2. 范围

### 包含

- core：自研 gitmcp 本地 stdio MCP server（拉取/索引/检索外部仓库文档）+ 本地索引库（SQLite FTS5）
- desktop：新增 GitMCP 边缘模块（活动栏 rail item + 面板），管理仓库条目的添加/启停/删除/重建索引
- desktop：MCP 模块对 gitmcp 托管条目的删除权限限制
- 内置插件 `templates/plugins/git-mcp` 文档改写为本地版
- 向量检索（sqlite-vec）仅**预留接口**，本期不实现

### 非目标（本期不做）

- embedding 向量化计算与 sqlite-vec 实际接入（下期）
- 私有仓库支持（仅公开仓库；GITHUB_TOKEN 仅用于提升 API 限额）
- CLI 端专属 UI（server 位于 core，CLI 用户可手工配置 mcpServers 使用）
- GitHub Pages（`{owner}.github.io`）站点抓取

## 3. 用户故事

1. 作为桌面端用户，我在活动栏点击 GitMCP 图标，粘贴一个 GitHub 仓库地址（URL 或 `owner/repo` 简写），
   点击添加后系统自动生成 MCP 服务器并激活，AI 立即可查询该仓库文档。
2. 作为桌面端用户，我在 GitMCP 面板中可以看到每个仓库的索引状态（分块数/更新时间/运行状态），
   并可启停、删除、重建索引。
3. 作为桌面端用户，我在插件中心 MCP 页签看到 gitmcp 托管的服务器时，只能启停，不能删除——
   删除必须回到 GitMCP 模块操作。
4. 作为 AI 代理，当用户询问外部库 API 时，我调用已激活的 gitmcp 工具检索本地索引的文档，
   给出有据可依的回答，不产生 API 幻觉。
5. 作为离线用户，已索引过的仓库文档在断网时仍可检索（本地库缓存）。

## 4. 验收标准（EARS）

### 模块入口与添加流程

- **R1** When 用户在 GitMCP 面板输入合法的仓库标识（`https://github.com/{owner}/{repo}`、
  `github.com/{owner}/{repo}` 或 `{owner}/{repo}`），the 系统 shall 归一化为 `owner/repo` 并显示确认预览。
- **R2** When 用户确认添加仓库，the 系统 shall 在用户级 settings 的 `mcpServers` 写入名为
  `gitmcp:{owner}/{repo}` 的条目、立即连接该 server，并触发首次文档拉取与索引。
- **R3** While 首次索引进行中，the GitMCP 面板 shall 展示进度反馈；when 索引完成或失败，
  the 面板 shall 呈现结果状态（分块数或错误原因）。
- **R4** When 用户输入无法解析的仓库标识，the 系统 shall 拒绝添加并提示格式错误，不写入任何配置。
- **R5** When 添加的仓库已存在，the 系统 shall 提示已存在并定位到该条目，不重复写入。

### GitMCP 面板管理

- **R6** When 用户在 GitMCP 面板切换某仓库的启停开关，the 系统 shall 复用现有 MCP 启停机制
  （disable sidecar + reload）使其立即生效。
- **R7** When 用户在 GitMCP 面板删除某仓库，the 系统 shall 移除对应 `mcpServers` 条目、
  断开 server，并删除该仓库的本地索引数据。
- **R8** When 用户在 GitMCP 面板点击重建索引，the 系统 shall 清空该仓库旧索引并重新拉取文档入库。

### MCP 模块权限边界

- **R9** While 一个 MCP 条目名称带 `gitmcp:` 前缀，the 插件中心 MCP 页签 shall 隐藏其删除入口，
  仅提供启停开关（对齐内置 codegraph 的"可禁用、不可删除"交互）。

### 本地 MCP server 能力

- **R10** When AI 调用 `fetch_documentation`，the server shall 按 `llms.txt → llms-full.txt → README.md`
  优先级从 GitHub raw 拉取文档并返回，同时写入本地索引库。
- **R11** When AI 调用 `search_documentation`，the server shall 在本地 FTS5 索引上执行 BM25 检索并
  返回带来源定位的分块结果；若该仓库尚未索引，shall 先自动拉取入库再检索。
- **R12** When AI 调用 `search_code`，the server shall 通过 GitHub code search API 检索该仓库代码
  并返回结果；when 环境变量 `GITHUB_TOKEN` 存在，shall 携带该 token 提升限额。
- **R13** When AI 调用 `fetch_url_content`，the server shall 拉取指定 URL 并返回精简为文本/Markdown 的内容。
- **R14** While 网络不可用且请求的仓库已有本地索引，the server 的 `search_documentation` shall
  正常返回本地结果，`fetch_documentation` shall 返回缓存文档并标注缓存时间。
- **R15** The server shall 通过 stdio JSON-RPC 与引擎通信（与现有 MCP 客户端协议兼容），
  不依赖任何远程 gitmcp.io 服务。

### 索引库

- **R16** The 索引库 shall 存放于 `~/.deepcode/gitmcp/`（跨项目共享），使用 `node:sqlite` + FTS5，
  schema 中预留向量检索扩展点（检索后端抽象接口），本期不加载 sqlite-vec。

### 兼容与既有能力

- **R17** When 内置插件提示词注入 git-mcp 文档，the 文档内容 shall 描述本地 server 的工具与
  GitMCP 模块的使用方式，不再引导 `mcp-remote` 远程桥接。
- **R18** The 现有 MCP 手动添加/删除/启停、codegraph 内置服务器行为 shall 不受本次改动影响。

## 5. 约束

- Node ≥ 22（`node:sqlite` 可用，项目既有要求）；Electron 主进程侧复用 codegraph 的
  sqlite-capable Node 解析先例
- core 保持 UI-free；不新增重量级运行时依赖（stdio JSON-RPC server 手写，不引入 MCP SDK）
- TypeScript strict / `import type` / kebab-case / Prettier 120 列等既有规范
- i18n 需覆盖全部 6 套字典（en/zh + ja/ko/zh-tw/zh-hk）
