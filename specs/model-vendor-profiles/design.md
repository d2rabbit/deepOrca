# 模型厂商画像与专属优化 — 设计（design）

> 对应需求：[requirements.md](./requirements.md)（R1–R14）。完整论据与证据链见 [docs/research/2026-09-22-model-optimization-plan.md](../../docs/research/2026-09-22-model-optimization-plan.md)（v5.1）——本文为其实施基准摘要。

## 一、三层分工（不变式）

| 层 | 归属 | 载体 | 边界判据 |
| --- | --- | --- | --- |
| wire 协议实现 | **AI SDK** | `@ai-sdk/openai-compatible`（已 exact-pin）；MiniMax 第一方 `@ai-sdk/anthropic`（models.dev `npm` 指名，L4 修订为"AI SDK 依赖一律 exact-pin，provider 包按目录 npm 字段选择"） | 换模型名 AI SDK 能回答的，不归我们 |
| 模型能力数据 | **models.dev** | `vendor/models-dev/api.json` → `model-catalog.ts`（扩展解析 `npm/api/interleaved/reasoning_options/temperature/structured_output/family`） | 换模型名目录能回答的，不归我们 |
| 专属优化 + 命中/试探/兜底 | **DeepOrca** | `common/model-profile.ts`（新，零依赖） | 换模型名答案会变、但两者都不知道的才写画像 |

## 二、画像数据模型

```ts
resolveModelProfile(input: {
  model: string;                       // 家族/子家族匹配只看它
  catalogEntry?: CatalogModelEntry;    // 能力数据注入（不写入画像）
  channel?: { baseURL?: string; catalogProviderId?: string };  // 仅试探记账与第一方加速
}): ModelProfile;

type ModelProfile = {
  vendor: ModelVendorId;               // 7 家 + unknown
  matchedBy: "model" | "fallback";
  wire?: {   // A 类：wire 可见（受试探约束）
    thinking?: { envelope; effortValues?; mandatory?; offEffort? };
    reasoning?: { readFields?; replay? };
    output?: { maxTokensField?; caps? };
    tools?: { schemaDialect?; splitMedia?; deferred? };
  };
  local?: {  // B 类：纯本地（直接生效）
    compaction?: { warnRatio; autoRatio; hardRatio; reservedTokens; keepRecent; circuitBreaker };
    cache?: { anchors; retention; assemblyFingerprint };
    prefix?: { skillInjection; midConversationSystem? };
    loopGuard?: { thresholds; textOnlyAt };
    toolSurface?: { disclosureRatio?; modalitySuppress? };
    toolTextFallback?: { enabled; proseRatioGuard };
    inputGuard?: { minImageEdgePx? };
  };
  evidence: readonly string[];
};
```

**子家族与别名登记表**（每条附第一方证据；详见 v5.1 §1.0 总表）：

- kimi：`^kimi-k3`（1M/128K/effort）vs `^kimi-k2\.7`（always-thinking，`disableField:'thinking'`）vs `^kimi-`；别名 `kimi-for-coding|kimi-code|kimi-coding` → 运行时目录元数据定代际（K2.8 经别名上线，id 不变）。
- minimax 三分：`^minimax-m3\.1`（forced_on + [low,high,max] + 离散窗口 [512K,1M]）vs `^minimax-m3$`（精确；on/off 二元 + 专用补丁）vs `^minimax-m2`（204K/纯文本）。
- glm：`^glm-5\.3-flash`（原生视觉，独立子家族）vs `^glm-(5\.2|[6-9]|\d{2,})`（前瞻默认 1M）vs `^glm-5(\.[01])?`（显式钉旧 200K）。
- deepseek：`^deepseek-(v4|flash)`（384K 输出）vs `^deepseek-`；`deepseek-flash` 与 `deepseek-v4.1-flash` 为同模型双拼写（qwen-code tokenLimits 注脚）。
- stepfun：`^step-5`（前瞻默认 1M/1M，Step Plan 通道）vs `^step-3\.7`（256K，多模态）vs `^step-3\.5`（[low,high]，纯文本）；DeepOrca 现家族级 256K 条目按此重写（wire 协议沿用——第一方仓库 step-5 零新分支）。
- **终版口径（用户 2026-09-22 拍板）：白名单制取代前瞻默认**——注册表显式列出各家族白名单型号（见 requirements 支持矩阵）；未命中白名单的一切模型走兜底，不再前瞻默认（C32 的 1M 事实保留为白名单型号的统一登记值与目录校验基准）。M3.1 隐藏不入单；qwen3.8 官方端点仅 flash/max/plus（+max-preview）。**合并**：model-fleet-adaptation 已加合并横幅，其 X 线五红线（L1 家族语义权威性 / L2 持久化形状不变 / L3 默认关闭 / L4 AI SDK 依赖 exact-pin / L5 core UI-free）与已落地基建（capabilities 子路径、X3 目录数据轨、X0 传输线）由本 spec 继承维护。

