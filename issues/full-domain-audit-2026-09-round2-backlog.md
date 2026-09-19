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
3. ~~**repair-diff LCS 无界内存**~~ **已修（round-2）**：`diffSequences` 对超
   `MAX_SEQUENCE_UNITS`(1500) 的序列先做尾部裁剪再建表（失败簇与修复都在
   同任务分叉的轨迹尾部，语义无损；1500²≈18MB 上限），`parentLength`/
   `childLength` 仍报原始长度。回归 ×2（头部匹配出窗不进 spine、超限结果
   ≡ 显式尾裁等价）+ 变异验证 ×1（去上限→两条红）。

## 正确性（中）

4. ~~**AskUserQuestion 不暂停同批后续工具**~~ **已修（round-2）**：
   `appendToolMessages` 在某调用置 awaitUserResponse 后即中断批内执行；
   未执行调用回填合成 tool 消息（`ok:false, "Skipped: paused for a user
   question"`）保持 tool_call↔tool-message 1:1（悬挂 id 会被 provider 拒收），
   模型可见"未执行"并在应答后自行重发。端到端回归（mocked LLM 循环）：
   批内 bash 副作用在等待期间与 resume 后都不发生、状态机
   waiting_for_user→(reply)→completed、配对完整；变异验证 ×1（去 break→
   副作用发生断言红）。
5. ~~**arch-scan 修订轮验证所有历史 artifact**~~ **已修（round-2）**：
   `ArchVisualVerifier` seam 增可选 `{ sinceMs }`，arch-scan 以运行起点
   水位线传入；`verifyArchArtifacts` 按 IR mtime 严格新于水位线过滤
   （重交付的既有名会刷新 mtime 自然入scope；刻意不用 focus 名匹配——
   artifact 名是 LLM 起的）。知识面的 verify-everything 调用方不传参、
   行为不变。纯函数 `filterArtifactsSince` 回归 ×4 + 变异 ×1。
6. ~~**视觉回读 receipt 新鲜度**~~ **已修（并入 round-2 第 1 项：spawn 前 rmSync receipt）**。
7. ~~**compaction 守卫失败后重发超大 payload**~~ **已修（round-2）**：`compactSession`
   返回 `{applied}` 状态；autoRecovery 在 CONTEXT_WINDOW_EXCEEDED 分支检测
   `!applied` 即刻以可行动错误单次失败（不再两轮同型 doomed 往返后楔死）。
   回归 ×2（孤儿 tool 中段→guard applied:false 且零 LLM 调用；Stage-A
   trim-only→applied:true）+ 变异 ×1。
8. ~~**后台 LLM 任务 bash 不入 liveProcessKeys**~~ **已修（round-2）**：任务
   executeToolCalls 接全四个进程钩子（start/exit/stdout/timeout-control）；
   新增 `killProcessesForOwner(ownerId)`（前缀作用域），任务 finally 在
   aborted 时击杀在飞子进程（dispose 的 killLiveProcesses 仍为全局兜底）。
   回归：owner 作用域只清自身键 + 四钩子接线源守卫；变异 ×1。
9. ~~**interruptSession 不 flush 索引**~~ **已修（round-2）**：终态用户决策与
   create/delete/deny 同纪律绕过 250ms 去抖；回归：interrupt 后新管理器从磁盘
   直读即得 interrupted（变异 ×1 验证）。

## 死面清理（低，可批量）

10. **IPC 死通道已清（round-2 E-1）**：17 个零调用方通道整面摘除（wiki 写路径
    整组+onWikiProgress、design 四个、crg×2、codegraphList、memory×2、
    adjustBashTimeout、pluginSearchSkills、knowledgeOpenArchHtml、editorAgentCancel；
    wikiListPages 在用保留）——常量/处理器/preload/DesktopApi/事件载荷全层，
    ipc-contract 与 design-ipc 测试同步收敛。**其余未完**：279 个未引用 i18n 键
    ×6 语种（含 settings.memory.port）；17 个 declaration-only core 导出（含
    catalogEstimateCostUsd 双实现合一）——留 R2-E-2。
11. ~~memory `port`/`apiKey` 死配置~~ **已修（round-2 E-1）**：session-bridge 两处
    写入点停写 `port`（legacy 文件里的存量键不再被触碰也不再复活）；
    Resolved/Editable memory 形状剔除 port/apiKey（类型面同步）。
12. repair-rules `.html` 报告不清理（prune 只删 .json）。
13. `App.tsx` 2917 行 / `main/index.ts` 2815 行超 2500+10% 天花板——拆分任务。
14. ~~docs 残留~~ **已修（round-2 E-1）**：mcp.md/session-persistence.md 去 CLI
    时代表述；session 状态枚举补全 9 项 closed set。

## 已接受残差（不修，有论证）

- EndpointTest 主进程任意 URL fetch（≈保存端点同权限，无密钥泄露）；
- arch-preview 窗口无 CSP（子资源类残留，权限全拒 + sandbox 已设）；
- 主窗口 sandbox:false（preload 已 sandbox 兼容，翻转属大改单独立项）；
- writer 锚点标记抑制完整性（需 workspace 写权限，R7 同模型，已 surface）。
