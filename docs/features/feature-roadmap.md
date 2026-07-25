# Orca Feature 规划与集成路线图

> 版本：v1.0 · 日期：2026-07-21 · 状态：规划中

---

## 一、近期开发（Feature Dev）

### 1. 远程插件中心集成

**目标**：在线插件市场，支持一键安装/更新社区 Skills、MCP 服务器和内置插件。

| 维度 | 说明 |
|------|------|
| 核心能力 | 插件发现、版本管理、一键安装/更新、评分/评论、依赖解析 |
| 技术方案 | 后端 Registry API + 桌面端 Plugin Store 面板 + CLI `deepcode plugin install` |
| 参考 | VSCode Marketplace、npm registry、flutter/agent-plugins 的 `npx skills add` 模式 |
| 优先级 | P0 — 生态基础设施 |
| 状态 | 🔨 规划中 |

### 2. 自定义 CLI 与指令

**目标**：用户可注册自定义斜杠命令和 CLI 子命令，扩展 Agent 工作流。

| 维度 | 说明 |
|------|------|
| 核心能力 | 命令注册协议、参数解析、权限继承、组合命令（pipeline） |
| 技术方案 | `.deepcode/commands/` 目录 + YAML/JSON 命令定义 + commander 子命令动态注册 |
| 参考 | opencli 的 adapter 注册模式、CLI-Anything 的 HARNESS.md 方法论 |
| 优先级 | P1 — 用户自定义工作流 |
| 状态 | 🔨 规划中 |

### 3. 项目图谱与沉浸式 Wiki（知识中心）

**目标**：代码知识图谱可视化 + 项目级知识沉淀，类似 Qoder 知识中心。

| 维度 | 说明 |
|------|------|
| 核心能力 | 代码结构图谱、模块关系可视化、知识卡片沉淀、跨会话知识积累 |
| 技术方案 | Tree-sitter AST → 图数据库(SQLite) → D3.js 可视化 + Markdown Wiki 生成 |
| 参考 | code-review-graph（图谱+Wiki）、Understand-Anything（Tree-sitter+LLM）、mem0（记忆层） |
| 优先级 | P1 — 需深度设计 |
| 状态 | 📐 设计中 |

> ⚠️ 此功能需要详细设计文档，涉及图谱存储格式、增量更新策略、知识提取管线等核心决策。

### 4. Designer 能力

**目标**：AI 驱动的 UI 设计生成，从自然语言描述到可预览的界面原型。

| 维度 | 说明 |
|------|------|
| 核心能力 | 自然语言→HTML/React 原型、设计系统约束、实时预览、导出 |
| 技术方案 | MCP Server 接入 Open Design / 内置 Skill + iframe 沙箱预览 |
| 参考 | Open Design（od mcp）、Pencil CLI、v0.dev |
| 优先级 | P2 — 互补型能力 |
| 状态 | 🔨 规划中 |

---

## 二、后期特性（Feature Backlog）— 开源项目集成调研

### 1. code-review-graph（代码审查图谱）

> 仓库：https://github.com/tirth8205/code-review-graph

#### 项目概述

Local-first 代码智能图谱，为 MCP 和 CLI 构建持久化代码结构映射。使用 Tree-sitter 解析 AST，追踪增量变更，通过 MCP 为 AI 助手提供精准上下文。

#### 核心能力

| 能力 | 说明 |
|------|------|
| 爆炸半径分析 | 变更影响范围追踪（caller/dependent/test） |
| 增量更新 | < 2 秒增量重建（SHA-256 哈希检测） |
| 30 个 MCP 工具 | 图谱查询、语义搜索、社区检测、架构概览、Wiki 生成等 |
| 风险评分审查 | detect_changes → 受影响函数 + 执行流 + 测试缺口 |
| 多语言支持 | 35+ 语言（Python/JS/TS/Go/Rust/Java/C/C++/...） |
| 可视化 | D3.js 力导向图 + GraphML/Neo4j/Obsidian/SVG 导出 |
| Wiki 生成 | 从社区结构自动生成 Markdown Wiki |
| GitHub Action | CI 中风险评分 PR 审查 |
| 多仓库守护进程 | crg-daemon 后台监控多仓库 |

#### 技术栈

| 维度 | 详情 |
|------|------|
| 语言 | Python 3.10+ |
| 存储 | SQLite（local-first，零外部依赖） |
| 解析 | Tree-sitter（tree_sitter_language_pack） |
| 接口 | MCP Server（stdio）+ CLI |
| 许可 | MIT |
| 安装 | `pip install code-review-graph` |

#### 与 Orca 的集成度评估