## 三、目录派生（读数据，不写死）

- `thinkingMandatoryFromCatalog(entry)`：`reasoning && reasoning_options 非空 && 所有 effort.values 不含 none/off` ⇒ 不可关（三源印证：models.dev qwen3.8-max-preview、ZCode glm-5.3、MiniMax M3.1 forced_on）。
- `catalogEffortValues(entry)`：`reasoning_options[].values`（菜单与合法性）。
- `reasoningReadFields` ← `interleaved.field`（含 `reasoning_details` 数组形状）。
- `temperatureSupported` ← `temperature`。

## 四、请求构造两段式（R9，试探的架构前提）

```
buildBaseRequest(模型, 消息, 工具)               // 纯净形态 = 兜底形态
applyOptimizations(base, profile, probeState)    // 纯函数：base ∪ patches；可丢弃、字段可枚举
createChatCompletionStream(...)
```

落点：`session-manager-base.ts` 主循环请求组装处拆两段；`openai-thinking.ts`/`openai-message-converter.ts` 的输出并入 patches。

## 五、端点试探（R4/R5，成败在拒绝归因）

| 设计点 | 方案 |
| --- | --- |
| 粒度 | `(通道键, 模型, 优化维度)` 三元组；单维度被拒不连坐 |
| 触发 | 惰性：仅当该优化确实改变本次请求；**不做主动探测请求** |
| **归因**（最关键） | 只认可归因拒绝：HTTP 400 且（错误信息点名新增字段 ∥ 与已知良好基线仅差该优化 ∥ 结构化 code 命中 unsupported_parameter/invalid_request 类）。auth/配额/限流/过滤/溢出绝不判为"优化被拒" |
| 记账 | 会话内内存；首期不跨会话持久化 |
| 重试 | 同轮默认态重发一次（复用 llm-error 分类与自动恢复通道） |
| 诊断 | 每次降级写结构化日志（维度/证据/通道键） |
| 加速 | 第一方域名表预置"已知接受"（`isFirstPartyChannel`：hostname 后缀主 + catalog provider id 辅，不可判定=false） |

## 六、窗口动态校准（R10，与试探同构）

413/CONTEXT_WINDOW_EXCEEDED 且过谓词（估算 ≥ 0.5×effectiveMax，防图片过大误触）→ `observed[model@channel] = floor(估算×0.85)` → 阈值取 min(目录, 观察) → 压缩后原地重试（次数上限防死循环）。kimi 实证：目录 1M 端点实际 128K 时一次溢出即永久学会。

## 七、全流程状态机

```
用户发消息 → resolveModelProfile [五段命中] → probeState 决定生效集 [A/B 分流]
  → buildBaseRequest → applyOptimizations → 发送
      ├─ 成功 → 记良好基线；B 类照常（压缩/循环/指纹）
      ├─ 可归因 400 → 禁用(通道,模型,维度) → 默认态同轮重发
      ├─ 413 过谓词 → 窗口学习 → 压缩 → 原地重试
      └─ 其它错误 → 现有 llm-error 恢复（不触碰优化状态）
```

## 八、兜底（R7/R12）

触发：未命中家族 / A 类维度被拒 / 无法判定且试探不可用 / 目录缺失 / 画像加载失败（fail-open）。行为=今日行为逐项（openAiCompatibleBuilder、双字段链、两级压缩触发+用户覆盖、条件 temperature）。安全保证：兜底等价、不可更差、deepseek golden 锁定、坏配置 fail-open。

## 九、实施分级（与 tasks.md 对应）

- **P0 数据通路+试探骨架**：catalog 扩展解析、画像骨架+五段命中+子家族/别名表、两个目录派生、reasoningReadFields/temperature 目录驱动、`isFirstPartyChannel`、试探机制、请求两段式改造。
- **P1 压缩与缓存**：三档阶梯+摘要预算+输出预留扣分母；microcompact 增强（保 N 组/媒体保护/256-token 门槛）+ rapid-refill 熔断；工具结果落盘指针+续读协议；技能注入评估；装配指纹。
- **P2 工具面与循环**：循环干预阶梯；MCP 披露+模态压制；兜捞散文守卫；退化输入守卫；read→edit 自愈层；配额 vs 限流分流（llm-error）。
- **P3 表达层与锚点**：静态 patch 表+路径冲突检测（受限表达式 DSL 可选）；cache_control 三锚点+TTL 单调归一+skipCacheWrite；流式重试提交边界；观察式窗口学习。

## 十、测试策略

解析矩阵（别名/具名/子家族/家族/UNKNOWN × 各家）；deepseek golden 逐字节；试探归因精确性（auth/quota 不禁用）；兜底等价（升级前后请求 diff 为空）；窗口学习收敛；目录 fail-open；子家族区分判别式（M2 拿 204K 非 1M；M3.1 不走 M3 补丁路径）；mutation-check 各一次。
