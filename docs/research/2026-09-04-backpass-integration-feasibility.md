# 预研：backpass —— Agent 记忆的“梯度下降”外部伴生工具

日期：2026-09-04 · 分支：`feat/modern-ui-redesign` · 性质：预研（无代码变更）

> 总口径遵循 docs/research/README：**调研仅供参考，不列入正式实现**；界定
> DeepOrca 是否支持 backpass、以及何时支持，一律以 `specs/` 与用户决策为准。

## 命题映射

| 模块线 | 仓库 | 在本线中的角色 |
| --- | --- | --- |
| 外部伴生工具评估 | `kunchenguid/backpass` | 本地优先的“Agent 记忆优化”CLI：把 `AGENTS.md`/`CLAUDE.md` 与项目 skills 视为记忆权重，扫描本机 Agent 会话记录，提取反复出现的失败/缺失规则，生成带证据的增删改建议，由用户逐项接受或拒绝 |
| DeepOrca 对照线 | 本仓 | 判断 backpass 与 `@deeporca/core` 的边界：是否必须集成、集成能带来哪些便利、如何在不破坏现有 IPC/permission/vendor 边界的前提下接入 |

调研材料：`backpass` README 全文（含 privacy/Local-first）、`VISION.md`、`package.json`、
`LICENSE`、`CHANGELOG.md`、`RELEASING.md`、`src/` 关键模块（discovery/index、adapters、
distill、fold、gap-ledger、synthesize、workspace、diff、proposal、apply/writer、
acpx、agents、harness-invoke、redact）、GitHub API（stars/forks/releases/workflows）、
npm registry（`latest`）。本仓侧依据 AGENTS.md 与既有调研台账（mcp-sdk-migration、
2026-07-open-source-integration-feasibility、2026-08-17-external-repos-prestudy）。

## TL;DR

| 项目 | 本质 | 成熟度 / 许可 | 建议继承方式 | 集成深度 | 与现有冲突 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| backpass | 本地优先的 Agent 记忆审计 CLI：可扫描 Claude/Codex/Pi/OpenCode/Grok/Cursor CLI/Hermes 七类会话，经 `acpx` 调用用户已认证的 Agent harness 做分析/合成，产出带证据的 proposal，再由用户逐项接受/拒绝后原子写回 | 非常新且迭代快：2026-08-21 创建，0.1.1→0.1.17 约一周连发；GitHub 706★ / 48 forks（2026-09-04 查询）；**MIT**（LICENSE 本体核证，© 2026 Kun Chen） | **不直接嵌入 core**；作为用户可选的外部记忆审计伴生 CLI，优先以受控子进程 sidecar 形态联动，仅读取 `scan/status/analyze/propose --json` 结果，**不自动执行 `apply`** | **L0/L1 为主**（L0=不集成/知识层；L1=用户可选外挂，Electron main 受控 spawn）；仅当明确需要桌面托管/离线交付/应用内审核时才考虑 L3 源码级整合 | 技术栈同向但职责重复：backpass 外挂 `acpx`+外部 harness，与 DeepOrca 自有 SessionManager/routing/token 记账完全两套，不能共用状态；**DeepOrca 自有 session 格式不在 backpass 支持列表** | **不必须集成。** 价值明确但属“可选伴生”而非引擎依赖：能带来记忆规则质量反馈与跨会话证据聚合，却同时引入外部 Agent harness 与模型数据处理成本。若验证价值，走固定版本、main-process 受控 CLI sidecar 的 L1+L2 只读路径，未来如需学习 DeepOrca 自有会话，优先向上游贡献正式 transcript adapter |

集成深度定义（沿用 2026-08-17 prestudy）：L0 = 知识/提示词层；L1 = 用户可选外挂；
L2 = 内置 builtin；L3 = 源码级继承（移植模式或引纯函数库）。

**许可结论（一条过）**：backpass 本体 MIT，零运行时 npm `dependencies`，可
vendor/分发，无传染与合规障碍。但运行并非自包含：必须存在 `acpx` 在 PATH、
至少一个受支持且已登录的 Agent harness 能提供目标模型，浏览器审核模式还依赖
`lavish-axi`；这些外部依赖与模型提供商各自的许可/数据处理政策需另行核实。

---

# Part I backpass 是什么

## 1.1 基本盘

