# Orca Feature 集成路线图（下阶段）

> 版本：v2.0 · 日期：2026-07-21 · 状态：规划中
> 本文件定义下阶段 8 个开源项目的**直接集成**方案。所有项目均为直接集成到 Orca 中，非从零开发。

---

## 总览

| # | 项目 | 集成形态 | 核心价值 | 优先级 |
|---|------|----------|----------|--------|
| 1 | flutter/agent-plugins | 构建时内置 Skills | Flutter/Dart 开发能力包 | P0 |
| 2 | code-review-graph | 内置 MCP Server | 代码图谱 + 爆炸半径 + 简化架构图 | P0 |
| 3 | serena | 内置 MCP Server | 符号级重构/导航/编辑 | P1 |
| 4 | mem0 | core 层 SDK | 跨会话长期记忆 | P1 |
| 5 | openwiki | 内置 CLI 工具 | 项目 Wiki 自动生成与维护 | P1 |
| 6 | opencli | 内置插件 | 100+ 网站适配器 + CLI Hub | P2 |
| 7 | CLI-Anything | 内置 Skill | 万能 CLI 生成（Agent 驱动任意软件） | P2 |
| 8 | open-design | MCP Server（设计+展示） | AI 设计生成 + 文件交付给 coding agent | P2 |

---

## 一、flutter/agent-plugins — 构建时内置 AI 工具包

> 仓库：https://github.com/flutter/agent-plugins

### 作用

Flutter 官方 Agent 技能包，包含 10+ 个 SKILL.md（架构、布局、测试、路由、本地化、HTTP、表单、动画等）+ MCP 配置 + rules。让 Orca 在 Flutter/Dart 开发场景下具备专家级工作流指导。

### 与现有能力的适配度

| 维度 | 评估 |
|------|------|
| Skills 系统 | 🟢 完全兼容 — Orca 已扫描 `.agents/skills/` 和 `.deepcode/skills/` |
| 构建流程 | 🟢 可嵌入 — 构建脚本中 git clone + 复制到 templates |
| 运行时依赖 | 🟢 零 — 纯 Markdown + JSON 文件 |
| 许可 | BSD-3-Clause |

### 集成方案

**构建时从源仓库安装内置**（每次构建重新拉取最新版本）：

```bash
# scripts/install-builtin-skills.sh（构建时执行）
FLUTTER_SKILLS_DIR="packages/core/templates/skills/flutter-agent"
rm -rf "$FLUTTER_SKILLS_DIR"
git clone --depth 1 https://github.com/flutter/agent-plugins.git /tmp/flutter-agent-plugins
cp -r /tmp/flutter-agent-plugins/skills/* "$FLUTTER_SKILLS_DIR/"
cp /tmp/flutter-agent-plugins/.mcp.json "$FLUTTER_SKILLS_DIR/"
rm -rf /tmp/flutter-agent-plugins
```

**关键设计**：
- 不走远程插件中心，直接构建时内置
- 每次 `npm run build` / `npm run bundle` 时重新从源仓库拉取
- 作为 `packages/core/templates/skills/flutter-agent/` 随核心引擎发布
- Agent 启动时自动加载，用户无需任何配置

---

## 二、code-review-graph — 代码图谱 + 简化架构图

> 仓库：https://github.com/tirth8205/code-review-graph

### 作用

Local-first 代码智能图谱。Tree-sitter 解析 AST → 持久化图（SQLite）→ 通过 MCP 提供 30 个工具（爆炸半径、社区检测、执行流、Wiki 生成、风险评分等）。35+ 语言支持，增量更新 < 2 秒。

### 与现有能力的适配度

| 维度 | 评估 |
|------|------|
| CodeGraph 索引 | 🟡 有重叠 — CRG 的图谱能力覆盖并超越现有 CodeGraph |
| 代码审查面板 | 🟢 互补 — 爆炸半径 + 风险评分增强现有 OCR 审查 |
| MCP 系统 | 🟢 原生兼容 — stdio MCP Server |
| 运行时依赖 | 🟡 需 Python 3.10+ |
| 许可 | MIT |

### 集成方案

**我们不需要它的 D3.js 力导向图**，只需要简单的流程架构图（Mermaid/文本渲染），降低成本。

**Phase 1 — 内置 MCP Server 预配置**：
```json
{
  "mcpServers": {
    "code-review-graph": {
      "command": "code-review-graph",
      "args": ["serve", "--tools", "build_or_update_graph_tool,get_impact_radius_tool,get_review_context_tool,detect_changes_tool,get_architecture_overview_tool,generate_wiki_tool,query_graph_tool,list_communities_tool"]
    }
  }
}
```
只暴露核心工具子集，减少 token 消耗。

