# 预研：HKUDS/DeepCode —— 从 Paper2Code 论文原型到通用 Coding Agent Harness 的全景

日期：2026-09-03 · 分支：`feat/modern-ui-redesign` · 性质：预研（无代码变更）

## 命名澄清（先读这个）

**HKUDS/DeepCode ≠ 本仓遗留的 `.deepcode` 前身。** 本仓（deepOrca）历史上有过
`.deepcode/` 配置目录与 `deepcode-cli`（skills 发现至今保留 legacy
`./.deepcode/skills/` 回退路径，见 AGENTS.md）；HKUDS 的 DeepCode 是 HKU 数据智能
实验室（HKUDS，LightRAG/AutoAgent 同门）的独立项目，恰好同名。两者的实际交叠见
§2.5。

## 命题映射

| 模块线 | 仓库 | 在本线中的角色 |
| --- | --- | --- |
| Agent harness 对照线 | HKUDS/DeepCode | 同类产品全景对标：session loop / 权限 / MCP / skills / 子代理 / compaction / 持久化 / 桌面契约，逐维与本仓对位 |
| dsh 线交叉验证 | 同上 | **DeepCode 显式以 dsh 为设置 UX 对齐对象**（`docs/DESKTOP_SETTINGS_DSH_ALIGNMENT_PLAN.md`），且其 compaction 实现与本仓 dsh-consolidated 候选池 P1-2 同向——构成 dsh 之外第二个独立实现验证 |

调研材料：`README.md` 全文（含 2026-07~08 全部 News）、`docs/P2_AGENT_EXECUTION_ARCHITECTURE.md` 与 `docs/P5_PAPER2CODE_ARCHITECTURE.md` 全文、`docs/archive/README_LEGACY_2026-07-20.md`（论文期架构 + PaperBench 数据）、`docs/DESKTOP_SETTINGS_DSH_ALIGNMENT_PLAN.md` 全文、`pyproject.toml`、`core/version.py`、`LICENSE`、仓库目录结构（zread 一手核证）；GitHub API（stars/forks/活跃度）；arXiv 2512.07921 元数据。本仓侧依据 AGENTS.md 与既有调研台账（dsh-consolidated、mcp-sdk-migration、pi-sdk 作废案），关键对位结论锚定 file:line 或台账条目。

## TL;DR

| 项目 | 本质 | 成熟度 / 许可 | 建议继承方式 | 集成深度 | 与现有冲突 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| HKUDS/DeepCode | 已完成两次变形：①论文期（2025）Paper2Code 多代理复现管线（PaperBench 自报 SOTA）；②v2.0 起（2026-08-03）通用 coding agent harness——一个 Python Agent runtime、CLI TUI + Tauri 桌面双接口、JSON-RPC App Server、Loop Engineering（持久 Goal）、自动化调度、MCP 全传输、Skills/Plugins 生态 | 高活跃：16,473★ / 2,151 forks（2026-09-03 API），v2.1.0（`core/version.py`），最后 push 2026-08-28，pytest 基线 324+；**MIT**（LICENSE 本体核证，版权归 Data Intelligence Lab@HKU） | 模式与机制移植为主（Python 内核不可直接复用）；desktop/ 为 React+TS，UI/交互模式可参考；**无许可红线**，理论上可 vendor（MIT 保留版权声明即可） | **L0 为主 + 选择性 L3 模式移植**（compaction 两段式、每回合冻结安全 profile、MCP HTTP+OAuth、会话投影分离） | 技术栈错位（Python/Rust/Tauri vs TS/Electron）；功能面大量重叠属同类竞品而非互补件 | **重点对标 + 候选机制清单**：它不是"再调研一个外部项目"，而是与本仓同赛道的开源 harness 全景参照系；最有价值单条是其 compaction 两段式实现——与本仓 dsh 台账候选池 P1-2 独立同向 |

集成深度定义（沿用 2026-08-17 prestudy）：L0 = 知识/提示词层；L1 = 用户可选外挂；
L2 = 内置 builtin；L3 = 源码级继承（移植模式或引纯函数库）。

