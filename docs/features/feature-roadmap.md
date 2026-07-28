# Orca Feature 集成路线图（下阶段）

> 版本：v2.3 · 日期：2026-07-28 · 状态：规划中
> 本文件定义下阶段开源项目的**直接集成**方案。所有项目均为直接集成到 Orca 中，非从零开发。
> v2.1 更新：新增 Penpot vs Open Design 对比分析（选择 Open Design），新增 Obscura 轻量级无头浏览器集成，标记已集成项目。
> v2.2 更新：新增 3 个引擎层/方法论项目调研（Prewalk、OpenSpace、OpenSpec）——基于完整 README（webReader 抓取）的深度分析，含集成成本与实现形态判定。
> v2.3 更新：新增 3 个候选项目深度调研——TencentDB-Agent-Memory（挑战 #4 mem0 的更强记忆方案）、Graphify（挑战 #2 code-review-graph 的更强图谱方案）、Bento（填补演示文稿生成空白）。含与现有路线图项目的对比与替换/并存判定。重新定位 #2 code-review-graph 为分析层（非图谱层），明确与已集成 codegraph 的互补关系；新增 CRG vs OCR 审查范式对比与协同方案。

---

## 总览

| # | 项目 | 集成形态 | 核心价值 | 优先级 | 状态 |
|---|------|----------|----------|--------|------|
| 1 | flutter/agent-plugins | 构建时内置 Skills | Flutter/Dart 开发能力包 | P0 | ✅ **已集成** |
| 2 | code-review-graph | 内置 MCP Server | **代码审查 + 风险分析 + 架构智能**（v2.3 重新定位：分析层，非图谱层） | P0 | 📋 规划中 |
| 3 | serena | 内置 MCP Server | 符号级重构/导航/编辑 | P1 | 📋 规划中 |
| 4 | TencentDB-Agent-Memory | core 层 SDK | 跨会话长期记忆（v2.3 替换 mem0） | P1 | 📋 规划中 |
| 5 | openwiki | 内置 CLI 工具 | 项目 Wiki 自动生成与维护 | P1 | ✅ **已集成** |
| 6 | opencli | 内置插件 | 100+ 网站适配器 + CLI Hub | P2 | 📋 规划中 |
| 7 | CLI-Anything | 内置 Skill | 万能 CLI 生成（Agent 驱动任意软件） | P2 | 📋 规划中 |
| 8 | open-design | MCP Server（设计+展示） | AI 设计生成 + 文件交付给 coding agent | P2 | 📋 规划中 |
| 9 | obscura | MCP Server + 内置 Skill | 轻量级无头浏览器（大规模数据获取） | P2 | 📋 规划中 |
| 10 | bento | MCP Server + 内置 Skill | 演示文稿生成（单 HTML 文件，v2.3 新增） | P3 | 📋 规划中 |

**已集成项目说明**：
- ✅ **flutter/agent-plugins**：构建脚本 `scripts/install-flutter-skills.js`，已内置 26 个 Flutter/Dart Skills 到 `packages/core/templates/skills/bundled/`
- ✅ **openwiki**：vendored CLI（`packages/desktop/vendor/openwiki/`）+ 内置 Skill（`packages/core/templates/skills/bundled/openwiki/`）+ 桌面端 Wiki 面板集成

**额外已集成项目**（不在本路线图 10 个项目中）：
- ✅ **codegraph**（`@colbymchenry/codegraph` v1.5.0）：vendored CLI（`packages/desktop/vendor/codegraph/`）+ 桌面端索引管理面板 + 内置 MCP Server。定位为**导航/检索层**——TypeScript 原生、始终在线（原生文件 watcher）、LLM 面向的"代码 GPS"。默认暴露 1 个工具（`codegraph_explore`，一次调用返回源码+调用链+影响范围），可选 8 个。35 语言支持（20 个 Rust kernel）。作为 #2 code-review-graph 的**互补导航层**，两者不竞争——codegraph 做"在哪/谁调用谁"，CRG 做"多危险/架构如何"

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

## 总览 — 候选项目深度评估（v2.3 新增）

> 以下 3 个项目经深度调研后评估。**每个都对应现有路线图中的某个项目或空白域**，需做出"替换 / 并存 / 不采纳"的明确判定。

| # | 项目 | 对标的现有项 | 判定 | 核心理由 |
|---|------|-------------|------|----------|
| D | TencentDB-Agent-Memory | #4 mem0 | 🔄 **建议替换 mem0** | 理念更先进（四层记忆+白盒+符号化），技术栈完美匹配（TS ESM+Node 22+SQLite），更适合长期记忆 |
| E | Graphify | #2 code-review-graph / 已集成 codegraph | ⚠️ **不直接集成，借鉴补强** | 功能最强但 Python 3.10+ 依赖是硬伤；已有 codegraph，补其缺失的多模态/社区检测能力即可 |
| F | Bento | 空白域（演示文稿） | ✅ **新增 P3 候选** | 填补"生成可编辑幻灯片"空白，单 HTML 文件理念契合桌面端，但项目极新需观望 |

**核心判断**：
- **D 是本次调研的最大收获**——TencentDB-Agent-Memory 在记忆能力上全面超越 mem0，且技术栈完全匹配，建议作为 #4 的**首选方案**，mem0 降级为备选
- **E 不值得引入新依赖**——Graphify 的核心价值（代码图谱）DeepOrca 已通过 codegraph 具备，其增量能力（社区检测、多模态）可通过增强 codegraph 实现
- **F 是真正的空白填补**——但项目仅 2 周龄、2 人维护，建议设为 P3 观望项，待其稳定后再集成

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

## 二、code-review-graph — 代码审查与风险分析平台（v2.3 重新定位）

