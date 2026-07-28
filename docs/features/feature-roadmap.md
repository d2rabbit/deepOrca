# Orca Feature 集成路线图（下阶段）

> 版本：v2.2 · 日期：2026-07-28 · 状态：规划中
> 本文件定义下阶段开源项目的**直接集成**方案。所有项目均为直接集成到 Orca 中，非从零开发。
> v2.1 更新：新增 Penpot vs Open Design 对比分析（选择 Open Design），新增 Obscura 轻量级无头浏览器集成，标记已集成项目。
> v2.2 更新：新增 3 个引擎层/方法论项目调研（Prewalk、OpenSpace、OpenSpec）——基于完整 README（webReader 抓取）的深度分析，含集成成本与实现形态判定。

---

## 总览

| # | 项目 | 集成形态 | 核心价值 | 优先级 | 状态 |
|---|------|----------|----------|--------|------|
| 1 | flutter/agent-plugins | 构建时内置 Skills | Flutter/Dart 开发能力包 | P0 | ✅ **已集成** |
| 2 | code-review-graph | 内置 MCP Server | 代码图谱 + 爆炸半径 + 简化架构图 | P0 | 📋 规划中 |
| 3 | serena | 内置 MCP Server | 符号级重构/导航/编辑 | P1 | 📋 规划中 |
| 4 | mem0 | core 层 SDK | 跨会话长期记忆 | P1 | 📋 规划中 |
| 5 | openwiki | 内置 CLI 工具 | 项目 Wiki 自动生成与维护 | P1 | ✅ **已集成** |
| 6 | opencli | 内置插件 | 100+ 网站适配器 + CLI Hub | P2 | 📋 规划中 |
| 7 | CLI-Anything | 内置 Skill | 万能 CLI 生成（Agent 驱动任意软件） | P2 | 📋 规划中 |
| 8 | open-design | MCP Server（设计+展示） | AI 设计生成 + 文件交付给 coding agent | P2 | 📋 规划中 |
| 9 | obscura | MCP Server + 内置 Skill | 轻量级无头浏览器（大规模数据获取） | P2 | 📋 规划中 |

**已集成项目说明**：
- ✅ **flutter/agent-plugins**：构建脚本 `scripts/install-flutter-skills.js`，已内置 26 个 Flutter/Dart Skills 到 `packages/core/templates/skills/bundled/`
- ✅ **openwiki**：vendored CLI（`packages/desktop/vendor/openwiki/`）+ 内置 Skill（`packages/core/templates/skills/bundled/openwiki/`）+ 桌面端 Wiki 面板集成

**额外已集成项目**（不在本路线图 9 个项目中）：
- ✅ **codegraph**：vendored CLI（`packages/desktop/vendor/codegraph/`）+ 桌面端代码图谱面板（作为 code-review-graph 的替代品，已提供代码索引和图谱能力）

---

## 总览 — 引擎能力演进项目（v2.2 新增）

> 以下 3 个项目**不是可安装的外部工具**，而是反映 coding-agent 引擎层的核心能力演进方向。它们的价值在于**方法论/机制**而非二进制依赖，与 DeepOrca 已有能力的冲突/互补关系见各章节。

| # | 项目 | 性质 | 对应的 DeepOrca 能力 | 关系 | 优先级 |
|---|------|------|----------------------|------|--------|
| A | Prewalk | 模型切换编排（贵模型规划→廉价模型执行） | 模型路由（仅轻量子任务用 flash） | 🟢 **互补/空白** — 无任何中途切换机制 | P1 |
| B | OpenSpace | 技能全生命周期（执行→评估→改进→复用） | 技能系统（仅静态编写/描述审查） | 🟢 **理念互补** — 无执行反馈闭环；⚠️ 直接集成成本高（Python+Cloud+架构重叠），仅借鉴理念 | P2 |
| C | OpenSpec | 规范驱动开发（spec 提案→实施→归档） | Plan Mode（提案→批准→执行） | 🟡 **部分重叠** — 流程已有但 spec 不持久化；Node 工具，可内置或借鉴 | P2 |

**核心判断**：三者均**不冲突**——它们填补的是 DeepOrca 当前**完全空白或半成品**的能力域，且可基于现有 `model-capabilities.ts`、skills 系统、Plan Mode 基础设施自然扩展。

---

## 一、flutter/agent-plugins — 构建时内置 AI 工具包

> 仓库：https://github.com/flutter/agent-plugins

### 作用

