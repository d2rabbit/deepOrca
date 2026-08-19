# 开源项目集成可行性调研报告

> 调研目标：评估 5 个开源项目作为 DeepOrca 内置插件或指令的可行性和价值
> 调研日期：2026-07-21

## 一、CodeFlow（braedonsaunders/codeflow）

### 核心能力概述

CodeFlow 是一个**纯浏览器端代码库架构可视化工具**。用户粘贴 GitHub URL 或选择本地文件，即可秒级生成交互式依赖图谱。核心功能包括：

| 功能 | 说明 |
|---|---|
| 交互式依赖图 | 文件间依赖关系可视化，D3.js 力导向图 |
| 爆炸半径分析 | "改了这个文件会影响哪些？" 即时回答 |
| 代码归属 | 基于 Git history 的文件 top contributors |
| 安全扫描 | 硬编码密钥、SQL 注入、eval()、调试语句检测 |
| 设计模式检测 | Singleton、Factory、Observer、React Hooks、反模式 |
| 健康评分 | A-F 等级（死代码率、循环依赖、耦合度、安全问题） |
| 活动热力图 | 按 commit 频率给文件着色 |
| PR 影响分析 | PR URL → 受影响文件 + 爆炸半径 |

**技术实现**：单个 `index.html` 文件，React 18 + D3.js 7 + Babel 均从 CDN 加载，零构建依赖，零后端。支持 30+ 编程语言。

### 与 DeepOrca 的契合度

**契合度：低-中**

- DeepOrca 是**文本交互的编码 Agent**，核心能力是 LLM 驱动的对话式代码理解和修改
- CodeFlow 是**可视化分析工具**，输出是 D3.js 图谱而非结构化数据
- 二者在"理解代码结构"这一维度有交集，但交互范式完全不同
- CodeFlow 的依赖分析是启发式（正则提取函数名匹配），准确度不足以作为 Agent 的可靠输入源

### 技术架构兼容性

| 维度 | 评估 |
|---|---|
| Node.js 22 / ESM | ❌ 纯浏览器项目，无 Node.js 组件 |
| 作为 MCP Server | ❌ 无后端、无 stdio 接口，不具备 MCP Server 形态 |
| 作为 Skill | ⚠️ 其安全扫描和依赖分析逻辑可以提取为 Skill，但需要重写（从浏览器正则 → Node.js 分析器） |
| 依赖复杂度 | 极低（CDN 加载，无 npm 依赖） |

### 集成方案建议

| 方案 | 可行性 | 工作量 |
|---|---|---|
| 提取分析逻辑为 Skill | ⚠️ 中等 | 需要重写 JS 解析器为 Node.js 版本 |
| 作为 `/analyze` 命令调用浏览器打开 | 简单 | 低，但价值有限 |
| 不集成，作为外部参考 | ✅ 推荐 | 零 |

**推荐**：暂不集成。CodeFlow 的价值在于可视化展示，与 DeepOrca 的文本 Agent 范式不匹配。如果未来需要代码分析能力，更推荐基于 tree-sitter 或 LSP 构建原生分析工具。

### 优劣势与风险

- ✅ **亮点**：零安装、隐私友好、可视化效果出色
- ❌ **局限**：纯浏览器端无法提供结构化 API、依赖分析准确率低、无 Node.js 生态兼容
- ⚠️ **风险**：将其正则解析器移植到 Node.js 的维护成本高，且不如 tree-sitter 等成熟方案

---

## 二、CLI-Anything（HKUDS/CLI-Anything）

### 核心能力概述

CLI-Anything 是香港大学团队的**万能 CLI 生成器**——一行命令为任意软件自动生成完整的 CLI 接口。核心是一个 7 阶段全自动流水线：

```
分析源码 → 设计命令 → 实现 CLI → 规划测试 → 编写测试 → 文档生成 → 发布安装
```

已在 13 款复杂软件上验证通过（GIMP、Blender、Inkscape、LibreOffice、OBS Studio 等），累计 **1,955 项测试全部通过**。

**核心设计原则**：

- 真实软件集成（调用真实 Blender 渲染，不是玩具替代品）
- Agent 原生（`--json` 输出、`--help` 自描述、`which` 发现）
- 统一 REPL 界面（ReplSkin）
- 可逆操作（undo/redo + 持久化状态）

