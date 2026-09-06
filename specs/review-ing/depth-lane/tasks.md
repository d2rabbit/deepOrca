# 深度车轨（depth-lane）· 复杂性路由双轨制 — 任务清单

> 对应设计：[design.md](./design.md)。2026-09-03 立稿，未实施。
> 拍板项（按 design §7 建议默认值，开工时逐项确认）：① L2 并入 `identifyMatchingSkillNames` 单调用；② v1 不允许 express→deep 中途升级；③ 重轨直接开跑不先问，靠预算上限兜底；④ 重轨子代理 silent 零残留。
> 前提：core 分层铁律；`createSession` 稳定前缀（MOST→LEAST）一行不动、新注入全走瞬态尾部；fail-open 三路径（无 client/解析失败/超时中止 → express）；`complexityGate.enabled: false` 时字节级等价。

## P0 网关与观察（零行为变化，纯采集）

- [x] P0.1 `core/routing/gate/gate.ts` + `gate-prompt.ts`：L1 启发式规则表（planMode→deep；纯图片→express；关键词快规则；历史追问率）+ L2 评分 prompt（四维标准原文 + 禁止自报 lane）+ `lane` 由程序按 `T+P+C+R ≥ threshold` 计算 — 已落 `routing/gate/gate.ts`（evaluateL1Rules/computeLane/parseTpcrScores）与 `gate-prompt.ts`（COMPLEXITY_SCORING_DIRECTIVE），lane 一律程序计算、模型自报 lane 字段解析器根本不读
- [x] P0.2 `identifyMatchingSkillNames` flash 调用返回扩展 `lane/tpcr`（拍板项 ①：并入单调用）；严格 JSON 解析（非法/缺失/无 client/超时/中止 → express） — `session-manager-skills.ts` matchSkillsWithVerdict（新入口）+ `templates/auxiliary/skill-matching.md.ejs` `complexityDirective` 槽位（禁用时字节级等价，测试锁定）+ 内联 fallback 同步扩展；四条 fail-open 路径全部有测试
- [x] P0.3 缓存：复用 `SkillMatchCache` 模式（同 prompt 同池 replay），`lane` 键与 skill 匹配合并 — `common/skill-match-cache.ts` 增 `getWithLane`/`set(..., verdict)`，同 key 同淘汰策略，单一缓存无第二套；disabled 时代缓存条目在 enabled 后 replay 为 fail-open express（测试覆盖）
- [x] P0.4 `SessionEntry.lane`（`session-types.ts`，可选字段向后兼容）写入 createSession — `session-types.ts` 可选字段 + `session-manager-persistence.ts` normalizeSessionEntry 白名单 + `session-manager-lifecycle.ts` recordLaneVerdict；image-only/plan-mode 无文本路径也经 L1 记 lane（零 LLM 调用）
- [x] P0.5 `settings.ts` 新增 `complexityGate` 节（enabled 默认 false / threshold 50 / autoTune false / maxPaths 3 / maxRounds 3 / depthLaneEnabled false） — `ComplexityGateSettings` + `resolveComplexityGateSettings`（threshold 钳制 [1,100]、maxPaths/maxRounds 硬钳 [1,3]），并入 ResolvedDeepcodingSettings 与 quarantine 安全钳制
- [x] P0.6 轻轨瞬态指令（`getCurrentTurnTail` 同款：转换时注入、不入 JSONL/缓存前缀）；`R=20` 且总分 <50 时追加安全提示 — `session-manager-base.ts` buildCurrentTurnTail 钩子 + `session-manager-depth.ts` buildLaneTurnTail（express 指令/riskNote、deep 的 Gate Directive 仅非零维度），走 OpenAIMessageConverter.applyTurnTail 瞬态尾部
- [x] P0.7 遥测：lane 分布、express 平均成本 vs 现状基线、重轨误判率（usage-ledger source） — `routing/gate/gate.ts` summarizeLaneTelemetry（lane 分布+按 source 均值）+ `routing/telemetry.ts` G0 事件 + `common/usage-ledger.ts` 新 source `"depth-lane"`（staged 流程所有编排调用经此记账）
- [x] P0.8 测试：`complexity-gate.test.ts`（L1 逐条 / 解析确定性 / 缓存 / 阈值边界 / fail-open 四路径）；回归：`enabled: false` 字节级等价、`skillNames/multiIntent` 行为不回归 — 30 tests 全绿；skill-matching 模板禁用态与 pre-feature 渲染字节级相等（测试锁定）；session-skills-mcp 18 tests 零改动全绿；变异测试（>= 改 > 阈值边界测试变红后还原）
- [ ] P0.9 数据决策门报告 — **首轮真机观察（2026-09-04 GVGL 批）**：网关五路径全命中（l1-keyword/l2-flash/fail-open/G0 遥测）；该端点 L2 空评分率 2/4（fail-open 全部正确兜底——观察日志项）；重轨全链真机 102s/37msg/六段报告齐全。正式占比报告待 enabled 生产开启后积累（express 占比、误判率；>90% 阈值下砍重轨，只留轻轨指令 + 追问率提示）— 未启动；**观察期自 `complexityGate.enabled` 翻开即开始采集**（lane 落 sessions-index、G0 事件与 depth-lane 记账落 usage-ledger），无需再等任何代码