| 维度 | 评估 | 说明 |
|------|------|------|
| 功能重叠 | 🟡 中 | 与现有 CodeGraph 索引模块有重叠（都是代码结构索引） |
| 互补价值 | 🟢 高 | 爆炸半径、风险评分、Wiki 生成是 CodeGraph 不具备的 |
| 技术兼容 | 🟢 高 | MCP Server 原生支持，可直接配置接入 |
| 集成成本 | 🟢 低 | 配置文件级别（settings.json mcpServers） |
| 运行时依赖 | 🟡 中 | 需要 Python 3.10+ 环境 |

#### 推荐集成方案

**Phase 1 — MCP Server 接入**（配置级，< 1 小时）：
```json
{
  "mcpServers": {
    "code-review-graph": {
      "command": "code-review-graph",
      "args": ["serve"]
    }
  }
}
```

**Phase 2 — 增强代码审查面板**：将 CRG 的 `detect_changes` + `get_impact_radius` 与现有 OCR 审查面板结合，在审查意见旁展示影响范围图。

**Phase 3 — 替代/增强 CodeGraph**：评估 CRG 的 Wiki 生成 + 社区检测能力是否可替代现有 CodeGraph 索引模块。

---

### 2. flutter/agent-plugins（Agent 插件协议）

> 仓库：https://github.com/flutter/agent-plugins/tree/main

#### 项目概述

Flutter 官方维护的 Agent 插件集合。定义了标准化的 Agent Skills 打包格式：skills + MCP server 配置 + rules 的组合体。

#### 核心能力

| 能力 | 说明 |
|------|------|
| 标准化插件格式 | skills/ 目录 + .mcp.json + rules 三合一 |
| 跨 Agent 兼容 | 支持 Claude Code、Codex、Cursor、通用 `.agents/skills/` |
| 安装协议 | `npx skills@1.5.17 add flutter/agent-plugins --skill '*' --agent universal` |
| 10+ Flutter Skills | 架构、布局、测试、路由、本地化、HTTP 等 |
| MCP Server 配置 | 自动配置 Dart/Flutter MCP 工具 |

#### 技术栈

| 维度 | 详情 |
|------|------|
| 格式 | Markdown (SKILL.md) + JSON (.mcp.json) |
| 分发 | npx skills CLI / Claude plugin marketplace / Codex plugin |
| 许可 | BSD-3-Clause |
| 依赖 | 零运行时依赖（纯文档 + 配置） |

#### 与 Orca 的集成度评估

| 维度 | 评估 | 说明 |
|------|------|------|
| 功能重叠 | 🟢 低 | Orca 已有 Skills 系统，但缺少标准化市场协议 |
| 互补价值 | 🟢 高 | 插件分发标准 + 跨 Agent 互操作 |
| 技术兼容 | 🟢 极高 | Orca 已扫描 `.agents/skills/`，天然兼容 |
| 集成成本 | 🟢 极低 | 零代码 — 已兼容 |
| 战略价值 | 🟢 高 | 远程插件中心的标准参考 |

#### 推荐集成方案

**直接兼容**：Orca 已支持 `.agents/skills/` 目录扫描，flutter/agent-plugins 的 skills 可直接使用。

**战略参考**：其 `npx skills add` 分发模式 + `plugin marketplace` 概念是远程插件中心（Feature Dev #1）的核心参考。建议：
- 采用相同的 `skills@x.x.x add` CLI 协议
- 支持 `--agent universal` 标准目录
- 兼容 `.mcp.json` 自动配置

---

### 3. serena（语义代码导航与编辑）

> 仓库：https://github.com/oraios/serena

#### 项目概述

"Agent 的 IDE"——通过 MCP 提供语义级代码检索、编辑、重构和调试工具。基于 LSP（Language Server Protocol）实现符号级操作，让 Agent 像使用 IDE 一样操作代码。

#### 核心能力

| 能力 | 说明 |
|------|------|
| 符号检索 | find symbol / file outline / references / declaration / implementations |
| 符号编辑 | replace symbol body / insert before/after / safe delete |
| 重构 | rename（跨文件）、move、inline（JetBrains 后端） |
| 调试 | 断点、变量检查、表达式求值（JetBrains 后端） |
| 记忆系统 | 跨会话知识持久化 |
| 40+ 语言 | 通过 LSP 支持几乎所有主流语言 |
| 多层配置 | global / CLI / per-project / context-specific / modes |

#### 技术栈

| 维度 | 详情 |
|------|------|
| 语言 | Python 3.13 |
| 后端 | LSP（开源）/ JetBrains Plugin（付费） |
| 接口 | MCP Server（stdio / HTTP） |
| 安装 | `uv tool install -p 3.13 serena-agent` |
| 许可 | Apache-2.0 |