### 与 DeepOrca 的契合度

**契合度：高**

- DeepOrca 的核心工具之一是 `bash`，Agent 大量通过 shell 执行命令
- CLI-Anything 能为**任意专业软件**生成结构化 CLI，直接扩展 DeepOrca 的操作能力边界
- 生成的 CLI 天然具备 `--json` 输出和 `--help` 自描述，完美匹配 LLM 消费格式
- 可作为 DeepOrca 的**元工具**（meta-tool）：用 DeepOrca Agent 调用 CLI-Anything 生成新 CLI，再通过 bash 工具使用

### 技术架构兼容性

| 维度 | 评估 |
|---|---|
| Node.js 22 / ESM | ⚠️ Python 3.10+，非 Node.js 生态 |
| 作为 MCP Server | ⚠️ 不直接提供 MCP Server，但生成的 CLI 可通过 bash 工具调用 |
| 作为 Skill | ✅ **高度匹配**——其方法论（HARNESS.md）天然适合封装为 Agent Skill |
| 作为 Slash 命令 | ✅ 可封装为 `/cli-anything <path>` 斜杠命令 |
| 依赖复杂度 | 中（Python + Click + 目标软件的 Python 绑定） |

### 集成方案建议

| 方案 | 可行性 | 工作量 |
|---|---|---|
| **Agent Skill**（推荐） | ✅ 高 | 中（1-2 天） |
| Slash 命令 `/cli-anything` | ✅ 高 | 低-中 |
| MCP Server | ❌ 不匹配 | 高（需要重写为 Node.js） |

**推荐集成方式**：封装为 **Agent Skill**（`SKILL.md`），放在 `.deeporca/skills/cli-anything/` 下。用户在 DeepOrca 中输入 `/cli-anything ./gimp` 即可触发 7 阶段流水线。生成的 CLI 通过现有的 `bash` 工具直接调用。

**工作量**：约 1-2 天（编写 SKILL.md + 资源文件 + 测试），核心是适配 DeepOrca 的 Skill 协议。

### 优劣势与风险

- ✅ **亮点**：极大扩展 Agent 能力边界、已在 13 款软件上验证、方法论成熟（HARNESS.md）、支持 6 个 Agent 框架
- ✅ **亮点**：生成的 CLI 是 pip 可安装的独立工具，不依赖 CLI-Anything 运行时
- ❌ **局限**：Python 生态，DeepOrca 用户需要 `pip` 环境；对目标软件需要源码或 API 文档
- ⚠️ **风险**：生成的 CLI 质量依赖 LLM 能力，不同模型效果可能差异大；Python 依赖链可能与 Node.js 项目环境冲突

---

## 三、Open Design（nexu-io/open-design）

### 核心能力概述

Open Design 是**开源的 Claude Design 替代品**——Agent 原生的设计工件生成平台。核心理念是"你的 CLI 变成设计引擎"：

| 能力 | 说明 |
|---|---|
| 原型生成 | Web / 桌面 / 移动端 HTML 原型，沙箱 iframe 预览 |
| 演示文稿 | 杂志级 Deck，支持 PPTX / PDF 导出 |
| 实时仪表盘 | 可调参的 KPI 大屏、决策室 |
| 图片生成 | 品牌级视觉素材（gpt-image-2 / ImageRouter） |
| 视频 & HyperFrames | HTML + CSS + GSAP → MP4（1920×1080 · 30fps） |

**规模**：100+ 功能技能、151 个设计系统包、277 个插件、25 个 CLI runtime 定义。

**技术栈**：Next.js 16 + React 18 + TypeScript + Electron + Express + SQLite + Node 24 + pnpm。

### 与 DeepOrca 的契合度

**契合度：中-高（互补型）**

- Open Design 已有成熟的 **MCP Server**（`od mcp install <agent>`），可直接接入 DeepOrca
- 提供 `skills/` + `design-templates/` + `design-systems/` 三层体系，与 DeepOrca 的 Agent Skills 协议高度兼容（同样使用 `SKILL.md` 约定）
- DeepOrca 作为编码 Agent，缺少设计/原型生成能力，Open Design 完美填补这一空白
- 但 Open Design 体量巨大（整个 Next.js 应用 + Electron + 守护进程），作为"插件"引入过于沉重

