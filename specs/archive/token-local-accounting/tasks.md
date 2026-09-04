# Token 本地统计重构 — 任务清单

> 对应设计：[design.md](./design.md)。2026-09-02 立稿并实施完成，勾选状态为实施后核验。

## P0 计数器（core）

- [x] P0.1 选型验证：`@tlibnx/tokenizer-deepseek_v4@4.0.0`（npm 存在性、API `fromPreTrained()`、EN/CJK/代码样本 smoke）→ 装入 core 依赖
- [x] P0.2 新建 `core/src/common/token-counter.ts`：家族路由（deepseek 精确 / 其他统一启发式）、动态 import fail-open、值缓存、`countTextTokens` / `countConversationTokens` / `countRequestPayloadTokens` / `countCompletionTokens`
- [x] P0.3 `compaction.ts` 旧 `estimateConversationTokens` 收敛为委托；导出 `PRE_COMPACT_RATIO = 0.9`；`session-manager-base` 旧 `estimateStreamTokens` 删除（徽章改用统一启发式）

## P1 引擎记账（core）

- [x] P1.1 新建 `core/src/common/usage-ledger.ts`（append-only JSONL、容断行、best-effort）
- [x] P1.2 收口点 `createChatCompletionStream` 记账：发送前 prompt（可传入预数）、流末 completion、三路径（流式/非流式回退/流中断）、返回 `localUsage`
- [x] P1.3 source 标注：主循环 `chat`（+预数）、compactSession `compaction`、后台任务 `background`、skills×2 / mcp 分解器 `auxiliary`
- [x] P1.4 主循环 pre-flight 预算（0.9×阈值先压再发）+ `activeTokens` 切换为本地计数 + entry `usage`/`usagePerModel` 累计本地值（UI 兼容）
- [x] P1.5 core 根导出 `usageLedgerPath` / `readUsageLedger` / `appendUsageRecord` + 类型

## P2 桌面端

- [x] P2.1 `main/tools/token-pricing.ts`：内置价表 + `estimateCostUsd`（未命中 → null）
- [x] P2.2 `tokens-summary.ts`：ledger 精确时间窗（`now` 可注入）+ 近似回退 + `windowsApproximate` + `costUsd` + `migrateLegacyUsageIntoLedger()` 一次性回填（幂等）
- [x] P2.3 IPC handler 接迁移；`shared/ipc.ts` 类型扩展
- [x] P2.4 `TokenStatsPanel` 改消费 `api.tokensSummary(root)`；App 传 `root` + `refreshKey`；`formatUsd`；cache 无数据 "—"
- [x] P2.5 i18n 新键 `tokens.costEstimate` / `tokens.cacheUnavailable` ×6 locale
- [x] P2.6 electron-builder `files` 排除 tokenizer 包冗余构建（~20MB；`*.map` 原已全局排除）

## 测试与文档

- [x] T1 `token-counter.test.ts`（启发式精确断言 / payload 覆盖 / 真实 BPE 对拍 / 缓存一致性）
- [x] T2 `usage-ledger.test.ts`（roundtrip / 缺文件与断行容错 / 路径布局）
- [x] T3 改写 8 个旧 API-usage 语义用例（session×6 / compaction×2，触发类改真实大 payload 驱动）；`background-task` 零残留断言排除 ledger（有意残留）
- [x] T4 桌面 `tokens-summary.test.ts` +4（精确窗 / 近似回退 / 迁移幂等 / 成本）
- [x] T5 mutation-check：禁用账本写入 → 3 个记账测试红 → 还原复绿
- [x] T6 AGENTS.md 增补第 7 条不变量（usage ledger + 本地口径）
- [ ] T7 打包产物实测（`desktop:start` 真机跑一次 tokenizer 精确路径 + 安装包体积核验）——**backlog，需要真机打包环境**（2026-09-03 归档拍板：移交预生产真机测试清单）
