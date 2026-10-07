# PHX System 1（习惯反射）设计哲学吸收预研

> **状态**：~~纯调研留档（零代码、不落 spec）~~ → **同日升级：已写入 next-version 主线 F 并落地 spec**（见文末回写注记）· **日期**：2026-09-28 · 分支 `feat/modern-ui-redesign`
> **调研对象**：PHX（`/Volumes/data/dev/coding/phx`，我们自己的 Kotlin/JVM 数字体项目，Phoenix + AISPA 融合架构；142 篇设计文档于其 `phx-next-docs/`，全部一手精读 + 关键参数对代码核证）
> **用户定调**：吸收 PHX 的设计哲学与功能到 deepOrca，其中与 **System 1**（快速直觉模式，如 flash 类小模型的"秒答反射"模式）匹配的部分是本次重点；初稿只出调研方案，**同日用户拍板**定位为"V2 对 V3（系统级智能体范式）差距综合补齐收官件"并落地：[`specs/next-version/habit-reflex/`](../../specs/next-version/habit-reflex/design.md)（design+tasks，主线 F）。
> **总口径提醒**：调研仅供参考，正式实现一律以 `specs/` 为准。

---

## §0 执行摘要

PHX 是一个"观察用户行为 → 静默挖掘习惯 → 显式审查提案 → 受控执行 → 反馈进化"的数字体系统。它的**五大哲学**（行为镜像 / 无感知规划 / 心跳驱动 / 多脑议会 / 自我进化）中，与 System 1 直接对应的是**前两条加上决策层的 FAST 快速通道**：**不经过慢思考（LLM 审议）的、模式识别驱动的反射式响应**——这正是 Kahneman 双过程理论里 System 1（快、自动、省力）与 System 2（慢、深思、费力）的工程化。

deepOrca 目前是**纯 System 2** 形态：每个动作都走完整的 LLM 会话回路（用户请求 → G1 嵌入短名单 → flash 技能匹配 → 主循环 → 工具执行）。缺的是一条**绕过慢回路的快通道**：从用户行为中挖掘重复模式，模式成熟后由确定性触发器直接给出建议/执行，LLM 只在低置信时兜底。

**吸收主线（本报告主角）**：PHX 的"习惯管道"——事件采集（脱敏前置）→ 朴素模式挖掘 → 候选习惯状态机（五因子置信度 + 7 天半衰期衰减）→ **显式确认**结晶为技能 → 触发器默认 SUGGEST → 批准后低风险可 AUTO_EXECUTE。其**保守确认 + 证据溯源 + 渐进自动化**三原则与 deepOrca 的权限/审查面天然契合。

**次级吸收**：FAST 决策模式的"单角色高置信直批 + 不足即回退全议会"（与 depth-lane 轻轨/重轨是独立同构的第二实现者）；"隐匿生成显式审查"的审查界面四块详情；通知四级分级与聚合；心跳式周期唤醒（idle-time compaction 已有同型先例）。

**不吸收**：OS 级事件钩子（键盘/剪贴板/进程监控，隐私超范围）、EvoMAS 参数进化（deepOrca 无数值参数向量对象）、影子成员热备（单进程 Electron 不需要）、A2A/ACP 协议栈（deepOrca 已有 MCP + subagent 面）。

---

## §1 PHX 是什么

PHX（Phoenix / AISPA）是运行在 Compose Desktop 上的数字体（Digital Agent）系统：**观察用户行为，经多脑议会（MBC）审议操作，安全沙箱执行，并以强化学习进化自身配置**。模块分八层（core / sensing / data / decision / execution / evolution / integration / ui）+ a2a/acp 协议栈，模块间通信全部走 5 条命名管道队列（`MessageCoordinatorV2`），无直接模块调用。

五大核心理念（`phx-next-docs/00-MASTER-OUTLINE.md`）：