Flutter 官方 Agent 技能包，包含 10+ 个 SKILL.md（架构、布局、测试、路由、本地化、HTTP、表单、动画等）+ MCP 配置 + rules。让 Orca 在 Flutter/Dart 开发场景下具备专家级工作流指导。

### 与现有能力的适配度

| 维度 | 评估 |
|------|------|
| Skills 系统 | 🟢 完全兼容 — Orca 已扫描 `.agents/skills/` 和 `.deeporca/skills/` |
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

## 八、设计工具集成 — Penpot vs Open Design 对比与选择

> **决策结论**：**Open Design 更适合集成到 DeepOrca**，Penpot 作为备选方案暂不集成。
> **集成策略**：**优先使用 Open Design 的 Web 渲染模块**（内置 daemon server + iframe 嵌入），如果不可行则降级为完全自己实现 UI 渲染。

### 8.1 对比分析

| 维度 | Penpot | Open Design | 适配度评估 |
|------|--------|-------------|------------|
| **定位** | 开源 Figma 替代品（画布设计工具） | Agent 原生设计引擎（AI 驱动） | Open Design 更符合 DeepOrca 的 Agent 架构 |
| **集成方式** | 自托管 Web 应用 + API | MCP Server + CLI + Web UI + Daemon | Open Design 原生支持 MCP，集成更简单 |
| **设计流程** | 手动拖拽画布 | 自然语言 → AI 生成设计稿 | Open Design 自动化程度更高 |
| **输出格式** | SVG/CSS/HTML/JSON | HTML/CSS + DESIGN.md | 两者都输出标准 Web 格式 |
| **设计系统** | Design Tokens + Components | DESIGN.md 品牌契约（151 个系统） | Open Design 的 DESIGN.md 更易维护 |
| **协作模式** | 实时多人协作画布 | Git 版本控制 + 文件交付 | Open Design 更适合开发流程 |
| **技术栈** | Clojure/ClojureScript + PostgreSQL | Node.js + Express + Next.js 16 + React 18 + SQLite | Open Design 与 DeepOrca 技术栈更匹配 |
| **Agent 集成** | 需通过 API 调用 | 原生 MCP Server（`od mcp install`） | Open Design 开箱即用 |
| **许可** | MPL-2.0 | Apache-2.0 | 两者都是开源许可 |
| **部署复杂度** | 需 Docker/K8s 部署完整应用（前端+后端+PostgreSQL） | 本地 CLI + daemon（Express + SQLite） | Open Design 更轻量，可只启动 daemon |
| **文件交付** | 需导出设计文件 | 直接输出到文件系统 | Open Design 更直接 |
| **Web 渲染模块** | ClojureScript + React（rumext），复杂度高 | Next.js 16 + React 18 + iframe 沙箱 | Open Design 技术栈更现代、更易嵌入 |
| **内置 Server** | 需完整部署（前端+后端+数据库） | 本地 daemon（Express + SQLite），默认端口 7456 | Open Design 可只启动 daemon，无需完整部署 |
| **iframe 嵌入** | ❌ 有 CSP/X-Frame-Options 限制，社区反馈无法嵌入原型 | ✅ 原生支持 iframe 沙箱预览（sandboxed iframe） | Open Design 更适合嵌入 |
| **渲染模块独立性** | ❌ 无法独立运行，需完整部署 | ✅ daemon 可独立运行，Web UI 可通过 iframe 嵌入 | Open Design 更符合需求 |

### 8.2 为什么选择 Open Design

**核心优势**：
1. **Agent 原生架构**：Open Design 专为 coding agent 设计，通过 MCP Server 直接集成，无需额外 API 适配层
2. **零配置集成**：`od mcp install` 一行命令即可完成 MCP Server 配置，支持 25+ 主流 CLI agent
3. **设计即代码**：输出标准 HTML/CSS，coding agent 可直接读取并实现为 React/Vue/Next.js 组件
4. **DESIGN.md 品牌契约**：单一文件定义品牌规范，版本控制友好，与代码库同生命周期
5. **本地优先**：无需部署完整 Web 应用，本地 CLI + daemon 即可运行
6. **技术栈匹配**：Node.js + Express + Next.js 16 + React 18 + SQLite，与 DeepOrca 的技术栈完全一致
7. **Web 渲染模块可嵌入**：
   - Next.js 16 App Router + React 18，技术栈现代
   - 原生支持 iframe 沙箱预览（sandboxed iframe）
   - daemon 默认绑定 `127.0.0.1:7456`，支持 CORS 配置
   - 可通过 `OD_ALLOWED_ORIGINS` 配置允许的来源
