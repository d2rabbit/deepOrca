# Orca Feature 集成路线图（下阶段）

> 版本：v2.1 · 日期：2026-07-26 · 状态：规划中
> 本文件定义下阶段 9 个开源项目的**直接集成**方案。所有项目均为直接集成到 Orca 中，非从零开发。
> v2.1 更新：新增 Penpot vs Open Design 对比分析（选择 Open Design），新增 Obscura 轻量级无头浏览器集成，标记已集成项目。

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
    // 通过 IPC 读取 .deepcode/designs/ 下的 HTML 文件
    window.deepcode.readFile(designPath).then(setHtmlContent);
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

## 十、集成优先级路线图

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

---

> 关联文档：
> - [前期集成调研（5 项目）](../research/2026-07-open-source-integration-feasibility.md)
> - [OCR 集成 & Understand-Anything 分析](../research/2026-07-ocr-integration-and-ua-analysis.md)
