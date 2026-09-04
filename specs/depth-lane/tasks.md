# 深度车轨（depth-lane）· 复杂性路由双轨制 — 任务清单

> 对应设计：[design.md](./design.md)。2026-09-03 立稿，未实施。
> 拍板项（按 design §7 建议默认值，开工时逐项确认）：① L2 并入 `identifyMatchingSkillNames` 单调用；② v1 不允许 express→deep 中途升级；③ 重轨直接开跑不先问，靠预算上限兜底；④ 重轨子代理 silent 零残留。
> 前提：core 分层铁律；`createSession` 稳定前缀（MOST→LEAST）一行不动、新注入全走瞬态尾部；fail-open 三路径（无 client/解析失败/超时中止 → express）；`complexityGate.enabled: false` 时字节级等价。

## P0 网关与观察（零行为变化，纯采集）

- [ ] P0.1 `core/routing/gate/gate.ts` + `gate-prompt.ts`：L1 启发式规则表（planMode→deep；纯图片→express；关键词快规则；历史追问率）+ L2 评分 prompt（四维标准原文 + 禁止自报 lane）+ `lane` 由程序按 `T+P+C+R ≥ threshold` 计算
- [ ] P0.2 `identifyMatchingSkillNames` flash 调用返回扩展 `lane/tpcr`（或并行同参数调用，拍板项 ①）；严格 JSON 解析（非法/缺失/无 client/超时/中止 → express）
- [ ] P0.3 缓存：复用 `SkillMatchCache` 模式（同 prompt 同池 replay），`lane` 键与 skill 匹配合并
- [ ] P0.4 `SessionEntry.lane`（`session-types.ts`，可选字段向后兼容）写入 createSession
- [ ] P0.5 `settings.ts` 新增 `complexityGate` 节（enabled 默认 false / threshold 50 / autoTune false / maxPaths 3 / maxRounds 3 / depthLaneEnabled false）
- [ ] P0.6 轻轨瞬态指令（`getCurrentTurnTail` 同款：转换时注入、不入 JSONL/缓存前缀）；`R=20` 且总分 <50 时追加安全提示
- [ ] P0.7 遥测：lane 分布、express 平均成本 vs 现状基线、重轨误判率（usage-ledger source `"auxiliary"`）
- [ ] P0.8 测试：`complexity-gate.test.ts`（L1 逐条 / 解析确定性 / 缓存 / 阈值边界 / fail-open 四路径）；回归：`enabled: false` 字节级等价、`skillNames/multiIntent` 行为不回归
- [ ] P0.9 数据决策门报告（express 占比、误判率；>90% 阈值下砍重轨，只留轻轨指令 + 追问率提示）

## P1 重轨最小链（S1 → S2 → S4 → S5）

- [ ] P1.1 `core/session-manager-depth.ts` 新层（≤2500 行标准内）：5 阶段状态机骨架 + `AbortController`/`throwIfAborted` 中止传播 + 预算上限（maxPaths≤3 / maxRounds≤3 / 子循环迭代 ≤80）
- [ ] P1.2 S1 情境编译：复用既有 prompt 链；Gate Directive 瞬态块（仅注入非零维度得分，转换时注入）
- [ ] P1.3 S1.5 证据闸：确定性判定优先（引用文件/搜索结果条数与覆盖 ≥ 阈值），不足 → flash 兜底 → 子循环补充检索（ReAct 回边）
- [ ] P1.4 S2 分歧生成 K=2：`runSubagent({silent: true})` ×1 + 主会话 1 路，两路立场 prompt（乐观/保守），产出「路径 + 置信度 + 关键假设」；K=1 串行退化跳过 S3
- [ ] P1.5 S4 融合校准：单次汇总调用（输入 = K 路结果），收敛判据（置信度归一极差 <15% 或轮次 >maxRounds）
- [ ] P1.6 S5 判定输出：深度决策报告（复用 `<proposed_plan>` 块契约渲染），结构「判定 + 置信度 + 分歧点 + 关键假设 + 风险红线 + 下一步」，结论先行段置顶
- [ ] P1.7 集成测试（桩 LLM）：简单任务必走 express 且 token 同量级；复杂任务必走 deep 且输出 5 段结构；**变异测试**收敛判据写反必红；轮次上限兜底输出「未收敛 + 已给证据」
- [ ] P1.8 `depthLaneEnabled` 观测期：默认 false，P1.7 通过后于内测环境开启

## P2 对抗与自适应

- [ ] P2.1 S3 red-team 子代理（击穿测试：反例/被忽略约束/不可逆风险），与 `review.full`（CRG+OCR）共用风险扫描基础；存在不可逆决策时调用一次 `AskUserQuestion`
- [ ] P2.2 S2 回边：不收敛 → 带对抗反馈重生成（轮次上限硬性）
- [ ] P2.3 阈值遥测口径实现：轻轨追问率（10 分钟内新消息 + embedding 余弦相似）、重轨负反馈率（6 语言正则 + 1 星反馈）；报告进设置面板只读展示
- [ ] P2.4 `autoTune`：提案公式 `新阈值 = 旧阈值 + 追问率*0.5 − 负反馈率*0.5`，±5 步进、钳制 [30, 70]、每次变更写审计日志、默认关闭

## X 桌面最小面

- [ ] X.1 lane 徽标（会话卡/消息气泡，只读展示，不参与路由决策）
- [ ] X.2 i18n 新键 ×6 locale（en 源 / zh / zh-tw / zh-hk / ja / ko，`Record<MessageKey, string>` 完整性类型强制）
- [ ] X.3 可选：重轨阶段进度事件（先在 `shared/ipc.ts` 定义通道常量再双边接线；禁止 renderer ad-hoc `ipcRenderer`）
- [ ] X.4 真机冒烟：徽标展示、重轨阶段进度流、`interruptSession(sessionId)` 中断/暂停语义、权限/沙箱路径不受影响

## 收尾

- [ ] 收尾 1：P0–X 全部通过后，`git mv specs/next-version/depth-lane specs/depth-lane` 转活跃 spec；`specs/next-version/README.md` 与 `specs/README.md` 台账同步改写
- [ ] 收尾 2：回写 `docs/research/2026-09-03-smart-gateway-dual-lane-adaptation.md` 台账行消费状态（✅/🟡 + 一行证据）
- [ ] 收尾 3：`npm run check && npm test` 全绿；提交走 Conventional Commits（`feat(depth-lane): …`）