8. **内置 daemon 可独立运行**：
   - Express + SQLite 本地服务器
   - 可作为 DeepOrca 的子进程启动
   - 无需部署完整 Web 应用（前端+后端+数据库）
   - 支持 HTTP + SSE 流式传输

**Penpot 的局限性**：
- ❌ 需要部署完整的 Web 应用（Docker/K8s），运维成本高
- ❌ 设计流程是手动拖拽画布，不符合 Agent 自动化理念
- ❌ 需要通过 API 调用，集成复杂度高
- ❌ Clojure/ClojureScript 技术栈与 DeepOrca 差异大
- ❌ **Web 渲染模块复杂**：ClojureScript + React（rumext 库），难以嵌入
- ❌ **iframe 嵌入受限**：有 CSP/X-Frame-Options 限制，社区反馈无法嵌入原型（GitHub Discussion #1085）
- ❌ **需完整部署**：前端 + 后端 + PostgreSQL，无法只启动渲染模块
- ❌ **渲染模块无法独立运行**：必须部署完整应用才能使用

### 8.3 Open Design 集成方案（Web 渲染模块嵌入）

> 仓库：https://github.com/nexu-io/open-design

#### 核心思路

**优先使用 Open Design 的 Web 渲染模块，内置启动 daemon server**：
- ✅ 使用 Open Design 的 MCP Server（设计生成逻辑）
- ✅ 使用 Open Design 的 Web UI（Next.js 16 + React 18）作为渲染模块
- ✅ 内置启动 Open Design daemon（Express + SQLite）作为子进程
- ✅ DeepOrca 桌面端通过 iframe 嵌入 Open Design 的预览页面
- ✅ 如果 Web 渲染模块无法嵌入，则降级为完全自己实现 UI 渲染

#### 作用

开源 Claude Design 替代品。Agent 原生设计引擎：自然语言 → HTML 原型/仪表盘/演示文稿/图片/视频。151 个设计系统包、100+ 功能技能、277 个插件。支持 MCP Server（`od mcp install <agent>`）。

**我们使用它的设计生成能力 + Web 渲染模块，通过内置 daemon server 提供预览服务。**

#### 与现有能力的适配度

| 维度 | 评估 |
|------|------|
| Designer 能力 | 🟢 直接填补 Feature Dev #4 |
| MCP 系统 | 🟢 原生支持 — `od mcp install` 一行命令 |
| 文件交付 | 🟢 输出 HTML/CSS 文件，coding agent 可直接读取实现 |
| Web 渲染模块 | 🟢 Next.js 16 + React 18 + iframe 沙箱，可嵌入 |
| 内置 Server | 🟢 Express + SQLite daemon，可作为子进程启动 |
| 桌面端展示 | 🟢 iframe 嵌入 Open Design 预览页面 |
| 运行时依赖 | 🟡 需安装 `od` CLI（Node.js + pnpm） |
| 许可 | Apache-2.0 |

#### 集成方案

**Phase 1 — MCP Server + Daemon 接入**：
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

同时启动 Open Design daemon 作为 DeepOrca 的子进程：
```typescript
// packages/desktop/src/main/open-design-daemon.ts
import { spawn } from "child_process";

export function startOpenDesignDaemon() {
  const daemon = spawn("od", ["daemon", "start", "--port", "7456"], {
    stdio: "inherit",
  });
  
  daemon.on("error", (err) => {
    console.error("Open Design daemon failed to start:", err);
  });
  
  return daemon;
}
```

**Phase 2 — DeepOrca 桌面端嵌入 Open Design 预览**：
```typescript
// packages/desktop/src/renderer/components/DesignPreviewPanel.tsx
function DesignPreviewPanel({ projectId }: { projectId: string }) {
  const previewUrl = `http://localhost:7456/projects/${projectId}/preview`;
  
  return (
    <div className="design-preview-panel">
      <iframe
        src={previewUrl}
        sandbox="allow-scripts allow-same-origin"
        style={{ width: "100%", height: "100%", border: "none" }}
      />
    </div>
  );
}
```

**Phase 3 — 设计→代码工作流**：
```
用户描述 → Agent 调用 OD MCP 生成设计 → 存入 OD daemon
→ DeepOrca 桌面端通过 iframe 嵌入 OD 预览页面
→ 用户确认 → coding agent 读取设计文件 → 实现为 React/Vue/Next.js 组件
```

**降级方案（如果 Web 渲染模块无法嵌入）**：
```typescript
// 如果 Open Design 的 Web UI 无法嵌入，则完全自己实现渲染
function DesignPreviewPanelFallback({ designPath }: { designPath: string }) {
  const [htmlContent, setHtmlContent] = useState<string>("");
  
  useEffect(() => {
    // 通过 IPC 读取 .deeporca/designs/ 下的 HTML 文件
    window.deeporca.readFile(designPath).then(setHtmlContent);
  }, [designPath]);
  
  return (
    <div className="design-preview-panel">
      <iframe
        sandbox="allow-scripts"
        srcDoc={htmlContent}
        style={{ width: "100%", height: "100%", border: "none" }}
      />
    </div>
  );
}
```

#### 技术实现要点

**内置 Daemon 生命周期管理**：
```typescript
// packages/desktop/src/main/index.ts
import { startOpenDesignDaemon } from "./open-design-daemon";