| 理念       | 含义                         | PHX 载体                                                                                          |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| 行为镜像   | 从"人机对话"转向"观察与模仿" | 感知层 02A–02C + 习惯图谱 03B                                                                     |
| 无感知规划 | 后台静默规划，前端显式审查   | MBC 04A–04F + 审查界面 08A                                                                        |
| 心跳驱动   | 周期性唤醒替代常驻等待       | 心跳引擎 01A（4 级：SYSTEM 30min / SERVICE 5min / TASK 30s / REALTIME 5s）                        |
| 多脑议会   | 多模型协同决策降低单点风险   | MBC 6 阶段审议 + 加权投票（Speaker 0.4 / Security 0.35 / LogicCritic 0.25，安全员一票否决）       |
| 自我进化   | 基于执行反馈持续优化         | EvoMAS 06A（fitness = successRate 0.4 / latency 0.3 / cost 0.2 / satisfaction 0.1）+ 配置变异 06C |

术语说明：对外叫"数字体"（数体型）、内部叫 Agent；Agent-C 对外叫 DAC Framework、EvoMAS 对外叫 EvoMDA。

## §2 System 1 对位：PHX 哪里是 System 1

**System 1 的定义**（对齐用户语境："jev 这类模型的模式"，即 flash 级小模型的快速直觉响应；两仓代码中均无 "jev" 字面量，本报告按"快思考/反射模式"理解，如与预期不符请指正）：模式识别驱动的、无需深思的自动响应；与之相对 System 2 是审议式慢推理。

PHX 里的 System 1 / System 2 分工非常清晰：

|               | System 1（快通道）                                                                                                                           | System 2（慢通道）                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| PHX           | 习惯触发：模式命中 → 确定性触发器 → SUGGEST/AUTO_EXECUTE；`quickDecision` FAST 模式：单角色（议长）置信度 > 0.8 且初判 LOW 风险直接 APPROVED | MBC 六阶段审议（INITIAL_REVIEW → SPEAKER_ANALYSIS → SECURITY_REVIEW → LOGIC_VALIDATION → VOTING → FINAL_DECISION），BALANCED 5min / THOROUGH 15min |
| deepOrca 现状 | **缺失**（仅 G1 嵌入短名单是确定性的，但产出仍喂给慢回路）                                                                                   | 全部：每次动作走完整 LLM 会话回路                                                                                                                  |

关键洞察：**PHX 的 System 1 不用 LLM**。习惯挖掘是纯本地统计（滑动窗口频繁子序列计数），触发判定是确定性规则匹配，只有"习惯是否确认结晶"和"触发后提案是否放行"两处才请 LLM/议会把关。快通道之所以快，是因为它根本不进慢通道的队列；慢通道只在快通道**置信不足时兜底**（quickDecision 置信度不足或初判风险非 LOW → 自动降级调用完整 `execute()` 流水线）。

## §3 PHX System 1 机制全貌（习惯管道六段）

### 3.1 段一：事件采集（02A 事件钩子系统）

8 类事件源：TERMINAL（终端命令）/ UI_INTERACTION / FILE_SYSTEM / NETWORK / APPLICATION / CLIPBOARD / PROCESS / CUSTOM。每类是 `SystemEvent` sealed 子类型（如 `TerminalEvent(command, arguments, exitCode, duration, workingDirectory)`）。

三个值得吸收的工程约束：

- **脱敏前置（privacy by design）**：管道 Collect → Filter → Sanitize → Buffer，`SensitivePattern`（内置 password/api-key/token/credit-card/email/url-param 六条 + 路径用户名脱敏 `/home/***/`）在 publish **之前**执行——下游永远只见脱敏后事件；维护按模式统计的脱敏计数。
- **采样与降级**：`HookConfig.samplingRate`（默认 1.0 可降 10%）、`captureOutput` 默认 false（隐私考量）；发布通道 `SharedFlow(replay=0, buffer=10000, DROP_OLDEST)`——溢出即丢最旧，采集永不阻塞业务。
- 指标预算：采集延迟 <5ms、吞吐 >10k events/s、CPU <1%。