> 仓库：https://github.com/tirth8205/code-review-graph
> Stars：~27.2k · 许可：MIT · 版本：v2.3.7 · 30 个 MCP 工具 + 5 个 MCP Prompt

### 核心定位变更（v2.3 关键修正）

> **⚠️ CRG 不是 codegraph 的替代品或升级版——两者是不同层。**
>
> - **codegraph（已集成）= 导航/检索层**——TypeScript 原生、始终在线、LLM 面向的"代码 GPS"，回答"这个符号在哪、谁调用谁"
> - **CRG（规划中）= 分析/审查层**——Python 重工具、按需调用的"代码审计师"，回答"这次改动有多危险、架构健康度如何、哪些是脆弱节点"
>
> **它们互补而非竞争。** 两者都会保留，各司其职。

### 两层能力分工

| 能力域 | codegraph（已集成，导航层） | CRG（规划中，分析层） |
|--------|----------------------------|----------------------|
| **符号检索** | ✅ `codegraph_explore` 一次调用返回源码+调用链 | ❌ 不做（CRG 假设你已能导航） |
| **调用关系** | ✅ callers/callees/impact（默认深度 2） | ✅ traverse_graph（BFS/DFS + token 预算） |
| **爆炸半径** | ✅ 基础（`codegraph_impact`） | ✅ **深度**——BFS + 测试覆盖缺口 + 受影响流程 |
| **风险评分** | ❌ 无 | ✅ **核心差异化**——per-node risk_index（调用数+测试覆盖+安全相关性），CI 可 `fail-on-risk` |
| **社区检测** | ❌ 无 | ✅ **核心差异化**——Leiden 算法（igraph），自动分辨率缩放，cohesion 度量 |
| **架构总览** | ❌ 无 | ✅ **核心差异化**——从社区结构生成 + 跨社区耦合警告 |
| **Hub/Bridge 分析** | ❌ 无 | ✅ **核心差异化**——度中心性 + 介数中心性（采样近似） |
| **知识缺口** | ❌ 无 | ✅ **核心差异化**——孤立节点/稀薄社区/未测试热点 |
| **惊喜连接** | ❌ 无 | ✅ **核心差异化**——跨社区/跨语言耦合异常评分 |
| **执行流追踪** | ❌ 无 | ✅ 入口点流程检测 + 关键度评分（Python 强，JS/Go 弱） |
| **变更检测** | ❌ 无 | ✅ **核心差异化**——git diff → 受影响函数/流程/社区/测试缺口，按优先级排序 |
| **PR 审查** | ❌ 无 | ✅ **核心差异化**——GitHub Action 发 sticky 风险评论 + CI 门控 |
| **重构工具** | ❌ 无 | ✅ rename 预览 + 死代码检测 + apply |
| **Wiki 生成** | ❌ 无（由 openwiki 承担） | ✅ 按社区生成 Markdown wiki（可选 Ollama 摘要） |
| **语言** | TypeScript 原生（35 语言，20 个 Rust kernel） | Python（35 语言，tree-sitter） |
| **存储** | SQLite（WAL），项目级 `.codegraph/` | SQLite（WAL），项目级 `.code-review-graph/` |
| **同步** | 始终在线（原生文件 watcher，~1s 延迟） | 按需（`build` / `watch` / `daemon`） |
| **LLM 工具** | 默认暴露 1 个（`codegraph_explore`），可选 8 个 | 暴露 30 个（可过滤子集） |
| **依赖** | 零外部（vendored，Node 22） | Python 3.10+（基础轻量，分析能力可选重依赖） |

**结论**：codegraph 解决"**导航效率**"（一次调用代替 grep/Read 循环），CRG 解决"**分析深度**"（风险、架构、审查）。两者并行工作不冲突。

### 为什么两层都需要

**场景 1：Agent 日常编码**（codegraph 主场）
```
用户："修改 loginUser 函数"
→ codegraph_explore 一次返回 loginUser 源码 + 所有调用方 + 受影响文件
→ Agent 直接编码
（CRG 不参与——日常导航用不到风险评分）
```

**场景 2：代码审查 / 大重构前评估**（CRG 主场）
```
用户："审查这个 PR" / "评估重构安全性"
→ CRG detect_changes：风险评分 + 受影响流程 + 测试缺口
→ CRG get_hub_nodes + get_bridge_nodes：识别脆弱节点
→ CRG get_surprising_connections：发现跨模块异常耦合
→ Agent 生成结构化审查报告
（codegraph 不参与——它不做分析，只做导航）
```

**场景 3：架构理解**（两者协同）
```
用户："解释这个项目的架构"
→ CRG get_architecture_overview：社区结构 + 模块边界
→ codegraph_explore：深入特定模块的符号和调用链
→ Agent 生成层次化架构说明
```

### CRG 的 30 个工具分类

**图谱构建 / 生命周期**（4 个）：build、postprocess、embed、stats + 多仓库管理

**上下文检索**（8 个）：minimal_context（~100 token 概览）、review_context、impact_radius、query、traverse、semantic_search、docs_section、find_large_functions

**流程分析**（3 个）：list_flows、get_flow、get_affected_flows

**社区/架构**（3 个）：list_communities、get_community、get_architecture_overview

**分析与风险**（6 个）⭐ 核心差异化：detect_changes（风险评分）、get_hub_nodes（度中心性）、get_bridge_nodes（介数中心性）、get_knowledge_gaps（知识缺口）、get_surprising_connections（异常耦合）、get_suggested_questions（自动审查问题）

**重构/Wiki**（4 个）：refactor、apply_refactor、generate_wiki、get_wiki_page

**5 个 MCP Prompt**（工作流模板）：review_changes、architecture_map、debug_issue、onboard_developer、pre_merge_check

### 与现有能力的适配度

