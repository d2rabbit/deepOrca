---
name: meta-skills
description: "元技能插件 — 交互式批注、产品自引用、技能编写/审查、安全扫描"
category: meta
icon: meta
skills:
  - name: a2ui-annotation
    description: "交互式批注反馈层 — 结构化反馈选项、修改建议、用户选择"
  - name: deeporca-self-refer
    description: "DeepOrca 自引用文档 — 功能/配置/命令/权限/MCP/Skill 答疑"
  - name: skill-writer
    description: "创建、更新、调试和验证 Agent Skills"
  - name: skill-digester
    description: "审查和改进其他 Skill 的 SKILL.md 描述"
  - name: skill-spector
    description: "AI Skill/MCP 安全扫描 — 68 漏洞模式检测"
mcp:
  - skill-spector
  - a2ui
---

# 元技能插件

DeepOrca 的元层面能力：交互式批注反馈、产品自引用文档、Agent Skill 编写与管理、以及 AI Skill/MCP 安全扫描。

## 包含能力

### 技能

- **a2ui-annotation** — 交互式批注反馈层。当用户对 Agent 产出有反馈时，Agent 使用 `render_surface` 构建交互式批注 UI（方案选项 + 自由输入 + 确认按钮），用户通过点击或打字回应。全域适用——不限于 Designer。
- **deeporca-self-refer** — 回答关于 DeepOrca 自身的问题：功能、配置、斜杠命令、Skills、MCP 集成、权限、通知、会话持久化和故障排查。
- **skill-writer** — 引导用户创建、更新、调试和验证 Agent Skills。覆盖 SKILL.md 编写规范、frontmatter 格式、描述优化。
- **skill-digester** — 审查和改进另一个 DeepOrca skill 的 SKILL.md description 字段，指导 Agent Skill 安装到用户或项目 `.agents/skills` 目录。
- **skill-spector** — AI Skill/MCP 安全扫描能力说明。引导 Agent 使用 SkillSpector MCP 进行安全分析。

### MCP 服务器

- **a2ui** — 交互式 Surface MCP 服务器。提供 `render_surface`、`update_surface`、`close_surface`、`a2ui_action` 工具，用于构建对话内联交互式 UI。
- **skill-spector** — AI Skill/MCP 安全扫描器（68 漏洞模式）。检测 prompt injection、数据外泄、供应链 CVE、MCP 最小权限违规、MCP 工具投毒。