### 3.2 段二：行为流（02B）

事件 → `BehaviorFeature`（128 维特征向量 + `previousFeatureId` 事件链——**链是序列挖掘的前提**）。四个默认特征提取器：时间 35 维（小时/星期/季度 one-hot）、频率 8 维、序列 80 维（最近 10 事件类型位置 one-hot）、上下文 64 维。序列检测三手段并存：N-gram 已知模式匹配、一阶马尔可夫转移概率、异常检测（转移概率 < 0.1 的占比 > 0.5 → ANOMALY）。窗口聚合 5 分钟窗口 + 熵度量行为多样性。

### 3.3 段三：习惯挖掘（02C）——System 1 的核心引擎

- **算法朴素优先**：文档写 PrefixSpan/GSP 变体，实现收敛为**滑动窗口频繁子序列枚举**（窗口 2–10，精确子串计数 ≥ minSupport）。配置：`minSupport=3、allowGaps=true、maxGapSize=2、minSupportRatio=0.1`。
- **确认阈值（保守确认）**：`minOccurrences=5、minSuccessRate=0.7、confidenceThreshold=0.8`——重复 5 次以上、成功率 >70% 且置信度 ≥0.8 才 CONFIRMED。
- **五因子置信度**（`02C-01-03-confidence-calculator.md`，一手核证）：

  ```
  confidence = frequency×0.25 + successRate×0.30 + consistency×0.20 + recency×0.15 + contextMatch×0.10
  ```

  频率取对数增长 `log10(count+1)/log10(11)`（约 10 次达 0.8）；recency 支持三种衰减，默认指数 `0.5^(hoursSinceLastSeen/halfLife)`，**半衰期 168 小时（7 天）**——一周不用，习惯自然冷却。

- **候选池治理**：`maxCandidates=1000、只保留最近 100 次出现、retentionDays=30`；超容按 lastSeenAt 驱逐最旧低置信者；候选初始置信度 0.1（从 VERY_LOW 起步，五档每档 0.2）。
- **时间模式**：日周期（≥70% 集中在 ≤3 个小时档）/ 周周期（≥50% 集中在 ≤3 个星期日）/ 月周期，均需 ≥5 次出现；一致性 = `1 - 变异系数`；`predictNextOccurrence` 按 DAILY+1d / WEEKLY+7d / MONTHLY+30d 外推。
- **状态机与溯源**：`HabitStatus { CANDIDATE → CONFIRMED → ACTIVE → DORMANT / DECLINING }`；每条 HabitEvent 都带 `confidence` 与 `sourceEventIds`（**可解释性溯源**——"为什么我认定这是你的习惯"可以回放证据）。
- **已知空白**：触发器无冷却/去抖机制（靠挖掘侧 lastOccurredAt + 决策层把关）——吸收时要自己补。

### 3.4 段四：触发器生成（02C-03）

从 CONFIRMED 习惯生成 `TriggerRule(condition, action, priority)`：

- `TriggerType { TIME_BASED, EVENT_BASED, CONTEXT_BASED, SEQUENCE_BASED }`；参数形如 `hour_start/hour_end、days_of_week、interval_minutes、event_type（取序列首步）、required_apps、preconditions`。
- `ActionType { NOTIFY, AUTO_EXECUTE, SUGGEST, LOG_ONLY }`——**默认保守 SUGGEST，绝不默认 AUTO_EXECUTE**。优先级：时间 10 > 上下文 8 > 事件 5。

### 3.5 段五：结晶为技能（03B 图谱 + 03C 技能库）