| 维度 | 评估 |
|------|------|
| codegraph（导航层） | 🟢 **互补非竞争**——codegraph 做导航，CRG 做分析，两者各司其职 |
| 代码审查面板 | 🟢 直接增强——风险评分 + 影响范围 + 审查问题注入现有 OCR 审查 |
| MCP 系统 | 🟢 原生兼容——stdio/HTTP MCP Server（FastMCP） |
| 运行时依赖 | 🟡 Python 3.10+（基础轻量，igraph/embeddings 可选） |
| openwiki | 🟡 轻微重叠——CRG 有 wiki 生成，但 openwiki 更专精，CRG wiki 不作为重点 |
| 许可 | 🟢 MIT |

### 集成方案（聚焦分析层能力）

**Phase 1 — MCP Server + 工具子集过滤**：
```json
{
  "mcpServers": {
    "code-review-graph": {
      "command": "code-review-graph",
      "args": ["serve", "--tools",
        "detect_changes_tool,get_impact_radius_tool,get_review_context_tool",
        "get_hub_nodes_tool,get_bridge_nodes_tool,get_surprising_connections_tool,get_knowledge_gaps_tool",
        "get_architecture_overview_tool,list_communities_tool",
        "get_suggested_questions_tool,find_large_functions_tool"
      ]
    }
  }
}
```

**关键：工具过滤策略**——只暴露 CRG 的**分析层独有工具**（10/30），过滤掉与 codegraph 重叠的导航类工具（query_graph、traverse_graph、semantic_search 等），减少 token 消耗，明确分工。

**Phase 2 — 审查面板深度增强**：
- 审查意见旁展示「影响范围」列表（文本形式，非 D3 图）
- 调用 `detect_changes` 获取风险评分，在面板顶部展示风险等级（high ≥0.70 / critical ≥0.85）
- 注入 `get_suggested_questions` 的自动审查问题作为审查清单
- 展示 `get_knowledge_gaps` 识别的未测试热点

**Phase 3 — 架构健康度面板**：
- 调用 `get_architecture_overview` 获取社区结构
- 渲染为 **Mermaid 流程图**（非 D3.js），桌面端用 mermaid.js 轻量渲染
- 展示 hub/bridge 节点（脆弱性热点）和 surprising connections（架构异味）
- 点击模块可查看包含的文件和函数列表

### 运行时依赖处理

| 依赖 | 必需性 | 处理策略 |
|------|--------|----------|
| Python 3.10+ | 必需 | `pip install code-review-graph`（基础安装轻量） |
| igraph（Leiden 社区检测） | 可选 | `pip install code-review-graph[communities]`——架构分析需要 |
| sentence-transformers（嵌入） | 可选 | 暂不安装——语义搜索由 codegraph 承担 |
| jedi（Python 符号增强） | 可选 | 按需 |
| ollama（Wiki 摘要） | 可选 | 不用——Wiki 由 openwiki 承担 |

**依赖隔离原则**：CRG 作为**可选增强**，不强制安装。未安装 CRG 时，codegraph 继续提供导航能力，仅缺少深度分析。桌面端检测 CRG 是否可用，动态显示/隐藏分析面板。

### CRG vs OCR（Open Code Review）—— 两种审查范式协同

> **⚠️ 关键澄清**：CRG 和 OCR（已集成的阿里巴巴 Open Code Review）都叫"代码审查"，但它们是**完全不同的审查范式**，不竞争，反而应该协同。

#### 本质区别

| 维度 | OCR（已集成） | CRG（规划中） |
|------|---------------|---------------|
| **审查范式** | **LLM 驱动的质量审查** | **算法驱动的结构分析** |
| **核心问题** | "这段代码写得好不好？" | "改这里会影响什么？" |
| **用什么审查** | LLM（ocr 自己的模型端点） | 纯算法（tree-sitter + 图论 + 启发式） |
| **审查什么** | 代码质量、安全漏洞、正确性、风格、bug | 结构影响、风险评分、测试覆盖缺口、架构健康度 |
| **输出** | 行级审查意见（file/line/severity/message/suggestion） | 风险评分 + 受影响函数/流程/社区列表 |
| **严重级别** | critical / warning / info（代码质量问题） | low / medium / high / critical（风险等级，0.4/0.7/0.85 阈值） |
| **LLM 依赖** | ✅ **必需**——ocr 内部用自己的 LLM 端点做审查 | ❌ **完全不用**——纯确定性 Python 算法 |
| **代码理解深度** | 语义级（LLM 理解代码逻辑） | 结构级（AST + 图拓扑，不理解逻辑） |
| **误报倾向** | 可能误判（LLM 幻觉） | 保守（宁可多报影响范围） |

#### 各自审查什么（不重叠）

**OCR 审查的（CRG 完全不做）**：
- ✅ 代码质量问题（命名、复杂度、可读性）
- ✅ 安全漏洞检测（注入、认证缺陷、敏感信息泄露）
- ✅ 正确性/bug（空指针、逻辑错误、边界条件）
- ✅ 代码风格建议
- ✅ 行级修改建议（suggestion）
- → **本质**：让 LLM 阅读代码 diff，像人类 reviewer 一样给出意见

**CRG 审查的（OCR 完全不做）**：
- ✅ 爆炸半径（改这个函数影响哪些下游）
- ✅ 风险评分（基于 fan-out、hub/bridge、测试覆盖、安全关键词）
- ✅ 测试覆盖缺口（改了生产代码但无测试关系的节点）
- ✅ 受影响执行流程
- ✅ 架构健康度（社区检测、hub/bridge 脆弱节点）
- ✅ 跨模块异常耦合
- → **本质**：用图算法算出"哪些改动最危险"，帮人类/LLM 聚焦

#### 协同工作流（两者互补的完整审查）

