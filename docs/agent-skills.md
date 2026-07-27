# Agent Skills

## 概述

适合写成 skill 的内容通常具备以下特点：

- 会重复使用，例如固定的代码审查流程、发布流程或文档生成流程
- 需要较长的说明，不适合每次都粘贴到对话中
- 需要配套资源，例如模板、脚本、schema、示例或参考文档
- 需要明确触发条件，例如“处理 PDF 表单”或“为本项目生成数据库迁移”

不适合写成 skill 的内容：

- 一次性的任务要求
- 当前仓库的短规则，此类内容更适合写入 `AGENTS.md`
- 需要实时连接外部系统的能力，此类能力更适合通过 MCP 提供工具

## 扫描位置

DeepOrca CLI 会按以下顺序扫描 skills。相同 `name` 的 skill 只保留优先级最高的一个。

| 优先级 | Scope   | Path                  | 用途 |
| ------ | ------- | --------------------- | ---- |
| 1      | Project | `./.deeporca/skills/` | DeepOrca 项目级原生位置 |
| 2      | Project | `./.agents/skills/`   | 项目级跨客户端互操作位置 |
| 3      | User    | `~/.deeporca/skills/` | DeepOrca 用户级原生位置 |
| 4      | User    | `~/.agents/skills/`   | 用户级跨客户端互操作位置 |
| 5      | Global  | `built-in`            | DeepOrca 内置 skills |

目录结构示例：

```text
.deeporca/
└── skills/
    └── code-review/
        ├── SKILL.md
        ├── checklist.md
        └── scripts/
            └── collect-diff.sh
```

## 最小 Skill

每个 skill 必须放在独立目录中，并包含 `SKILL.md`。

```markdown
---
name: code-review
description: Review code changes for correctness, regressions, security risks, and missing tests. Use when the user asks for a review, PR review, diff review, or pre-merge check.
---

# Code Review

Use a code review mindset. Prioritize bugs, behavioral regressions, security issues,
and missing tests over style comments.

## Workflow

1. Inspect the diff and relevant surrounding code.
2. List findings first, ordered by severity.
3. Include file and line references for every finding.
4. If there are no findings, say so and mention residual risks or test gaps.
```

## `SKILL.md` Frontmatter

DeepOrca CLI reads the YAML frontmatter at the top of `SKILL.md`.

| 字段 | 必填 | DeepOrca 行为 | 建议 |
| ---- | ---- | -------------- | ---- |
| `name` | 建议必填 | 作为 skill 的唯一名称。缺失时使用目录名，并把 `_` 转成 `-`。 | 使用小写字母、数字和连字符。保持与目录名一致。 |
| `description` | 建议必填 | 用于自动匹配任务，也显示在 `/skills` 和斜杠菜单中。 | 写清楚 skill 做什么、何时使用、常见触发词。 |
| `metadata.allow-implicit-invocation` | 可选 | 设置为 `false` 时，不参与自动匹配；仍可手动选择。 | 用于只想手动调用的 skill。 |

示例：

```yaml
---
name: db-migration
description: Create and review database migrations for this project. Use when the user asks to add columns, change schema, write migrations, or validate rollback behavior.
metadata:
  allow-implicit-invocation: false
---
```

> DeepOrca CLI 当前只解释上表中的字段。其他 frontmatter 字段可用于跨客户端互操作或文档说明，但不会自动限制 DeepOrca 的工具权限。

## 写好 `description`

`description` 是最重要的发现信号。DeepOrca 会在自动匹配阶段只把 skill 的 `name` 和 `description` 交给模型判断，因此描述越具体，匹配越可靠。

推荐结构：

```text
<这个 skill 做什么>. Use when <任务类型、文件类型、领域、用户常见说法或触发词>.
```

好的示例：

```yaml
description: Extract tables from PDF files, fill PDF forms, and merge documents. Use when working with PDFs, forms, invoices, statements, or document extraction.
```

```yaml
description: Generate Lessweb routes, services, and Pydantic request models. Use when editing Lessweb projects, adding @Get/@Post endpoints, configuring IOC modules, or updating OpenAPI output.
```

避免：

```yaml
description: Helps with documents
description: Useful project skill
description: Tooling instructions
```

检查清单：

- 是否说明了具体能力，而不是只写主题名
- 是否说明了何时使用，而不是只写结果
- 是否包含用户可能输入的关键词
- 是否包含相关文件类型、框架名、命令名或领域名
- 是否避免覆盖过宽，导致无关任务也触发

## Skill 正文结构

`SKILL.md` 的正文应面向 agent，而不是面向普通读者。写法要直接、可执行、可验证。

推荐结构：

```markdown
# Skill Name

Briefly state what this skill is for.

## When to use

- Use when ...
- Do not use when ...

## Workflow

1. Read ...
2. Run ...
3. Edit ...
4. Verify ...

## Rules

- Preserve ...
- Never ...
- Ask the user when ...

## Examples

...
```

写作原则：

