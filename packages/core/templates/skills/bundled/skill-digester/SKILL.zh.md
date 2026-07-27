---
name: skill-digester
description: Reviews and improves another DeepOrca skill's SKILL.md description field, and guides Agent Skill installation into user or project .agents/skills roots. Use when the user asks to digest a skill, install an Agent Skill, install a skill to user/project scope, or says "消化技能" or "安装 agent skill".
---

# Skill Digester

本技能用于处理两类相关任务：

- 审阅并可选地重写另一个 DeepOrca 技能的 `description` 字段。
- 指导将 Agent Skill 安装到可互操作的 `.agents/skills` 根目录中。

## 交互规则

每当需要用户输入时，请调用 `AskUserQuestion` 工具。不要以普通助手文本的形式提出后续问题。这包括缺失的技能名称或路径、安装范围、语言偏好、重复匹配、frontmatter 格式异常的处理决策，以及是否应用推荐的重写方案。

## 工作流

首先对请求进行分类：

- 如果用户要求安装、添加、复制或放置 Agent Skill，请使用 [Install Agent Skill Workflow](#install-agent-skill-workflow)。
- 否则，使用 [Digest Description Workflow](#digest-description-workflow)。

## Digest Description Workflow

1. 根据用户的请求识别目标技能。
   - 如果用户未提供技能名称，请使用 `AskUserQuestion` 询问。
   - 通过运行本技能目录中自带的 Node 脚本来定位技能：

     ```bash
     node ~/.deeporca/skills/skill-digester/scripts/find-skill.js "<skill-name-or-path>" "<project-root>"
     ```

     如果本技能是从项目级或其他用户级路径加载的，请改用与当前 `SKILL.md` 同目录的 `scripts/find-skill.js` 文件。
   - 该脚本按照 DeepOrca CLI 扫描的相同根目录及优先级顺序进行搜索：
     1. 项目原生技能：`./.deeporca/skills/<folder>/SKILL.md`
     2. 项目可互操作技能：`./.agents/skills/<folder>/SKILL.md`
     3. 用户原生技能：`~/.deeporca/skills/<folder>/SKILL.md`
     4. 用户可互操作技能：`~/.agents/skills/<folder>/SKILL.md`
   - 仅将 `./` 视为当前 DeepOrca 项目根目录；除非运行中的项目根目录发生了变更，否则不要扫描父目录。
   - 脚本会按照 DeepOrca 的方式解析每个候选技能的名称：当 frontmatter 的 `name` 存在时使用去除首尾空格后的该字段，否则使用文件夹名称并将下划线转换为连字符。
   - 优先将用户输入与解析后的技能名称进行匹配。如有需要，也可考虑文件夹名称或用户显式提供的路径。
   - 将匹配技能的 `path` 视为待审阅的源 `SKILL.md`。
   - 将匹配技能的 `digestTarget.path` 视为唯一要创建或编辑的输出 `SKILL.md` 路径。
   - `digestTarget.path` 始终指向同一范围的原生 DeepOrca 根目录：
     - 来自 `./.deeporca/skills` 或 `./.agents/skills` 的项目级源文件，其消化输出目标为 `./.deeporca/skills/<folder>/SKILL.md`。
     - 来自 `~/.deeporca/skills` 或 `~/.agents/skills` 的用户级源文件，其消化输出目标为 `~/.deeporca/skills/<folder>/SKILL.md`。
   - 如果脚本返回一个活动匹配项，则使用其 `path` 进行读取，使用 `digestTarget.path` 进行写入。
   - 如果脚本返回活动匹配项和被遮蔽的匹配项，则展示每个源路径和消化目标路径，然后在使用被遮蔽的源文件之前通过 `AskUserQuestion` 询问。
   - 如果脚本未返回匹配项，则说明该技能未在 DeepOrca 扫描的技能根目录中找到，并使用 `AskUserQuestion` 询问用户是否希望尝试其他名称。

2. 在审阅之前推断用户的首选语言。
   - 根据用户的措辞推断一种可能的语言。例如，如果用户说 `消化pdf技能`，则推断为中文。
   - 使用 `AskUserQuestion` 以所推断的语言确认语言。对于中文，询问：`请选择您偏好的语言。`
   - 首先提供所推断的语言，并将 `English` 作为备选项。UI 会提供 `Other` 选项，因此用户可以输入其他语言。
   - 在此后的每个问题、推荐和重写的 `description` 字段中都使用已确认的首选语言。

3. 读取源 `SKILL.md`。
   - 从匹配的源路径中解析 YAML frontmatter 和 Markdown 正文。
   - 保留所有 frontmatter 字段和正文内容；如果用户批准重写，则仅修改 `description` 字段。
   - 如果 frontmatter 缺失或格式异常，请先说明问题，并在进行结构性修复之前使用 `AskUserQuestion` 询问。

4. 对照 Agent Skills 规范审阅当前的 `description` 字段。
   - 必须满足的约束条件：
     - 必须非空。
     - 长度必须为 1-1024 个字符。
     - 应当描述技能的功能。
     - 应当描述何时使用该技能。
     - 应当包含有助于 Agent 识别相关任务的具体关键词。
   - 将该描述与实际的 `SKILL.md` 正文进行对比。标记不匹配、缺失的能力、过于宽泛的激活措辞、含糊的表述，以及缺失的重要触发关键词。
   - 如果现有描述是准确的、具体的且有用的，则不要仅出于风格原因而重写。

5. 呈现审阅结果和建议。
   - 如果描述已经很好，则如实说明，除非用户要求，否则不要修改文件。
   - 如果有改进空间，则展示：
     - 当前的描述。
     - 简洁的审阅结论。
     - 用首选语言编写的推荐替换内容。
     - 正在审阅的源路径。
     - 将要创建或编辑的消化输出路径。
   - 使用 `AskUserQuestion` 让用户以首选语言从以下三种操作中选择一种：
     - 应用建议的更改。
     - 放弃更改。
     - 继续讨论措辞。

6. 仅在获得明确批准后才应用更改。
   - 仅写入 `digestTarget.path`；绝不要将消化结果写入 `.agents/skills`。
   - 如果 `digestTarget.sameAsSource` 为 true，则仅更新该现有原生 `SKILL.md` 中的 `description` 字段。
   - 如果 `digestTarget.sameAsSource` 为 false 且 `digestTarget.exists` 为 false，则先通过复制源技能目录来创建原生目标技能目录，然后仅更新目标 `SKILL.md` 的描述。这样可以保留自带的脚本、引用和资源文件。
   - 如果 `digestTarget.sameAsSource` 为 false 且 `digestTarget.exists` 为 true，则仅更新现有原生目标 `SKILL.md` 中的 `description` 字段；除非用户明确要求，否则不要覆盖其正文或自带文件。
   - 在所写入的文件中保持原始 `name` 及其他所有 frontmatter 字段不变。
   - 除非用户另行要求编辑，否则原样保留正文内容。
   - 编辑完成后，报告源路径、更新后的消化输出路径以及最终描述。

## Install Agent Skill Workflow

当用户要求安装 Agent Skill 时，请使用此工作流。安装操作始终写入 `.agents/skills`，而不是 `.deeporca/skills`。

1. 识别源技能目录。
   - 如果用户提供了显式的文件或目录路径，则按以下规则解析：
     - `~/...` 相对于用户主目录。
     - `./...` 相对于当前项目根目录。
     - 绝对路径按原样处理。
     - 如果是 `SKILL.md` 路径，则其父目录即为源技能目录。
   - 如果用户提供的是技能名称而非路径，则使用 `scripts/find-skill.js` 定位该技能，命令和匹配规则与 digest 工作流相同。
   - 如果用户既未提供技能名称也未提供路径，请使用 `AskUserQuestion` 询问源技能名称或路径。
   - 源目录必须包含 `SKILL.md`。如果不包含，则报告该路径不是 Agent Skill；仅当用户仍希望安装时，才请求提供其他源。

2. 确定安装后的技能文件夹名称。
   - 解析源 `SKILL.md` 的 frontmatter。
   - 当 frontmatter 的 `name` 存在时，使用去除首尾空格后的该字段。
   - 否则使用源文件夹名称并将下划线转换为连字符。
   - 将该解析后的名称用作目标文件夹名称。

3. 仅询问一个安装范围问题。
   - 使用 `AskUserQuestion` 询问是用户级还是项目级安装该技能。
   - 仅提供以下范围选项：
     - 用户级安装：`~/.agents/skills/<skill-name>/`
     - 项目级安装：`./.agents/skills/<skill-name>/`
   - 在复制之前，不要询问任何其他安装偏好。

4. 复制完整的技能目录。
   - 用户级目标位置：`~/.agents/skills/<skill-name>/`。
   - 项目级目标位置：`./.agents/skills/<skill-name>/`。
   - 复制整个源技能目录，包括 `SKILL.md`、`references/`、`scripts/`、`templates/`、示例、资源文件以及其他支持文件。
   - 精确保留文件内容和相对路径。
   - 如有需要，创建 `.agents/skills` 父目录。
   - 如果目标目录已存在，则停止并报告冲突。除非用户在后续消息中明确要求，否则不要覆盖或合并文件。

5. 报告结果。
   - 报告源目录和安装目标位置。
   - 提及 Agent 客户端可能需要重新加载或重启后才能看到已安装的技能。
   - 除非用户另行要求，否则不要对已安装的技能进行消化、重写或规范化处理。

## AskUserQuestion Patterns

除非两个决策紧密相关，否则每次只提出一个问题。每个问题都必须包含 `options`；依赖 UI 的 `Other` 选项来接受自由输入。

示例：

```json
{"questions":[{"question":"请选择您偏好的语言。","options":[{"label":"中文","description":"后续询问和推荐描述都使用中文。"},{"label":"English","description":"Use English for follow-up questions and the recommended description."}]}]}
```

```json
{"questions":[{"question":"How should I proceed with this description recommendation?","options":[{"label":"Apply change","description":"Update only the description field in the native digest output SKILL.md."},{"label":"Abandon change","description":"Leave the file unchanged."},{"label":"Discuss wording","description":"Continue refining the proposed description before editing."}]}]}
```

```json
{"questions":[{"question":"Where should I install this Agent Skill?","options":[{"label":"User-level","description":"Install to ~/.agents/skills so it is available across projects."},{"label":"Project-level","description":"Install to ./.agents/skills so it is available in this project."}]}]}
```

## Review Heuristics

一个优秀的描述应当简短、具体，并且以激活为导向。推荐采用以下模式：

```text
<What the skill does>. Use when <task types, file types, tools, domains, or user phrases that should trigger it>.
```

避免使用仅仅是通用标签、营销文案或内部实现说明的描述。

## Safety Notes

- 未经询问，绝不修改名称相似的其他技能。
- 绝不要将消化输出保存到 `.agents/skills` 下；`.agents/skills` 仅作为消化的源根目录。
- 绝不要将已安装的 Agent Skill 保存到 `.deeporca/skills` 下；安装操作仅写入 `.agents/skills`。
- 在消化过程中，绝不在项目级和用户级之间移动技能。
- 除非用户在看到冲突后明确要求，否则绝不覆盖或合并已存在的已安装技能目录。
- 一经确认，除非用户要求，否则绝不更改目标技能的语言偏好。