```
用户提交 PR / 请求审查
│
├─ 第一步：CRG 结构分析（先跑，快、确定、无 LLM 成本）
│  ├─ detect_changes → 风险评分 + 受影响函数列表
│  ├─ get_impact_radius → 爆炸半径
│  ├─ get_knowledge_gaps → 未测试热点
│  └─ 输出："这次改动涉及 8 个函数，其中 3 个高风险（hub 节点+无测试），
│           影响 2 个执行流程，测试缺口 5 处"
│
├─ 第二步：OCR 质量审查（聚焦高风险函数，省 token）
│  ├─ 只对 CRG 标记为 high/critical 的函数调用 ocr review
│  ├─ ocr 的 LLM 阅读这些函数的 diff → 质量意见
│  └─ 输出："loginUser 第 42 行有空指针风险（warning）；
│           checkPermission 缺少权限校验（critical）"
│
└─ 合并报告：结构风险（CRG）+ 质量问题（OCR）
   "3 个高风险函数（CRG），其中 2 个有质量问题（OCR）"
```

**协同价值**：
- CRG 做了 **triage（分诊）**——从 500 文件 diff 中筛出 5 个关键函数
- OCR 做了 **diagnosis（诊断）**——对这 5 个函数做深度 LLM 审查
- 单独用 OCR：对大 diff 盲目审查，token 爆炸且容易遗漏关键影响
- 单独用 CRG：知道哪里危险但不知道代码写得对不对
- **两者结合**：精准聚焦 + 深度诊断 = 完整审查

#### 集成时的分工设计

| 触发场景 | 用 OCR | 用 CRG | 用两者 |
|----------|--------|--------|--------|
| 用户点击"审查代码" | ✅ 质量审查 | ✅ 先跑风险分析 | ✅ **协同** |
| Agent 日常编码后 | ✅ 快速质量检查 | ❌ 太重 | |
| PR 合并前 | ✅ | ✅ CI 门控（fail-on-risk） | ✅ **协同** |
| 架构评估 | ❌ 不适用 | ✅ 社区/hub/bridge | |
| 新人 onboarding | ❌ 不适用 | ✅ architecture_map | |

**桌面端面板设计**：
- 现有 OCR 审查面板保持不变（LLM 质量审查）
- CRG 分析结果**注入** OCR 审查面板顶部——作为"风险概览"区域
- 用户先看 CRG 的结构风险摘要，再看 OCR 的行级质量意见
- 两者的严重级别用不同视觉区分（CRG = 影响范围 / OCR = 代码质量）

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

## 四、跨会话长期记忆 — TencentDB-Agent-Memory（v2.3 替换 mem0）

> 仓库：https://github.com/TencentCloud/TencentDB-Agent-Memory
> **⚠️ v2.3 变更**：原 #4 mem0 经与 TencentDB-Agent-Memory 深度对比后，**建议替换为 TencentDB-Agent-Memory**。mem0 降级为备选方案。详细对比见 [附录 D](#d-tencentdb-agent-memory--四层记忆--符号化检索)。

### 作用

腾讯云出品的团队级 AI Agent 记忆中枢。将对话/文档/代码转化为四种可复用、可治理、可共享的记忆资产：Chat Memory、Skill、LLM-Wiki、Code-Graph。

**核心理念**：拒绝"暴力堆历史"和"不可逆有损摘要"两种极端，保持原文不丢的同时构建可查询的结构化层——"原文不丢、结构可查"。

**性能声明**（项目方自测）：最高节省 61.38% token，通过率提升 51.52%；PersonaMem 长期记忆评估准确率从 48% 提升至 76%。

### 为什么替换 mem0（v2.3 核心判定）

| 维度 | mem0 | TencentDB-Agent-Memory | 判定 |
|------|------|------------------------|------|
| **记忆模型** | 三级（User/Session/Agent）扁平事实提取 | **四层渐进式管线**（L0 原文→L1 原子事实→L2 场景摘要→L3 用户画像） | 🟢 TDAM 显著更先进 |
| **可调试性** | 黑盒（向量分数不可读） | **白盒**——关键中间产物为人类可读的 Markdown + Mermaid 画布 | 🟢 TDAM 更符合 DeepOrca 的透明理念 |
| **检索方式** | 语义+BM25+实体 | **混合检索**（BM25 + 向量 + RRF 融合）+ 符号化记忆（Mermaid 符号图 + node_id 回溯原文） | 🟢 TDAM 检索更精准 |
| **技术栈** | Python SDK（需 Python 运行时） | **TypeScript ESM + Node ≥ 22.16 + SQLite + sqlite-vec** | 🟢 TDAM 与 DeepOrca 完美匹配（零 Python） |
| **本地优先** | 需 Library/Self-Hosted 模式 | **默认完全本地**（SQLite + sqlite-vec），零外部 API 依赖 | 🟢 TDAM 更契合本地优先原则 |
| **成熟度** | Apache-2.0，较成熟 | MIT，~9.3k stars，v0.3.6（pre-1.0），GitHub Trending #1 | 🟡 mem0 更成熟，但 TDAM 势头强 |
| **LLM 配置** | OpenAI-compatible | OpenAI-compatible（默认 DeepSeek-V3.2，可复用 Orca 配置） | 🟢 平局 |

**结论**：TencentDB-Agent-Memory 在**记忆模型先进性、白盒可调试性、技术栈匹配度、本地优先**四个关键维度全面优于 mem0，且许可更宽松（MIT vs Apache-2.0）。唯一风险是 pre-1.0 成熟度，但其 9.3k stars 和活跃度表明社区认可度高。

### 与现有能力的适配度

