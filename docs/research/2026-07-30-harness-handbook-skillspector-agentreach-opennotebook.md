# 四项调研：Harness Handbook / SkillSpector / Agent-Reach / open-notebook

> 日期：2026-07-30 · 状态：调研完成
> 目的：评估 4 个项目对 DeepOrca（Electron 编码 agent harness）的相关性与可借鉴/集成价值。

---

## 一句话定位

| 项目 | 是什么 | 与 DeepOrca 相关度 |
|------|--------|-------------------|
| **Harness Handbook** | 学术研究：自动从 harness 代码合成「行为级地图」（三层：系统流程→细粒度行为→源码位置），解决 harness 演进中的"行为定位"难题 | **中高**（理念启发，非集成）|
| **SkillSpector** | NVIDIA 出的 AI agent skill/MCP **安全扫描器**：68 个漏洞模式、17 类，静态+LLM 两阶段，可作 MCP server 做安装闸门 | **高**（直接可用，集成价值大）|
| **Agent-Reach** | 给 agent "一键装互联网能力"的能力层：选型/安装/体检/路由 14 个平台（推特/Reddit/小红书/YouTube/B站…）| **低-中**（场景不重叠，可借鉴选型思路）|
| **open-notebook** | Google NotebookLM 的开源自托管替代：多源 RAG + 对话 + 多说话人播客生成，Python/Next.js/SurrealDB | **低**（不同产品形态）|

---

## 二、Harness Handbook（学术研究）

