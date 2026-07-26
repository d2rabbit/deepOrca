
<br/>
<br/>
<p align="center">
  <a href='https://github.com/lessweb/deepcode-cli'>
    <img src='https://avatars.githubusercontent.com/u/118287711?s=200&v=4' width='100' alt="orca"/>
  </a>
</p>
<h1>Orca</h1>

[![][npm-release-shield]][npm-release-link] [![][npm-downloads-shield]][npm-downloads-link] [![][github-contributors-shield]][github-contributors-link] [![][github-forks-shield]][github-forks-link] [![][github-stars-shield]][github-stars-link]
[![][github-issues-shield]][github-issues-link] [![][github-issues-pr-shield]][github-issues-pr-link] [![][github-license-shield]][github-license-link]

[English](README-en.md) · 中文 · [官网](https://lessweb.github.io/deepcode-cli/)

<br/>
</div>

**Orca** 是基于 [Deep Code](https://github.com/lessweb/deepcode-cli) fork 而来的独立 AI 编码助手项目，专为 `deepseek-v4` 模型优化，支持终端 CLI、Electron 桌面客户端以及 VSCode 插件三种形态。

> **关于独立**：Orca 起源于 Deep Code 的 fork，但正在逐步发展为一个独立的项目。我们保留了 Deep Code 优秀的核心引擎架构，并在此基础上进行了大量扩展——包括桌面客户端 GUI、内置插件系统、以及针对 Orca 的专属优化。未来 Orca 将以独立项目的身份持续演进。

## 安装

```bash
npm install -g @vegamo/deepcode-cli
```

在任意项目目录下运行 `deepcode` 即可启动 CLI。

![intro2](resources/intro2.png)

## 配置

创建 `~/.deepcode/settings.json` 文件，内容如下：

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

配置文件与 [Deep Code VSCode 插件](https://github.com/lessweb/deepcode) 共享，无需重复配置。

完整配置说明（多层级优先级、环境变量等）请参阅 [docs/configuration.md](docs/configuration.md)。

# 主要功能

### **三种扩展机制**

Orca 提供三种并列的扩展能力：

| 扩展类型 | 说明 | 管理方式 |
|----------|------|----------|
| **Skills（技能）** | SKILL.md 驱动的 Agent 能力扩展 | 放入 `.deepcode/skills/` 目录 |
| **MCP 服务器** | 通过 Model Context Protocol 连接外部服务 | 在 settings.json 中配置 |
| **内置插件** | 随 Orca 一起发布的核心能力扩展 | 自动加载，不可卸载 |

### **内置插件**

内置插件是 Orca 专属的扩展格式，与 Skills 和 MCP 并列为第三种扩展类型。它们随核心引擎一起发布，始终可用，不能被卸载或禁用。

当前内置插件：
- **browser-skill** — 通过 `bsk` CLI 驱动用户真实的 Chromium 浏览器进行自动化操作（访问页面、填写表单、抓取数据、UI 回归测试等）
- **open-code-review** — 集成阿里巴巴 [Open Code Review](https://github.com/alibaba/open-code-review) AI 代码审查 CLI，读取 Git diff 生成行级精度的结构化审查意见
- **git-mcp** — 本地 GitMCP 模块，输入 GitHub 仓库地址即可生成对应的 MCP 服务器，基于 SQLite FTS5 全文索引实现文档语义搜索，支持代码检索和文档获取

### **GitMCP 模块**
GitMCP 是一个独立的内置模块，让你可以直接索引和搜索任何 GitHub 仓库的文档：
- 输入仓库地址（支持 URL、SSH、`owner/repo` 三种格式），自动生成本地 MCP 服务器
- 基于 SQLite FTS5 全文索引，BM25 排序，毫秒级语义搜索
- 4 个内置工具：`fetch_documentation`、`search_documentation`、`search_code`、`fetch_url_content`
- 在 GitMCP 面板中管理仓库（添加/删除/重建索引/启停）
- 在 MCP 页签中可启停，但不可删除（保护内置模块）

### **Skills（技能）**
支持 agent skills，允许您扩展助手的能力。Skills 会按以下优先级扫描：

| Scope   | Path                  | Purpose                       |
| :------ | :-------------------- | :---------------------------- |
| Project | `./.deepcode/skills/` | Orca 原生位置                 |
| Project | `./.agents/skills/`   | 跨客户端互操作                |
| User    | `~/.deepcode/skills/` | Orca 原生位置                 |
| User    | `~/.agents/skills/`   | 跨客户端互操作                |

### **桌面客户端 (Electron)**
除了终端 CLI，Orca 还提供功能完整的 Electron 桌面客户端：
- QQ 风格气泡消息 + 工具调用卡片
- 智能 Thinking 折叠（仅最新展开）
- 图片粘贴/拖拽
- 插件中心（MCP / Skills / 内置插件三栏管理）
- 源码管理 (Git) 面板
- 代码索引 (CodeGraph) 面板
- **GitMCP 面板** — 管理 GitHub 仓库索引，语义搜索文档和代码
- **代码审查 (Open Code Review) 面板** — 一键审查工作区变更或分支对比，流式输出 + 结构化评论展示
- 多主题系统（Aqua 原生 / Glass Prism 玻璃拟态 / Punk 2077 赛博朋克）
- 6 语言国际化（en / zh / ja / ko / zh-HK / zh-TW）

### **为 DeepSeek 优化**
- 专门为 DeepSeek 模型性能调优。
- 通过使用[上下文缓存](https://api-docs.deepseek.com/guides/kv_cache)来降低成本。
- 原生支持[思考模式](https://api-docs.deepseek.com/guides/thinking_mode)和思考强度控制。

### **当前功能全景**

| 能力域 | 功能 | 状态 |
|--------|------|------|
| 核心引擎 | LLM 会话循环、7 内置工具、上下文压缩 | ✅ |
| 终端 CLI | Ink TUI、斜杠命令、Plan Mode | ✅ |
| 桌面客户端 | Electron GUI、多面板、多主题 | ✅ |
| VSCode 插件 | 编辑器内嵌 Agent | ✅ |
| 扩展系统 | Skills / MCP / 内置插件 | ✅ |
| 代码索引 | CodeGraph MCP Server + 索引面板 | ✅ |
| 代码审查 | Open Code Review 内置插件 + 审查面板 | ✅ |
| GitMCP | 本地 GitMCP 模块 + 仓库索引面板 | ✅ |
| 浏览器自动化 | browser-skill 内置插件 | ✅ |
| 源码管理 | Git 面板（stage/commit/diff/branch） | ✅ |
| 权限控制 | 细粒度 scope 策略 | ✅ |
| 会话持久化 | 跨会话恢复、归档、导出 | ✅ |
| 联网搜索 | 内置 WebSearch 工具 | ✅ |
| 多模态 | 图片粘贴/拖拽输入 | ✅ |

## 斜杠命令与按键功能

| 斜杠命令        | 操作                               |
|-------------|----------------------------------|
| `/`         | 打开 skills / 命令菜单                 |
| `/new`      | 开始新对话                            |
| `/resume`   | 选择历史对话继续                         |
| `/continue` | 继续当前对话，或选择历史对话恢复                 |
| `/model`    | 切换模型、思考模式和推理强度                   |
| `/raw`      | 切换显示模式（Normal / Lite / Raw 滚动回溯） |
| `/init`     | 初始化 AGENTS.md 文件                 |
| `/skills`   | 列出可用 skills                      |
| `/mcp`      | 查看 MCP 服务器状态和可用工具                |
| `/undo`     | 将代码和/或对话恢复到之前的状态                 |
| `/exit`     | 退出（也可用连续 `Ctrl+D`）               |

| 按键            | 操作                 |
|---------------|--------------------|
| `Enter`       | 发送消息               |
| `Shift+Enter` | 插入换行（也可用 `Ctrl+J`） |
| `Ctrl+V`      | 从剪贴板粘贴图片           |
| `Esc`         | 中断当前模型回复           |
| 连续 `Ctrl+D`   | 退出                 |

## 支持的模型

- `deepseek-v4-pro`（推荐使用）
- `deepseek-v4-flash`
- 任何其他 OpenAI 兼容模型

## 架构和基准测试

Armin Ronacher 在[《Better Models: Worse Tools》](https://lucumr.pocoo.org/2026/7/4/better-models-worse-tools/)中指出，工具 schema 不是「中立的」：模型（LLM）会继承训练和强化学习中形成的工具使用习惯，因此可能在某个主流 harness 中表现很好，却在另一套工具形态下变得不稳定。这正是 Orca 的架构出发点：只为 DeepSeek 量身调优，从而让 harness 本身持续贴合 DeepSeek 的行为特点。

Orca 的收益来自于工具约束、上下文管理、Agent Skills、内置插件和权限策略等多项设计叠加后的结果。[deepcode-qrcode-benchmark](https://github.com/qorzj/deepcode-qrcode-benchmark) 项目展示了在一个真实且有难度的 Python 需求上，Deep Code + DeepSeek + `/plan` 模式相较 Claude Code + DeepSeek 的组合具有效果优势。

> 详见：[架构文档](docs/architecture.md)

## 常见问题

### Orca 是否有 VSCode 插件？

有的。提供功能完整的 VSCode 插件，可在 [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=vegamo.deepcode-vscode) 安装。插件与 CLI 共享 `~/.deepcode/settings.json` 配置文件，可以在终端和编辑器之间无缝切换。

### Orca 是否支持理解图片？

支持多模态，可使用 Ctrl+V 从剪贴板粘贴图片。但目前 deepseek-v4 不支持多模态。有些模型虽然有多模态能力，但对多轮对话请求的限制太严。目前多模态输入推荐使用火山方舟的 Doubao-Seed-2.0-pro 模型，适配效果最好。

### 怎样在任务完成后自动给 Slack 发消息？

编写一个调用 Slack webhook 的 Shell 通知脚本，然后在 `~/.deepcode/settings.json` 中将 `notify` 字段设为该脚本的完整路径即可。详细步骤请参考 [docs/notify.md](docs/notify.md)。

### 怎样启用联网搜索功能？

Orca 自带免费的、且大部分情况够用的 Web Search 工具。如果你希望使用自定义脚本进行联网搜索，可以在 `~/.deepcode/settings.json` 中将 `webSearchTool` 设为脚本的完整路径即可。详细步骤可参考：https://github.com/qorzj/web_search_cli

### 如何配置 MCP？

支持 MCP（Model Context Protocol），可以连接 GitHub、浏览器、数据库等外部服务。在 `settings.json` 中配置 `mcpServers` 字段即可启用，启动后使用 `/mcp` 命令查看已配置的 MCP 服务器状态和可用工具。

详细配置指南：[docs/mcp.md](docs/mcp.md)

### 权限控制

不是只有 YOLO 模式。内置了细粒度的权限控制机制，支持在 AI 助手执行 Shell 命令、读写文件、访问网络等操作前进行确认。你可以通过 `settings.json` 中的 `permissions` 字段按需配置每种权限范围的策略：始终允许、始终询问、或直接拒绝。详见 [docs/permission.md](docs/permission.md)。

### 是否支持 Coding Plan？

支持。只要把 `~/.deepcode/settings.json` 的 `env.BASE_URL` 配置为 OpenAI 兼容的接口地址就行。以火山方舟的 Coding Plan 为例：

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

## Feature Roadmap

### 近期开发（Feature Dev）

| # | 特性 | 说明 | 状态 |
|---|------|------|------|
| 1 | **远程插件中心** | 在线插件市场，支持一键安装/更新社区 Skills 和 MCP 服务器 | 🔨 规划中 |
| 2 | **自定义 CLI 与指令** | 用户可注册自定义斜杠命令和 CLI 子命令，扩展 Agent 工作流 | 🔨 规划中 |
| 3 | **项目图谱与沉浸式 Wiki** | 代码知识图谱可视化 + 项目级知识沉淀（类似 Qoder 知识中心），需深度设计 | 📐 设计中 |
| 4 | **Designer 能力** | AI 驱动的 UI 设计生成，从自然语言描述到可预览的界面原型 | 🔨 规划中 |

### 后期特性（Feature Backlog）

以下能力已完成前期调研，列入后期功能层面：

| 特性 | 参考项目 | 方向 |
|------|----------|------|
| 代码审查图谱 | [code-review-graph](https://github.com/tirth8205/code-review-graph) | 将审查意见与代码依赖图关联，可视化影响范围 |
| Agent 插件协议 | [flutter/agent-plugins](https://github.com/flutter/agent-plugins/tree/main) | 标准化 Agent 插件接口，支持跨框架复用 |
| 语义代码导航 | [serena](https://github.com/oraios/serena) | 基于语义的代码理解与导航引擎 |
| 开放 CLI 框架 | [opencli](https://github.com/jackwener/opencli) | 可扩展的 CLI 指令注册与分发框架 |
| AI 记忆层 | [mem0](https://github.com/mem0ai/mem0) | 跨会话长期记忆，让 Agent 积累项目知识 |
| 代码知识图谱 | [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) | Tree-sitter + LLM 混合分析，生成可交互知识图谱（已完成耦合度分析，推荐作为 bundled skill 集成） |

> 详细调研报告：[docs/research/2026-07-ocr-integration-and-ua-analysis.md](docs/research/2026-07-ocr-integration-and-ua-analysis.md)

## 贡献

欢迎贡献代码！以下是参与方式：

```bash
# 克隆仓库
git clone https://github.com/lessweb/deepcode-cli.git
cd deepcode-cli

# 安装依赖
npm install

# 运行测试
npm test

# CLI本地开发（类型检查 + lint + 格式检查 + 构建）
npm run build

# CLI链接到全局（即本地全局安装）
npm link

# 桌面客户端本地开发
npm run desktop:dev

# VSCode插件本地开发
npm run build:vscode
```

- 提交 PR 前请确保 `npm run check` 通过（类型检查 + lint + 格式检查）
- 建议在执行构建前，先执行 `npm run format` 自动格式化代码，避免构建报错

## 获取帮助

- 在 GitHub Issues 上报告错误或请求功能 (https://github.com/lessweb/deepcode-cli/issues)

## 协议

- MIT

## 支持我们

如果你觉得这个工具对你有帮助，请考虑通过以下方式支持我们：

- 在 GitHub 上给我们一个 Star (https://github.com/lessweb/deepcode-cli)
- 向我们提交反馈和建议
- 分享给你的朋友和同事

<!-- LINK GROUP -->

[npm-release-link]: https://www.npmjs.com/package/@vegamo/deepcode-cli
[npm-release-shield]: https://img.shields.io/npm/v/@vegamo/deepcode-cli?color=4d6BFE&labelColor=black&logo=npm&logoColor=white&style=flat-square&cacheSeconds=1800
[npm-downloads-link]: https://www.npmjs.com/package/@vegamo/deepcode-cli
[npm-downloads-shield]: https://img.shields.io/npm/dt/@vegamo/deepcode-cli?labelColor=black&style=flat-square&color=4d6BFE&cacheSeconds=1800
[github-contributors-link]: https://github.com/lessweb/deepcode-cli/graphs/contributors
[github-contributors-shield]: https://img.shields.io/github/contributors/lessweb/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
[github-forks-link]: https://github.com/lessweb/deepcode-cli/network/members
[github-forks-shield]: https://img.shields.io/github/forks/lessweb/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
[github-stars-link]: https://github.com/lessweb/deepcode-cli/network/stargazers
[github-stars-shield]: https://img.shields.io/github/stars/lessweb/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
[github-issues-link]: https://github.com/lessweb/deepcode-cli/issues
[github-issues-shield]: https://img.shields.io/github/issues/lessweb/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
[github-issues-pr-link]: https://github.com/lessweb/deepcode-cli/pulls
[github-issues-pr-shield]: https://img.shields.io/github/issues-pr/lessweb/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
[github-license-link]: https://github.com/lessweb/deepcode-cli/blob/main/LICENSE
[github-license-shield]: https://img.shields.io/github/license/lessweb/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
