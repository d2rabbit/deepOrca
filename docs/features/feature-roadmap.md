# DeepOrca 功能路线图

> 版本：v3.17 · 日期：2026-08-11 · 状态：规划中
>
> **v3.17 更新**：三项外部方案吸收，强化"能力定义→组合→自进化"主轴。① **§十一 自进化层二补强**——引入 **HarnessBank** 论文（[arxiv 2607.13683](https://arxiv.org/abs/2607.13683)）作为 Self-Harness（2606.09498）的互补方法：Harness Gene Bank（带质量元数据+版本谱系的 harness 变体池）+ Gated Harness Screening（门控筛选）+ task/evolver 双 agent（evolver 复用 §十 Subagent 作执行单元）。其结论"gains are model-specific"学术验证 DeepSeek 专项调优策略。② **§十六 能力编排引入 defineAction 范式**——借鉴 **agent-native**（[BuilderIO/agent-native](https://github.com/BuilderIO/agent-native)）"一次定义随处使用"：单个 `defineAction({schema, run})` 自动成为 IPC handler + MCP tool + LLM 工具 + 未来 HTTP/CLI。作为 §十六 双工具编排（OpenWork）的**底层实现机制**，让插件组装与能力组合从"手写多套绑定"收敛为"定义一次自动多表面"；严守 core 无 UI 铁律（schema 落 `shared/`、IPC 落 desktop main、MCP 落 core）。③ **§十二 插件中心新增 Agent Plugins 1.0.0 兼容**——[agentplugins/agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec)（Amazon/Cursor/Microsoft/OpenAI/Vercel 共治，7 客户端已采纳）作为**新增兼容格式**，与现有 marketplace.json（claude-plugins-official）双格式共存、加载器自动识别，不互斥不取代。skills 层天然兼容，MCP 层 Phase 0 三传输 union 已对齐。DeepOrca 目标成为同时兼容两格式的客户端（兼装 claude 生态 + 七客户端共享插件）。
>
> **v3.16 更新**：① **本地向量嵌入模型已落地**——新增 `@deeporca/embedding` workspace 包（transformers.js + onnxruntime-node + IBM Granite Embedding 97M R2，384 维），构建期 vendor 模型（`scripts/vendor-granite.js`，hf-mirror 兜底），接入 memory 包 sqlite-vec 后端（`provider: "local-onnx"`）。记忆召回测试：20 条中文记忆 × 12 查询，**向量召回命中率 100%**（FTS 关键词 0%，语义同义改写场景向量完胜）。② **技能/工具语义路由已落地**——新增 `packages/core/src/routing/`（SkillRouter G1 + ToolRouter G2 + VectorIndex + embedding-loader），G1 在技能数 > 阈值时召回 top-K 短名单（flash LLM 只精排短名单），G2 在 MCP 工具 token 超预算时按服务器级召回裁剪。**③ G3 组合路由（M4）已落地**——忠实复现 SkillWeaver 论文（[arxiv 2606.18051](https://arxiv.org/abs/2606.18051)，Xueping Gao / Alibaba Cloud）的 **Decompose-Retrieve-Compose** 三阶段管线：SAD 迭代技能感知分解（Algorithm 1 + Jaccard 收敛）→ bi-encoder 召回 → Compose 兼容性规划（Eq.4 `α·sim+(1-α)·compat`，I/O 类型 coercion + category Jaccard + keyword 共现 + DAG 依赖检测）。28 单测全过，全程 fail-open，配置 `settings.routing`。详见 `specs/skill-routing/design.md` + CHANGELOG 致谢区。④ **采纳 oh-my-mermaid（omm）探索方法，实现 `arch-scan` skill 并归入工作区索引模块**——采用 omm 的 12 视角目录（perspective catalog）+ 递归下钻（recursive drill-down）+ 7 字段元数据方法论，**渲染用 A2UI**（非 Mermaid + CLI）。新增 `packages/core/templates/plugins/code/skills/arch-scan/`，与 CodeGraph（符号级）、OpenWiki（文档级）构成**工作区索引三件套**（符号/文档/架构），首次索引时同步构建。输出 A2UI Surface（可嵌套组件树），由 DesignPreview 渲染。60/60 结构校验通过。不引入 omm CLI/Mermaid/`.omm/` 文件树。调研详见 `docs/research/2026-08-06-oh-my-mermaid-research.md`。⑤ **路线图补齐 skill-up + book-to-skill（§十一 自进化）**——前者是 alibaba 的技能评估 CLI（已有 `specs/skill-eval/design.md`，先 CI 后产品内），后者是 virgiliojr94 的书籍/文档→SKILL.md 生成器（17.2k star，作为知识插件的一个技能集成）。两者补齐「技能从哪来（book-to-skill）→ 技能好不好（skill-up）」两端。
>
> **v3.15 更新**：① **taste-skill**（§六 P1）已完成——纯方法论 SKILL.md，10 条 P0 设计纪律 + 排版阶梯 + 颜色/动效/布局规范。② **DeepDesign `.dd` 专属格式**（§六 P1）已完成——OrcaDesign Document（YAML front-matter + HTML body + section markers），取代直接写 HTML。编译器注入 tokens + seed CSS + 本地内置 Tailwind JIT（~400KB，离线可用）。新增 `render_design` / `update_design` MCP 工具 + DesignPreview 预览组件（iframe srcDoc）+ `/deep-design` 命令。③ **A2UI merge delta**（§六 P0）已完成——`update_surface` 改为 delta-only 补丁（借鉴 OpenUI merge.ts），processor 端 merge + GC。④ **OpenUI Lang PM-Designer**（§六 P1）已完成——`@openuidev/lang-core` + `react-lang` 集成，11 个自研组件库，`/pm-design-openui` 触发。⑤ 调研 thesysdev/openui + different-ai/openwork + Accio-Lab/Dressage + onecli/onecli + nossa-y/activity-frames。⑥ 新增 §二「行为记忆」（activity-frames TS 重写，P2）+ §十六「能力编排协议」（OpenWork 理念，P3）+ §十七「密钥保险库」（OneCLI 理念 SQLite 重构，P2）。
>
> **v3.14 更新**：① **A2UI 审计第二弹**——修复 12 个 bug（surface 跨污染 C1+C2 / 内存泄漏 M1 / 独立窗口按钮失效 M4 / 死代码 fallback M5 / 全量快照 O(n²) M2 / MCP onclose 误报 1-A / 子进程 fragile cast 3-A+7-A / Gateway 网络错误静默 4-A+B / HarmonyOS cwd 缺失 5-A），并修复预存的 PrototypeWindow `import electron` 破坏 browser bundle 问题。② **调研 thesysdev/openui + different-ai/openwork**——OpenUI Lang 定位为 PM-Designer 专用渲染层（Zod v4 已就绪，无阻塞）；OpenWork 双工具 MCP 模型（`search_capabilities`+`execute_capability`）作为能力编排层参考，优先级低于 SSH（§十三）。③ 新增 §十六「能力编排协议」（OpenWork 理念，P3）。
>
> **v3.12 更新**：A2UI 严格代码审计完成，修复 6 个关键 bug（协议不匹配 B1-B3 / 资源传输 B4 / 独立窗口 B6 / 状态泄漏 B9-B10 / 导航重复 I2）。弃用 `@a2ui/web_core`，自建轻量 processor 直接消费自定义消息格式——渲染层已为此格式编写。EmbeddedResource 现在通过 `metadata.a2ui` 正确传递到渲染器。独立窗口通过 `?view=prototype` query param 检测并渲染 PrototypeWindow。
>
> **v3.0 重大重组**：从"按项目编号"改为"按功能域分组"。所有调研过的项目按其贡献的能力域归类，
> 每个功能域包含已集成、规划中、搁置三层。OpenSpec 和 Superpowers 暂时搁置（见 §搁置项）。
>
> **v3.1 更新**：Bento 从"设计生成"拆出，独立为"办公套件"功能域（§四）。集成 Serena（符号级代码操作）和 Dart MCP。
>
> **v3.2 更新**：新增"移动开发"功能域（§三），Flutter Development（已集成）+ Android Development Kit（规划中）+ HarmonyOS Development Kit（规划中）。
>
> 历史版本：v2.1-v2.4 按项目逐个调研，v3.0+ 按功能重新规划。
>
> **v3.3 更新**：移动开发域新增 React Native（Expo 官方 Skills + Callstack）；新增桌面开发域（Electron/Tauri）；新增 .NET 开发域（Microsoft 官方 dotnet/skills）。只采纳第一方或官方社区认可的工具套件。
>
> **v3.4 更新**：桌面开发域新增 Apple（Xcode 27 第一方 7 Skills）和 Qt/KDE（Qt Group 第一方 7 Skills + MCP）。GNOME/GTK 无官方方案暂不纳入。Electron 自建搁置（调试工具链工程量过大）。
>
> **v3.5 更新**：新增"远程接入"（§十三）—— 本地 DeepOrca 通过反向隧道/蒲公英/ngrok 等暴露为 Web 端，移动端浏览器/App 直接访问；SessionBridge 与 IPC 已经完全 engine-agnostic，可零改造复用。新增"语音双工"（§十四）—— 语音代替输入法作为输入手段，主推 whisper.cpp + whisper-streaming LocalAgreement 方案。功能域位置无先后顺序，仅按添加顺序排号。
>
> **v3.5 更新**：新增"远程接入"功能域（WebSocket 桥 + 静态服务 + 隧道方案，架构可行性已验证）和"语音双工"功能域（whisper.cpp 本地优先 + API 兜底）。
>
> **v3.7 更新**：调研 A2UI（Agent-to-UI 协议）并产出集成设计草案。关键判断：A2UI 在 DeepOrca 承载**两类能力**，且都与 DeepDesign 三者并存、互不替代——① §六 新增独立产品线「AI-native 原型模块」（PM 向，自然语言驱动，Surface 载体，**原生依赖 DeepOrca**，类 v0/bolt）；② §十 新增「A2UI 对话交互层」（把对话区从纯文本升级为可交互富组件：富工具结果/结构化输入/任务看板）。复用官方 `@a2ui/react`（Apache-2.0，React 18/19 兼容）+ 既有 MCP 体系（A2UI over MCP，`a2ui_action` 即工具调用）。设计草案见 `specs/a2ui-integration/design.md`，调研报告见 `docs/research/2026-07-a2ui-integration.md`。
>
> **v3.11 更新**：总览表全面对齐各域具体规划（以细节为准）。① html-in-canvas 实测：Electron 43/Chromium 150 **已支持全套 API**（`drawElementImage`/`layoutSubtree`/`requestPaint`），默认关，`--enable-features=CanvasDrawElement` 可开——"阻塞于平台"前提已满足，修正为"flag 可开"。② 补齐总览漏项：§七 办公文档预览面板、§九 ShowUI + sim-use、§十一 JiuwenSwarm 蜂群协作、§十二 已集成的 Flutter/Android/HarmonyOS/RN/Browser 分组。③ Electron 35→43（Chromium 150）。④ §六 html-in-canvas 状态从"阻塞"改为"flag 可开"。实测见 `docs/research/2026-07-30-html-in-canvas.md`。

> **v3.10 更新**：修正 §六「Canvas UI」条目——核实其即 **html-in-canvas**（[html-in-canvas.dev](https://html-in-canvas.dev)），是 **WICG 浏览器原生 API 提案**（`drawElementImage()`/`layoutsubtree`），**非库不可 vendor**（原"构建时 vendor 组件源码"描述有误）。特效能力吻合 demos（液体玻璃/像素瓦解/CRT shader/3D 贴纹理），但**当前纯实验态**（仅 Chrome Canary / Brave 147+ 需手动开 flag，Firefox/Safari 无实现，无 polyfill，无正式发布时间表）。优先级 P1→P3，**阻塞于 Chromium/Electron 平台支持**，定位为 DeepDesign/A2UI 的远期视觉特效升级路径。Phase 3 移除"特效 vendor"。调研 `docs/research/2026-07-30-html-in-canvas.md`。

> **v3.9 更新**：① **MCP SDK 迁移已完成**（§十 已集成）——手写 JSON-RPC 换官方 `@modelcontextprotocol/sdk@1.22.0`，客户端 + gitmcp 服务端全切换，对外接口零变化，`npm run check` 全绿 + 端到端握手验证通过（perf/native-optimizations 分支 9 commits）。这同时**解锁了 §十二 远程源集成的 HTTP/SSE 传输阻断点**。② 新增 4 项调研结论：**SkillSpector**（NVIDIA 安全扫描器，归入 §十二 作安装闸门 P1，填补远程 skill/MCP 引入的安全缺口）、**Harness Handbook**（§十一 自进化远期愿景——行为级地图）、**Agent-Reach**（§八 不采纳，借鉴多后端路由思路）、open-notebook（不同产品形态，不采纳）。③ 修复总览表 §十三/§十四 重复行。调研见 `docs/research/2026-07-30-harness-handbook-skillspector-agentreach-opennotebook.md`。

> **v3.8 更新**：调研官方 `@modelcontextprotocol/sdk` 迁移。发现 DeepOrca 的 MCP **全是手写**（客户端 987 行 + gitmcp 服务端 230 行），落后协议两个版本，致命缺口是 **server→client 请求全死**（sampling/roots/elicitation，因客户端 `capabilities:{}` + 路由器丢弃带 id 的 server 请求）。迁移可行性已验证（zod v4 已用、Node 22 原生 crypto 免 polyfill）。**决策（用户拍板）：最高优先级前置**——A2UI 深度依赖 MCP，先打 SDK 地基可省一次返工 + 一次兼容性回归。A2UI 场景分级：P0 原型模块（核心卖点）→ P1 用户决策/持续状态监控/工作流（核心模块）→ P2 代码审查/git/wiki 富展示（待基础能力测完）。调研报告见 `docs/research/2026-07-mcp-sdk-migration.md`。

---

## 功能域总览

| 功能域                                            | 已集成                                                                                                            | 规划中                                                                                                                                                                           | 核心目标                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [一、代码智能](#一代码智能)                       | codegraph, CRG, ocr, **serena**, **arch-scan（架构索引）**                                                        | —                                                                                                                                                                                | 让 Agent 从"文本级"升级为"语义级"代码操作 + 架构级可视化 |
| [二、知识中心](#二知识中心)                       | openwiki, TencentDB-Agent-Memory, **activity-frames**                                                             | Open Deep Research 理念                                                                                                                                                          | 项目文档 + 跨会话记忆 + 行为记忆 + 深度研究              |
| [三、移动开发](#三移动开发)                       | —                                                                                                                 | **Flutter Development（dart+flutter skills + Dart MCP）**, **Android Kit（skills + CLI）**, **HarmonyOS Kit（skills + DevEco MCP）**, **React Native（Expo skills + Expo MCP）** | Flutter + Android + HarmonyOS + React Native             |
| [四、桌面开发](#四桌面开发)                       | —                                                                                                                 | Apple（Xcode 27 第一方）, Qt/KDE（Qt Group 第一方）, Tauri（社区 MCP）, .NET（dotnet/skills）, deepin/UOS                                                                        | macOS/iOS + Qt/KDE + Tauri + .NET + deepin 桌面应用开发  |
| [五、.NET 开发](#五net-开发)                      | —                                                                                                                 | dotnet/skills（Microsoft 官方 12 域）                                                                                                                                            | C# / ASP.NET / MAUI / 测试 / 诊断 / MSBuild              |
| [六、设计生成](#六设计生成)                       | DeepDesign Phase 1 + **`.dd` 格式**, **taste-skill**, **A2UI PM-Design P0-P4 + merge delta**, **OpenUI Lang PoC** | **html-in-canvas（API 提案，flag 可开）**, dashboard/mobile/poster 模板, Uiverse 组件库                                                                                          | brief→生成→预览→交付 的全流程设计能力                    |
| [七、办公套件](#七办公套件)                       | Bento Slides                                                                                                      | 文档/表格生成, 办公文档预览面板                                                                                                                                                  | 单文件办公文档（演示文稿/文档/表格）生成与预览           |
| [八、浏览器与联网](#八浏览器与联网)               | browser-skill, WebSearch, web-access 理念                                                                         | obscura                                                                                                                                                                          | 登录态操控 + 大规模抓取 + 深度联网策略                   |
| [九、桌面自动化](#九桌面自动化)                   | —                                                                                                                 | pi-computer-use, ShowUI（VLM 视觉定位）, CLI-Anything, **sim-use（iOS+Android 模拟器，P1）**                                                                                     | 操控无 API 的桌面软件 + 模拟器交互                       |
| [十、引擎演进](#十引擎演进)                       | Plan Mode, UpdatePlan, **Electron 43（Chromium 150）**, **MCP SDK 迁移（官方 @modelcontextprotocol/sdk）**        | **长程任务可靠执行（LongHorizon-Harness 原生 MEA）**, A2UI 对话交互层, Prewalk, Subagent                                                                                         | 长程任务可靠执行 + 模型切换 + 子 agent + 交互层升级      |
| [十一、自进化](#十一自进化)                       | skill-writer, skill-digester（静态）                                                                              | **book-to-skill（文档→技能）**, **skill-up（技能评估 CI）**, Self-Harness 理念, **HarnessBank gene-bank 理念（补强层二）**, OpenSpace 理念, **Harness Handbook 行为地图理念**, **JiuwenSwarm 蜂群协作理念**                  | harness 脚手架自改进 + 技能生命周期（生成→评估→改进）    |
| [十二、插件中心](#十二插件中心)                   | **7 插件包分组（skill.plugin.md）**, Browser 分组, **SkillSpector 安全扫描（meta-skills）**                       | opencli, 远程源集成（8 Hub）, **Agent Plugins 1.0.0 兼容（双格式）**                                                                                                                                                     | 统一的插件/技能/MCP 管理入口 + 安装安全                  |
| [十三、远程接入](#十三远程接入)                   | —                                                                                                                 | WebSocket 桥 + 静态服务 + 隧道方案                                                                                                                                               | 手机/远程浏览器通过蒲公英/ngrok 接入 DeepOrca            |
| [十四、语音双工](#十四语音双工)                   | —                                                                                                                 | whisper.cpp 本地 + API 兜底                                                                                                                                                      | 语音替代键盘输入，实时转录填入 Composer                  |
| [十五、统一模型网关](#十五统一模型网关最低优先级) | —                                                                                                                 | OmniRoute（文档引导）                                                                                                                                                            | 多提供商路由 + token 压缩                                |
| [十六、能力编排协议](#十六能力编排协议)           | —                                                                                                                 | **defineAction 一次定义多表面（agent-native）**, OpenWork 双工具 MCP 理念, 技能/工作流可迁移                                                                                                                                     | 统一能力发现和执行入口（一站化编排层）                   |
| [十七、密钥保险库](#十七密钥保险库)               | —                                                                                                                 | OneCLI 理念 SQLite 重构（AES-256-GCM + 注入引擎）                                                                                                                                | Agent 持占位符 key，真实凭证加密存储+按需注入            |
| [搁置项](#搁置项)                                 | —                                                                                                                 | OpenSpec, Superpowers, OmniGent, Electron 自建                                                                                                                                   | 暂不规划，理由见下                                       |

---

## 一、代码智能

> 让 Agent 理解代码的"在哪里、谁调用谁、多危险、怎么改"——从文本搜索升级为语义级图谱 + 风险分析 + 符号操作。

### 已集成

| 能力                           | 项目                        | 集成形态                      | 定位                                                                |
| ------------------------------ | --------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| 符号检索 + 调用链 + 影响范围   | **codegraph** v1.5.0        | vendored CLI + MCP            | 导航层——"代码 GPS"，35 语言，一次调用返回源码+调用链                |
| 风险评分 + 社区检测 + 架构概览 | **CRG** (code-review-graph) | vendored uv + MCP（dev 分支） | 分析层——"这个改动有多危险"，Leiden 社区 + 风险指数 + Mermaid 架构图 |
| AI 代码审查                    | **ocr** (Open Code Review)  | npm 依赖内置                  | 审查层——审查未提交的工作区改动                                      |

**三层协同**：codegraph（在哪）→ CRG（多危险）→ ocr（怎么改）。桌面端代码审查面板 3 Tab：Quality（OCR）/ Risk（CRG）/ Architecture（Mermaid）。

### 规划中

| 能力                                              | 项目       | 集成形态                             | 贡献                                                  | 优先级 |
| ------------------------------------------------- | ---------- | ------------------------------------ | ----------------------------------------------------- | ------ |
| 符号级重构（rename/find-references/replace-body） | **serena** | MCP Server（Python 3.13 + uv + LSP） | 从"文本替换"升级为"语义操作"，40+ 语言，跨文件 rename | P1     |

**与已有能力关系**：serena 互补——codegraph 做"检索"，serena 做"语义编辑"。read/edit 工具做文本级，serena 做符号级。

### 不采纳

| 项目                | 理由                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| Understand-Anything | 与 codegraph+CRG+openwiki 三方高度冗余                                   |
| Graphify            | 功能最强但 Python 重依赖；codegraph 已覆盖核心图谱，借鉴社区检测理念即可 |

---

## 二、知识中心

> 项目文档 + 跨会话记忆 + 行为记忆 + 深度研究——让 Agent 越用越懂项目，不遗忘已学的事实，知道用户做了什么。
>
> 索引与知识模块不仅服务于 AI agent 的代码理解，也是**人类用户快速了解项目**的入口。在 vibe coding 时代，非开发者（产品经理、设计师、新成员）可以通过 wiki 首页 + 架构图快速理解项目结构，而无需读源码。

### 已集成

| 能力                     | 项目                       | 集成形态                        | 定位                                       |
| ------------------------ | -------------------------- | ------------------------------- | ------------------------------------------ |
| 项目 Wiki 自动生成与维护 | **openwiki**               | vendored CLI + Skill + 桌面面板 | 为代码库生成 Agent 可引用的结构化文档；同时是人类可导航的知识库入口 |
| 跨会话长期记忆           | **TencentDB-Agent-Memory** | core SDK（perf 分支）           | 四层记忆 + 符号化检索，替换了原规划的 mem0 |
| Wiki 问答 skill          | **wiki-qa**（内置 skill）  | SKILL.md + openwiki chat 模式  | 通过 OpenWiki 的 DeepAgents RAG 回答架构/模块/工作流问题 |
| Wiki post-turn 自动更新  | session.ts maybeSyncWikiIndex | fire-and-forget post-turn hook | 代码变更后自动增量更新 wiki（同 CodeGraph sync 模式） |
| OKF frontmatter 解析     | wiki.read-page / list-pages | gray-matter 解析               | wiki 页面返回结构化元数据(type/title/tags)，agent 可快速定位 |

### 规划中

| 能力         | 项目                                                     | 集成形态                                                                                    | 贡献                                                                                                                                                                                                                              | 优先级 |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **行为记忆** | **activity-frames** 理念（nossa-y/activity-frames，MIT） | **TypeScript 重写**（~2000 行），InMemoryTransport MCP server，vendor nocta-recorder 二进制 | 本地屏幕活动捕获 → 结构化 ActivityFrame（app/site/time/pages/input）→ 6 个 MCP 工具。**TS 重写**（非 Python 子进程），零外部运行时依赖。补齐「对话记忆(TDAM) + 行为记忆(frames)」双层记忆。详见 `specs/activity-frames/design.md` | **P2** |
| **OpenWiki connector 消费 CodeGraph MCP** | OpenWiki connectors 系统 | WikiCliController.init 前写入 connector config | wiki 生成时消费 CodeGraph MCP 作为知识源，获得真实调用图上下文，生成的架构文档基于代码结构而非猜测。配置 `~/.openwiki/connectors/custom-mcp/config.json` 指向当前项目的 CodeGraph MCP | **P2** |
| **OpenWiki 定时自动更新** | OpenWiki scheduling + 引擎侧定时任务框架 | cron 调度 + Electron 定时器 | 定时（如每天/每次 git pull 后）自动 `openwiki --update`，不依赖代码变更事件。vendored CLI 已有 scheduling 基础设施（`onboarding.d.ts OnboardingSourceScheduleConfig`），需 DeepOrca 引擎侧加定时任务框架 | **P3** |
| 多轮深度研究 | **Open Deep Research** 理念                              | 借鉴工作流，Node.js 自建轻量版                                                              | 从"单次 WebSearch"升级为"搜索→反思→再搜索→报告"的多轮循环                                                                                                                                                                         | P3     |

---

## 三、移动开发

> Flutter + Android + HarmonyOS + React Native 开发能力包——官方/第一方技能包 + 运行时交互。

### 已集成

| 能力                           | 项目                                         | 集成形态                                                 | 定位                                                                                                    |
| ------------------------------ | -------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Flutter/Dart 开发技能（24 个） | **flutter/agent-plugins**                    | 构建 Skills（`scripts/install-flutter-skills.js`）       | 架构/测试/路由/本地化/HTTP/FFI 等                                                                       |
| Flutter 运行时交互             | **Dart MCP server**                          | 内置 MCP（`dart mcp-server`，pubspec.yaml 项目自动激活） | 运行时布局分析/widget 树检查/pub.dev 搜索/测试执行/dart format                                          |
| Android 开发技能（14 个）      | **android/skills**                           | 构建 Skills（`scripts/install-android-skills.js`）       | Jetpack Compose/Navigation 3/CameraX 迁移/R8 分析/edge-to-edge/测试/Perfetto 性能分析 等                |
| Android CLI 集成               | **Android CLI**                              | Skill 教 Agent 用 bash 调用 `android` 命令               | 项目创建/模拟器管理/截图标注/UI 布局树/文档搜索（Google 官方 CLI-first 方案）                           |
| HarmonyOS 开发技能             | **DevEco CLI** Skills                        | 构建 Skills（`scripts/install-harmonyos-skills.js`）     | ArkTS/ArkUI 最佳实践、状态管理、导航、数据持久化、测试、性能优化                                        |
| HarmonyOS CLI 集成             | **DevEco CLI**（`devecocli`）                | Skill 教 Agent 用 bash 调用 `devecocli` 命令             | 项目创建/构建(hvigor)/运行/模拟器/截图/布局检查/文档检索（华为官方，HDC 2026 发布）                     |
| React Native 开发技能          | **Expo Skills** + **Callstack Agent Skills** | 构建 Skills（`scripts/install-rn-skills.js`）            | Expo 官方 Skills（SDK 升级/EAS 部署/调试最佳实践）+ Callstack 社区权威 Skills（性能优化/升级/原生模块） |
| React Native 运行时交互        | **Expo MCP Server**                          | 内置 MCP（`docs.expo.dev/mcp`）                          | SDK 知识注入 + 移动模拟器交互 + React Native DevTools                                                   |

### 规划中

| 能力 | 项目 | 集成形态 | 贡献 | 优先级 |
| ---- | ---- | -------- | ---- | ------ |

**四平台范式差异**：

| 维度       | Flutter                        | Android                 | HarmonyOS          | React Native          |
| ---------- | ------------------------------ | ----------------------- | ------------------ | --------------------- |
| 技能来源   | flutter/agent-plugins（24 个） | android/skills（14 个） | deveco-cli 内置    | Expo 官方 + Callstack |
| 运行时交互 | MCP（`dart mcp-server`）       | CLI（`android`）        | CLI（`devecocli`） | MCP（Expo MCP）       |
| 官方认可   | ✅ Flutter 团队                | ✅ Google               | ✅ 华为            | ✅ Expo + Callstack   |
| 包管理     | pub.dev                        | Gradle                  | ohpm               | npm                   |

**Flutter vs Android vs HarmonyOS 的范式差异**：

| 维度     | Flutter        | Android              | HarmonyOS             | React Native              |
| -------- | -------------- | -------------------- | --------------------- | ------------------------- |
| 构建系统 | dart compile   | Gradle               | hvigor                | Metro                     |
| 设备调试 | flutter driver | adb                  | hdc                   | Expo/agent-device         |
| 触发文件 | `pubspec.yaml` | `build.gradle(.kts)` | `build-profile.json5` | `app.json`/`package.json` |

详见各平台设计文档：[Android](../../specs/android-dev-kit/design.md) · [HarmonyOS](../../specs/harmonyos-dev-kit/design.md)。

---

## 四、桌面开发

> Electron + Tauri 桌面应用开发能力包。

### 规划中

| 能力                          | 项目                                                | 来源认可度                    | 集成形态                                          | 贡献                                                                                                                                   | 优先级 |
| ----------------------------- | --------------------------------------------------- | ----------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Apple 平台开发（macOS + iOS） | **Xcode 27 Agent Skills**（Apple 第一方）           | ✅ **Apple 第一方**           | 构建 Skills（`xcrun agent skills export` 导出）   | SwiftUI 现代 API/UIKit 现代化/测试现代化/安全审计/C 边界安全 7 个官方 Skills                                                           | P1     |
| Apple 社区精选                | **twostraws/swift-agent-skills**（Paul Hudson）     | ✅ 社区权威                   | 构建 Skills                                       | SwiftUI Pro/Swift 并发/SwiftData/Swift Testing 4 个精选 Skills                                                                         | P2     |
| Qt/KDE 应用开发               | **TheQtCompanyRnD/agent-skills**（Qt Group 第一方） | ✅ **Qt Group 第一方**        | 构建 Skills + MCP                                 | 7 个 Skills：qt-cpp-review/qt-cpp-docs/qt-qml/qt-qml-review/qt-qml-profiler/qt-qml-docs/qt-ui-design + Qt 文档 MCP                     | P2     |
| Tauri 应用开发                | **mcp-server-tauri**                                | 🟡 社区（Tauri 官方未出同类） | MCP + Skills                                      | Rust 后端/IPC/Web 前端集成/capabilities 安全模型                                                                                       | P3     |
| deepin/UOS 桌面开发           | **linuxdeepin/deepin-skills**（统信第一方）         | ✅ **统信第一方**             | 构建 Skills（`scripts/install-deepin-skills.js`） | 4 个 Skills：DTK 原生应用开发（UI/主题/CMake/平台适配）、DDE Shell 扩展（Dock/顶栏/侧栏）、控制中心模块/插件、任务栏托盘插件。LGPL-3.0 | P2     |

**Apple 现状说明**：WWDC 2026 发布，Xcode 27 内置 7 个第一方 Agent Skills，可通过 `xcrun agent skills export --output-dir <path>` 导出为标准 SKILL.md。另有 Paul Hudson（hackingwithswift.com 创始人，Swift 社区权威）维护的社区精选目录 `twostraws/swift-agent-skills`。

**Qt/KDE 现状说明**：Qt Group（Qt 商业所有者）官方维护 `TheQtCompanyRnD/agent-skills`，7 个 Skills 覆盖 C++ 代码审查/QML 编码/QML 审查/性能分析/文档/UI 设计。另含 Qt 文档 MCP server。这是 KDE/Qt 桌面开发的官方第一方方案。

**GNOME/GTK 现状说明**：❌ **无官方方案**。GNOME 基金会和 GTK 团队未发布 Agent Skills。暂不纳入，待官方方案出现。

**Electron 现状说明**：见 [搁置项](#搁置项)——自建 Electron 调试工具链（MCP/CLI 操控窗口/IPC/DevTools）工程量过大，暂时搁置。

---

## 五、.NET 开发

> Microsoft 官方 .NET AI 开发技能包——C# / ASP.NET / MAUI / 测试 / 诊断 / MSBuild。

### 规划中

| 能力              | 项目                                | 来源认可度              | 集成形态                   | 贡献                     | 优先级 |
| ----------------- | ----------------------------------- | ----------------------- | -------------------------- | ------------------------ | ------ |
| .NET 全栈开发技能 | **dotnet/skills**（Microsoft 官方） | ✅ **Microsoft 第一方** | 构建 Skills（12 个插件域） | 覆盖 .NET 开发全生命周期 | P2     |

**dotnet/skills 12 个插件域**（`github.com/dotnet/skills`）：

| 域                       | 覆盖内容                                                          |
| ------------------------ | ----------------------------------------------------------------- |
| `dotnet`                 | C# 核心、语言特性、LSP                                            |
| `dotnet-aspnet`          | ASP.NET Core（最小 API、OpenTelemetry、文件上传）                 |
| `dotnet-maui`            | .NET MAUI 跨平台 UI（生命周期/数据绑定/导航/主题/CollectionView） |
| `dotnet-test`            | 测试（执行/迁移/质量审计/覆盖率/框架迁移 MSTest→v3/v4/xUnit v3）  |
| `dotnet-diag`            | 诊断（性能分析/dump 收集/dotnet-trace/崩溃符号化）                |
| `dotnet-msbuild`         | MSBuild（binlog 分析/增量构建/并行/反模式/现代化）                |
| `dotnet-nuget`           | NuGet（中央包管理迁移）                                           |
| `dotnet-upgrade`         | 升级迁移（.NET 8→9→10→11/AOT 兼容/可空引用/线程中止）             |
| `dotnet-ai`              | AI/ML（MCP C# 创建/调试/发布/测试）                               |
| `dotnet-data`            | 数据（EF Core 查询优化）                                          |
| `dotnet-template-engine` | 模板引擎（发现/实例化/验证/编写）                                 |
| `dotnet11`               | .NET 11 新特性（System.Text.Json 等）                             |

**集成方式**：构建时从 `dotnet/skills` 仓库拉取 12 个插件域的 SKILL.md 到 `bundled/`。Agent 检测到 .NET 项目（`.csproj`/`.sln`）时自动加载对应 Skills。

---

## 六、设计生成

> brief → 生成 → 预览 → 交付 的全流程设计能力。Agent 是画师，Electron webview 是画布，html-in-canvas（浏览器原生 API 提案）是远期的视觉特效升级路径。
>
> **架构图构建（2026-08-06 决策）**：**采纳** [oh-my-mermaid](https://github.com/oh-my-mermaid/oh-my-mermaid)（omm）的**探索方法论**（12 视角目录 + 递归下钻 + 7 字段元数据），**渲染用 A2UI**（非 omm 的 Mermaid + CLI）。已实现 `arch-scan` skill（`packages/core/templates/plugins/code/skills/arch-scan/`）：采用 omm 的 perspective catalog + recursive drill-down，输出 A2UI Surface（可嵌套组件树），由 DesignPreview 渲染。不引入 omm CLI/Mermaid/`.omm/` 文件树。调研详见 `docs/research/2026-08-06-oh-my-mermaid-research.md`。

### 已集成

| 能力                        | 项目                   | 集成形态                       | 定位                                                      |
| --------------------------- | ---------------------- | ------------------------------ | --------------------------------------------------------- |
| 通用设计生成（原型/落地页） | **DeepDesign** Phase 1 | Skill + seed 模板 + 3 设计系统 | 复刻 Claude Design 核心，零 daemon，Electron webview 预览 |

**DeepDesign 已有文件**：

- `deep-design` SKILL.md（工作流编排）
- `seed.html` + `layouts.md`（8 个 section 骨架 + P0/P1/P2 自检清单）
- 3 个 DESIGN.md 系统（dark-tech / modern-minimal / editorial）
- **UI 风格目录**（`design/references/ui-styles.md`）——14 个 UI 设计风格的完整 Agent 提示词，来自 [NameThatUI/styles](https://namethatui.com/styles)。每个风格包含：定义信号、CSS 关键值（精确的 box-shadow / backdrop-filter / gradient 值）、Tailwind 实现思路、无障碍约束（4.5:1 对比度、focus 可见性、reduced-motion）。Agent 根据用户口语描述匹配风格（"磨砂玻璃"→Glassmorphism、"黑边亮色"→Neobrutalism），复制提示词后配合 Tailwind CDN 产出 HTML。14 个风格：Skeuomorphism / Neumorphism / Glassmorphism / Liquid Glass / Web Brutalism / Neobrutalism / Y2K Digital / Frutiger Aero / Flat Design / Minimalism / Claymorphism / Vernacular Web / Aqua / Windows Aero。

> **与 A2UI 原型模块的边界**：DeepDesign 是「设计」（设计师向，HTML 成品，可脱离宿主）。A2UI 原型模块是「原型」（PM 向，自然语言驱动，Surface 载体，**原生依赖 DeepOrca 运行时**，类 v0/bolt）——**原型 ≠ 设计**，两者是独立产品线，受众/输入/格式/目标都不同。详见 `docs/research/2026-07-a2ui-integration.md` §四。

### 规划中

| 能力                                     | 项目                                                                             | 集成形态                                                                                                         | 贡献                                                                                                                                                                                                                                                                                                                                                                                 | 优先级               |
| ---------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| **需求具现化工作台（PM-Design V2）**     | **A2UI + OpenUI + DeepDesign 三管线统一编排**                                    | 左侧 Design 工作区 + `design.materialize` 复合 Action + `pm-analyst` Skill + 设计产物持久化                      | **P0（设计阶段）**：将三管线从"用户三选一"升级为"AI 自动路由"。模拟 PM 完整职责链：需求采集 → 需求分析（pm-analyst 子代理拆解为模块/用户故事/流程）→ 管线路由（交互型→A2UI / 展示型→.dd / 混合型→OpenUI）→ 原型生成 → 预览验证 → 持久化为可管理的设计资产。左侧增加 `design` rail item（位于 Code Review 下方），DesignPanel 提供一键入口 + 产物列表 + 对话迭代闭环。详见 [`specs/pm-design-v2/design.md`](../../specs/pm-design-v2/design.md) | P0（设计完成）       |
| **AI-native 原型模块**                   | **A2UI** 协议（a2ui-project/a2ui）                                               | 内置 Skill（`a2ui-prototype`）+ 自研 MessageProcessor + 自研渲染器 + A2UI over MCP（InMemoryTransport）          | ✅ **已集成**：PM 用自然语言驱动声明式 Surface 原型。7 个模板 + render_prototype 工具 + 全屏预览面板 + 多页面导航 + 持久化恢复。v3.14 审计第二弹修复 12 bug（surface 作用域隔离 / 内存泄漏 / 独立窗口交互 / 全量快照→快照）。`9699fbe`→`0699927`                                                                                                                                     |
| **A2UI 增量补丁（merge）**               | OpenUI merge.ts 理念（thesysdev/openui）                                         | `a2ui-mcp.ts` update_surface delta-only + processor 端 merge                                                     | **P0（开发中）**：借鉴 OpenUI `mergeStatements` 的「按 id 合并 + GC 不可达」理念，update_surface 从返回完整快照改为返回 delta-only（仅变更的组件），processor 端 merge 到已有 surface state。首次调用仍返回完整快照。省 70%+ token                                                                                                                                                   |
| **OpenUI Lang 渲染（PM-Designer 专用）** | **thesysdev/openui**（@openuidev/lang-core + react-lang，MIT）                   | `@openuidev/lang-core`（解析+运行时+prompt）+ `@openuidev/react-lang`（Renderer）+ pm-designer skill prompt 切换 | **P1（PoC 阶段）**：OpenUI Lang 作为 A2UI 的补充，**仅用于 PM-Designer**。紧凑行式语法（`root = Stack([title, form])`）比 JSON 省 3-4x token；响应式 `$variable` 自动依赖追踪；增量编辑按语句名 merge 省 85% token。MCP 原生——`toolProvider` 直接接 DeepOrca MCP client。**不替换通用 A2UI 管线**——PM-Designer 走 OpenUI Lang，其他场景仍走 A2UI JSON                                |
| 前端设计质量纪律                         | **taste-skill**                                                                  | ✅ **已完成**：构建 Skill（纯 SKILL.md）                                                                         | 10 条 P0 设计纪律 + 排版阶梯 + 颜色/动效/布局规范，框架无关。同时适用于 DeepDesign（.dd）和 PM-Designer（A2UI/OpenUI）                                                                                                                                                                                                                                                               | ~~P1~~ 完成          |
| 视觉特效"画笔"                           | **html-in-canvas**（WICG 提案 [html-in-canvas.dev](https://html-in-canvas.dev)） | 浏览器原生 API（`drawElementImage()`/`layoutsubtree`），**非库不可 vendor**                                      | 让 Agent 生成的 HTML 设计件获得 shader 级视觉特效（液体玻璃 refraction、像素瓦解、CRT/色差 shader、3D 贴 HTML 纹理），远超纯 CSS。**当前实验态**：仅 Chrome Canary / Brave 147+ 需手动开 `chrome://flags/#canvas-draw-element`，Firefox/Safari 无实现，无 polyfill，无正式发布时间表。**等 Chromium/Electron 稳定支持后才可纳入**。详见 `docs/research/2026-07-30-html-in-canvas.md` | P3（阻塞于平台支持） |
| 仪表盘模板                               | DeepDesign dashboard                                                             | seed + layouts                                                                                                   | 侧边栏 + KPI 卡 + 内联 SVG 图表                                                                                                                                                                                                                                                                                                                                                      | P2                   |
| 移动端模板                               | DeepDesign mobile-app                                                            | seed + layouts                                                                                                   | iPhone 框架 + 多屏流程                                                                                                                                                                                                                                                                                                                                                               | P3                   |
| 海报模板                                 | DeepDesign poster                                                                | seed + layouts                                                                                                   | 单页海报/社交媒体图                                                                                                                                                                                                                                                                                                                                                                  | P3                   |
| **Tailwind CSS 实现层**                  | **Tailwind CSS 本地内置**                                                        | ✅ **已完成**：vendor 脚本下载 JIT ~400KB 到本地，`.dd` 编译器自动内联                                           | Agent 写 `class="flex gap-4 rounded-xl"` 比手写 CSS 更可靠、更一致。**离线可用**——不依赖 CDN，Tailwind JIT 脚本在构建时 vendor 到 `packages/desktop/vendor/tailwind/` 并内联到每个设计稿。配合 UI 风格目录提示词，Agent 直接用 utility classes 落地风格定义信号（如 Neobrutalism 的 `border-2 border-black shadow-[4px_4px_0_#000]`）。**不替换主 UI 的 `--ui-*` token 系统**        | ~~P2~~ 完成          |
| **Uiverse 组件库**                       | **uiverse-io/galaxy**（5800+ 开源 UI 元素，MIT）                                 | DeepDesign 参考文档（`design/references/uiverse-components.md`）                                                 | 精选 20-30 个高质量 HTML/CSS 组件代码（Buttons/Cards/Inputs/Loaders/Toggles/Tooltips 等 11 分类），Agent 生成设计稿时直接引用替代从零手写 CSS。不做全量 vendor（5800 太多），只精选高频组件。[uiverse.io](https://uiverse.io) · [galaxy](https://github.com/uiverse-io/galaxy)                                                                                                       | P2                   |

**实施路线**：

- Phase 1（已完成）：web-prototype 模板 + dark-tech 系统 + deep-design Skill
- Phase 1.5（已完成）：UI 风格目录（14 个 NameThatUI/styles 提示词）→ `design/references/ui-styles.md`
- Phase 2：dashboard 模板 + 3 设计系统 + DESIGN.md 用户自建 + PDF 导出 + **Tailwind CDN 实现层**（Agent 用 utility classes 落地风格提示词）
- Phase 3：mobile-app/poster 模板 + DesignStudioPanel 桌面面板（html-in-canvas 视觉特效另作独立远期项，阻塞于 Chromium/Electron 平台支持，不在此阶段 vendor）

**替代决策**：DeepDesign 替代了原路线图的 OpenDesign daemon 集成——同能力，零 daemon，轻量 10 倍。

**右侧预览面板模式（与 PM-Design 共享）**：
DeepDesign 和 PM-Design 都采用**插件指令触发 + 右侧分屏预览**模式（非独立工作区）：

- `/pm-design` 或 `/prototype` → 触发 PM-Design 原型设计 → 右侧预览面板打开（A2UI Surface）
- `/deep-design` → 触发 DeepDesign HTML 设计 → 右侧预览面板打开（iframe 渲染 HTML）
- 对话区保持可见（split view），用户边对话边看预览
- 预览面板支持 tab 切换（prototype / design），关闭即收起
- 布局：`[Rail] [Sidebar] [Chat Area] [Preview Panel (right)]`

**PM-Design V2：需求具现化工作台（设计阶段）**：
当前三管线（A2UI / OpenUI / DeepDesign）虽然各自完整可用，但从 PM 视角存在"三选一认知负担、无左侧工作区、缺需求分析前置、产物不持久、无一键入口"五个痛点。V2 将三管线从"用户手动选择"升级为"AI 自动路由"，并增加左侧 `design` 工作区（位于 Code Review 下方）：

- **核心理念**：需求具现化 —— 模拟 PM 完整职责链（需求采集 → 需求分析 → 管线路由 → 原型生成 → 预览验证 → 持久化/交付）
- **一键入口**：`design.materialize` 复合 Action —— `pm-analyst` 子代理拆解需求 → 自动判断最佳管线 → 调用现有 MCP 工具生成原型
- **管线路由规则**：交互型（表单/看板/导航）→ A2UI；展示型（着陆页/海报）→ DeepDesign；混合型/token 敏感 → OpenUI Lang
- **左侧 DesignPanel**：一键按钮 + 设计产物列表（`.deeporca/designs/`）+ 对话迭代闭环
- **现有 slash 命令保留**：`/pm-design` `/deep-design` `/pm-design-openui` 供高级用户手动选管线
- **三管线代码零改动**：`design.materialize` 是纯编排层，复用现有 `render_surface` / `render_openui` / `render_design` MCP 工具
- 详见 [`specs/pm-design-v2/design.md`](../../specs/pm-design-v2/design.md) · [`tasks.md`](../../specs/pm-design-v2/tasks.md)

---

## 七、办公套件

> 单文件办公文档生成——演示文稿、文档、表格、表单。核心理念：一个 HTML 文件就是完整的办公应用（编辑器+查看器+导出器），零安装零依赖，任何浏览器可打开。

### 已集成

| 能力         | 项目             | 集成形态          | 定位                                                                                                         |
| ------------ | ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| 演示文稿生成 | **Bento Slides** | 内置 Skill + 模板 | JSON → 单 `.bento.html` 文件（~644KB，含编辑器+放映+导出），支持文本/形状/图表(ECharts)/表格/图片/morph 动画 |

**Bento 的核心能力**：

- **单文件即完整应用**——`.bento.html` 包含 JS 运行时 + 文档数据，浏览器打开即可编辑/放映/导出
- **丰富的元素类型**——text（富文本）、shape（矩形/椭圆/箭头/路径）、chart（ECharts 柱状/折线/饼图/散点）、table、image、SVG
- **Morph 动画**——跨幻灯片同 ID 元素自动形变过渡（签名特性）
- **主题系统**——background/color/accent/fontFamily 四个 token 控制全局风格
- **零依赖**——无需服务器/安装/联网，纯前端

### 规划中

| 能力                           | 集成形态              | 贡献                                                                                      | 优先级 |
| ------------------------------ | --------------------- | ----------------------------------------------------------------------------------------- | ------ |
| 文档生成（Markdown → 单 HTML） | Skill + 模板          | 富文本文档（带目录/代码高亮/图表），单 HTML 导出，类似 Bento 但面向长文档                 | P2     |
| 表格/电子表单生成              | Skill + 模板          | 数据表格（排序/筛选/公式），单 HTML 文件含查看器                                          | P3     |
| 办公文档预览面板               | Electron webview 组件 | 统一的办公文档预览（.bento.html + 文档 HTML），复用 DesignStudioPanel 的 webview 基础设施 | P2     |

**设计理念**（与 DeepDesign 的关系）：

- **DeepDesign** = 视觉设计（UI 原型/落地页/仪表盘/海报）——追求"好看"
- **办公套件** = 办公文档（演示文稿/文档/表格）——追求"实用"
- 两者共享 Electron webview 预览基础设施，但 Skill/模板/输出格式独立
- Bento 的 JSON 数据模型与 DeepDesign 的 HTML 模板是不同的产物范式——办公套件用 JSON 数据驱动，设计生成用 HTML 模板组合

---

## 八、浏览器与联网

> 登录态操控 + 大规模抓取 + 深度联网策略——让 Agent 能真正"上网干活"。

### 已集成

| 能力                           | 项目                    | 集成形态                           | 定位                                                            |
| ------------------------------ | ----------------------- | ---------------------------------- | --------------------------------------------------------------- |
| 真实 Chrome 操控（携带登录态） | **browser-skill** (bsk) | 内置插件（Rust CLI + Chrome 扩展） | 通用页面操控——表单/截图/UI 测试，Agent Window 隔离              |
| 单次网络搜索                   | **WebSearch**           | 内置工具                           | 脚本钩子或托管 API，单次查询→文本结果                           |
| 联网策略 + 站点经验            | **web-access** 理念     | 借鉴 Skill（不整体引入）           | 联网工具自动选择（WebSearch/curl/Jina/CDP）+ 按域名积累操作经验 |

### 规划中

| 能力                     | 项目        | 集成形态                    | 贡献                                                     | 优先级 |
| ------------------------ | ----------- | --------------------------- | -------------------------------------------------------- | ------ |
| 大规模无头抓取 + Stealth | **obscura** | MCP Server（Rust 单二进制） | 30MB 内存、85ms 加载、反检测——bsk 做操控，obscura 做抓取 | P2     |

**分工设计**：

```
用户请求 → Agent 判断任务类型
  ├─ 通用页面操控（表单/UI 测试）→ browser-skill（登录态操控）
  ├─ 大规模数据抓取 / 反爬虫 → obscura（轻量无头 + Stealth）
  └─ 联网搜索 / 信息检索 → WebSearch（单次）/ Open Deep Research（多轮，规划中）
```

**关键判定**：web-access 的核心能力（真实 Chrome + 登录态）与 bsk 冗余，不整体引入。只借鉴其"联网策略选择 + 站点经验积累"两个独特点。

### 不采纳

| 项目                           | 理由                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent-Reach**（Panniantong） | 场景与 DeepOrca §八 高度重叠（都是"让 agent 联网"），但形态/受众不同——Agent-Reach 是 CLI 能力层（靠上游 CLI + cookie 登录态，强中文平台），DeepOrca 是 Electron harness（内置 bsk 真实 Chrome）。整体引入会与既有 bsk/WebSearch/web-access 三层体系冲突。**借鉴其「首选+备选后端路由」选型思路和 `doctor` 体检模式**，强化 web-access 的多后端降级与可用性探测。调研 `docs/research/2026-07-30-harness-handbook-skillspector-agentreach-opennotebook.md` |

---

## 九、桌面自动化

> 操控无 API 的桌面软件——让 Agent 不局限于终端和浏览器。

### 规划中（全新空白域）

| 能力                            | 项目                             | 集成形态                                        | 贡献                                                                                            | 优先级 |
| ------------------------------- | -------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ |
| 桌面 GUI 操控（原生执行层）     | **pi-computer-use**              | Pi 扩展（macOS Swift + Windows Rust）           | 查找窗口/观察 UI/点击输入/等待变化——操控 Figma/Photoshop/Excel 等桌面软件                       | P2     |
| 视觉感知 fallback（VLM 定位层） | **ShowUI**（ShowLab, CVPR 2025） | Skill + 可选 Python sidecar（或 HF Space 远程） | 当无障碍树缺失时（Photoshop/自绘 UI/远程画面），VLM 视觉定位元素坐标 → pi-computer-use 执行点击 | P2-P3  |
| 万能 CLI 生成                   | **CLI-Anything**                 | 内置 Skill（HARNESS.md 方法论）                 | 7 阶段为任意软件自动生成 CLI（分析→设计→实现→测试→文档→发布）                                   | P2     |

**互补关系**：pi-computer-use 直接操控 GUI，CLI-Anything 把软件变成 CLI——两种思路解决同一问题（驱动无 API 的软件）。

**ShowUI vs pi-computer-use 分工**（仿 bsk/obscura 分工模式）：

```
用户请求 → pi-computer-use 查找窗口/元素
  ├─ 应用暴露无障碍树（原生应用）→ 原生 AX/UIAutomation API 定位（pi-computer-use 自带，快速精确）
  └─ 无障碍树缺失（Photoshop/自绘 UI/远程画面）→ ShowUI 视觉定位坐标 → pi-computer-use 执行点击
```

**ShowUI 不作为核心依赖**：Python + ~2B 参数模型 + GPU 需求违反"零外部运行时依赖"原则。作为可选 sidecar（仿 CRG/uv 模式）或通过 Hugging Face Space 远程调用（免本地 GPU）。

**ShowUI 技术参数**：~2B 参数 VLA 模型（Phi-3-Vision/Qwen2.5-VL 基座）、Apache-2.0、CVPR 2025。输入截图 → 输出交互元素坐标 + 任务决策。通过 `computer_use_ootb` 变体支持 macOS/Windows/Linux 全桌面控制。

### 模拟器使用（sim-use）

> 新增（2026-07-30 调研）——填补 iOS 模拟器交互空白 + 补齐 Android 验证循环。

| 能力                         | 项目                          | 集成形态                                     | 贡献                                                                                       | 优先级 |
| ---------------------------- | ----------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ | ------ |
| iOS + Android 统一模拟器操控 | **sim-use**（LY Corporation） | 内置 Skill + PLUGIN.md（CLI-first，走 bash） | observe-act-verify 循环：UI 大纲（比无障碍树小 ~16x）、tap/swipe/type/paste、截图+崩溃检测 | P1     |

**与 android-cli 的互补关系**：

```
android-cli (Google)  →  项目生命周期：create/run/emulator/sdk/docs
sim-use (LY Corp)     →  运行时 UI：observe/tap/type/verify（iOS + Android 统一）
```

**sim-use 技术参数**：Swift CLI（macOS 14+）、Apache-2.0、~549 stars（3 周龄）。iOS 用 Meta idb XCFrameworks + Apple Accessibility API；Android 用 Kotlin AccessibilityService + HTTP over adb forward。前置条件：Xcode（iOS）或 adb + 模拟器（Android）。非 MCP——CLI-first，附带 SKILL.md。

---

## 十、引擎演进

> DeepOrca 引擎层的核心能力升级——模型路由、子 agent。

### 已集成

| 能力                                                        | 来源                    | 定位                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan Mode（3 阶段对话 + 权限强制 + proposed_plan）          | 引擎核心                | 规划层权威——引擎级权限强制，force-ask 写操作                                                                                                                                                                                                                                                                                                                                                                                                 |
| UpdatePlan（markdown TODO 跟踪）                            | 引擎核心                | 执行阶段进度跟踪                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 模型路由（轻量子任务→flash）                                | `model-capabilities.ts` | 子任务降级（技能匹配/prompt 增强/压缩用 flash）                                                                                                                                                                                                                                                                                                                                                                                              |
| Electron 43（Node 24.18，Chromium 150）                     | 引擎升级                | 内部插件零外部依赖（node:sqlite + require(esm)）                                                                                                                                                                                                                                                                                                                                                                                             |
| **官方 MCP SDK 迁移**（`@modelcontextprotocol/sdk@1.22.0`） | 引擎基础设施升级        | 把手写 JSON-RPC（客户端 + gitmcp 服务端）换成官方 SDK。追平协议版本、解锁 Streamable HTTP 传输、解锁 server→client 能力（sampling/roots/elicitation）、支持 image/audio/structured content。**已完成（perf/native-optimizations 分支 9 commits）**——客户端 `Client`+`StdioClientTransport`、gitmcp `McpServer`+`registerTool`，对外接口零变化，`npm run check` 全绿，gitmcp 端到端握手验证通过。迁移记录 `specs/mcp-sdk-migration/design.md` |
| **多端点配置 + 主/辅助模型角色**                            | 引擎基础设施升级        | 设置面板连接页改为端点列表配置器。支持多个 API 端点（DeepSeek 官方 / OpenCodeGo / OpenCodeZen / 自定义），每个端点独立 baseURL + apiKey。主模型（对话工作区）和辅助模型（代码审查/索引/subagent）可绑定不同端点——例如主模型用 DeepSeek 官方 pro，辅助模型用 OpenCodeGo flash。`createSecondaryClient()` 已就绪。向后兼容：无 endpoints 配置时自动从 `env.API_KEY`+`env.BASE_URL` 合成默认 DeepSeek 端点。                                    |

### 规划中

| 能力                                        | 来源                                                    | 贡献                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 优先级 |
| ------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **A2UI 对话交互层**（Agent 驱动声明式 UI）  | **A2UI** 协议（a2ui-project/a2ui，Apache-2.0）          | ✅ **已集成**：对话区从纯文本升级为可交互富组件。P0-P4 全部完成——MCP Server（InMemoryTransport）+ 自研渲染层（Basic Catalog + 6 个自定义组件）+ a2ui_action 双向链路。P1：UpdatePlan checklist / 进程监控 / 权限标签 / 长任务进度 / Plan 步骤预览 / 对比矩阵 / AskUserQuestion 文本输入。P2：符号树 / 审查分组 / 搜索卡片 / Git 变更 / CRG 风险热力 / Wiki 导航。P3：独立 Electron 窗口。`561ba72`→`fed3c67`                                                                                                                                   |
| 模型中途切换                                | **Prewalk** 理念                                        | 贵模型规划→首次编辑→切换廉价模型执行。基于 model-capabilities.ts + UpdatePlan 扩展                                                                                                                                                                                                                                                                                                                                                                                                                                                             | P1     |
| **辅助模型迁移**（secondary model rollout） | 多端点配置（已就绪）                                    | 基础设施已完成（`createSecondaryClient()` + endpoints 配置 + UI）。下一步：将以下 LLM 调用点从主模型迁移到辅助模型（flash），降低 token 成本：**①上下文压缩（compaction）**——session.ts 的 summarizeMiddle 调用；**②技能自动匹配（skill matching）**——LLM 判定哪些 skill 激活；**③代码片段重建（rebuild-snippet）**——edit-handler 的 LLM 重建；**④Web 搜索总结**——web-search-handler 的 LLM 摘要；**⑤子 agent 子任务**——未来的 Subagent 内部调用。每处改动模式一致：`createOpenAIClient()` → `createSecondaryClient()`，thinking 参数关闭。    | P1     |
| **长程任务可靠执行（原生 MEA）**            | **LongHorizon-Harness**（arxiv:2608.01964，借鉴并验证） | 采用 Manage-Execute-Audit：Manager 维护外置任务状态并下发有验收标准的 bounded task；Executor 每轮使用 fresh context 执行；Auditor 以受限只读能力独立核查环境。Executor 自述不直接改变权威状态，只有 `complete + clean` 的审计证据才能确认完成。**产品只做 Electron 桌面客户端**：能力实现在 `@deeporca/core`，由 desktop main 编排并通过 typed IPC 提供长任务启动、监控、暂停、恢复、用户 gate 和审计视图；不规划 DeepOrca CLI/headless CLI。先做桌面内受控实验验证上游语义，再原生化为 TypeScript；不把 Python harness 作为正式产品常驻依赖。 | P1     |
| 子 agent（Subagent）                        | **DeepCode** 架构理念                                   | Paper2Code（论文→代码）+ Loop engineering（自主循环直到测试通过）。加 Task 工具 + runSubagent（内部用辅助模型）                                                                                                                                                                                                                                                                                                                                                                                                                                | P2     |

**长程任务架构决策**：只选择 **LongHorizon-Harness 的 MEA 路线**，不同时集成 LoopX。两者都提供长程任务控制；并存会造成 Goal/Todo/状态、完成判定和调度的双重权威。LongHorizon-Harness 与 DeepOrca 现有 session/tool/permission/checkpoint 引擎的执行层缺口更匹配，而 LoopX 的 quota、heartbeat、claim/lease、外部控制平面与桌面客户端的任务/session 管理重叠较高，且当前依赖 Python/POSIX 环境，故暂不纳入架构。

**原生 MEA 设计边界**：

- `AgentEpisodeRunner`：为 Manager、Executor、Auditor 创建互相隔离的 fresh episode，支持 round/time/token 预算与中断；这只是 core 内部执行抽象，不是 CLI 产品接口。
- `LongRunStore`：独立于 session JSONL 和 memory，持久化 Requirement、Artifact、Verified Fact、Evidence、Audit、Gate 与 Round；采用版本化 schema、原子快照和 append-only 事件记录。
- Manager 无环境修改能力；Executor 是唯一正常写入角色；Auditor 使用过滤后的只读工具面，并在审计副本/只读快照上验证，不能仅靠 prompt 声明只读。
- 完成条件固定为：Manager 请求完成、最新 Audit 为 `complete + clean`、所有强制 Requirement 均有已验证 evidence；Executor 自报完成无权直接改变状态。
- `@deeporca/memory` 只接收 verified state 的可选检索投影，不作为长任务权威状态或完成判定来源。
- 桌面端 UI 展示长任务阶段、轮次、requirements、证据、审计结论、预算和用户 gate，并支持暂停/恢复/终止；所有 renderer 能力通过 `packages/desktop/src/shared/ipc.ts` 的 typed IPC 接入，编排归 desktop main。
- 明确不建设 `deeporca-agent`、headless runner 或其他 DeepOrca CLI 行为；上游 Python 的 `AgentAdapter` 仅作为接口理念参考，不作为本项目的产品集成路径。

**建议落地顺序**：①修复/隔离 compaction 对审计记录的影响，并禁止未审计结果进入稳定记忆；②抽取 core 内部 `AgentEpisodeRunner`；③实现 `LongRunStore`；④完成代码工程场景的 Manager→Executor→Auditor（复用现有 bash、read、write、edit 等内置工具）；⑤接入 Electron typed IPC 与长任务 UI；⑥增加 GUI Auditor、多模型角色与跨重启恢复。

**架构可行性**（已验证）：DeepOrca 引擎对 subagent 友好——`activateSession` 已是 public 按 sessionId 参数化的纯异步函数，所有状态 Map<sessionId> 结构。加一个 Task 工具 + 抽取 `runSubagent()` 即可，不需重新设计引擎。

---

## 十一、自进化

> Agent 改进自身——双层自改进：**引擎脚手架**（prompt/工具/控制流）+ **技能内容**（SKILL.md 行为/描述）。
> 当前 DeepOrca 的技能系统是**静态**的（skill-writer 编写、skill-digester 改描述文案），没有任何基于执行结果的反馈闭环。

### 已集成（静态，无反馈闭环）

| 能力         | 项目               | 定位                                | 局限                                           |
| ------------ | ------------------ | ----------------------------------- | ---------------------------------------------- |
| 技能编写     | **skill-writer**   | 教 Agent 创建 SKILL.md              | 纯人工编写，无自动生成                         |
| 技能描述审查 | **skill-digester** | 审查/重写 skill 的 description 字段 | 基于文本启发式，需人工批准，**无执行结果反馈** |

**关键空白**：搜索 `skillEvaluat`/`self-evolv`/`feedback loop` 在代码中零匹配——DeepOrca **没有任何基于执行结果的能力评估或自动改进机制**。

### 规划中（双层自改进）

#### 层一：技能自演化（技能内容改进）

技能生命周期的两端：**从哪来**（book-to-skill 生成）→ **好不好**（skill-up 评估）→ **自动改进**（OpenSpace 反馈闭环）。

| 能力                    | 来源理念                                                                                                                  | 贡献                                                                                                                                                                                    | 优先级 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 书籍/文档→技能生成      | **book-to-skill**（[virgiliojr94/book-to-skill](https://github.com/virgiliojr94/book-to-skill)，MIT，Python，17.2k star） | 把书籍/文档/教程自动转成标准 SKILL.md（章节拆分 + 摘要 + 前置知识）。作为**知识插件的一个技能**集成，不做内核改动。补齐「技能从哪来」端。                                               | P2     |
| 技能质量评估（CI 回归） | **skill-up**（[alibaba/skill-up](https://github.com/alibaba/skill-up)，Apache-2.0，Go）                                   | 声明式 YAML 用例 + 多引擎 + rule/script/agent_judge 裁判 + CI 集成。**先用于 CI 评估内置技能**（`specs/skill-eval/design.md` S1），engine.custom 适配后置（S2）。补齐「技能好不好」端。 | P1     |
| 技能执行→评估→改进闭环  | **OpenSpace** 理念（借鉴，不直接集成）                                                                                    | 技能执行后捕获结果（成功/失败/重试次数）→ 低成功率技能触发自动重写 → 高成功率技能在匹配时加权                                                                                           | P2     |

**为什么不直接集成 OpenSpace**：Python 3.12+ 依赖 + Cloud 依赖（open-space.cloud）+ 它本身是完整 agent harness（与 DeepOrca 架构重叠）。只借鉴其"FIX/DERIVED/CAPTURED 演化触发器"和"provisional→trusted 信任状态机"设计理念，在 DeepOrca 内部用 Node.js 自建轻量版。

**轻量自建方案**：

```
技能执行 → 捕获结果（成功/失败/重试/用户纠正）
    ↓
低成功率技能 → skill-digester 自动重写 description（现有工具）
    ↓
高成功率技能 → 技能匹配时加权（identifyMatchingSkillNames 增强）
```

#### 层二：harness 自改进（引擎脚手架改进）

| 能力                               | 来源理念                                                      | 贡献                                                                                                                                                                                                                                                 | 优先级 |
| ---------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 弱点挖掘→提案→回归测试             | **Self-Harness** 论文（arxiv:2606.09498）                     | Agent 分析自身执行轨迹发现失败模式 → 生成最小化脚手架修改（prompt/工具定义/控制流）→ 回归测试只保留有效改进                                                                                                                                          | P3     |
| **Harness Gene Bank + 门控筛选** | **HarnessBank** 论文（[arxiv 2607.13683](https://arxiv.org/abs/2607.13683)，互补 Self-Harness） | 高性能 harness 变体的"基因库"（reinvention + recombination）+ Gated Harness Screening 门控筛选。与 Self-Harness 互补：Self-Harness 是"生成器"（弱点→提案），HarnessBank 是"存储+筛选器"（变体池+质量控制）。**evolver agent 复用 §十 Subagent** 作执行单元。关键结论"gains are model-specific"验证 DeepSeek 专项调优策略 | P3 |
| **harness 行为级地图**（自动生成） | **Harness Handbook** 论文（arxiv:2607.13285，借鉴理念不集成） | 用静态分析 + LLM 结构化自动合成 harness 的三层行为地图（系统流程→细粒度行为→源码位置），解决"行为定位"难题。让 `deeporca-self-refer` 从"读手写 AGENTS.md"升级为"读自动生成的行为地图"。**理念启发**——实现工程量大（静态分析+LLM 结构化），记远期愿景 | P3     |

**三阶段闭环**：

```
1. 弱点挖掘（Weakness Mining）
   分析执行轨迹 → 发现失败模式/重复错误

2. Harness 提案（Harness Proposal）
   针对每个弱点 → 生成最小化、多样性的脚手架修改
   （如：调整 prompt 措辞、增加工具参数约束、修改控制流）

3. 回归测试（Regression Testing）
   只保留通过回归测试的修改 → 防止改好一处破坏他处
```

**与技能自演化的关系**：Self-Harness 改"引擎脚手架"（prompt/工具/控制流），OpenSpace 改"技能内容"（SKILL.md）——两者互补，不重叠。

**Self-Harness 与 HarnessBank 的分工**：前者管"怎么提出 harness 改进"（弱点挖掘→提案→回归），后者管"改进池怎么存与筛"（gene-bank 重组+门控）。两者顺序执行——Self-Harness 产出的候选 harness 进入 HarnessBank 的 gene pool，经 Gated Screening 留存高质量变体。HarnessBank 的 evolver agent 即 §十 Subagent 的一个高价值用例（这为 Subagent 从 P2 提级提供依据）。

**实施条件**：层二（harness 自改进）依赖层一（技能自演化）先落地建立执行结果捕获基础设施。建议作为远期方向（P3）。

#### 层三：蜂群协作（多 Agent 编排）

> 新增（2026-07-30 调研）——借鉴 JiuwenSwarm 理念，不引入 Python 运行时。

| 能力                  | 来源理念                          | 贡献                                             | 优先级 |
| --------------------- | --------------------------------- | ------------------------------------------------ | ------ |
| 任务分治编排          | **JiuwenSwarm**（openJiuwen）理念 | 复杂任务自动分解 → 并行 subagent 分派 → 结果合并 | P3     |
| 上下文卸载 + 分层记忆 | JiuwenSwarm 理念                  | 显式 token 成本控制（与 TDAM L0-L3 管线互补）    | P3     |

**为什么不直接集成 JiuwenSwarm**：Python 运行时（pip install + Web UI），与 DeepOrca 的 Node/Electron 架构不匹配。只借鉴其"分治→并行→合并"编排模式和"上下文卸载保护 token 账单"的成本控制策略。落地方式：编写内置 Skill 教 Agent 在复杂任务中做任务分解 + 并行分派（复用 DeepOrca 已有的 subagent 能力）。

---

## 十二、插件中心

> 统一的插件/技能/MCP 管理入口——内置项分组展示，远程源一键安装。
> UI 方案：**设置面板内平铺卡片网格**（非左侧列表），按 category 分区。

### 已集成

| 能力                        | 来源                                           | 定位                                                                     |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| 分组展示                    | `builtin-plugins.json` 清单                    | 内置 skills/MCP/plugins 按工具分组（Flutter/CodeGraph/代码审查/GitMCP…） |
| 内置项隔离                  | MCP/Skills tab 过滤                            | 内置项不在 MCP/Skills tab 单独展示，仅在 Plugins tab 分组卡片中          |
| Flutter/Dart 技能包         | flutter/agent-plugins                          | 24 个技能构建时内置                                                      |
| Android/HarmonyOS/RN 技能包 | android/skills + deveco-cli + expo + callstack | 构建时内置                                                               |
| Browser 统一分组            | browser-skill + web-access-strategy            | Chrome 操控 + 联网策略 Skill                                             |

### 规划中：远程源集成

#### 安装安全闸门（前置，与远程源集成同期）

| 能力                       | 项目                                   | 集成形态                                                                                          | 贡献                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 优先级 |
| -------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **skill/MCP 安全扫描闸门** | **SkillSpector**（NVIDIA，Apache-2.0） | builtin MCP server（`uvx skillspector mcp`，复用 crg/serena 的 uv 路径）或安装管线内强制 CLI 调用 | 从不可信远程源装 skill/MCP 前的安全闸门。68 漏洞模式/17 类（prompt injection / data exfiltration / supply chain 含 OSV CVE / **MCP least-privilege LP1-4** / **MCP tool poisoning TP1-4**），静态+LLM 两阶段，风险评分 SAFE/CAUTION/DO_NOT_INSTALL → allow/prompt/block。`--no-llm` 可纯静态零依赖。DeepOrca 大举引入远程 skill/MCP（见下「远程源清单」），SkillSpector 是配套的安全层。调研 `docs/research/2026-07-30-harness-handbook-skillspector-agentreach-opennotebook.md` | **P1** |

> **为什么必须**：DeepOrca 正规划 8 个远程 Hub 集成（ClawHub/ModelScope/SkillHub/SwarmSkills…），远程 skill/MCP 是高风险面（研究显示 26.1% skill 含漏洞、5.2% 疑似恶意）。MCP tool poisoning（元数据藏指令/Unicode 欺骗/描述-行为不符）是真实攻击向量。SkillSpector 形态现成（MCP server），集成成本低（uv shim）。

#### 技术阻断点（必须先解决）

| #   | 阻断点                                      | 影响                                                                                                           | 方案                                                                                                                                    |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ~~**MCP HTTP/SSE 传输缺失**~~ ✅ **已解锁** | MCP SDK 迁移（§十，已完成）已引入官方 SDK，`StdioClientTransport` 之外 Streamable HTTP/SSE 传输是 SDK 原生支持 | 扩展 `McpServerConfig` 为 discriminated union（`type: "stdio" \| "http" \| "sse"` + `url` + `headers`），复用 SDK 的 HTTP/SSE transport |
| 2   | **远程源抽象缺失**                          | `BuiltinPluginGroup` 只读本地 JSON                                                                             | 定义 `RemotePluginSource` 接口（`list()/search()/install()`），本地清单成为其中一个 source                                              |
| 3   | **安装管线缺失**                            | Skills 自动发现、MCP 手动配置                                                                                  | 实现"下载→放置→注册→启用→卸载"生命周期                                                                                                  |

#### 远程源清单（按优先级）

> **架构洞察（2026-07-30 深度验证）**：5 个 Skill Hub 实际分为**两种 CLI 族系 + 一个独立 API**，不是统一格式。集成方案需按族系适配，而非假设统一协议。

##### clawhub CLI 族（共享 `clawhub` npm CLI + `--registry` 切换 + `/api/v1/skills` REST）

| 源                        | 安装命令                                                              | 搜索                                                   | Agent 提示词                                         | 备注                                                             |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------- |
| **ClawHub** (clawhub.ai)  | `npx clawhub@latest install <slug>`                                   | `clawhub search "<q>"` 或 REST `GET /api/v1/skills?q=` | 无独立提示词（在 OpenClaw 文档中）                   | 参考实现，~57k skills，有 `inspect`/`scan` 安全扫描              |
| **skill.xfyun.cn** (讯飞) | `npx clawhub install <slug> --registry https://skill.xfyun.cn`        | 同上（指向讯飞 registry）                              | ✅ `/registry/skill.md`（`skillhub-registry` skill） | **非独立 hub**——是 SkillHub 应用代码 + 讯飞 SSO 部署             |
| **cn.clawhub-mirror.com** | `npx clawhub install <slug> --registry https://cn.clawhub-mirror.com` | 同上                                                   | 无                                                   | 中国镜像（腾讯云前端），`--registry` 切换即可，与 ClawHub 二选一 |

**clawhub 族集成方案**：安装一个 `clawhub` CLI 适配器，通过 `CLAWHUB_REGISTRY` 环境变量或 `--registry` 参数切换源。三个站点共享相同的 `/api/v1/skills` API 和 `/.well-known/clawhub.json` 发现端点。Agent 端通过内置 Skill 教 Agent 使用 `clawhub search/install/inspect`。

##### 独立 CLI 族（各有专属安装工具）

| 源                             | 安装命令                                     | 搜索                  | Agent 提示词                                                                     | 备注                                                                   |
| ------------------------------ | -------------------------------------------- | --------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **SkillHub.cn**                | `skillhub install <name> --dir <skills dir>` | `skillhub search <q>` | ✅ `/install/skillhub.md`（含优先源策略：首选 SkillHub 中国加速 → 回退 ClawHub） | 自有 CLI（腾讯云 COS 安装器），标准 SKILL.md 格式                      |
| **ModelScope** (modelscope.cn) | `modelscope skills add @<namespace>/<name>`  | `ms` CLI / OpenAPI    | ✅ `ms-hub` meta-skill（SKILL.md 本身就是 Agent 指令）                           | Python SDK CLI（`pip install modelscope`），安装到 `~/.agents/skills/` |

##### 独立 API 族（无 CLI，REST API 直接调用）

| 源                                           | API                                                               | Agent 提示词                | 备注                                                        |
| -------------------------------------------- | ----------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------- |
| **SwarmSkills** (swarmskills.openjiuwen.com) | `GET /api/v1/skills`（列表）、`GET /api/v1/skills/<slug>`（详情） | 无（SPA 界面，无 CLI 文档） | "Swarm Skill" = 多角色 SKILL.md 扩展，含 SwarmFlow 编排脚本 |

##### 其他远程源

| 优先级 | 源                                                               | 类型           | 格式                                   | API                         | 内容量                 |
| ------ | ---------------------------------------------------------------- | -------------- | -------------------------------------- | --------------------------- | ---------------------- |
| **P0** | **claude-plugins-official** (anthropics)                         | 插件+MCP+Skill | `marketplace.json`（**事实标准格式**） | Git clone + GitHub API      | 32.8k stars, 80+ 插件  |
| **P0** | **MCP Registry** (mcp-cn.com / registry.modelcontextprotocol.io) | MCP            | REST API                               | ✅ 无认证 `GET /v0/servers` | 官方 MCP 注册表        |
| **P1** | **anthropics/skills**                                            | Skill          | SKILL.md                               | Git clone                   | 165k stars, 501 skills |

#### 标准格式：双格式兼容（marketplace.json + Agent Plugins 1.0.0）

插件中心同时兼容两种包格式，加载器自动识别，不互斥不取代：

- **marketplace.json**（`anthropics/claude-plugins-official`）——保留为远程源发现格式（列表 + SHA-pin）。DeepOrca 现有 `builtin-plugins.json` / `skill.plugin.md` 继续工作，零迁移。claude-plugins-official 是当前最大的远程插件目录（32.8k star，80+ 插件）。
- **Agent Plugins 1.0.0**（[agentplugins/agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec)，Amazon/Cursor/Microsoft/OpenAI/Vercel 共治，7 客户端已采纳：Cursor/GitHub Copilot/VS Code/Codex/Kiro/OpenClaw/Hermes）——**新增兼容格式**。任一 Agent Plugins 插件包（`plugin.json` + `skills/` + `mcp.json`）可直接装入 DeepOrca；DeepOrca 自有插件可逐步按此格式发布，获得跨厂商中立性 + 上 compatible-clients 榜资格。

**兼容性来源**：skills 层两者完全一致（`skills/<name>/SKILL.md`）；manifest 层 Agent Plugins 虽是闭合 schema，但规范 §5.2 明确"未知顶层字段忽略而非致命"，DeepOrca 的 `category`/`icon`/`builtin`/`removable` 等字段不会被拒绝，只是未来逐步下沉 `extensions.deeporca.*` 以通过严格校验；MCP 层 Phase 0 三传输 union 已对齐 Agent Plugins 的 stdio/streamable-http/sse oneOf。

DeepOrca 现状与 Agent Plugins 1.0.0 的差距（渐进收敛，**不阻断双格式加载**）：

```
Agent Plugins 1.0.0             DeepOrca 现状                    收敛项（渐进，非阻断）
──────────────────────────────────────────────────────────────────────────────────
plugin.json ($schema+name 必填)  ≈ BuiltinPluginInfo manifest      厂商字段逐步下沉 extensions.deeporca.*（加载器两层都读）
skills/<name>/SKILL.md           = 原生 skill 格式（完全相同）      ✅ 零差距
mcp.json (stdio/http/sse oneOf)  ≈ mcpServers settings             Phase 0 三传输 union 已对齐
extensions.{namespace}           ≈ 顶层 category/icon 字段          渐进迁移到反向域名命名空间
PLUGIN_ROOT/PLUGIN_DATA          （无）                             Electron packaged 路径映射为这两个变量
```

> **为什么兼容而非取代**：两种格式服务的生态不同——marketplace.json 接 claude 生态（Anthropic 单厂商但量大），Agent Plugins 接跨厂商七客户端共享池。两者 skills 层同构、manifest 层 Agent Plugins 容忍未知字段，技术上可零成本共存。加载器按包内文件特征分发：有 `plugin.json` + `$schema` 指向 agent-plugins.org → Agent Plugins 模式；否则 → 现有 skill.plugin.md/builtin-plugins 模式。详细规范源码 [agentplugins/agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec)。

用户可添加任意兼容源（设置 → 插件中心 → 添加来源 → 输入 Git URL 或 marketplace.json URL → 自动解析 → 一键安装）。

#### 插件中心 UI 方案

```
设置面板 → "插件中心" Tab
├── 搜索栏 + 来源筛选（内置 / ClawHub / MCP Registry / claude-plugins-official / 自定义）
├── 平铺卡片网格（每个卡片 = 一个插件/技能/MCP 服务器）
│   ├── 图标 + 名称 + 描述 + 来源标签
│   ├── 安装/卸载/启用/禁用 按钮
│   └── 详情展开（README 预览、权限要求、依赖、SHA pin）
├── 按 category 分区（development / automation / documentation / ...）
└── "添加自定义源" 入口（输入 marketplace.json URL → 解析 → 列出可用项）
```

#### 实施阶段（修正版——按真实 CLI 族系适配）

| 阶段    | 内容                                                                                                                                                              | 解除阻断              |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Phase 0 | 扩展 MCP 客户端支持 HTTP/SSE 传输                                                                                                                                 | #1                    |
| Phase 1 | 定义 `RemotePluginSource` 接口（`list()/search()/install()/uninstall()`）                                                                                         | #2                    |
| Phase 2 | **clawhub CLI 族适配器**：封装 `npx clawhub search/install/inspect`，支持 `CLAWHUB_REGISTRY` 切换（clawhub.ai / cn.clawhub-mirror.com / skill.xfyun.cn 三源共享） | 最大 Skill 源（~57k） |
| Phase 3 | **claude-plugins-official 源**：Git clone `marketplace.json` → 解析 → sparse checkout 安装                                                                        | 格式标准              |
| Phase 4 | **MCP Registry 源**：REST API `GET /v0/servers` → 列表/搜索 → stdio+HTTP 配置生成                                                                                 | P0 MCP 源             |
| Phase 5 | **SkillHub.cn 独立 CLI 适配器**：封装 `skillhub search/install`（腾讯云 COS 加速）                                                                                | CN 精选源             |
| Phase 6 | **ModelScope 独立 CLI 适配器**：封装 `modelscope skills add`（Python SDK，需 pip）                                                                                | 最大 CN 目录          |
| Phase 7 | 设置面板插件中心 UI（平铺卡片 + 搜索 + 安装管线 + 来源筛选）                                                                                                      | #3                    |
| Phase 8 | SwarmSkills API 适配器 + 自定义远程源（用户填 `--registry` URL）                                                                                                  | 长尾覆盖              |

**关键设计**：每个适配器实现统一的 `RemotePluginSource` 接口，但内部调用各自的 CLI/API。插件中心 UI 不感知底层差异——用户只需选择来源、搜索、一键安装。clawhub 族三个站点通过 registry 参数自动切换，用户看到的是"ClawHub（国际）/ ClawHub 镜像（中国）/ 讯飞 SkillHub"三个选项。

#### 其他规划项

| 能力                 | 项目        | 贡献                                          | 优先级 |
| -------------------- | ----------- | --------------------------------------------- | ------ |
| 网站适配器 + CLI Hub | **opencli** | 100+ 网站适配器（数据获取）+ CLI Hub 统一入口 | P2     |

---

## 十三、远程接入

> 让用户从手机或远程浏览器接入 DeepOrca——本地启动服务端，通过蒲公英/ngrok/frp 等隧道映射到外网，远程打开完整 UI。

### 架构（已验证可行性）

DeepOrca 的架构对 Web 远程接入**天然友好**：

- **Renderer 是纯浏览器 bundle**——零 Electron 导入，只通过 `window.deeporca` 与后端通信（`renderer/api.ts:9`）
- **SessionBridge 不依赖 Electron**——不导入 `electron`，通过 `emit` 回调注入事件（`session-bridge.ts:76`）
- **IPC 契约 JSON-safe**——81 个 request-response + 11 个 event，可 1:1 映射到 WebSocket
- **已有 `dist/renderer/` 静态站点**——index.html + renderer.js + CSS，任何 HTTP 服务器可直接 serve

```
手机/远程浏览器
  ↓ 蒲公英 / ngrok / frp 隧道（用户自行配置，DeepOrca 只提供服务方案）
  ↓
DeepOrca 本地服务端（Electron 主进程内置，新增）
  ├── HTTP 静态服务 → serve dist/renderer/（现有 UI，零改动复用）
  ├── WebSocket 服务 → 桥接 window.deeporca API
  │   ├── 81 个 request → 复用现有 ipcMain.handle 逻辑（提取为共享 dispatch table）
  │   └── 11 个 event → 广播给 WS 客户端
  └── SessionBridge → SessionManager（现有，零改动）
```

### 零改动部分

- ❌ 不改 `@deeporca/core`（SessionManager）
- ❌ 不改任何 renderer 组件（50+ React 组件全部复用）
- ❌ 不改 SessionBridge

### 规划中

| 能力             | 集成形态                                                                  | 贡献                                                  | 优先级 |
| ---------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- | ------ |
| WebSocket 服务端 | Electron 主进程内 `ws` 库，提取现有 IPC handler 为共享 dispatch           | 复用 100% 引擎和 UI，远程浏览器获得完整 DeepOrca 体验 | P1     |
| 浏览器端 shim    | 注入 `window.deeporca` 的 `<script>`，通过 WS marshalling 实现 DesktopApi | 浏览器中无缝运行现有 React UI                         | P1     |
| HTTP 静态服务    | 同源 serve `dist/renderer/`（避免 CSP 问题）                              | 远程加载完整前端                                      | P1     |
| 隧道配置文档     | 文档 + 配置引导（蒲公英/ngrok/frp）                                       | 用户一键配置外网访问                                  | P2     |
| 访问鉴权         | WS 连接 token + 可选 HTTPS                                                | 防止未授权访问                                        | P1     |

### 设计原则

1. **DeepOrca 只提供服务端**——隧道/映射/HTTPS 由用户自行配置（蒲公英/ngrok/frp/Cloudflare Tunnel 等）
2. **本地优先**——服务端跑在 Electron 主进程内，不需要独立进程
3. **同源策略**——HTTP 静态服务和 WebSocket 跑在同一端口，避免 CSP 放宽
4. **完整体验**——远程浏览器获得与桌面端完全一致的 UI（因为是同一份 renderer bundle）

---

## 十四、语音双工

> 语音替代键盘输入——实时语音转录填入 Composer，让用户用说话代替打字。

### 规划中

| 能力                     | 方案                                                           | 贡献                                            | 优先级 |
| ------------------------ | -------------------------------------------------------------- | ----------------------------------------------- | ------ |
| 本地实时语音转录（默认） | **whisper.cpp** vendor + whisper-streaming LocalAgreement 策略 | 零外部依赖，CPU 可跑，3.3 秒延迟，74-244MB 模型 | P2     |
| 云端 API 兜底            | OpenAI Audio API / 用户配置的兼容端点                          | 零体积，复用现有 API key，网络依赖              | P3     |

### 本地方案详情（whisper.cpp）

- **引擎**：whisper.cpp（OpenAI Whisper 的 C++ 移植，单二进制，MIT）
- **流式**：whisper-streaming 的 LocalAgreement 自适应延迟策略（3.3 秒延迟，非"录完再转"）
- **模型**：base(74MB) 或 small(244MB)，首次使用时下载或随包分发
- **vendor**：`scripts/vendor-whisper.js`（同 codegraph/openwiki 模式，预编译平台二进制）
- **集成先例**：Ditto（Windows Electron + whisper.cpp + CUDA）、WhisperScript（macOS+Windows Electron GUI）
- **加速**：Apple Silicon CoreML / Windows CUDA / Linux OpenBLAS

### 工作流

```
用户按住快捷键 / 点击麦克风按钮
  ↓
Electron 主进程 spawn whisper.cpp 子进程（vendor 二进制）
  ↓
麦克风音频流 → whisper-streaming LocalAgreement → 实时转录
  ↓
转录文本逐步填入 Composer 输入框
  ↓
用户说完 → 文本作为 prompt 发送给 Agent
```

### 备选方案（不首选）

| 方案                        | 准确率       | 问题                                      |
| --------------------------- | ------------ | ----------------------------------------- |
| NVIDIA Parakeet TDT 0.6B v2 | 业界最高 WER | 需 Python/NeMo，违背零依赖                |
| Superwhisper / Wispr Flow   | 高           | 云端依赖 / macOS 为主 / 付费              |
| OpenAI Audio API            | 高           | 网络依赖 + API key + 付费（但可作为兜底） |

---

## 十五、统一模型网关（最低优先级）

> 内置模型提供能力——让 DeepOrca 自带多提供商路由 + token 压缩，用户不再手动切模型。

### 规划中

| 能力                         | 项目                                                    | 集成形态                     | 贡献                                                                                                                                                                       | 优先级     |
| ---------------------------- | ------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 多提供商路由 + 自动 fallback | **OmniRoute**（diegosouzapw/OmniRoute，35k stars，MIT） | 文档引导（用户自配 baseURL） | 290+ AI 提供商聚合为单一 OpenAI-compatible 端点，19 种路由策略，配额感知自动故障转移。用户将 DeepOrca 的 `baseURL` 指向 OmniRoute `localhost:port/v1` 即获得多模型负载均衡 | P3（最低） |
| Token 压缩管道               | OmniRoute 12 引擎压缩（RTK/Caveman）                    | 文档引导                     | 比当前 LLM 摘要式 compaction 更激进，节省 15-95% token。通过 OmniRoute MCP server 暴露给 Agent                                                                             | P3         |
| OmniRoute MCP Server         | OmniRoute 内置 MCP（stdio/HTTP/SSE）                    | 用户自配 MCP（插件中心添加） | Agent 可调用路由/压缩/记忆工具，自主管理提供商网络                                                                                                                         | P3         |

**为什么是最低优先级**：

- OmniRoute 是独立服务（需要用户自己跑 server），不适合 vendor 进 DeepOrca
- DeepOrca 已有 `createOpenAIClient` + `model-capabilities.ts` 路由层，满足当前需求
- Token 压缩有自研 compaction（L0-L3 记忆管线）
- 仅当用户有多提供商负载均衡需求时才有价值

**集成方式**：纯文档引导，零代码改动

1. 用户 `npm install -g omniroute` + `omniroute start`
2. 在 DeepOrca 设置中将 `baseURL` 指向 `http://localhost:port/v1`
3. 高级用户可将 OmniRoute MCP server 添加到插件中心

---

## 十六、能力编排协议

> DeepOrca 一站化的编排层——让 coding / worker / designer / computer-use 四类能力统一发现、统一调用。
> 借鉴 **OpenWork**（different-ai/openwork，19.2k stars）的双工具 MCP 模型和技能市场理念，不引入其代码。

### 背景

DeepOrca 已有/规划中的能力图谱：

- **Coding Agent**（已实现）——核心引擎，7 个内置工具 + MCP
- **Worker**（部分）——后台进程监控、长任务
- **Designer**（deepdesign + pm-designer）——HTML 设计生成 + A2UI/OpenUI Lang 原型
- **Computer-Use**（规划中）——浏览器/桌面控制（§九）

当前问题：每个能力各自是独立 MCP server，工具列表随能力增多而膨胀（codegraph*explore / a2ui_render_surface / crg_analyze / dart_mcp*… → 50+ 工具平铺给 LLM）。LLM 需要知道所有工具名才能调用，认知负担随工具数线性增长。

### 核心机制：defineAction（一次定义，随处使用）

借鉴 **agent-native**（[BuilderIO/agent-native](https://github.com/BuilderIO/agent-native)，MIT）的核心设计模式。开发者用 `defineAction({schema, run})` 定义一个操作，它自动成为：

- **IPC handler**（桌面 UI 按钮/菜单可触发）
- **MCP tool**（LLM 作为工具调用；同时自动暴露给外部 Agent Plugins 客户端）
- **LLM 内置工具**（核心引擎工具面）
- **未来 HTTP endpoint / CLI 命令**（§十三 远程接入 / headless 场景）

这是 §十六 双工具编排（OpenWork `search_capabilities`+`execute_capability`）的**底层实现机制**——编排层负责"发现与路由"，defineAction 负责"定义一次自动多表面绑定"。也是 §十二 插件组装的便利基础：插件作者定义 action，DeepOrca 自动把它接成 UI 动作 + MCP 工具 + IPC，无需手写三套绑定。

**典型受益场景**：索引模块（codegraph 建索引/查询）与代码审查模块（CRG 风险分析、ocr AI 审查）当前各自是独立 MCP server，工具平铺给 LLM。defineAction 化后，这些能力既可在插件中心 UI 一键触发（带进度可视化），又自动作为 MCP 工具供 agent 调用，还能在未来工作流编排界面里拖拽组合成"索引→查询→审查→修复"管线。

**严守 core 无 UI 铁律**（defineAction 在 DeepOrca 的分层落地，区别于 agent-native 原版的 fullstack 共置）：

```
shared/ipc.ts          schema 类型定义（无运行时，两侧可 bundle）
core (UI-free)          action 的 run 逻辑 + MCP tool 暴露
desktop main            IPC handler 注册（委托 core 的 run）
desktop renderer        UI 按钮/菜单（经 IPC 触发）
```

> agent-native 框架本体不引入（React+Vite+Nitro 全栈与 Electron+core 分层对立），仅吸收两点：① defineAction 模式（如上）；② `application_state`（UI 焦点/选中/导航实时同步供 agent 读取，补全 A2UI 的反向链路——A2UI 当前是 agent→UI，application_state 补 UI→agent，构成完整 parity）。`application_state` 为纯增量（一张 SQLite 表 + IPC 上报 + runtime context 注入），不碰已有 A2UI 代码。
>
> **首批适配模块与详细设计**：defineAction 首先落地于**代码审查**（CRG + ocr，5 个 action）与**知识索引**（codegraph + openwiki + arch-scan，6 个 action）——两模块当前都患"一个功能碎片化到 MCP/IPC/prompt 三种调用机制"的病。完整原语 API、动作清单、三表面映射、迁移阶段见 [`specs/define-action/design.md`](../../specs/define-action/design.md)。关键难点 `arch-scan.run` 需触发 subagent，为 §十 Subagent（P2）提供首个交汇用例。

### 规划中

| 能力                                 | 来源理念                                                     | 集成形态                                             | 贡献                                                                                                                                                                                                           | 优先级 |
| ------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **双工具能力编排 MCP**               | OpenWork `search_capabilities` + `execute_capability`        | 内置 MCP server（InMemoryTransport）                 | 所有能力（skill/MCP/plugin/designer/worker）统一为两个工具入口。LLM 先 `search_capabilities("原型设计")` 发现能力，再 `execute_capability("pm-designer", {action:"render",...})` 调用。工具列表从 50+ 收敛到 2 | **P3** |
| **能力发现 + 语义路由**              | OpenWork capability 分类（skill/context/agent/command/tool） | `deeporca-capabilities` MCP server 内部              | 按用户意图语义匹配能力→自动路由到对应 agent/skill/MCP。coding agent 不需要预先知道所有工具名                                                                                                                   | **P3** |
| **技能/工作流可迁移**                | OpenWork「工作流的 Git」理念                                 | skill export/import（`.deeporca/skill-packs/`）      | 用户创建的工作流（skill 组合 + MCP 配置 + settings 摘要）打包为可分享的 `.orca-pack`，团队成员一键导入                                                                                                         | **P3** |
| **发现文件 + bearer token 进程发现** | OpenWork UI-control 桥的本地发现文件模式                     | `deeporca-control.json`（随机 token，写入 userData） | 比「固定端口」更安全的 sidecar/prototype-window 进程发现方式                                                                                                                                                   | P3     |

### 双工具 MCP 模型设计

```
当前（平铺）：
  LLM ← 50+ tools（codegraph_explore, a2ui_render_surface, crg_analyze, dart_devtools...）

未来（编排）：
  LLM ← 2 tools
    search_capabilities(query) → 返回匹配的能力列表
      [{ id:"pm-designer", name:"原型设计", category:"design", description:"..." },
       { id:"codegraph", name:"代码导航", category:"coding", description:"..." }]
    execute_capability(id, action, params) → 路由到对应能力执行
      execute("pm-designer", "render", { template:"dashboard", params:{...} })
```

### 为什么优先级低（P3，低于 SSH）

1. **当前工具数量可接受**——50+ 工具虽然多，但 DeepSeek 的上下文窗口足够；性能问题要等工具数过百才明显
2. **架构改动面大**——需要重构 session manager 的工具注册和路由逻辑，触及核心引擎
3. **OpenWork 是 OpenCode 套壳**——它的编排层深度绑定 OpenCode 的 subprocess 模型，不是可直接复用的库
4. **SSH/远程接入（§十三）优先级更高**——远程接入是用户直接可感知的能力，能力编排是内部架构优化

### OpenWork 其他可借鉴理念（不单独立项）

| 理念                                      | 来源                                              | 价值                                                                            | 落地方式                                                                      |
| ----------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| UI-control-over-MCP（7 个语义化 UI 工具） | OpenWork `openwork-ui-mcp`                        | 让外部 agent 通过 MCP 语义化控制 DeepOrca 桌面 UI（替代截图点击）               | 独立 MCP server，暴露 `ui_snapshot` / `ui_execute_action` / `ui_list_actions` |
| Fraimz 演示驱动验证                       | OpenWork AGENTS.md                                | frame-by-frame CDP 驱动证明功能可用，替代单元测试覆盖 UI 交互                   | `evals/` 目录 + `npm run fraimz`                                              |
| 扩展贡献清单（extensions manifest）       | OpenWork `docs/extensions-manifest-foundation.md` | 声明式扩展模型（contributions: settings 面板 / composer prompts / side panels） | 未来插件系统的架构参考                                                        |

---

## 十七、密钥保险库

> Agent 持占位符 key，真实凭证加密存储 + 按需注入——借鉴 **OneCLI**（onecli/onecli，2.9k stars）理念，SQLite 重构。

### 背景

当前 DeepOrca 的 API key 明文存储在 `settings.json` 中。Agent 代码（`createOpenAIClient`）直接读取真实 key。安全问题：

1. Agent prompt injection 可能泄露真实 key
2. 日志/debug 输出可能包含 key
3. 明文文件容易被误提交到 git

OneCLI 的核心理念（MITM 代理注入真实凭证）过于重型（Rust + PostgreSQL + Next.js）。但 DeepOrca **控制自己的 HTTP 客户端**——不需要 MITM 代理，只需在应用层增加凭证解析。

### 规划中

| 能力                | 来源理念            | 集成形态                                 | 贡献                                                                                                                                                                         | 优先级 |
| ------------------- | ------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **加密密钥保险库**  | OneCLI secret vault | SQLite 单表（AES-256-GCM）+ 设置面板 tab | API key 从 `settings.json` 明文 → 加密 SQLite vault。Agent 代码持有占位符（`PLACEHOLDER`），`createOpenAIClient` 在请求时从 vault 解密注入真实 key                           | **P2** |
| **凭证注入引擎**    | OneCLI `inject.rs`  | ~200 行 TypeScript                       | 借鉴 OneCLI 的 Injection 枚举（SetHeader / ReplaceHeader / SetParam / SetPath），按密钥类型自动映射（anthropic→`x-api-key`，openai→`Authorization: Bearer`，generic→可配置） | P2     |
| **密钥轮换 + 审计** | OneCLI audit log    | SQLite 审计表                            | 记录每次凭证注入的时间/目标/host，支持密钥过期提醒                                                                                                                           | P3     |

### SQLite Schema（单表核心）

```sql
CREATE TABLE vault_secrets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,              -- "Anthropic API Key"
  type TEXT NOT NULL,              -- "anthropic" | "openai" | "generic"
  encrypted_value TEXT NOT NULL,   -- AES-256-GCM: {iv}:{authTag}:{ciphertext}
  host_pattern TEXT NOT NULL,      -- "api.anthropic.com"
  injection_config TEXT,           -- JSON: {headerName, valueFormat, ...}
  created_at TEXT DEFAULT (datetime('now')),
  rotated_at TEXT
);
```

### 为什么不用 OneCLI 原版

| OneCLI 组件                             | 需要？ | 理由                                        |
| --------------------------------------- | ------ | ------------------------------------------- |
| MITM HTTPS 代理（Rust + CA + 叶子证书） | ❌     | DeepOrca 控制自己的 HTTP 客户端，不需要拦截 |
| PostgreSQL + Prisma                     | ❌     | 单用户桌面应用，SQLite 足够                 |
| Policy Engine（优先级规则）             | ❌     | 单用户不需要多租户策略                      |
| Next.js Dashboard                       | ❌     | DeepOrca 设置面板增加 tab 即可              |
| OAuth App 连接（Gmail/GitHub/Slack）    | 后续   | 先做静态 API key                            |
| 1Password/Bitwarden 集成                | 后续   | 先做本地 vault                              |

### DeepOrca 集成点

```
当前：  settings.json (明文 key) → createOpenAIClient → API
未来：  SQLite vault (加密 key) → createOpenAIClient 凭证解析层 → 注入真实 key → API
                                     ↑ Agent 代码看到的是 PLACEHOLDER
```

---

## 搁置项

> 以下项目经深入分析后**暂时搁置**，不纳入当前规划。

| 项目                          | 搁置理由                                                                                                                                                        | 重新评估条件                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **OpenSpec**                  | Plan Mode 已有成熟的提案→批准→执行流程（含权限强制），OpenSpec 的增量价值（spec 持久化）触及引擎核心改动，风险高                                                | Plan Mode 的 spec 持久化需求明确且迫切时重新评估                                              |
| **Superpowers**               | 执行纪律类 skill（TDD/debug/review）可共存，但规划类（brainstorming/writing-plans）与 Plan Mode 争夺控制权；子 agent 类（subagent-driven）DeepOrca 无 Task 工具 | 引擎加入 Task 工具后，重新评估执行纪律类 skill 的引入                                         |
| **OmniGent**                  | meta-harness 与 DeepOrca 自身 harness 定位冲突，不互补                                                                                                          | 永不采纳（架构层级冲突）                                                                      |
| **Electron 开发套件（自建）** | Electron 无官方 Agent Skills。自建需要实现 MCP/CLI 调试层（操控窗口/IPC/DevTools/进程），工程量巨大——本质上是在造 Electron 专用的 DevTools 自动化层             | 出现社区认可的 Electron Agent Skills 方案，或 DeepOrca 有明确的 Electron 应用调试自动化需求时 |

---

## 超远期规划

> 以下项目经调研确认有价值（协议允许集成），但放在当前所有 P0-P3 之后。前置条件是 DeepOrca 引擎核心能力（Plan Mode DAG / Subagent / 记忆向量 / 路由 / 技能评估）全部落地。

### OpenOPC — AI 原生虚拟公司（独立模块集成）

| 项                   | 说明                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **来源**             | [HKUDS/OpenOPC](https://github.com/HKUDS/OpenOPC)（MIT，Python 3.10+）                                                           |
| **定位**             | 多 Agent 虚拟公司框架：给定目标 → 自动组建团队（AI 员工 + 组织架构）→ 分配任务（看板 + DAG）→ 执行交付 → 从结果学习沉淀          |
| **与 DeepOrca 关系** | 互补产品形态（非替代）。DeepOrca 是单 Agent 编码助手，OpenOPC 是多 Agent 组织编排。集成后 DeepOrca 可从"编码助手"扩展为"AI 公司" |
| **集成方式**         | 独立模块（vendor Python 子进程 + IPC），用户可选择启用。非侵入式 —— 不改动 DeepOrca 核心 Session/Tool 循环                       |
| **前置条件**         | ① Plan Mode 支持依赖 DAG（§十）② Subagent 落地（§十）③ 记忆向量召回上线（§二，✅ 已完成）④ 技能评估闭环建立（§十一 skill-up）    |
| **中短期借鉴**       | 工作项 DAG + 状态机（→ §十 Plan Mode）、结果归因 + 经验沉淀（→ §十一 自进化）、组织架构从目标推导（→ §十六 能力编排）            |
| **调研文档**         | `docs/research/2026-08-07-openopc-research.md`                                                                                   |

---

## 已集成能力清单（完整索引）

> 以下能力已在代码仓库中落地（跨 dev / perf / master 分支）。

| 能力                                      | commit / 分支                         | 功能域       |
| ----------------------------------------- | ------------------------------------- | ------------ |
| codegraph（导航层 MCP）                   | vendored CLI (GitHub Releases 二进制) | 代码智能     |
| CRG（分析层 MCP）                         | `1f5146e` dev                         | 代码智能     |
| ocr（AI 审查）                            | `873f437` dev                         | 代码智能     |
| Serena（符号级代码操作 MCP）              | `abb3f78` perf                        | 代码智能     |
| openwiki（Wiki 生成）                     | vendored CLI (npm 预编译包)           | 知识中心     |
| TencentDB-Agent-Memory（记忆）            | `08308c5` perf                        | 知识中心     |
| activity-frames（多源行为记忆 MCP）       | `ed40428` perf                        | 知识中心     |
| DeepDesign Phase 1（设计生成）            | `127c912` perf                        | 设计生成     |
| Bento Slides（演示文稿）                  | `08308c5` perf                        | 办公套件     |
| browser-skill（浏览器操控）               | 内置插件（需用户安装 bsk）            | 浏览器与联网 |
| web-access-strategy（联网策略 Skill）     | `16c4b2c` perf                        | 浏览器与联网 |
| A2UI PM-Design（原型设计模块 P0-P4）      | `9699fbe`→`0699927` perf              | 设计生成     |
| A2UI 审计第二弹（12 bug 修复）            | v3.14 perf                            | 设计生成     |
| A2UI 对话交互层（P1-P3 富组件）           | `561ba72`→`fed3c67` perf              | 引擎演进     |
| Plan Mode（规划+权限强制）                | 引擎核心                              | 引擎演进     |
| UpdatePlan（进度跟踪）                    | 引擎核心                              | 引擎演进     |
| Electron 43（Chromium 150，零外部依赖）   | `d0ebc79` dev                         | 引擎演进     |
| SkillSpector（AI Skill/MCP 安全扫描）     | `0e1375d` perf                        | 插件中心     |
| 插件中心 7 包分组（skill.plugin.md 重构） | `c8c5b55` perf                        | 插件中心     |
| vendor 镜像兜底                           | `4eb24c0` dev                         | 引擎演进     |
| spawn 修复                                | `04c1585` dev                         | 引擎演进     |

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
>
> - [DeepDesign 内核设计](../../specs/deep-design/design.md)
> - [前期集成调研（5 项目）](../research/2026-07-open-source-integration-feasibility.md)
> - [OCR 集成 & Understand-Anything 分析](../research/2026-07-ocr-integration-and-ua-analysis.md)