- **习惯图谱**：节点 `BEHAVIOR/HABIT/TRIGGER/CONTEXT/ACTION`，边 `PRECEDES/TRIGGERS/REQUIRES/RELATES_TO/...`，每条关系带 `RelationEvidence(source, confidence, timestamp)` 证据链；社区检测（Leiden，带降级链 Leiden→简化版→Louvain）发现习惯簇做推荐（"经常一起做"/"模式相似"）；FastRP 图嵌入（64 维、增量只重算变化节点 2-hop 邻域，变化 >30% 回退全量）。
- **技能结晶是显式动作**：`createSkillFromHabit(habitId, config)` 产物 `Skill(sourceHabitId, status=DRAFT)`——挖掘**永不**直接产出可执行技能；DRAFT → ACTIVE → DEPRECATED/ARCHIVED 生命周期，`createVersion` 保存完整快照（maxVersions=10）可回滚，`SkillExecutionRecord` 记录每次执行的输入/输出/时长/成败，`SkillStats(successRate, averageDurationMs)` 反哺置信度——**执行反馈闭环**。

### 3.6 段六：决策配合与人的关口（04A FAST + 08A 审查 + 08B 通知）

- **FAST 快速通道**（`04A` 决策模式表，与 AGENTS.md 一致）：`quickDecision` 降级为单角色判断——仅议长分析，`confidence > 0.8` 且初判风险 LOW 且 type ≠ CONFIGURATION 即直批，完全绕过议会；不足即回退完整流水线。四模式参数包：FAST（阈值 0.5 / 1 轮 / 30s）、BALANCED（0.6 / 2 轮 / 5min）、THOROUGH（0.7 / 3 轮 / 15min）、CONSERVATIVE（0.85 / 3 轮 / 30min，且禁用影子接管）。`submitAutoProposal` 管线快捷通道跳过议长直接投票。
- **审查界面（隐匿生成显式审查）**：后台静默产出 CouncilDecision，前端映射为 ReviewItem（标题/摘要截断 100 字/风险映射优先级/`expiresAt`）；详情四块 = **触发原因、建议操作序列、备选方案（含 tradeoffs）、影响评估**（时间节省/资源/风险）；approve / reject(reason) / modify 三态 + 风险分级批量授权（APPROVE_LOW_RISK / APPROVE_SAFE_ONLY）；历史含 AUTO_EXECUTED 状态（低风险自动执行留审计痕）。体验硬指标：操作 <3 步、响应 <200ms。
- **通知（打扰最小化）**：四级 INFO（可聚合）/ WARNING / IMPORTANT（不聚合）/ URGENT（唯一穿透免打扰位）；仅聚合 TASK_COMPLETE/HABIT_DETECTED/SUGGESTION 三类，触发条件 `maxCount=10 或 5min 窗口`；免打扰期间入队（上限 1000，满时淘汰非 URGENT），退出后补发；默认 `enableSound=false、enableBadge=true`（角标静默）。
- **心跳调度**：一切异步活动挂 4 级心跳（SYSTEM 30min / SERVICE 5min / TASK 30s / REALTIME 5s），监听器独立协程 + 超时，空闲零常驻成本；丢失检测连续 3 次告警。

## §4 deepOrca 承接面对位