| 维度 | 事实（一手核证） |
| --- | --- |
| 定位 | “Gradient descent for your agent memory” —— 让 memory 文件根据真实会话中的问题持续改进，而不是靠开发者手工回忆 |
| 版本 | npm `backpass` latest = 0.1.16（`gitHead b8942cd` 对应 v0.1.16）；GitHub release/tag 已有 `backpass-v0.1.17`，GitHub `package.json` 为 0.1.17 —— **npm 与 GitHub 存在版本发布不同步，接入前必须实际执行 `backpass --version` 并核对 tarball/provenance** |
| 热度 | 706★ / 48 forks（2026-09-04 GitHub API）；open issues 21 |
| 活跃度 | 创建 2026-08-21，main 分支最后 push 2026-09-03；release-please + GitHub Actions + npm OIDC/trusted publishing + `--provenance` |
| 技术栈 | JavaScript ESM-only；TypeScript 仅用于 `checkJs` 类型校验；Node ≥ 22.5.0；npm `dependencies` 为空；开发依赖 eslint/prettier/ts/@types/node；包管理器 pnpm 11.5.0 |
| 状态目录 | 仓库级 `.backpassrc.json` + `.backpass/`（scan-cache/evidence/evidence-summary/proposal/synthesis/prompts/agent-probe-cache/rejections/gap-ledger/apply/apply.html），通过 `.git/info/exclude` 排除，不默认改 `.gitignore` |
| 默认关键参数 | always-loaded 预算 5000 est.tokens；transcript 上限 100；gap 佐证需 2 个独立 session；分析并发 4；analysis effort medium；synthesis effort high；时间窗 30d；gap ledger 保留 90d |

## 1.2 完整流程

```text
发现会话(discover transcripts)
→ 确定性关联到当前 Git 仓库(association 4 级)
→ 本地压缩/脱敏 transcript(distill + redact)
→ 每个 transcript 一次低成本分析(analyze，经 acpx 调用已认证 harness)
→ 聚合证据与 gap(fold + consolidate + gap-ledger)
→ 高推理模型生成 staging 修改(synthesize，仅可编辑 .backpass/synthesis/ 副本)
→ 生成带证据的 proposal(proposal.js)
→ 用户逐项接受/拒绝(浏览器 review 或 --no-ui 终端)
→ 原子写回 memory/skill 文件(apply/writer.js，写回前校验 freshness，单文件多 edit 全有或全无)
```

主要安全与质量约束（源码实证）：

- 每条证据必须含 transcript 原文引用（`sanitizeEvidence`）。
- 新指令默认需 ≥2 个独立 session 佐证；删除已有指令需多个会话中的 `harm` 证据，单纯不遵守规则不支持删除。
- 单次默认最多 5 个 edit，预算超限时采用收缩计划。
- 分析阶段不写仓库；synthesis Agent 只能编辑 staging 副本；`apply` 是正常流程中唯一写回用户文件的命令。
- 接受/拒绝结果持久化（`rejections.json`），避免同一建议反复出现。
- 写回前检查 memory 与目标 skill 文件是否仍与 proposal 时一致。

## 1.3 支持的 transcript 来源（七类 harness）

| Harness | 本地存储 |
| --- | --- |
| Claude | `~/.claude/projects/<munged-cwd>/*.jsonl` |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| Pi | 独立 Pi 与 BB-managed Pi JSONL |
| OpenCode | `~/.local/share/opencode/opencode.db` |
| Grok | `~/.grok/sessions/...` |
| Cursor CLI | `~/.cursor/chats/...`（opt-in/preview，非默认稳定能力） |
| Hermes | `~/.hermes/state.db` |

关联当前仓库的关联策略共四级（当前仓库 worktree / sibling clone 共享 remote /
transcript 记录的 remote / best-effort 目录名）；`--strict` 排除第四级 best-effort。

## 1.4 安装与命令

官方推荐 `npm install -g backpass` 或 `npx backpass`。典型流程：

```text
cd your-repo
backpass init     # 创建 .backpassrc.json，.backpass/ 入本地 Git exclude
backpass          # 完整 backward pass，正常情况下不写已有 memory 文件
backpass apply    # 浏览器/终端逐项审核并写回
```

常用命令：`scan`（只发现/关联 transcripts）、`analyze`（逐会话证据）、`propose`
（聚合证据生成 proposal）、`apply`（写回）、`status`（预算/缓存/证据/proposal）、
`init`。CLI 参数含 `--json`、`--since`、`--harness`、`--strict`、`--budget`、
`--max-edits`、`--max-transcripts`、`--memory-file`、`--skills-dir`、
`--analysis-/--synthesis-agent/model/effort`、`--dry-run`、`--no-ui`、`--no-open`、
`--force`。（详见上游 README / bin/backpass.js）