| 维度 | 评估 |
|------|------|
| 会话持久化 | 🟢 互补 — Orca 有会话恢复但无智能记忆提取 |
| core 层 | 🟢 TypeScript ESM，可直接作为 core 层 SDK |
| LLM 配置 | 🟢 OpenAI-compatible，复用 Orca 已有的 LLM 端点 |
| 存储 | 🟢 默认 SQLite（本地优先），可选迁移到腾讯云 VectorDB |
| 隐私 | 🟢 默认完全本地，零外部 API 依赖 |
| Node 版本 | 🟢 要求 ≥ 22.16，DeepOrca 已是 Node 22 |
| 许可 | 🟢 MIT |

### 集成方案

**Phase 1 — core 层 SDK 集成**：
```bash
npm install @tencentdb-agent-memory/memory-tencentdb  # core 依赖
```
- 会话结束 → 自动提取关键事实，走 L0→L1→L2→L3 四层管线存储
- 会话开始 → 混合检索（BM25+向量+RRF）相关记忆注入 system prompt
- 使用 Orca 已配置的 LLM 端点做记忆提取（默认 DeepSeek-V3.2 正好匹配）

**Phase 2 — 符号化记忆面板**：
利用 TDAM 的白盒特性，在桌面端展示：
- 记忆画布（Mermaid 可视化 L2 场景摘要 + L3 用户画像）
- 原文回溯（点击符号节点 → grep/retrieve 原始对话文本）
- 这正是 TDAM 区别于 mem0 黑盒的核心优势

**Phase 3 — 与 openwiki + codegraph 融合**：
- TDAM 的 LLM-Wiki 资产与 openwiki 生成的项目文档互补
- TDAM 的 Code-Graph 资产与已集成的 codegraph 互补
- 三者共同组成「项目知识中心」的记忆层

### 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| pre-1.0 API 变动 | 封装适配层，隔离 TDAM API 变更 |
| 手动补丁需重应用（OpenClaw 场景） | DeepOrca 不走 OpenClaw，直接用 npm SDK，无此问题 |
| 嵌入模型维度配置陷阱（BGE-M3 需 sendDimensions=false） | 文档记录，默认配置规避 |
| mem0 备选 | 保留 mem0 集成方案作为 fallback，适配层抽象记忆接口 |

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

## D、TencentDB-Agent-Memory — 四层记忆 + 符号化检索

> 仓库：https://github.com/TencentCloud/TencentDB-Agent-Memory
> 出品方：腾讯云 · 许可：MIT · Stars：~9.3k · 状态：v0.3.6（pre-1.0）· GitHub Trending #1（2026-07-08）

### D.1 作用与核心价值

团队级 AI Agent 记忆中枢。将对话/文档/代码转化为四种可复用、可治理、可共享的记忆资产：**Chat Memory、Skill、LLM-Wiki、Code-Graph**。

**解决的痛点**（当前 Agent 记忆的两大失败模式）：
1. **跨会话上下文断裂**——长期任务失去连续性
2. **朴素摘要的两难**——堆历史撑爆 token / 有损摘要丢失原文真相

**核心理念**："原文不丢、结构可查"——拒绝暴力堆历史和不可逆有损摘要两种极端，保持原文完整的同时构建可查询的结构化层。

### D.2 架构：两大支柱

**支柱一：记忆分层（Memory Layering）**

异构存储 + 渐进式披露，四层渐进式管线（L0→L1→L2→L3）：

| 层级 | 名称 | 内容 | 类比 |
|------|------|------|------|
| L0 | Raw Interaction | 所有原始对话轮次 | 原始日志 |
| L1 | Atomic Memory | 自动提取的事实、约束、偏好、阶段结论 | 原子事实 |
| L2 | Scenario Summary | 按特定任务聚合的原子记忆 | 任务摘要 |
| L3 | User Persona | 持续蒸馏的稳定长期用户画像 | 用户画像 |

运行"提取→聚合→蒸馏"管线，将不同粒度放在可互换的"楼层"上。短期上下文有自己的三层栈：底部原始输出 → 中间步骤摘要 → 顶部轻量 Mermaid 画布。

**支柱二：符号化记忆（Symbolic Memory）**

上下文卸载 + Mermaid 高密度语法。Agent 在符号图上推理，用 `node_id` 按需 grep/retrieve 完整原文——最小化 token 使用的同时保持可溯源性。

### D.3 技术栈（完美匹配 DeepOrca）

| 组件 | TencentDB-Agent-Memory | DeepOrca 现状 | 匹配度 |
|------|------------------------|---------------|--------|
| 语言/运行时 | TypeScript ESM, Node ≥ 22.16 | TypeScript ESM, Node ≥ 22 | 🟢 完美 |
| 模块系统 | ESM (`"type": "module"`) | ESM only | 🟢 完美 |
| 存储 | SQLite + sqlite-vec（默认本地） | 已有 SQLite 使用（codegraph） | 🟢 匹配 |
| LLM SDK | Vercel AI SDK + OpenAI-compatible | OpenAI-compatible | 🟢 可复用 |
| 默认模型 | DeepSeek-V3.2 | DeepSeek 系列主力 | 🟢 匹配 |
| 分词 | js-tiktoken + jieba（中文） | 已有 token 统计 | 🟢 匹配 |
| Schema | zod v4 | 已使用 zod | 🟢 匹配 |
| 构建 | tsdown, vitest | tsc, node:test | 🟡 不同但兼容 |

### D.4 与 mem0 的详细对比（替换判定依据）