| 承接面         | 现状（关键文件）                                                                                                                                                                                               | 对习惯反射的承接力                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 行为事件源     | 会话内工具调用流天然就是事件源（bash 命令/read/write 路径/时间戳全在 transcript）；activity-frames 双管线已有"行为帧"雏形（`desktop/tools/activity-frames/`、`session-types.ts:342 behavioralMemoryProvider`） | **现成可用**——不需要 OS 钩子，会话内工具调用序列即挖掘原料                      |
| 语义召回与遥测 | `core/routing/`（G1 嵌入短名单 fail-open）+ `routing/telemetry.ts` RoutingEvent{stage/outcome/latencyMs}                                                                                                       | **现成可用**——习惯触发条件评估可复用同一嵌入通道，新增 stage 标签即可           |
| 技能体系       | `.deeporca/skills` 扫描 + SKILL.md 方言 + G1 短名单 → flash 匹配（`session-manager-skills.ts`）+ SkillMatchCache                                                                                               | **需扩展**——习惯结晶物可作为特殊技能形态挂入（≈带触发条件的技能）               |
| 记忆管线       | `@deeporca/memory` L0–L3 + capture/recall + generation-log.jsonl 审计 + 每日 03:30 LocalMemoryCleaner 定时器                                                                                                   | **现成可用**——周期调度先例已有；习惯对象可在管线旁路自建，不动 TDAI 内部        |
| 后台调度       | idle-time 后台压缩（回合静止 + 工具执行窗口双触发、CAS 应用、`compaction.ts` + `background-compaction.test.ts`）；`runBackgroundTask` 静默子会话                                                               | **现成可用**——习惯挖掘调度可直接挂 idle 窗口，模式与 compaction 同型            |
| 权限与副作用   | `PermissionScope` 十项 + `ActionDefinition.sideEffects: string[]` 喂桌面权限门                                                                                                                                 | **现成**；无人值守反射执行或需新增 scope（如 `autonomous-execute`）——**需扩展** |
| 审查/任务 UI   | ReviewWorkspace/CodeReviewPanel、TaskHub 三件套、ActionsPanel、Toast、action-ipc 进度事件（按 root 多路复用）                                                                                                  | **现成可用**——习惯提案→审查→启用流程可直接复用此面                              |
| 持久化扩展惯例 | sessions-index "optional 字段 + undefined=关闭、永不迁移"惯例（`session-types.ts:95`）                                                                                                                         | **现成可用**——习惯库落独立 JSON/JSONL（对齐 usage-ledger 惯例），不动 index     |
| 设置开关惯例   | settings 开放式配置袋（memory/routing/lspDiagnostics/complexityGate 各节皆"optional + resolve 合并默认值"）                                                                                                    | **现成可用**——新增 `habits` 节零摩擦                                            |

结论：**八个承接面里六个现成可用，真正缺的只有"习惯"这个对象模型本身和它的挖掘调度器**——与总纲判断一致。

## §5 吸收方案（分层）

### 5.1 A 线（主线）：deepOrca 习惯反射闭环 —— System 1 落点

将 PHX 六段管道裁剪为 deepOrca 语境（coding-agent 而非数字体：事件源 = 会话内工具调用，触发上下文 = 用户 prompt + 项目上下文，不碰 OS 级事件）：

```
会话内事件采集（工具调用序列：bash 命令串 / 文件路径 / 顺序 / 时间/成功率）
  → [脱敏前置：命令参数中的密钥/token 模式、路径用户名，publish 前处理]
  → 本地模式挖掘（滑动窗口频繁子序列，纯统计零 LLM；挂 idle 窗口调度）
  → 候选习惯状态机（CANDIDATE→CONFIRMED→ACTIVE→DORMANT/DECLINING；
     五因子置信度 + 7 天半衰期衰减 + sourceEventIds 溯源）
  → 显式确认结晶：CONFIRMED 习惯 → 用户审查 → "反射技能"（DRAFT 起步）
  → 触发执行：确定性触发器命中 → 默认 SUGGEST（提示条建议，一键采纳）
     → 反复采纳积累成功率 → 低风险 + 权限 allow 项 → 可升级 AUTO_EXECUTE（留审计痕）
  → 执行反馈回写 SkillStats 式统计 → 反哺置信度（成功率高加固 / 失败降级 DORMANT）
```

deepOrca 落点建议（未来立 spec 时细化，本次不动）：

- **采集**：在会话回合提交处旁路追加习惯事件（JSONL append，对齐 usage-ledger 惯例），事件 schema 取 `TerminalEvent` 的核心五元组（command/args/exitCode/duration/cwd）+ 工具名 + 时间。
- **挖掘**：`packages/memory` 旁路或 `desktop/main/tools/habit-miner.ts`（数据属用户行为面，倾向 desktop 侧，core 保持 UI-free 且不被污染）；纯 TS 实现，无新依赖。
- **触发与建议**：SUGGEST 走既有 Toast/建议条 UI 面；触发条件评估复用路由嵌入通道（新增 telemetry stage `habit`）。
- **审查面**：复用 ActionsPanel/ReviewWorkspace 形态做"习惯提案"列表（触发原因/建议序列/影响评估三块详情）。
- **权限**：AUTO_EXECUTE 仅限 `sideEffects` 全为 read-in-cwd/query 类且用户显式开启；新增一个 scope 即可。
- **设置**：`settings.habits` 节（enabled 默认关 + 阈值可调），完全对齐既有 optional 节惯例。