let odDaemon: ChildProcess | null = null;

app.whenReady().then(() => {
  // 启动 Open Design daemon
  odDaemon = startOpenDesignDaemon();
  
  createWindow();
});

app.on("will-quit", () => {
  // 关闭 Open Design daemon
  if (odDaemon) {
    odDaemon.kill();
  }
});
```

**iframe 嵌入配置**：
- Open Design daemon 默认绑定 `127.0.0.1:7456`
- 支持 iframe 沙箱预览（sandboxed iframe）
- 需要配置 CORS 允许 `localhost` 来源
- SSRF 保护默认阻止内部 IP，需配置 `OD_ALLOWED_ORIGINS`

**设计系统切换**：
```typescript
// 通过 Open Design API 切换设计系统
async function switchDesignSystem(projectId: string, systemId: string) {
  await fetch(`http://localhost:7456/api/projects/${projectId}/design-system`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemId }),
  });
}
```

**关键原则**：
- **优先使用 Open Design 的 Web 渲染模块**，通过内置 daemon + iframe 嵌入
- **如果无法嵌入**，则降级为完全自己实现 UI 渲染
- Open Design daemon 作为 DeepOrca 的子进程运行
- 用户看到的预览界面是 Open Design 的 Web UI，但嵌入在 DeepOrca 的桌面端中
- 设计生成逻辑完全由 Open Design MCP Server 提供

---

## 九、Obscura — 轻量级无头浏览器（Web 自动化与数据获取）

> 仓库：https://github.com/h4ckf0r0day/obscura

### 9.1 作用与价值

Obscura 是用 Rust 编写的开源无头浏览器引擎，专为 Web 抓取和 AI Agent 自动化设计。它通过 V8 运行真实 JavaScript，支持 Chrome DevTools Protocol (CDP)，可作为 Puppeteer 和 Playwright 的直接替代品。

**核心优势**：
- **极轻量**：内存占用仅 30MB（Chrome 200+MB），二进制大小 70MB（Chrome 300+MB）
- **极速**：页面加载 85ms（Chrome ~500ms），启动即时（Chrome ~2s）
- **内置反检测**：Stealth 模式提供指纹随机化、User-Agent 伪装、追踪器拦截
- **MCP 原生支持**：内置 MCP Server，可直接集成到 DeepOrca
- **零依赖**：无需 Chrome、Node.js，单二进制文件即可运行

### 9.2 与现有能力的适配度

| 维度 | 评估 |
|------|------|
| browser-skill | 🟡 有重叠但互补 — Obscura 更轻量、更快速，适合大规模数据获取 |
| MCP 系统 | 🟢 原生兼容 — 内置 stdio/HTTP MCP Server |
| bash 工具 | 🟢 可通过 bash 直接调用 `obscura fetch/scrape` 命令 |
| 运行时依赖 | 🟢 零依赖 — 单二进制文件，无需 Chrome/Node.js |
| 性能 | 🟢 内存占用仅为 Chrome 的 15%，速度快 6 倍 |
| 反检测 | 🟢 内置 Stealth 模式，适合抓取有反爬虫的网站 |
| 许可 | Apache-2.0 |

### 9.3 集成方案

**核心思路**：Obscura 作为 browser-skill 的补充，专注于**大规模数据获取**和**反爬虫场景**，而 browser-skill 继续负责**通用页面操控**（表单填写、UI 测试、截图等）。

**Phase 1 — MCP Server 接入**：
```json
{
  "mcpServers": {
    "obscura": {
      "command": "obscura",
      "args": ["mcp"]
    }
  }
}
```

Agent 通过 MCP 工具调用浏览器自动化：
- `browser_navigate` — 导航到 URL
- `browser_snapshot` — 获取页面文本内容
- `browser_evaluate` — 执行 JavaScript 表达式
- `browser_network_requests` — 查看网络请求

**Phase 2 — 内置 Skill 联动**：
编写 `obscura-skill` SKILL.md，教 Agent：
- 大规模数据抓取 → 用 `obscura scrape` 命令（支持并发 25+）
- 反爬虫网站 → 启用 `--stealth` 模式
- 结构化数据提取 → 用 `--eval` 执行 JavaScript 提取 DOM 数据
- 通用页面操控 → 继续用 browser-skill（表单填写、UI 测试）

**Phase 3 — 桌面端集成**（可选）：
- 新增「Web 抓取」面板，展示抓取任务列表和结果
- 支持配置代理、User-Agent、Stealth 模式
- 抓取结果可直接导出为 JSON/CSV

### 9.4 使用场景

**适合用 Obscura**：
- 大规模数据抓取（100+ 页面，并发 25+）
- 有反爬虫的网站（需要 Stealth 模式）
- 性能敏感场景（内存/速度要求高）
- 结构化数据提取（JSON/API 数据）

**适合用 browser-skill**：
- 通用页面操控（表单填写、按钮点击）
- UI 自动化测试
- 页面截图和 PDF 生成
- 复杂的用户交互流程

### 9.5 与 browser-skill 的协同分工

```
用户请求 → Agent 判断任务类型
  ├─ 大规模数据获取/反爬虫 → Obscura（轻量、快速、Stealth）
  └─ 通用页面操控/UI 测试 → browser-skill（功能全面、易用）