### 技术架构兼容性

| 维度 | 评估 |
|---|---|
| Node.js 22 / ESM | ✅ Node 24（兼容 22），TypeScript + ESM |
| 作为 MCP Server | ✅ **原生支持**——已有 stdio MCP Server + 逐 Agent 安装脚本 |
| 作为 Skill | ✅ 其 `SKILL.md` 协议与 DeepOrca 完全一致 |
| 依赖复杂度 | 极高（Next.js + Electron + SQLite + pnpm monorepo） |

### 集成方案建议

| 方案 | 可行性 | 工作量 |
|---|---|---|
| **MCP Server 接入**（推荐） | ✅ 高 | 低（配置文件级别） |
| 提取核心 Skills 为 DeepOrca Skills | ⚠️ 中等 | 中（需要适配目录结构） |
| 整体集成 | ❌ 不可行 | 极高（两个独立 Electron 应用） |

**推荐集成方式**：配置为 **MCP Server**。用户只需在 `~/.deeporca/settings.json` 中添加：

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

即可通过 `mcp__open-design__*` 工具调用设计生成能力。DeepOrca 的 MCP 协议已完全支持此模式。

**工作量**：配置级别（< 1 小时），但用户需要先安装 Open Design CLI（`od`）。

### 优劣势与风险

- ✅ **亮点**：MCP Server 原生支持、151 个设计系统、277 个插件生态、Apache-2.0 许可
- ✅ **亮点**：与 DeepOrca 共享 `SKILL.md` 协议，技能可互换
- ❌ **局限**：项目体量极大（完整 Next.js 应用），作为外部依赖过重；需要 `od` CLI 预装
- ⚠️ **风险**：Open Design 仍在快速迭代（0.13.0），API 稳定性不确定；守护进程 + Electron 双进程模型可能与 DeepOrca Desktop 冲突

---

## 四、BrowserSkill（Tencent/BrowserSkill）

### 核心能力概述

BrowserSkill 是腾讯开源的**浏览器自动化桥接器**——让 AI Agent 使用用户真实、已登录的浏览器，且不干扰用户正常工作。

**核心架构**：

```
Agent → bsk CLI → bsk daemon → WebSocket → Browser Extension → Agent Window
```

**关键特性**：

- 复用真实登录态（无需单独测试账号）
- 独立 Agent Window（不影响用户正常浏览）
- Tab 借用协议（显式借用、用完归还）
- 内置 Human-in-loop（验证码/登录/确认对话框时交还用户）
- 跨平台（macOS / Linux / Windows）、跨浏览器（Chrome / Edge）
- 通用 Agent 兼容（任何能调用 shell 的 Agent）

**技术栈**：Rust（CLI + daemon，Cargo workspace）+ TypeScript（browser extension，pnpm）。

### 与 DeepOrca 的契合度

**契合度：极高**

- DeepOrca 的 7 个内置工具中没有浏览器操控能力，这是**最大的能力缺口之一**
- BrowserSkill 的设计哲学（CLI 接口 + shell 调用）与 DeepOrca 的 `bash` 工具完美匹配
- 不需要 MCP Server——Agent 直接通过 `bash` 工具执行 `bsk` 命令即可
- Human-in-loop 机制与 DeepOrca 的 `AskUserQuestion` 工具天然互补
- DeepOrca Desktop 是 Electron 应用，但 BrowserSkill 操控的是用户的**系统浏览器**，不冲突

### 技术架构兼容性

| 维度 | 评估 |
|---|---|
| Node.js 22 / ESM | ✅ CLI 是 Rust 编译的二进制，无 Node.js 依赖；Extension 是 TypeScript |
| 作为 MCP Server | ⚠️ 不需要——CLI 已提供完整 shell 接口 |
| 作为 bash 工具调用 | ✅ **完美匹配**——`bsk open <url>`、`bsk screenshot` 等 |
| 作为 Skill | ✅ 提供了 `SKILL.md` 模板，可直接作为 Agent Skill |
| 依赖复杂度 | 低（安装单个二进制 + Chrome 扩展） |

### 集成方案建议

