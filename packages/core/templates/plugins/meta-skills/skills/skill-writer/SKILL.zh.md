---
name: skill-writer
description: Guide users through creating, updating, debugging, and validating Agent Skills for AI agents. Use when the user wants to create, write, author, design, troubleshoot, validate, or improve a Skill, or needs help with SKILL.md, frontmatter, or skill structure.
---

# Skill Writer

本 Skill 帮助你为 AI agent 创建结构良好、遵循最佳实践和校验要求的 Agent Skill。

## 何时使用本 Skill

在以下情况下使用本 Skill：

- 创建新的 Agent Skill
- 编写或更新 SKILL.md 文件
- 设计 skill 结构和 frontmatter
- 排查 skill 发现（discovery）相关问题
- 将已有的提示词或工作流转换为 Skill

## 操作步骤

### 第 1 步：确定 Skill 的范围

首先，明确这个 Skill 应该做什么：

1. **提出澄清性问题**：
   - 这个 Skill 应该提供什么具体能力？
   - AI agent 什么时候应该使用这个 Skill？
   - 它需要哪些工具或资源？
   - 这是个人使用还是团队共享？

2. **保持聚焦**：一个 Skill = 一种能力
   - 合理："PDF 表单填写"、"Excel 数据分析"
   - 过于宽泛："文档处理"、"数据工具"

### 第 2 步：选择 Skill 的存放位置

确定在哪里创建 Skill：

**个人 Skill**（`~/.agents/skills/`）：

- 个人工作流和偏好
- 实验性 Skill
- 个人生产力工具

**项目 Skill**（`.agents/skills/`）：

- 团队工作流和约定
- 项目特定的专业知识
- 共享工具（提交到 git）

### 第 3 步：创建 Skill 结构

创建目录和文件：

```bash
# Personal
mkdir -p ~/.agents/skills/skill-name

# Project
mkdir -p .agents/skills/skill-name
```

对于多文件 Skill：

```
skill-name/
├── SKILL.md (required)
├── reference.md (optional)
├── examples.md (optional)
├── scripts/
│   └── helper.py (optional)
└── templates/
    └── template.txt (optional)
```

### 第 4 步：编写 SKILL.md 的 frontmatter

创建包含必需字段的 YAML frontmatter：

```yaml
---
name: skill-name
description: Brief description of what this does and when to use it
---
```

**字段要求**：

- **name**：
  - 只能使用小写字母、数字、连字符
  - 最多 64 个字符
  - 必须与目录名一致
  - 合理：`pdf-processor`、`git-commit-helper`
  - 不合理：`PDF_Processor`、`Git Commits!`

- **description**：
  - 最多 1024 个字符
  - 同时说明"它能做什么"和"何时使用它"
  - 使用用户会说的具体触发词
  - 提及文件类型、操作和上下文

**可选的 frontmatter 字段**：

- **allowed-tools**：限制工具访问（逗号分隔的列表）
  ```yaml
  allowed-tools: read
  ```
  适用于：
  - 只读 Skill
  - 安全敏感的工作流
  - 限定范围的操作

### 第 5 步：编写有效的 description

description 对 AI agent 能否发现你的 Skill 至关重要。

**公式**：`[它能做什么] + [何时使用] + [关键触发词]`

**示例**：

✅ **良好**：

```yaml
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
```

✅ **良好**：

```yaml
description: Analyze Excel spreadsheets, create pivot tables, and generate charts. Use when working with Excel files, spreadsheets, or analyzing tabular data in .xlsx format.
```

❌ **过于模糊**：

```yaml
description: Helps with documents
description: For data analysis
```

**建议**：

- 包含具体的文件扩展名（.pdf、.xlsx、.json）
- 提及常见的用户用语（"analyze"、"extract"、"generate"）
- 列出具体的操作（而非通用的动词）
- 添加上下文线索（"Use when..."、"For..."）

### 第 6 步：组织 Skill 的内容

使用清晰的 Markdown 章节：

````markdown
# Skill Name

Brief overview of what this Skill does.

## Quick start

Provide a simple example to get started immediately.

## Instructions

Step-by-step guidance for AI agents:

1. First step with clear action
2. Second step with expected outcome
3. Handle edge cases

## Examples

Show concrete usage examples with code or commands.

## Best practices

- Key conventions to follow
- Common pitfalls to avoid
- When to use vs. not use

## Requirements

List any dependencies or prerequisites:

```bash
pip install package-name
```
````

## Advanced usage

For complex scenarios, see [reference.md](reference.md).

````

### 第 7 步：添加辅助文件（可选）

为实现渐进式披露（progressive disclosure），可以创建额外的文件：

