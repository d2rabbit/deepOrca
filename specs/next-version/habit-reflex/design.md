# 习惯反射（habit-reflex）· System 1 快通道 · 技术设计

> **状态**：**方案稿（只出方案，不改代码）** · **日期**：2026-09-28 · 分支 `feat/modern-ui-redesign` · **2026-09-28 用户拍板写入 next-version 主线 F**（本项目规划区，启动时 `git mv` 回 `specs/habit-reflex/` 转活跃）。
> **上游调研**：[`docs/research/2026-09-28-phx-system1-habit-absorption-prestudy.md`](../../../docs/research/2026-09-28-phx-system1-habit-absorption-prestudy.md)——对自有项目 PHX（`/Volumes/data/dev/coding/phx`，Kotlin/JVM 数字体，142 篇设计文档）一手精读，习惯挖掘关键参数已对源码级文档二次核证（置信度五因子权重 / 半衰期 / 触发类型逐条坐实），本 spec 的直接依据。
> **用户定调**：吸收 PHX 的 System 1（快思考反射）设计。本线定位为 **V2 对 V3（系统级智能体范式）差距综合补齐的收官件**——补上后自主性闭环（感知→挖掘→预判→带门执行→反馈学习）五轴全部有着落，轴级对账见调研报告 §10 回写。
> **对应实现域**：`packages/core/src/habits/`（引擎 + 存储，UI-free，与 compaction/usage-ledger 同层）+ `packages/desktop/`（habit-ipc + 习惯审查面板 + SUGGEST 提示条）。core 不引 UI，desktop 不碰引擎内部。
> **命名红线**：本线**禁用 "trigger" 术语**——已被 [`specs/next-version/memory-trigger-recall/`](../memory-trigger-recall/design.md) 占用（其 trigger 是记忆召回侧检索线索，本线是行为反射侧执行条件，同名不同物）。本线术语：habit / reflex / suggestion / rule。

---

## §0 执行摘要

现状：deepOrca 是纯 System 2 形态——每个动作都走完整 LLM 会话回路（G1 嵌入短名单 → flash 技能匹配 → 主循环），缺一条绕过慢回路的快通道。本方案把 PHX 习惯管道六段裁剪移植到 coding-agent 语境（事件源 = 会话内工具调用，不碰 OS 级事件）：**事件采集（脱敏前置）→ 本地滑动窗口模式挖掘（纯统计零 LLM）→ 候选习惯状态机（五因子置信度 + 7 天半衰期衰减）→ 显式确认结晶为反射规则 → 确定性触发默认 SUGGEST → 反复采纳后可升级 AUTO_EXECUTE（留审计痕）→ 执行反馈回写置信度**。

| 层       | 内容                                                                          | 新增/复用                                                    |
| -------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 对象模型 | HabitEvent / HabitCandidate / Habit / ReflexRule / ReflexExecutionRecord 五类 | 全新增；与 `@deeporca/memory` 零关系（记忆单一承接边界不变） |
| 采集侧   | `ToolExecutor.executeToolCall` 旁路追加 + 脱敏前置 + per-project JSONL        | 新增采集器；持久化克隆 usage-ledger 三件套范式               |
| 挖掘侧   | 滑动窗口频繁子序列 + 候选状态机（idle 窗口调度，同后台压缩先例）              | 全新增纯 TS，零新依赖                                        |
| 触发侧   | 三挂点确定性评估（工具调用后 / 会话启动 / 应用级 timer）                      | 新增评估器；嵌入复用 routing 单例（可选信号）                |
| 执行侧   | SUGGEST 一键采纳；AUTO_EXECUTE 走权限门 + 审计痕                              | 复用权限系统 + `runBackgroundTask` + 事件通道                |
| 治理面   | `settings.habits`（默认关）+ 冷却/去抖 + 每习惯 kill switch                   | 新增配置节，对齐 optional 节惯例                             |

## §1 对象模型（五类，均 `@deeporca/core` 内部类型，不进 IPC 契约以外表面）