**许可结论（一条过）**：MIT，无传染、无 vendoring 障碍——与本仓多数外部调研
（llm_wiki GPL-3.0、MemBrain 无 LICENSE、motionsites 付费导出）相比是干净的一档。
但 Python 内核（core/）对本仓技术栈无直接复用价值；`desktop/src/`（React+TS，MIT）
与 `protocol/app-server.schema.json`（schema→TS 契约生成）是仅有的两块"代码级"
可参考物，仍建议只借鉴模式不搬代码——搬的成本在于其对 JSON-RPC/SQLite 的深度耦合。

---

# Part I DeepCode 是什么

## 1.1 基本盘

| 维度 | 事实（一手核证） |
| --- | --- |
| 出品方 | HKU Data Intelligence Lab（HKUDS）；论文作者 Zongwei Li 等 4 人 |
| 论文 | arXiv 2512.07921《DeepCode: Open Agentic Coding》（2025-12-08） |
| 版本 | v2.1.0（`core/version.py`）；PyPI 包名 `deepcode-hku`；Python ≥ 3.12 |
| 热度 | 16,473★ / 2,151 forks；2025-08 曾连日 GitHub trending（#1 Python of the day） |
| 活跃度 | 最后 push 2026-08-28；News 周更节奏（2026-08 内 6 条），维护密度高 |
| 结构 | Python 内核（`core/` 24 个子系统）+ `cli/`（TUI 与 exec/loop/goal/mcp/plugin/provider/schedule/session/skill 九个子命令）+ `desktop/`（Tauri 2 + React + Python sidecar）+ `app_server/`（stdio JSON-RPC）+ `eval/swebench` + `tests/`（约 150 文件，基线 324 用例） |
| 文档 | `docs/P1~P6` 分阶段架构文档（P1 内核协议 → P2 Agent 执行 → P3 桌面 runtime → P4 Code Workbench → P5 Paper2Code → P6 会话对齐复查）+ 专题（安全基线/隐私/无头自动化/本地插件/Skills 产品架构/自动化架构） |

## 1.2 两个 DeepCode：研究期与产品期

**研究期（2025-05 创建 ~ 2026-07-20 前）**：Paper2Code 多代理管线——中央编排、
意图理解、文档解析、代码规划、参考挖掘、代码索引、代码生成七个 agent，工具全部经
MCP（filesystem/fetch/github-downloader/file-downloader/command-executor/
code-implementation/code-reference-indexer/document-segmentation 八个 server）。
2025-10-28 自报 PaperBench Code-Dev SOTA：75.9% vs 顶尖 ML 博士 72.4%、84.8% vs
最强商业 agent（Claude Code 58.7%）+26.1pp、73.5% vs PaperCoder +22.4pp。注意：
这些数字描述的是**重构前的旧架构**，对 v2.x 现架构不构成背书（自报口径，且 eval
目录现仅存 swebench harness）。

**产品期（2026-07-04 起 P0~P6 重构，2026-08-03 宣发 v2.0）**：定位从"论文复现
工具"转为通用 coding agent，Paper2Code 降级为其专设工作流之一（P5）。重构主线：
统一 agent 内核 → 权限/沙箱 → 持久会话 → Loop Engineering/并行 agent → Goals →
团队/桌面 → Skills/MCP/设置 → compaction/子代理/严格完成。

## 1.3 v2.x 形态：一个 runtime、两个接口、一条协议

```text
交互 CLI（TUI）──┐
                 ├──> build_agent_session() ──> AgentSession ──> AgentRunner/tools/provider
桌面（Tauri 2）──┘         │                        │
  └─ JSON-RPC ─> TurnService/ApprovalService ─────┤
                           │                      ▼
                           ▼              规范 SessionStore JSONL（跨接口唯一真源）
                    SQLite 投影（Items/事件日志，可重建）
```

- **规范态与投影态分离**（P2）：会话身份与可见对话以 canonical JSONL 为唯一真源；
  SQLite Items + 事件日志是"可丢弃、可重建"的桌面执行投影，实时交付溢出时客户端
  走 `event/replay` + `turn/read` 恢复。崩溃恢复只修投影、从不自动重放副作用。
- **每回合快照**：回合准入时在一个 `BEGIN IMMEDIATE` 事务里解析出不可变的
  `ExecutionSecurityProfile`（权限档/沙箱/环境），执行中改设置只影响新回合；
  resume/worker 交接后已录回合行为不变。
