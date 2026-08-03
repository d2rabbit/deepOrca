---
name: skill-spector
description: >-
  AI Skill/MCP 安全扫描能力说明。引导 Agent 使用 SkillSpector MCP 工具进行安全分析。
  Use when the user asks to scan skills for vulnerabilities, check MCP security,
  audit agent safety, or detect prompt injection / data exfiltration risks.
  Triggers: skill security, mcp security, 安全扫描, 漏洞检测, prompt injection, skill audit.
---

# SkillSpector 安全扫描

SkillSpector 是 AI Skill/MCP 安全扫描器，检测 68 种漏洞模式。

## 何时使用

- 审查自定义 Skill 或 MCP 服务器的安全性
- 检测 prompt injection 攻击向量
- 检查数据外泄风险
- 验证 MCP 最小权限配置
- 扫描供应链 CVE

## 使用方式

SkillSpector 作为内置 MCP 服务器自动运行（当 `uv` 可用时）。Agent 通过 MCP 工具调用：

```
mcp__skill-spector__scan_skill <skill_path>
```

默认使用纯静态分析模式（`use_llm=false`），无需任何凭证。

## 检测范围

- **Prompt Injection** — 检测 SKILL.md/plug-in 文档中的指令注入
- **Data Exfiltration** — 检测向外部服务器发送数据的模式
- **Supply Chain CVE** — 检查依赖中的已知漏洞
- **MCP Least Privilege** — 验证 MCP 工具权限是否最小化
- **MCP Tool Poisoning** — 检测 MCP 工具描述中的恶意指令
