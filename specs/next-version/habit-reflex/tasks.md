# 习惯反射（habit-reflex）— 任务清单

> 对应设计：[design.md](./design.md)。2026-09-28 立稿，方案稿（未开工，随主线 F 于 `next/*` 启动）。
> 上游调研：[docs/research/2026-09-28-phx-system1-habit-absorption-prestudy.md](../../../docs/research/2026-09-28-phx-system1-habit-absorption-prestudy.md)（PHX 六段管道一手精读 + 参数核证）。
> 红线：**全链默认关**（关 = 零采集零挖掘零触发，行为与现状逐字节一致）；脱敏在写入前；fail-open（任一环失败静默退化，工具环与 LLM 回路零感知）；AUTO_EXECUTE 永不默认；禁用 "trigger" 术语；不改 sessions-index 与 memory 包；core UI-free。

## F0 采集 + 存储 + 挖掘 + 候选观察（纯观察期）

- [ ] **F0.1** `core/habits/types.ts`：HabitEvent / HabitCandidate / Habit / ReflexRule / ReflexExecutionRecord 五类 + 脱敏规则表（password/api-key/token/credit-card/email/URL 参数 + 双平台路径用户名）
- [ ] **F0.2** `core/habits/store.ts`：克隆 usage-ledger 三件套（path/append/read + 5MB 分片轮转）；candidates.json / habits.json 原子写
- [ ] **F0.3** `core/tools/executor.ts` 挂点：`executeToolCall` 完成后旁路追加 HabitEvent（O(1)、fail-open、永不阻塞工具环）
- [ ] **F0.4** `core/habits/miner.ts`：滑动窗口频繁子序列枚举（窗口 2–10 / minSupport 3 / 允许间隔 ≤2）+ 五因子置信度（0.25/0.30/0.20/0.15/0.10 + `log10` 频率 + 168h 指数衰减）+ 候选状态机（CANDIDATE→CONFIRMED，确认门 0.8）+ 候选池治理（200/50/30）
- [ ] **F0.5** 调度：idle 窗口触发挖掘（同后台压缩双触发点先例）+ 每日兜底 timer；`settings.habits` 节（enabled 默认关 + 阈值字段）
- [ ] **F0.6** desktop：候选只读列表（最小 IPC：list 单方法 + 面板骨架）
- [ ] **F0.7** 测试：开关关=行为对照基线（零事件零文件）；注错 fail-open（工具环零感知）；脱敏规则真值表（含 argsHash）；挖掘/置信度/衰减纯函数单测；mutation-check 一次
- [ ] **F0.8** **数据决策门**：观察期（建议 ≥2 周）导出候选清单，人工评定"确为习惯"比例 **≥ 60%** 才拍板放行 F1（对照 depth-lane P0 节奏；不放行则本线停在观察并归档数据）

## F1 触发评估 + SUGGEST

- [ ] **F1.1** `core/habits/evaluator.ts`：三挂点评估（SEQUENCE=工具调用后内联 / CONTEXT=会话启动 / TIME=应用 timer）+ **冷却/去抖三重闸**（同规则同会话 5min + 单规则单会话上限 2 + 全局单会话上限 5）
- [ ] **F1.2** SUGGESTION 事件沿会话事件流发出 + desktop `event:habitSuggestion` 通道 + 提示条 chip（规则名 + 命令序列 + 置信度，一键采纳/忽略）
- [ ] **F1.3** 采纳流：规则具现化为预填 prompt（用户回车发出，走正常会话回路）；忽略/忽略全部记忆（本会话不再提示该规则）
- [ ] **F1.4** 测试：三类触发真值表；冷却/上限拦截；SUGGESTION 端到端（core 事件 → IPC → chip → 采纳预填）；evaluator 注错零影响

## F2 结晶 + 审查面板

- [ ] **F2.1** 结晶流：CONFIRMED → 用户确认 → ReflexRule（DRAFT→ACTIVE，steps 为确定性命令数据）+ 版本快照（上限 10，可回滚）+ 同名 SKILL.md materialize（对技能发现栈可见）
- [ ] **F2.2** `main/habit-ipc.ts` 五方法（list/confirm/reject/disable/settings，registered-root 守卫）+ 习惯审查面板（提案列表 + 详情三块：触发原因证据回放 / 建议命令序列 / 影响评估）
- [ ] **F2.3** `core/habits/executions.ts`：ReflexExecutionRecord 落库（adopt 模式）
- [ ] **F2.4** i18n 六目录全量键 + 面板接进 rail/入口（对齐既有面板惯例）
- [ ] **F2.5** 测试：结晶全链（确认→DRAFT→ACTIVE→SKILL.md 落盘）；快照回滚；IPC 契约漂移测试；i18n 完整性（typecheck 强制）

## F3 AUTO_EXECUTE + 反馈闭环

- [ ] **F3.1** 升级门三条件（近 10 次采纳 ≥9 + sideEffects 全 read-in-cwd/query 硬校验 + `settings.habits.autoExecute` 显式开启）；任一不过回落 SUGGEST
- [ ] **F3.2** `PermissionScope` 增 `auto-execute` + AUTO_EXECUTE 走 `ActionContext.runBackgroundTask`（复用后台任务徽标面）+ AUTO_EXECUTED 审计痕
- [ ] **F3.3** 反馈回写：ReflexExecutionRecord → statistics.successRate → confidence 回写；连续失败 → DORMANT（停触发）→ DECLINING（清理）
- [ ] **F3.4** 测试：三门缺一回落断言；审计痕完整性；失败降级状态机；autoExecute 关闭时零自动执行对照
- [ ] **F3.5** 真机走查：观察一周建议命中率/误报率/采纳率，回写本文件与调研报告台账

## F4 可选扩展（单独立项评估，不阻塞主线）

- [ ] F4.a shell-history 事件域扩展（默认关 opt-in；PHX TERMINAL 钩子三格式 PLAIN/EXTENDED/YAML 解析经验对表；隐私评估前置）
- [ ] F4.b 瘦版习惯图谱（邻接表 + Jaccard 相似度，"经常一起做/模式相似"推荐；Leiden/FastRP 明确不做）
- [ ] F4.c 通知分级聚合（PHX 四级 + maxCount 10/5min 窗口 + URGENT 唯一穿透；与 `docs/notify.md` 对账）
