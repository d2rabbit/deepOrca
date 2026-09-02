# Token 本地统计重构（token-local-accounting）— 设计

> **日期**：2026-09-02 立稿（P0/P1/P2 已随本 spec 落地；本文为实施后的定稿设计）
> **触发**：用户两轮指令——① 旧 token 统计方案不完善，重构计数算法；② 记账口径切为**纯本地**（chat 兼容 API 的 usage 响应不参与统计，仅静默留存）。
> **调研基线**：业界横评（Claude Code / aider / Cline / Codex CLI / opencode）+ arXiv（context engineering 综述 2507.13334、compaction 系 2605.23296 / 2606.22528、tokenizer 公平性 2510.09947 等）。

---

## 一、动机（重构前缺陷，均有代码证据）

1. **丢账两洞**：`runBackgroundLlmTask` 自带 LLM 循环但从不写 usage；`runSubagent(silent)` 记账后即 `deleteSession`，账随 entry 一起消失（tokens-summary 头注释与实现不符）。
2. **无请求级时间戳**：只有会话累计 + `updateTime`，last5h/today/thisWeek 只能近似归因。
3. **两套互相矛盾的估算器**：compaction 的 CJK=1/字·4字/token 与流式徽章的 0.6/0.3 并存；且都漏系统提示链、工具 schema、tool_calls 参数（实测系统链 ~22K tokens）。
4. **compaction 滞后一拍**：`activeTokens` 取自上一响应的 API usage，首次超限请求必然先撞墙（业界 Cline 同病）。
5. **无真实词表计数**：对代码与中英混排误差 ±30–50%。

## 二、定稿设计

### 2.1 三条红线

1. 本地计数 = 唯一统计口径；API usage 仅 `apiUsage` 字段静默留存（未来校准系数用）。
2. 账本独立落盘，不碰 `pendingIndex` 防抖写路径。
3. core UI-free：tokenizer 动态 import + fail-open（对齐 `routing/embedding-loader.ts` 先例）。

### 2.2 唯一收口点（P1 核心）

所有 LLM 流量（对话 / compaction / 后台任务 / 技能匹配 / prompt 增强 / 分解器）都过 `createChatCompletionStream()`（`session-manager-base.ts`）。收口点内三动作：

- **发送前**：`countRequestPayloadTokens`（主循环预数后经 `accounting.promptTokens` 传入，免二次计数）；
- **流中**：启发式增量喂 UI 徽章（实时性优先）；
- **流末**：`countCompletionTokens` 对累计全文精确计数（不逐 delta——BPE 边界）。

覆盖流式成功 / 非流式回退 / 流中断（prompt 照记 + 部分完成）三条路径。**两个丢账洞由此结构性消除。**

### 2.3 TokenCounter（P0，`core/src/common/token-counter.ts`）

- 家族路由（复用 `resolveModelSpec`）：deepseek → `@tlibnx/tokenizer-deepseek_v4`（128,256 词表精确 BPE，npm 包已验证、已装依赖）；其他 → 统一启发式（CJK 1 token/字 + ASCII ⌈n/4⌉，偏保守——宁可早压不可爆窗）。
- 值缓存（Map，2048 条 FIFO）：历史消息跨迭代免重算。
- payload 级计数含：系统链、工具 schema、tool_calls 参数 JSON、多模态图片固定常量（1024）、每消息 overhead（12）。

### 2.4 Pre-flight 预算（P1.5）

主循环 `buildMessages` 后即计数，`≥ PRE_COMPACT_RATIO(0.9) × 阈值` → 先 `compactSession` 再重发；`activeTokens` 发送前刷新（首请求前不再为 0）；`CONTEXT_WINDOW_EXCEEDED` 降级为纯异常兜底。

### 2.5 Usage Ledger（`core/src/common/usage-ledger.ts`）

```
UsageRecord { ts, model, prompt, completion,
              source: chat|compaction|background|auxiliary,
              sessionId?, estimated: true, apiUsage? }
```

`~/.deeporca/projects/<code>/usage-ledger.jsonl`，append-only、容断行、best-effort（绝不阻断 LLM 主链路）。

### 2.6 桌面端（P2）

- `main/tools/tokens-summary.ts`：汇总扩展——时间窗优先读 ledger（精确、含 reqs），无 ledger 时回退旧的"全会话归因 updateTime"近似（`windowsApproximate` 标记）；`costUsd` 来自 `token-pricing.ts` 内置价表（deepseek 系，未命中 → null 隐藏）；`migrateLegacyUsageIntoLedger()` 存量一次性回填（ledger 文件存在性 = 幂等标记，全程同步无竞态），IPC handler 调用后汇总。
- `TokenStatsPanel` 改为消费 `api.tokensSummary(root)`：单一数据源、全工作区（含静默子代理）、≈ 标记、cache 无数据显示 "—"（本地不可知）、成本行。
- 安装包：electron-builder `files` 排除 tokenizer 包的 CJS/IIFE 构建、重复 tokenizer.json 与源码（`*.map` 原本已全局排除）。

## 三、精度口径（验收基线）

| 侧                | 误差                          | 说明                                                |
| ----------------- | ----------------------------- | --------------------------------------------------- |
| prompt            | deepseek ≈ 精确；其他 ±10–20% | 计数对象即实际发送 payload                          |
| completion        | 同上                          | 流末全文计数                                        |
| cache 拆分        | 不可知                        | provider 侧知识，UI 显示 "—"（存量 API 数据仍展示） |
| provider 模板开销 | overhead 常数近似             | 家族可调                                            |

## 四、明确不做（backlog）

异步/并行 compaction（arXiv 2605.23296 方向）；RL 压缩策略；计费级对账；价表用户设置覆盖（价表已数据化，接口就绪）；打包产物实测（files 排除规则待一次真实打包验证）。
