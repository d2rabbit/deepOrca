# 全域审查 round-2 待办（2026-09-20，round-1 四角度审查产出）

Round-1 已修项见提交记录（root 守卫泛化 / git ref 注入 / CRLF frontmatter /
escapesRoot 中段遍历 / messageCache 幽灵 / paused 白名单 / dispose 状态泄漏 /
architecture.md 工具列表）。以下为**登记未修**项，按优先级排序：

## 主流程/性能（下一轮主项）

1. ~~**arch 视觉回读 spawnSync 阻塞主进程**（HIGH-MED）~~ **已修（round-2，2026-09-20）**：
   `arch-visual-verify.ts` 门② 与 `archify-layout-check.ts` 门① 均改异步
   `spawnTracked`（对齐 archify-cli 范式）；spawn 失败/超时降级诚实 skip 不抛出；
   顺带修两个潜伏缺陷——layout-check 原未设 `ELECTRON_RUN_AS_NODE=1`（打包环境
   门① spawn 的是应用本体）、门② spawn 前先清陈旧 receipt（早死子进程不再复活
   上轮判定，即原第 6 项）。回归：事件循环响应性测试 + spawnSync/env 源守卫
   （变异验证 ×2）。
2. ~~**流式进度每 delta 一条 IPC**~~ **已修（round-2）**：桥接层新增
   `llm-stream-progress-coalescer.ts`——按 requestId 45ms drop-only 时间窗
   （载荷是幂等 token 快照，"start"/"end" 恒直通，"end" 清态；renderer 侧本就
   250ms 合并 setState，此前白白支付每 delta 一条序列化 IPC）。注入时钟
   回归 ×7（100 同窗 delta→1 条；1000 delta/10 窗→≤11 条）；变异验证 ×1。
3. **repair-diff LCS 无界内存**（MED）：`repair-diff.ts:116-123` 全 DP 表，
   长轨迹 ×5 候选对可 OOM。加序列长度上限或 Hirschberg/分块。

## 正确性（中）

4. **AskUserQuestion 不暂停同批后续工具**：`session-manager-lifecycle.ts:1306-1322`
   顺序执行整批，awaitUserResponse 在批后才生效——`[AskUserQuestion, bash 写操作]`
   会在等待用户时执行副作用调用。
5. **arch-scan 修订轮验证所有历史 artifact**：`arch-scan.ts:147` 无范围过滤，
   legacy 产物可触发无关修订轮。
6. ~~**视觉回读 receipt 新鲜度**~~ **已修（并入 round-2 第 1 项：spawn 前 rmSync receipt）**。
7. **compaction 守卫失败后重发超大 payload**：`lifecycle.ts:526-536` + autoRecovery
   同型重试——不可配对簇会话楔死至历史变化。
8. **后台 LLM 任务 bash 不入 liveProcessKeys**：`session-manager-tasks.ts:811-819`
   缺 process 钩子，取消后子进程跑到自身超时。
9. **interruptSession 不 flush 索引**：250ms 窗口崩溃降级 resume 合成保真度。

## 死面清理（低，可批量）

10. 18 个无 renderer 调用方的 IPC 通道（wiki 写路径整组、design 四个、crg 两个等——
    清单见审查记录）；279 个未引用 i18n 键 ×6 语种；17 个 declaration-only core 导出
    （含 `catalogEstimateCostUsd` 与 desktop `token-pricing.ts` 双实现漂移）。
11. memory `port`/`apiKey` 死配置：settings.ts:111-119 + session-bridge.ts:818 持续
    复活死键。
12. repair-rules `.html` 报告不清理（prune 只删 .json）。
13. `App.tsx` 2917 行 / `main/index.ts` 2815 行超 2500+10% 天花板——拆分任务。
14. docs: mcp.md/session-persistence.md 残留 CLI 时代表述；session 状态枚举少
    `paused`/`permission_denied` 两项。

## 已接受残差（不修，有论证）

- EndpointTest 主进程任意 URL fetch（≈保存端点同权限，无密钥泄露）；
- arch-preview 窗口无 CSP（子资源类残留，权限全拒 + sandbox 已设）；
- 主窗口 sandbox:false（preload 已 sandbox 兼容，翻转属大改单独立项）；
- writer 锚点标记抑制完整性（需 workspace 写权限，R7 同模型，已 surface）。