| 对象                    | 形状要点                                                                                                                                                                 | 生命周期                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `HabitEvent`            | `{ id, ts, tool, command?, argsHash?, paths?, exitCode?, durationMs, cwd, sessionKey }`（脱敏后形态）                                                                    | append-only JSONL，只增不改                                               |
| `HabitCandidate`        | `{ id, sequence: string[], occurrences: {ts, eventIds[]}[], confidence, factors: {frequency, successRate, consistency, recency, contextMatch}, status, lastOccurredAt }` | CANDIDATE → CONFIRMED（挖掘侧晋升）                                       |
| `Habit`                 | Candidate 确认后 + `{ strength, statistics: {lastFiveResults, successRate}, killSwitch }`                                                                                | CONFIRMED → ACTIVE → DORMANT / DECLINING（衰减/失败驱动）                 |
| `ReflexRule`            | `{ id, habitId, name, steps: {command, cwdMode}[], trigger: {kind: sequence\|time\|context, params}, cooldown, status: DRAFT\|ACTIVE\|DEPRECATED, versions[] }`          | **显式确认结晶产生**，DRAFT 起步；materialize 出 SKILL.md 供 LLM 路径可见 |
| `ReflexExecutionRecord` | `{ id, ruleId, mode: adopt\|auto, input, outcome: success\|fail\|cancelled, durationMs, ts }`                                                                            | append-only JSONL，反哺 `statistics`                                      |

溯源纪律（PHX sourceEventIds 照搬）：Candidate/Habit 保留 `eventIds` 引用，审查面板可回放"为什么我认定这是你的习惯"。

## §2 六段管道设计

### 2.1 事件采集（挂点已核证：`core/tools/executor.ts` `executeToolCall`）

- 工具调用完成后旁路构造 `HabitEvent`，O(1) append，**永不阻塞工具环**；任一异常静默吞掉（fail-open）。
- **脱敏前置**（写入前，PHX SensitivePattern 管道照搬）：内置规则 password/api-key/token/credit-card/email + URL 参数值 + 路径用户名（`/Users/***/`、`C:\Users\***\`）；`argsHash` 存 SHA-256 短哈希供精确重复匹配，原文不落盘。
- 存储：`~/.deeporca/projects/<projectCode>/habits/events-<n>.jsonl`，分片按 5MB 轮转——API 形态克隆 `usage-ledger.ts` 的 `path/append/read` 三件套。

### 2.2 模式挖掘（纯本地统计，零 LLM）

滑动窗口频繁子序列枚举（PHX 实测参数直接对表）：窗口长度 2–10、`minSupport=3`、允许间隔 ≤2、`minOccurrences=5`、`minSuccessRate=0.7`。调度挂 idle 窗口（回合静止/工具间隙双触发，同后台压缩先例）+ 每日兜底 timer；单项目事件量（周百~千级）下朴素算法绰绰有余。

### 2.3 候选状态机（System 1 的核心引擎）

```
confidence = frequency×0.25 + successRate×0.30 + consistency×0.20 + recency×0.15 + contextMatch×0.10
```

- 频率 `log10(count+1)/log10(11)`；recency 指数衰减 `0.5^(h/168h)`（7 天半衰期，一周不用自然冷却）；一致性 `1 − 变异系数`。
- **确认门槛**：confidence ≥ 0.8 且 minOccurrences/minSuccessRate 达标 → CONFIRMED；候选初始置信 0.1，五档每档 0.2。
- 候选池治理：上限 200、只留近 50 次出现、30 天保留；超容按 lastOccurredAt 驱逐最旧低置信者。
- 时间模式（可选信号）：日/周周期检测（≥70% 集中 ≤3 小时档 / ≥50% 集中 ≤3 星期日，需 ≥5 次）→ TIME 触发器素材。

### 2.4 结晶（显式确认，永不自动）

CONFIRMED 候选进入审查队列；用户确认后生成 `ReflexRule`（DRAFT）——**steps 是可执行的确定性命令数据**（非散文），这是快通道真正绕开 LLM 的前提；同名 SKILL.md materialize 到习惯技能目录使其对既有技能发现/匹配栈可见（LLM 路径可解释）。规则带版本快照（上限 10）可回滚。

### 2.5 触发评估（确定性规则，零 LLM）

| 挂点                                              | 评估的 trigger kind | 说明                                        |
| ------------------------------------------------- | ------------------- | ------------------------------------------- |
| `executeToolCall` 返回后（core 内联）             | SEQUENCE            | 最近事件序列尾匹配规则前缀                  |
| 会话启动 / 用户 prompt 到达（core）               | CONTEXT             | 项目 + 时段 + 近期文件上下文命中            |
| 应用级 timer（desktop main，SessionManager 常驻） | TIME                | 日/周周期外推命中；错过不补发、下次启动静默 |

- **冷却/去抖（PHX 已知空白，本 spec 必补）**：同规则同会话冷却 5 分钟 + 单规则单会话建议上限 2 + 全局每会话建议上限 5。
- 命中 → 产出 SUGGESTION 事件（沿会话事件流发出，desktop 转渲染）→ 提示条（规则名 + 将执行的命令序列 + 来源习惯置信度）。

### 2.6 执行与升级门

- **SUGGEST（默认，F1）**：一键采纳 = 规则具现化为**预填 prompt**（用户回车发出）→ 走正常会话回路执行。协议零破坏、权限零绕过，符合"默认保守"。
- **AUTO_EXECUTE（F3，升级门全过才可用）**：① 近 10 次采纳 ≥9；② 规则所有步骤副作用均为 read-in-cwd / query 类（`sideEffects` 判定）；③ 用户在设置中显式开启 `autoExecute`。执行走 `ActionContext.runBackgroundTask` 无会话后台通道（已有原语，复用后台任务徽标面），**留 AUTO_EXECUTED 审计痕**；任一门不过回落 SUGGEST。
- **反馈闭环**：`ReflexExecutionRecord` → `statistics.successRate` → 置信度回写（连续失败降级 DORMANT → 停止触发 → DECLINING 清理），执行反馈反哺挖掘，形成 PHX 式闭环。

## §3 数据流

```
executeToolCall 完成 ──┬─→ HabitEvent append（脱敏后）──→ events-<n>.jsonl
                       └─→ SEQUENCE 规则即时评估 ──→ SUGGESTION 事件 ──→ 提示条