---

# Part II 对照本仓现状

## 2.1 能力对位表

| 能力维度 | backpass | 本仓现状 | 差距判断 |
| --- | --- | --- | --- |
| 记忆文件 | 默认 `AGENTS.md`/`CLAUDE.md` + 项目 skills，把 memory 当作“权重”迭代 | 使用 `AGENTS.md`、skills（`.deeporca/skills`、`.agents/skills` 等扫描路径），概念同源 | **目标文件高度匹配**；但 backpass 面向“跨会话记忆审计”，本仓 L0–L3 记忆管线（`@deeporca/memory`，TDAI Core）是运行时记忆，两者不互斥 |
| 会话来源 | 仅 Claude/Codex/Pi/OpenCode/Grok/Cursor CLI/Hermes 七类外部 harness | DeepOrca 自有 sessions 存于 `~/.deeporca/projects/<code>/sessions/*.jsonl` | **backpass 不能直接读 DeepOrca 会话**：它没有自定义 transcript 根或 adapter 配置；仅靠把 backpass 跑在本仓根目录不会自动看到 DeepOrca 历史 |
| 模型调用 | 经 `acpx` 探测并调用用户已认证的外部 Agent harness；两段模型（analysis=便宜/逐会话、synthesis=高推理） | 自有 SessionManager + 模型路由 + usage-ledger 本地记账（2026-09 重构） | **职责重复，不能共用状态**：两套模型选择/effort/usage 恢复逻辑各自独立 |
| 输出契约 | `--json` 输出、`status`/`scan`/`analyze`/`propose` 机器可读 | MCP 工具集与 `defineAction` 生态 | 适合以受控子进程 sidecar 读取，不适合直接 import 内部模块（无 `exports`、无稳定 JS API） |
| 写文件安全 | 分析不写仓库；synthesis 仅在 staging 副本；`apply` 前 freshness 校验；单文件多 edit 原子写 | 自有 permission 系统 + Plan Mode force-ask + IPC 根钉死 | **backpass 的 ACCEPT/REJECT 不是 DeepOrca 原生权限流程**，不能绕过 DeepOrca 主进程权限策略自动写文件 |
| 平台/运行时 | macOS/Linux 官方标记；Node ≥ 22.5；`lavish-axi` 浏览器审核 | Electron main + main/tools vendor + 系统 Node 22+ 运行外部工具 | Electron 自带 Node 不是可靠运行时；必须复用已验证的系统 Node 22+（如 CodeGraph 的既有处理方式） |
| 版本/供应链 | MIT + 多外部依赖（acpx、harness、lavish-axi） | 主进程依赖精确 pin、vendor 缓存、electron-builder extraResources | **npm 与 GitHub 版本不同步**是接入前必须核实项；若打包需明确 npm dependency / vendor / 系统 PATH 三种交付方式的取舍 |

## 2.2 集成方式对比（⚠️ 调研仅供参考，实现一律以 specs/ 为准）

| 方案 | 集成深度 | 可行性 | 工作量 | 说明 |
| --- | --- | --- | --- | --- |
| **不集成，仅作为用户自行运行的 companion** | L0 | ✅ 推荐（默认） | 零 | 用户手动 `npm i -g backpass`，DeepOrca 无感知；后续仅在需要时再评估 |
| **Electron main 受控子进程 sidecar（只读）** | L1 | ✅ 推荐（若做） | 中（1-3 天） | main-process spawn 固定版本 `backpass scan/status --json`，以已注册 workspace root 界定运行目录；仅展示 transcript 数/harness 分布/预算/proposal 状态，不自动写文件 |
| **Electron main 受控子进程 sidecar（显式 analyze/propose）** | L2 | ✅ 有条件 | 中高 | 仅在用户明确操作后运行 `analyze/propose --json`，UI 展示 proposal 与证据；**仍不自动 apply**；`apply` 继续走外部浏览器/终端审核面 |
| **Skill 配套（调用知识）** | L0 | ✅ 可作为补充 | 低 | 若工具名/调用流程复杂，用 `SKILL.md` 描述触发条件、参数、结果解释与安全提醒；实际动作仍由 sidecar/MCP 完成，不让 Skill 代写文件 |
| **core seam + desktop adapter（内置打包）** | L3 | ⚠️ 条件触发 | 高 | 仅当需要随安装包交付、桌面控制生命周期、离线 vendor、应用内状态/进度/审核面时才考虑；需同步 electron-builder/vendor/第三方声明 |
| **直接 import backpass 内部模块** | L3 | ❌ 不建议 | — | package 无 `exports`、无稳定 JS API；synthesis/apply 强依赖 `acpx`/harness store/`lavish-axi`，不是可维护的集成面 |
| **新增 core built-in MCP server / 内置工具** | L2 | ❌ 不建议 | — | 与“外部能力优先经 MCP/可选伴生”路线冲突；且当前 npm 暂无官方 backpass MCP server |