- **审批状态机**：权限引擎返回 ask 时回合转 `waiting_approval`，ApprovalService
  在 asyncio Future 上挂起**那个确切的工具调用**，`approved_once/approved_session/
  denied` 三态在同一事务内落盘并唤醒；会话级授权按 Thread+工具名限域。
- **并发与清理**：跨 Thread 默认 2 个并发回合的有界信号量；shell/代码进程按进程组
  归属（Windows 用 Job Object + `taskkill /T /F`），超时/取消/退出一并收割。
- **流式超时策略**：非流式 300s 墙钟；流式改用 90s 空闲窗（每个 provider 事件续期），
  活跃流默认无总时长上限——长推理不会被"活得太久"误杀，真卡死才进重试。

## 1.4 值得记录的机制细节（按本仓相关度排序）

**① Compaction 两段式（最有价值单条）**（README News 2026-08-14）
上下文吃紧时：先做**免费的收敛式中段修剪**——把过大的工具结果中段剪掉（覆盖 MCP
与自定义工具），不够再做 LLM 摘要；摘要请求**按原请求前缀重放**以命中 provider
prompt 缓存；**不会收缩对话长度的摘要直接拒收**。另配 `/compact` 手动档，每次拒绝
都给稳定可读的原因（busy Turn/历史太少/摘要失败或不收缩）。
→ 与本仓 dsh-consolidated 候选池 **P1-2 两段式 compaction + 前缀守恒收尾包** 几乎
逐条同向（本仓现状：中 2/3 整体摘要，无工具结果修剪、无缓存复用、无收缩校验）。
DeepCode 是继 dsh 之后第二个独立实现者，交叉验证了该路线的工程可行性。

**② MCP：三传输 + OAuth + 预置目录**（News 2026-08-10/08-12）
stdio/SSE/Streamable HTTP 统一客户端运行时（有界发现、稳定 `mcp__server__tool`
身份、超时、取消、会话级生命周期）；浏览器 OAuth 用 loopback 回调 + 配置外的私有
凭据文件；内置基于 Nanobot 16 模板的**已审目录**——添加只是复制一份**默认禁用**
的普通配置，绝不隐式跑 `npx`/Docker/远程 server；`test` 做真实握手探活（初始化并
清点 tools/resources/prompts）；MCP 策略**只能收窄**全局信任/只读/审批/沙箱决策。
→ 本仓 mcp-sdk-migration 遗留的"HTTP transport 未兑现、远程 MCP 不可配"（research
README 遗留待办 #9）在此获得完整参照实现，OAuth 与目录形态是增量参考。

**③ 权限与安全**（P2 + legacy News 2026-07-04）
项目先信任后执行（每接口一致）；会话三档 `ask / read_only / full_access` + 工具级
`allow/ask/deny`；full_access 走三重确认链（桌面确认 → dispatcher riskAcknowledged
→ 冻结快照）且显式 deny 仍最高优先；凭据拒绝清单（`.ssh`/`.aws/credentials`/
`.env`/`*.pem`…）不可覆盖；命令沙箱按平台（macOS seatbelt / Linux bubblewrap /
Windows Job Object）；前端从不直接授权工具——Python 后端是唯一执法边界。
→ 对照本仓 `common/permissions.ts` 的 computeToolCallPermissions + Plan Mode
force-ask：本仓缺"每回合冻结 profile"与平台沙箱两件。

**④ Skills：运行时契约**（News 2026-08-04~08-09）
发现仍走 `.agents/skills`（项目/用户）+ 兼容读 `.deepcode/skills` 与 Claude 式目录；
增量在三处：技能可声明**工具/技能依赖**，按序展开、检环、首个模型请求前失败；
**渐进式读取**有界包资源（revision/穿越/符号链接/尺寸四重检查）；技能**只能收窄**
会话已有工具面、不能授新权限；每个 Turn 快照只持久化技能身份/调用种类/revision。
另捆绑 8 个 pin 版、来源可溯的上游技能（OpenAI/Codex/Anthropic 出品）。
→ 本仓 skills 发现路径与其同源（Agent Skills 方言），但无依赖展开、无渐进读取、
无"只收不放"的权限语义；本仓领先点在语义路由（G1-G3 短名单/compose）。

