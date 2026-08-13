<div align="center">

<br/>
<br/>

<p align="center">
  <a href="https://github.com/d2rabbit/deepOrca">
    <img src="docs-site/assets/orca-icon.png" width="120" alt="DeepOrca"/>
  </a>
</p>

# DeepOrca

**原型 · 设计 · 编码 —— AI 创作 Studio**

[English](README-en.md) · 中文 · [文档](docs/) · [更新日志](CHANGELOG.md)

<br/>
</div>

---

## 🐋 关于 DeepOrca

**DeepOrca** 是一个 AI 驱动的创作 Studio。**原型设计**、**UI 设计稿**、**智能编码**三大能力独立可用，按需组合——无论你想快速搭建交互原型、生成精美的 UI 设计稿，还是直接进入代码研发，都能从一个桌面客户端完成。专为 `deepseek-v4` 模型优化，以 Electron 桌面客户端为主要产品形态。

### 🎯 三大核心能力

| 能力 | 说明 | 技术 |
| --- | --- | --- |
| **🎯 原型设计** | 用自然语言描述需求，AI 生成可交互原型（表单/看板/多页面导航），双向交互验证用户流程 | A2UI 协议 + OpenUI Lang + 7 个模板 |
| **🎨 UI 设计稿** | 生成自包含 HTML 设计稿，3 种设计系统、14 种 UI 风格、Tailwind 内置，可脱离宿主独立交付 | DeepDesign `.dd` 格式 |
| **💻 智能编码** | DeepSeek 驱动的会话式编码：7 个内置工具、MCP 协议无限扩展、Monaco 编辑器、Git 集成 | Core Engine + MCP + Monaco |

三大能力各自独立，从任意一个切入即可。也可以组合使用——从原型验证到设计稿再到代码实现，按需流转。

项目由四个 npm workspace 组成：

| 包                    | 说明                                                                  |
| --------------------- | --------------------------------------------------------------------- |
| `@deeporca/core`      | 核心引擎：LLM 会话循环、7 个内置工具、Skills/MCP、Actions、会话持久化 |
| `@deeporca/desktop`   | Electron 桌面客户端：main/preload/renderer、Monaco、多面板、多主题    |
| `@deeporca/embedding` | 本地 IBM Granite 嵌入运行时，用于语义路由和召回                       |
| `@deeporca/memory`    | 进程内 L0–L3 记忆流水线与向量检索                                     |

### 📦 关于 Deep Code