**Phase 2 — 审查面板增强**：
- 审查意见旁展示「影响范围」列表（文本形式，非 D3 图）
- 调用 `detect_changes` 获取风险评分，在面板顶部展示风险摘要

**Phase 3 — 简化架构图面板**：
- 调用 `get_architecture_overview` 获取社区结构
- 渲染为 **Mermaid 流程图**（非 D3.js），桌面端用 mermaid.js 轻量渲染
- 模块关系用简单方框 + 箭头，不追求力导向图的炫酷效果
- 点击模块可查看包含的文件和函数列表

---

## 三、serena — 符号级代码操作

> 仓库：https://github.com/oraios/serena

### 作用

"Agent 的 IDE"。通过 LSP 提供符号级检索（find symbol/references/declaration/implementations）、符号编辑（replace body/insert/safe delete）、跨文件 rename。40+ 语言支持。让 Agent 从"文本替换"升级为"语义操作"。

### 与现有能力的适配度

| 维度 | 评估 |
|------|------|
| read/edit 工具 | 🟢 互补 — Orca 文本级，serena 符号级 |
| MCP 系统 | 🟢 原生兼容 — stdio/HTTP MCP Server |
| 桌面端 | 🟢 可扩展重构预览面板 |
| 运行时依赖 | 🟡 Python 3.13 + uv + 各语言 LSP server |
| 许可 | Apache-2.0 |

### 集成方案

**Phase 1 — 内置 MCP Server**：
```json
{
  "mcpServers": {
    "serena": {
      "command": "serena",
      "args": ["start-mcp-server"]
    }
  }
}
```

**Phase 2 — 内置 Skill 联动**：
编写 `serena-skill` SKILL.md，教 Agent：
- 跨文件修改 → 用 serena rename
- 查找所有调用方 → 用 serena find_references
- 替换函数实现 → 用 serena replace_symbol_body
- 简单文本修改 → 继续用 Orca 原生 edit 工具

**Phase 3 — 桌面端重构面板**（可选）：
在侧边栏展示 rename 预览（受影响文件列表 + diff 预览）。

---

## 四、mem0 — 跨会话长期记忆

> 仓库：https://github.com/mem0ai/mem0

### 作用

通用 AI 记忆层。User/Session/Agent 三级记忆，单次 LLM 调用提取事实，实体链接 + 时间推理 + 多信号检索（语义+BM25+实体）。让 Agent 越用越懂项目。Benchmark: LoCoMo 92.5 / LongMemEval 94.4。

### 与现有能力的适配度

| 维度 | 评估 |
|------|------|
| 会话持久化 | 🟢 互补 — Orca 有会话恢复但无智能记忆提取 |
| core 层 | 🟢 npm SDK 可用（`mem0ai`） |
| LLM 配置 | 🟢 可复用 Orca 已有的 LLM 端点 |
| 隐私 | 🟡 需本地模式（Library 或 Self-Hosted） |
| 许可 | Apache-2.0 |

### 集成方案

**Phase 1 — 内置 CLI + Skill**：
```bash
npm install -g @mem0/cli
mem0 init --agent --agent-caller orca
```
内置 `mem0-skill` SKILL.md，Agent 在关键节点（任务完成、发现重要模式、用户纠正）自动 `mem0 add`，新会话开始自动 `mem0 search`。

**Phase 2 — core 层 SDK 集成**：
在 `packages/core` 引入 `mem0ai` npm 包：
- 会话结束 → 自动提取关键事实存储
- 会话开始 → 检索相关记忆注入 system prompt
- 使用 Orca 已配置的 LLM 端点做记忆提取

**Phase 3 — 知识中心记忆引擎**：
mem0 作为项目图谱 + Wiki 的底层记忆存储，形成完整知识中心。

---

## 五、openwiki — 项目 Wiki 自动生成与维护

> 仓库：https://github.com/langchain-ai/openwiki

### 作用

LangChain 出品的 CLI，自动为代码库生成和维护 Agent Wiki。两种模式：
- **Code 模式**：为当前仓库生成 `openwiki/` 文档目录 + 维护 AGENTS.md
- **Personal 模式**：本地个人知识大脑（~/.openwiki/wiki），可接入 Git repo / Notion / Gmail / Web Search 等 connector

输出兼容 Google Open Knowledge Format (OKF) v0.1。支持 CI 自动更新（GitHub Actions / GitLab CI）。

### 与现有能力的适配度

| 维度 | 评估 |
|------|------|
| 项目图谱/Wiki | 🟢 直接填补 — Feature Dev #3 的 Wiki 生成部分 |
| AGENTS.md | 🟢 协同 — 自动维护 AGENTS.md 中的 wiki 引用块 |
| 技术栈 | 🟢 Node.js（npm install -g openwiki） |
| LLM 配置 | 🟢 支持 OpenAI-compatible 端点（可复用 Orca 配置） |
| 许可 | MIT |