**⑤ 子代理：原生 + 外部 CLI 后端**（News 2026-08-14）
原生子代理带 persona、校验过的工具白名单、JSON 输出 schema、`send_message` 后续
对话、父会话完整转录；**外部后端**把已安装的 Codex / Claude Code CLI 当子代理跑
（scrubbed 环境 + 严格成功判据）。
→ 本仓 2026-08-17 作废了 pi-sdk 外部运行时线（自有 RegistryHost.runSubagent 已满足）；
DeepCode 证明的是更便宜的一条路——"spawn 外部成熟 CLI"，正好对应 dsh-consolidated
里 C1"借生态"残值的可行形态。

**⑥ Goal Loop Engineering + 证据驱动完成**（README 核心章节）
自然语言 Goal 跨回合/跨进程持续（理解→实现→验证→修复循环），运行中可追加信息、
改目标、排队、暂停、恢复；完成判据**按任务选证据**（测试/构建/静态检查/诊断/diff/
Artifact），失败验证不伪装成功而是转入下一轮修复；Goal 引擎不固定 provider/模型/
任务类型/测试命令，由工作 Agent 从完整上下文请求 `complete` 或 `blocked`。
→ 与本仓 task-tree（面向人的任务轨迹）定位不同：DeepCode 的 Goal 是面向执行闭环
的驱动器，近似本仓 task-tree P3（branch=subagent 载体）想要承载的东西。

**⑦ Automations**：受信项目指令 → 手动/定时间隔执行，复用同一 Agent/会话/权限/
审批/恢复与运行历史（非阉割版第二 runtime）。本仓无对应物。

**⑧ 持久化与配置**
会话：JSONL + SQLite 索引（列目录/resume 即时）；配置：用户层 `~/.deepcode/
deepcode_config.json` + 项目层 override——**项目层只能选用连接，不能改写端点/
adapter/headers/凭据**（防仓库劫持用户 key 路由）；写配置带 `configRevision` 乐观
并发（外部变更冲突而非静默覆盖）+ `settings.changed` 推送；诊断逐叶报告提供层。
凭据独立 0600 `credentials.json`，永不进会话历史、永不经协议返回。

**⑨ P5 Paper2Code（专设工作流）**
持久工作流状态机（queued→running→waiting→completed/failed/cancelled，SQLite v2）；
计划审批持久化进 checkpoint、只接受匹配的活跃交互 ID（迟到进度清不掉审批门）；
**严格完成**：桌面运行只认白名单测试命令（有 pytest 布局→`python3 -m pytest -q`、
有真实 test script→`npm test`、有 Cargo.toml→`cargo test`），至少一条发现且全过才
算完成；Artifact 围栏（workspace 相对路径、symlink 解析出界即丢弃、文本预览上限
128 KiB）；URL 摄取 SSRF 全防线（仅 HTTP(S)、拒凭据/私有 IP/保留段、逐跳校验、
100 MiB 上限、`.part` 文件落盘）；文档转换基线（pypdf + 有界标准库读 HTML/DOCX，
Docling 仅显式 extra）。

**⑩ 桌面与契约**
Tauri 2 + React；`protocol/app-server.schema.json` 是桌面 TS 契约的**唯一生成源**
（`check:protocol` 门禁）；stdout 专供 JSON-RPC（legacy `print()` 全量改道 stderr，
防诊断污染协议流）；设置对话框显式对齐 dsh 设计（左栏 General/Models/Plugins/
Agent presets 五行制），并写下 6 条"与 dsh 的刻意分歧"（如保留自己的审批语义命名、
凭据主库不学 dsh 的 env 派生）——是一份完整的"借鉴但不说谎"决策记录。8 主题含
WCAG AAA 高对比档，主题测试对全套 token 断言；全局 rem 缩放（一次修掉 255 处硬编码
像素）。

## 1.5 与 dsh 的关系（对本仓的旁证）

`DESKTOP_SETTINGS_DSH_ALIGNMENT_PLAN.md` 直接研读 dsh 源码（`packages/settings/*`、
`packages/client/ui-settings*`、`packages/llm/llm-pi-ai`）后落地了设置 UX 对齐，且
News 明确"dsh 的 deepseek-harness Skill 从 `.agents/skills` 原样加载"。三方关系：
dsh（DeepSeek 系 harness，本仓 2026-08-14 deep-dive + consolidated 台账）→
DeepCode 吸收其设置/模型声明/compaction 思路 → 本仓与 DeepCode 在 dsh 的候选池上
**独立趋同**。这把本仓 dsh 台账候选排序（P1-2 两段式 compaction 等）从"单源判断"
升级为"有第二实现者背书的方向"。

