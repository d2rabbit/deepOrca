---
name: deeporca-self-refer
description: Answers questions about DeepOrca CLI itself — including features, configuration options, slash commands, Skills, MCP integration, permissions, notifications, session persistence, and troubleshooting. Use this when users ask how to configure or use DeepOrca, how to set up an MCP server, configure notifications (such as Slack/Feishu), manage permissions, view available skills, understand slash commands, configure thinking mode, etc.
---

# DeepOrca 自引用

本 Skill 通过查阅随附的参考文档，帮助你回答关于 DeepOrca CLI 本身的问题。所有文档都位于 `references/` 子目录中——请始终以这些文档为准来获取权威答案。

## 何时使用本 Skill

当用户提出任何关于 DeepOrca 本身的问题时，请使用本 Skill，例如：

- "列出可用的 skills"
- "如何配置 MCP？"
- "给当前项目配置 playwright mcp"
- "怎么启用搜索功能？"
- "支持哪些模型？"
- "如何配置思考模式？"
- "怎么设置权限？"
- "任务完成后怎么发通知？"
- "支持哪些斜杠命令？"
- "会话历史保存在哪里？"
- "/undo 是怎么工作的？"
- "DeepOrca 和 VSCode 插件怎么配合？"
- 其他任何关于 DeepOrca CLI 功能、配置或使用的问题。

## 操作说明

### 步骤 1：确定主题

将用户的问题映射到相应的文档：

| 主题                     | 文档                                | 主要内容                                                                                                                |
| ------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **概述、功能、快速上手** | `references/README.md`              | 安装、斜杠命令、键盘快捷键、支持的模型、常见问题                                                                        |
| **配置与设置**           | `references/configuration.md`       | `settings.json` 字段、配置层级、环境变量、思考模式、推理强度、webSearchTool、enabledSkills                               |
| **MCP 配置与使用**       | `references/mcp.md`                 | MCP 服务器配置格式、GitHub/Playwright/Filesystem 示例、工具命名规则（`mcp__<name>__<tool>`）、故障排查                   |
| **权限**                 | `references/permission.md`          | 权限范围（10 种）、allow/deny/ask/defaultMode 配置、优先级规则、持久化                                                  |
| **通知**                 | `references/notify.md`              | Notify 脚本路径、注入的环境变量、Slack/飞书/iTerm2/macOS/Linux/Windows 示例                                             |
| **会话持久化**           | `references/session-persistence.md` | 存储路径、JSONL 格式、会话索引、压缩、`/undo` 机制、代码快照                                                            |

### 步骤 2：阅读相关文档

使用 `Read` 工具从上表中读取相应文档。所有路径都相对于本 Skill 加载后的根目录，即 `references/` 子目录所在的位置。

- 如果问题涉及多个主题，请阅读多份文档。
- 如果文档不存在用户偏好的语言版本（例如中文），请尝试另一种语言变体（例如 `references/configuration_en.md`）。
- 当基于 references/README.md 回答时，请聚焦于相关章节。

### 步骤 3：精准作答

- 对于配置示例、JSON 代码片段或命令语法，**直接引用文档原文**。
- **不要猜测**——如果文档中没有答案，请如实说明，并建议查阅 GitHub Issues。
- 当用户要求配置某些功能（例如 MCP 服务器、notify 脚本、权限）时，**提供可直接复制粘贴的配置**。
- 必要时**提及相关文档**（例如 MCP 配置可参考 `references/mcp.md`，权限相关可参考 `references/permission.md`）。

### 步骤 4：处理常见请求模式

**"列出/查看可用的 skills"：**

- 将 `/skills` 视为列出当前可用 skills 的权威 UI。
- 若直接回答，请勿仅凭已加载的 skill 提示词或项目/用户目录来推断列表。请枚举所有发现根目录：
  1. `./.deeporca/skills/<folder>/SKILL.md`
  2. `./.agents/skills/<folder>/SKILL.md`
  3. `~/.deeporca/skills/<folder>/SKILL.md`
  4. `~/.agents/skills/<folder>/SKILL.md`
  5. 以 `bundled:<folder>/SKILL.md` 形式存在的内置 bundled skills