DeepOrca 起源于 [Deep Code](https://github.com/lessweb/deepcode-cli)（`@vegamo/deepcode`）的 fork，现已发展为独立项目。我们保留了 Deep Code 优秀的核心引擎架构（LLM 会话循环、内置工具、Skills/MCP 扩展、权限控制），并在此基础上增加桌面 GUI、Actions 能力层、本地记忆与嵌入、内置扩展、GitMCP、Monaco Editor 等能力，同时移除了终端 CLI 与 VSCode 插件形态。

Deep Code 基于 MIT 协议开源，本项目依照协议要求完整保留其原始版权声明（见 [LICENSE](LICENSE)），并在此向原作者致谢。

---

## ✨ 核心特性

### 🧩 扩展与能力系统

DeepOrca 提供三类扩展来源，并通过 Actions 统一部分能力的执行入口：

| 类型                   | 说明                                     | 管理方式                      |
| ---------------------- | ---------------------------------------- | ----------------------------- |
| **Skills（技能）**     | `SKILL.md` 驱动的 Agent 能力扩展         | 放入 `.deeporca/skills/` 目录 |
| **MCP 服务器**         | 通过 Model Context Protocol 连接外部服务 | 在 `settings.json` 中配置     |
| **内置扩展与 Actions** | 随 DeepOrca 发布的技能、服务与组合工作流 | 由桌面宿主加载                |

内置能力示例包括浏览器自动化、Open Code Review、GitMCP、CodeGraph、OpenWiki、CRG、Serena 和设计/知识类 Skills。完整清单见 [内置能力清单](docs/builtin-inventory.md)。

### ⚡ Actions：能力一次定义，多处调用

`defineAction` / `ActionRegistry` 将项目能力定义为可组合的 Action。注册后的 Action 可以：

- 作为 Agent 的 LLM function tool 调用；
- 通过类型化的桌面 IPC 和 UI 执行；
- 在 core 中通过 `ActionRegistry.execute()` 组合成更高层工作流；
- 统一返回结构化结果，并发送进度事件；core API 还支持取消执行。

当前内置 Actions 覆盖系统诊断、OCR/CRG 代码审查、CodeGraph/OpenWiki 索引、`index.build-all` 和 `arch-scan`。高级用户可在「设置 → Actions」查看已注册能力、运行无参数 Action，并检查进度与原始结果。

```ts
import { ActionRegistry, defineAction } from "@deeporca/core";

const registry = new ActionRegistry({ projectRoot });

defineAction(
  registry,
  {
    id: "example.greet",
    description: "Return a greeting.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: false,
    },
  },
  async (input: { name?: string }, ctx) => {
    ctx.emit({ message: "Greeting", percent: 50 });
    return { message: `Hello, ${input.name ?? "world"}` };
  }
);

const run = registry.execute("example.greet", { name: "DeepOrca" });
run.onProgress(console.log);
const output = await run.result;
```

> **当前边界：** Actions 已接入 LLM 工具和桌面 IPC/UI；外部 MCP Action Server、HTTP/CLI、自动参数表单、桌面取消和细粒度 Action 权限仍在规划中。参数 schema 的运行时校验目前是浅层的，Action 实现应自行校验具体约束。设计与限制见 [defineAction 设计说明](specs/define-action/design.md)。

### 🎨 桌面客户端亮点

- **Monaco Editor 集成** — 专业代码编辑器，支持语法高亮、智能提示
- **Actions 面板** — 浏览已注册能力、运行无参数 Action、查看统一进度和结构化结果
- **GitMCP 面板** — 管理 GitHub 仓库索引，语义搜索文档和代码
- **代码审查面板** — 一键审查未提交的工作区变更；OCR 生成结构化意见，CRG 图谱可用时补充结构风险
- **代码索引面板** — 编排 CodeGraph、OpenWiki 与 arch-scan，并展示阶段进度
- **源码管理面板** — Git 操作（stage/commit/diff/branch）
- **多主题系统** — Aqua 原生 / Glass Prism 玻璃拟态 / Punk 2077 赛博朋克
- **6 语言国际化** — en / zh / ja / ko / zh-HK / zh-TW

### 🧠 本地向量嵌入 + 语义路由

- **Granite 97M 嵌入模型** — IBM Granite Embedding 97M multilingual R2（384 维，200+ 语言含中文），使用 transformers.js + onnxruntime-node 本地推理，模型在构建期 vendor，不依赖运行时下载
- **记忆向量召回** — `@deeporca/memory` 提供进程内 L0–L3 记忆流水线，并接入 sqlite-vec 向量后端
- **技能/工具语义路由** — 技能较多时召回 top-K 短名单，MCP 工具按服务器级召回裁剪
- **组合路由（SkillWeaver）** — 复杂查询自动拆解 → 多技能召回 → 兼容性规划 + DAG 组合（参考 [arxiv 2606.18051](https://arxiv.org/abs/2606.18051)）
- 全程 **fail-open**：模型未就绪或异常时回退全量候选，不影响会话继续执行

### 🏗️ 一键工作区索引

「构建索引」通过 `index.build-all` 顺序执行：

| 步骤      | 工具          | 索引层 | 回答的问题                       |
| --------- | ------------- | ------ | -------------------------------- |
| 1. 索引   | **CodeGraph** | 符号级 | 这个符号在哪？谁调用了它？       |
| 2. Wiki   | **OpenWiki**  | 文档级 | 项目文档说了什么？               |
| 3. 架构图 | **arch-scan** | 架构级 | 整体架构长什么样？数据怎么流动？ |

首次构建执行三个阶段；后续“全部更新”只刷新 CodeGraph 与 OpenWiki。每个阶段独立返回成功、跳过或错误状态，单阶段失败不会抹掉其他阶段的结果。`arch-scan` 使用 12 视角目录与递归下钻方法，并通过 A2UI 渲染可嵌套组件树。

### 🚀 为 DeepSeek 优化

- 专门为 DeepSeek 模型性能调优
- 通过[上下文缓存](https://api-docs.deepseek.com/guides/kv_cache)降低成本
- **前缀缓存热度优化（cache-first）** — 系统提示按稳定度排序，日期/模型信息拆为每轮 transient 尾部消息，避免跨天或切换模型破坏 prefix cache
- 原生支持[思考模式](https://api-docs.deepseek.com/guides/thinking_mode)和思考强度控制

---

## 📊 当前功能全景

| 能力域       | 功能                                              | 状态 |
| ------------ | ------------------------------------------------- | ---- |
| 核心引擎     | LLM 会话循环、7 个内置工具、上下文压缩            | ✅   |
| **原型设计** | **A2UI 交互原型 + OpenUI Lang + 7 个模板**        | ✅   |
| **UI 设计稿** | **DeepDesign `.dd` 格式 + 3 设计系统 + 14 风格** | ✅   |
| **智能编码** | **DeepSeek 驱动的会话式编码 + Monaco + Git**      | ✅   |
| Actions      | ActionRegistry、LLM 工具、桌面 IPC/UI、组合工作流 | 🧪   |
| 桌面客户端   | Electron GUI、多面板、多主题                      | ✅   |
| 扩展系统     | Skills / MCP / 内置扩展                           | ✅   |
| 本地智能层   | Granite 嵌入、L0–L3 记忆、语义路由                | ✅   |
| 代码编辑器   | Monaco Editor 集成                                | ✅   |
| 工作区索引   | CodeGraph、OpenWiki、arch-scan                    | ✅   |
| 代码审查     | Open Code Review + CRG 风险补充                   | ✅   |
| GitMCP       | 本地 GitMCP 模块 + 仓库索引面板                   | ✅   |
| 浏览器自动化 | browser-skill 内置扩展                            | ✅   |
| 源码管理     | Git 面板（stage/commit/diff/branch）              | ✅   |
| 权限控制     | 内置工具细粒度 scope 策略                         | ✅   |
| 会话持久化   | 跨会话恢复、归档、导出                            | ✅   |
| 联网搜索     | 内置 WebSearch 工具                               | ✅   |
| 多模态       | 图片粘贴/拖拽输入                                 | ✅   |

> 🧪 Actions 的核心注册、LLM/IPC 接入和桌面浏览器已可用；更多调用面与权限集成仍在迭代。

---

## 🗺️ 发展路线图

### 🎯 近期开发

| #   | 特性                      | 说明                                                   | 状态      |
| --- | ------------------------- | ------------------------------------------------------ | --------- |
| 1   | **Actions 能力面扩展**    | 外部 MCP、HTTP/CLI、参数表单与更细粒度权限             | 🔨 规划中 |
| 2   | **远程插件中心**          | 在线插件市场，支持一键安装/更新社区 Skills 和 MCP 服务 | 🔨 规划中 |
| 3   | **自定义 CLI 与指令**     | 用户可注册斜杠命令和 CLI 子命令                        | 🔨 规划中 |
| 4   | **项目图谱与沉浸式 Wiki** | 代码知识图谱可视化 + 项目级知识沉淀                    | 📐 设计中 |
| 5   | **PM-Design V2 需求具现化** | 需求分析 → 管线自动路由 → 原型生成 → 持久化工作台     | 📐 设计中 |

已集成的重点开源能力包括 Flutter/Dart Skills、OpenWiki、CodeGraph 和 Code Review Graph（CRG）；Serena、OpenCLI、CLI-Anything、Open Design 等能力仍在持续集成与评估中。

> 📋 完整技术选型、实施阶段和后续项目见 [Feature 路线图](docs/features/feature-roadmap.md)，详细调研见 [docs/research/](docs/research/)。路线图和设计文档可能包含尚未交付的目标能力，请以当前实现和本页状态说明为准。

---

## 🚀 快速开始

> 需要 Node.js 22+ 和 npm 10.9.4。Windows 上执行 core 的 bash 工具还需要 Git Bash。

### 安装与构建

```bash
# 克隆仓库
git clone https://github.com/d2rabbit/deepOrca.git
cd deepOrca

# 安装依赖
npm install
```

### 配置

创建 `~/.deeporca/settings.json` 文件（若本机已有 `~/.deepcode` 配置目录则会直接沿用，无需迁移）：

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "sk-..."
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

也可使用 `DEEPORCA_` 前缀的环境变量（如 `DEEPORCA_API_KEY`）；旧 `DEEPCODE_` 变量仍作为兼容回退。完整配置见 [配置说明](docs/configuration.md)。

### 桌面客户端

```bash
# 开发模式
npm run desktop:dev

# 构建
npm run desktop:build

# 构建并运行
npm run desktop:start
```

---

## 📚 文档导航

| 文档                                                                 | 说明                                |
| -------------------------------------------------------------------- | ----------------------------------- |
| [CHANGELOG.md](CHANGELOG.md)                                         | 更新日志                            |
| [docs/quickstart.md](docs/quickstart.md)                             | 快速上手                            |
| [docs/architecture.md](docs/architecture.md)                         | 架构设计和核心流程                  |
| [docs/configuration.md](docs/configuration.md)                       | 配置文件详解                        |
| [docs/mcp.md](docs/mcp.md)                                           | MCP 服务器配置指南                  |
| [docs/agent-skills.md](docs/agent-skills.md)                         | Skills 开发指南                     |
| [docs/permission.md](docs/permission.md)                             | 权限控制说明                        |
| [docs/session-persistence.md](docs/session-persistence.md)           | 会话持久化                          |
| [docs/builtin-inventory.md](docs/builtin-inventory.md)               | 内置 Skills、MCP 与工具清单         |
| [specs/define-action/design.md](specs/define-action/design.md)       | Actions/defineAction 设计与迁移说明 |
| [docs/features/feature-roadmap.md](docs/features/feature-roadmap.md) | Feature 集成路线图                  |
| [docs/research/](docs/research/)                                     | 技术调研报告                        |

---

## 🤝 贡献与验证

```bash
# 克隆并安装
git clone https://github.com/d2rabbit/deepOrca.git
cd deepOrca
npm install

# 构建、类型检查、lint 和格式检查
npm run check

# 所有 workspace 测试
npm test

# 桌面客户端本地开发
npm run desktop:dev
```

Actions 聚焦测试：

```bash
node packages/core/src/tests/run-tests.mjs packages/core/src/tests/actions.test.ts
node packages/core/src/tests/run-tests.mjs packages/core/src/tests/phase-actions.test.ts
node packages/desktop/src/tests/run-tests.mjs packages/desktop/src/tests/action-ipc.test.ts
```

提交前建议先运行 `npm run format`，再执行 `npm run check && npm test`。提交使用 Conventional Commits（如 `feat:`、`fix:`、`docs:`）。

---

## 📞 获取帮助

- **仓库 Issues**：https://github.com/d2rabbit/deepOrca/issues
- **文档**：查看 [docs/](docs/) 目录

---

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 开源。

- DeepOrca 源自 [Deep Code](https://github.com/lessweb/deepcode-cli)（Copyright (c) 2026 lessweb，MIT License）。
- 根据 MIT 协议条款，本仓库完整保留原始版权声明与许可声明；使用、修改或分发本项目（及其实质部分）时，也需保留 [LICENSE](LICENSE) 中的版权声明与许可声明。
- 软件按“原样”提供，不附带任何形式的担保，详见协议全文。

---

## 🌟 支持我们

如果 DeepOrca 对你有帮助，欢迎：

- ⭐ 给仓库一个 Star
- 🐛 提交 Bug 报告和功能建议
- 📢 分享给朋友和同事
- 🤝 贡献代码和文档