## 2.3 推荐分期（仅当决定集成时）

**P0（只读验证）**：main-process 以已校验的系统 Node 22+ spawn 固定版本
`backpass status --json` / `scan --json`；运行目录仅限已注册 workspace root；返回
transcript 数量、harness 分布、association tier、memory token 预算、已有 proposal
状态；不做任何写操作，也不把默认完整 `backpass` 当只读命令（无 memory 文件时它会
bootstrap 创建 `AGENTS.md`/`CLAUDE.md` 指针）。

**P1（显式 proposal）**：仅用户点击后运行 `analyze`/`propose --json`，在 UI 展示
proposal、原始证据引用与预算利用率；仍不自动 `apply`；拒绝结果回读并显示。

**P2（受控 apply，可选）**：仅用户明确批准后，main-process 启动 `backpass apply`，
打开外部审核面，等待子进程结束，再复查 Git diff 与 `backpass status`，把最终写回结果
展示在 DeepOrca 内；`--no-ui` 需要真 TTY，不适合作为 Electron 默认路径。

**P3（未来）**：若要让 backpass 真正学习 DeepOrca 自有 sessions，优先**向上游贡献
正式 DeepOrca transcript adapter**（backpass 架构是每个 adapter 带 fixture 且
fail-soft），而不是在 DeepOrca 内部伪造 Claude/Codex 格式。

## 2.4 是否必须集成 / 集成带来的便利

**是否必须集成：不是。** DeepOrca 已是可独立完成编码任务的 harness（自有
session/skills/路由/记忆/token 记账）。backpass 提供的是对**外部 Agent harness
历史会话**的记忆规则优化，不是 DeepOrca 运行必需能力；且其分析依赖用户已认证的
Claude/Codex/Pi/OpenCode 等 harness，DeepOrca 自身 SessionManager 不在其已知
harness 列表内。

**若能接受上述外部依赖与维护成本，集成可带来的便利（价值主张）：**

- **记忆规则质量反馈闭环**：把 `AGENTS.md`/skills 视为可迭代的“权重”，基于真实会话中的失败/缺失 pattern 持续修正，而不是靠开发者事后回忆。
- **跨会话证据聚合**：同一 gap 需 ≥2 个独立 session 佐证且带 transcript 原文引用，减少单次偶发误判升级为全局规则的风险。
- **删除门槛保护**：删除已有指令需要多会话 `harm` 证据，避免“模型不遵守就删规则”的反模式。
- **预算与 proposal 可视化**：`status`/`propose --json` 可被 DeepOrca UI 消费，展示 memory token 预算、待审核 edit、占用/拒绝历史。
- **原子写回与 freshness 校验**：用户审核后才写回，且写回前对目标文件做一致性校验，降低直接编辑 `AGENTS.md` 的破坏风险。

## 2.5 风险与必须核实事项

- **npm 与 GitHub 版本不同步（高）**：GitHub v0.1.17 vs npm latest v0.1.16。接入前必须 `backpass --version` 并核对 tarball/provenance；正式集成应固定版本，不依赖 `latest` 或 `npx`。
- **transcript 脱敏不是安全保证（高）**：README 的 “no upload” 指 backpass 自身不上传；实际分析 prompt 会经 `acpx` 发送给用户已认证的 harness。`src/redact.js` 仅覆盖常见 token/JWT/私钥/`KEY=value` 形状，粗粒度规则。需核实 DeepOrca transcript 中的密钥、用户数据、内部代码是否符合各模型提供商政策；如接入，应在 DeepOrca 侧先做更严格 redaction。
- **workspace root 与权限边界（高）**：backpass 以 `process.cwd()` 解析仓库；renderer 是半可信输入。任何自动调用都必须由 main 通过已注册 root 校验解析 workspaceRoot，禁止把 renderer 传入的任意绝对路径直接交给 backpass。
- **`init`/默认完整运行是写入路径（高）**：`backpass init` 创建 `.backpassrc.json` 并改 `.git/info/exclude`；无 memory 文件时默认 `backpass` 还可能 bootstrap 创建 starter `AGENTS.md`/`CLAUDE.md` 指针。只读命令与写入命令必须明确分离。
- **synthesis 权限与 staging 行为（中高）**：synthesis Agent 获得了编辑 staging workspace 的能力，某些 harness 使用 `--approve-all` 或写权限 overlay。需验证 harness 是否真把写操作限制在 staging cwd、staging workspace 是否复制了不应暴露的 skill/文件、`apply` 前后 Git diff 是否只含用户批准的文件。
- **外部 Agent 依赖与模型选择重复（中）**：必须存在 `acpx` + 至少一个已登录 harness。DeepOrca 自己的模型路由与 backpass 的 `acpx` 探测完全独立，不能共用状态；未来 DeepOrca 会话要进入 backpass 需要上游 adapter。
- **平台支持（中）**：README 明确 macOS/Linux；Windows 虽有 shim 处理，但不能视为完整受支持平台。项目非常新（2026-08-21 创建），行为变化快。
- **配置泄漏（中）**：`.backpassrc.json` 是仓库级 tracked 配置，团队成员可共享预算/harness 设置；不要把机器特定路径或敏感配置（如 API 凭据）提交进去。项目级 backpass 配置同样受 workspace trust/quarantine 影响。
- **版本/供应链（低，但需固定）**：`acpx`、`lavish-axi`、各 Agent CLI 及其模型提供商需分别核实许可证、使用条款与数据处理；接入需固定版本。