---

# Part II 对照本仓现状

## 2.1 能力对位表

| 能力维度 | DeepCode v2.1 | 本仓现状 | 差距判断 |
| --- | --- | --- | --- |
| LLM 循环 | AgentRunner + 工具超时 + 重复调用升级提醒 + 循环检测 | `core/session.ts` activateSession 循环 + ToolExecutor | 同构；其"重复调用升级提醒"本仓无 |
| Compaction | 两段式：工具结果中段修剪 → 前缀重放摘要 → 拒绝不收缩 | 中 2/3 非系统消息整体摘要（`session.ts`，PRE_COMPACT_RATIO 预检） | **本仓落后**，恰为 dsh 台账 P1-2 候选 |
| Token 记账 | —（未见本地 BPE 记账） | usage-ledger JSONL + 家庭路由精确计数（2026-09 重构） | **本仓领先** |
| 权限 | 项目信任 + 三档 + 工具三值 + 冻结安全 profile + 凭据拒绝清单 + 平台沙箱 | computeToolCallPermissions + Plan Mode force-ask + IPC 根钉死 | 互有胜负；缺冻结快照与沙箱 |
| MCP | stdio/SSE/HTTP + OAuth + 目录（默认禁用）+ 策略只收不放 | stdio（MCP SDK 已迁）；HTTP 未兑现（遗留 #9） | **本仓落后一项已排期项**，OAuth/目录为增量 |
| Skills | Agent Skills 方言 + 依赖展开 + 渐进读取 + 只收不放 + 插件打包（1.0.0 manifest） | 同源发现路径 + 语义路由（G1-G3）+ skill-up CI | 互有胜负；本仓缺依赖展开/渐进读取，领先路由 |
| 子代理 | 原生（persona/schema/后续对话）+ 外部 Codex/Claude Code CLI | RegistryHost.runSubagent + defineAction 生态 | 本仓自有线已满足；外部 CLI 路线对应 dsh C1 残值 |
| 并行隔离 | Team：多 worker 各占 git worktree，冲突显式呈现 | 无（in-process-multi-driver spec 另有设计） | 观察项，不新增路线 |
| 任务闭环 | Goal 持久驱动 + 证据驱动完成 + 可转向/暂停/恢复 | task-tree（面向人）+ review 模块 | 定位不同；Goal=面向执行的近亲 |
| 定时自动化 | Automations（同 runtime 定时运行 + 历史） | 无 | roadmap 候选 |
| 会话持久化 | canonical JSONL + 可重建 SQLite 投影 + 事件回放 + 崩溃恢复不重放副作用 | sessions JSONL + sessions-index（250ms debounce，曾出 read-stale 事故）| 投影/真源分离是结构性参考 |
| 桌面契约 | schema 单一来源生成 TS 契约 + check:protocol 门禁 | `shared/ipc.ts` 手工双端同步 | 生成式契约是改进方向参考 |
| 桌面技术栈 | Tauri 2 + React + Python sidecar | Electron + React + main/tools vendor 体系 | 不可比，不跟进 |
| 语义路由 | 无（全量候选） | G1/G2/G3 + Granite 嵌入 | **本仓独有优势** |
| 记忆 | 会话级 persistent notes | L0-L3 TDAI 管线（@deeporca/memory） | **本仓领先** |
| 论文复现 | Paper2Code 专设工作流（P5，严格完成 + 审批门） | 无 | 非本仓定位，观察即可 |

## 2.2 可借鉴候选清单（⚠️ 调研仅供参考，实现一律以 specs/ 为准）

按价值排序，均标注集成深度：

1. **L3｜compaction 两段式收尾包**（对应 dsh-consolidated P1-2 + 前缀守恒收尾包）：
   工具结果中段修剪先行（免费收敛、覆盖 MCP 工具）→ 摘要请求按路由前缀重放以命中
   prompt 缓存 → 不收缩的摘要拒收。DeepCode 的落地细节（拒绝原因稳定化、canonical
   数据不动）可直接当设计评审材料。建议回写进 dsh 台账作第二实现者论据。
2. **L3｜MCP HTTP transport + OAuth**（遗留待办 #9 的参照）：Streamable HTTP 客户端
   形态、loopback OAuth + 配置外私有凭据、"预置目录默认禁用、显式测试后才启用"的
   安全姿态。