### 5.2 B 线（次级理念，可独立吸收）

1. **FAST 快通道思想**（决策层）：简单任务跳过完整审议。deepOrca 的 depth-lane（轻轨/重轨）是**独立同构的第二实现者**——本报告可作为其哲学佐证回写 design 作论据；进一步可吸收"置信不足自动回退重轨"的显式降级语义。
2. **隐匿生成显式审查**：与 Plan Mode（`<proposed_plan>` 审批）和任务树理念同构，PHX 的增量是**详情四块结构**（触发原因/操作序列/备选方案 tradeoffs/影响评估）与**风险分级批量授权**（APPROVE_LOW_RISK）——批量授权值得未来在权限审批队列吸收。
3. **通知四级分级 + 聚合**：deepOrca Toast 现状无分级聚合；URGENT 唯一穿透位 + 角标静默默认值得吸收为通知演进方向（08B 与 `docs/notify.md` 对账时引用）。
4. **心跳式周期唤醒**：PHX 用 4 级心跳替代常驻等待；deepOrca 的 idle-time 调度（后台压缩 + LocalMemoryCleaner）已是同哲学实现，习惯挖掘调度器挂同一模式即可，无需新建心跳引擎。

### 5.3 不吸收清单（及理由）

| PHX 机制                                  | 不吸收理由                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OS 级事件钩子（键盘/剪贴板/进程/全局 UI） | deepOrca 是 coding-agent，采集面限定会话内；OS 钩子隐私面超范围且 Electron 权限模型不支持                                                                                                              |
| EvoMAS 参数进化 + 配置变异器              | 进化对象是 `Map<String,Double>` 数值参数向量，deepOrca 无此对象；GA/RL 闭环成本远超当前需求。**但其"验证+快照+谱系+回滚"四件套护栏思想**在任何"自动改配置"类功能（如 settings 自动调优）落地时必须继承 |
| 影子成员热备（议长 <1s 接管）             | 单进程 Electron 内无此可靠性需求；后台任务已有 CAS/join 协议                                                                                                                                           |
| A2A / ACP 协议栈                          | deepOrca 已有 MCP（客户端+内建 server 生态）+ runSubagent 派生面，外部 agent 协议线此前已有边界裁决                                                                                                    |
| 木偶师动态模型路由（四因子加权选模型）    | deepOrca 已有 model-catalog + 双传输通道（model-fleet-adaptation 已落地）+ 智能网关裁决线；思想重叠不重复建设                                                                                          |
| 技能 WORKFLOW 模板执行器                  | PHX 自身也标注未集成（simulateExecution 回退）；deepOrca 任务树 + 技能体系已覆盖                                                                                                                       |

## §6 与既有线的边界（防概念冲突）

- **memory-trigger-recall**（`specs/next-version/`，储备）：其"触发器"是**记忆召回侧**的检索线索（写入时预演未来查询语境），目标是联想性召回；本报告的"触发器"是**行为反射侧**的执行条件（模式命中即建议动作）。两者同名不同物，未来立 spec 时须显式区分命名（建议习惯侧用 reflex/habit 术语，避免再占用 trigger）。
- **activity-frames**：已有"行为帧"采集雏形，是 A 线事件采集段的天然上游；吸收时应先对账其 schema 再决定复用或旁路。
- **memory-audit / repair-rule-memory**：都是"从历史轨迹萃取规则"的写入侧先例（三段式：确定性证据→gap→LLM 合成）；习惯挖掘与其互补——它们萃取"该怎么做"（规则/SOP），习惯管道捕捉"你在怎么做"（行为模式），LLM 用量几乎为零是习惯线的独特优势。
- **depth-lane**：轻轨/重轨与 FAST/全议会同构（见 B-1），已在 review-ing 活跃，无需重复立项。