#### 与 Orca 的集成度评估

| 维度 | 评估 | 说明 |
|------|------|------|
| 功能重叠 | 🟡 中 | Orca 的 read/edit 工具是文本级，serena 是符号级 — 互补而非重叠 |
| 互补价值 | 🟢 极高 | 跨文件 rename、引用查找、类型层次 — Agent 编码质量飞跃 |
| 技术兼容 | 🟢 高 | MCP Server 原生支持 |
| 集成成本 | 🟢 低 | 配置级（需 Python 3.13 + uv） |
| 运行时依赖 | 🟡 中 | 需要各语言的 LSP server（自动安装） |

#### 推荐集成方案

**Phase 1 — MCP Server 接入**（推荐，配置级）：
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

**Phase 2 — 内置 Skill**：编写 `serena-skill` 教 Agent 何时使用符号级操作（重构、跨文件修改）vs 文本级操作（简单编辑）。

**Phase 3 — 深度集成**：评估将 serena 的符号编辑能力整合到桌面端编辑体验中（重构预览面板）。

---

### 4. opencli（网站→CLI + 浏览器自动化）

> 仓库：https://github.com/jackwener/opencli

#### 项目概述

将任意网站转换为 CLI 命令 + 在用户已登录的 Chrome 上执行 Browser Use。支持 100+ 网站适配器（Bilibili、知乎、小红书、Twitter、Reddit 等），同时提供 CLI Hub 统一入口。

#### 核心能力

| 能力 | 说明 |
|------|------|
| 网站适配器 | 100+ 内置站点命令（bilibili/zhihu/twitter/reddit/...） |
| Browser Use | AI Agent 操控已登录 Chrome（navigate/click/fill/extract） |
| CLI Hub | 统一 passthrough（gh/docker/vercel/tg/discord/...） |
| 桌面应用适配 | Electron 应用操控（Cursor/Codex/ChatGPT/...） |
| 插件系统 | `opencli plugin install github:user/repo` |
| Agent Skills | 6 个 SKILL.md（browser/adapter-author/autofix/sitemap/usage） |
| 下载支持 | 图片/视频/文章多平台下载 |

#### 技术栈

| 维度 | 详情 |
|------|------|
| 语言 | Node.js >= 20（TypeScript） |
| 浏览器桥接 | Chrome Extension + 本地 daemon（WebSocket） |
| 分发 | npm `@jackwener/opencli` / OpenCLIApp（桌面） |
| 许可 | Apache-2.0 |

#### 与 Orca 的集成度评估

| 维度 | 评估 | 说明 |
|------|------|------|
| 功能重叠 | 🟡 中 | 与 browser-skill 内置插件有重叠（都是浏览器自动化） |
| 互补价值 | 🟢 高 | 100+ 网站适配器 + CLI Hub 是 browser-skill 不具备的 |
| 技术兼容 | 🟢 高 | Node.js 生态，npm 安装 |
| 集成成本 | 🟢 低 | Skill 安装 + npm 全局包 |
| 差异化 | 🟢 明确 | opencli 偏"网站数据获取"，browser-skill 偏"通用页面操控" |

#### 推荐集成方案

**Phase 1 — Agent Skill 安装**：
```bash
npx skills add jackwener/opencli
```
Agent 即可通过 bash 工具执行 `opencli bilibili hot`、`opencli browser` 等命令。

**Phase 2 — 与 browser-skill 互补定位**：
- browser-skill：通用页面操控（表单填写、UI 测试、截图）
- opencli：结构化数据获取（热门列表、搜索、下载）+ 已登录会话复用

**Phase 3 — CLI Hub 集成**：评估将 opencli 的 `external register` 模式引入 Orca 的自定义指令系统（Feature Dev #2）。

---

### 5. mem0（AI 记忆层）

> 仓库：https://github.com/mem0ai/mem0

#### 项目概述

通用 AI 记忆层——为 Agent 提供跨会话的长期记忆能力。支持 User/Session/Agent 三级记忆，具备实体链接、时间推理、多信号检索（语义+BM25+实体）。

#### 核心能力

| 能力 | 说明 |
|------|------|
| 多级记忆 | User / Session / Agent 三层状态 |
| 智能提取 | 单次 LLM 调用提取事实（ADD-only，不覆盖） |
| 实体链接 | 跨记忆实体关联 + 检索增强 |
| 多信号检索 | 语义 + BM25 关键词 + 实体匹配并行融合 |
| 时间推理 | 时间感知检索（当前状态/过去事件/未来计划） |
| 部署灵活 | Library(pip/npm) / Self-Hosted(Docker) / Cloud(app.mem0.ai) |
| CLI | `mem0 add/search/init` 命令行管理 |
| Agent Skills | 6 个 SKILL.md（mem0/integrate/test/oss-to-platform/...） |
| Benchmark | LoCoMo 92.5 / LongMemEval 94.4 |