## P1 重轨最小链（S1 → S2 → S4 → S5）

- [x] P1.1 `core/session-manager-depth.ts` 新层（≤2500 行标准内）：5 阶段状态机骨架 + `AbortController`/`throwIfAborted` 中止传播 + 预算上限 — 729 行，组合链尾部（Tasks → **Depth** → SessionManager）；每阶段边界 throwIfAborted，stageController 采纳外部中断并登记 sessionControllers 供 interruptSession 命中
- [x] P1.2 S1 情境编译：复用既有 prompt 链；Gate Directive 瞬态块（仅注入非零维度得分，转换时注入） — S1 = 既有 activateSession 主循环 + buildGateDirective 瞬态尾部（dims 为 0 的维度不渲染）
- [x] P1.3 S1.5 证据闸：确定性判定优先（引用文件/搜索结果条数与覆盖 ≥ 阈值），不足 → flash 兜底 → 子循环补充检索 — countSessionEvidence（≥2 条 read/bash/WebSearch/WebFetch 结果）→ judgeViaLlm 兜底（null = fail-open 视为充足）→ runBackgroundLlmTask(review profile, 80 轮上限) 补充检索
- [x] P1.4 S2 分歧生成 K=2：`runSubagent({silent: true})` ×1 + 主会话 1 路，两路立场 prompt（乐观/保守），产出「路径 + 置信度 + 关键假设」；K=1 串行退化跳过 S3 — stances [乐观/保守]；主路径单次 aux 调用（source "depth-lane"）+ 1 个 silent 子代理；K=1 退化有测试
- [x] P1.5 S4 融合校准：单次汇总调用（输入 = K 路结果），收敛判据（置信度归一极差 <15% 或轮次 >maxRounds） — runFusion 单次编排调用 + isConverged（极差 <15 严格）；maxRounds 硬钳 ≤3
- [x] P1.6 S5 判定输出：深度决策报告（复用 `<proposed_plan>` 块契约渲染），结构「判定 + 置信度 + 分歧点 + 关键假设 + 风险红线 + 下一步」，结论先行段置顶 — emitDepthReport 渲染 `<proposed_plan>` 块（模板 templates/prompts/depth-lane.md.ejs report 段），结论先行段置顶、未收敛时带 ⚠️ 提示
- [x] P1.7 集成测试（桩 LLM）：简单任务必走 express 且 token 同量级；复杂任务必走 deep 且输出 5 段结构；**变异测试**收敛判据写反必红；轮次上限兜底输出「未收敛 + 已给证据」 — `depth-lane.test.ts` 10 tests 全绿（S1→S5 happy path 五段结构/express 旁路/轮次上限 3 轮硬顶/中断/S1 暂停退化/编排失败 fail-open）；变异测试对阈值比较执行（>= → > 边界测试红后还原）
- [ ] P1.8 `depthLaneEnabled` 观测期：默认 false，P1.7 通过后于内测环境开启 — 代码就绪（默认 false），等待内测环境实际翻开

## P2 对抗与自适应

