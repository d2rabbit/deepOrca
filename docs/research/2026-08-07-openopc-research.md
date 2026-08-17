# 调研：OpenOPC — AI 原生虚拟公司

> 日期：2026-08-07 · 决策：**超远期规划**，作为独立模块集成（协议允许：MIT）
> 仓库：[HKUDS/OpenOPC](https://github.com/HKUDS/OpenOPC) · README：[README.zh-CN.md](https://github.com/HKUDS/OpenOPC/blob/main/README.zh-CN.md) · 许可证：MIT

---

## 一、OpenOPC 是什么

OpenOPC（HKUDS，MIT，Python 3.10+）是一个 **AI 原生虚拟公司**框架。给定一个目标，它自动：

1. **自建（Self-Built）**：从目标推导组织架构 + 招聘 AI 员工（角色 + 汇报关系）
2. **自营（Self-Run）**：多 Agent 协作执行任务（看板 + 工作项状态机 + 依赖 DAG）
3. **自成长（Self-Grown）**：从执行结果学习沉淀（结果归因到角色 → 执行轨迹提炼为经验 → 共享 playbook）

覆盖九大领域：AI 技术研究、软件开发、金融投资、销售增长、内容媒体、行业助理、会计财务、品牌电商、教育培训。

## 二、技术架构

### 三件套机制

| 机制       | 核心       | 技术实现                                                                                                                                                         |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **自建**   | 组织配员   | LLM 起草组织图 → 招聘 Agent 在"复用老员工（带经验）" vs "招募新人"之间选择                                                                                       |
| **自营**   | 执行工作   | 工作项状态机（看板列 + 负责人 + 可执行性）→ 管理者五模式（execute/delegate/review/integrate/rework）→ 依赖 DAG（并行/串行）→ 阻塞处理（内部激活 + 外部上报人类） |
| **自成长** | 从结果学习 | 用户反馈 → 逐角色评估 → 执行轨迹提炼为角色私有经验档案 → 反复出现的经验提升为共享 playbook                                                                       |

### 技术栈

- **语言**：Python 3.10+
- **UI**：Office UI（React + Phaser，浏览器端）+ CLI
- **存储**：`.opc/` 目录（配置/记忆/项目/工作区分离）+ `aiohttp`/`aiosqlite`
- **Agent 执行**：原生 + 外部 Agent（Codex / Claude Code / Cursor / OpenCode）
- **渠道**：10+ 消息渠道（飞书/Slack/Discord/Telegram/钉钉/邮件/Matrix/QQ/WhatsApp/Mochat）
- **浏览器**：Playwright Chromium

## 三、与 DeepOrca 的关系

### 产品形态差异

| 维度       | DeepOrca                          | OpenOPC                           |
| ---------- | --------------------------------- | --------------------------------- |
| 定位       | AI 编码助手（单 Agent，对话驱动） | AI 虚拟公司（多 Agent，组织驱动） |
| 技术栈     | Electron + Node.js/TypeScript     | Python CLI + Web UI               |
| Agent 模型 | 单 Agent + Skills/MCP 工具        | 多个"AI 员工"有角色 + 汇报关系    |
| 任务模型   | 轮次对话循环                      | 工作项状态机 + 看板 + DAG         |
| 记忆       | TDAI L0-L3 + sqlite-vec 向量召回  | 角色私有经验档案 + 共享 playbook  |

### 集成决策

**MIT 许可证允许集成**（README 徽章确认）。决策：**超远期规划**，作为**独立模块**集成。

理由：

- OpenOPC 的多 Agent 公司模拟与 DeepOrca 的单 Agent 编码助手是**互补的产品形态** —— 不是替代，是扩展
- 集成方式：OpenOPC 作为 DeepOrca 的一个**独立功能域**（非侵入式），用户可选择启用
- 时间线：放在当前所有 P0-P3 之后（超远期），因为需要 DeepOrca 的引擎（Plan Mode / Subagent / 记忆 / 路由）先成熟

### 可借鉴的理念（中短期，不集成代码）

| OpenOPC 理念           | 对应 DeepOrca 路线图        | 借鉴方式                                  |
| ---------------------- | --------------------------- | ----------------------------------------- |
| 工作项 DAG + 状态机    | §十 Plan Mode 升级          | 设计参考：依赖图 + 并行执行 + 五种状态    |
| 结果归因 + 经验沉淀    | §十一 自进化 OpenSpace 闭环 | 设计参考：执行→评估→经验→playbook 闭环    |
| 组织架构从目标推导     | §十六 能力编排              | 远期愿景参考：SAD + Compose 的多 Agent 版 |
| 人才模板市场 (.opcpkg) | §十二 插件中心              | 设计参考：可分享的 Agent 配置包           |

## 四、超远期集成方案（概念）

当 DeepOrca 引擎成熟后（Plan Mode DAG / Subagent / 记忆 / 路由全部落地），可考虑：

1. **vendor OpenOPC**：类似 CodeGraph/OpenWiki 的 vendor 模式，Python 子进程 + IPC 通信
2. **作为"AI 公司"功能域**：在 DeepOrca 桌面端新增一个面板，用户输入目标 → OpenOPC 组建团队 → 执行交付
3. **共享基础设施**：DeepOrca 的记忆系统（TDAI）供 OpenOPC 的"经验档案"使用；路由系统（SkillRouter）供 OpenOPC 的"角色能力匹配"使用
4. **渠道复用**：OpenOPC 的 10+ 消息渠道集成可补齐 DeepOrca §十三 远程接入

**前置条件**：

- DeepOrca Plan Mode 支持依赖 DAG（§十）
- DeepOrca 支持 Subagent（§十）
- DeepOrca 记忆向量召回已上线（§二，已完成）
- DeepOrca 技能评估闭环已建立（§十一，skill-up）

## 五、致谢

OpenOPC 的多 Agent 组织编排、工作项状态机、经验沉淀闭环设计，为 DeepOrca 的能力编排（§十六）和自进化（§十一）提供了有价值的参考。

- 项目：[HKUDS/OpenOPC](https://github.com/HKUDS/OpenOPC)
- 许可证：MIT
- 致谢来源项目：openai/codex、BloopAI/vibe-kanban、msitarzewski/agency-agents、HKUDS/nanobot、pixel-agents-hq/pixel-agents