3. **L3｜每回合冻结 ExecutionSecurityProfile**：回合准入事务内解析不可变安全快照，
   设置变更只影响新回合；本仓 IPC 动作/权限判定可引入同类"已录回合不可漂移"语义。
4. **L2/L3｜会话投影/真源分离**：桌面重活（Items、事件日志）作可重建投影，canonical
   JSONL 唯一真源 + 事件回放兜底——本仓 sessions-index pendingIndex 事故（AGENTS.md
   §7）的结构性解法参考。
5. **L0/L1｜配置层两规则**：项目层不得改写端点/凭据（防仓库劫持 key 路由）；配置写
   乐观并发 + 变更推送。
6. **L0｜Skills 增强三件**：依赖展开（检环、请求前失败）、渐进读取（四重路径检查）、
   "技能只能收窄工具面"的权限语义。
7. **L1｜外部 CLI 子代理后端**：spawn Codex/Claude Code（scrubbed env + 严格成功
   判据）——若 dsh C1"借生态"残值将来重启，这是已被验证的最低成本形态。
8. **L0｜重复调用升级提醒**：相同工具调用重复时注入模型可见的逐级提醒（本仓循环
   检测的轻量互补）。
9. **观察项｜Goal 执行闭环 / Automations / Team worktree**：分别对应本仓 task-tree
   P3、roadmap 空白、in-process-multi-driver spec——均不新增路线，先留档。

## 2.3 不建议跟进的部分

- **Tauri 迁移**：本仓 Electron 与 main/tools vendor 体系（13 个 vendor 脚本、
  offscreen Chromium、IPC 根钉死）深度绑定，零收益重构。
- **Python 内核整体吸纳**：技术栈错位；本仓 TS 原生化路线（specs/ts-native-migration）
  已定，反向引 Python 运行时与其冲突。
- **Paper2Code 全流程**：与本仓"编码 agent harness"定位不同，且其严格完成机制
  （白名单测试命令）绑定 Python/npm/cargo 生态假设；若未来要论文复现能力，P5 的
  "计划审批门 + 严格完成"两件可单独再调研。
- **同质功能面跟风补齐**：DeepCode 的宽功能面（自动化/团队/插件市场姿态）是独立
  产品路线的产物；本仓资源应继续服从 coord-chain 优先级约定（资源冲突时 OC 优先）。

## 2.4 风险与注意事项

- **数据自报口径**：PaperBench 数字属重构前旧架构 + 论文方自报，不能当 v2.x 现状
  引用；swebench eval 目录自备，外部复现报告未见。
- **迭代速度**：News 周更、2026-08-28 后仍在动，本文快照截至 v2.1.0（2026-09-03
  API 口径）；引用其机制细节前建议复核 commit。
- **测试基线数字**（pytest 324）出自 dsh 对齐文档行文时点，仅作成熟度旁证。

## 2.5 同名共存注意（小但实际）

DeepCode 的用户主目录是 `~/.deepcode/`（`DEEPCODE_HOME` 可迁），且**兼容读取**
`.deepcode/skills` 项目技能目录——与本仓 legacy 路径（`./.deepcode/skills/`、
`~/.deepcode/skills/`）正面交叠。同一机器/同一项目共存两工具时：技能目录互认是
良性的（同为 SKILL.md 方言），但 `~/.deepcode/` 下 DeepCode 的 sessions/credentials
与本仓 legacy 技能目录混居理论上可能；本仓无现状风险（已迁移 `.deeporca/`），仅
在文档/支持场景知悉即可。

---

## 结论

DeepCode 是本仓赛道上**完成度最高的开源同类**：它验证了"论文原型 → 通用 harness"
的整条变形路径（本仓 coordination/task-tree/review 各线的产品化终局形态参照），
并且与 dsh 形成了对本仓候选池的独立交叉验证。建议动作只有一件实事：**把 §2.2 第 1
条（compaction 两段式 + 前缀重放 + 收缩校验）回写进 dsh-consolidated 台账 P1-2 的
论据链**（标注第二实现者）；其余条目留作候选池与 roadmap 参照，不另立 spec、不
启动任何代码线。许可证 MIT 干净，将来任一条目落地时无合规障碍。