| 维度 | mem0 | TencentDB-Agent-Memory | 胜者 |
|------|------|------------------------|------|
| **记忆模型** | 三级扁平（User/Session/Agent） | 四层渐进式（L0→L3）语义金字塔 | 🟢 TDAM |
| **可调试性** | 黑盒（不透明向量分数） | 白盒（Markdown + Mermaid 人类可读） | 🟢 TDAM |
| **检索** | 语义+BM25+实体 | BM25+向量+RRF 融合 + 符号化 node_id 回溯 | 🟢 TDAM |
| **语言** | Python SDK | TypeScript ESM | 🟢 TDAM（零 Python） |
| **本地优先** | 需配置 Library/Self-Hosted | 默认完全本地 | 🟢 TDAM |
| **许可** | Apache-2.0 | MIT | 🟢 TDAM（更宽松） |
| **成熟度** | 较成熟，1.0+ | v0.3.6 pre-1.0 | 🟡 mem0 |
| **社区** | 成熟社区 | 9.3k stars，Trending #1 | 🟡 平局 |
| **Benchmark** | LoCoMo 92.5 / LongMemEval 94.4 | token -61.38%, pass +51.52%, PersonaMem 48%→76% | 🟡 不可直接比 |

**最终判定**：TDAM 在 7/9 维度优于或持平 mem0，关键技术栈维度（TypeScript、本地优先、白盒）全面胜出。**建议替换**，mem0 作为备选保留。

### D.5 集成成本评估

| 维度 | 评估 | 说明 |
|------|------|------|
| 依赖复杂度 | 🟢 低 | 一个 npm 包，SQLite 已在用 |
| API 稳定性 | 🟡 中 | pre-1.0，需封装适配层 |
| 运行时开销 | 🟢 低 | 本地 SQLite，无外部服务 |
| 与现有代码冲突 | 🟢 无 | 纯新增，不改现有会话循环 |
| 回退方案 | 🟢 有 | mem0 作为 fallback，适配层抽象 |

### D.6 局限性与注意事项

- **pre-1.0 成熟度**：v0.3.6，API 和配置 schema 仍在变动 → 缓解：封装适配层
- **Benchmark 自报**：61.38% token 节省等数字是项目方自测，无第三方复现 → 缓解：自行基准测试
- **厂商亲和性**：部分功能（VectorDB 迁移、DeepSeek 默认）倾向腾讯云生态 → 缓解：本地模式不受影响
- **嵌入模型陷阱**：开源嵌入模型（如 BGE-M3）需设 `embedding.sendDimensions=false`，否则 HTTP 400 → 缓解：文档记录默认规避

---

## E、Graphify — 多模态代码知识图谱

> 仓库：https://github.com/Graphify-Labs/graphify
> 出品方：Graphify-Labs（Safi Shamsi）· 许可：Apache-2.0 OR MIT（双许可）· Stars：~97.4k · 状态：v0.9.29（pre-1.0，`v8` 分支）

### E.1 作用与核心价值

将代码库及其周边产物（文档、SQL schema、配置、PDF、图片、视频）转化为**可查询的知识图谱**。作为 `/graphify` skill 供 AI coding assistant 使用（Claude Code、Cursor、Codex、Gemini CLI 等）。

**核心卖点**：大规模代码库下"每查询 71.5 倍 token 节省"（52+ 文件场景；6 文件小目录约 1x）。

**关键特性**：
- **确定性本地代码解析**——tree-sitter AST，无 LLM，代码不离机
- **多模态摄取**——代码（~40 语言）、Markdown/PDF、图片/图表（via 助手视觉模型）、音频/视频（faster-whisper 本地转写）
- **图查询**——最短路径、节点解释、自然语言查询、连接追踪
- **连接透明度**——每条边标记 EXTRACTED / INFERRED / AMBIGUOUS
- **社区检测**——Leiden 算法（graspologic）识别子系统聚类
- **无向量库**——纯图遍历，不用 embedding
- **Wiki 模式**——`--wiki` 生成 Markdown 知识库供 Agent 按文件导航
- **增量更新 + watch**——SHA256 缓存，`--update` 合并，`--watch` 自动同步

### E.2 与 DeepOrca 现有能力的重叠分析

| Graphify 能力 | DeepOrca 现状 | 重叠/互补 |
|---------------|---------------|-----------|
| tree-sitter 代码解析 → 图 | ✅ 已集成 codegraph（vendored） | 🔴 **重叠**——codegraph 已做 |
| 最短路径/节点解释查询 | ✅ codegraph 已有 codegraph_explore | 🔴 **重叠** |
| ~40 语言支持 | ✅ codegraph 支持主流语言 | 🟡 Graphify 更广 |
| Mermaid Wiki 输出 | ✅ openwiki 已集成 | 🔴 **重叠**——openwiki 已做 |
| MCP Server 集成 | ✅ codegraph/openwiki 已 MCP 化 | 🔴 **重叠** |
| Leiden 社区检测 | ❌ DeepOrca 无 | 🟢 **互补**——空白能力 |
| 多模态（PDF/图片/音视频） | ❌ DeepOrca 无 | 🟢 **互补**——空白能力 |
| EXTRACTED/INFERRED/AMBIGUOUS 标签 | ❌ DeepOrca 无 | 🟢 **互补**——更精细的边语义 |
| rationale 提取（# NOTE/# WHY 注释） | ❌ DeepOrca 无 | 🟢 **互补**——理念新颖 |

### E.3 判定：不直接集成，借鉴补强 codegraph

**🔴 不采纳 Graphify 的理由**：

1. **核心功能三重重叠**：代码图谱（codegraph）、Wiki 生成（openwiki）、MCP 集成——Graphify 的三大卖点 DeepOrca 已全部具备
2. **Python 3.10+ 依赖是硬伤**：违背 DeepOrca "零外部 Python 运行时"原则（codegraph/openwiki 已努力消除 Python 依赖），且 `graspologic`（Leiden）是重科学计算包
3. **输出提交 Git 的设计不适合**：`graphify-out/` 设计为提交版本控制，会污染 DeepOrca 的代码库
4. **pre-1.0 + `main` 与 `v8` 分支文档脱节**：API 快速变动，`main` 分支停留在 v0.1.x 而 `v8` 已 v0.9.29

**🟢 借鉴方向——补强现有 codegraph**：