### 集成方案

**Phase 1 — 内置 CLI 工具**：
将 `openwiki` 作为 Orca 预装依赖，内置 Skill 教 Agent 使用：
```bash
npm install -g openwiki
# 初始化项目 wiki
openwiki --init
# 更新 wiki
openwiki --update
```

**Phase 2 — 桌面端 Wiki 面板**：
- 侧边栏新增「Wiki」视图，渲染 `openwiki/` 目录下的 Markdown 文件
- 支持一键「生成/更新 Wiki」按钮（调用 `openwiki --update`）
- Wiki 页面间链接可点击跳转

**Phase 3 — 与 mem0 + code-review-graph 融合**：
- openwiki 生成结构化文档
- code-review-graph 提供代码结构图谱
- mem0 提供跨会话记忆
- 三者共同组成「项目知识中心」

---

## 六、opencli — 网站适配器 + CLI Hub

> 仓库：https://github.com/jackwener/opencli

### 作用

将任意网站转为 CLI 命令 + Browser Use。100+ 内置网站适配器（Bilibili/知乎/小红书/Twitter/Reddit 等），CLI Hub 统一入口（gh/docker/vercel/tg/discord 等），6 个 Agent Skills。Node.js >= 20。

### 与现有能力的适配度

| 维度 | 评估 |
|------|------|
| browser-skill | 🟡 有重叠但互补 — opencli 偏数据获取，bsk 偏通用操控 |
| bash 工具 | 🟢 完美匹配 — Agent 通过 bash 执行 opencli 命令 |
| 技术栈 | 🟢 Node.js，npm 安装 |
| 自定义指令 | 🟢 其 adapter 机制可用于 Feature Dev #2 |
| 许可 | Apache-2.0 |

### 集成方案

**Phase 1 — 内置插件**（同 browser-skill 模式）：
```
packages/core/templates/plugins/opencli/
├── plugin.json
├── PLUGIN.md      # 教 Agent 使用 opencli
└── PLUGIN.zh.md
```
Agent 通过 bash 工具执行 `opencli bilibili hot`、`opencli browser` 等。

**Phase 2 — 与 browser-skill 协同分工**：
- browser-skill（bsk）：通用页面操控（表单、UI 测试、截图）
- opencli：结构化数据获取（100+ 网站）+ 已登录会话复用 + CLI Hub

**Phase 3 — CLI Hub 整合**：
opencli 的 `external register` + adapter 机制作为 Orca 自定义指令系统的底层实现。

---

## 七、CLI-Anything — 万能 CLI 生成器

> 仓库：https://github.com/HKUDS/CLI-Anything

### 作用

一行命令为任意软件自动生成完整 CLI（7 阶段全自动：分析→设计→实现→测试→文档→发布）。已在 13 款软件验证（GIMP/Blender/LibreOffice/OBS 等），1955 项测试通过。让 Agent 能驱动任何专业软件。

核心方法论：HARNESS.md（Agent 原生 CLI 设计规范）。生成的 CLI 具备 `--json` 输出、`--help` 自描述、REPL 交互、undo/redo。

### 与现有能力的适配度

| 维度 | 评估 |
|------|------|
| bash 工具 | 🟢 生成的 CLI 通过 bash 直接调用 |
| Skills 系统 | 🟢 提供 SKILL.md，可作为 Agent Skill |
| 自定义指令 | 🟢 HARNESS.md 方法论可指导 Feature Dev #2 |
| 运行时依赖 | 🟡 Python 3.10+（生成过程需要） |
| 许可 | 需确认（学术项目） |

### 集成方案

**Phase 1 — 内置 Skill**：
将 CLI-Anything 的 HARNESS.md + 命令规范作为内置 Skill：
```
packages/core/templates/skills/cli-anything/
├── SKILL.md       # 7 阶段方法论
└── HARNESS.md     # CLI 设计规范
```
Agent 收到「为 XX 软件生成 CLI」指令时，按 7 阶段流水线执行。

**Phase 2 — /cli-anything 斜杠命令**：
注册自定义斜杠命令 `/cli-anything <path>`，触发完整构建流程。

**Phase 3 — CLI-Hub 集成**：
生成的 CLI 自动注册到 Orca 的命令系统，Agent 后续可直接通过 bash 调用。

---

## 八、open-design — AI 设计生成（设计+展示+文件交付）

> 仓库：https://github.com/nexu-io/open-design

### 作用

开源 Claude Design 替代品。Agent 原生设计引擎：自然语言 → HTML 原型/仪表盘/演示文稿/图片/视频。151 个设计系统包、100+ 功能技能、277 个插件。支持 MCP Server（`od mcp install <agent>`）。

