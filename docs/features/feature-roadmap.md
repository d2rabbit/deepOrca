# DeepOrca 功能路线图

> 版本：v3.0 · 日期：2026-07-29 · 状态：规划中
>
> **v3.0 重大重组**：从"按项目编号"改为"按功能域分组"。所有调研过的项目按其贡献的能力域归类，
> 每个功能域包含已集成、规划中、搁置三层。OpenSpec 和 Superpowers 暂时搁置（见 §搁置项）。
>
> 历史版本：v2.1-v2.4 按项目逐个调研，v3.0 按功能重新规划。

---

## 功能域总览

| 功能域 | 已集成 | 规划中 | 核心目标 |
|--------|--------|--------|----------|
| [一、代码智能](#一代码智能) | codegraph, CRG, ocr | serena | 让 Agent 从"文本级"升级为"语义级"代码操作 |
| [二、知识中心](#二知识中心) | openwiki, TencentDB-Agent-Memory | Open Deep Research 理念 | 项目文档 + 跨会话记忆 + 深度研究 |
| [三、设计生成](#三设计生成) | DeepDesign Phase 1, Bento Slides | taste-skill, Canvas UI, dashboard/deck 模板 | brief→生成→预览→交付 的全流程设计能力 |
| [四、浏览器与联网](#四浏览器与联网) | browser-skill, WebSearch | obscura, web-access 理念 | 登录态操控 + 大规模抓取 + 深度联网策略 |
| [五、桌面自动化](#五桌面自动化) | — | pi-computer-use, CLI-Anything | 操控无 API 的桌面软件 |
| [六、引擎演进](#六引擎演进) | Plan Mode, UpdatePlan, Electron 35 | Prewalk, OpenSpace 理念, Subagent | 模型切换 + 技能自演化 + 子 agent + 自改进 |
| [七、插件中心](#七插件中心) | 分组展示, flutter skills, 插件分组 | opencli | 统一的插件/技能/MCP 管理入口 |
| [搁置项](#搁置项) | — | OpenSpec, Superpowers | 暂不规划，理由见下 |

---

## 一、代码智能

> 让 Agent 理解代码的"在哪里、谁调用谁、多危险、怎么改"——从文本搜索升级为语义级图谱 + 风险分析 + 符号操作。

### 已集成

| 能力 | 项目 | 集成形态 | 定位 |
|------|------|----------|------|
| 符号检索 + 调用链 + 影响范围 | **codegraph** v1.5.0 | vendored CLI + MCP | 导航层——"代码 GPS"，35 语言，一次调用返回源码+调用链 |
| 风险评分 + 社区检测 + 架构概览 | **CRG** (code-review-graph) | vendored uv + MCP（dev 分支） | 分析层——"这个改动有多危险"，Leiden 社区 + 风险指数 + Mermaid 架构图 |
| AI 代码审查 | **ocr** (Open Code Review) | npm 依赖内置 | 审查层——审查未提交的工作区改动 |

**三层协同**：codegraph（在哪）→ CRG（多危险）→ ocr（怎么改）。桌面端代码审查面板 3 Tab：Quality（OCR）/ Risk（CRG）/ Architecture（Mermaid）。

### 规划中

| 能力 | 项目 | 集成形态 | 贡献 | 优先级 |
|------|------|----------|------|--------|
| 符号级重构（rename/find-references/replace-body） | **serena** | MCP Server（Python 3.13 + uv + LSP） | 从"文本替换"升级为"语义操作"，40+ 语言，跨文件 rename | P1 |

**与已有能力关系**：serena 互补——codegraph 做"检索"，serena 做"语义编辑"。read/edit 工具做文本级，serena 做符号级。

### 不采纳

| 项目 | 理由 |
|------|------|
| Understand-Anything | 与 codegraph+CRG+openwiki 三方高度冗余 |
| Graphify | 功能最强但 Python 重依赖；codegraph 已覆盖核心图谱，借鉴社区检测理念即可 |

---

## 二、知识中心

> 项目文档 + 跨会话记忆 + 深度研究——让 Agent 越用越懂项目，不遗忘已学的事实。

### 已集成

| 能力 | 项目 | 集成形态 | 定位 |
|------|------|----------|------|
| 项目 Wiki 自动生成与维护 | **openwiki** | vendored CLI + Skill + 桌面面板 | 为代码库生成 Agent 可引用的结构化文档 |
| 跨会话长期记忆 | **TencentDB-Agent-Memory** | core SDK（perf 分支） | 四层记忆 + 符号化检索，替换了原规划的 mem0 |

### 规划中

| 能力 | 项目 | 集成形态 | 贡献 | 优先级 |
|------|------|----------|------|--------|
| 多轮深度研究 | **Open Deep Research** 理念 | 借鉴工作流，Node.js 自建轻量版 | 从"单次 WebSearch"升级为"搜索→反思→再搜索→报告"的多轮循环 | P3 |

**关系说明**：Open Deep Research 是 Python（LangGraph），违背零依赖。借鉴其 4 阶段工作流（摘要→研究→压缩→报告），用 DeepOrca 的 Node.js 引擎自建轻量版。

---

## 三、设计生成

> brief → 生成 → 预览 → 交付 的全流程设计能力。Agent 是画师，Electron webview 是画布，Canvas UI 是画笔。

### 已集成

| 能力 | 项目 | 集成形态 | 定位 |
|------|------|----------|------|
| 通用设计生成（原型/落地页） | **DeepDesign** Phase 1 | Skill + seed 模板 + 3 设计系统 | 复刻 Claude Design 核心，零 daemon，Electron webview 预览 |
| 演示文稿生成 | **Bento Slides** | 内置 Skill | JSON → 单 HTML 文件（编辑器+放映+文档一体） |

**DeepDesign 已有文件**：
- `deep-design` SKILL.md（工作流编排）
- `seed.html` + `layouts.md`（8 个 section 骨架 + P0/P1/P2 自检清单）
- 3 个 DESIGN.md 系统（dark-tech / modern-minimal / editorial）

### 规划中

| 能力 | 项目 | 集成形态 | 贡献 | 优先级 |
|------|------|----------|------|--------|
| 前端设计质量纪律 | **taste-skill** | 构建 Skill（纯 SKILL.md） | 布局/排版/动效/间距的反 slop 方法论，框架无关 | P1 |
| 视觉特效"画笔" | **Canvas UI** | 构建时 vendor 组件源码 | 25 个 Canvas/WebGL 特效（液体/火焰/玻璃/粒子），Agent 按需内联 | P1 |
| 仪表盘模板 | DeepDesign dashboard | seed + layouts | 侧边栏 + KPI 卡 + 内联 SVG 图表 | P2 |
| 演示文稿模板 | DeepDesign deck | seed + layouts | 横向翻页 + title/content slide | P2 |
| 移动端模板 | DeepDesign mobile-app | seed + layouts | iPhone 框架 + 多屏流程 | P3 |
| 海报模板 | DeepDesign poster | seed + layouts | 单页海报/社交媒体图 | P3 |

**实施路线**：
- Phase 1（已完成）：web-prototype 模板 + dark-tech 系统 + deep-design Skill
- Phase 2：dashboard/deck 模板 + 3 设计系统 + DESIGN.md 用户自建 + PDF 导出
- Phase 3：Canvas UI 特效 vendor + mobile-app/poster 模板 + DesignStudioPanel 桌面面板

**替代决策**：DeepDesign 替代了原路线图的 OpenDesign daemon 集成——同能力，零 daemon，轻量 10 倍。

---

## 四、浏览器与联网

> 登录态操控 + 大规模抓取 + 深度联网策略——让 Agent 能真正"上网干活"。

### 已集成

| 能力 | 项目 | 集成形态 | 定位 |
|------|------|----------|------|
| 真实 Chrome 操控（携带登录态） | **browser-skill** (bsk) | 内置插件（Rust CLI + Chrome 扩展） | 通用页面操控——表单/截图/UI 测试，Agent Window 隔离 |
| 单次网络搜索 | **WebSearch** | 内置工具 | 脚本钩子或托管 API，单次查询→文本结果 |

### 规划中

| 能力 | 项目 | 集成形态 | 贡献 | 优先级 |
|------|------|----------|------|--------|
| 大规模无头抓取 + Stealth | **obscura** | MCP Server（Rust 单二进制） | 30MB 内存、85ms 加载、反检测——bsk 做操控，obscura 做抓取 | P2 |
| 联网策略 + 站点经验 | **web-access** 理念 | 借鉴 Skill（不整体引入） | 联网工具自动选择（WebSearch/curl/Jina/CDP）+ 按域名积累操作经验 | P3 |

**分工设计**：
```
用户请求 → Agent 判断任务类型
  ├─ 通用页面操控（表单/UI 测试）→ browser-skill（登录态操控）
  ├─ 大规模数据抓取 / 反爬虫 → obscura（轻量无头 + Stealth）
  └─ 联网搜索 / 信息检索 → WebSearch（单次）/ Open Deep Research（多轮，规划中）
```

**关键判定**：web-access 的核心能力（真实 Chrome + 登录态）与 bsk 冗余，不整体引入。只借鉴其"联网策略选择 + 站点经验积累"两个独特点。

---

## 五、桌面自动化

> 操控无 API 的桌面软件——让 Agent 不局限于终端和浏览器。

### 规划中（全新空白域）

| 能力 | 项目 | 集成形态 | 贡献 | 优先级 |
|------|------|----------|------|--------|
| 桌面 GUI 操控 | **pi-computer-use** | Pi 扩展（macOS Swift + Windows Rust） | 查找窗口/观察 UI/点击输入/等待变化——操控 Figma/Photoshop/Excel 等桌面软件 | P2 |
| 万能 CLI 生成 | **CLI-Anything** | 内置 Skill（HARNESS.md 方法论） | 7 阶段为任意软件自动生成 CLI（分析→设计→实现→测试→文档→发布） | P2 |

**互补关系**：pi-computer-use 直接操控 GUI，CLI-Anything 把软件变成 CLI——两种思路解决同一问题（驱动无 API 的软件）。

---

## 六、引擎演进

> DeepOrca 引擎层的核心能力升级——模型路由、技能自演化、子 agent、自改进。

### 已集成

| 能力 | 来源 | 定位 |
|------|------|------|
| Plan Mode（3 阶段对话 + 权限强制 + proposed_plan） | 引擎核心 | 规划层权威——引擎级权限强制，force-ask 写操作 |
| UpdatePlan（markdown TODO 跟踪） | 引擎核心 | 执行阶段进度跟踪 |
| 模型路由（轻量子任务→flash） | `model-capabilities.ts` | 子任务降级（技能匹配/prompt 增强/压缩用 flash） |
| Electron 35（Node 22.16） | 引擎升级 | 内部插件零外部依赖（node:sqlite + require(esm)） |

### 规划中

| 能力 | 来源 | 贡献 | 优先级 |
|------|------|------|--------|
| 模型中途切换 | **Prewalk** 理念 | 贵模型规划→首次编辑→切换廉价模型执行。基于 model-capabilities.ts + UpdatePlan 扩展 | P1 |
| 技能自演化 | **OpenSpace** 理念 | 执行→评估→改进闭环。skill-digester 只改描述文案，无执行反馈——填补此空白 | P2 |
| 子 agent（Subagent） | **DeepCode** 架构理念 | Paper2Code（论文→代码）+ Loop engineering（自主循环直到测试通过）。加 Task 工具 + runSubagent | P2 |
| harness 自改进 | **Self-Harness** 论文理念 | 弱点挖掘→harness 提案→回归测试。与 OpenSpace 合并为统一自改进方向 | P3 |

**架构可行性**（已验证）：DeepOrca 引擎对 subagent 友好——`activateSession` 已是 public 按 sessionId 参数化的纯异步函数，所有状态 Map<sessionId> 结构。加一个 Task 工具 + 抽取 `runSubagent()` 即可，不需重新设计引擎。

---

## 七、插件中心

> 统一的插件/技能/MCP 管理入口——内置项分组展示，用户自定义项独立管理。

### 已集成

| 能力 | 来源 | 定位 |
|------|------|------|
| 分组展示 | `builtin-plugins.json` 清单 | 内置 skills/MCP/plugins 按工具分组（Flutter/CodeGraph/代码审查/GitMCP…） |
| 内置项隔离 | MCP/Skills tab 过滤 | 内置项不在 MCP/Skills tab 单独展示，仅在 Plugins tab 分组卡片中 |
| Flutter/Dart 技能包 | flutter/agent-plugins | 24 个技能构建时内置 |

### 规划中

| 能力 | 项目 | 贡献 | 优先级 |
|------|------|------|--------|
| 网站适配器 + CLI Hub | **opencli** | 100+ 网站适配器（数据获取）+ CLI Hub 统一入口 | P2 |

---

## 搁置项

> 以下项目经深入分析后**暂时搁置**，不纳入当前规划。

| 项目 | 搁置理由 | 重新评估条件 |
|------|----------|-------------|
| **OpenSpec** | Plan Mode 已有成熟的提案→批准→执行流程（含权限强制），OpenSpec 的增量价值（spec 持久化）触及引擎核心改动，风险高 | Plan Mode 的 spec 持久化需求明确且迫切时重新评估 |
| **Superpowers** | 执行纪律类 skill（TDD/debug/review）可共存，但规划类（brainstorming/writing-plans）与 Plan Mode 争夺控制权；子 agent 类（subagent-driven）DeepOrca 无 Task 工具 | 引擎加入 Task 工具后，重新评估执行纪律类 skill 的引入 |
| **OmniGent** | meta-harness 与 DeepOrca 自身 harness 定位冲突，不互补 | 永不采纳（架构层级冲突） |

---

## 已集成能力清单（完整索引）

> 以下能力已在代码仓库中落地（跨 dev / perf / master 分支）。

| 能力 | commit / 分支 | 功能域 |
|------|---------------|--------|
| codegraph（导航层 MCP） | vendored CLI | 代码智能 |
| CRG（分析层 MCP） | `1f5146e` dev | 代码智能 |
| ocr（AI 审查） | `873f437` dev | 代码智能 |
| openwiki（Wiki 生成） | vendored CLI | 知识中心 |
| TencentDB-Agent-Memory（记忆） | `08308c5` perf | 知识中心 |
| DeepDesign Phase 1（设计生成） | `127c912` perf | 设计生成 |
| Bento Slides（演示文稿） | `08308c5` perf | 设计生成 |
| browser-skill（浏览器操控） | 内置插件 | 浏览器与联网 |
| flutter/agent-plugins（24 技能） | 构建 skills | 插件中心 |
| Plan Mode（规划+权限强制） | 引擎核心 | 引擎演进 |
| UpdatePlan（进度跟踪） | 引擎核心 | 引擎演进 |
| Electron 35（零外部依赖） | `d0ebc79` dev | 引擎演进 |
| 插件中心分组 | `dbf94fb`+`b70a7bb` perf | 插件中心 |
| vendor 镜像兜底 | `4eb24c0` dev | 引擎演进 |
| spawn 修复 | `04c1585` dev | 引擎演进 |

---

## 设计原则（v3.0 确立）

1. **零外部运行时依赖** — 内部插件全部跑 Electron 自带 Node，不依赖宿主机 Node/npm/Python（已有 codegraph/openwiki/ocr 验证）
2. **Agent 是引擎，浏览器是渲染层** — 不自研渲染/设计引擎，设计稿是 LLM 写的 HTML，展示靠 Electron webview（DeepDesign 核心洞察）
3. **三层代码智能分工** — codegraph（在哪）→ CRG（多危险）→ ocr/serena（怎么改），不重叠
4. **浏览器分工** — bsk（登录态操控）+ obscura（大规模抓取），不引入第三个冗余方案
5. **引擎演进渐进式** — Plan Mode 为权威，Prewalk/OpenSpace/Subagent 在其上叠加，不替换核心流程
6. **直接集成不从零开发** — 所有规划项目以 MCP/Skill/SDK/vendor 形式直接嵌入
7. **搁置优于冒进** — OpenSpec/Superpowers 触及核心流程，搁置等待条件成熟

---

> 关联文档：
> - [DeepDesign 内核设计](../../specs/deep-design/design.md)
> - [前期集成调研（5 项目）](../research/2026-07-open-source-integration-feasibility.md)
> - [OCR 集成 & Understand-Anything 分析](../research/2026-07-ocr-integration-and-ua-analysis.md)