idle 窗口 / 每日兜底 ────→ 挖掘器读 events → 更新候选池 ──→ CONFIRMED → 审查队列
用户确认 ────────────────→ ReflexRule（DRAFT→ACTIVE）+ materialize SKILL.md
timer / 会话启动 ────────→ CONTEXT/TIME 评估 ──→ SUGGESTION
采纳（adopt）────────────→ 预填 prompt → 正常回路 → ReflexExecutionRecord
自动执行（auto）─────────→ runBackgroundTask → 审计痕 → ReflexExecutionRecord
Record 回写 ─────────────→ statistics.successRate → confidence → DORMANT/DECLINING
```

## §4 存储布局

```
~/.deeporca/projects/<projectCode>/habits/
  events-<n>.jsonl          # HabitEvent，5MB 轮转
  candidates.json           # 候选池（原子写）
  habits.json               # 确认习惯 + kill switch（原子写）
  rules/                    # ReflexRule + 版本快照（JSON，一规则一文件）
  executions-<n>.jsonl      # ReflexExecutionRecord
```

sessions-index **零改动**（独立文件族，usage-ledger 惯例：optional 功能不迁移既有索引）。

## §5 与主线 A（E1 遥测层）的共享约束（架构红线）

习惯事件采集（`ToolExecutor` 咽喉点，行为序列记录）与 E1 执行捕获（`registry.execute` 咽喉点，能力成败记录）是**同一遥测层的两个消费者**：共享 per-project JSONL 分片机制、轮转策略与记录信封（`{ ts, kind, payload }`，kind 区分 `behavior` / `capability-outcome`）。**先启动者定信封格式，后启动者并入，禁止各铺各的 JSONL**。E1 spec（`next-version-plan.md` 主线 A）设计时必须引用本节；若 E1 先行，本 spec §2.1 的存储段改为挂接 E1 采集器。

## §6 配置与权限

- `settings.habits`（optional 节惯例，**enabled 默认关**——关 = 零采集零挖掘零触发，行为与现状逐字节一致）：
  `{ enabled, autoExecute(默认 false), minOccurrences?, cooldownMinutes(5), maxSuggestionsPerSession(5) }`。
- 权限：`PermissionScope` 新增 `auto-execute`（仅 AUTO_EXECUTE 检查用；SUGGEST 采纳走正常回路不加 scope）；AUTO_EXECUTE 前置 `sideEffects` 全 read 类硬校验。
- 每习惯 kill switch：审查面板随时停用单条规则，停用即从触发评估剔除（挖掘继续积累证据）。

## §7 桌面面

- `main/habit-ipc.ts`（照 action-ipc 模式）：`list`（候选+习惯+规则）/ `confirm` / `reject` / `disable` / `settings` 五方法 + `event:habitSuggestion` 事件通道（按 root 戳多路复用）。
- 习惯审查面板（复用 ActionsPanel 形态）：提案列表 + 详情三块（**触发原因**（证据回放）/ **建议命令序列** / **影响评估**（预计耗时 + 副作用清单））+ 三态 approve / reject / disable。
- SUGGEST 提示条：composer 上方 chip，一键采纳/忽略；i18n 六目录全量键。

## §8 分期与数据决策门

| 批次                 | 内容                                                                                                                       | 验收                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **F0 纯观察**        | §2.1 采集 + §4 存储 + §2.2/2.3 挖掘 + 候选只读列表 + 开关（默认关）                                                        | 关=零行为变化对照测试；开=事件入库且主回路零影响（注错 fail-open）；**数据门：观察期候选人工评定"确为习惯"比例 ≥ 60% 才放行 F1** |
| **F1 SUGGEST**       | §2.5 触发评估 + 冷却/去抖 + 提示条 + 采纳流                                                                                | 真值表（序列尾匹配/上下文命中/冷却拦截）；采纳→预填 prompt 端到端                                                                |
| **F2 结晶+审查**     | §2.4 结晶 + §7 审查面板 + 版本快照 + i18n                                                                                  | 确认→DRAFT→ACTIVE→SKILL.md materialize 全链；审查详情三块可回放证据                                                              |
| **F3 自动执行+反馈** | §2.6 升级门 + runBackgroundTask + 审计 + 置信度回写                                                                        | 三门缺一即回落 SUGGEST；连续失败→DORMANT 停止触发；审计痕完整                                                                    |
| **F4 可选**          | shell-history 事件域扩展（默认关 opt-in，PHX TERMINAL 钩子三格式解析经验）/ 瘦版习惯图谱（邻接表 + Jaccard）/ 通知分级聚合 | 单独立项评估，不阻塞主线                                                                                                         |

## §9 风险与对策

| 风险                              | 对策                                                                     |
| --------------------------------- | ------------------------------------------------------------------------ |
| 命令参数含密钥落盘                | 脱敏前置（写入前）+ argsHash 替代原文；脱敏规则单测锁死                  |
| 误报建议刷屏打扰                  | 保守阈值（0.8 确认）+ 冷却/上限三重去抖（§2.5）+ kill switch + F0 数据门 |
| 挖掘/触发故障拖垮主回路           | 全链 fail-open：采集/挖掘/评估任一异常静默退化，工具环与 LLM 回路零感知  |
| AUTO_EXECUTE 误执行高危命令       | 三重升级门（§2.6）+ sideEffects 硬校验 + 审计痕；永不默认开启            |
| 与 E1 双写 JSONL 分叉             | §5 共享信封约束 + 先启动者定格式；E1 spec 交叉引用                       |
| 事件域窄于 PHX（会话内 vs 全 OS） | 产品定位决定的结构边界（调研 §10 三级口径）；F4 shell-history 为可选扩域 |

## §10 明确不做

不碰 OS 级钩子（剪贴板/进程/全局 UI——产品是 coding harness 不是系统级数字体）；不做 Leiden/FastRP 全量图谱（数据规模不需要，瘦版邻接表进 F4 观察）；不做 EvoMAS 参数进化与配置变异（无数值参数向量对象，其"验证+快照+谱系+回滚"护栏思想留给未来 auto-tune 类功能）；不做 MBC 多脑审议（权限系统 + 审查面 + 升级门等价承担）；不做 A2A/ACP；不改 sessions-index 与 memory 包；**自动执行默认关、永不静默升级**。