## §7 可移植参数速查表（PHX 实测值，吸收时直接对表）

| 参数                            | PHX 值                                                          | 吸收建议                                                                    |
| ------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| minOccurrences                  | 5                                                               | 保留（coding 场景重复频率低，可降到 3 观察）                                |
| minSuccessRate                  | 0.70                                                            | 保留                                                                        |
| confidenceThreshold（确认门槛） | 0.80                                                            | 保留                                                                        |
| 置信度五因子权重                | 频率 0.25 / 成功率 0.30 / 一致性 0.20 / 新近 0.15 / 上下文 0.10 | 保留（成功率权重最高是对的）                                                |
| 频率因子                        | `log10(count+1)/log10(11)`                                      | 保留                                                                        |
| 新近衰减                        | 指数 `0.5^(h/168h)`，备选 LINEAR/LOGISTIC                       | 保留指数 + 168h                                                             |
| 候选池                          | max 1000 / 近 100 次出现 / 30 天保留                            | 缩到 200/50/30（单用户单项目事件量小）                                      |
| 模式窗口                        | 长度 2–10，minSupport 3，允许间隔 ≤2                            | 保留                                                                        |
| FAST 直批                       | 单角色置信 >0.8 且风险 LOW                                      | 对应 SUGGEST→AUTO_EXECUTE 升级门：近 10 次采纳 ≥9 且 sideEffects 全 read 类 |
| 模式序列                        | maxPatternLength 10                                             | 保留                                                                        |
| 通知聚合                        | maxCount 10 / 5min 窗口 / URGENT 唯一穿透                       | B-3 吸收时对表                                                              |
| 心跳间隔                        | SYSTEM 30min / SERVICE 5min / TASK 30s / REALTIME 5s            | 习惯挖掘只需一档：idle 窗口 + 每日兜底                                      |

## §8 红线与风险

1. **隐私红线**：习惯事件含命令参数与路径——脱敏必须在写入前（PHX SensitivePattern 前置管道照搬），settings 提供完全关闭开关（默认关对齐 memory triggers 先例）。
2. **打扰红线**：默认 SUGGEST 永不 AUTO_EXECUTE；AUTO_EXECUTE 升级必须用户显式确认且限低风险副作用（PHX 审查界面 AUTO_EXECUTED 审计痕照搬）。
3. **fail-open**：挖掘/触发任一环失败静默退化，主会话回路零影响（对齐 compaction/memory 触发器纪律）。
4. **去抖空白自补**：PHX 触发器无冷却/去抖是已知设计空白——吸收时必须补（如同一会话同一习惯冷却 5min），否则建议条会刷屏。
5. **工程红线照常**：core UI-free、文件 2500 行标准、i18n 六目录、exact-pin、spec 先行（本报告不构成实现依据）。

## §9 后续

若立项：建议 spec 名避开 "trigger"（留给 memory-trigger-recall），如 `habit-reflex/`；A 线 P0 可做"纯观察期"（只采集+挖掘+候选列表展示，零触发动作），数据决策门定 SUGGEST 上线——与 depth-lane 的"P0 纯观察、数据门"节奏完全同构。届时本报告 §3/§7 直接作为 design 的参数依据，§5.1 作为落点草案，§6 作为边界声明。

> **✅ 已兑现（2026-09-28 同日）**：用户拍板写入 **next-version 主线 F**（`docs/features/next-version-plan.md`，含"V2 对 V3 差距综合补齐"定位、与主线 A E1 共享遥测层信封的咬合约束、启动顺序条目）并落地 spec **[`specs/next-version/habit-reflex/`](../../specs/next-version/habit-reflex/design.md)**（design.md：五类对象模型/六段管道/存储布局/共享遥测约束/配置权限/桌面面/F0–F4 分期/风险/不做清单 + tasks.md：F0 数据门 → F1 SUGGEST → F2 结晶 → F3 自动执行 → F4 可选，命名与术语全程避开 trigger）。本报告 §3/§7 已作为 design 参数依据，§5.1 的 desktop 侧倾向在 spec 中修正为"引擎归 core + IPC/UI 归 desktop"（挂点核证后定稿）。