| 方案 | 可行性 | 工作量 |
|---|---|---|
| **Agent Skill + bash 调用**（推荐） | ✅ 极高 | 极低 |
| MCP Server | ⚠️ 可行但不必要 | 中 |
| 内置工具 | ❌ 违背"7 个内置工具"原则 | 高 |

**推荐集成方式**：

1. 将 BrowserSkill 的 `SKILL.md` 安装到 `.deeporca/skills/browser-skill/`
2. Agent 通过现有的 `bash` 工具执行 `bsk` 命令
3. 遇到验证码等场景时，Agent 自动调用 `AskUserQuestion` 请求用户介入

**工作量**：< 30 分钟（安装 Skill 文件 + Chrome 扩展 + 验证）。

### 优劣势与风险

- ✅ **亮点**：完美匹配 DeepOrca 架构、零代码集成、复用真实登录态、Human-in-loop、MIT 许可
- ✅ **亮点**：腾讯出品，维护可持续性强；已适配 8+ Agent 框架
- ✅ **亮点**：`bsk install-skill` 一键安装到 DeepOrca
- ❌ **局限**：需要 Chrome/Edge 浏览器 + 扩展安装；Rust 二进制更新需用户手动
- ⚠️ **风险**：浏览器扩展权限敏感（需要读取所有网站数据），企业用户可能有安全顾虑

---

## 五、Open Code Review（alibaba/open-code-review）

### 核心能力概述

Open Code Review 是阿里巴巴开源的 **AI 代码审查 CLI 工具**，已在阿里内部服务数万开发者、发现数百万代码缺陷。

**核心架构：确定性工程 × LLM Agent 混合**

| 组件 | 职责 |
|---|---|
| 确定性管线 | 精确文件选择、智能文件打包、细粒度规则匹配、外部定位模块、反思模块 |
| LLM Agent | 动态决策、上下文检索、深度审查推理 |
| 内置规则集 | NPE、线程安全、XSS、SQL 注入等高频缺陷规则 |

**使用方式**：

- `ocr review` — 审查工作区改动（staged + unstaged + untracked）
- `ocr review --from main --to feature` — 分支范围审查
- `ocr scan` — 全文件扫描（无需 diff）
- `ocr delegate` — 委托模式（让 Agent 用自己的 LLM 审查）

**Benchmark**：与通用 Agent（Claude Code）相比，相同底层模型下 F1 显著更高，**token 消耗仅 1/9**，速度更快。

**技术栈**：npm 包（`@alibaba-group/open-code-review`）、Node.js CLI、支持 OpenAI / Anthropic 模型、自带 MCP Server。

### 与 DeepOrca 的契合度

**契合度：极高**

- 代码审查是编码 Agent 的**核心高频场景**之一
- DeepOrca 目前没有内置的代码审查能力，Agent 只能靠 LLM 自身能力逐文件审查，覆盖率不稳定
- Open Code Review 的"确定性规则匹配 + LLM 推理"混合架构解决了纯 LLM 审查的痛点（覆盖率不全、定位漂移、质量波动）
- 支持 **Delegation Mode**（`ocr delegate`）——不启动自己的 LLM，而是让宿主 Agent 的 LLM 执行审查，OCR 只负责文件选择和规则解析，**完美匹配 DeepOrca 作为宿主**
- 已有 npm 包和 MCP Server，集成路径清晰

### 技术架构兼容性

| 维度 | 评估 |
|---|---|
| Node.js 22 / ESM | ✅ npm 包，Node.js CLI |
| 作为 MCP Server | ✅ **原生支持**（文档明确提供 MCP Server 接入方式） |
| 作为 Skill | ✅ 审查方法论适合封装为 Skill |
| 作为 Slash 命令 | ✅ `/review` 命令自然 |
| 依赖复杂度 | 低（单个 npm 包，无额外系统依赖） |

### 集成方案建议

| 方案 | 可行性 | 工作量 |
|---|---|---|
| **Slash 命令 `/review`**（推荐） | ✅ 极高 | 低 |
| **Agent Skill** | ✅ 高 | 低 |
| MCP Server 接入 | ✅ 高 | 低 |
| 内置工具 | ❌ 违背"7 个内置工具"原则 | 高 |

**推荐集成方式**：**三管齐下**