```

**示例**：
- 「抓取 100 个商品页面的价格信息」→ Obscura（并发抓取 + Stealth）
- 「登录网站并填写表单」→ browser-skill（通用页面操控）
- 「抓取需要登录的数据」→ browser-skill 登录 → Obscura 抓取（复用会话）

---

## A、Prewalk — 模型切换编排（贵模型规划→廉价模型执行）

> 来源：https://stencil.so/blog/prewalk · 性质：**编排方法论**，非可安装工具

### 作用

Prewalk 是一种 coding-agent 的**模型切换编排技术**，解决"用贵模型读代码写计划、交给廉价模型执行反而更贵"的问题（廉价模型要重新读一遍代码库，贵模型的读取成本被重复支付）。

核心机制：
1. 贵模型（frontier）带着隐藏指令"深度规划→生成 TODO 列表→开始执行"启动
2. 贵模型探索代码、写计划、初始化 TODO、做出**第一处代码编辑**
3. 在第一处编辑发生的瞬间，系统将活动模型**切换**为廉价模型，并从共享上下文中删除初始规划指令
4. 廉价模型"以为自己一直在执行"，继承了已验证的有效上下文

作者声称：达到 frontier 97% 性能，成本降低 41%，速度提升 1.9×。

### 与现有能力的关系

| DeepOrca 现状 | Prewalk 对应能力 | 关系 |
|---------------|------------------|------|
| `model-capabilities.ts` 将**轻量子任务**（技能匹配、prompt 增强、压缩）固定路由到 flash | **主任务中途**的模型切换（规划段→执行段） | 🟢 互补 — DeepOrca 只有"子任务降级"，**无任何主任务中途切换机制** |
| 主循环（`session.ts` activateSession）全程跑单一用户配置模型 | 首次编辑触发的模型降级 | 🟢 空白 — 完全未实现 |
| UpdatePlan 工具（执行中的 TODO 进度跟踪） | Prewalk 依赖的 TODO 列表作为切换后的"永久方向盘" | 🟢 可复用 — UpdatePlan 已是 markdown TODO 跟踪，正是 Prewalk 需要的载体 |

**关键发现**：`session.ts` 中搜索 `handoff`/`escalat`/`switchModel`/`tier` 零匹配——**模型中途切换在 DeepOrca 是完全空白的领域**。而 UpdatePlan 工具已经提供了 Prewalk 机制所需的 TODO 跟踪基础设施。

### 冲突 vs 互补判断

**🟢 纯互补，零冲突。**
- 不与现有模型路由冲突（现有是子任务降级，Prewalk 是主任务分段）
- 不与 Plan Mode 冲突（Plan Mode 是人工批准的提案→执行，Prewalk 是自动的规划段→执行段切换）
- 复用已有基础设施（UpdatePlan 的 TODO 跟踪、`model-capabilities.ts` 的模型常量）

### 集成借鉴方向（非直接安装，是引擎能力演进）

**Phase 1 — 会话级模型配置（前置条件）**：
当前主循环只用单一模型。需先支持"规划模型"与"执行模型"的双模型配置：
```typescript
// settings.json 扩展
{
  "model": "deepseek-v4-pro",           // 主/执行模型
  "planningModel": "deepseek-v4-pro"    // 规划段模型（可选，默认同 model）
}
```

**Phase 2 — Prewalk 切换点**：
在 `activateSession` 循环中，检测"首次工具调用产生文件编辑"作为切换信号：
- 切换前：注入隐藏的"深度规划+TODO"系统指令
- 切换时：从消息历史中移除规划指令，切换 `model` 为执行模型
- 切换后：廉价模型继承 UpdatePlan 的 TODO 作为持续引导

**Phase 3 — 自适应切换策略**：
基于任务复杂度决定是否启用 Prewalk（简单任务不必切换，复杂任务才分阶段）。

---

## B、OpenSpace — 技能全生命周期（执行→评估→改进→复用）

> 仓库：https://github.com/HKUDS/OpenSpace · 出品方：香港大学数据科学实验室（LightRAG 同团队）· 性质：**自演化技能引擎**，可作 MCP 集成

### 作用

OpenSpace 定位为"AI Agent 的技能管理层"，提供技能全生命周期的四个能力：
1. **技能执行** — 在 agent 工作流中运行已定义的技能/工具
2. **技能评估** — 验证哪些技能在实践中真正有效（测试 + 可观测性）
3. **技能改进** — 基于执行反馈精炼技能（自演化闭环）
4. **技能复用** — 跨任务/跨 agent 检索和重用已习得的模式（集体智能/共享技能注册表）

架构分三层：Grounding 层（环境后端）、Skill 层（注册/索引/检索/版本化）、Evolution 层（自改进闭环）。声称减少 ~46% token、输出质量提升 ~4.2×。

### 与现有能力的关系

| DeepOrca 现状 | OpenSpace 对应能力 | 关系 |
|---------------|---------------------|------|
| `skill-writer`（编写 SKILL.md 的静态指南） | 技能**创建** | 🟢 部分覆盖 — DeepOrca 有人工编写，无自动生成 |
| `skill-digester`（审查/重写技能的 description 字段，需人工批准） | 技能**改进**（基于文本启发式） | 🟡 弱重叠 — digester 改描述文案，不改技能实质 |
| 无执行结果捕获、无技能成功率指标、无基于表现的自动重写 | 技能**评估** + 基于**执行结果**的自改进 | 🟢 空白 — 搜索 `skillEvaluat`/`self-evolv`/`feedback loop` 零匹配 |

**关键发现**：DeepOrca 的"技能改进"完全是人工发起的（通过 skill-digester），基于静态文本启发式，**没有任何基于执行结果的能力评估或自演化闭环**。这是 OpenSpace 的核心差异点。

### 冲突 vs 互补判断

**🟢 互补为主，需注意与 mem0 的定位边界。**
- 与 skills 系统**不冲突**（OpenSpace 是其上层的生命周期管理，不替换扫描/加载机制）
- 与路线图 #4 **mem0（跨会话记忆）有功能边界**：mem0 记"事实/偏好"，OpenSpace 记"技能/工作流"。需明确分工，避免两个"记忆层"职责模糊
- 与 skill-digester **轻微重叠**但可融合：digester 的描述审查可成为 OpenSpace 评估环节的一部分

### 集成借鉴方向

**方向一（轻量借鉴，推荐）— 自建轻量评估闭环**：
不引入 OpenSpace 整体，借鉴其"执行→评估→改进"理念：
- 技能执行后捕获结果（成功/失败/重试次数）
- 低成功率技能触发 skill-digester 自动重写 description
- 高成功率技能在技能匹配时加权

**⚠️ 集成成本警告（基于完整 README）— 不推荐直接集成 OpenSpace**：
OpenSpace 不适合作为 MCP/依赖直接集成，原因：
- **Python 3.12+ 依赖**（`pip install -e .`）——违背 DeepOrca "零外部依赖"原则，且 Python 运行时正是我们刚在 codegraph/openwiki 上努力消除的东西
- **Cloud 依赖**：技能质量评估、演化 lineage、跨 agent 共享依赖 open-space.cloud 云服务（可选，但核心价值在这）
- **它本身是个完整的 agent harness**（grounding/agents/execution lifecycle + Dashboard）——与 DeepOrca 的 session loop **架构重叠**，不只是"技能管理层"

**结论**：只借鉴 OpenSpace 的设计理念（FIX/DERIVED/CAPTURED 演化触发器、provisional→trusted 信任状态机），在 DeepOrca 内部用 Node.js 自建轻量版。

---

## C、OpenSpec — 规范驱动开发（spec 提案→实施→归档）

> 仓库：https://github.com/Fission-AI/OpenSpec · 性质：**CLI 工具 + 工作流方法论**，spec-first 开发范式

### 作用

OpenSpec 将编程问题转化为**需求工程问题**——确保人与 AI 在写代码前就需求达成一致。核心是 spec-driven development (SDD) 三步工作流：
1. **Proposal** — 创建 markdown 规范文档描述要构建什么
2. **Apply** — AI 基于已批准的 spec 实现代码
3. **Archive** — 完成的 spec 归档，保持清晰的历史记录

特点：CLI-first（agent 通过读写文件交互）、无需 API key/MCP、分层 spec（agent 只读当前任务相关的 spec）、保持人机对齐的"单一真相源"。MCP Server 支持是路线图项（Issue #319）。

### 与现有能力的关系

| DeepOrca 现状 | OpenSpec 对应能力 | 关系 |
|---------------|---------------------|------|
| **Plan Mode**（提案→批准→执行，有变更守卫） | Proposal→Apply 工作流 | 🟡 **高度重叠** — 流程模型已存在且较成熟 |
| `<proposed_plan>` 渲染在聊天中，靠 renderer 正则提取 | 持久化、版本化的 spec 文档 | 🔴 **DeepOrca 的短板** — spec 是临时的，不持久化/不版本化 |
| UpdatePlan（执行中的 TODO 进度，非持久 UI 元数据） | 分层 spec + 变更请求谱系 | 🔴 **DeepOrca 的短板** — 无 spec→变更请求→产物的谱系追踪 |
| Plan Mode 强制 write/delete/git 权限升级为 ask | spec 作为"单一真相源"的治理 | 🟢 协同 — 权限强制机制已有 |

**关键发现**：DeepOrca 的 Plan Mode 已经实现了 spec-driven 的**协作模型和权限守卫**（这是 OpenSpec 的核心价值），但在**spec 持久化和谱系治理**上是短板——`<proposed_plan>` 是聊天气泡里的临时内容，UpdatePlan 状态是非持久 UI 元数据。

### 冲突 vs 互补判断

**🟡 部分重叠，互补空间在持久化和治理。**
- **不冲突**：OpenSpec 的三步流程与 Plan Mode 的提案→批准→执行理念一致，是同一范式的不同实现
- **重叠点**：两者都解决"先对齐再动手"，DeepOrca 已有成熟实现，**不应引入 OpenSpec 替换 Plan Mode**
- **互补点**：OpenSpec 的**持久化 spec 文档 + 分层结构 + 归档历史 + 变更请求谱系**正是 Plan Mode 缺失的——可借鉴其理念增强 Plan Mode，而非引入整个工具

### 集成借鉴方向（增强现有 Plan Mode，非引入 OpenSpec）

**📖 README 补充发现（webReader 抓取）**：
- **新增 artifact-guided 工作流**：`/opsx:explore`（无 stakes 探索）→ `/opsx:propose` → `/opsx:apply` → `/opsx:archive`，**与 DeepOrca 的 Plan Mode 三阶段（探索→对齐→实施）几乎一一对应**
- **Stores（beta）**：跨 repo 的 spec 共享——一个 plan 仓库供多 repo 的 agent 读取，对 monorepo 场景有价值
- **变更产物结构清晰**：每个 change 一个文件夹（`proposal.md` + `specs/` + `design.md` + `tasks.md`），正是"spec 持久化"需要的形态
- **确认是 Node.js 工具**（`npm install -g @fission-ai/openspec`，Node ≥ 20.19）——技术栈匹配，**可作为 npm 依赖内置**（和 ocr 同模式）

**两条可选路径**：

**路径 A（借鉴理念，推荐先做）— 增强 Plan Mode**：

**Phase 1 — spec 持久化**：
将 `<proposed_plan>` 从临时聊天内容改为持久化文件：
```
.deeporca/plans/
├── 2026-07-28-electron-upgrade.md    # 带 "决策完成" 的 spec
└── archive/                           # 已完成的归档
```

**Phase 2 — 分层 spec 与谱系**：
借鉴 OpenSpec 的分层结构，大型任务支持 spec 拆分为子需求，记录 spec→实施→产物的关联（哪些文件因哪个 spec 而变更）。

**Phase 3 — spec 复用**：
归档的 spec 可在新会话中被检索引用（与 mem0 的记忆能力协同），避免重复规划。

**路径 B（深度集成，可选）— OpenSpec CLI 作为内置 npm 依赖**：
因 OpenSpec 是 Node.js 工具（Node ≥ 20.19，与 Electron 35 自带 Node 22 匹配），可像 ocr 那样作为 npm 依赖内置：
```bash
npm install @fission-ai/openspec  # 作为 desktop 依赖
```
- Plan Mode 作为 OpenSpec 的入口（用户触发 `/plan` → 生成 OpenSpec change）
- 获得 OpenSpec 成熟的 spec 持久化/归档/Stores 能力，不自建
- 复用 DeepOrca 的 `ELECTRON_RUN_AS_NODE` 模式跑 OpenSpec CLI（零外部 Node 依赖）
- **取舍**：引入外部依赖 vs 自建轻量版；需评估 OpenSpec 的 MCP Server 路线图（Issue #319）成熟度后再定

---



```
Phase 1（立即）                Phase 2（+2周）              Phase 3（+1月）
├── flutter/agent-plugins ──┤                              │
│   构建时内置 Skills        │
├── code-review-graph ──────┤
│   MCP 预配置 + 审查增强    │
├── serena ─────────────────┤
│   MCP 预配置 + Skill       │
│                            ├── mem0 SDK 集成 ─────────────┤
│                            ├── openwiki CLI 内置 ─────────┤
│                            ├── opencli 内置插件 ──────────┤
│                            ├── obscura MCP + Skill ───────┤
│                            │                              ├── 知识中心融合
│                            │                              │   (CRG+Wiki+mem0)
│                            │                              ├── open-design MCP
│                            │                              │   设计→代码工作流
│                            │                              ├── CLI-Anything Skill
│                            │                              │   /cli-anything 命令
│                            │                              ├── 架构图面板
│                            │                              │   (Mermaid 简化渲染)
│                            │                              ├── Web 抓取面板
│                            │                              │   (Obscura 桌面端集成)
│
│  ── 引擎能力演进（v2.2 新增，非工具安装）──────────────────────
├── Prewalk 模型切换 ────────┤
│   双模型配置 + 首次编辑切换  │
├── OpenSpec spec 持久化 ────┤
│   Plan Mode 增强(非替换)    │
│                            ├── OpenSpace 技能评估闭环 ────┤
│                            │   执行结果捕获+自动重写       │
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
| obscura | 下载二进制文件（无需安装） | 无头浏览器 MCP |
| CLI-Anything | 内置 SKILL.md + HARNESS.md（无需安装） | Skill 文件 |