| Graphify 的增量能力 | 补强方式 | 成本 |
|---------------------|----------|------|
| Leiden 社区检测 | 在 codegraph 面板增加"模块聚类"视图，用 JS 实现轻量聚类 | 中 |
| EXTRACTED/INFERRED/AMBIGUOUS 边标签 | 扩展 codegraph 的边数据模型，标注来源置信度 | 低 |
| rationale 注释提取（# NOTE/# WHY） | codegraph 索引时提取特殊注释作为节点属性 | 低 |
| 多模态摄取（PDF/图片） | 通过 MCP 的 pdf/image 技能间接实现，非代码图谱职责 | 不做 |

### E.4 97.4k stars 的启示

Graphify 的超高人气（97.4k stars）证明了一件事：**代码知识图谱是 coding agent 的高价值能力**。DeepOrca 已通过 codegraph 占据了这个位置，方向正确。Graphify 的社区检测和多模态理念值得借鉴，但其 Python 重依赖和功能重叠使其不适合直接集成。

---

## F、Bento — 单文件演示文稿（填补演示文稿生成空白）

> 仓库：https://github.com/nyblnet/bento
> 出品方：The Bento authors · 许可：MIT · Stars：~2.7k · 状态：极新（2026-07-17 创建，2 周龄，2 人维护）
> 热度：Show HN #1（~1k points）

### F.1 作用与核心价值

开源本地优先的办公套件，整个应用——编辑器、查看器、演示器、文档数据——都在**单个自包含 HTML 文件**（~560 KB）中。首发产品是 **Bento Slides**（PowerPoint 替代品）。

**核心理念**："one file, forever"——一个 `.bento.html` 文件就是软件本身。任何现代浏览器都能打开、编辑、演示、发送，接收方无需安装任何东西。无安装程序、无账号、无后端。

**关键特性**：
- **自包含格式**——幻灯片、字体、图片、图表、动画、完整编辑器全部在一个文件里
- **Morph 演示**——共享 `id` 的元素在幻灯片间自动补间动画（位置/大小/颜色/渐变）
- **实时协作**——端到端加密（AES-GCM），密钥在文件内从不上服务器；离线编辑通过自研 CRDT 合并
- **内置图表**——柱/折线/饼/散点，无依赖自研引擎，支持 morph（柱状图变饼图）
- **为 AI 设计**——文档是纯 JSON，Agent 可直接编辑 `.bento.html` 文件
- **签名自更新**——ECDSA 签名，更新保留旧文件回滚
- **标准幻灯片功能**——演讲者视图、评论、布局、PDF 导出、8 种 UI 语言

### F.2 为什么是 DeepOrca 的真正空白填补

| 维度 | 评估 |
|------|------|
| **空白填补** | 🟢 DeepOrca 无任何演示文稿/幻灯片生成能力 |
| **理念契合** | 🟢 单 HTML 文件 = 完全自包含，与 DeepOrca 桌面端理念一致 |
| **AI 原生** | 🟢 文档是纯 JSON，Agent 可直接编辑，已有 Claude Code skill |
| **本地优先** | 🟢 无需后端（协作用可选的 blind relay） |
| **许可** | 🟢 MIT |
| **技术栈** | 🟢 TypeScript + Vite（与 DeepOrca 桌面端 renderer 一致） |

### F.3 集成方案（P3 观望，待稳定后推进）

**Phase 1 — MCP Server / Skill 接入**：
Bento 已提供 Claude Code skill（`/plugin marketplace add nyblnet/bento`）。DeepOrca 可：
- 内置 `bento-skill` SKILL.md，教 Agent 编辑 `.bento.html` 的 JSON 文档块
- 关键规则：JSON 中所有 `<` 必须转义为 `\u003c`；`docId` 永不重新生成
- Agent 通过 bash 工具操作 `.bento.html` 文件（读取 JSON 块 → 修改 → 写回）