1. **Slash 命令** `/review` — 用户在 DeepOrca 中输入即触发 `ocr review`
2. **Agent Skill** — `SKILL.md` 封装审查方法论，Agent 在合适时机自动调用
3. **Delegation Mode** — 通过 `ocr delegate` 让 DeepOrca 的 LLM 直接消费 OCR 的规则解析结果

**工作量**：约半天（安装 npm 包 + 编写 Skill + 注册 slash 命令 + 测试）。

### 优劣势与风险

- ✅ **亮点**：阿里内部数万开发者验证、混合架构（F1 优于纯 LLM）、token 消耗仅 1/9、内置安全规则集（NPE/XSS/SQL注入）
- ✅ **亮点**：Delegation Mode 完美匹配 DeepOrca（不需要额外 LLM 配置）、npm 包安装简单、Apache-2.0 许可
- ✅ **亮点**：支持 MCP Server、Skill、Plugin 三种集成方式
- ❌ **局限**：需要 Git 仓库（`ocr review` 依赖 diff）；对非 Git 项目支持有限
- ⚠️ **风险**：阿里内部优化可能偏向 Java/Go 等后端语言，前端/TypeScript 规则覆盖待验证

---

## 横向对比总结

| 维度 | CodeFlow | CLI-Anything | Open Design | BrowserSkill | Open Code Review |
|---|---|---|---|---|---|
| **核心能力** | 代码架构可视化 | 万能 CLI 生成器 | AI 设计工件生成 | 浏览器自动化桥接 | AI 代码审查 |
| **填补的缺口** | 代码可视化 | 专业软件操控 | UI/UX 设计 | **浏览器操控** | **代码审查** |
| **与 DeepOrca 契合度** | 🟡 低-中 | 🟢 高 | 🟢 中-高 | 🟢 **极高** | 🟢 **极高** |
| **集成复杂度** | 高（需重写） | 中（Python 依赖） | 低（MCP 配置） | **极低**（Skill 文件） | **低**（npm + Skill） |
| **推荐集成方式** | 不集成 | Agent Skill | MCP Server | Skill + bash | Skill + `/review` |
| **技术栈兼容** | ❌ 纯浏览器 | ⚠️ Python 3.10+ | ✅ Node 24 + TS | ✅ Rust + TS | ✅ Node.js + npm |
| **许可证** | MIT | 未明确 | Apache-2.0 | MIT | Apache-2.0 |
| **维护活跃度** | 🟡 个人项目 | 🟢 学术团队 | 🟢 活跃社区 | 🟢 腾讯 | 🟢 阿里 |
| **推荐工作量** | — | 1-2 天 | < 1 小时 | **< 30 分钟** | **半天** |

## 优先级推荐排序

| 优先级 | 项目 | 推荐理由 | 建议时间线 |
|---|---|---|---|
| **🥇 P0** | **BrowserSkill** | 填补最大能力缺口（浏览器操控）、零代码集成、腾讯维护、MIT 许可 | 立即集成 |
| **🥈 P1** | **Open Code Review** | 填补代码审查缺口、阿里万级验证、token 效率极高、Delegation Mode 完美匹配 | 本周集成 |
| **🥉 P2** | **Open Design** | MCP Server 原生支持、配置级集成、填补设计生成能力 | 按需配置 |
| **P3** | **CLI-Anything** | 元工具能力（生成新 CLI）、方法论成熟、但 Python 依赖是门槛 | 评估后集成 |
| **P4** | **CodeFlow** | 可视化价值高但与 Agent 范式不匹配、无 Node.js 接口 | 暂不集成 |

## 核心结论

- **BrowserSkill + Open Code Review** 是最高价值的两个项目——它们分别填补了 DeepOrca 最明显的两个能力缺口（浏览器操控 + 代码审查），且都支持**零代码 / 低代码集成**
- **Open Design** 作为 MCP Server 接入是最低成本的扩展方式，适合需要设计生成能力的团队
- **CLI-Anything** 的"元工具"理念最有想象力，但 Python 依赖链是实际的集成障碍
- **CodeFlow** 的可视化能力虽然惊艳，但其纯浏览器端架构与 DeepOrca 的文本 Agent 范式根本不兼容，不建议集成