## 2.6 红线（若实现时必须遵守）

- **不把 backpass 直接嵌入 `@deeporca/core`**：core 保持 UI-free、不依赖外部 harness 运行时；外部实现一律放 desktop main。
- **不新增 backpass 内置 MCP server / 内置工具**：外部能力优先经 MCP/可选伴生路线；当前无官方 backpass MCP server。
- **不自动执行 `apply` 或默认完整 `backpass`**：写回只发生在用户明确批准后，且不得绕过 DeepOrca 的 permission/IPC 流程。
- **vendor 路径由 host 注入，core 不自行推导**；若打包，需沿用既有 vendor + electron-builder extraResources + 第三方声明流程。
- **IPC 三端合同**：若未来在 renderer 暴露 backpass 状态，必须先改 `shared/ipc.ts`，再 main handler + preload 暴露，renderer 仍只能经 `window.deeporca` 访问。
- **workspace 隔离**：`.deeporca/` 与 `.backpass/` 是两套独立本地状态目录，不得混写；quarantine/非可信项目不得自动加载项目级 backpass 配置。

## 2.7 验收与测试建议（若进入 L1/L2）

- **书面验收**：固定版本 + `--json` 输出解析稳定；无 harness 登录时 `scan/status` 明确区分“无历史/路径不匹配/格式漂移/权限错误”，fail-soft 不阻塞主流程。
- **进程边界**：spawn 走已注册 root、超时、stderr 尾截断；Electron 崩溃/退出能收割子进程。
- **权限与写保护**：只读命令不产生 `.backpassrc.json`/`.backpass/` 之外的写；`apply` 默认禁用且需显式触发；写回后 Git diff 仅含用户批准文件。
- **脱敏回归**：至少覆盖 DeepOrca 常见的 env/密钥/内部 URL 形态；并人工确认哪些信息会进入外部 harness 的 prompt。
- **版本门禁**：接入前记录 npm tarball SHA、GitHub tag、`backpass --version` 三者一致；升级走 release-please 对照。

---

## 结论

backpass 对 DeepOrca 是有明确价值但**非必须**的“记忆审计伴生”工具：它把
`AGENTS.md`/skills 的迭代从“人工回忆”变成“跨会话证据驱动”，且分析阶段不写仓库、
写回前有 freshness 与原子性保护。但三种现实约束决定了推荐姿态：

1. **DeepOrca 自有会话进不去**（无 adapter），其便利主要作用于用户已经使用
   Claude/Codex/Pi 等外部 harness 的场景；
2. **依赖 `acpx` + 外部已登录 harness**，模型/数据处理与两套状态都与 DeepOrca
   完全独立；
3. **npm 与 GitHub 版本不同步、项目极新**，stable API 还未形成。

因此**建议默认不集成**；若产品验证“记忆规则质量反馈”确实有用户价值，按
§2.3 的 P0（只读 status/scan）→ P1（显式 analyze/propose）→ P2（受控 apply，可选）
顺序推进，全程保持只读优先、注册 root、不经 `--approve-all`、不写项目配置密钥。
未来若要学习 DeepOrca 自有会话，优先向 backpass 上游贡献正式 transcript adapter。
本调研不建 spec、不启动任何代码线（总口径）。