- 对于源码检出（source checkout），bundled skills 位于 `templates/skills/bundled/<folder>/SKILL.md`。对于打包安装版本，bundled skills 可能位于 `dist/bundled/<folder>/SKILL.md`。
- 读取每个候选 `SKILL.md` 的 frontmatter 以获取解析后的 `name` 和 `description`；文件夹名仅作为兜底。
- 按解析后的 `name` 去重，保留上述顺序中优先级最高的根目录。
- 应用 `settings.json` 中的 `enabledSkills`：若 `enabledSkills["<name>"] === false`，则不要将该 skill 列为可用。
- 明确区分可发现的 skills 与其他概念：
  - 可发现的 skills 可通过 `/skills` 选择，来源为上述根目录。
  - Bundled skills 是随 DeepOrca 一起发布的可发现 skills，例如 `bundled:deeporca-self-refer/SKILL.md`。
  - 默认提示词模板或始终注入的引导内容，并不一定是可发现的 skills——除非它们也以 `*/SKILL.md` 的形式存在于某个扫描根目录中。
  - 诸如 `/skills`、`/mcp`、`/undo` 之类的斜杠命令是命令，而非 skills。
- 提醒用户可以使用 `/skills` 来验证结果，并可通过 `enabledSkills` 按名称启用/禁用特定 skill。

**"配置 <X> MCP"：**

- 阅读 `references/mcp.md` 了解 MCP 格式和示例
- 向用户询问所需凭证（例如 GitHub token）
- 提供需要添加到 `settings.json` 的确切 `mcpServers` JSON 块
- 提醒用户之后使用 `/mcp` 验证配置

**"如何配置/修改 <设置项>"：**

- 阅读 `references/configuration.md`
- 说明由哪个 `settings.json` 字段控制该设置
- 区分用户级（`~/.deeporca/settings.json`）与项目级（`.deeporca/settings.json`）
- 提供确切的 JSON 代码片段

**"<斜杠命令> 是做什么的？"：**

- 阅读 references/README.md 中的斜杠命令表
- 给出简短说明，并补充来自相关文档的额外上下文

### 最佳实践

1. **始终先查阅文档**——切勿仅凭记忆作答；文档才是事实来源。
2. **提供可直接复制粘贴的 JSON**——用户希望直接将配置块复制到他们的 `settings.json` 中。
3. **明确文件路径**——务必指明是 `~/.deeporca/settings.json` 还是 `.deeporca/settings.json`。
4. **提及 `/mcp` 验证**——在每次 MCP 配置变更后，提醒用户使用 `/mcp` 进行验证。
5. **兼顾中英文文档**——本项目同时提供两种语言的文档（`references/xxx.md` 为中文，`references/xxx_en.md` 为英文）。

## 示例

### 示例 1："列出可用的skills"

阅读 references/README.md，定位到 Skills 章节，然后枚举所有扫描根目录（包括 bundled skills）。回答如下：

- Skills 的发现来源：`./.deeporca/skills/`、`./.agents/skills/`、`~/.deeporca/skills/`、`~/.agents/skills/`，以及内置 bundled skills（如 `bundled:deeporca-self-refer/SKILL.md`）。
- 在源码检出中，请检查 `templates/skills/bundled/*/SKILL.md`；在打包安装版本中，请检查 `dist/bundled/*/SKILL.md`。
- 内置 bundled skills 可能包括 `deeporca-self-refer`、`plan`、`skill-digester` 和 `skill-writer`；请通过扫描 bundled 根目录来核实实际列表，因为它可能随版本变化。
- 在 DeepOrca CLI 中使用 `/skills` 斜杠命令来列出所有可用的 skills。
- 使用 `settings.json` 中的 `enabledSkills` 按名称启用/禁用 skills。

### 示例 2："给当前项目配置playwright mcp"

阅读 `references/mcp.md`，定位到 Playwright 示例。回答如下：

- 将以下内容添加到 `settings.json`（用户级 `~/.deeporca/settings.json` 或项目级 `.deeporca/settings.json`）：

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

- 如果要与已有配置合并，请将 `"playwright"` 条目添加到现有的 `mcpServers` 对象中。
- 保存后，在 DeepOrca 中使用 `/mcp` 验证服务器是否已运行。

### 示例 3："怎么设置通知到Slack?"

阅读 `references/notify.md`，定位到 Slack 章节。提供脚本与配置作为回答。

### 示例 4："如何只允许AI读写当前目录?"

阅读 `references/permission.md`，定位到严格模式示例。提供确切的 JSON 配置。