- 使用命令式步骤，例如“Read the schema first”或“Run tests after editing”
- 把必须遵守的约束写成明确规则
- 对高风险操作写清楚边界，例如删除文件、迁移数据、发送请求
- 对常见分支写出决策规则，例如“如果没有配置文件，先搜索默认路径”
- 避免把大量参考资料全部塞进 `SKILL.md`

## 附加资源

一个 skill 可以包含 `SKILL.md` 之外的文件：

```text
my-skill/
├── SKILL.md
├── references/
│   └── api.md
├── examples/
│   └── request.json
├── scripts/
│   └── validate.py
└── templates/
    └── report.md
```

如果某些内容会让 `SKILL.md` 过长或难以阅读，可以放到附加文件中：

- `references/` 放长文档、规范、API 说明
- `examples/` 放输入输出样例
- `scripts/` 放可复用脚本
- `templates/` 放文档或代码模板
- 在 `SKILL.md` 中说明什么时候需要使用这些附加文件

示例：

```markdown
## Workflow

1. Read `references/schema.md` before changing generated types.
2. Use `templates/migration.sql` when creating a new migration.
3. Run `python scripts/check_migration.py <file>` before reporting completion.
```

## 调用方式

DeepOrca CLI 支持自动和手动两种调用方式。

### 自动调用

每次用户输入后，DeepOrca 会根据可用 skills 的 `name` 和 `description` 判断哪些 skill 与任务匹配。匹配到的 skill 会被加载到当前会话中。

自动调用规则：

- 已加载的 skill 不会在同一会话中重复加载
- `metadata.allow-implicit-invocation: false` 的 skill 不会自动加载
- 自动匹配会结合当前 `AGENTS.md` 指令
- 如果没有匹配项，则不加载 skill

### 手动调用

你可以在输入框中使用 `/` 打开 skills / 命令菜单，选择某个 skill；也可以使用 `/skills` 查看可用 skills。

常用命令：

| 命令 | 作用 |
| ---- | ---- |
| `/` | 打开 skills / 命令菜单 |
| `/skills` | 列出可用 skills |
| `/<skill-name>` | 从菜单中选择对应 skill |

## 启用和禁用

使用 `settings.json` 的 `enabledSkills` 可以按 skill 名称启用或禁用 skill。

```json
{
  "enabledSkills": {
    "code-review": true,
    "db-migration": false
  }
}
```

规则：

- 未配置的 skill 默认启用
- 设置为 `false` 会隐藏所有扫描位置中同名的 skill
- 项目设置会按 skill 覆盖用户设置

更多配置说明请参考 [configuration.md](configuration.md)。

## 与 `AGENTS.md`、MCP 的区别

| 机制 | 适合放什么 | 不适合放什么 |
| ---- | ---------- | ------------ |
| `AGENTS.md` | 当前仓库的长期规则、代码风格、测试命令、协作约定 | 可复用的复杂工作流或跨项目工具说明 |
| Agent Skill | 可复用工作流、领域知识、模板、脚本、参考资料 | 只对当前一次任务生效的临时要求 |
| MCP | 外部系统能力、实时数据、浏览器、数据库、GitHub 等工具调用 | 纯文本流程说明 |

常见组合：

- 把项目规则写进 `AGENTS.md`
- 把可复用流程写成 skill
- 把需要执行外部动作的能力接入 MCP

## 编写示例：项目发布 Skill

```markdown
---
name: release-check
description: Prepare and verify a project release. Use when the user asks to release, publish, bump version, update changelog, or run pre-release checks.
---

# Release Check

Use this skill to prepare a safe release for this repository.

## Workflow

1. Read `package.json` and the existing changelog.
2. Inspect commits or diffs since the previous release tag.
3. Update version and changelog only when the user explicitly asks.
4. Run the project test and build commands.
5. Report the version, changed files, verification results, and remaining risks.

## Rules

- Do not publish packages unless the user explicitly asks.
- Do not create or push git tags without explicit approval.
- Preserve existing changelog style.
```

## 故障排查

### `/skills` 中看不到 skill

检查：

1. 目录是否位于 DeepOrca 扫描位置之一
2. 文件名是否为 `SKILL.md`
3. `SKILL.md` 是否在独立 skill 目录中，例如 `.deeporca/skills/my-skill/SKILL.md`
4. `enabledSkills` 是否把该 skill 设置为 `false`
5. 是否存在同名 skill 被更高优先级位置覆盖

### 自动调用不稳定

检查：

1. `description` 是否包含清晰的使用场景和触发词
2. skill 是否过宽，导致模型难以判断边界
3. 是否设置了 `metadata.allow-implicit-invocation: false`
4. 用户请求是否需要更明确地提到该 skill 的领域或文件类型

### Skill 内容过长

建议：

1. 保留 `SKILL.md` 中的核心流程和规则
2. 把长文档移到 `references/`
3. 把重复命令移到 `scripts/`
4. 在 `SKILL.md` 中说明何时读取相关文件

## 参考

- [Agent Skills Specification](https://agentskills.io/specification)