## 十二、核心原则

1. **直接集成，不从零开发** — 所有 9 个项目均以 MCP/内置插件/SDK/Skill 形式直接嵌入
2. **flutter/agent-plugins 构建时安装** — 每次构建从源仓库拉取，不依赖远程插件中心
3. **code-review-graph 简化可视化** — 不要 D3.js 力导向图，只要 Mermaid 流程架构图
4. **open-design 优先使用 Web 渲染模块** — 内置启动 Open Design daemon server，通过 iframe 嵌入其 Next.js 预览页面；如果无法嵌入，则降级为完全自己实现 UI 渲染
5. **obscura 专注大规模数据获取** — 与 browser-skill 互补，Obscura 负责抓取，browser-skill 负责操控
6. **暂不考虑远程插件中心** — 所有能力通过构建时内置或本地安装提供

### 引擎能力演进原则（v2.2 新增）

7. **Prewalk 是方法论不是工具** — 模型中途切换是引擎能力演进，基于已有 `model-capabilities.ts` + UpdatePlan 扩展，不引入外部依赖
8. **OpenSpec 增强 Plan Mode 而非替换** — DeepOrca 已有成熟的提案→批准→执行流程，借鉴 OpenSpec 的 spec 持久化/分层/归档理念增强，不引入 OpenSpec CLI
9. **OpenSpace 与 mem0 明确分工** — mem0 记"事实/偏好"，OpenSpace 记"技能/工作流"；优先自建轻量技能评估闭环，深度集成作为可选项
10. **三者均不冲突** — Prewalk/OpenSpace 填补完全空白域，OpenSpec 补齐 Plan Mode 持久化短板，可并行推进

---

> 关联文档：
> - [前期集成调研（5 项目）](../research/2026-07-open-source-integration-feasibility.md)
> - [OCR 集成 & Understand-Anything 分析](../research/2026-07-ocr-integration-and-ua-analysis.md)