**来源**：Ruhan Wang et al.，[arXiv:2607.13285](https://arxiv.org/abs/2607.13285) + [项目站](https://ruhan-wang.github.io/Harness-Handbook/)。

### 是什么
针对**复杂 agent harness 代码库"读不懂、改不动"**的问题，提出一种**行为级表示**（behavior-centric representation），通过**静态程序分析 + LLM 辅助结构化**，自动从 harness 源码合成一张**三层地图**：
- **L1 系统级流程**（session lifecycle、tool routing 等宏观行为）
- **L2 细粒度行为**（拆解成子行为）
- **L3 源码位置**（行为→具体文件/行）

论文引入 **BGPD workflow**（Behavior-Graph-then-Pinpoint-then-Document）把运行时行为映射回源码。

### 解决的核心痛点
**"行为定位"（behavior localization）**——harness 越复杂，agent/开发者越难回答"某个运行时行为对应哪段代码"。这恰是 DeepOrca 这类 harness 的真实痛点：session loop、工具路由、权限、压缩、MCP 生命周期交织，新人（或 agent 自身）理解成本高。

### 对 DeepOrca 的价值
- **理念启发（非集成）**：DeepOrca 的 `AGENTS.md`「Architecture: Key Flows」一节本质上就是**手写的 L1/L2 行为地图**（session lifecycle / tool routing / message conversion / permissions / prompt / MCP / desktop build / skills discovery）。Harness Handbook 给出的是**自动化生成**这条地图的方法。
- **潜在应用**：DeepOrca 有「自进化」域（§十一 skill-writer/skill-digester）和 `deeporca-self-refer` bundled skill——让 agent 自我理解、自我改进。可借鉴 Handbook 的三层结构，把 `deeporca-self-refer` 从"读 AGENTS.md"升级为"读自动生成的行为地图"。
- **现实门槛**：实现需要静态分析 + LLM 结构化，工程量大。**不建议现在引入**，记为「自进化域」的远期理念参考。

### 结论
**记为理念参考，不集成。** 在 feature-roadmap 的「自进化（§十一）」下加一条「行为级地图（借鉴 Harness Handbook）」作为远期愿景即可。

---

## 三、SkillSpector（NVIDIA · 高价值）⭐

**仓库**：[NVIDIA/SkillSpector](https://github.com/NVIDIA/SkillSpector)，Apache-2.0，Python。

### 是什么
AI agent skill / MCP 的**安全扫描器**。研究显示 **26.1% 的 skill 含漏洞、5.2% 疑似恶意**。SkillSpector 回答一个问题：**"这个 skill/MCP 安全吗？"**

### 核心能力
- **68 个漏洞模式 / 17 类**：prompt injection、anti-refusal、data exfiltration、privilege escalation、supply chain（含 OSV.dev 实时 CVE 查询）、excessive agency、AST 危险调用（exec/eval/subprocess）、taint tracking、YARA 签名、**MCP least privilege（LP1-4：代码用的能力超出声明的权限）**、**MCP tool poisoning（TP1-4：元数据里藏指令 / Unicode 欺骗 / 描述-行为不符）**。
- **两阶段**：快速静态分析（regex+AST+YARA，高召回）→ 可选 LLM 语义分析（过滤误报，精度到 ~87%）。
- **多输出**：terminal/JSON/Markdown/**SARIF**（CI/IDE 集成）。
- **风险评分**：0-100，CRITICAL/HIGH/MEDIUM/LOW 加权 + 可执行脚本 1.3x。
- **闸门语义**：exit code + `recommendation`（SAFE/CAUTION/DO_NOT_INSTALL）可直接映射 allow/prompt/block。
- **两种形态**：CLI（`skillspector scan`）+ **MCP server**（`skillspector mcp`，stdio 或 streamable HTTP）—— 一个 `scan_skill(target, use_llm, output_format)` 工具。
- **baseline 抑制**：已知/接受的 finding 进基线，重扫只报新增。
- **trust model 清晰**：从不执行被扫 skill；LLM 分析会发文件内容到 provider（可 `--no-llm` 关）。

### 对 DeepOrca 的价值（**高，直接相关**）
DeepOrca 正在**激进引入外部 skill/MCP**——roadmap v3.6/v3.7 列了「插件中心域（§十二）」要集成 8 个远程 Hub（ClawHub/ModelScope/SkillHub/SwarmSkills…），刚刚还在规划 A2UI over MCP。**这正是 SkillSpector 警告的高风险面**：从不可信远程源装 skill/MCP，且 MCP tool poisoning（TP1-4）是真实攻击向量。

**SkillSpector 能直接填补的安全缺口**：
1. **插件中心安装闸门**：roadmap §十二 Phase 9「远程源集成」规划了安装管线，但**没有安全扫描环节**。SkillSpector 作为安装前的强制扫描闸门（block `DO_NOT_INSTALL`、prompt `CAUTION`），是天然契合。
2. **MCP least-privilege 审计**：DeepOrca 的 dart/serena/expo/codegraph/gitmcp 都是自建/已知 server，但未来远程 MCP server 的 LP1（underdeclared capability）和 TP1（hidden instructions）需要 SkillSpector 这类静态检查。
3. **已有现成 MCP server 形态**：`skillspector mcp` 本身就是一个 MCP server——DeepOrca 可直接当作一个 builtin MCP server 注册（仿 dart/serena 的 shim 模式），让 agent 在安装任何远程 skill 前先调 `scan_skill`。

### 集成方式建议
- **形态**：MCP server（`skillspector mcp` stdio）。**不引入 Python 依赖到 DeepOrca 核心**——它走 `uv tool install`，DeepOrca 用 `uvx skillspector mcp` shim 注册（仿 crg/serena 的 uv 路径）。
- **触发点**：插件中心远程源安装管线（§十二）+ 可选的 agent 自主调用（agent 装新 skill 前自检）。
- **风险**：Python/uv 依赖（但 crg/serena 已引入 uv，复用既有 vendor）；LLM 分析可选（`--no-llm` 走纯静态，零外部依赖）。

### 结论
**强烈建议集成，归入插件中心域（§十二）的安装管线作为安全闸门。** 这是 4 个项目里对 DeepOrca 当前 roadmap 最直接、最对口的——DeepOrca 正要大举引入远程 skill/MCP，SkillSpector 恰好是配套的安全层。优先级 **P1**（与 §十二 远程源集成同期）。技术形态现成（MCP server），集成成本低（uv shim）。

---

## 四、Agent-Reach（场景不重叠）

**仓库**：[Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach)，MIT，Python。Trendshift #1。

### 是什么
给 agent **一键装互联网能力**的**能力层**（capability layer）——不做底层读取，只做**选型/安装/体检/路由**。覆盖 14 个平台（YouTube/B站/推特/Reddit/小红书/LinkedIn/Facebook/Instagram/V2EX/雪球/小宇宙/RSS/网页/Exa 搜索）。

**核心设计**：每个平台 = 一个有序后端列表（首选+备选），换接入方式 = 调列表顺序。`agent-reach doctor` 探测真实可用性。安装走 `pip install agent-reach` + 注册 SKILL.md，agent 读 SKILL.md 后自己调上游 CLI（gh/yt-dlp/twitter-cli/bili-cli…）。

### 对 DeepOrca 的价值（**低-中**）
DeepOrca 的 roadmap §八「浏览器与联网」已有 **WebSearch + browser-skill（bsk）+ web-access-strategy** 三层调度，**定位与 Agent-Reach 高度重叠**——都是"让 agent 联网"。但：
- **形态不同**：DeepOrca 是 Electron 桌面 harness（内置 bsk 真实 Chrome 操控）；Agent-Reach 是 CLI 能力层（靠上游 CLI + cookie/登录态）。
- **受众不同**：Agent-Reach 强中文平台（小红书/B站/V2EX/雪球/小宇宙）和 cookie 登录态路线，是给**通用 agent（Claude Code/OpenClaw/Cursor）**补联网短板的。DeepOrca 的联网是给**编码 agent**用的（WebSearch 搜文档、bsk 看 PR）。
- **可借鉴**：它的**「首选+备选后端路由」选型思路**和 **doctor 体检**模式，对 DeepOrca §八 的 web-access-strategy 有参考价值（多后端降级、可用性探测）。
- **不建议集成**：场景重叠但形态/受众不同，整体引入会与既有 bsk/WebSearch 体系冲突。

### 结论
**不集成。** 借鉴其「多后端路由 + doctor 体检」思路，记入 §八 web-access 理念参考。DeepOrca 的联网需求已被 WebSearch+bsk+web-access-strategy 覆盖。

---

## 五、open-notebook（产品形态不同）

**仓库**：[lfnovo/open-notebook](https://github.com/lfnovo/open-notebook)，MIT，Python+Next.js+SurrealDB。NotebookLM 开源替代。

### 是什么
自托管的**个人知识研究台**：多源（PDF/视频/音频/网页） ingestion → 向量+全文索引 → 对话（RAG）→ **多说话人播客生成**（1-4 speaker，自定义 profile）。18+ AI provider，完整 REST API，Docker 部署。技术上：FastAPI 后端 + Next.js 前端 + SurrealDB + LangChain/LangGraph 图式编排（`open_notebook/graphs/` 下 ask/chat/source/transformation/podcast 等）。

### 对 DeepOrca 的价值（**低**）
DeepOrca 是**编码 agent harness**，open-notebook 是**研究/内容消费台**——产品形态根本不同。
- **唯一弱关联**：DeepOrca roadmap §二「知识中心」有 Open Deep Research 理念 + TencentDB-Agent-Memory 跨会话记忆。open-notebook 的**多源 RAG + 向量检索**是成熟实现，可作 §二 的参考。
- **播客生成**与 DeepOrca 无关（DeepOrca 有 §十四 语音双工，但那是输入侧 whisper，不是输出侧 TTS 播客）。
- **不建议集成或深度借鉴**：技术栈差异大（Python/Next.js vs DeepOrca 的 TS/Electron），且 DeepOrca §二 已有 openwiki + TencentDB 记忆体系。

### 结论
**不集成，不深入借鉴。** 仅作为 §二 知识中心 RAG 的远期参考存在。

---

## 六、总结与建议

| 项目 | 处置 | 理由 | 优先级 |
|------|------|------|--------|
| **SkillSpector** | **集成** —— 归入 §十二 插件中心安装管线作安全闸门（MCP server 形态，uv shim） | DeepOrca 正大举引入远程 skill/MCP，SkillSpector 是对口的安全层，形态现成、成本低 | **P1**（与 §十二 同期）|
| **Harness Handbook** | **理念参考** —— 在 §十一 自进化下记「行为级地图」远期愿景 | 自动化生成 harness 行为地图的方法论，契合 DeepOrca 自进化愿景，但工程量大 | P3（远期）|
| **Agent-Reach** | **不集成** —— 借鉴「多后端路由+doctor 体检」思路入 §八 web-access 理念 | 场景与 DeepOrca §八 重叠但形态/受众不同，会与 bsk/WebSearch 冲突 | — |
| **open-notebook** | **不集成** —— §二 知识中心 RAG 的远期参考 | 产品形态不同（研究台 vs 编码 harness），技术栈差异大 | — |

### 一条行动建议
**SkillSpector 是本次调研唯一值得立即行动的**。建议下一步：写一份「SkillSpector 集成」调研/草案（仿 gitmcp/a2ui 的调研格式），评估具体怎么作为 §十二 安装管线的安全闸门接入（uv shim 注册为 builtin MCP server / 或作为安装管线内的强制 CLI 调用），并把它登记进 feature-roadmap §十二。

---

## 参考来源
- [Harness Handbook 项目站](https://ruhan-wang.github.io/Harness-Handbook/) · [arXiv:2607.13285](https://arxiv.org/abs/2607.13285)
- [NVIDIA/SkillSpector](https://github.com/NVIDIA/SkillSpector)（Apache-2.0）· [研究背景论文](https://arxiv.org/abs/2602.xxxxx) "Agent Skills in the Wild"
- [Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach)（MIT）
- [lfnovo/open-notebook](https://github.com/lfnovo/open-notebook)（MIT）