**reference.md**：详细的 API 文档、高级选项
**examples.md**：扩展的示例和用例
**scripts/**：辅助脚本和工具
**templates/**：文件模板或样板代码

在 SKILL.md 中引用它们：
```markdown
For advanced usage, see [reference.md](reference.md).

Run the helper script:
\`\`\`bash
python scripts/helper.py input.txt
\`\`\`
````

### 第 8 步：校验 Skill

检查以下要求：

✅ **文件结构**：

- [ ] SKILL.md 存在于正确的位置
- [ ] 目录名与 frontmatter 中的 `name` 一致

✅ **YAML frontmatter**：

- [ ] 第 1 行以 `---` 开头
- [ ] 正文前有结束的 `---`
- [ ] 是合法的 YAML（没有制表符，缩进正确）
- [ ] `name` 遵循命名规则
- [ ] `description` 具体且少于 1024 个字符

✅ **内容质量**：

- [ ] 对 AI agent 提供清晰的说明
- [ ] 提供了具体的示例
- [ ] 处理了边界情况
- [ ] 列出了依赖项（如果有）

✅ **测试**：

- [ ] description 与用户的问题相匹配
- [ ] Skill 会在相关查询时被激活
- [ ] 说明清晰且可执行

### 第 9 步：测试 Skill

1. **重启 AI agent**（如果在运行中）以加载 Skill

2. **提出与 description 匹配的相关问题**：

   ```
   Can you help me extract text from this PDF?
   ```

3. **验证激活**：AI agent 应当自动使用该 Skill

4. **检查行为**：确认 AI agent 正确遵循了说明

### 第 10 步：如有需要进行调试

如果 AI agent 没有使用该 Skill：

1. **让 description 更具体**：
   - 添加触发词
   - 包含文件类型
   - 提及常见的用户用语

2. **检查文件位置**：

   ```bash
   ls ~/.agents/skills/skill-name/SKILL.md
   ls .agents/skills/skill-name/SKILL.md
   ```

3. **校验 YAML**：
   ```bash
   cat SKILL.md | head -n 10
   ```

## 常见模式

### 只读 Skill

```yaml
---
name: code-reader
description: Read and analyze code without making changes. Use for code review, understanding codebases, or documentation.
allowed-tools: read
---
```

### 基于脚本的 Skill

```yaml
---
name: data-processor
description: Process CSV and JSON data files with Python scripts. Use when analyzing data files or transforming datasets.
---

# Data Processor

## Instructions

1. Use the processing script:
\`\`\`bash
python scripts/process.py input.csv --output results.json
\`\`\`

2. Validate output with:
\`\`\`bash
python scripts/validate.py results.json
\`\`\`
```

### 带有渐进式披露的多文件 Skill

```yaml
---
name: api-designer
description: Design REST APIs following best practices. Use when creating API endpoints, designing routes, or planning API architecture.
---

# API Designer

Quick start: See [examples.md](examples.md)

Detailed reference: See [reference.md](reference.md)

## Instructions

1. Gather requirements
2. Design endpoints (see examples.md)
3. Document with OpenAPI spec
4. Review against best practices (see reference.md)
```

## Skill 作者的最佳实践

1. **一个 Skill，一个目的**：不要创建臃肿的"巨型 Skill"
2. **具体的 description**：包含用户会说的触发词
3. **清晰的说明**：写给 AI agent 看，而不是写给人看
4. **具体的示例**：展示真实代码，而不是伪代码
5. **列出依赖项**：在 description 中提及所需的包
6. **与团队成员一起测试**：验证激活情况和清晰度
7. **为 Skill 做版本管理**：在内容中记录变更
8. **使用渐进式披露**：将高级细节放到单独的文件中

## 校验清单

在最终完成一个 Skill 之前，请确认：

- [ ] name 为小写，只含连字符，最多 64 个字符
- [ ] description 具体且少于 1024 个字符
- [ ] description 包含"做什么"和"何时使用"
- [ ] YAML frontmatter 合法
- [ ] 说明是分步骤的
- [ ] 示例具体且真实
- [ ] 依赖项已记录
- [ ] 文件路径使用正斜杠
- [ ] Skill 会在相关查询时被激活
- [ ] AI agent 正确遵循说明

## 故障排查

**Skill 未被激活**：

- 让 description 更具体，加入触发词
- 在 description 中包含文件类型和操作
- 添加带有用户用语的 "Use when..." 子句

**多个 Skill 之间冲突**：

- 让各自的 description 更具区分度
- 使用不同的触发词
- 收窄每个 Skill 的范围

**Skill 出现错误**：

- 检查 YAML 语法（无制表符，缩进正确）
- 核对文件路径（使用正斜杠）
- 确保脚本具备执行权限
- 列出所有依赖项

## 示例

完整示例请参见文档：

- 简单的单文件 Skill（commit-helper）
- 带有工具权限的 Skill（code-reviewer）
- 多文件 Skill（pdf-processing）

## 输出格式

在创建一个 Skill 时，我将：

1. 就范围和需求提出澄清性问题
2. 建议 Skill 的名称和存放位置
3. 创建带有正确 frontmatter 的 SKILL.md 文件
4. 包含清晰的说明和示例
5. 如有需要，添加辅助文件
6. 提供测试说明
7. 对照所有要求进行校验

最终结果将是一个完整、可用的 Skill，遵循所有最佳实践和校验规则。