## §10 回写（2026-09-28 同日）：完整集成可行性判定

**问题**：能否把 PHX 习惯管道**完整**集成进 deepOrca（而非仅吸收理念）？
**判定**：**能，且代价可控**——管道六段可 1:1 在 TS 重实现（零 Kotlin 代码复用，算法本就刻意朴素，无新依赖）；"完整"需接受三个**产品定位决定的结构性边界**（非工程缺口），并把 PHX 两处重机器换成本仓既有等价物。

关键挂点已代码级核证（本次回写时逐一定位）：

| 挂点         | 位置                                                                                     | 用途                                                 |
| ------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 事件采集位   | `core/tools/executor.ts:231`（`executeToolCall`）                                        | 工具调用旁路追加习惯事件，O(1) append 永不阻塞工具环 |
| 持久化范式   | `core/common/usage-ledger.ts`（`usageLedgerPath`/`appendUsageRecord`/`readUsageLedger`） | 习惯事件库直接克隆此三件套形态（per-project JSONL）  |
| 自动执行原语 | `core/actions/types.ts:100`（`ActionContext.runBackgroundTask`）                         | AUTO_EXECUTE 的后台执行通道（模糊技能走 LLM 后台跑） |
| 权限面       | `core/actions/types.ts:56`（`ActionDefinition.sideEffects`）                             | AUTO_EXECUTE 升级门直接喂既有桌面权限门              |

分层归属建议（较 §5.1 细化并修正倾向）：**引擎+存储归 core**（`core/habits/`，UI-free，与 compaction/usage-ledger 同层——事件在 core 工具环产生，数据按 projectCode 归 `~/.deeporca/projects/<code>/habits/`）；**IPC+审查 UI+SUGGEST 提示条归 desktop**（`main/habit-ipc.ts` 照 action-ipc 模式 + renderer 习惯面板）。

三级完整性口径：

- **管道完整（做满）**：六段全量重实现，P0–P3 四期，估 3–4.5k LOC（core ~1.5–2k / desktop ~1.2–1.5k 含 i18n 六目录 / 测试 ~0.8–1k），节奏照 depth-lane（P0 纯观察 + 数据门）。
- **换载体完整（等价替换，不照搬）**：习惯图谱在本仓数据规模（单用户单项目数百节点）用瘦版邻接表 + Jaccard 相似度替代 Leiden/FastRP（P4 可选，纯 TS 无阻塞，纯性价比取舍）；心跳引擎用 idle 窗口 + 轻量 app 级 timer 替代 4 级机器；MBC 审议由权限系统 + 审查 UI（+depth-lane）承担——FAST 哲学即 SUGGEST→AUTO_EXECUTE 升级门。
- **结构性不移植（即使"完整"也不来）**：剪贴板/进程/全局 UI 钩子（产品是 coding harness 不是系统级数字体）；EvoMAS GA/RL（无数值参数向量可进化，其"验证+快照+谱系+回滚"护栏留给未来 auto-tune）；影子热备/A2A/ACP。**一个可选扩展段**把完整性推到最接近 PHX：shell history 监听（PHX TERMINAL 钩子即读 `~/.zsh_history`，含 PLAIN/EXTENDED/YAML 三格式解析），能把事件域从"会话内"扩到"用户终端"——默认关、显式 opt-in、脱敏前置，P4。

必须自补项（PHX 已知空白）：触发器冷却/去抖；每习惯 kill switch；全链默认关。

---

_调研完成：PHX 八线文档一手精读（四路并行探查）+ 关键参数对源码/文档二次核证（置信度权重/半衰期/触发器类型逐条 grep 坐实）。零代码变更。_