**Phase 2 — 桌面端预览集成**：
```typescript
// packages/desktop/src/renderer/components/SlidesPreviewPanel.tsx
function SlidesPreviewPanel({ bentoPath }: { bentoPath: string }) {
  const previewUrl = `file://${bentoPath}`; // .bento.html 本身就是完整应用
  
  return (
    <iframe
      src={previewUrl}
      sandbox="allow-scripts"
      style={{ width: "100%", height: "100%", border: "none" }}
    />
  );
}
```
`.bento.html` 是完整的 HTML 应用，可直接在 iframe 中渲染——**无需 daemon、无需后端**，比 open-design 的集成更简单。

**Phase 3 — 生成工作流**：
```
用户描述 → Agent 生成幻灯片 JSON → 写入 .bento.html 模板
→ 桌面端 iframe 预览 → 用户编辑/演示
→ 可交付：单个 .bento.html 文件（含完整编辑器）
```

### F.4 为什么设为 P3（观望项）

| 风险 | 说明 | 监控指标 |
|------|------|----------|
| **极新项目** | 2026-07-17 创建，仅 2 周龄 | 观察 3-6 个月活跃度 |
| **2 人维护** | 本质是 solo/small-team side project | 观察贡献者增长 |
| **文档模型变动** | pre-1.0，JSON schema 快速演进 | 观察 API 稳定性 |
| **协作边缘情况** | 快照 undo 可能 revert 协作者；属性级 LWW | 关注协作场景成熟度 |
| **桌面端优先** | 手机查看/演示好，编辑非一等公民 | 与 DeepOrca 桌面端匹配，非阻塞 |

### F.5 Bento vs 传统方案的独特价值

| 方案 | 分发形态 | 可编辑性 | AI 友好 | 离线 |
|------|----------|----------|---------|------|
| **Bento** | 单个 `.bento.html`（含编辑器） | ✅ 接收方可编辑 | ✅ 纯 JSON | ✅ |
| PowerPoint | `.pptx`（需 Office） | 需购买软件 | ❌ 二进制 | ✅ |
| Google Slides | 云链接 | 需账号/联网 | ❌ 非文件 | ❌ |
| reveal.js | HTML + 资源目录 | 需技术能力 | 🟡 部分 | ✅ |

**Bento 的独特定位**：唯一一个"单文件即应用、AI 可直接编辑 JSON、接收方零安装"的方案——完美契合 DeepOrca 的"Agent 生成 → 用户使用"工作流。

---



```
Phase 1（立即）                Phase 2（+2周）              Phase 3（+1月）
├── flutter/agent-plugins ──┤                              │
│   构建时内置 Skills        │
├── code-review-graph ──────┤
│   MCP 预配置 + 审查增强    │
├── serena ─────────────────┤
│   MCP 预配置 + Skill       │
│                            ├── TencentDB-Agent-Memory ───┤  ← v2.3 替换 mem0
│                            │   core SDK + 记忆面板        │
│                            ├── openwiki CLI 内置 ─────────┤
│                            ├── opencli 内置插件 ──────────┤
│                            ├── obscura MCP + Skill ───────┤
│                            │                              ├── 知识中心融合
│                            │                              │   (CRG+Wiki+TDAM)
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
│
│  ── P3 观望项（v2.3 新增）──────────────────────────────────
│                            │                              ├── Bento 演示文稿
│                            │                              │   (待项目稳定后集成)
```

## 十、构建时依赖安装清单

以下工具需要在构建/安装时预置：

| 工具 | 安装方式 | 用途 |
|------|----------|------|
| flutter/agent-plugins | `git clone --depth 1`（构建脚本） | 内置 Skills |
| code-review-graph | `pip install code-review-graph` | MCP Server |
| serena | `uv tool install -p 3.13 serena-agent` | MCP Server |
| TencentDB-Agent-Memory | `npm install @tencentdb-agent-memory/memory-tencentdb`（core 依赖） | 记忆层 SDK（v2.3 替换 mem0） |
| openwiki | `npm install -g openwiki` | Wiki 生成 CLI |
| opencli | `npm install -g @jackwener/opencli` | 网站适配器 |
| od (open-design) | `npm install -g @anthropic-ai/od`（或从源安装） | 设计 MCP |
| obscura | 下载二进制文件（无需安装） | 无头浏览器 MCP |
| CLI-Anything | 内置 SKILL.md + HARNESS.md（无需安装） | Skill 文件 |
| bento | `npm install`（slides 目录，仅 P3 推进时） | 演示文稿（v2.3 新增，P3 观望） |

## 十二、核心原则

1. **直接集成，不从零开发** — 所有项目均以 MCP/内置插件/SDK/Skill 形式直接嵌入
2. **flutter/agent-plugins 构建时安装** — 每次构建从源仓库拉取，不依赖远程插件中心
3. **code-review-graph 是分析层不是图谱层**（v2.3 修正）——codegraph（已集成）是导航/检索层，CRG 是分析/审查层，两者互补非竞争；CRG 只暴露分析层独有工具（风险评分、社区检测、hub/bridge 分析等），过滤掉与 codegraph 重叠的导航工具
4. **open-design 优先使用 Web 渲染模块** — 内置启动 Open Design daemon server，通过 iframe 嵌入其 Next.js 预览页面；如果无法嵌入，则降级为完全自己实现 UI 渲染
5. **obscura 专注大规模数据获取** — 与 browser-skill 互补，Obscura 负责抓取，browser-skill 负责操控
6. **暂不考虑远程插件中心** — 所有能力通过构建时内置或本地安装提供

### 引擎能力演进原则（v2.2 新增）

7. **Prewalk 是方法论不是工具** — 模型中途切换是引擎能力演进，基于已有 `model-capabilities.ts` + UpdatePlan 扩展，不引入外部依赖
8. **OpenSpec 增强 Plan Mode 而非替换** — DeepOrca 已有成熟的提案→批准→执行流程，借鉴 OpenSpec 的 spec 持久化/分层/归档理念增强，不引入 OpenSpec CLI
9. **OpenSpace 与 mem0 明确分工** — mem0 记"事实/偏好"，OpenSpace 记"技能/工作流"；优先自建轻量技能评估闭环，深度集成作为可选项
10. **三者均不冲突** — Prewalk/OpenSpace 填补完全空白域，OpenSpec 补齐 Plan Mode 持久化短板，可并行推进

### 候选项目评估原则（v2.3 新增）

11. **TencentDB-Agent-Memory 替换 mem0** — 在记忆模型、白盒可调试性、技术栈匹配、本地优先四个关键维度全面优于 mem0，且许可更宽松（MIT）；mem0 降级为备选，适配层抽象记忆接口确保可回退
12. **Graphify 不直接集成，借鉴补强 codegraph** — 核心功能与 codegraph/openwiki 三重重叠，Python 重依赖是硬伤；借鉴其社区检测（Leiden）和边置信度标签（EXTRACTED/INFERRED/AMBIGUOUS）理念增强现有 codegraph
13. **Bento 设为 P3 观望项** — 真正填补演示文稿空白，单 HTML 文件理念契合桌面端，但项目仅 2 周龄、2 人维护；待 3-6 个月观察稳定后再推进集成
14. **v2.3 三项目的共同判定逻辑** — 替换型（TDAM）看重全面优势 + 技术栈匹配；补强型（Graphify）看重增量能力 + 避免重依赖；观望型（Bento）看重空白填补 + 成熟度风险

---

> 关联文档：
> - [前期集成调研（5 项目）](../research/2026-07-open-source-integration-feasibility.md)
> - [OCR 集成 & Understand-Anything 分析](../research/2026-07-ocr-integration-and-ua-analysis.md)