- [x] P2.1 S3 red-team 子代理（击穿测试：反例/被忽略约束/不可逆风险） — runRedTeam 单个 silent 子代理，输出 {brokenPaths/ignoredConstraints/irreversibleRisks/verdict}；不可逆风险在 S5 报告「风险与红线」顶部标记需用户拍板（v1 以报告内仲裁替代阻塞式 AskUserQuestion，见交付说明的偏差记录）
- [x] P2.2 S2 回边：不收敛 → 带对抗反馈重生成（轮次上限硬性） — 收敛判据失败时 red-team 发现注入下一轮 divergence prompt（"Previous-round red-team findings"），轮次 > maxRounds 硬停并输出「未收敛 + 已给证据」；回边恰好一次 + 反馈携带验证有测试
- [x] P2.3 阈值遥测口径实现 — `routing/gate/lane-rates.ts`：追问率（10 分钟窗口 + 确定性 bigram 重叠首版，embedding 余弦经 `similarity` 插槽即插即用）+ 负反馈率（6 语言词表含繁体）；lane-rates.test.ts 7/7。**真实历史首跑（2026-09-04，GVGL+本仓 3 会话）**：追问率 0.33（GVGL 重复提问真实命中）、deep 率 null（无 deep 会话，诚实未定义）。设置面板只读展示已落地（`laneRates:get` root-pin IPC + 独立「回答模式」设置 tab 内的观察区块，i18n×6；2026-09-05 产品术语重组：轻轨/重轨/车道观察 → 快速模式/深度模式/回答模式，核心注入指令与模板同步）
- [x] P2.4 `autoTune` 公式 — `lane-rates.ts autoTuneThreshold`（±5 步进、钳制 [30,70]、null 率=无信号不动、formula 串即审计行）；**真实输入校准**：50 + 0.33*0.5 − 0 → 50.17（行为正常）。默认关闭不变（自动调参开闸仍需生产数据量）

## X 桌面最小面

- [x] X.1 lane 徽标（会话卡，只读展示，不参与路由决策）— `LaneBadge.tsx`（express ⚡青/deep ▤琥珀双胶囊；设计链 mmx 生成参考 + VLM 14px 修正：纯色去渐变/去外框/粗杆短尾/粗条分层，参考图 `designs/lane-badge-reference.jpg`）；lane 经 SerializableSessionEntry spread 自动到 renderer，零 IPC 改动；dom-harness 测试 4/4
- [x] X.2 i18n 新键 ×6 locale — sidebar.laneExpress/laneDeep/laneExpressTip/laneDeepTip 四键 ×6 目录（Record 完整性类型强制通过）；消息气泡位未做（会话卡已覆盖可见性，气泡位等真机反馈再定）
- [x] X.3 重轨阶段进度事件 — core `onDepthLaneProgress` seam（S1→done 全转移发射，best-effort 不入 lane）→ `IpcEvent.DepthLaneProgress`（root 戳）→ preload → `DepthLaneProgressStrip`（消息区上方阶段条，完成 4s 自隐；depth-lane.test 阶段序列断言 s1/s1.5/s2#1/s3#1/s4#1/s5#1/done）；进度条随 X 批次接入消息区（DepthLaneProgressStrip）
- [ ] X.4 真机冒烟 — **移交功能测试清单**（[docs/functional-test-checklist-2026-09-04.md](../../docs/functional-test-checklist-2026-09-04.md) C1-C5/G 节，用户执行）

## 收尾

- [ ] 收尾 1：P0–X 全部通过后，`git mv specs/next-version/depth-lane specs/depth-lane` 转活跃 spec；`specs/next-version/README.md` 与 `specs/README.md` 台账同步改写
- [ ] 收尾 2：回写 `docs/research/2026-09-03-smart-gateway-dual-lane-adaptation.md` 台账行消费状态（✅/🟡 + 一行证据）
- [ ] 收尾 3：`npm run check && npm test` 全绿；提交走 Conventional Commits（`feat(depth-lane): …`）

## 追加批次（2026-09-05，用户反馈四项 + 动画/编辑器性能）

- [x] 编辑器 `onDidScroll` 运行时崩溃修复（Monaco 真实事件为 onDidScrollChange；双名守卫 + 缺失退化 resize）
- [x] token hub 标题行右侧「模型热力图」按钮（数据态头部漏渲染补齐）
- [x] 「车道」独立设置 tab 承载观察区块（移出「关于」页）
- [x] 重轨报告专属渲染 DepthReportCard（六段结构化卡片 + 置信度条 + 不可逆风险置顶 + 「落为任务轨迹」播种 taskTreeCreate）+ lib/depth-report.ts 解析器（完整块才触发；计划模式提案/流式半块不误触）真值表 4/4
- [x] 动画调研 P0 落地（docs/research/2026-09-03-motion-react-animation-prestudy）：motion 13.2.0 / ui/motion.tsx（LazyMotion strict + 动态 domAnimation chunk + MotionConfig reducedMotion=user）/ ui-main sheet 六分支 AnimatePresence 进出场（CSS ui-sheet-in 退役）/ Toast·QuickDock·设置弹窗 exit / 9 个 ui-css 补 prefers-reduced-motion / motion-wiring jsdom 测试（onExitComplete 契约）
- [x] 编辑器打开提速：scheduleMonacoWarmup（launch 后 idle 预取 EditorWorkspace chunk + ~5MB Monaco 核心 + TS worker 配置），首次打开从「点击→串行加载」变为缓存命中即开
