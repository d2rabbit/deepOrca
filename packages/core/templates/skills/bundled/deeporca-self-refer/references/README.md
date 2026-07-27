<div align="center">
<h1>DeepOrca</h1>

**AI 驱动的下一代编码助手**

</div>

DeepOrca 是专为 `deepseek-v4` 模型优化的 AI 编码助手，以 Electron 桌面客户端为形态，支持深度思考、推理强度控制、Agent Skills 以及 MCP 集成。

## 配置

创建 `~/.deeporca/settings.json` 文件（若本机已有 `~/.deepcode` 配置目录则会直接沿用，无需迁移），内容如下：

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "sk-..."
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

完整配置说明（多层级优先级、环境变量等）请参阅 [docs/configuration.md](docs/configuration.md)。

## 主要功能

### **Skills**

DeepOrca 支持 agent skills，允许您扩展助手的能力：

Skills 会按以下优先级扫描：

| Scope   | Path                       | Purpose                           |
| :------ | :------------------------- | :-------------------------------- |
| Project | `./.deeporca/skills/`      | DeepOrca 原生位置，最高优先级    |
| Project | `./.agents/skills/`        | 跨客户端互操作                    |
| User    | `~/.deeporca/skills/`      | DeepOrca 原生位置                |
| User    | `~/.agents/skills/`        | 跨客户端互操作                    |
| Bundled | `bundled:<skill>/SKILL.md` | DeepOrca 内置 skills，最低优先级 |

（同级的 `.deepcode` 旧目录同样会被扫描，与 `.deeporca` 双向兼容。）

### **为 DeepSeek 优化**

- 专门为 DeepSeek 模型性能调优。
- 通过使用[上下文缓存](https://api-docs.deepseek.com/guides/kv_cache)来降低成本。
- 原生支持[思考模式](https://api-docs.deepseek.com/guides/thinking_mode)和思考强度控制。

## 支持的模型

- `deepseek-v4-pro`（推荐使用）
- `deepseek-v4-flash`
- 任何其他 OpenAI 兼容模型

## 常见问题

### DeepOrca 是否支持理解图片？

DeepOrca 支持多模态，可使用ctrl+v从剪贴板粘贴图片。但目前 deepseek-v4 不支持多模态。有些模型虽然有多模态能力，但对多轮对话请求的限制太严。目前多模态输入推荐使用火山方舟的 Doubao-Seed-2.0-pro 模型，适配效果最好。

### 怎样在任务完成后自动给 Slack 发消息？

编写一个调用 Slack webhook 的 Shell 通知脚本，然后在 `~/.deeporca/settings.json` 中将 `notify` 字段设为该脚本的完整路径即可。详细步骤请参考 [docs/notify.md](docs/notify.md)。

### 怎样启用联网搜索功能？

DeepOrca自带免费的、且大部分情况够用的Web Search工具。如果你希望使用自定义脚本进行联网搜索，可以在 `~/.deeporca/settings.json` 中将 `webSearchTool` 设为脚本的完整路径即可。详细步骤可参考：https://github.com/qorzj/web_search_cli

### 如何配置 MCP？

DeepOrca 支持 MCP（Model Context Protocol），可以连接 GitHub、浏览器、数据库等外部服务。在 `settings.json` 中配置 `mcpServers` 字段即可启用，在桌面客户端的 MCP 面板中可查看已配置的 MCP 服务器状态和可用工具。

详细配置指南：[docs/mcp.md](docs/mcp.md)

### 如何配置 DeepOrca 任务完成后发送通知？

当 AI 助手完成一轮任务后，DeepOrca 可以自动执行一个通知脚本，将任务结果发送到你指定的渠道（如 Slack、系统通知等）。

详细配置指南：[docs/notify.md](docs/notify.md)

### DeepOrca 只支持 YOLO 模式吗？

不是。DeepOrca 内置了细粒度的权限控制机制，支持在 AI 助手执行 Shell 命令、读写文件、访问网络等操作前进行确认。你可以通过 `settings.json` 中的 `permissions` 字段按需配置每种权限范围的策略：始终允许、始终询问、或直接拒绝。详见 [docs/permission.md](docs/permission.md)。

### 是否支持 Coding Plan？

支持。只要把 `~/.deeporca/settings.json` 的 `env.BASE_URL` 配置为 OpenAI 兼容的接口地址就行。以火山方舟的 Coding Plan 为例：

```json
{
  "env": {
    "MODEL": "ark-code-latest",
    "BASE_URL": "https://ark.cn-beijing.volces.com/api/coding/v3",
    "API_KEY": "**************"
  },
  "thinkingEnabled": true
}
```

## 协议

- MIT
