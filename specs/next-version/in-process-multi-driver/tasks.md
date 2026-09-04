# 进程内多驱动并行 — 任务清单

> 对应设计：[design.md](./design.md)。2026-09-02 立稿，未实施。
> 已拍板（2026-09-02）：直接引入 `@ekaone/agent-relay`（desktop dependencies，锁精确版本），S0 为质量验证而非选型。
> 前提：core 内核不动，仅护栏小改；框架符号不得泄漏出 `main/driver-pool.ts`。

## S0 质量验证 + 锁版（先行）

- [ ] S0.1 `@ekaone/agent-relay` 装入 `packages/desktop` dependencies（**锁精确版本**）；冒烟：双 typed task 并行 + 独立 task 并行 + DLQ 触发 + TS 泛型质量评估 + esbuild 打包体积测量
- [ ] S0.2 验证结论与锁定版本回填 design.md §2.2；不达标启用备胎（actojs / p-queue，DriverPool 对内接口不变，仅换适配文件）

## S1 core 护栏（每项独立可测可回滚）

- [ ] S1.1 `replySession` 加 processing 守卫：同 session 二次投递 → 排队或结构化拒绝（design E2）
- [ ] S1.2 `GitFileHistory` per-project 串行队列，并发 git 命令无 index.lock 竞争（G1）
- [ ] S1.3 `silentSubagentActive` 改计数化/per-call（G4）
- [ ] S1.4 `maybeSyncCodegraphIndex` / `maybeSyncCrgIndex` 运行中互斥（G5）
- [ ] S1.5 `createSession` MAX_SESSION_ENTRIES 淘汰与并发 `updateSessionEntry` 交错审计（G2，审计结论决定是否需改）
- [ ] S1.6 双会话并发回归测试夹具（mocked-client，复用 `session-test-utils`）

## S2 DriverPool + IPC（桌面 main）

- [ ] S2.1 新文件 `main/driver-pool.ts`（≤500 行）：driver 状态机（idle→spawning→running→waiting/ask_permission/paused→terminal，状态源 = 该路 SessionEntryUpdated 事件映射，不自造第二真相）
- [ ] S2.2 agent-relay 映射：driver 生命周期 = typed task 流；spawn/send/cancel 经 in-memory bus；DLQ → failed 态 + driver.retry；并发上限 `MAX_CONCURRENT_DRIVERS=3`
- [ ] S2.3 背压：每路 prompt 队列深度 8，满则结构化拒绝；达到全局上限 spawn 拒绝并提示
- [ ] S2.4 调用面收敛到已有 API：`createSession` / `replySession(id)` / `interruptSession(id)` / `resumeSession`；框架类型不出 pool 文件
- [ ] S2.5 `shared/ipc.ts` 契约：`driverSpawn/Send/Cancel/Pause/Resume/List` + `DriverStateChanged` 事件（driverId↔sessionId 映射与队列深度）；preload 绑定；`main/index.ts` 注册（~30 行）
- [ ] S2.6 main 侧单测：状态机流转、背压触发、单路中断不影响他路、DLQ→retry、并发上限拒绝

## S3 渲染层多驱动 UI

- [ ] S3.1 新组件 `DriverDeck.tsx`：并行会话卡片（按 sessionId 分发现有三条事件流；复用 Message/ContextProgress 组件）
- [ ] S3.2 每路 interrupt/pause/cancel 控件 + 队列深度显示；旧单驱动对话视图行为不变
- [ ] S3.3 i18n 新键 ×6 locale

## S4 观测与调优

- [ ] S4.1 多路消耗视图：usage-ledger 按 sessionId/source 聚合（复用 2026-09 token 统计基建）
- [ ] S4.2 并发上限设置项（默认 3）；DeepSeek 前缀缓存命中率对比记录（并发前 vs 后）

## 验收（见 design.md §七）

同工作区 ≥2 路并发互不串流；单路中断只影响该路；并发下 file-history 无锁错误；旧路径零回归；agent-relay 符号 grep 不出现在 `driver-pool.ts` 之外；`npm run check && npm test` 全绿。