**我们只需要它的设计能力和展示能力，以及 coding agent 如何获取设计文件来实现。**

### 与现有能力的适配度

| 维度 | 评估 |
|------|------|
| Designer 能力 | 🟢 直接填补 Feature Dev #4 |
| MCP 系统 | 🟢 原生支持 — `od mcp install` 一行命令 |
| 文件交付 | 🟢 输出 HTML/CSS 文件，coding agent 可直接读取实现 |
| 桌面端展示 | 🟢 iframe 沙箱预览 |
| 运行时依赖 | 🟡 需安装 `od` CLI（Node.js + pnpm） |
| 许可 | Apache-2.0 |

### 集成方案

**核心思路**：不集成整个 Open Design 应用，只接入其 MCP Server 获取设计能力，coding agent 通过文件系统读取设计产物来实现。

**Phase 1 — MCP Server 接入（设计能力）**：
```json
{
  "mcpServers": {
    "open-design": {
      "command": "od",
      "args": ["mcp", "start"]
    }
  }
}
```
Agent 通过 MCP 工具调用设计生成：
- 用户描述需求 → Agent 调用 OD 生成 HTML 原型
- 设计产物输出到 `.deepcode/designs/` 目录

**Phase 2 — 桌面端设计预览（展示能力）**：
- 新增「设计预览」面板，用 iframe 沙箱渲染生成的 HTML
- 支持切换设计系统（151 个 DESIGN.md 包）
- 预览 → 确认 → coding agent 开始实现

**Phase 3 — 设计→代码工作流（文件交付）**：
```
用户描述 → OD 生成设计文件（HTML/CSS）→ 存入 .deepcode/designs/
→ coding agent 读取设计文件 → 实现为 React/Vue/Next.js 组件
```
- 设计文件是标准 HTML/CSS，coding agent 用 read 工具直接读取
- Agent 根据设计文件中的布局、颜色、组件结构来实现生产代码
- DESIGN.md 作为品牌约束，确保实现与设计一致

---

## 九、集成优先级路线图

```
Phase 1（立即）                Phase 2（+2周）              Phase 3（+1月）
├── flutter/agent-plugins ──┤                              │
│   构建时内置 Skills        │                              │
├── code-review-graph ──────┤                              │
│   MCP 预配置 + 审查增强    │                              │
├── serena ─────────────────┤                              │
│   MCP 预配置 + Skill       │                              │
│                            ├── mem0 SDK 集成 ─────────────┤
│                            ├── openwiki CLI 内置 ─────────┤
│                            ├── opencli 内置插件 ──────────┤
│                            │                              ├── 知识中心融合
│                            │                              │   (CRG+Wiki+mem0)
│                            │                              ├── open-design MCP
│                            │                              │   设计→代码工作流
│                            │                              ├── CLI-Anything Skill
│                            │                              │   /cli-anything 命令
│                            │                              ├── 架构图面板
│                            │                              │   (Mermaid 简化渲染)
```

## 十、构建时依赖安装清单

以下工具需要在构建/安装时预置：

| 工具 | 安装方式 | 用途 |
|------|----------|------|
| flutter/agent-plugins | `git clone --depth 1`（构建脚本） | 内置 Skills |
| code-review-graph | `pip install code-review-graph` | MCP Server |
| serena | `uv tool install -p 3.13 serena-agent` | MCP Server |
| mem0 | `npm install mem0ai`（core 依赖） | 记忆层 SDK |
| openwiki | `npm install -g openwiki` | Wiki 生成 CLI |
| opencli | `npm install -g @jackwener/opencli` | 网站适配器 |
| od (open-design) | `npm install -g @anthropic-ai/od`（或从源安装） | 设计 MCP |
| CLI-Anything | 内置 SKILL.md + HARNESS.md（无需安装） | Skill 文件 |

## 十一、核心原则

1. **直接集成，不从零开发** — 所有 8 个项目均以 MCP/内置插件/SDK/Skill 形式直接嵌入
2. **flutter/agent-plugins 构建时安装** — 每次构建从源仓库拉取，不依赖远程插件中心
3. **code-review-graph 简化可视化** — 不要 D3.js 力导向图，只要 Mermaid 流程架构图
4. **open-design 只要设计+展示+文件交付** — 不集成整个应用，coding agent 读取设计文件实现
5. **暂不考虑远程插件中心** — 所有能力通过构建时内置或本地安装提供

---

> 关联文档：
> - [前期集成调研（5 项目）](../research/2026-07-open-source-integration-feasibility.md)
> - [OCR 集成 & Understand-Anything 分析](../research/2026-07-ocr-integration-and-ua-analysis.md)
