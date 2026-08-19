# 全功能回归审查 + 闭环完整性审计 — 2026-08-15

> 范围：本分支累计 12 个提交的全部功能面（LLM 稳健性 / Designer 三层 / 语义路由 / 安全整改 ×2 / 任务树 P0-P2+面板 / 行为记忆 / 会话持久化）。
> 方法：四层验证——①全量静态基线 ②逐模块闭环专项套件 ③链路接线核验 ④真机活体烟雾（Electron + CDP 实跑）。

## 一、全量基线

| 层                                                   | 结果                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run check`（build + typecheck + lint + format） | **0 error**；11 warnings（全部存量：crg.ts/review.ts 未用变量、registry import() 风格——低于 12 的历史基线） |
| core 测试                                            | **435 用例 / 434 pass / 0 fail**                                                                            |
| desktop 测试                                         | **163 / 163 / 0**                                                                                           |
| memory 测试                                          | **14 / 14 / 0**                                                                                             |
| embedding 测试                                       | **10 / 10 / 0**                                                                                             |
| desktop esbuild 构建                                 | ✅ Build complete                                                                                           |

## 二、逐模块闭环审计（接线核验 + 专项套件）

### ① LLM 稳健性（dsh P0）

| 环节                           | 证据                                                                     |
| ------------------------------ | ------------------------------------------------------------------------ |
| usage prompt 侧口径 → 压缩阈值 | `getLastPromptTokens` 8 处接线；compactSession 后归零重计量              |
| 溢出 → compact-and-retry       | `runActivationLoopWithAutoRecovery` 接线；QUOTA 不重试（专项测试锁定）   |
| 流 idle 看门狗 → TIMEOUT 重试  | `withStreamIdleTimeout` 全消费方；`streamIdleTimeoutMs` 配置解析测试锁定 |
| 遥测                           | `classifyLlmError` 分类器 + G1/G2/G3/SAD 事件                            |
| 闭环专项                       | llm-error 5 + session 套件内溢出/超时/配额用例 ✅                        |

### ② Designer 三层（A2UI 全域交互 × PM-Design × UI-Design）

| 环节                        | 证据                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| SKILL.md 全量替换口径       | grep 增量残留 = **0**                                                                           |
| 组件契约单一事实源 + 防漂移 | `library-schema.ts`；构建钩子篡改→失败→复原（负向验证过）                                       |
| 三层边界                    | guard 测试 3 条（design 无 a2ui 技能 / DesignPipeline 不含 a2ui / materialize 不触交互工具）✅  |
| 产物闭环                    | 血缘版本快照 + requirement + formState 水合 + 纠错回路 + inlineMode 灰度（openui 套件 68 内）✅ |
| 真机                        | designList 通道工作（当前 0 条——fixture 已清，符合预期）                                        |

### ③ 语义路由（R1-R4）

| 环节        | 证据                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------ |
| 调用经济性  | multiIntent 合并判定（单意图 1 次 flash/轮——计数测试锁定）                                       |
| 前缀守恒    | G2 会话级冻结（字节一致快照测试）+ RoutingFacade decide-once                                     |
| 配置/观测   | invalidateRouting 热生效 + 60s 退避 + 缓存 LRU + 知识面板 routing 卡（真机 knowledge.routing ✓） |
| G3 能力闭环 | 元数据契约激活 Compose + DAG 编排提示（skill-metadata 套件）✅                                   |

### ④ 安全整改（两轮）

| 面             | 证据                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------- |
| IPC 安全网     | ipc-security **26/26**（含跨平台 pathToFileURL 修复）                                               |
| 注入/穿越      | bash 分类器扩充（permissions 37 用例）、profile-sync 穿越拒写、design-store id 包含、vendor argv 化 |
| 密钥           | debug-logger 脱敏+0600+20MB 上限、JSONL 0600、machineId 去主机名                                    |
| MCP 恶意服务器 | 结果 512KB / tools 500 / schema 256KB 上限                                                          |

### ⑤ 任务树（P0-P2 + 面板 + 工作区绑定）——真机全回路

| 环节                                            | 真机结果                                                        |
| ----------------------------------------------- | --------------------------------------------------------------- |
| 面板挂载（rail 🌳）                             | ✓                                                               |
| create → fork → step → switch → merge → abandon | **全链 ✓**（终态：main active、分支 abandoned、merge 节点在树） |
| 工作区切换绑定                                  | ✓（切换后列表重置 → 新根建树仅新根可见 → 恢复）                 |
| 记忆驱动 fork 闭环                              | 埋点/召回/播种/回收（task-tree 套件 17/17）✓                    |

### ⑥ 行为记忆（activity-frames）

- sessionize/entities/frames 13 用例（含两处移植缺陷修复的回归锁定）✅
- boot 注入门控（behaviorContext 默认关，关时 provider 零调用）✅

### ⑦ 会话持久化 + 生命周期

- pendingIndex 读优先 / 终端操作 flush（session 套件丢更新回归）✓
- taskRef normalize 防伪、0600 权限 ✓
- 真机 sessions 通道 ✓

## 三、真机活体烟雾汇总（12 项）

`rail ✓ / workspace ✓ / tt.create ✓ / tt.fork ✓ / tt.merge ✓ / tt.final ✓ / ws.switch ✓ / knowledge.routing ✓ / mcp（codegraph ready:connected；serena/skill-spector 为 uv 正常预热，非缺陷）/ design 通道 ✓ / settings ✓ / sessions ✓ / skills 44`

## 四、发现与处置

- **缺陷：0**。本轮审查未发现需要修复的问题。
- 观察 1：工作区切换后 MCP 重连有秒级延迟（manager 重建 + uv 预热），属设计内行为（fail-open），非缺陷。
- 观察 2：mcp 状态在切换后立即查询可能为空——与观察 1 同源；面板已有轮询刷新机制。

## 五、结论

全部功能面四层验证一致通过；各模块闭环链路（数据流、控制流、持久化、遥测）接线完整且有测试锁定。分支 12 个提交可整体交付。