#### 技术栈

| 维度 | 详情 |
|------|------|
| 语言 | Python（核心）+ npm SDK |
| 向量存储 | Qdrant / Chroma / 内置 |
| LLM 依赖 | 需要 LLM 做记忆提取（默认 gpt-5-mini，可配置） |
| 接口 | Python SDK / npm SDK / REST API / CLI |
| 许可 | Apache-2.0 |

#### 与 Orca 的集成度评估

| 维度 | 评估 | 说明 |
|------|------|------|
| 功能重叠 | 🟢 低 | Orca 有会话持久化但无智能记忆提取/检索 |
| 互补价值 | 🟢 极高 | 跨会话知识积累 — Agent 越用越懂项目 |
| 技术兼容 | 🟢 高 | npm SDK 可用，CLI 可通过 bash 调用 |
| 集成成本 | 🟡 中 | 需要 LLM 端点配置 + 向量存储 |
| 隐私考量 | 🟡 中 | 记忆数据需本地存储（Self-Hosted 或 Library 模式） |

#### 推荐集成方案

**Phase 1 — CLI + Skill 集成**（最低成本）：
```bash
npm install -g @mem0/cli
mem0 init --agent --agent-caller orca
```
编写 `mem0-skill` SKILL.md，教 Agent 在关键节点存储/检索记忆。

**Phase 2 — npm SDK 内置集成**：
在 core 层引入 `mem0ai` npm 包，会话结束时自动提取关键事实，新会话开始时注入相关记忆。

**Phase 3 — 知识中心融合**：
将 mem0 的记忆层与项目图谱（Feature Dev #3）结合，形成"项目知识图谱 + 交互记忆"的完整知识中心。

---

## 三、横向对比

| 项目 | 核心能力 | 填补的缺口 | 集成度 | 集成成本 | 推荐方式 | 优先级 |
|------|----------|-----------|--------|----------|----------|--------|
| code-review-graph | 代码图谱+爆炸半径 | 影响分析/Wiki | 🟢 高 | 低（MCP配置） | MCP Server | P1 |
| flutter/agent-plugins | 插件分发标准 | 插件市场协议 | 🟢 极高 | 极低（已兼容） | 战略参考 | P0（参考） |
| serena | 符号级代码操作 | 重构/跨文件编辑 | 🟢 高 | 低（MCP配置） | MCP Server | P1 |
| opencli | 网站→CLI+浏览器 | 数据获取/CLI Hub | 🟢 高 | 低（Skill+npm） | Agent Skill | P2 |
| mem0 | AI 长期记忆 | 跨会话知识积累 | 🟢 高 | 中（LLM+存储） | CLI→SDK | P1 |

## 四、集成优先级路线图

```
2026 Q3                          2026 Q4                          2027 Q1
├── 远程插件中心 ◄─────────────────────────────────────────────────────────┤
│   (参考 flutter/agent-plugins 协议)                                      │
├── 自定义 CLI 与指令 ◄────────────────────────────────────────────────────┤
│   (参考 opencli adapter 模式)                                            │
├── mem0 记忆层 Phase 1-2 ◄──────────────────────────┤                     │
├── serena MCP 接入 ◄────────────┤                                         │
├── code-review-graph MCP 接入 ◄────────────┤                              │
├── opencli Skill 集成 ◄──────────────────────┤                            │
│                                 ├── 项目图谱+Wiki 设计 ◄─────────────────┤
│                                 ├── Designer 能力 ◄──────────────────────┤
│                                              ├── mem0 Phase 3 融合 ◄─────┤
```

## 五、核心结论

1. **flutter/agent-plugins** 是远程插件中心的**协议标准参考**，Orca 已天然兼容其 skills 格式
2. **serena + code-review-graph** 通过 MCP Server 配置即可接入，零代码成本，立即增强 Agent 编码能力
3. **mem0** 是知识中心（Feature Dev #3）的**记忆层基础设施**，建议尽早启动 Phase 1
4. **opencli** 与现有 browser-skill 互补，丰富数据获取和 CLI Hub 能力
5. 所有 5 个项目均支持 MCP 或 Skill 集成路径，与 Orca 架构**零冲突**

---

> 关联文档：
> - [OCR 集成 & Understand-Anything 分析](./2026-07-ocr-integration-and-ua-analysis.md)
> - [前期开源项目集成调研](./2026-07-open-source-integration-feasibility.md)
