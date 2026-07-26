# git-mcp

通过内置的**本地 GitMCP 服务器**让关于**外部 GitHub 仓库**的回答有据可依——每个注册的仓库都以本地 stdio MCP 服务器运行，共享一个磁盘索引库（`~/.deepcode/gitmcp/index.db`）。文档只从 GitHub 抓取一次，随后在本地分块索引（FTS5/BM25），检索可离线工作，不经过任何第三方服务，消除对小众、新兴或快速迭代库的 API 幻觉。

## 何时使用

- 用户在使用某个外部库/框架，而你不确定其当前 API
- 用户贴出 GitHub 链接，询问如何使用/集成该项目
- 用户反馈你给出的 API 不存在（大概率是幻觉——需对照最新文档核实）
- 用户希望为常用依赖建立一个持久的文档源 → 引导其注册该仓库

## 何时不用

- 关于当前工作区自身代码的问题（应使用本地工具）
- 私有仓库（文档从公开的 raw.githubusercontent.com 抓取）
- 你完全确定的知名稳定 API

## 服务器命名规则

每个仓库拥有独立的 MCP 服务器条目，以仓库命名：

| 仓库 | MCP 服务器名 |
|------|--------------|
| `github.com/{owner}/{repo}` | `gitmcp:{owner}/{repo}` |

服务器连接后，其工具以 `mcp__gitmcp_{owner}_{repo}__*` 形式出现（服务器名中的 `:` 和 `/` 会被清洗为 `_`）。

## 注册仓库

**桌面端：**打开左侧边栏的 **GitMCP** 模块（在代码审查旁），粘贴 `owner/repo` 或任意 GitHub 地址后点击添加。模块会立即构建本地索引，服务器的启停与删除都在此管理。插件中心 → MCP 页签只能启停这类服务器，不能删除。

**CLI：**在 `~/.deepcode/settings.json` 中添加占位条目——引擎启动时会自动改写为实际的本地服务器命令：

```json
{
  "mcpServers": {
    "gitmcp:{owner}/{repo}": {
      "command": "gitmcp",
      "args": ["{owner}/{repo}"]
    }
  }
}
```

## 每个仓库提供的工具

工具名固定（仓库在服务器启动时绑定）：

| 工具 | 用途 |
|------|------|
| `fetch_documentation` | 获取仓库主文档（`llms.txt` → `llms-full.txt` → README）；离线时回退到本地缓存 |
| `search_documentation` | 在本地索引中做 BM25 检索——优先用它而非全量拉取；首次使用时自动建立索引 |
| `search_code` | 通过 GitHub 代码搜索 API 查找实现示例 |
| `fetch_url_content` | 解析文档中引用的外部链接（HTML 会剥离为纯文本） |

## 工作流

1. 从用户的提问、import 语句或包清单中识别其依赖的外部仓库。
2. 若其 `gitmcp:{owner}/{repo}` 服务器已连接，优先调用 `search_documentation`（比全量拉取更省 token）；仅在"这个项目是干什么的"这类宽泛问题时拉取完整文档。
3. 若未连接，引导桌面端用户使用 GitMCP 模块，或提供可直接粘贴的 `mcpServers` 占位配置——未经询问不要直接修改用户的配置文件。
4. 基于检索到的文档给出 API 用法与代码示例，并注明依据的文档章节。

## 提示

- 检索命中的是本地索引，重复查询很快，且一旦索引完成即可离线使用。
- 上游文档更新后，可在桌面端 GitMCP 模块重建索引。
- `search_code` 直接调用 GitHub API；在环境变量中设置 `GITHUB_TOKEN` 可提高速率限额。
