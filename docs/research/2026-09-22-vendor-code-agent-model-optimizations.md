# 厂商专属 code agent「自家模型专有优化」调研

> 2026-09-22 立稿。**串行调研**：一个仓库一个仓库进行，固定 12 维度矩阵，六仓库可比。
> 目的：为 DeepOrca「按模型匹配的专属优化层」提供实证依据。
>
> **方法**：`git clone --depth 1` 到 `/tmp/modelcode/` 后本地读源码（不依赖 README 自述）。
> **证据**：每条附 `仓库/相对路径:行号`。**`未发现` = 未找到证据，不臆造。**

## 调研维度矩阵（12 项，每仓库同表）

| # | 维度 |
| --- | --- |
| D1 | 仓库身份 / 上游底座 / 专属改动落点 |
| D2 | 系统提示组装（模板、分段、顺序、动态性） |
| D3 | 推理 / 思考控制（开关字段、档位、budget、不可关） |
| D4 | 工具调用协议（原生 vs 文本、参数修复、并行、strict、工具名契约） |
| D5 | 工具面管理（渐进披露、延迟加载、工具发现、去重） |
| D6 | 上下文与压缩（窗口、阈值、保留量、摘要策略、账本） |
| D7 | 缓存纪律（prefix 稳定性、cache 标记、长缓存、会话亲和） |
| D8 | 采样参数（temperature 等、能力位、按任务动态） |
| D9 | 模型注册与匹配（registry 形状、分派键、覆盖优先级、数据源） |
| D10 | 多模态门控（图片输入、工具消息媒体） |
| D11 | 错误处理 / 容错（限流、malformed、跨会话恢复） |
| D12 | 其它专属（会话亲和、遥测、成本、认证、性能） |

---

# 仓库 1/6 — Step-Code（阶跃星辰）

仓库：`stepfun-ai/Step-Code`（默认分支 `main`，2026-09-22 仍在活跃推送）

## D1 仓库身份 / 上游底座

**上游是 `pi`**（非公开 npm 包的 workspace 内部件）。证据：`packages/coding-agent/src/step/tool-profile.ts:2-7` 明确「The runtime remains Pi's native AgentSession/agent loop」；依赖写作 `@step-harness/agent-core` / `@step-harness/pi-tui`。

workspace 包（`package.json` workspaces + `packages/`）：

| 包 | 角色 |
| --- | --- |
| `agent-core` | 上游 agent 循环（AgentSession） |
| `coding-agent` | 产品层；**专属改动集中在 `src/step/`（51 个文件）** |
| `providers` | **模型/协议层**——本次调研最重要的包 |
| `config` / `contracts` / `telemetry` / `tui` | 配置 / 契约 / 遥测 / 终端 UI |
| `apps/cli` | 入口 |

**专属改动落点**：`src/step/` 下 `tool-profile.ts`(55KB) / `system-prompt.ts`(29KB) / `defaults.ts` / `permissions.ts`(30KB) / `stepcode-config.ts`(29KB) / `secret-redaction.ts`(42KB) 等。

**架构门禁（本仓库最有价值的部分）**——`package.json` 的 `check` 脚本里有 16 条静态门禁，其中三条直接定义了「模型专属优化」的**合法边界**：

| 门禁脚本 | 约束 |
| --- | --- |
| `check:no-provider-dispatch` | **禁止按 provider 名选择协议实现** |
| `check:derived-compat-only` | **compat 只能派生，`source` 永不参与分派** |
| `check:metadata-not-in-dispatch` | 元数据不进分派 |

## D9 模型注册与匹配（先讲，因为它是全仓库的骨架）

### D9.1 分派键永远是 `model.api`，不是 provider、不是模型名

`scripts/check-no-provider-dispatch.mjs:3-6`：

> The dispatch key is always `model.api` (`models.ts` `byApi?.[model.api]`, `compat.ts` `getApiProvider(model.api)`). **A provider's identity must NEVER select the protocol implementation.** This gate freezes that invariant inside the adapter zone (`packages/providers/src/api/**`):
> - No `switch (provider)` / `switch (model.provider)` — adapters never select an implementation by vendor name (there are zero today; keep it zero).
> - A `model.provider === "<literal>"` branch is a **MAJ-7 compatibility quirk** (tuning headers/params/thinking/capability for a real gateway), NOT adapter selection. Such quirks are allowed only in the files + provider literals registered in `scripts/adapter-provider-quirks.json`.

`scripts/check-derived-compat-only.mjs:5-17` 补充：

> Rule 1 — single home. `deriveFromLegacyProvider`（the ONE sanctioned old-provider → dialect mapping）may be referenced only inside its home, `packages/providers/src/dialect/resolve.ts`.
> Rule 2 — `source` never selects an adapter. The `DialectSource` literal `"derived-from-provider"` must not appear in the adapter-selection zone. **The dispatch key is always `.api`; branching an adapter choice on `source === "derived-from-provider"` is forbidden.**

**三层结构**：模型 →（`model.api` 声明式，或 `deriveFromLegacyProvider` 兜底派生）→ **dialect（协议方言）** → adapter。

### D9.2 厂商专属调优的官方登记册

`scripts/adapter-provider-quirks.json` 是**唯一允许按 provider 字面量分支的白名单**（key = 相对 `packages/providers/src` 的路径，value = 允许出现的 provider 字面量）：

```json
"quirks": {
  "api/openai-responses.ts": ["openrouter", "github-copilot", "xai"],
  "api/anthropic-messages.ts": ["github-copilot", "anthropic"],
  "api/openai-completions.ts": [
    "opencode-go", "github-copilot", "openai", "zai", "zai-coding-cn", "together",
    "moonshotai", "moonshotai-cn", "openrouter", "cloudflare-workers-ai",
    "cloudflare-ai-gateway", "nvidia", "ant-ling", "deepseek", "cerebras",
    "xai", "opencode"
  ]
}
```

注释强调：**「Do NOT widen this list to fold in coding-agent files」**——白名单严格限定在协议层。

### D9.3 compat 派生：25 个字段，按 provider **和** baseUrl 双重判定（三期核对：原记 26，实测接口与返回对象均为 25 键，`types.ts:473-535`）

`packages/providers/src/api/openai-completions.ts:1567-1662` 的 `detectCompat(model)` 是核心。它同时用 **provider 字面量**和 **baseUrl 子串**判定（注意：baseUrl 在这里是**一等判定输入**，不是 hint）：

```ts
const isZai = provider === "zai" || provider === "zai-coding-cn"
  || baseUrl.includes("api.z.ai") || baseUrl.includes("open.bigmodel.cn");
const isTogether = provider === "together" || baseUrl.includes("api.together.ai") || baseUrl.includes("api.together.xyz");
const isMoonshot = provider === "moonshotai" || provider === "moonshotai-cn" || baseUrl.includes("api.moonshot.");
const isOpenRouter = provider === "openrouter" || baseUrl.includes("openrouter.ai");
const isCloudflareWorkersAI = provider === "cloudflare-workers-ai" || baseUrl.includes("api.cloudflare.com");
const isCloudflareAiGateway = provider === "cloudflare-ai-gateway" || baseUrl.includes("gateway.ai.cloudflare.com");
const isNvidia = provider === "nvidia" || baseUrl.includes("integrate.api.nvidia.com");
const isAntLing = provider === "ant-ling" || baseUrl.includes("api.ant-ling.com");
const isDeepSeek = provider === "deepseek" || baseUrl.toLowerCase().includes("deepseek.com");
```

派生出的旗标（`:1617-1661`）：

| 旗标 | 派生规则 |
| --- | --- |
| `supportsStore` | `!isNonStandard` |
| `supportsDeveloperRole` | OpenRouter 上 `anthropic/`·`openai/` 前缀模型，或 `!isNonStandard && !isOpenRouter` |
| `supportsReasoningEffort` | **false** for grok / zai / moonshot / together / cloudflare-gateway / nvidia / ant-ling |
| `maxTokensField` | **`max_tokens`** for chutes / deepseek / moonshot / cloudflare-gateway / together / nvidia / ant-ling / zai；否则 `max_completion_tokens` |
| `requiresReasoningContentOnAssistantMessages` | **仅 `isDeepSeek`** |
| `thinkingFormat` | `deepseek` \| `zai` \| `together` \| `ant-ling` \| `openrouter` \| `openai` |
| `supportsStrictMode` | **false** for moonshot / together / cloudflare-gateway / nvidia |
| `cacheControlFormat` | `"anthropic"` 仅当 OpenRouter 上 `anthropic/` 前缀 |
| `sessionAffinityFormat` | `openrouter` \| `openai` |
| `supportsLongCacheRetention` | **false** for together / cloudflare×2 / nvidia / ant-ling |
| `supportsThinkingTokenBudget` / `thinkingTokenBudgetField` | 默认 false / undefined |
| `deferredToolsMode` | 默认 undefined（`"kimi"` 见 D5） |
| `zaiToolStream` | 默认 false |

`isNonStandard` 名单（`:1585-1600`）：nvidia、cerebras、xai、together、chutes、deepseek、zai、moonshot、opencode、cloudflare×2、ant-ling。

### D9.4 覆盖优先级：per-model `compat` 覆盖派生值

`getCompat(model)`（`:1666-1701`）：`detected = detectCompat(model)`，然后**逐字段** `model.compat.X ?? detected.X`。即「派生是默认，per-model 声明可覆盖任一字段」。

### D9.5 数据源：models.dev + 手工窄修正

`providers/scripts/generate-models.ts:484-486` 读 models.dev 的 `reasoning_options`；`:341` 注释「Kimi Coding is subscription-backed, so models.dev reports zero cost. Use the …」；`:411`「authoritative values until models.dev and passthrough catalogs catch up」；`:466`「Keep this to narrow corrections over models.dev metadata instead of snapshotting Copilot's catalog」。

**结论**：Step-Code 的模型知识 = **models.dev 快照 + 窄范围手工修正**，产物是 `providers` 包里的静态模型表（`generate-models` / `hydrate:model-data` / `check:model-data` 流水线）。

### D9.6 模型条目形状

`coding-agent/src/core/model-config.ts` 的 `ModelDefinitionSchema`：

```ts
id, name, api, baseUrl, reasoning: boolean, thinkingLevelMap, input: ("text"|"image")[],
cost { input, output, cacheRead, cacheWrite, tiers[] }, contextWindow, maxTokens,
samplingParams: Record<string, unknown>, headers: Record<string, string>, compat
```

## D3 推理 / 思考控制

### D3.1 `thinkingFormat` 是枚举，不是布尔

见 D9.3：`deepseek | zai | together | ant-ling | openrouter | openai`。每种格式对应不同的请求体形状——例如 `:851-853`：

```ts
if (compat.thinkingFormat === "zai" && model.reasoning) {
  const zaiParams = params as Omit<typeof params, "reasoning_effort"> & {
    thinking?: { type: "enabled" | "disabled"; clear_thinking?: boolean };
```

**`clear_thinking`** 是 ZAI 独有参数。对比 DeepOrca：`thinkingProtocol` 只有 `deepseek | stepfun | unknown`，且无 per-format 参数。

### D3.2 `thinkingLevelMap`：7 档 per-model，可映射为 null（该档不可用）

`coding-agent/src/core/model-config.ts:55-64`：

```ts
const ThinkingLevelMapValueSchema = Type.Union([Type.String(), Type.Null()]);
const ThinkingLevelMapSchema = Type.Object({
  off: …, minimal: …, low: …, medium: …, high: …, xhigh: …, max: …
});
```

**7 档**（`off/minimal/low/medium/high/xhigh/max`），值可为字符串（该档的 wire 拼写）或 **`null`（该档不可用）**。

对比 DeepOrca `think-level.ts`：5 档（`low/medium/high/xhigh/max`，无 `off`/`minimal`）、**家族级**映射（`THINK_LEVEL_FAMILY_MAPS`）、**无「不可用」表达**（只有 `hiddenByDefault` 隐藏）。

### D3.3 档位可作为模型引用后缀

`coding-agent/src/step/defaults.ts:175` 与 `src/main.ts:299`（三期核对修正：原记 :56/:302；且两处**不完全相同**——main.ts 带 `i` 旗标且先 toLowerCase，用途分别为 isStepModelReference 判定与 auth 命令校验）：

```ts
const base = model.replace(/:(?:off|minimal|low|medium|high|xhigh|max)$/u, "");
```

即 `step-3.7-flash:high` 携带档位。同一形态出现两处（注释解释：argv 默认值在扩展加载前求值；三期核对：main.ts 的 auth 校验 Set 仅 4 模型，缺 `step-5-preview`）。

### D3.4 thinking token budget 的三种拼写

三期核对修正：stepfun 仓库**没有** `packages/providers/src/catalog.ts`，也没有 drift gate——三拼写以**联合类型**存在（`types.ts:71` 的 `ThinkingTokenBudgetField` 与 `:519-524`）。我引用的 `Record<T,true>` drift gate 实际来自 **deepseek-harness 的 `packages/llm/llm-pi-ai/src/catalog.ts`**（两家同源 pi-ai，但 stepfun 公开仓库未内嵌该文件），原归属错误：

```ts
// deepseek-harness llm-pi-ai/src/catalog.ts（drift gate 原文，非 stepfun）
{ thinking_token_budget: true, thinking_budget: true, thinking_budget_tokens: true }
```

### D3.5 chat template kwargs 可引用请求状态

`model-config.ts:66-71`：

```ts
const ChatTemplateKwargVariableSchema = Type.Object({
  $var: Type.Union([Type.Literal("thinking.enabled"), Type.Literal("thinking.effort")]),
  omitWhenOff: Type.Optional(Type.Boolean()),
});
```

即模型可声明「把 thinking 开关/档位注入 chat template 的某个变量」，并支持「关闭时省略该 kwarg」。（三期核对修正：stepfun 无 `CHAT_TEMPLATE_VARS`——coding-agent schema 的 `$var` 只允许 enabled/effort 两值；providers 侧注释提三值但无 gate，`types.ts:509-511`。）

## D4 工具调用协议

### D4.1 模型面工具契约重命名（三期核对重写：原「step-* 前缀改名表」为误读）

`src/step/tool-profile.ts:2-7`：

> Step's model-facing tool contract. The runtime remains Pi's native AgentSession/agent loop. **These definitions only change the public name, schema, and argument vocabulary**; execution and rendering are delegated to the corresponding Pi tool whenever the contracts are equivalent.

**三期核对勘误**：原文把 `step-find-files`/`step-search-files`/`step-read-file`/`step-run-bg` 当作「模型面工具名」——**错**。核对显示这些字符串是传给 `native.execute()` 的**合成 toolCallId**（`tool-profile.ts:293-317`，:426 首参即 toolCallId）与后台命令**日志文件名前缀**（:1171）。**真实的模型面工具名是 9 个无前缀名**：

```ts
// tool-profile.ts:60-71 STEP_TOOL_NAMES
list_directory / find_files / search_files / search_web /
read_file / write_file / edit_file / run_command / find_tools
```

（Pi 原生名为 `read`/`bash` 等，见 `agent-core/src/harness/tools/read.ts:49`、`bash.ts:55`——**改名仍然成立**，但命名风格是「完整动词短语」而非 step- 前缀。）

### D4.2 双契约容忍：工具名分组同时认两套名字

`src/step/system-prompt.ts:48-60`：

```ts
const READ_TOOLS = ["list_directory","find_files","search_files","search_web","read_file","ls","find","grep","read"] as const;
const WRITE_TOOLS = ["write_file","edit_file","write","edit"] as const;
const EXECUTE_TOOLS = ["run_command","bash","powershell"] as const;
```

Step 名（`*_file`）与原生名（`read`/`grep`）并存于同一分组。

### D4.3 reasoning 回放契约：DeepSeek **和 Kimi K3** 都需要

`providers/scripts/generate-models.ts:1358-1367`：

```ts
const kimiK3Compat: OpenAICompletionsCompat = {
  ...openAICompat,
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: "openai",
  deferredToolsMode: "kimi",
};
```

`:2093-2098` 对 `moonshotai` / `moonshotai-cn` 的 `kimi-k3` 同样设置：

```ts
const isKimiK3 = modelId === "kimi-k3";
if (isKimiK3) {
  compat.requiresReasoningContentOnAssistantMessages = true;
  compat.deferredToolsMode = "kimi";
  compat.thinkingFormat = "openai";
  compat.supportsReasoningEffort = true;
}
```

**这是本次调研对 DeepOrca 影响最大的一条**：DeepOrca 只给 `deepseek` 家族设了 `reasoningReplay: "content"`（`model-capabilities.ts:109`）。Kimi K3 需要同一契约，而 DeepOrca 的 kimi 家族**尚未登记**（走 UNKNOWN 的 `empty-field`）——Kimi K3 用户会踩与 DeepSeek 相同的 400。

### D4.4 tool_call_id 截断（openai 特例）

`api/openai-completions.ts:1193`：

```ts
if (model.provider === "openai") return id.length > 40 ? id.slice(0, 40) : id;
```

（其余 provider 走 `:1186-1191` 的「前缀 + 哈希」压缩，把长 id 压到 40 字符内且保持唯一。）

### D4.5 assistant content 必须是纯字符串

`:1306-1310`：

> Always send assistant content as a plain string (OpenAI Chat Completions API standard format). Sending as an array of `{type:"text", text:"..."}` objects is non-standard and **causes some models (e.g. DeepSeek V3.2 via NVIDIA NIM) to mirror the content-block structure literally in their [output]**.

### D4.6 工具消息里带 tools 参数的必要性

`:835-838`：

```ts
} else if (hasToolHistory(context.messages)) {
  // Anthropic (via LiteLLM/proxy) requires tools param when conversation has tool_calls/tool_results
  params.tools = [];
}
```

### D4.7 未发现

**文本通道工具兜捞**（grep `tool_call>` / `scavenge` / `DSML` 在 Step-Code 无命中）。Step 走原生 `tool_calls`。

## D5 工具面管理

### D5.1 `deferredToolsMode: "kimi"`——按会话状态收窄工具面

`api/openai-completions.ts:827-838`：

```ts
const deferredToolNames =
  compat.deferredToolsMode === "kimi" ? getDeferredToolNames(context.messages) : new Set<string>();
const activeTools = context.tools?.filter((tool) => !deferredToolNames.has(tool.name));
if (activeTools && activeTools.length > 0) {
  params.tools = convertTools(activeTools, compat);
  if (compat.zaiToolStream) { (params as any).tool_stream = true; }
}
```

`:1390-1394`：工具结果消息可**重新加入**工具名：

```ts
if (compat.deferredToolsMode === "kimi") {
  for (const name of toolMsg.addedToolNames ?? []) {
    deferredToolNames.add(name);
  }
}
```

**语义**：从消息历史推导「已用完/暂不需要」的工具集，把它们**移出 `tools` 数组以省 token**；工具结果可通过 `addedToolNames` 把工具重新加回。命名 `"kimi"` 说明这是 Kimi 模型所需的工具面交付方式。

**对比 DeepOrca**：`getTools()` 每次全量下发，无按会话状态的收窄。

### D5.2 `find_tools`——意图→工具名的发现工具

`src/step/system-prompt.ts:39`：

> `find_tools`: "Use `find_tools` when you know the intent but do not know the available tool name."

### D5.3 Responses API 的两档延迟工具模式

`api/openai-responses-shared.ts:123`：`deferredToolsMode?: "additional-tools" | "tool-search"`；`:321-342` 分别实现为「把延迟工具放进 `additional_tools` 字段」与「用 `tool_search` 引用」。

## D6 上下文与压缩

### D6.1 阈值是**预留量**而非比例

`core/compaction/compaction.ts:271-273`：

```ts
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
  return contextTokens > contextWindow - settings.reserveTokens;
}
```

对比 DeepOrca：`activeTokens > threshold`，其中 threshold = 家族窗口值（满窗口触发），**无独立 reserve 概念**。

### D6.2 保留量、摘要输出上限

`:136` `keepRecentTokens: number`；`:155` **`keepRecentTokens: 20000`**；`:145` **`SUMMARY_OUTPUT_TOKENS_CEILING = 32000`**；`:150-153` 注释提到 `0.8 * 16384 = 13107 maxTokens cap` 与 length-stop 拒绝。

### D6.3 跨压缩的**文件操作账本**

`:41-66` `CompactionDetails { readFiles, modifiedFiles }`，`extractFileOperations()` 会**从上一轮压缩条目里继承**文件操作：

```ts
// Collect from previous compaction's details (if pi-generated)
if (!prevCompaction.fromHook && prevCompaction.details) {
  const details = prevCompaction.details as CompactionDetails;
  if (Array.isArray(details.readFiles)) for (const f of details.readFiles) fileOps.read.add(f);
  if (Array.isArray(details.modifiedFiles)) for (const f of details.modifiedFiles) fileOps.edited.add(f);
}
```

**即：多次压缩后，「读过哪些文件、改过哪些文件」不会丢。**

### D6.4 摘要格式：结构化 + 标注推断

`:504-536` `SUMMARY_FORMAT` 以 `## User Goal` 开头，并要求：

```
- [User preference / technical decision / environment constraint — with brief rationale. Mark user-stated requirements vs your own inference (e.g. "(inferred)").]
```

`:536-546` `SUMMARY_DETAIL_RULES` 另列细则。

### D6.5 增量摘要更新

`:546` `SUMMARIZATION_PROMPT`（首次）与 `:554` `UPDATE_SUMMARIZATION_PROMPT`（后续）：

> The messages above are NEW conversation messages to incorporate into the existing handoff summary provided in `<previous-summary>` tags.

**即第二次起是「把新消息并入既有摘要」，不是重新摘要全部。**

### D6.6 其它

`core/compaction/` 另有 `branch-summarization.ts`（分支摘要）、`projection.ts`（投影）、`utils.ts`；`:280` `ESTIMATED_IMAGE_CHARS = 4800`（图片按字符估 token）。

## D7 缓存纪律

| 机制 | 证据 |
| --- | --- |
| `supportsLongCacheRetention` per-provider 旗标 | `api/openai-completions.ts:1655-1661`（false for together/cloudflare×2/nvidia/ant-ling） |
| `cacheControlFormat: "anthropic"` | `:1615`（仅 OpenRouter 上 `anthropic/` 前缀模型） |
| Anthropic cache 标记应用 | `:840-842` `applyAnthropicCacheControl(messages, params.tools, cacheControl)` |
| 会话亲和头 | `:755-758` `sendSessionAffinityHeaders` → `x-session-id`（openrouter 格式）或 openai 格式 |
| 压缩/摘要副调用**关闭缓存** | `core/compaction/compaction.ts:628`、`examples/extensions/summarize.ts:186`、`handoff.ts:136` 均 `cacheRetention: "none"` |
| workflow 前缀复用说明 | `system-prompt.ts:281`「Resume with `resumeFromRunId`: the same script and args replay the unchanged call prefix as a **100% cache hit**; the first mismatched call and everything after it re-run live.」 |

**对比 DeepOrca**：无 cache 相关旗标、无 cache 标记、无会话亲和头；压缩副调用未显式关缓存。DeepSeek 的硬盘缓存在 DeepOrca 侧也**未被显式适配**（只在 usage 里被动记录）。

## D8 采样参数

- per-model `samplingParams: Record<string, unknown>`（`model-config.ts` `ModelDefinitionSchema`）——**采样参数是模型条目数据**，不是代码分支。
- `api/openai-completions.ts:823-825`：`if (options?.temperature !== undefined) params.temperature = options.temperature;`——**有值才发**（不发默认值）。
- 未发现按任务类型（编码 vs 解释）动态调参的证据。

## D10 多模态门控

- per-model `input: ("text"|"image")[]`（`ModelDefinitionSchema`）；判定 `model.input.includes("image")`（`api/openai-completions.ts:1396`）。
- 工具结果里的图片：`:1396-1407` 从 `toolMsg.content` 里抽出 image block，转成 `image_url` 塞进**后续消息**（`imageBlocks` 累积后单独成消息）。
- GitHub Copilot：`:746-753` 按「本请求是否含图片」动态构造 headers（`buildCopilotDynamicHeaders({messages, hasImages})`）。

## D11 错误处理 / 容错

- 摘要生成触顶有显式文案：`compaction.ts:587`「`${label} failed: generation hit the token cap and the summary is incomplete${capNote}`」。
- **三期探索者勘误**：Step-Code **实有** JSON 修复链——`providers/src/utils/json-parse.ts:32-83` `repairJson()`（裸控制字符转义/非法反斜杠翻倍/\u 不足 4 位兜底）+ `:104-124` `parseStreamingJson()` 四级瀑布（完整 parse → 修复 parse → partial-json 增量 → 修复后增量 → `{}`，永不抛），openai-completions 与 anthropic-messages 共用。另见三期 §10.1 的「工具标记泄漏重采样」。

## D12 其它专属

- **git 环境信息 5 秒 TTL 缓存**：`system-prompt.ts:129` `GIT_ENVIRONMENT_TTL_MS = 5_000`；`:127` 注释「(~29 ms). Cache per working directory so a registration burst pays once.」；`:133` `invalidateGitEnvironmentCache()` 供变更后失效。
- **系统提示按活跃工具集动态组装**：`system-prompt.ts:195-289`，每段用 `active.has("<tool>")` 或 `hasAnyTool(active, [...])` 条件包含——不存在的工具不写进提示。
- **静态站点发布插件**（steppage）、`/goal` 长任务、`/cron` 定时（README）。
- **遥测契约**：`src/step/telemetry-contract.ts`（含 hostname → platform 归类）。
- **密钥脱敏**：`src/step/secret-redaction.ts`（42KB，本仓库最大文件之一）。
- **模型 id 白名单**：`src/step/defaults.ts:20-26` `STEP_MODEL_IDS`（`step-5-preview` / `step-3.7-flash` / `step-3.5-flash-2603` / `step-3.5-flash` / `step-router-v1`）；`main.ts:300` 另有一份重复 Set（注释解释原因）。

---

# 仓库 2/6 — MiMo-Code（小米）

仓库：`XiaomiMiMo/MiMo-Code`（默认分支 `main`）

## D1 仓库身份 / 上游底座

**上游是 `opencode`**。证据：根 `package.json` 的 `"name": "opencode"`、`"description": "AI-powered development tool"`，包管理器 `bun@1.3.14`；`packages/opencode/` 原样保留；内部 import 已改写为 `@mimo-ai/shared/*`。

workspace（`packages/`）：`opencode`（核心）/ `app` / `desktop` / `console` / `enterprise` / `ui` / `sdk` / `shared` / `plugin` / `extensions` / `containers` / `function` / `identity` / `slack` / `storybook` / `web`。

**MiMo 专属改动落点**（`grep -i mimo` 去噪后）：

| 类别 | 文件 |
| --- | --- |
| **专属设计文档** | `docs/harness/`：`MiMo Orchestrator Mode.md`(13KB) · `MiMo Token Efficient Mode.md`(9KB) · `Mix of Harness and Hand-off.md`(12KB) · `Agent Multi-Skill Workflow Orchestration Design.md` · `xiaomi-media-api-doc.md`(24KB)——前 4 份设计文档各 5 语言（en/fr/ja/ru+基础），**`xiaomi-media-api-doc.md` 无翻译**（三期核对） |
| 专属工具 | `tool/bash_token_efficient_pipeline.ts` · `tool/bash_token_efficient_heuristic.ts` · `tool/session.ts`（Orchestrator）· `tool/websearch/mimo.ts` |
| 专属 provider 层 | `provider/capability-registry.ts` · `provider/image.ts` · `provider/transform.ts` |
| 其它 | `util/mimo-process.ts` · `plugin/mimo.ts` · `cli/cmd/tui/component/dialog-mimo-login.tsx` · `cli/cmd/tui/context/theme/mimocode.json` |

**flag 体系**：`MIMOCODE_EXPERIMENTAL_*` 系列，多数**默认关闭**、显式 opt-in（`MIMOCODE_EXPERIMENTAL_TOKEN_EFFICIENCY` / `MIMOCODE_EXPERIMENTAL_ORCHESTRATOR` / `MIMOCODE_CODEX_MODE` / `MIMOCODE_ENABLE_DYNAMIC_SYSTEM_PROMPT` / `MIMOCODE_FORCE_ANTHROPIC_REASONING_CONTENT` / `MIMOCODE_MAX_ATTACHMENT_SIZE` / `MIMOCODE_MAX_PROMPT_IMAGES` / `MIMOCODE_MAX_PROMPT_IMAGE_SIZE` / `MIMOCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX`）。

## D2 系统提示组装 —— **本仓库最核心的专属优化**

### D2.1 按模型 id 匹配「专属系统提示文件」

`session/system.ts:35-49`（**这就是「按模型匹配走专属优化」的原型实现**）：

```ts
export function provider(model: Provider.Model, harness?: HarnessMode) {
  if (usesGPTToolset(model.id, harness, model.api.id, model.family)) return [PROMPT_GPT]
  const prompt = (id: string) => {
    if (isGPTModel(id)) return PROMPT_DEFAULT
    if (id.includes("gpt-4") || id.includes("o1") || id.includes("o3")) return PROMPT_BEAST
    if (id.includes("gemini-")) return PROMPT_GEMINI
    if (id.includes("claude")) return PROMPT_ANTHROPIC
    if (id.toLowerCase().includes("trinity")) return PROMPT_TRINITY
    if (id.toLowerCase().includes("kimi")) return PROMPT_KIMI
    if (id.toLowerCase().includes("deepseek")) return PROMPT_DEEPSEEK
    if (id.toLowerCase().includes("glm")) return PROMPT_GLM
    if (id.toLowerCase().includes("minimax")) return PROMPT_MINIMAX
  }
  return [prompt(model.id) ?? prompt(model.api.id) ?? PROMPT_DEFAULT]
}
```

**匹配规则**：先试 `model.id`，未命中再试 `model.api.id`，都未命中落 `PROMPT_DEFAULT`。**纯模型串匹配，不看 providerID、不看 baseURL。**

`session/prompt/` 下的提示文件全集（三期核对：**16** 个 .txt，原记 15 为计数笔误——下方自列清单即 16 项；另有 4 个 .ts 辅助文件）：

```
anthropic.txt   beast.txt      build-switch.txt  compose.txt    copilot-gpt-5.txt
deepseek.txt    default.txt    default.old.txt   gemini.txt     glm.txt
gpt.txt         kimi.txt       max-steps.txt     minimax.txt    orchestrator.txt
trinity.txt
```

**按厂商命名的有 8 个**：`anthropic` / `deepseek` / `gemini` / `glm` / `gpt` / `kimi` / `minimax` / `copilot-gpt-5`。

### D2.2 按模型换**工具集**（不只是提示）

`tool/gpt.ts`（全文 38 行）：

```ts
export function isGPTModel(...values) {
  const ids = values.flatMap((v) => (v ? [v.toLowerCase()] : []))
  if (ids.some((id) => id.includes("gpt-oss"))) return false      // gpt-oss 例外
  return ids.some((id) => id.includes("gpt"))
}
export function usesGPTToolset(modelID, harness?, ...modelIDs) {
  return usesCodexMode(harness, modelID, ...modelIDs)
}
export function isMcpToolSearchEnabled(enabled, harness?, ...modelIDs) {
  return enabled || usesCodexMode(harness, ...modelIDs)
}
```

`usesCodexMode` 读 `Flag.MIMOCODE_CODEX_MODE`。**即：GPT 系模型整套切到 Codex 风格工具集 + 启用 MCP 工具搜索 + 专属提示**，且 `gpt-oss` 被显式排除。

### D2.3 按模型决定**环境信息段是否注入**

`session/system.ts:88-100`：环境段（工作目录 / 是否 git 仓库 / 平台 / shell / OS / **gitStatus 含分支、主分支、git user、status、recent commits**）**只对 Anthropic 提示注入**：

```ts
if (provider(model, harness)[0] === PROMPT_ANTHROPIC) {
  const key = `${Instance.directory}\0${now}\0${model.providerID}\0${model.api.id}`
  const cached = anthropicEnvironment.get(key)
  if (cached) return [cached, `IMPORTANT: Your response must ALWAYS strictly follow the same major language as the user.`]
  ...
}
```

（带 per-directory 缓存 + 强制同语言指令。）

### D2.4 多 Skill 编排：Reminder 放 message 层而非 system prompt（**前缀缓存论据**）

`docs/harness/Agent Multi-Skill Workflow Orchestration Design.md` 第三节明确对比：

| 维度 | 改 system prompt | 附在 user message 后（选定） |
| --- | --- | --- |
| 指令遵循率 | 距离 query 远，遵循率较低 | 靠近 query，遵循率明显更高 |
| **Prefix cache 命中率** | **污染前缀，每次内容变都破坏缓存** | **前缀保持稳定，动态内容全部下沉到 message 层** |

结论原文：「Reminder 作为 system-injected 消息附加在 user message 之后（**对齐 Anthropic 的 `long_conversation_reminder` 模式**），不改写 system prompt。」

**对 DeepOrca 直接相关**：DeepOrca 把技能以 XML 块注入 **system messages**（`buildSkillDocumentsPrompt()`）。按 MiMo 的论据，这**污染前缀、破坏 prefix cache**。

## D3 推理 / 思考控制

- `MIMOCODE_FORCE_ANTHROPIC_REASONING_CONTENT` flag：`provider/transform.ts:660` `if (!Flag.MIMOCODE_FORCE_ANTHROPIC_REASONING_CONTENT) return msgs`——**强制 Anthropic 系回传 reasoning_content**（与 DeepSeek 契约同源）。
- **签名 thinking 必须留存**：`transform.ts:110-124` 剥离空块时对 reasoning 有例外——
  ```ts
  if (part.type === "reasoning") {
    if (part.text !== "") return true
    const metadata = record(part.providerOptions?.anthropic ?? part.providerOptions?.[model.providerID])
    return (typeof metadata?.signature === "string" && metadata.signature !== "") ||
           (typeof metadata?.redactedData === "string" && metadata.redactedData !== "")
  }
  ```
  注释：「Signed thinking is the exception: its text may be empty, but its **signature/redacted data must survive for replay**」。
- effort 档位经 `Model.variants` 承载（见 D9），**不发明映射表**。
- 未发现 `interleaved` / `thinking_budget` 的 MiMo 模型侧专属处理。

## D4 工具调用协议

### D4.1 按厂商**净化工具 JSON Schema**（Moonshot/Kimi vs mimo-v2.5-pro/MiniMax-M3 冲突）

`provider/transform.ts:2002-2035` 注释 + `sanitizeMoonshot()`：

> Moonshot's "flavored" JSON-schema validator **rejects a tool-parameter node that carries a `type` as a sibling of an `anyOf`**: it wants the type inside each `anyOf` item instead. Our discriminated-union tool parameters (`task`/`actor`/`cron`/`session` `operation`, declared as `z.discriminatedUnion(...).meta({ type: "object" })`) serialize to `{ type: "object", anyOf: [...] }`, so Moonshot 400s with:
> `"when using anyOf, type should be defined in anyOf items instead of the parent schema"`
>
> **Scoped to Moonshot/Kimi so the parent `type` other models rely on (e.g. `mimo-v2.5-pro` / `MiniMax-M3`, which stringify the whole envelope without it — see #1371) stays intact.**

实现：把父级 `type` 推进缺 `type` 的 `anyOf` 项，再删父级 `type`；`oneOf` 同样防御性归一（因为 `@ai-sdk/anthropic` 会把 `oneOf` 改写为 `anyOf`）。

**这是「同一份工具 schema 在不同模型上必须变形」的直接实证**，且是**双向的**（改了 A 就坏 B）。

### D4.2 按 `api.npm` 剥离空块

`provider/transform.ts:73-80`：

```ts
function stripsEmptyParts(model: Provider.Model): boolean {
  return ["@ai-sdk/anthropic", "@ai-sdk/amazon-bedrock",
          "@ai-sdk/google-vertex/anthropic", "@openrouter/ai-sdk-provider",
          "@ai-sdk/openai-compatible"].includes(model.api.npm)
}
```

注释说明 AI SDK 自身过滤不救场：user 分支会丢空 text part，但 **assistant 分支保留带 providerOptions 的空 text part**，且**从不检查 reasoning part**。

### D4.3 按 `api.id` 子串净化 tool_call id

`transform.ts:127-131`：`if (model.api.id.includes("claude"))` → `id.replace(/[^a-zA-Z0-9_-]/g, "_")`。

### D4.4 未发现

**文本通道工具兜捞**（grep `scavenge` / `DSML` 无命中）。MiMo 走原生 `tool_calls`，但**有循环检测兜底**（见 D11）。

## D5 工具面管理

### D5.1 ~~MCP 工具渐进披露~~（三期核对：**张冠李戴，本仓库无此实现**）

**三期核对勘误**：`packages/agent-tools/src/mcp-disclosure/` 在 MiMo-Code 中**不存在**，全仓 grep `thresholdPct`/`minDeferCount`/`deferredRegistry` 零命中。该机制属 **MiniMax 仓库**（见仓库 5/6 D5.1）。一期把 MiniMax 的体系误植到本节，且与专项一 C 的「未发现」自相矛盾——以专项一为准。以下代码引文实出自 MiniMax：

（原误植引文，实为 MiniMax `agent-tools/src/mcp-disclosure/plan.ts:35-75`）：

```ts
if (!options.enabled) return inlineAll();
if (!modelInWhitelist(model.provider, model.id, options.modelWhitelist)) return inlineAll();
// The threshold (thresholdPct * contextWindow) is meaningless without a real context window.
if (!(Number.isFinite(model.contextWindow) && model.contextWindow > 0)) return inlineAll();
const candidates = entries.filter((e) => e.source === 'configured');
const estTokens = candidates.reduce((s, e) => s + estimate(e.tool.def), 0);
const thresholdTokens = options.thresholdPct * model.contextWindow;
if (candidates.length < options.minDeferCount || estTokens <= thresholdTokens) return inlineAll();
```

**三重门**：① 功能开关 ② **模型白名单**（`provider` + `id`）③ 真实上下文窗口（非正/非有限则整体放行，防阈值塌缩为 0）。产出 `deferredRegistry` + `index`（带 `maxSchemaTextLen` 截断）。

### D5.2 MCP 工具搜索（Codex 模式下启用）

见 D2.2：`isMcpToolSearchEnabled(enabled, harness, ...modelIDs) = enabled || usesCodexMode(...)`。

### D5.3 `session` 工具（Orchestrator 专用，8 verb）

`tool/session.ts:34`（`KNOWN_VERBS`，三期核对：实为 **13** 个，原记 8）：`create` / **`send`** / `switch` / `list` / **`dashboard`** / **`status`** / `cancel` / `ask` / **`join`** / `setmode` / `approve` / `grant-approval` / **`set-title`**。**按 agent 名 + flag 双重门控**——只有 Orchestrator 模式可见。（一期 8 verb 来自设计文档的时点快照。）

## D6 上下文与压缩

`session/compaction.ts`：

| 常量 | 值 | 行号 |
| --- | --- | --- |
| `COMPACTION_TAIL_BUDGET` | **40_000** | `:43` |
| `COMPACTION_TOOL_RESULT_LIMIT` | **8_000** | `:44` |

`:166` `if (tokens <= COMPACTION_TOOL_RESULT_LIMIT) return part`（工具结果超限才裁剪）；`:198` `if (used + cost > (input.budget ?? COMPACTION_TAIL_BUDGET)) break`（从尾向前累积到预算为止）；`:645` 有「auto-compaction followups」的内部标记。

**未发现**按模型差异化压缩阈值的证据（阈值是全局常量 + 调用方传 budget）。

## D7 缓存纪律

- **前缀缓存论据**（D2.4）——动态内容下沉到 message 层，system prompt 保持稳定。
- 未发现 cache 标记格式 / `cacheRetention` / 会话亲和头的 MiMo 侧实现（与 Step-Code 的 25 字段 compat 体系形成对比）。

## D8 采样参数

### D8.1 按模型分两档输出上限

`provider/transform.ts:30-38, 1888-1891`：

```ts
export const OUTPUT_TOKEN_MAX = Flag.MIMOCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32_000
export const LARGE_MODEL_OUTPUT_TOKEN_MAX = 128_000

export function usesLargeModelDefaults(model) {
  if (["mimo", "xiaomi"].includes(model.providerID.toLowerCase())) return true
  return [model.id, model.api.id].some((id) =>
    ["claude", "gpt", "mimo"].some((name) => id.toLowerCase().includes(name)))
}

export function maxOutputTokens(model): number {
  if (usesLargeModelDefaults(model)) return LARGE_MODEL_OUTPUT_TOKEN_MAX   // 128K
  return Math.min(model.limit.output, OUTPUT_TOKEN_MAX) || OUTPUT_TOKEN_MAX // min(模型上限, 32K)
}
```

消费点还有 `provider/provider.ts:1392-1401`（模型注册时 output 缺省值按此推断）。

### D8.2 temperature 是能力位，默认**不发**

`llm-server/completions.ts:210-213`：

```ts
temperature: model.capabilities.temperature
  ? (input.req.temperature ?? ProviderTransform.temperature(model))
  : undefined,
```

`:210` 注释：「Note `capabilities.temperature` defaults to FALSE」；`:253`「forwarding a caller's temperature to a model ... 」。

## D9 模型注册与匹配

### D9.1 匹配方式：**模型 id 子串**为主，providerID 为辅

见 D2.1（提示）、D2.2（工具集）、D8.1（输出上限）。`providerID ∈ {mimo, xiaomi}` 是唯一直接按 provider 判定的地方。

### D9.2 effort 方言由 `variants` 数据承载

`llm-server/completions.ts:93-118` 注释：

> Translate an OpenAI `reasoning_effort` into whatever this model's provider calls it. **No mapping table is invented here.** `ProviderTransform.variants` already encodes the per-provider spelling — `reasoningEffort` for OpenAI, a `thinking` budget for Anthropic, `thinkingConfig.thinkingBudget` for Google — and `Model.variants` carries the result, merged with whatever the user configured.
> An effort the model does not offer is a **400 that lists what it does**, because the alternative is a silent downgrade: a caller who asked for `high` and received the default has no way to notice.

`provider/transform.ts:1259` `export function variants(model)`。

### D9.3 成本乘数

`transform.ts:1216` `if (id.includes("mimo")) return 1.0`。

## D10 多模态门控

- `provider/capability-registry.ts`：音频 MIME 集（MiMo audio API 的 MP3/WAV/FLAC/M4A/OGG）、视频 MIME 集（MiMo video API 的 MP4/MOV/AVI/WMV）；`:124` 注释提到「`@ai-sdk/openai-compatible@2`（repo-patched）把 wav/mp3/flac/m4a/ogg 序列化为 `input_audio` 并拒绝其他音频；video 序列化为 `video_url` 且收窄到 MiMo video API 的 mp4/mov/avi/wmv」。
- `provider/image.ts:418-425`：`MIMOCODE_MAX_ATTACHMENT_SIZE` 控制附件压缩（按 stat 或 base64 长度）。
- `transform.ts:873-882`：`MIMOCODE_MAX_PROMPT_IMAGES` / `MIMOCODE_MAX_PROMPT_IMAGE_SIZE ?? providerImageCap(model)`。

## D11 错误处理 / 容错 —— **循环检测（模型可靠性专属优化）**

### D11.1 ngram 文本循环检测（**CJK 感知**）

`session/prompt/text-ngram-detection.ts`：

```ts
export const TEXT_NGRAM_MAX_RECOVERY = 2

export function tokenizeForNgram(text: string): string[] {
  return text.toLowerCase().replace(/\s+/g, " ")
    .replace(/([　-ヿ㐀-䶿一-鿿豈-﫿＀-￯])/g, " $1 ")   // 逐字切出 CJK/假名/全角
    .trim().split(" ").filter(Boolean)
}
export function detectRepeatedNgram(tokens, n, threshold): boolean { /* 计数同 gram */ }
export function detectConsecutiveRepeat(tokens, minBlockSize, threshold, minDistinct = 3): boolean { /* 按周期 p 找重复 */ }
```

**正则范围**：`　-ヿ`（CJK 符号+假名）、`㐀-䶿`（扩展 A）、`一-鿿`（基本汉字）、`豈-﫿`（兼容）、`＀-￯`（全角）——**中文字符被单独切分**，否则整句中文会被当成一个 token 导致 ngram 检测失效。

### D11.2 推理内容重复检测

`session/prompt/loop-streak.ts`：

```ts
export const LOOP_STREAK_TRIGGER_COUNT = 3
export const LOOP_STREAK_MAX_SPAN = 64
export function normalizeReasoningForStreak(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ")
    .replace(/^(let me |i'll |i will |let's )/i, "")   // 剥掉开头套话再比对
}
```

配 `stableStringify`（键排序）对工具参数做稳定序列化后哈希比对——**同参数重复 3 次即判循环**。

### D11.3 架构文档

`docs/architecture/retry-coordinator.md`、`docs/architecture/codex-microkernel-runtime.md`。

## D12 其它专属

### D12.1 Token Efficient Mode —— bash 输出两级过滤（**最大的一项专属优化**）

`docs/harness/MiMo Token Efficient Mode.md` + 实现 `tool/bash_token_efficient_pipeline.ts` / `_heuristic.ts`。

**一句话**：用通用正则管线 + 启发式形状管线，过滤 bash 输出中的冗余 token。**实验功能，默认关闭**（`MIMOCODE_EXPERIMENTAL_TOKEN_EFFICIENCY`）。

**三条硬约束**：
1. **仅清 inline，不清落盘** —— 落盘归档（truncation file）与 TUI 预览（`metadata.output`）保持原始字节，便于人工 grep / 判读；只有最终 `output` 经清理。
2. **never-worse 守门** —— 管线尾部：`if (bytesOut + NEVER_WORSE_MARGIN >= bytesIn) return 原始 text`（清理没省到就回吐原文）。
3. **单 flag、默认关** —— 显式 opt-in，且**不被 `MIMOCODE_EXPERIMENTAL=1` 派生**。

**通用过滤管线（5 层，顺序有约束）**：

| 层 | 职责 | 关键实现 |
| --- | --- | --- |
| `clean_progress` | 按行折叠 `\r` 进度条，只留最后一帧 | 按行 split → 取最后一个 `\r` 之后 |
| `clean_ansi` | 剥 ANSI CSI/OSC/DCS、退格 overstrike、控制字节 | `ANSI_CSI` / `ANSI_OSC` / `ANSI_DCS` / `BACKSPACE` / `CTRL_BYTES`（保留 `\t\n\r`） |
| `clean_redact` | PEM 整块 + 8 类行内密钥 | `PEM_BLOCK`（跨行）+ Bearer/Token、JWT(`eyJ` 三段)、AWS(`AKIA`/`ASIA`)、GitHub(`gh[pousr]_`)、OpenAI(`sk-`)、Anthropic(`sk-ant-`)、Slack(`xox[abprs]-`)、通用 `KEY=VALUE` |
| `clean_longline` | 单行 > 500 字符 → head 160 + `…<elided N chars>` | `MAX_LINE_CHARS = 500` / `LINE_HEAD_KEEP = 160` |
| never-worse 守门 | 见上 | — |

**顺序约束**：progress 必须先于 ansi；redact 必须在去重截断前。

**启发式过滤管线（按输出形状剪裁）**：

双通道形状识别（**命令名通道 + 内容指纹通道**，串行——因为用户常 pipe 嵌套 `bash -c "cd x && pytest"`，且输出前 30 行可能全是 ANSI 噪音）：

| 形状 | 剪裁规则 | 预期减量 |
| --- | --- | --- |
| `gitdiff` | lockfile / min.js / dist 整段抑制；单 hunk 100 行 cap；尾附 `+added -removed` | 85% |
| `pytest` | 4 态状态机（Header→TestProgress→Failures→Summary），保留 collected / `E` 行 / `file:line:` / FAILED / short summary | 90% |
| `npm` | 连续 `npm warn deprecated` 折成 `[×N deprecation warnings: top: A, B, C]` | 65% |
| `make` | 砍 Entering/Leaving directory、bare 编译命令、caret | 53% |
| `stacktrace` | 折 site-packages/.venv/node_modules/stdlib 帧，连续 ≥2 合并为 `[N dependency frame(s) suppressed]` | 69% |
| `tsc` | 按错误码 group Top-5 一行汇总；按文件 group Top-8；每组留 1 样本 | 80% |
| `kubectl` | trailer 建议 `-o json`；只折「全 Running / 0 restart」连续行，不重写列 | 70% |
| `json` | 默认裁 `embedding`/`raw_html`/`body`/`content`/`base64` 大字段；schema-only 模式推断键加类型 | 95% |
| `md` | 清 HTML 注释、徽章行、纯图片行、装饰 `---`、多空行 | ~50% |
| `gostest` | NDJSON 流式聚合：按 pkg 累 pass/fail/skip；fail 时累积 output 作 cause | 90% |

**命令层 passthrough**（用户已自行投影时放行）：含 `--json` / `--format json` / `-o json` / `--no-color`；尾含 `| tee` / `| xxd` / `| hexdump`；含 `# nofilter` / `# raw`。

**扩展契约**（零侵入加形状）：

```ts
export interface Shape {
  id: string
  match: (command: string, head4k: string, tail4k: string) => boolean
  apply: (body: string, ctx: { command: string }) => string
}
const SHAPES = [S_gitdiff, S_pytest, S_npm, S_make, S_stacktrace, S_tsc, S_kubectl, S_json, S_md, S_gostest]
```

### D12.2 Orchestrator Mode（多会话调度）

`docs/harness/MiMo Orchestrator Mode.md`（flag `MIMOCODE_EXPERIMENTAL_ORCHESTRATOR`，默认关）：

- **单窗口、单会话、纯自然语言**管理全部任务；Orchestrator 是 leader/manager，**自己不做实质工作**（不写代码、不做实现规划、不做质量评审），只做「拆分成派发单元」+ 协调/集成/汇报。
- child 是 **peer 会话**（`mode: "peer"`，后台运行，有独立 session id / 任务面板 / 记忆），**用户可完整 attach**（`mimo -c <id>`）——不是 in-session subagent。
- `--dir`（child 运行目录，任意项目）+ `--isolate`（在 `dir` 所属仓库开独立 **git worktree**，分支 `mimocode/<task-slug>`，worktree 位于 `<data>/worktree/<projID>/<task-slug>`）。
- **不轮询**：`create` 立即返回，child 完成经 inbox 通知唤醒 Orchestrator。
- **权限转发审批**（关键设计）：后台 child 默认 `interactive:false` → 权限 `ask` 被**静默拒绝**（`DeniedError`）。对 Orchestrator peer child 改为**转发审批**：`decideAskRouting`（`src/agent/config.ts`）三分——系统 agent（checkpoint-writer/dream/distill）仍自动拒绝；**Orchestrator peer**（background + `mode:peer` + 有父会话）转发；其他后台（compose subagent 等）仍自动拒绝。转发请求可由用户直接批、或 Orchestrator 持「委派授权」代批（`session approve` 一次性 / `session grant-approval <id>|all` 预授权）。**去重**：用户批与 Orchestrator 批收敛到同一 Deferred，第二次幂等 no-op。**不挂死**：`FORWARD_DENY_TIMEOUT_MS`（5 分钟）后自动拒绝。
- **全局唯一工作区**：`<data>/orchestrator`（`src/global/index.ts` 的 `orchestratorDir()`），无论从哪启动都落到同一个根 Orchestrator 会话。
- **集成**：Orchestrator 自己用 `bash` 做 git 集成（`git merge-tree` 预览冲突 → `git merge`/cherry-pick）。**只在工作已合并或任务放弃后才 `cancel`**（`cancel` 会删 worktree 与分支，对未合并工作执行会永久丢失）。

### D12.3 Mix of Harness and Hand-off（跨 harness 移交）

`docs/harness/Mix of Harness and Hand-off.md`：

- 把 **Codex CLI** 与 **Claude Code CLI** 封装为 built-in skill（`<data>/builtin_skills/local/skills/codex/`、`claude-code/`），以子进程形式拉起。
- **Try-Best 检测器**监控当前 turn 健康度，命中「低收益循环」时暂停 turn、让用户选另一个 harness 接手。**低收益的判据**：同一文件被反复编辑、同一条 bash 命令原样重试、探索/修改比例上不去——「真正的失败信号不是某一步错了，而是**继续烧 token 也换不来 progress**」。
- **不切换会话的 provider/model**：控制平面留在 MiMoCode 会话，执行平面在选中的 harness。上下文/任务面板/记忆/审批路由不重建。
- 对 harness 差异的观察：「Codex 更乐观、容易过早宣告完成；Claude Code 探索更细，但在明确指令下容易陷入相似 diff 反复重写」。

---

# 仓库 3/6 — kimi-code（月之暗面）

仓库：`MoonshotAI/kimi-code`（默认分支 `main`）

## D1 仓库身份 / 上游底座

`@moonshot-ai/monorepo`（`license: MIT`），**自研底座**（非 fork）。包管理器 pnpm。

`packages/`：`agent-core-v2`（核心）/ `kosong` / `klient` / `kap-server` / `acp-server` / `pi-tui` / `tree-sitter-bash` / `minidb` / `oauth` / `transcript` / `telemetry` / `remote-control` / `migration-legacy` / `kaos` / `node-sdk`。
`apps/`：`kimi-code` / `kimi-inspect` / `vis` / `vscode`。`plugins/`：`marketplace.json` + `official/`。

**注意**：`lint` 脚本含 `node scripts/check-no-comments.mjs`——**代码里禁止注释**（因此本仓库的「设计意图」主要靠类型命名与文档表达，源码注释极少）。

`agent-core-v2/src/` 顶层：`_base` / `agent` / `app` / `debug` / `features` / `human` / `llm-adapter` / `mcpCore` / `os` / `persistence` / `program` / `runtime` / `session` / `state` / `tool` / `wire` / `workspace`。

## D9 模型注册与匹配（先讲，它是骨架）

### D9.1 分派键 = 声明的 `protocol`，四值枚举

`human/llm/protocol/base.ts:7`：

```ts
export type ProtocolName = 'openai' | 'openai_responses' | 'anthropic' | 'google-genai';
```

`provider-catalog.ts:36` 的 `CatalogModelDefinition` 有 `readonly protocol?: ProtocolName`；`provider-catalog.ts:240` `requester = provider.createRequester(model.protocol)`。

**与 Step-Code 的 `model.api` 同构：模型声明协议，分派按协议。**

### D9.2 `ProtocolBinding`：provider 声明支持的协议及绑定

`human/llm/provider/definition.ts`：

```ts
export interface ProtocolBinding<N extends ProtocolName = ProtocolName> {
  readonly base: ProtocolBase<ProtocolTraitFor<N>>;
  readonly trait?: ProtocolTraitFor<N>;
  readonly connection?: ProviderConnection;
  readonly classifyError?: LlmErrorClassifier;
  readonly capability?: (modelName: string) => ModelCapability | undefined;
}

export interface ProviderDefinition {
  readonly id: string;
  readonly protocols: Readonly<{ [N in ProtocolName]?: ProtocolBinding<N> }>;
  readonly media?: ProviderMediaContribution;
  readonly models?: ProviderModelSource;
}
```

`createProvider()` 的行为要点：
- `defaultBinding = entries.values().next().value`（**首个声明的协议为默认**）；
- `bindingFor(name)`：name 为 undefined → 默认；**name 不在表内 → `throw`**（`provider '${id}' has no protocol '${name}' (available: …)`）——**大声失败，不静默降级**；
- `detectCapability(binding, modelName) = binding.capability?.(modelName) ?? binding.base.capability?.(modelName) ?? UNKNOWN_CAPABILITY`——**三级回退，终点是显式 UNKNOWN 哨兵**。

### D9.3 能力是**函数**而非静态表，且 UNKNOWN 是一等状态

`human/llm/capability.ts`：

```ts
export interface ModelCapability {
  readonly image_in: boolean; readonly video_in: boolean; readonly audio_in: boolean;
  readonly thinking: boolean;  readonly tool_use: boolean;
  readonly dynamically_loaded_tools?: boolean;
}

const UNKNOWN_CAPABILITY_MARKER = Symbol.for('moonshot-ai.kosong.UNKNOWN_CAPABILITY');
export const UNKNOWN_CAPABILITY: ModelCapability = Object.freeze(
  Object.defineProperty({ /* all false */ }, UNKNOWN_CAPABILITY_MARKER, { value: true }));
```

`isUnknownCapability()` 做**两重判定**：① 身份/`Symbol` 标记；② **结构启发式**（全 false 也视为 unknown）。

**设计要点**：显式区分「声明为 false」与「不知道」。DeepOrca 的 `ModelSpec.familyResolved` 是同类概念但只在家族级。

`openai/capability.ts` 的能力探测是**按模型名的纯函数**：

```ts
export const OPENAI_VISION_TOOL_PREFIXES = ['gpt-4o','gpt-4-turbo','gpt-4.1','gpt-4.5'] as const;
export function isOpenAIReasoningModel(n: string) { return /^o\d/.test(n); }
export function getOpenAILegacyModelCapability(modelName: string) {
  const normalized = modelName.toLowerCase();
  if (isOpenAIReasoningModel(normalized)) return OPENAI_REASONING_CAPABILITY;
  if (hasModelPrefix(normalized, OPENAI_VISION_TOOL_PREFIXES)) return OPENAI_VISION_TOOL_CAPABILITY;
  if (normalized.startsWith('gpt-3.5-turbo')) return OPENAI_TEXT_TOOL_CAPABILITY;
  return undefined;   // ← 未知返回 undefined，交给上级回退到 UNKNOWN
}
```

### D9.4 模型目录条目（per-model 画像）

`human/llm/provider-catalog.ts`：

```ts
export interface CatalogModelDefinition extends LlmModel {
  displayName?: string; maxOutputSize?: number;
  reasoningKey?: string; supportEfforts?: readonly string[]; defaultEffort?: string;
  offEffort?: string; alwaysThinking?: boolean; adaptiveThinking?: boolean;
  protocol?: ProtocolName; name?: string; aliases?: readonly string[];
  oauth?: CatalogOAuthRef;
  overrides?: CatalogModelOverrides;   // 嵌套覆盖层
  extras?: Readonly<Record<string, unknown>>;
}
```

`CatalogProviderEntry`：`info` + `discovered`（探测所得）+ `override`（手工覆盖）+ `pingErrors`；`modelSource: 'static' | 'discover' | 'oauth-catalog'`。

**即：目录 = 静态声明 + 运行时探测 + 手工覆盖三层合并。**

## D3 推理 / 思考控制

### D3.1 thinking 元数据：五件套 + 四个错误码

`human/llm/thinking.ts:11-28`：

```ts
export interface ModelThinkingMetadata {
  readonly supportEfforts?: readonly string[];   // 支持哪些档
  readonly defaultEffort?: string;
  readonly offEffort?: string;                   // 「关」映射到哪档
  readonly alwaysThinking?: boolean;             // 不可关
  readonly adaptiveThinking?: boolean;           // 自适应
}
export type ThinkingConfigErrorCode =
  | 'effort-not-supported' | 'thinking-unsupported' | 'thinking-cannot-disable' | 'off-needs-offeffort';
```

`ThinkingResolution` 三态：`{ok:true, encode:'silent'}` / `{ok:true, encode:'effort', value}` / `{ok:false, error}`；`resolveThinkingEffort(options, model, strictValidation = false)`。

`thinkingMetadataOf(model)` 从模型对象上读这五个可选字段，**全 undefined 则返回 undefined**（= 无元数据，不猜）。

### D3.2 thinking 是**策略函数 + 回退链**

`human/llm/protocol/thinking.ts`：

```ts
export interface ThinkingContribution { readonly kwargs: Record<string, unknown>; readonly preserveThinking?: boolean; }
export type ThinkingStrategy = (thinking: ThinkingRequestOptions, ctx: TraitContext) => ThinkingContribution | undefined;
export type ThinkingFallback = (thinking: ThinkingRequestOptions, ctx: TraitContext) => Record<string, unknown> | undefined;

export function applyThinking(kwargs, thinking, strategy, ctx, fallback?): AppliedThinking {
  const contribution = strategy?.(thinking, ctx);
  const hookedKwargs = contribution === undefined ? fallback?.(thinking, ctx) : contribution.kwargs;
  return { kwargs: hookedKwargs === undefined ? kwargs : { ...kwargs, ...hookedKwargs },
           preserveThinking: contribution?.preserveThinking ?? false };
}
```

**`preserveThinking` 是一等输出**——策略不仅要给出 kwargs，还要声明「本轮是否必须保留 thinking」。

### D3.3 reasoning 字段名的**观察式方言探测**

`requester/bases/openai/reasoning-key.ts:11-56`：

```ts
export const KNOWN_REASONING_KEYS = ['reasoning_content', 'reasoning_details', 'reasoning'] as const;
export const DEFAULT_REASONING_KEY: ReasoningKey = KNOWN_REASONING_KEYS[0];   // reasoning_content

export class ReasoningKeyDialect {
  private _detected: string | undefined;
  constructor(private readonly _explicitKey?: string) {}
  observe(source: unknown): string | undefined {
    const found = extractReasoning(source, this._explicitKey);
    if (found === undefined) return undefined;
    if (this._explicitKey === undefined && this._detected === undefined) this._detected = found.key;
    return found.value;
  }
  outboundKey(): string { return this._explicitKey ?? this._detected ?? DEFAULT_REASONING_KEY; }
}
```

**不硬编码「哪个模型用哪个字段」，而是观察入站响应实际用哪个 key，出站就用同一个。**优先级：显式配置 > 观察结果 > 默认。

### D3.4 `reasoning_details` 的数组投影

同文件 `:72-110`：

```ts
export const REASONING_DETAILS_KEY = 'reasoning_details';
export interface ReasoningDetailsElement { readonly type?: string; readonly index: number;
  readonly summary?: string; readonly encrypted?: string; }
export function convertReasoningDetails(elements, hiddenSummary = false): StreamedMessagePart[] {
  // type==='encrypted' 的只留 encrypted；否则取 summary
}
```

`reasoningKey` 来源：`app/kosongConfig/modelsDev.ts:206` `reasoningKey: modelsDevReasoningKey(model.interleaved)`——即**取自 models.dev 的 `interleaved.field`**；另有 `envOverlay.ts:129` 的 `KIMI_MODEL_REASONING_KEY` 环境变量覆盖位。

## D4 工具调用协议

### D4.1 `OpenAITrait` —— **per-provider/model 的钩子接口**（本仓库最有价值的抽象）

`requester/bases/openai/trait.ts`（全文 42 行）：

```ts
export interface OpenAITrait {
  readonly reasoningKey?: string;
  readonly toolCallIdPolicy?: ToolCallIdPolicy;
  readonly toolMessageConversion?: ToolMessageConversion;
  readonly strictThinkingValidation?: boolean;
  readonly thinking?: ThinkingStrategy;

  encodeCacheKey?(key: string, ctx: TraitContext): Record<string, unknown> | undefined;
  encodeMaxCompletionTokens?(max: number, ctx: TraitContext): Record<string, unknown> | undefined;
  convertTool?(tool: ToolDescription, ctx: TraitContext): Record<string, unknown> | undefined;
  convertMessage?(message: Message, converted: OpenAIWireMessage, ctx: TraitContext): OpenAIWireMessage | null;
  mergeHistory?(messages: readonly OpenAIWireMessage[], ctx: TraitContext): OpenAIWireMessage[] | undefined;
  buildParams?(params: Record<string, unknown>, ctx: TraitContext): Record<string, unknown> | undefined;
  extractUsage?(chunk: OpenAIRawChunk): OpenAIRawUsage | null | undefined;
}
```

**这是一份完整的「模型专属适配扩展点」清单**：reasoning 字段名、tool_call id 策略、工具消息转换、thinking 严格校验、thinking 策略、**缓存键编码**、输出上限字段、**工具 schema 转换**、消息转换、历史合并、最终参数钩子、用量提取。

`anthropic/trait.ts`（37 行）同构。

### D4.2 消息重写模式（声明式 Pattern）

`human/llm/protocol/rewrite.ts`：

```ts
export interface Pattern<T> { readonly name: string; rewrite(items: readonly T[], index: number): Rewrite<T> | null; }
export function applyPatterns<T>(items, patterns): T[] { /* 顺序应用每个 pattern */ }
```

`protocol/patterns.ts` 提供 `mergeConsecutiveUsers(policy)`（合并连续 user 消息，带「tool-result-only」边界策略）与 `toolResultToPlainText`。

### D4.3 工具参数解析失败是一等状态

`agent/toolExecutor/toolExecutorService.ts:743` 有 `'tool args JSON parse failed'` 日志；`agent/toolDedupe/toolDedupeService.ts:470` 用 `parseToolCallArguments(rawArguments).parseFailed` 判定。**未发现参数修复链**（对比 DeepOrca 的 `tool-call-repair.ts` 更强）。

## D5 工具面管理 —— **重复熔断器（repeat breaker）**

`agent/toolDedupe/toolDedupeService.ts`（579 行）。核心是**递进升级阶梯**：

```ts
const REPEAT_REMINDER_1_START = 3;
const REPEAT_REMINDER_2_START = 5;
const REPEAT_REMINDER_3_START = 8;
const REPEAT_FORCE_STOP_STREAK = 12;
type HandoffPhase = 'idle' | 'pending' | 'active' | 'done';
```

**L1（连续 3 次）**：

> The same tool call has been repeated several times in a row. **Before making your next call, write one sentence stating what new information you expect it to produce.** Then act on that sentence: if it names something this result does not already give you, choose the action that best provides it; otherwise, continue with the evidence you already have.

**L2（连续 5 次）**——强制三选一并先声明选择：

> Choose exactly one of the following and state your choice before acting:
> (1) **Falsification check**: run the cheapest test that could conclusively disprove your current approach, if such a test exists.
> (2) **Missing input**: tell the user precisely what information or decision you need to proceed, and ask for it.
> (3) **Conclude**: deliver your best result based on the evidence already gathered, listing anything that remains uncertain.

**L3（连续 8 次）**：

> Write your final response now, without any further tool calls. Cover: the current blocker, each approach you have tried and what it established, and the specific information or decision you need from the user to unblock progress. **Text only.**

**L4（连续 12 次）—— 强制终止本轮**：

```ts
const HANDOFF_VETO_TEXT =
  'This turn was ended by the repeat breaker after the same tool call was issued ' +
  `${String(REPEAT_FORCE_STOP_STREAK)} times in a row. This step accepts a text response only, ` +
  'so the tool call was not executed. Reply in text: the current blocker, what you tried, ' +
  'and what you need next.';
const HANDOFF_VETO_RESULT: ToolDedupeResult = {
  output: HANDOFF_VETO_TEXT, isError: true, stopTurn: true, stopTurnReason: REPEAT_BREAKER_STOP_REASON,
};
```

**要点**：① 升级而非一刀切；② 每级给**可执行的具体动作**（尤其 L2 的三选一）；③ 最末级**拒绝执行工具**并只接受文本；④ 全程是 `stopTurn` 而非抛错。

配套状态键（`defineState`）：`stepCalls` / `originalCallIndex` / `syntheticCallIds` / `callKeyByCallId` / `consecutiveKey` / `consecutiveCount` / `activeTurnId` / `activeStep` / `turnCallRecords` / `turnRepeatCount` / `handoffPhase`。参数以 `canonicalTelemetryArgs` 规范化后比对（`createHash` 哈希）。

另有 `dynamically_loaded_tools` 能力位（`ModelCapability`）——工具可动态加载。

## D6 上下文与压缩

### D6.1 触发是**比例**，且 per-profile 可覆盖

`agent/fullCompaction/strategy.ts:18-28`：

```ts
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  triggerRatio: 0.85,             // 窗口用到 85% 触发
  blockRatio: 0.85,               // 阻断阈值（与 trigger 分开的独立路径）
  reservedContextSize: 50_000,    // 预留 50K
  maxCompactionPerTurn: Infinity,
  maxOverflowCompactionAttempts: 3,
  maxRecentMessages: 4,           // 保留最近 4 条
  maxRecentUserMessages: Infinity,
  maxRecentSizeRatio: 0.2,        // 近期尾部 ≤ 预算的 20%
  minOverflowReductionRatio: 0.05,
};
```

```ts
shouldCompact(usedSize: number): boolean {
  if (this.maxSize <= 0) return false;
  return usedSize >= this.maxSize * this.config.triggerRatio || this.shouldUseReservedContext(usedSize);
}
```

`maxSize = model.modelCapabilities.max_input_tokens ?? max_context_tokens`——**窗口来自模型能力**。

覆盖链（`:90-97`）：`triggerRatio = model.compactionTriggerRatio ?? DEFAULT.triggerRatio`；`blockRatio = Math.max(triggerRatio, DEFAULT.blockRatio)`；`reservedContextSize = model.reservedContextSize ?? DEFAULT.reservedContextSize`。配置 schema 约束：`compactionTriggerRatio: z.number().min(0.5).max(0.99).optional()`（`agent/loop/configSection.ts:18`）。

**两个策略委托**：`delegate()`（带模型配置）与 `windowDelegate()`（用 DEFAULT 配置生成窗口摘要）。

### D6.2 双层压缩 + 窗口可回溯

- `human/compaction/` 与 `agent/fullCompaction/`（`fullCompaction.ts` / `fullCompactionService.ts` / `compactionOps.ts` / `compactionInstruction.ts` / `compaction-instruction.md`）。
- `agent/contextMemory/compaction-summary-prefix.md` + `compactionHandoff.ts`。
- `fullCompaction/contextRecovery.ts:22` 暴露「多窗口」模型：

> `window ${windows.length + 1} (the one you are in now) starts at line ${nextStart} with the \`context.apply_compaction\` record that carries this note — it is already in your context; no need to read it.`

**即压缩产生「窗口」记录，模型可回溯早期窗口。**

## D7 缓存纪律

- `OpenAITrait.encodeCacheKey?(key, ctx): Record<string, unknown> | undefined`——**缓存键的编码是 per-provider 钩子**（对比 DeepOrca 无此概念）。
- 系统提示只有一份 `system.md`（不按模型分叉），动态内容经 `AgentProfileContext` 注入。
- **Reminder 走消息层**（见 D2/下方 D12），保持前缀稳定。

## D8 采样参数

`requester/bases/openai/extra-params.ts`（全文 16 行）——完整 OpenAI 采样面：

```ts
export interface OpenAIExtraParams {
  readonly temperature?: number; readonly top_p?: number;
  readonly stop?: string | readonly string[]; readonly n?: number; readonly seed?: number;
  readonly presence_penalty?: number; readonly frequency_penalty?: number;
  readonly logit_bias?: Record<string, number>;
  readonly logprobs?: boolean; readonly top_logprobs?: number;
  readonly parallel_tool_calls?: boolean; readonly service_tier?: string;
  readonly user?: string; readonly extra_body?: Record<string, unknown>;
}
```

**未发现**按任务类型动态调参的证据。

## D10 多模态门控

- `ModelCapability` 三模态位：`image_in` / `video_in` / `audio_in`。
- `human/llm/media/` 完整管线：`cache` / `degrade`（降级）/ `image-formats` / `mime` / `ref` / `resolver` / `source` / `store` / `upload`。
- `agent/media/image-compress.ts`；`agent/tools/read-media-file/readMediaFileTool.ts:479` 有 `readByteBudget` 与 `compressed.finalByteLength` 判定。

## D11 错误处理 / 容错

- `human/llm/empty-response.ts`（空响应专门处理）、`finish-reason.ts`、`errors.ts`（含 `SyntaxRequestFormatError` 与 `toLlmErrorMessage()`）。
- `ThinkingConfigError` 四个错误码（D3.1）——**把「配置错误」建模成可分类、可上报的具名错误**。
- 重复熔断器（D5）。
- `agent/task/taskService.ts:1553` 的子 agent 恢复提示：「To recover or continue this subagent, call `Agent(resume="${agentId}", prompt="Pick up where you left off; **redo the last tool call if its result was never observed**.")」。

## D12 其它专属

- **系统提示只有一份** `app/agentProfileCatalog/system.md`（6.2KB）——**与 MiMo 的「按模型 8 份提示」形成鲜明对比**。
- **Agent 画像目录**（`app/agentProfileCatalog/`）：`AgentProfile { name, description, whenToUse, override, tools, disallowedTools, subagents }`；多源贡献带优先级：
  ```ts
  export const AGENT_PROFILE_SOURCE_PRIORITY = {
    builtin: 0, plugin: 5, user: 10, extra: 20, workspace: 30, explicit: 40,
  } as const;
  ```
- **`wrapSystemReminder`（消息层提醒机制）**：`features/reminder/systemReminder.ts`
  ```ts
  const SYSTEM_REMINDER_PREFIX = '<system-reminder>\n';
  const SYSTEM_REMINDER_SUFFIX = '\n</system-reminder>';
  export function wrapSystemReminder(content: string) { return `${PREFIX}${content.trim()}${SUFFIX}`; }
  export function systemReminderContent(message: ContextMessage): string | undefined { /* 反向提取 */ }
  ```
  重复熔断器的三级提醒全部经此包装后**注入消息流**（不改 system prompt）。这与 MiMo 的多 Skill Reminder 论据（前缀缓存）一致。
- `app/kosongConfig/`：`modelsDev.ts` / `modelsDevUpstream.ts` / `envOverlay.ts` / `configSection.ts`——模型目录以 models.dev 为上游 + 环境变量覆盖层。

---

# 仓库 4/6 — deepseek-harness（DeepSeek 官方）

仓库：`deepseek-ai/deepseek-harness`（默认分支 `main`，`@deepseek-ai/dsh-root`，MIT，pnpm 11，node ≥22.19）

## D0 仓库形态（先讲，因为它与本仓库的组织方式高度相关）

**60+ 个 `packages/*` 包的规整 monorepo**，包名统一 `@deepseek-ai/dsh-*`。覆盖：`llm`（含 `llm` / `llm-deepseek` / `llm-pi-ai` / `llm-retry` / `token-meter` / `deepseek-llm-api-extensions`）· `compaction`（拆 4 包：`compaction-basic` / `compaction-image-offload` / `compaction-tool-result-pruner` / `command-compact`）· `context` · `session` · `guard` · `hooks` · `spill` · `todo` · `goal` / `plan` / `workflow` / `subagent` / `schedule` · `skill` / `mcp` / `lsp` / `browser-use` / `computer-use` · `sandbox` / `ssh` / `shell` / `subprocess` / `terminal` 等。

**文档即规格**：每个包的 README 有固定小节 —— `Summary` / `Use this package` / `Understand the implementation` / **`Model Experience`** / `Known Limitations and Deferred Work` / `Dev Note`。其中 **`Model Experience` 小节下必带 `#### Token effect` 与 `#### KV Cache effect` 两个子标题**。

### D0.1 ★ 每项特性必须声明「KV Cache 影响」——本次调研最重要的发现

`packages/core/agent-loop/README.md:160-162`（系统提示段的 KV Cache effect）：

> #### KV Cache effect
>
> Append-only only while system text, schemas, and earlier history remain **byte-identical** under the same provider and model route. An unchanged rendered prompt keeps the cached prefix unless an incapable route or a new request series must consolidate retained in-history system nodes. **A prompt change that replaces a system node in place makes the request differ from that node's first token — in full when the node is node 0 — so the provider prefix cache misses from there**; when the prepared call declares `systemPromptUpdate: 'in-history'`, a non-empty prompt change inside a continuing request series is **appended after the cached history**, so the prefix through that history stays reusable. A schema or composition change invalidates reuse from the first altered request token.

同段还有**诚实的代价标注**（`:158`）：

> System text and schemas are **paid again on every step**, and on an `in-history` route **every retained prompt version is paid until compaction shadows it** or prompt reconciliation empties it.

其它段落的 KV Cache effect（`packages/core/agent-loop/README.md:174-176` 等）：

> Ordinary history growth is append-only and preserves reusable entries. **A surface replacement or compaction invalidates reuse from the first shadowed history token.**

`packages/llm/deepseek-llm-api-extensions/README.md` 亦标注：

> #### KV Cache effect
> **None**; registry fields are model-hidden provider metadata and **do not alter the serialized model-input prefix**.

**含义**：在这个仓库里，「一个新特性是否破坏 prefix cache」是一等设计问题，必须在文档里显式回答。**这套纪律本身比任何单项优化都更值得 DeepOrca 借鉴。**

## D1 仓库身份 / 上游底座

- **`llm-pi-ai`**（`packages/llm/llm-pi-ai/`）——基于上游 **pi-ai**（`@earendil-works/pi-ai`）的 provider 层。README 明确「This package can run beside the pi-ai adapter」。
- **`llm-deepseek`**（`packages/llm/llm-deepseek/`）——**DeepSeek 官方专属适配器**，走 **Messages API**（`https://api.deepseek.com/anthropic`，Anthropic 风格），而非 OpenAI chat-completions。
- 两者 route 名不冲突，**可同时挂载**；任何为 `deepseek-official` 重复注册的适配器会以 `DUPLICATE_ADAPTER` 失败。

`llm-deepseek/src/` 文件清单：`adapter` / `serialize` / `translate` / `replay` / `sse` / `transport` / `config` / `models` / `model-info` / `defaults` / `types` / `wire-types` / `request-pricing` / `request-extensions` / `request-files` / `files-api` / `file-store` / `file-id` / `upload-index` / `images` / `image-tokens` / `messages-api`。

## D2 系统提示组装 —— **`systemPromptUpdate: in-history`（按模型声明的前缀保护模式）**

### D2.1 模型条目上的声明

`llm-deepseek/src/models.ts`（全文 20 行）：

```ts
export const DEFAULT_MODELS: DeepSeekCatalogModel[] = [
  { id: 'deepseek-flash', name: 'DeepSeek-V41-Flash', contextWindow: DEFAULT_CONTEXT_WINDOW,
    inputModalities: ['text', 'image'], systemPromptUpdate: 'in-history' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro',
    description: 'Stronger agentic coding, knowledge, and difficult reasoning; suited to complex or quality-critical tasks at higher cost.',
    contextWindow: DEFAULT_CONTEXT_WINDOW },
]
```

`llm-deepseek/README.md` 的定义：

> An entry may declare `systemPromptUpdate: in-history` when **its endpoint reads the latest `system` message at any position of `messages` as the complete effective system prompt**; the adapter reports the mode on the resolved model and the prepared call, and the agent loop then **appends a changed prompt after the cached history instead of rewriting the leading system message**.

同 README 的 wire 描述：

> Models declaring `systemPromptUpdate: in-history` **retain the initial top-level system and send new system snapshots after their corresponding user/tool-result turn**; undeclared models use the latest snapshot as the top-level system.

非法值在加载期失败：`llm-deepseek: catalog model "<id>" systemPromptUpdate must be "in-history" when present`。

**默认仅 `deepseek-flash` 声明该模式**——即这是**逐模型**能力，不是全局策略。

### D2.2 压缩与 in-history 的交互（`compaction-basic/README.md`）

> Every selected range starts at the first surface node that is not a `system/message`, so **a system prompt at surface node 0 is never shadowed**; a later `system/message` appended by an **in-history prompt update is ordinary history that the range may shadow**, and the agent loop's projection then **replaces node 0 with the current prompt when their text differs**.

**即：in-history 追加的提示段是普通历史、可被压缩遮蔽；而 node 0 的 system 永不被遮蔽。**

## D3 推理 / 思考控制

### D3.1 effort 四档（`off | low | high | max`），per-model 元数据带 UX 文案

`llm-deepseek/src/model-info.ts`：

```ts
const OFF_REASONING_EFFORT  = ReasoningEffortId('off')
const LOW_REASONING_EFFORT  = ReasoningEffortId('low')
const HIGH_REASONING_EFFORT = ReasoningEffortId('high')
const MAX_REASONING_EFFORT  = ReasoningEffortId('max')

const REASONING_EFFORTS = [
  { id: OFF_REASONING_EFFORT,  name: 'Off',  description: 'Use for simple tasks that do not need reasoning.' },
  { id: LOW_REASONING_EFFORT,  name: 'Low',  description: 'Prefer for routine or latency-sensitive tasks.' },
  { id: HIGH_REASONING_EFFORT, name: 'High', description: 'The default balance for most tasks.' },
  { id: MAX_REASONING_EFFORT,  name: 'Max',  description: 'Reserve for the hardest quality-first tasks.' },
] as const
```

**档位元数据带 `description`**——UI 可以直接告诉用户「该档什么时候用」。DeepOrca 的 `THINK_LEVEL_META` 只有 `english` + `hiddenByDefault`。

**这与 DeepOrca 的 deepseek 家族映射完全一致**（`low/high/max` 三档有效，`medium` 折叠为 `high`）：DeepOrca 的 `THINK_LEVEL_FAMILY_MAPS.deepseek` 正是 `{low:low, medium:high, high:high, xhigh:high, max:max}`——**独立确认了该映射的正确性**。

### D3.2 部署策略与逐请求选择

- `thinking`（部署策略）：默认 `enabled`；`disabled` 时**把每个请求锁死为 `off`**（`model-info.ts` 里换成 `OFF_ONLY_REASONING_EFFORTS`）。
- `reasoningEffort`（默认档）：`off | low | high | max`。
- 序列化：`low`/`high`/`max` **开启思考并写 `output_config.effort`**；适配器自有的 `off` 改为发 `thinking.type: disabled`。
- **不支持的值在**网络 I/O 之前**失败**：`UNSUPPORTED_REASONING_EFFORT`；`thinking: disabled` 与任何非 `off` effort 组合在**插件加载期**即被拒。
- `purpose: 'session-title'` 的请求**强制关思考**，把输出留给标题文本。

### D3.3 temperature 的模型 quirk（显式记录）

`llm-deepseek/README.md`：

> The adapter forwards an explicit `temperature`; **DeepSeek accepts it with thinking enabled but ignores its value in that mode**.

即「思考模式下 temperature 被接受但值被忽略」——**显式记录的模型行为**，而非猜测。

## D4 工具调用协议

### D4.1 工具调用与结果走 Messages content blocks

> Messages sends text, thinking, tool calls, and tool results as **content blocks**.

原生结构化通道，**未发现文本协议兜捞**（grep `DSML` / `tool_call>` 无命中）。

### D4.2 malformed 是一等状态

`llm-deepseek/src/translate.ts:57,155`：

```ts
if (!content.id || !content.name) return malformed('empty tool identity')
try { parsed = JSON.parse(content.arguments) } catch (_invalidProviderToolJson) { return malformed('tool input is invalid JSON') }
```

`llm-deepseek/tests/adapter.e2e.ts:229` 专测：`'continues persisted foreign history containing malformed tool arguments'`——**跨会话恢复时容忍历史里的坏工具参数**。

### D4.3 replay 元数据

> Replay metadata preserves the model and thinking signatures. **Invalid replay metadata emits a warning and omits signatures while retaining text and tool history.**

即坏 replay 元数据**降级而非丢弃**（保留 text + tool 历史，只省 signature）。

## D5 工具面管理

未深入。已知 `llm-pi-ai` 有 `deferredTools` / `deferredToolsMode: 'additional-tools' | 'tool-search'` 相关类型（来自上游 pi-ai 的 Responses 支持）。`packages/spill`（名字暗示上下文溢出处理）未展开。

## D6 上下文与压缩

### D6.1 触发公式（显式含输出预留与 headroom）

`compaction/compaction-basic/README.md`：

> With context window `W`, effective request output cap `O`, and headroom `B`, the default trigger is **`floor(min(W × 0.8, W − O − B))`**, where `B = 65,536` tokens. **Retention keeps the newest 16% of `W − O` verbatim.**

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `thresholdRatio` | `0.8` | 窗口比例 |
| `headroomTokens` | `65536` | 超出输出预留之外的额外压力余量 |
| `retainRatio` | `0.16` | 近期对话原样保留（占 `W − O` 的比例）；与 `retainTokens` 互斥 |
| `retainTokens` | — | 绝对保留预算；必须小于解析后的阈值 |
| `summarizationProvider` / `summarizationModel` | `''` | 摘要副模型；空对则用最近路由请求目标，再退 `AgentOptions` |
| `maxTokens` | `headroomTokens` | 摘要输出上限（含 provider 计数的 reasoning token） |
| `compactionRetries` | `1` | 首次后仍在阈值上时的额外压缩尝试 |
| `maxOverflowRetries` | `1` | 确认 context 溢出后的最大重试（`0` 只关恢复） |
| `modelPolicies` | `[]` | **精确 `{ provider, model, ...partialPolicy }` 的逐模型覆盖** |
| `auto` | `true` | 自动压缩与溢出恢复；`false` 仅手动 |

**加载期校验（fail fast）**：未知设置、**重复的逐模型覆盖**、非法 token 数、两种保留形式并存、**保留比例 ≥ 阈值比例** → 直接拒绝插件加载。

### D6.2 ★ 摘要副调用复用 provider 的热前缀

`compaction-basic/README.md` 的 Design philosophy：

> **Summarization reuses the provider's warm prefix.** Replaying the system prompt held by the `system/message` at surface node 0, the last routed request's tools, and the shadowed-region messages **byte-for-byte** makes the auxiliary call a genuine prefix of the conversation, **so only the trailing instruction and the summary output are uncached**.

实现细节（同一 README）：

> A direct `ctx.llm.stream()` call ... replays the derived `system/message` at surface node 0 as the leading entry of `messages`, followed by the shadowed-region messages (including a shadowed in-history `system/message` in its surface position), and carries **the header's tools verbatim** ... and appends the compaction instruction as the final user message, so it **reuses the provider's warm prefix cache instead of invalidating it**.

**即：压缩不是"另起一次调用"，而是"把被压缩区间原样重放 + 尾部追加一条指令"**，因此前缀命中缓存。压缩结果以 `<compacted-summary>` 标签包裹。

### D6.3 溢出恢复走独立路径

`agent/request-error` 监听器对 provider 确认的 `CONTEXT_WINDOW_EXCEEDED`：**绕过阈值与保留策略**，尝试一次最大平衡头部削减，**只有在 surface replacement generation 前进后才授权重试**。

### D6.4 事务化

> All entry points share one **bracket-first region transaction**: validate the range and live lock, append `compaction/start` **synchronously**, prepare and await the summary, revalidate, append `compaction/summary` plus the replacement, and make **exactly one closing attempt**.

### D6.5 工具输出预裁剪可替代摘要

`compaction-tool-result-pruner`：**不调用模型**，只在压缩触发后运行；裁剪后若已落入阈值内则**跳过摘要**。（「a below-pressure conversation is never touched」）

### D6.6 token 计量的单一权威

> **One measurement service prices every decision.** The singleton `ctx.tokenMeter` measures the latest canonical logged envelope and current surface at one consumed-log revision. When the routed adapter declares **request-image pricing**, the meter applies it to image history.

即图像 token 定价由适配器声明、由 meter 统一计入。

## D7 缓存纪律（本仓库最强项）

| 机制 | 证据 |
| --- | --- |
| **每特性 KV Cache effect 必答** | 全部 README 的 `Model Experience` 小节（D0.1） |
| **in-history 系统提示追加** | `systemPromptUpdate: 'in-history'`（D2） |
| **压缩副调用逐字节重放前缀** | `compaction-basic` Design philosophy（D6.2） |
| **高水位阶梯避免频繁重写前缀** | `llm-deepseek/README.md` 图像 Files 策略：「The stepped high-watermark policy **avoids rewriting an old request prefix after every new image**」 |
| **header 复用规则** | `agent-loop/README.md:93`：只在（首个请求 / envelope 变更(config 或 tools，**prompt 不属于 header**) / 显式 message-series 起点 / surface replacement 或 image-offload 之后 / resume）写完整 header；**未变更的步骤、重试、同一序列的后续轮次继承 header**；**in-history 提示追加不算 replacement**，故其后请求也继承 |
| `cacheControlFormat` / `supportsLongCacheRetention` / `supportsCacheControlOnTools` | `llm-pi-ai/src/config.ts:277-284` 的 compat schema |

`packages/llm/llm-pi-ai/src/catalog.ts` 中还有一组 **drift gate 常量**（新增上游拼写会导致编译失败直到被显式命名）：

```ts
const CACHE_CONTROL_FORMAT_GATE = { anthropic: true }
const THINKING_TOKEN_BUDGET_FIELD_GATE = { thinking_token_budget: true, thinking_budget: true, thinking_budget_tokens: true }
const MAX_TOKENS_FIELD_GATE = { max_completion_tokens: true, max_tokens: true }
const CHAT_TEMPLATE_VAR_GATE = { 'thinking.enabled': true, 'thinking.effort': true, 'thinking.budget': true }
```

## D8 采样参数

- `llm-pi-ai/src/config.ts:281` compat 里有 **`supportsTemperature: z.boolean()`**——temperature 门控是 compat 旗标。
- `llm-pi-ai/src/catalog.ts:423` 注释：`/** Whether the endpoint accepts the \`temperature\` request field; \`anthropic-messages\`. */`。
- `llm-deepseek`：`maxTokens` 默认 **256,000**；`defaultContextWindow` 默认 **1,000,000**；「a model's own cap and explicit request values win」。
- 输出上限与压缩联动：`models[].contextWindow`（或缺省 `defaultContextWindow`）**必须大于**有效请求 `maxTokens` 加压缩策略的 `headroomTokens`。

## D9 模型注册与匹配

### D9.1 路由名 + 模型串直通

> A request selects the route with `provider: deepseek-official`; **the model id passes through to the wire, so new DeepSeek models need no re-registration.**

即**新模型零改码**：未列出的 model id 仍可作为 text-only 路由通过。

### D9.2 未目录化模型 = **保守按 text-only**

`llm-deepseek/src/model-info.ts`：

```ts
// An uncatalogued endpoint is safely treated as text-only. Declaring an
// unverified image capability would let the host persist input that the
// endpoint may reject on every later turn.
...configured === undefined ? { provider, id: model, name: model, inputModalities: ['text' as const] } : catalogModelInfo(provider, configured),
```

**★ 与 DeepOrca 取向相反**：DeepOrca 的 UNKNOWN 家族默认 `multimodal: true`（宽松放行）；DeepSeek 官方选择**默认 text-only**，理由是「声明未验证的图片能力会让宿主持久化端点每轮都可能拒绝的输入」——**坏输入会被持久化进历史，代价是每轮复发**。

### D9.3 逐模型覆盖分三层

- 模型目录条目（`models[]`）：`id` / `name` / `description` / `contextWindow` / `maxTokens` / `inputModalities` / `imagePixelBudget` / `imageMaxBytes` / `systemPromptUpdate`
- `modelPolicies`（压缩域）：`{ provider, model, ...partialPolicy }`
- `ModelOverrideSchema`（pi-ai 域）：`config.ts:26-43` 的 `PiAiModelOverride`

## D10 多模态门控（细节极其完整）

`llm-deepseek/README.md`：

### D10.1 视觉 token 网格（已公布的 provider 网格）

> Omitting `imagePixelBudget` sizes the target on the **published vision token grid of 14px patches, 3:1 downsampling, and at most 1024 tokens per image**, so a square image keeps up to 1302×1302 pixels and a 16:9 image is sent as 1708×961 for the provider's 1708×966 grid; a positive integer replaces the grid with a total-pixel budget, and `low` uses **512×512 total pixels**. Every request image is capped at **4096 pixels per side**（provider limit for requests carrying 15+ images）; `imageMaxBytes` defaults to **2 MiB**.

### D10.2 编码阶梯

> Alpha images use **WebP effort 0** and opaque images use **JPEG on the 85/75/60 quality ladder**, keeping the smallest output when every candidate exceeds the target.

### D10.3 图片的文本伴随

> Every retained image is preceded by **text naming its complete attachment id and actual request dimensions**. When the current filesystem maps the attachment provider's host object, that text also carries a **read-only execution-world path and the extension for a writable copy**. Text-only and unlisted routes receive **stable attachment placeholders** while durable history keeps the image references.

### D10.4 Files API（上传复用）

- 经 `/v1/files` 上传精确请求字节并发 file-id 引用；带 `anthropic-beta: files-api-2025-04-14`。
- **一次请求绝不混用 file id 与 inline image**；文件解析失败/超时则**整体重建**为 inline base64。
- 缓存 id 按 **endpoint + credential** 作用域；过期前刷新；singleflight；配额失败删一批最旧自有文件后重试一次。
- 水位与量化：`maxRequestFilesBytes` 128 MiB / `maxInlineRequestImageBytes` 20 MiB / `maxImagesPerRequest` 600 / `imageOffloadByteQuantum` 64 MiB / `inlineImageOffloadByteQuantum` 10 MiB / `imageOffloadCountQuantum` 20。

## D11 错误处理 / 容错（错误码体系完整）

`llm-deepseek/README.md` 的 Failures and recovery：

| 错误码 | 触发 |
| --- | --- |
| `AUTH` / `QUOTA` / `RATE_LIMIT` / `CONTEXT_WINDOW_EXCEEDED` / `INVALID_REQUEST` / `SERVER` | 非 2xx（401/403 归 AUTH） |
| `HTTP_<status>` | 其它非 2xx |
| `TRANSPORT` / `ABORTED` / `TIMEOUT` | 响应前传输失败 / 调用方中止 / 流空闲超时 |
| `REQUEST_EXTENSION` | 请求扩展准备、字段冲突或 2xx 后接受失败 |
| `STREAM_CLOSED` / `MALFORMED_RESPONSE` | 协议违反 |
| **`EMPTY_RESPONSE`** | 终止 `stop` 但无 content block——**默认重试策略会重试它** |
| `MISSING_CREDENTIAL` / `INVALID_CREDENTIAL` | 凭证缺失 / 畸形（报引用名，**绝不报密钥任何部分**） |
| `IMAGE_OFFLOAD_REQUIRED` | 请求保留图片超出字节预算 |
| `UNSUPPORTED_REASONING_EFFORT` | 不支持的 effort（**网络 I/O 之前**） |
| `UNSUPPORTED_CONTENT` | 摘要调用返回图片输出（而非静默丢失） |

其它容错设计：陈旧文件错误 → 使命名映射失效并**允许一次**替换请求；`streamIdleTimeoutMs` 默认 300,000；`retryPolicy` 默认 normal / 5 次重试（由 `dsh-llm-retry` 执行）。

## D12 其它专属

### D12.1 官方请求附加字段注册表

`packages/llm/deepseek-llm-api-extensions/`：`DeepSeekLlmApiExtensionRegistry` 注册 `ctx.deepseekLlmApiExtensions`；贡献者插件**认领一个字段**，`dsh-llm-deepseek` 在序列化基础请求后准备这些贡献。

- `register(field, provider)`：重复或畸形名**同步失败**；dispose 释放该字段供后续 provider 使用。
- `prepare(request)`：快照已注册 provider、并发准备、**克隆并冻结**返回的 JSON 值，返回 `{ fields, accept }`。准备失败在 HTTP 分发前 reject；请求取消会停止等待（即使某 provider 忽略 signal）。
- 每个 provider 看到**精确的已序列化 Messages body**、请求 `AbortSignal`、可选 `sessionId` 与辅助调用 `purpose`；字段不适用时返回 `undefined`。
- 已装运用途：默认开启的增量 `dsh_session_log` 字段与 `dsh_plugin_packages` 清单——**两者都保持在模型输入之外**。

### D12.2 Modality / 思考格式 / 预算字段的漂移门

见 D7 末的四个 `*_GATE` 常量——用 `Record<T, true>` + `Object.keys` 派生合法值集合，**上游新增拼写会导致编译失败直到被显式命名**。这是防止「上游悄悄加了一个 wire 拼写而我们没跟上」的机制。

### D12.3 凭证优先级

账户 provider 返回的 token 优先于配置的 API key；`inferenceOrigin` 默认 `https://api.deepseek.com`。Messages/Files 用 `x-dsh-auth-token`（**无 Bearer 前缀**），API key 用 `x-api-key`；**两种模式都不跟随重定向**（凭证留在配置的 origin）。

---

# 仓库 5/6 — minimax-code（MiniMax）

仓库：`MiniMax-AI/minimax-code`（默认分支 `main`，`minimax-code@0.5.1`）

## D1 仓库身份 / 上游底座

`"description": "Standalone MiniMax Code TUI with managed accounts, BYOK models, cloud tools, plugins and ACP."`，pnpm 9.12，node `>=22.19 <23 || >=24.2 <27`。

`packages/`：`agent-core` / `agent-extension` / `agent-modules` / `agent-runtime` / `agent-tools` / `browser-core` / `config` / `local-runtime` / `local-runtime-v2` / `mcode-tools-host` / `oauth-core` / `oauth-lease-protocol` / `protocol` / `shared` / `tui`。
`third_party/`：**`pi-mono`**（agent / 模型协议 / 终端基础设施）+ **`sandbox-runtime`**（沙箱 fork + native helpers）。

`docs/architecture.md` 的分层（全文 24 行，仅一章 "Source boundaries"）：

```
TUI / exec / ACP → CliService → local Applications → Session / Turn / Agent services → Pi / model providers / local tools
```

### D1.1 ★ 这是私有代码库的「公开投影」，不是完整源码

`docs/architecture.md` 末尾：

> `release/public-source.json` **explicitly lists delivered files**. `check:source` checks that inventory, canonical root license text, internal addresses, retired modules, obvious credentials, and workspace exports. `check:standalone` separately checks the actual build dependency graph. **New files require explicit inventory updates; absence from the bundle alone does not make source suitable for publication.**

且 `@mavis/*` 是**私有 workspace 包**（`@mavis/context-manager` / `@mavis/agent-core` / `@mavis/protocol` 等：build 直接解析本地源码，不从内部 registry 下载）。

**调研含义**：本仓库看到的是一份**逐文件审核过的子集**（`docs/release-audit.md` / `docs/open-source-status.md` / `docs/publication-authorization.md` 均存在）。因此「未发现」在此仓库的置信度**低于**其它五家——缺失可能源于投影裁剪，而非设计上不存在。

## D2 系统提示组装

**按 agent 角色 + 平台组织，不按模型**。`packages/local-runtime-v2/assets/agents/`：

```
mavis/prompt-session-root.md
_default/prompt-base-all.md
_default/prompt-base-worker.md
_default/prompt-session-branch.md
_default/prompt-session-root.md
_default/prompt-base-windows.md      ← 平台专属
workflow/prompt-hook/system.md
```

另有 `packages/local-runtime/assets/prompts/code-review/{review-candidates.md, reviewer-system.md}`。（注：此为 **MiniMax 仓库**的路径，qwen 章节误植——三期核对修正。）

**与 MiMo（8 份按模型提示）、kimi（1 份通用提示）形成三方对比**：三家的提示分叉维度各不相同 —— **模型（MiMo）/ 通用（kimi）/ 角色+平台（MiniMax）**。

## D3 推理 / 思考控制（本仓库最完整的部分）

### D3.1 思考模式是**四态枚举**（不是布尔）

`packages/config/src/config.ts:218-229`：

```ts
export type ModelThinkingMode = "switchable" | "forced_on" | "forced_off" | "hidden";

export interface ModelThinkingConfig {
  /** Frontend thinking toggle display mode from remote model capability config. */
  mode?: ModelThinkingMode;
  /** Initial switch state for switchable models. Expected values: "true" or "false". */
  default_value?: string;
}

export interface ThinkingConfig {
  /** User-defined choices exposed by the message input model selector. */
  effortOptions?: EffortLevel[];
  /** Explicit provider default. Managed models receive this from Apollo. */
  defaultEffort?: EffortLevel;
}
```

**四态语义**：`switchable`（可切）/ **`forced_on`（不可关）** / **`forced_off`（不可开）** / `hidden`（不展示开关）。

**对比**：DeepOrca 是 `defaultsToThinking: boolean`（一个布尔）；Qwen 的 `thinkingMandatory`（单向）、Kimi 的 `alwaysThinking`（单向）、Step-Code 的 `thinkingFormat`（6 值 wire 格式枚举，不同维度）。**MiniMax 的四态兼顾了「能不能开」「能不能关」「要不要展示」三件事**。

### D3.2 MiniMax M3：**只有 on/off**，且 wire 形状**按协议分派**

`packages/local-runtime/src/model-provider/thinking.ts`（147 行）：

```ts
export const MINIMAX_M3_MODEL_ID = 'MiniMax-M3';
export const MINIMAX_M3_THINKING_TEST_MAX_TOKENS = 1_024;
export type MiniMaxM3ThinkingMode = 'on' | 'off';

/** MiniMax M3 exposes an on/off control; Responses effort values do not change thinking depth. */
export function resolveMiniMaxM3ThinkingProtocol(
  api: ModelProviderApi, mode: MiniMaxM3ThinkingMode,
): Record<string, unknown> {
  if (api === 'openai-responses') {
    return { reasoning: { effort: mode === 'on' ? 'minimal' : 'none' } };
  }
  return { thinking: { type: mode === 'on' ? 'adaptive' : 'disabled' } };
}
```

**注释点明**：「MiniMax M3 exposes an on/off control; **Responses effort values do not change thinking depth**」——即对 M3 而言 `reasoning.effort` 只是开关的载体，调档位无意义。

`MINIMAX_M3_THINKING_TEST_MAX_TOKENS` 的注释记录了一个真实故障模式：

> Keep the adaptive-thinking probe at the same minimum usable output floor as normal Messages-compatible requests. **Smaller caps can finish before MiniMax emits a Messages `content` block and make a valid key look like an invalid response.**

### D3.3 ★ 三层设计：用户值 → 传输键 → wire 位置

`resolveModelThinkingProtocol(api, value, modelId?)` 返回 `ModelThinkingProtocolConfig`：

```ts
export interface ModelThinkingProtocolConfig {
  effort: string;
  /** `false` keeps the selected effort for wire adaptation while disabling Pi thinking. */
  enabled?: boolean;
  piLevel: PiThinkingLevel;
  thinkingLevelMap: ThinkingLevelMap;
  requestPatch: Record<string, unknown>;
  /** Smallest max_tokens used by the connection-test request. */
  minimumMaxTokens: number;
  /** The Messages-compatible API uses adaptive thinking for an explicit effort. */
  forceAdaptiveThinking?: true;
  /** Chat Completions must stay on the top-level reasoning_effort field. */
  completionsThinkingFormat?: 'openai';
}
```

函数头注释（`thinking.ts:88-92`）：

> **Keep the user-defined effort value intact and use only the Provider form's explicit API format to choose its wire location.** The internal Pi level is a **transport key**; `thinkingLevelMap` maps it back to the exact user value.

非 M3 模型的**三协议 wire 分派**（`thinking.ts:124-146`）：

| `api` | `requestPatch` | 附加 |
| --- | --- | --- |
| `anthropic-messages` | `{ thinking: { type: 'adaptive' }, output_config: { effort } }` | `forceAdaptiveThinking: true` |
| `openai-completions` | `{ reasoning_effort: effort }` | `completionsThinkingFormat: 'openai'` |
| 其它（`openai-responses`） | `{ reasoning: { effort } }` | — |

`piLevel` 计算：M3 固定 `'high'`；其它模型 `PI_THINKING_LEVELS.has(effort) ? effort : 'high'`，其中 `PI_THINKING_LEVELS = Set(['minimal','low','medium','high','xhigh','max'])`（**6 档，无 `off`**）。

**对比 DeepOrca**：DeepOrca 是 `THINK_LEVEL_FAMILY_MAPS`（统一档 → 家族原生档，**家族级、单一 wire 形状**）。MiniMax 多出的是**同一模型按协议分派 wire 形状**这一维。

### D3.4 同一模型的 thinking 载荷按协议打补丁

`packages/local-runtime/src/runtime/openplatform-thinking-patcher.ts`（142 行）：

```ts
function patchMiniMaxM3Effort(payload, model, effort: 'on' | 'off') {
  if (model.api === 'openai-responses') {
    const patch = resolveMiniMaxM3ThinkingProtocol('openai-responses', effort);
    payload.reasoning = { ...(isRecord(payload.reasoning) ? payload.reasoning : {}), ...reasoningPatch };
    return payload;
  }
  if (model.api === 'openai-completions' || model.api === 'openai-chat') {
    if (!Array.isArray(payload.messages)) return undefined;
    const patch = resolveMiniMaxM3ThinkingProtocol('openai-completions', effort);
    payload.thinking = isRecord(patch.thinking) ? { ...patch.thinking } : {};
    delete payload.reasoning_effort;          // ← 显式删除不兼容字段
    return payload;
  }
  if (model.api !== 'anthropic-messages' || !Array.isArray(payload.messages)) return undefined;
  const patch = resolveMiniMaxM3ThinkingProtocol('anthropic-messages', effort);
  payload.thinking = isRecord(patch.thinking) ? { ...patch.thinking } : {};
  const outputConfig = isRecord(payload.output_config) ? { ...payload.output_config } : {};
  delete outputConfig.effort;                 // ← 显式删除 output_config.effort
  if (Object.keys(outputConfig).length > 0) payload.output_config = outputConfig;
  else delete payload.output_config;
  return payload;
}
```

**★ 这是「同一模型在不同协议/channel 下契约不同」的最直接实证**：M3 在 `openai-completions` 上必须**删掉** `reasoning_effort`，在 `anthropic-messages` 上必须**删掉** `output_config.effort`。

同文件另有能力键 `OPENPLATFORM_THINKING_VARIANTS_CAPABILITY = 'openplatform_thinking_variants'`，从 `modelRef.capabilities` 读 `{ thinking, 'none-thinking' }` 两组预设载荷——**即 thinkin 变体是能力数据而非代码分支**。

### D3.5 `interleaved` 配置位

`packages/config/src/config.ts:1097`：

```ts
interleaved?: true | { field: "reasoning_content" | "reasoning_details" };
```

与 Kimi 的 `interleaved.field` 同构，取值集合一致。

## D4 工具调用协议 —— **跨模型思考回放的 4 路策略**

`packages/agent-core/src/pi-turn-runner/outbound-message-normalizer.ts`（296 行）。

### D4.1 portable thinking 标记

```ts
const PRIOR_THINKING_OPEN = '<|prior-thinking|>';
const PRIOR_THINKING_CLOSE = '<|/prior-thinking|>';
const SIBLING_NATIVE_THINKING_APIS = new Set<string>(['anthropic-messages', 'bedrock-converse-stream']);

function thinkingToPortableText(block: ThinkingContent): TextContent[] {
  if (block.redacted || !block.thinking || block.thinking.trim().length === 0) return [];
  return [{ type: 'text', text: `${PRIOR_THINKING_OPEN}\n${block.thinking}\n${PRIOR_THINKING_CLOSE}` }];
}
```

### D4.2 ★ 4 路决策 + 「provider 绑定 vs model 绑定」重要区分

```ts
function normalizeAssistantMessage(message: AssistantMessage, targetModel: Model<Api>): AssistantMessage {
  const sameProviderAndApi = message.provider === targetModel.provider && message.api === targetModel.api;
  const sameModel = sameProviderAndApi && message.model === targetModel.id;
  if (sameModel) return message;                                   // ① 同模型：原生回放

  const canReplayNativeSibling = sameProviderAndApi && SIBLING_NATIVE_THINKING_APIS.has(targetModel.api);
  const dropPortableThinking = shouldDropPortableThinking(message, targetModel);
  const content = message.content.flatMap((block) => {
    if (block.type !== 'thinking') return block;
    if (canReplayNativeSibling) return block;                      // ② 同 provider+api 且属原生集合：保留原生块
    if (dropPortableThinking) return [];                           // ③ 显式丢弃
    return thinkingToPortableText(block);                          // ④ 降级为文本
  });

  if (!canReplayNativeSibling) return { ...message, content };

  // pi-ai's transformMessages treats a different model id as cross-model and strips
  // provider-native thinking. For same-provider sibling APIs whose thinking signatures are
  // known to be PROVIDER-BOUND rather than MODEL-BOUND, stamp the outbound copy as the
  // target model so pi-ai preserves the native blocks. MODEL-BOUND APIs (Google, OpenAI
  // Responses, unknown APIs) are converted to portable text instead.
  return { ...message, model: targetModel.id, content };
}
```

**★ 关键语义（DeepOrca 完全未建模）**：thinking signature 分两类 ——
- **provider 绑定**：同 provider 同 api 的兄弟模型间可复用（`anthropic-messages` / `bedrock-converse-stream`）
- **model 绑定**：不可跨模型（模型绑定的 API 反而降级为可移植文本）

### D4.3 投影而非改写

```ts
/**
 * Build the exact temporary message list sent to a target model.
 * Canonical Agent messages are never rewritten by this projection.
 */
export function projectAgentMessagesForModel(messages, targetModel) { … }
```

流程：`isHostOnlyMessage` 过滤 → `convertToLlm` → `stripHostOnlyFields` → `removeOrphanToolResults` → `mergeImmediateSendBatches` → `normalizeOutboundMessagesForModel` → `projectVideoBlocks` → `projectUndersizedImageBlocks`

**顺序约束被显式注释**：

> Order matters: `projectVideoBlocks` turns `video` blocks into `image` blocks, so the size filter has to run AFTER it or it would miss every video-derived image.

诊断通道 `undeterminedImageMimeTypes`：「Images kept because their size could not be determined, counted by declared mimeType. … **a recurring cluster is the signal to teach `imageDimensions` another format.**」

## D5 工具面管理

`packages/agent-tools/src/mcp-disclosure/plan.ts`——**MCP 工具渐进披露**：

```ts
if (!options.enabled) return inlineAll();
if (!modelInWhitelist(model.provider, model.id, options.modelWhitelist)) return inlineAll();
// The threshold (thresholdPct * contextWindow) is meaningless without a real
// context window. A non-positive/non-finite contextWindow would make
// thresholdTokens collapse to 0, deferring on any single tool.
if (!(Number.isFinite(model.contextWindow) && model.contextWindow > 0)) return inlineAll();

const candidates = entries.filter((e) => e.source === 'configured');
const estTokens = candidates.reduce((s, e) => s + estimate(e.tool.def), 0);
const thresholdTokens = options.thresholdPct * model.contextWindow;
if (candidates.length < options.minDeferCount || estTokens <= thresholdTokens) return inlineAll();
```

产出 `{ deferred, inlineTools, deferredRegistry, index, stats }`，index 带 `maxSchemaTextLen` 截断。

## D6 上下文与压缩

- `packages/local-runtime/src/context/token-estimator.ts` 暴露 `computeCompactionTriggerAt({ modelId?, contextWindow, perTurnMaxTokens, reserveTokens, safetyMarginTokens })`（委托给 `@mavis/context-manager` 的共享实现）。
- `packages/local-runtime/src/context/remote-token-counter.ts`（"Local auto-compaction trigger counter"）、`context-usage-calibration.ts`。
- `host-metrics.ts:85-86` 有 `compact_saved_ratio` 直方图（`[-1,-0.5,-0.25,0,0.1,0.3,0.5,0.7,0.9,1]`）与 `compact_duration_ms`——**压缩效果被指标化**。

### D6.1 ★ 系统提示与工具定义必须计入触发判定

`token-estimator.ts:32-39`：

> **Estimate of the provider-payload parts that live OUTSIDE the message list: the composed system prompt and the active tool declarations.** The message usage/text estimators alone **systematically under-count the real payload** — a large system prompt plus an MCP-heavy tool registry easily adds tens of thousands of tokens — so **trigger gates comparing against the real context window must include this footprint.**

即 `estimateSystemPromptAndToolTokens(systemPrompt, tools)` 与 `estimateMessagesTokens(messages)` 相加才是真实载荷。

## D7 缓存纪律 —— **装配指纹（装配面缓存失效探测）**

`packages/agent-core/src/pi-turn-runner/assembly-fingerprint.ts`（71 行，全文核心）：

```ts
/**
 * Fingerprint only the provider-visible, cache-relevant assembly surfaces.
 * Message history is intentionally excluded so normal loop growth does not
 * look like system/tool assembly churn.
 */
export function fingerprintAssembly(context: AssemblyFingerprintContext): AssemblyFingerprint {
  const toolInterfaces = (context.tools ?? []).map((tool) => ({
    name: tool.name, description: tool.description, parameters: tool.parameters,
  }));
  return {
    // Preserve whitespace exactly: prompt caches observe it even when humans do not.
    systemPrompt: fingerprint(context.systemPrompt ?? ''),
    // Preserve tool order but canonicalize object keys inside each definition.
    tools: fingerprint(canonicalStringify(toolInterfaces)),
  };
}
```

- SHA-256 截断 16 hex；`canonicalize` 对对象键排序、跳过 `undefined`/函数/symbol、检环。
- **只指纹 system prompt + tools，故意排除消息历史**——因为历史增长是追加式（缓存安全），而装配面变动才会打断前缀。
- `ProviderOptions.setCacheKey?: boolean`（`config.ts`）——provider 级缓存键开关。

## D8 采样参数

### D8.1 temperature 是能力位

`ModelConfig.temperature?: boolean`（`config.ts:1095`）；`:1534/:1552/:1561` 多处显式置 `true`。与 MiMo 的同源（都基于 pi 生态）。

### D8.2 ★ 动态 maxTokens 钳制（含「压缩触发点被预留量拖累」的重要洞察）

`packages/local-runtime/src/runtime/dynamic-max-tokens.ts` 头部问题陈述（**值得完整引用**）：

> **Dynamic per-call maxTokens clamping** (local-runtime only, Messages-compatible API only).
>
> **Problem**: Statically putting a large configured `max_tokens` (e.g. 128k) in every request has two effects:
> 1. Providers require `input_tokens + max_tokens ≤ contextWindow`; long context makes the request invalid (400 overflow).
> 2. **Reserving the full maxTokens for automatic compaction triggers compaction around 35% of a 200k window, wasting most of it.**
>
> **Solution**: Allow the full configured budget early in a session, then shrink it per call as context grows, down to `DYNAMIC_MAX_TOKENS_FLOOR` (16k). **The trigger only reserves that floor**; the next turn beyond the floor threshold naturally triggers compaction.
>
> ```
> effectiveMax = clamp(contextWindow − estimated context − margin, floor, configured value)
> ```
>
> Enable only for Messages-compatible APIs. Other providers bypass this clamp and retain the old trigger formula reserving full maxTokens, keeping both sides consistent.

常量：

```ts
/** Output budget floor: compact rather than shrinking output below this value. */
export const DYNAMIC_MAX_TOKENS_FLOOR = 16_384;
/** Safety margin for estimation error, identical in value and meaning to the compaction trigger's safetyMarginTokens. */
export const DYNAMIC_MAX_TOKENS_SAFETY_MARGIN = 2_048;
/** Minimum usable output retained on the normal clamping path. */
const MIN_OUTPUT_TOKENS = 1_024;
/** Use the provider's smallest allowed positive-integer budget when estimation fails. */
const EMERGENCY_OUTPUT_TOKENS = 1;
```

thinking budget 的联动（同文件 `thinkingBudgetTokens`）：

> In budget thinking mode, pi-ai adds the thinking budget to the caller cap (`adjustMaxTokensForThinking`: `maxTokens = min(caller + budget, model limit)`). **Deduct the same amount before clamping** so the final request fits remaining capacity. **Adaptive thinking (`forceAdaptiveThinking`) uses effort without changing maxTokens, so no deduction is needed.**

**★ 对 DeepOrca 的直接含义**：输出预留量与压缩触发点互相牵制——预留过大等于让压缩提前发生。

## D9 模型注册与匹配

`packages/config/src/config.ts` 的 `ModelConfig`（完整 per-model 画像）：

```ts
export interface ModelConfig {
  id?, name?, enabled?, family?, release_date?;
  configuration_source?: "manual" | "discovered";
  attachment?: boolean;      // 多模态
  reasoning?: boolean;
  temperature?: boolean;     // capacity bit
  tool_call?: boolean;
  interleaved?: true | { field: "reasoning_content" | "reasoning_details" };
  cost?: ModelCost;
  limit?: ModelLimit;        // { context, input?, output }
  contextWindowOptions?: number[];
  contextWindowOptionHints?: Record<string, "higher_usage">;
  parameterErrors?: { contextOptions?: true; effortOptions?: true };
  modalities?: ModelModalities;   // { input: Modality[], output: Modality[] }
  experimental?: boolean; status?: ModelStatus;
  thinking?: ThinkingConfig; thinking_config?: ModelThinkingConfig;
  options?: Record<string, unknown>; headers?: Record<string, string>;
  capabilities?: ModelCapabilitiesConfig;
  provider?: { npm?: string; api?: string };     // ← 协议声明（同 pi 生态惯例）
  variants?: Record<string, { disabled?: boolean; [k: string]: unknown }>;
  defaultVariant?: string;
}
```

`ModelCapabilitiesConfig`：`support_image` / `support_video` / `support_json_object_output` / `support_files_api` / `use_file_api` / `files_api_upload_endpoint` / `files_api_ref_scheme` / `files_api_file_id_ttl_sec` / `max_image_bytes_inline` / `max_video_bytes_inline` / `max_request_body_bytes` / `max_attachments_count`（**开放扩展** `[key: string]: unknown`）。

- `provider.api` = 协议方言（与 MiMo / Step-Code 的 `api` 字段同源，**三家一致**）。
- `variants` + `defaultVariant` = effort 方言数据载体（见 D3.2/D3.3）。
- `contextWindowOptions` + `contextWindowOptionHints`（值为 `"higher_usage"`）= 托管目录公布的有序上下文档位 + 语义 UI 提示。
- `parameterErrors` = 由托管目录同步派生，**从不从选择请求读取**。

## D10 多模态门控 —— ★「退化图片污染会话」的双向防线

`outbound-message-normalizer.ts:20-33`：

> Last-resort net: **model gateways reject a request outright when any image in it is degenerate, and because the image lives in persisted history the session then fails forever.** The producer-side guard in the Browser tool (`POST_ACTION_VISUAL_MIN_CLIP_EDGE_PX`, 32) stops new ones being created; this value exists to **heal sessions that were already poisoned**.
>
> It is deliberately far tighter than the producer's 32. The rejection threshold is a server-side property that can move — **measured at ≤2px on the production gateway and ≤4px on the open-platform test gateway** — so neither side sits on the red line, but the two sides trade off in opposite directions. The producer can be generous because it fully controls the clip and a sub-32px sliver carries no information. Here the content is the user's, the only job is "do not get the whole request rejected", and **wrongly dropping genuine content costs more than letting a small image through**.

```ts
const MIN_PROVIDER_IMAGE_EDGE_PX = 8;
```

**架构性事实**：**一个坏输入一旦进入持久化历史，会让该会话永久 400**。防线必须双端——生产者守卫（32px，防新增）+ 消费端末道网（8px，治已污染）。且阈值是**实测过的**（生产网关 ≤2px / 测试网关 ≤4px）。

其它：`support_image` / `support_video` 能力位；`max_image_bytes_inline` / `max_video_bytes_inline` / `max_attachments_count`；Files API（`use_file_api` / `files_api_file_id_ttl_sec` / 上传端点 / ref scheme）。

## D11 错误处理 / 容错

- `packages/agent-core/src/pi-turn-runner/llm-retry.ts`（重试）。
- 退化图片的「治已污染会话」路径（D10）。
- `SSEErrorPushConfig`（`config.ts:231-236`）：`{ history: boolean, stream: boolean }`——**分别控制历史 API 错误与流管道错误是否推送到全局 SSE**。

## D12 其它专属

- `third_party/sandbox-runtime`——真正的沙箱 fork + native helpers + 对应源码。
- `packages/oauth-core` + `packages/oauth-lease-protocol` + `packages/mcode-tools-host`：MiniMax OAuth Core 管理 profile 凭证/刷新/登出；**mcode-tools-host 通过本地 lease broker 向工具子进程发放短时访问令牌**。
- 托管能力与工具集成：官方插件、connectors、accounts、search 使用其公开服务客户端，**不恢复 DesktopService 或 HTTP 前门**。
- Headless 模型覆盖会走**只读账户状态检查**，使认证要求跟随该次运行所选模型；该检查**不改全局配置、不改会话模型**，执行仍走既有 model resolver / 权限 / 工具。
- `postinstall` 类脚本：`check:standalone`（校验真实构建依赖图）、`check:source`（校验交付清单）、`verify`、`test:artifact`（`test/public-artifact.test.mjs`）——**发布合规被固化为 CI 门禁**。
- `examples/clamp`——动态钳制的示例。

---

# 仓库 6/6 — qwen-code（阿里）

仓库：`QwenLM/qwen-code`（默认分支 `main`，`@qwen-code/qwen-code@0.24.3`，pnpm 11.24，node ≥22）

## D1 仓库身份 / 上游底座

**上游确证**（`README.md:214`，第一方自述）：

> This project was originally based on [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) **v0.8.2**. We gratefully acknowledge the Gemini CLI team's excellent work. **Starting from Qwen Code v0.1, we stopped syncing with upstream and began independent development as a multi-protocol, multi-platform agent framework with deep integrations for Qwen models and beyond.**

即：**fork 自 Gemini CLI v0.8.2，自 v0.1 起停止同步、独立演进**。代码里仍保留 `Copyright 2025 Google LLC` 头与 `@google/genai` 类型（如 `microcompact.ts` 用 `Content, Part`）、`eslint.legacy-core-barrel-imports.mjs` / `eslint.legacy-filenames.mjs` 等从上游继承的约束脚本。

`packages/`（24 个）：`core` · `cli` · `acp-bridge` · **`channels/`（11 个：base / telegram / weixin / dingtalk / wecom / feishu / qqbot / github / gitlab / dws / plugin-example）** · `sdk-java` / `sdk-python` / `sdk-typescript` · `vscode-ide-companion` / `zed-extension` / `chrome-extension` · `desktop-shell` / `live-host` / `mobile-shell`（**三者被 `!` 排除出 workspace**；三期核对修正：原记 web-shell 被排除——错，web-shell 是 workspace 成员）· `web-shell` / `qwen-live` / `audio-capture` · `browser-use` / `cua-driver` / `mobile-mcp` / `node-repl` · `web-templates`。

**产品面是六家最宽的**：多协议 + 11 个 IM/代码托管渠道 + 3 语言 SDK + 3 个 IDE 扩展 + 3 个 shell。

## D9 模型注册与匹配（骨架）

### D9.1 分派键 = `AuthType`，配置载体 = `ContentGeneratorConfig`

`core/contentGenerator.ts:530` `createContentGenerator(...)`；`ContentGeneratorConfig`（`:82-207`，**126 行、逐字段带 issue 号注释**）是本仓库的模型/请求适配面。`AuthType` 走 `export { AuthType }`（`:51`，来自 `ContentGeneratorConfig` 同层）。

### D9.2 ★ `reasoning.effort` 的**统一梯子 + 逐 provider 子集 + 钳制**（直接印证 DeepOrca 的家族映射设计）

`contentGenerator.ts:154-170`（注释全文引用，信息密度极高）：

> Unified reasoning-effort ladder (see `core/reasoning-effort.ts`). **Providers accept different subsets and use different wire fields; each provider adapter maps + clamps this tier onto the active model:**
> - `'xhigh'`/`'max'` are extra-strong tiers (DeepSeek `reasoning_effort`, Anthropic `output_config.effort` on Opus 4.7+, OpenAI `xhigh`).
> - Generic OpenAI-compatible endpoints and the **DashScope qwen3.8-max family cap at `'xhigh'`** (`'max'` is a vendor extension, not part of the generic ladder); **Gemini caps at `'high'`**.
> - Real Anthropic clamps each tier to the active model's supported set (Opus 4.7+/5.x accept `'xhigh'`/`'max'`; Opus/Sonnet 4.6 accept `'max'`; older models cap at `'high'`), **logged once per generator via `debugLogger.warn`, when the baseURL doesn't look like a DeepSeek-compatible endpoint, so configs targeting DeepSeek don't 400 when the same auth profile is reused against api.anthropic.com.**

**三点可直接对照 DeepOrca**：① 统一梯子 + 逐家族原生子集（DeepOrca 的 `THINK_LEVEL_FAMILY_MAPS` 同构，**独立验证该设计方向正确**）；② **上限差异**（DashScope 到 `xhigh`、Gemini 到 `high`）；③ **「同一 auth profile 复用到不同 baseURL」的消歧**——DeepOrca 目前无此考虑。

### D9.3 10 个具名 profile 的解析链

`core/reasoning-overrides.ts:186-240`（386 行文件的决策核心）：

```ts
const profile = input.profile ?? (
  auth === 'gemini' || auth === 'vertex-ai' ? 'gemini'
  : auth === 'openai-responses' ? 'openai-reasoning'
  : auth === 'openai' && isOpenRouterHostname(route) ? 'openai-reasoning'
  : auth === 'anthropic'
    ? model.includes('deepseek') ? 'deepseek-anthropic'
    : claude && (claude.major > 4 || (claude.major === 4 && claude.minor >= 6)) ? 'anthropic-adaptive'
    : 'anthropic-manual'
  : model.startsWith('qwen')
    ? dashscope
      ? inherited?.disableField === 'reasoning_effort' ? 'dashscope-effort' : 'dashscope-thinking'
      : 'qwen-chat-template'
    : inherited?.disableField === 'thinking' ? 'deepseek-openai' : 'openai-effort'
);
```

profile 决定三件事：

```ts
const toggleOnly = profile === 'dashscope-thinking' || profile === 'qwen-chat-template';
const disableField = (!input.profile && inherited?.disableField) || (toggleOnly ? 'enable_thinking'
  : profile === 'openai-effort' || profile === 'dashscope-effort' ? 'reasoning_effort' : 'thinking');
```

- **`disableField` 三态**：`enable_thinking`（Qwen/DashScope 系，开关式）/ `reasoning_effort`（档位式）/ `thinking`（DeepSeek 式信封）。
- **`toggleOnly`**：该 profile 只有开/关，无档位。
- **`dashscope` 判定**（`:177-184`）：authType `qwen-oauth`，或 hostname 匹配 `dashscope(-intl|-us).aliyuncs.com` / `alibaba-inc.com` / `aliyun-inc.com` / `alicloudapi.com`，或 `token-plan.*.maas.aliyuncs.com`。
- `parseModelReasoningCapabilities`：优先取内置 provider 表里该模型的 `capabilities.reasoning`（`:153-160`）。
- `invalidReasoning(route)` 是显式失败路径（不是静默回退）。

**注意**：这里的路由判定**同时使用 authType + hostname + model 串**——与 DeepOrca「只关注模型」的要求不同，属**已知差异点**。

### D9.4 `thinkingMandatory`：模型拒绝关闭思考

`contentGenerator.ts:186-188`：

```ts
// When true, the model rejects enable_thinking=false with a 400 error
// (e.g. qwen3.8-max-preview), so thinking must never be disabled on the wire.
thinkingMandatory?: boolean;
```

**具名模型证据**（`qwen3.8-max-preview`）。与 kimi 的 `alwaysThinking`、MiniMax 的 `forced_on`、Step-Code 的推理不可关——**四家独立印证同一维度**。

### D9.5 能力自动探测

`modalities?: InputModalities`（`contentGenerator.ts:190-191`）：「Leave undefined to use **automatic detection from model name**」。`contextWindowSize?: number`：「If set to a positive number, it will override the automatic detection」。

## D3 推理 / 思考控制

- 统一梯子 + 逐 provider 子集与钳制（D9.2）。
- `reasoning` 配置：`false | { effort?: ReasoningEffort; budget_tokens?: number }`——**同时支持档位式与预算式**。
- `reasoningSnapshot` + `reasoningRouteBaseUrl`（`contentGenerator.ts:152-153`）——**把推理覆盖决策快照化并在路由变化时重算**。
- `anthropic-reasoning.ts:56` 提到 **temperature-rejection gate** 与「version-gated effort tiers for 4.6+」。
- `baseLlmClient.ts:90/184` 支持 per-request 覆盖 `thinkingConfig` 与 `temperature`。

## D4 工具调用协议

### D4.1 ★ XML 文本兜捞：**带意图守卫 + 五条件门控**

`core/xml-tool-call-fallback.ts:181-215`：

```ts
export function tryRecoverXmlToolCalls(text: string): { recovered: boolean; functionCallParts: Part[]; remainingText: string } {
  const extracted = extractXmlToolCalls(text);
  if (extracted.length === 0) return { recovered: false, functionCallParts: [], remainingText: text };

  // Intent guard: only recover when XML blocks dominate the content.
  // Substantial surrounding prose suggests the model is documenting or
  // echoing the format, not emitting a tool call.
  INVOKE_PATTERN.lastIndex = 0;
  const proseOnly = text.replace(INVOKE_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > 0 && proseOnly.length / text.length > 0.8) {
    return { recovered: false, functionCallParts: [], remainingText: text };
  }
  ...
}
```

调用点门控（`core/llm-chat.ts:6333-6341`，注释「See #8003」）：

```ts
if (streamError === null && !hasToolCall && hasFinishReason && contentText && containsXmlToolCalls(contentText)) {
  const recovery = tryRecoverXmlToolCalls(contentText);
  if (recovery.recovered) { hasToolCall = true; … }
}
```

**五条件**：无流错误 + **尚无结构化工具调用** + 有 finish reason + 有文本 + 含 XML 调用。恢复后 `remainingText` 被放回**第一个 text 位置**，以保留非文本部件（`inlineData`/`fileData`）的位置。

### D4.2 工具名常量与规范化

`tools/tool-names.ts`：`ToolNames`（`exec` / `edit` / `write_file` / `read_file` / `zoom_image` / `grep_search` / `glob` / `run_shell_command` / `todo_write` / `save_memory` / `agent` / `skill` / `exit_plan_mode` / `enter_plan_mode` / `web_fetch` / `web_search` / `image_gen` / `list_directory` / `lsp` / `ask_user_question` / `cron_*` / `loop_wakeup` / `create_sub_session` / `list_agents` / `task_stop` / `task_create` / `task_update` / `task_list` …）+ `canonicalToolName()`。

**已登记的静默失败风险**（文件头注释）：

> Filesystem-path-bearing tools … also need to be added to `FS_PATH_TOOL_NAMES` in `core/coreToolScheduler.ts` … **Forgetting that registration silently skips the activation pipeline for that tool — there is no compile-time guard.** (TODO: replace the manual allowlist with a per-declaration `pathFields?: string[]` annotation on the tool class.)

### D4.3 工具定义与工具结果的形态兼容

- `schemaCompliance?: 'auto' | 'openapi_30'`——工具定义的 schema 合规模式。
- **`splitToolMedia?: boolean`**（`contentGenerator.ts:190-197`）：
  > When true, media parts in tool responses (including the built-in `read_file` and MCP tools) are split into a follow-up `role: "user"` message instead of being embedded inside the `role: "tool"` message. **The OpenAI Chat Completions spec only permits string / text-part content on tool messages; strict OpenAI-compatible servers (e.g. doubao / new-api / LM Studio) drop or reject anything else (HTTP 400 "Invalid 'messages' in payload"), so an image read via `read_file` never reaches the model.** Default: `true` (spec-compliant and safe for permissive providers); set `false` to restore the legacy embed-in-tool-message behavior. See QwenLM/qwen-code#4876, #3616.
- **`toolResultContentFormat?: 'parts' | 'string'`**：「Some older OpenAI-compatible tool templates only read the string form, so this opt-in serializes text-only tool results as strings while leaving the default spec-compliant content-part shape unchanged.」

## D5 工具面管理

`core/coreToolScheduler.ts` 是调度中心（含上述 `FS_PATH_TOOL_NAMES`）。`Tools` 面含 `zoom_image`（图像放大）、`lsp`、`cron_*`、`loop_wakeup`、`create_sub_session` 等。**未深入**。

## D6 上下文与压缩（六家中最精细）

### D6.1 ★ 四层阈值阶梯

`services/chatCompressionService.ts`：

```ts
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000;   // Mirrors claude-code's MAX_OUTPUT_TOKENS_FOR_SUMMARY (autoCompact.ts:30), based on p99.99 of real compaction outputs
export const COMPACTION_BUDGET_SAFETY_MARGIN = 1_024;
export const DEFAULT_PCT = 0.85;
export const SUMMARY_RESERVE = COMPACT_MAX_OUTPUT_TOKENS;   // 20_000
export const AUTOCOMPACT_BUFFER = 13_000;   // matches claude-code's AUTOCOMPACT_BUFFER_TOKENS
```

```ts
export function computeThresholds(window: number, pct?: number): CompactionThresholds {
  const effectivePct = Math.min(1, Math.max(0, pct ?? DEFAULT_PCT));
  const effectiveWindow = Math.max(0, window - SUMMARY_RESERVE);

  // The absolute term is a ceiling: compact before the prompt leaves too little
  // room for the summarization side-query (which needs up to SUMMARY_RESERVE of output).
  // Combine it with the proportional preference via `min`.
  const proportional = effectivePct * window;
  const absoluteCeiling = effectiveWindow - AUTOCOMPACT_BUFFER;
  const auto = absoluteCeiling > 0 ? Math.min(proportional, absoluteCeiling) : proportional;

  const warn = Math.max(0, auto - WARN_BUFFER);

  // hard is the last-ditch force-compaction point: the window edge (hardEdge),
  // but never below auto + HARD_BUFFER so it stays a distinct tier above auto.
  const hardEdge = effectiveWindow - HARD_BUFFER;
  const hard = Math.min(window, Math.max(hardEdge, auto + HARD_BUFFER));

  return { warn, auto, hard, effectiveWindow };
}
```

**四档语义**：`warn`（UI 预警，早于 auto）/ `auto`（自动压缩）/ `hard`（最后一搏的强制压缩）/ `effectiveWindow`。

**对比 DeepOrca**：DeepOrca 是**单阈值**（`activeTokens > threshold`，threshold = 家族窗口值）。qwen 的四档把「预警 / 压缩 / 强制」分离，并把**摘要副查询自身的输出预算**计入公式。

### D6.2 摘要副查询的输出预算钳制

```ts
export function computeCompactionOutputBudget(estimatedInputTokens: number, contextLimit: number): number {
  const remaining = contextLimit - estimatedInputTokens - COMPACTION_BUDGET_SAFETY_MARGIN;
  return Math.max(1, Math.min(COMPACT_MAX_OUTPUT_TOKENS, remaining));
}
```

同函数注释的**诚实局限性说明**（值得引用）：

> The side-query input size is a **char/4 estimate**, so this pad absorbs rounding and small per-part drift. **It does NOT scale with the estimate: proportional tokenizer error (real tokenizers vary ±30% and under-count CJK-dense content) can still push `prompt + max_tokens` over the window, in which case the backend rejects the request with a 400** that propagates to the caller.

并指出主发送路径用另一套 tunable 的 `clampOutputTokensToWindow`（`core/tokenLimits.ts`，4K floor）：「that helper's 4K floor can itself exceed a tight window, which this path must never do.」

### D6.3 分层压缩架构（四件套）

| 层 | 文件 | 是否调模型 | 作用 |
| --- | --- | --- | --- |
| **微压缩** | `services/microcompaction/microcompact.ts`（**966 行**） | ❌ | 清旧工具结果与内联媒体 |
| 输入瘦身 | `services/compactionInputSlimming.ts` | ❌ | 压缩前瘦身（含截图/图片阈值） |
| 摘要压缩 | `services/chatCompressionService.ts` | ✅ | 四档阈值 + 摘要 |
| 媒体回挂 | `services/postCompactAttachments.ts` | ❌ | 压缩后重新附加媒体 |

微压缩常量与机制：

```ts
export const MICROCOMPACT_CLEARED_MESSAGE = '[Old tool result content cleared]';
export const MICROCOMPACT_CLEARED_IMAGE_PREFIX = '[Old inline media cleared:';
```

- 导出 `microcompactHistory` / `evaluateTimeBasedTrigger` / `isClearedMediaPlaceholder`。
- 配置来自 `ClearContextOnIdleSettings`（**空闲清上下文**）——**除体积触发外还有时间触发**。
- `QWEN_MC_KEEP_RECENT` 环境变量控制保留量；`DEFAULT_TOOL_RESULTS_TOTAL_CHARS_THRESHOLD`（`config/clearContextDefaults.js`）。
- 占位符匹配极其严谨：注释说明必须匹配**完整形状**（而非仅前缀），且内部拒绝 `\r`/`\n`/`\t`，否则「multi-line user text that merely starts with the prefix」会被误判为占位符——「**A genuine user prompt that merely *begins* with the prefix is NOT a placeholder and must keep counting as user text.**」

### D6.4 其它

`services/compactionInputSlimming.ts`：`TOKEN_TO_CHAR_RATIO = 4`；`DEFAULT_SCREENSHOT_TRIGGER_THRESHOLD = 20`；`DEFAULT_IMAGE_PAYLOAD_THRESHOLD = 20`；环境变量 `QWEN_COMPACT_SCREENSHOT_THRESHOLD` / `QWEN_IMAGE_PAYLOAD_THRESHOLD`；`:255` 提到「media lives and screenshots silently vanish from restoration」的坑。`utils/toolResultDisplayCompaction.ts` 另管**展示层**压缩。

## D7 缓存纪律（三个具名锚点）

`contentGenerator.ts`：

```ts
enableCacheControl?: boolean;   // Enable provider prompt-cache controls

/**
 * Default Anthropic `cache_control` retention for every cache anchor
 * (system text, last tool, trailing user message) unless overridden
 * per-anchor by {@link cacheRetentionByBlock}. `'ephemeral'` (default)
 * omits `ttl` on the wire (spec default is 5m); `'1h'` requests the
 * extended cache tier (`ttl: '1h'`).
 */
cacheRetention?: 'ephemeral' | '1h';

/**
 * Per-anchor override of {@link cacheRetention}. Keys are the three
 * cache anchors the Anthropic converter places `cache_control` on;
 * missing keys inherit the top-level `cacheRetention`.
 */
cacheRetentionByBlock?: Partial<Record<'system' | 'tool' | 'user.last', 'ephemeral' | '1h'>>;

// Force `scope: 'global'` on Anthropic cache_control entries even when the
// base URL is not an Anthropic-native origin (e.g. proxy providers like
// Routify, OpenRouter). Requires the proxy to forward `cache_control` fields
// and the `prompt-caching-scope-2026-01-05` beta. See issue #6642.
forceGlobalCacheScope?: boolean;

// Total-lifetime cap for one streaming response, NOT refreshed by chunk
// arrival: a drip-fed stream resets the idle watchdog forever while never
// completing the message (issue #8597) …
streamMaxLifetimeMs?: number;
```

**★ 三个具名缓存锚点**：`system`（系统文本）/ `tool`（最后一个工具）/ `user.last`（末尾用户消息）——每个锚点可**独立设定** `ephemeral`（5m）或 `1h`（扩展缓存层）。这是 DeepOrca 完全没有的粒度。

另：`enableRequestMetadata` 的自动门控（`:107-117`）——DashScope 的请求体 `metadata`（sessionId/promptId/channel）**只对 qwen 家族的 wire 模型发送**，因为「DashScope's endpoint is an aggregating gateway and **a third-party vendor backend types `metadata` as a string and rejects the object with a flat 400** (issue #11590)」。

## D8 采样参数

```ts
samplingParams?: {
  top_p?: number; top_k?: number; repetition_penalty?: number;
  presence_penalty?: number; frequency_penalty?: number;
  temperature?: number; max_tokens?: number;
  // Additional provider-specific keys pass through verbatim
  // (e.g. `max_completion_tokens` for GPT-5 / o-series, `reasoning_effort`).
  [key: string]: unknown;
};
```

**未发现**按任务类型动态调参的证据。`anthropic-reasoning.ts:56` 提到 temperature-rejection gate（某些模型/协议拒绝 temperature 字段）。

## D10 多模态门控

- `modalities?: InputModalities`（按模型名自动探测）；「Unsupported media types are replaced with **text placeholders**」。
- `splitToolMedia`（工具消息媒体拆分，见 D4.3）＋ `toolResultContentFormat`。
- `compactionInputSlimming` 的截图/图片阈值与 `sanitizeMimeForPlaceholder`。
- 工具面含 `zoom_image`（图像区域放大）与 `image_gen`。

## D11 错误处理 / 容错

- **`streamIdleTimeoutMs`**：注释指出「The SDK `timeout` only covers connect + first response, so **a stream that returns 200 then goes silent is otherwise unbounded**」。
- **`streamMaxLifetimeMs`**（issue #8597）：针对「**drip-fed stream resets the idle watchdog forever while never completing the message**」——需要 chunk 无法重置的上界。注释诚实标注 Gemini generator 未实现该守卫。
- 重试：`maxRetries` / `retryInitialDelayMs` / `retryMaxDelayMs` / `retryErrorCodes`；`utils/rateLimit.ts`（`isRateLimitError` / `getRateLimitRetryDelayMs` / `RetryInfo`；三期核对：扩展名为 .ts）。
- 配额：`utils/quotaErrorDetection.ts`（`isQuotaExhaustedError` / `formatQuotaExhaustedMessage`）。
- 错误分类：`utils/errors.js`（`getErrorStatus` / `isAbortError`）、`utils/errorParsing.js`（`parseAndFormatApiError`）、`utils/responses-http-error.js`。
- 子 agent 的 `reasoningEffort` 需要**独立的 ContentGenerator**（`subagents/subagent-manager.ts:1394-1474`，失败时降级到会话 generator 并记录日志）。

## D12 其它专属

- **11 个渠道集成**（`packages/channels/`）：telegram / weixin / dingtalk / wecom / feishu / qqbot / github / gitlab / dws 等——把 agent 接进 IM 与代码托管平台。
- **多语言 SDK**：`sdk-java` / `sdk-python` / `sdk-typescript`；`acp-bridge`（Agent Client Protocol，~14000 行的 `session-control-plane.ts`）。
- 三种 shell：`desktop-shell` / `live-host` / `mobile-shell`（被排除出 workspace，即不自建；三期核对修正：web-shell 实为 workspace 成员，`pnpm-workspace.yaml:19-21`）。
- `qwen-live` / `audio-capture`（语音）· `browser-use` / `cua-driver` / `mobile-mcp` / `node-repl`（执行面）。
- 代码评审以 **bundled skill + CLI 命令**交付（三期核对修正：`assets/prompts/code-review/` 路径不存在；实际在 `packages/core/src/skills/bundled/review/` 与 `packages/cli/src/commands/review`）。

---

# 跨厂商共性汇总（六家横向对照）

> 本节把六家的发现按维度横向对齐。**「命中数」= 六家中在该维度有明确实证的家数。**
> 「DeepOrca 现状」以本仓库 `packages/core/src/common/model-capabilities.ts` / `think-level.ts` / `openai-thinking.ts` / `openai-message-converter.ts` / `tool-call-repair.ts` 为准。

## 一、六家横向对照表

| # | 维度 | 命中 | 各家做法 | DeepOrca 现状 | 差距 |
| --- | --- | --- | --- | --- | --- |
| C1 | **分派键 = 声明的协议方言**（非 provider、非模型名） | **6/6** | Step `.api`（`check:no-provider-dispatch` 门禁冻结）· kimi `ProtocolName` 4 值 · MiniMax `provider.api` · MiMo `model.api` · deepseek 路由+adapter · qwen `AuthType` | ✅ `thinkingProtocol`（`deepseek`/`stepfun`/`unknown`） | 枚举偏窄；6 家一致证明**分派键应是协议而非模型** |
| C2 | **per-model 画像作为数据** | **6/6** | Step `ModelDefinitionSchema`（18 字段）· kimi `CatalogModelDefinition` · MiniMax `ModelConfig`（27 字段，三期核对修正：原记 29）· MiMo `Model` · deepseek `DEFAULT_MODELS` + `modelPolicies` + overrides 三层 · qwen `ContentGeneratorConfig`（126 行） | ⚠️ `ModelFamilySpec`（家族级 12 字段）+ `MODEL_OVERRIDES`（4 条） | 家族级 vs 模型级；覆盖条目远少于六家 |
| C3 | **「不可关思考」是一等状态** | **5/6** | kimi `alwaysThinking` · MiniMax `forced_on` · qwen `thinkingMandatory`（具名 `qwen3.8-max-preview`）· Step 推理不可关（关闭投影 `low`）· deepseek `thinking: disabled` 锁 `off` | ⚠️ 未建模（StepFun 在 builder 里手工实现 off→low） | 2 家以上有**具名模型**证据，DeepOrca 会真发 400 |
| C4 | **thinking wire 形状按协议分派** | **5/6** | MiniMax 三协议三形状 · Step `thinkingFormat` 11 值枚举（派生 6 种，余 5 种供 per-model 声明） · kimi `ThinkingStrategy` 钩子 · deepseek `output_config.effort` vs `thinking.type` · qwen `disableField` 三态 | ⚠️ `THINKING_BUILDERS`（3 条：deepseek/stepfun/unknown） | 家数偏少，且无「同模型不同协议」维度 |
| C5 | **缓存纪律是一等设计问题** | **6/6** | deepseek **每特性必答 KV Cache effect** · MiniMax `fingerprintAssembly` · qwen **三缓存锚点**+`ephemeral`/`1h` · Step `supportsLongCacheRetention`/`cacheControlFormat`/`in-history` · MiMo Reminder 下沉 message 层（前缀缓存论据）· kimi `wrapSystemReminder` | ⚠️ X 线 spec 提过「turn-tail 前缀纪律」，无指纹/锚点/保留策略 | **最大差距**；DeepOrca 的 `buildSkillDocumentsPrompt()` 把技能注入 **system messages**——按 MiMo 论据这会破坏前缀缓存 |
| C6 | **压缩阈值含预留量/比例**（非满窗口） | **6/6** | Step `window − reserve`（keepRecent 20K）· kimi `ratio 0.85` + `reserved 50K` · deepseek `min(W×0.8, W−O−65536)` · qwen **四档** `{warn,auto,hard,effectiveWindow}` · MiniMax `computeCompactionTriggerAt` · MiMo `budget` | ❌ **满窗口触发**（`activeTokens > threshold`，threshold = 家族窗口值） | DeepOrca 是六家**唯一**满窗口触发；无 warn 层、无 reserved 概念 |
| C7 | **输出预算与压缩触发互相牵制** | **3/6** | MiniMax **「预留完整 maxTokens 会让 200k 窗口在 35% 处就压缩」** · qwen `computeCompactionOutputBudget` + `SUMMARY_RESERVE` · deepseek `headroomTokens` + `W − O − B` | ❌ 无此概念 | 直接影响压缩时机正确性 |
| C8 | **temperature 是能力位** | **4/6** | MiMo `capabilities.temperature` 默认 **false** · MiniMax `temperature?: boolean` · qwen temperature-rejection gate · deepseek `supportsTemperature` | ❌ 无条件发 `settings.temperature` | 三/四家独立印证 |
| C9 | **reasoning 字段名是集合 & 可观察** | **3/6** | kimi `KNOWN_REASONING_KEYS`（3 值）+ **`ReasoningKeyDialect` 观察式自适应** · MiniMax `interleaved.field`（2 值）· deepseek replay metadata | ⚠️ `reasoningReadFields` 2 值、静态、无 `reasoning_details` | 缺 `reasoning_details`（数组形状） |
| C10 | **思考签名：provider 绑定 vs model 绑定** | **1/6** | MiniMax `SIBLING_NATIVE_THINKING_APIS` + 显式区分 | ❌ 未建模 | 独有但概念重要 |
| C11 | **循环/重复的递进干预** | **2/6** | kimi **repeat breaker 3/5/8/12 四级阶梯**（含「写一句预期获得什么新信息」「三选一」）· MiMo ngram（**CJK 感知**）+ reasoning streak + `LOOP_STREAK_TRIGGER_COUNT=3` | ❌ 无 | kimi 的阶梯文本质量极高，可直接借鉴 |
| C12 | **工具面按会话状态收窄** | **4/6** | Step `deferredToolsMode: "kimi"`（已用工具移出 tools 数组）· MiniMax MCP disclosure（`thresholdPct × contextWindow`）· MiMo **仅 tool search**（三期核对：MCP disclosure 系误植，见仓库 2/6 D5.1）· kimi `dynamically_loaded_tools` | ❌ 每次全量下发 | token 效率差距 |
| C13 | **工具 schema 按厂商变形** | **3/6** | MiMo `sanitizeMoonshot`（**Moonshot 拒绝 `anyOf` 与 `type` 同级；而 mimo-v2.5-pro / MiniMax-M3 恰恰依赖父级 `type`**）· Step `convertTool` 钩子 · qwen `schemaCompliance` | ❌ 未建模 | 双向冲突：改 A 坏 B |
| C14 | **退化输入污染持久化历史** | **1/6** | MiniMax `MIN_PROVIDER_IMAGE_EDGE_PX=8`（生产者守卫 32px + 消费端末道网；注释：**「the session then fails forever」**，阈值经生产/测试网关实测） | ❓ 待核对 | 概念重要：坏输入一旦入库，每轮复发 |
| C15 | **系统提示装配策略** | **6/6 但分歧最大** | MiMo **按模型 8 份**（`deepseek/glm/kimi/minimax/gpt/gemini/anthropic/beast/trinity/default`）· kimi **1 份通用** · MiniMax **按 agent 角色 + 平台**（`prompt-base-windows.md`）· deepseek **单份 + `systemPromptUpdate: in-history`** · Step **按活跃工具集动态组装** · qwen 独立 prompt 资产 | 单份 + 技能 XML 注入 system messages | **六家无共识**——说明「按模型换提示」不是普适解，须本仓库自行判断 |
| C16 | **文本工具兜捞需意图守卫** | **1/6** | qwen `proseRatioGuard 0.8`（「Substantial surrounding prose suggests the model is documenting or echoing the format」） | ⚠️ `scavengeToolCalls` **有**白名单/区域切除/上限，**无**散文占比守卫 | DeepOrca 会在模型「讲解协议」时误兜捞并**真的执行** |
| C17 | **失败大声而非静默降级** | **4/6** | kimi `bindingFor` 未知协议 **throw** · ~~MiniMax `variantFor`~~（三期核对：`variantFor` 在 MiniMax 公开投影零命中，疑似从 kimi 类比误植——该条应属 **MiMo** `llm-server/completions.ts:93-118`） · deepseek `UNSUPPORTED_REASONING_EFFORT` **网络 I/O 之前**失败 · qwen `invalidReasoning(route)` | ⚠️ `mapThinkLevel` 恒等静默透传 | 设计原则 |
| C18 | **token 计量须含消息之外的载荷** | **2/6** | MiniMax `estimateSystemPromptAndToolTokens`（注释：消息估算**系统性低估**，大 system prompt + MCP 重型工具注册表轻易加数万 token）· deepseek `tokenMeter` | ✅ `countRequestPayloadTokens`（AGENTS.md：`activeTokens` 是请求载荷的预检计数） | **已对齐**（需核对是否真的含 tools） |
| C19 | **drift gate（上游新增拼写编译期失败）** | **2/6** | deepseek 四个 `*_GATE`（cache_control / thinking_budget ×3 / max_tokens ×2 / chat_template var ×3）· Step 16 条 `check:*` 脚本 | ❌ | 防「上游悄悄加字段而我们没跟上」 |

## 二、四条最有价值的「单家发现」（值得单独记住）

1. **deepseek：每项特性必须声明 KV Cache effect**（C5）——把「是否破坏前缀缓存」变成设计的必答题，而不是事后优化。这条纪律本身比任何单项优化都更值得借鉴。

2. **MiniMax：输出预留量会拖累压缩触发点**（C7）——「Reserving the full maxTokens for automatic compaction **triggers compaction around 35% of a 200k window, wasting most of it**」。DeepOrca 目前是满窗口触发，与该问题同源。

3. **kimi：重复熔断器的四级递进阶梯**（C11）——3 次要求「写一句预期获得什么新信息」；5 次强制在「反证测试 / 说明缺什么输入 / 收敛」三选一并先声明选择；8 次要求只写文本最终答复；12 次**拒绝执行工具**并终止本轮。

4. **MiniMax：退化输入会永久损坏会话**（C14）——坏图片一经持久化，之后每轮请求都被网关拒绝，故需「生产者守卫 + 消费端末道网」双向防线。

## 三、DeepOrca 已经做对的部分（对照确认，不要动）

| 项 | 证据 |
| --- | --- |
| **单一注册表解析模型能力** | `resolveModelSpec` 纯函数、零依赖、可进 renderer bundle——与六家「画像即数据」同向，且**零依赖约束比六家更严** |
| **统一档位刻度 + 家族原生映射** | qwen 的 `reasoning.effort` 统一梯子 + 逐 provider 子集**独立印证了 `THINK_LEVEL_FAMILY_MAPS` 的设计方向**；deepseek 官方 effort 恰为 `off/low/high/max`，**与 DeepOrca 的 deepseek 家族映射 `{low:low, medium:high, high:high, xhigh:high, max:max}` 一致** |
| **工具参数修复链** | `lenientParseToolArguments`（截断修复 + 围栏剥离 + 散文抽取）**强于** kimi（只有 `parseFailed` 判定）与 Step（无修复链） |
| **工具兜捞的安全门** | `scavengeToolCalls` 的白名单 + 区域切除 + max-calls + 100KB 上限，与 qwen 同级（仅缺散文守卫） |
| **reasoning replay 三态建模** | `empty-field` / `omit` / `content`——与 MiniMax 的 4 路策略、kimi 的 dialect 属同一问题域 |
| **本地 token 计量唯一统计源** | 与 deepseek 的 `tokenMeter`「One measurement service prices every decision」同向 |
| **未知模型 fail-open** | 与 kimi 的 `UNKNOWN_CAPABILITY` 哨兵同向（DeepOrca 用 `familyResolved` + catalog 增强） |
| **X 线传输通道（AI SDK，默认关）** | 六家中**没有一家**做「第二传输通道旁挂」——DeepOrca 在传输层比六家更激进，但这不构成模型专属优化的替代 |

## 四、明确的差异与风险（调研暴露的）

| 风险 | 说明 |
| --- | --- |
| **满窗口压缩触发** | DeepOrca 是六家唯一；无 warn 层、无 reserved、未计入摘要副查询输出预算（C6/C7） |
| **技能注入 system messages** | 按 MiMo 的前缀缓存论据，`buildSkillDocumentsPrompt()` 注入 system 层会破坏前缀；kimi/MiMo 均把动态内容下沉到 message 层（C5） |
| **无 cache 锚点/指纹/保留策略** | qwen 三锚点 + `ephemeral`/`1h`；deepseek 每特性 KV 声明；MiniMax 装配指纹——DeepOrca 全无（C5） |
| **thinking 不可关未建模** | 至少 `qwen3.8-max-preview` 有具名证据（C3） |
| **无温度能力位** | 四家独立印证（C8） |
| **兜捞无散文守卫** | 模型「讲解协议」时会误执行（C16） |
| **无循环干预** | 长 agentic 会话下模型原地打转无出路；**本会话中三个调研 agent 因同一 provider 错误失败三次**，正是「无递进干预 → 反复重试」的真实样本（C11） |
| **「只看模型」与「按通道分派」的张力** | MiniMax 的 `openplatform-thinking-patcher` 证明**同一模型在不同通道契约不同**（M3 在 completions 上必须删 `reasoning_effort`、在 anthropic 上必须删 `output_config.effort`）；qwen 的 profile 也同时用 authType + hostname。**用户已明确要求「不关注节点、只关注模型」**——该风险须以「画像字段留白 + 真机验证清单」承接，不引入 baseURL 分支 |

## 五、调研方法学说明（可核查性）

| 仓库 | clone 状态 | 覆盖维度 | 备注 |
| --- | --- | --- | --- |
| `stepfun-ai/Step-Code` | ✅ | D1–D12 全覆盖 | 首次 clone 网络失败，重试成功 |
| `XiaomiMiMo/MiMo-Code` | ✅ | D1–D12 全覆盖 | 含 4 份 MiMo 专属设计文档 |
| `MoonshotAI/kimi-code` | ✅ | D1–D12 全覆盖 | 代码禁注释，靠类型与文档取证 |
| `deepseek-ai/deepseek-harness` | ✅ | D1–D12 全覆盖 | README 体系最完整 |
| `MiniMax-AI/minimax-code` | ✅ | D1–D12 全覆盖 | **公开投影**，缺失不等于不存在 |
| `QwenLM/qwen-code` | ✅ | D1–D11 覆盖；D2/D5 部分 | 仓库最大（5811 源文件） |

**未做**：未执行任何真机请求；所有结论来自源码与仓库文档。**厂商 wire 参数的具体取值须在实施时按当日文档复核**（与 `specs/model-fleet-adaptation` §三「不臆造」原则一致）。

---

# 仓库 7/7 — ZCode（智谱 GLM 官方）· 补测

仓库：`zai-org/ZCode`（默认分支 `main`，`zcode@3.14.0`，**Apache-2.0**，pnpm monorepo，TypeScript）
自述：「**Z.ai's coding agent harness. Powerful, intelligent, extensible.**」+「an AI coding workspace with desktop, browser, and terminal interfaces」

> **补测缘由**：v1–v3 调研时未找到智谱第一方仓库，`glm` 家族在方案中只能标「❌ 仅目录、无第一方证据」。本次补上，`glm` 的证据缺口已闭合。

## D1 仓库身份 / 结构（与其它六家差异明显）

| 目录 | 内容 |
| --- | --- |
| `packages/` | `model-option-map` · `provider` · `provider-node` · `services` · `server` · `client` · `rpc` · `shared` · `ui` · `web` · `desktop` · `formal-proof` · `zcode-cua` · `zcode-server-cli` |
| `apps/` | `zcode-cli`（Agent CLI + runtime，同时供 Desktop/Web 用） |
| `harness/` | `remote` |
| `third-party/` | `inventory.json`（逐文件 sha256）· `copied-components.json` · `embedded-components.json` · `npm-overrides.json` · `native-search` · `runtime` · `upstream` |
| 根文档 | `AGENTS.md` · `CONTEXT.md`（领域术语表）· `DESIGN.md`（**UI 设计系统**，537 行）· `architecture-policy.yaml` |

**两处与 DeepOrca 高度相似**：① 也用 `.agents/skills/` 约定（见 `third-party/inventory.json` 里的 `.agents/skills/...` 条目）；② 也做逐文件第三方清单 + 哈希（DeepOrca 的 `scripts/vendor-*.js` 家族同向）。

### D1.1 架构强制门 `architecture-policy.yaml`（67 行）

```yaml
version: 1
modules:
  - id: storage
    roots: [packages/services/src/storage]
    managed: true
    requires: [shared, rpc, services]
    publicEntrypoints: [packages/services/src/storage/contract.ts]
    layers: { domain: domain, app: app, adapters: adapters }
    layerOrder: [domain, app, adapters]
    owner: desktop-settings
  # …其余模块 managed: false（存量先标 legacy）
global:
  maxFileLines: 400
  maxContractLines: 300
  maxPublicMethods: 12
  forbidCycles: true
  forbidDeepImports: true
  managedOnly: true
exceptions: []
```

pre-push 跑 `pnpm run architecture:check -- --changed`（`verify:pre-push`）。

**对比 DeepOrca**：`maxFileLines: 400`（DeepOrca 是 2500 ±10%）、`maxPublicMethods: 12`、`forbidCycles` / `forbidDeepImports` / `managedOnly` 全部机械化强制，且**按模块声明 owner 与公共入口**。DeepOrca 有 16 条类似门禁但无「模块 owner / 分层序 / 公共入口」这三个维度。

### D1.2 `CONTEXT.md`：领域术语表（ubiquitous language）

81 行的插件商店词汇表，逐条给「定义 + `_Avoid_:` 反例」。例如：

> **Official Marketplace（官方市场）**：ZCode 官方运营的唯一分发渠道，市场 id 为 `zcode-plugins-official`…是"分发渠道"而非"作者归属"
> `_Avoid_: "官方"泛指一切受信市场`

**这是六家里唯一把「术语纪律」写成独立文件的**（含明确的禁用词清单）。

## D9 模型注册与匹配 —— ★ 本仓库的核心：**模型选项映射 DSL**

### D9.1 一个专用的 workspace 包：`@zcode/model-option-map`

```
packages/model-option-map/src/
  tokenizer.ts     (141 行)   ← 词法
  parser.ts        (240 行)   ← 语法
  compiler.ts      ( 92 行)   ← 编译 + 三级 memo 缓存
  evaluator.ts     (214 行)   ← 求值
  merge-patch.ts   ( 97 行)   ← JSON Merge Patch（RFC 7386）
  option-maps.ts   ( 42 行)   ← 门面：compileModelOptionMaps
  types.ts         ( 36 行)
```

`types.ts`：

```ts
export type RestrictedCelValue = string | number;
export type ModelOptionName = "reasoningLevel" | "maxOutputTokens";

export interface RestrictedCelProgram { readonly source: string; evaluate(input: RestrictedCelValue): JsonValue; }
export interface ModelOptionMapProgram { readonly source: string; evaluate(input: RestrictedCelValue): JsonObject; }
```

**即：一套「受限 CEL（Common Expression Language）」**，输入是一个标量选项值，输出必须是 JSON 对象。

### D9.2 完整机制：`选项值 → CEL → JSON Merge Patch → 请求体`

`option-maps.ts`：

```ts
export interface ModelOptionMapSpecs {
  readonly reasoningLevel: { readonly map: string };    // CEL 源码
  readonly maxOutputTokens: { readonly map: string };   // CEL 源码
}

/** Model 创建时编译一次；每个请求只绑定本轮冻结的 Option value。 */
export function compileModelOptionMaps(specs: ModelOptionMapSpecs): CompiledModelOptionMaps {
  const reasoningLevel = compileModelOptionMap(specs.reasoningLevel.map, "reasoningLevel");
  const maxOutputTokens = compileModelOptionMap(specs.maxOutputTokens.map, "maxOutputTokens");
  return Object.freeze({
    apply(body: JsonObject, values: ModelOptionValues): JsonObject {
      const patches: NamedJsonMergePatch[] = [];
      patches.push(optionPatch("reasoningLevel", reasoningLevel, values.reasoningLevel));
      patches.push(optionPatch("maxOutputTokens", maxOutputTokens, values.maxOutputTokens));
      return applyOrderedJsonMergePatches(body, patches);
    },
  });
}
```

**四步**：① 模型创建时把两个 CEL 串**编译一次**并缓存；② 每请求用冻结的选项值求值；③ 每次求值产出一个 **JSON Merge Patch**；④ 按序应用补丁到请求体。

### D9.3 DSL 的表达力边界（`evaluator.ts` / `parser.ts`）

支持的构造：

| 类别 | 支持 |
| --- | --- |
| 字面量 | 字符串（单/双引号均可）、数字、布尔、null、数组、对象 |
| 变量 | **仅 `input`**（即该选项的值） |
| 一元 | `!` · `-` |
| 二元 | `==` `!=` `+`（字符串拼接或数值加）`-` `*` `/` `&&` `\|\|` |
| 条件 | 三元 `? :` |

**不支持**：函数调用、属性访问、索引、变量声明。即**无 IO、无副作用、纯表达式**。

编译期校验 `assertObjectResultExpression`：**递归进入三元两个分支**，要求每条路径都返回对象，否则抛 `RestrictedCelError`（带 `offset`，定位精确）。

缓存与不可变：`programCache` / `optionMapCache` / `expressionCache` 三级 memo；`evaluateRestrictedCel` 出口 `freezeJson` 冻结结果。

### D9.4 ★ 匹配是二维的：`(modelMatch, apiTypeMatch)`

`config/provider/zcode-builtin.json` 里 CEL map 挂在 **`modelApiRules`** 下：

```json
{
  "modelMatch": ".*",
  "apiTypeMatch": "anthropic-messages",
  "config": { "optionSpecs": {
    "reasoningLevel": { "map": "reasoningLevel == \"disabled\" ? {\"thinking\":{\"type\":\"disabled\"}} : {\"thinking\":{\"type\":\"adaptive\"},\"output_config\":{\"effort\": reasoningLevel == \"enabled\" ? \"high\" : reasoningLevel}}" },
    "maxOutputTokens": { "map": "{'max_tokens': maxOutputTokens}" } } }
},
{
  "modelMatch": ".*",
  "apiTypeMatch": "openai-chat-completions",
  "config": { "optionSpecs": {
    "reasoningLevel": { "map": "{…四种拼写同时写…}" },
    "maxOutputTokens": { "map": "{'max_completion_tokens': maxOutputTokens}" } } }
},
{
  "modelMatch": ".*",
  "apiTypeMatch": "openai-responses",
  "config": { "optionSpecs": {
    "reasoningLevel": { "map": "{\"reasoning\": {\"effort\": …}}" },
    "maxOutputTokens": { "map": "{'max_output_tokens': maxOutputTokens}" } } }
}
```

**`apiTypeMatch` 取值全集（三期核对修正：内置配置实为 **3 个**——anthropic-messages 38 条 / openai-chat-completions 24 条 / openai-responses 10 条，共 72 条 modelApiRules；全仓无一处 `apiTypeMatch: ".*"`，`.*` 是 patternSchema 正则的理论能力而非实际取值）**：`anthropic-messages` · `openai-chat-completions` · `openai-responses`

**三方收敛**：这与 kimi 的 `ProtocolName`（`openai`/`openai_responses`/`anthropic`/`google-genai`）、Step-Code 的 `model.api` 是同一套「协议方言」抽象——**第 7 家再次印证**。

### D9.5 ★ 实测的 CEL map 词汇表（119 条 map / 111 条非空）

从内置配置提取的 wire 词汇，**完整覆盖前六家的全部思考形状**：

| wire 字段 | 取值 | 出处 |
| --- | --- | --- |
| `thinking.type` | `enabled` / `disabled` / **`adaptive`** | 多条 |
| `output_config.effort` | 档位值 | anthropic 系 |
| `reasoning.effort` | 档位值 | openai-responses 系 |
| `reasoning_effort` | 档位值 | openai-chat 系 |
| `enable_thinking` | 布尔 | openai-chat 系 |
| `max_tokens` / `max_completion_tokens` / `max_output_tokens` | 数值 | 三种拼写各对应一种协议 |

**档位归一化直接写在表达式里**（无需代码）：

```
"output_config": { "effort": reasoningLevel == "enabled" ? "high" : reasoningLevel }
```

**最激进的一条**（`openai-chat-completions` 默认规则）——**一次写四种拼写**以求最大网关兼容：

```
{
  "thinking": { "type": reasoningLevel == "disabled" || reasoningLevel == "none" ? "disabled" : "enabled" },
  "enable_thinking": reasoningLevel != "disabled" && reasoningLevel != "none",
  "reasoning_effort": reasoningLevel == "disabled" ? "none" : reasoningLevel == "enabled" ? "high" : reasoningLevel,
  "reasoning": { "effort": reasoningLevel == "disabled" ? "none" : reasoningLevel == "enabled" ? "high" : reasoningLevel }
}
```

### D9.6 ★ JSON Merge Patch + **路径冲突检测**

`merge-patch.ts`：

```ts
export function applyOrderedJsonMergePatches(body: JsonObject, patches: readonly NamedJsonMergePatch[]): JsonObject {
  const ownedPaths: OwnedPath[] = [];
  let result = cloneJson(body) as JsonObject;
  for (const namedPatch of patches) {
    const paths = collectWrittenPaths(namedPatch.patch);
    for (const path of paths) {
      const conflict = ownedPaths.find((owned) => pathsOverlap(owned.path, path));
      if (conflict) {
        throw new ModelOptionMapError(
          `Model option maps write conflicting JSON path ${formatPath(path)}: ${conflict.option} and ${namedPatch.option}`,
        );
      }
      ownedPaths.push({ option: namedPatch.option, path });
    }
    result = mergeObject(result, namedPatch.patch);
  }
  return result;
}
```

三条设计要点：

1. **`null` 即删除**（RFC 7386）：`if (patchValue === null) { delete result[key]; continue; }` —— MiniMax 用**代码**写的「删掉 `reasoning_effort`」，在这里是**数据**。
   （注：内置配置 119 条 map 中**未使用** null 删除，属能力闲置。）
2. **★ 路径冲突检测**：两个 option map 若写到**重叠**路径（`pathsOverlap` 做前缀比较，故 `$.thinking` 与 `$.thinking.type` 冲突）即抛错——**防止 `reasoningLevel` 与 `maxOutputTokens` 悄悄争抢同一字段**。
3. **硬化**：`Object.create(null)`（防原型污染）+ 每次 merge 都 `cloneJson` + 结果冻结。

### D9.7 `optionSpecs` 的层次与用户可编辑性

- 形状：`optionSpecs.reasoningLevel = { values: string[], map: string }`；`optionSpecs.maxOutputTokens = { max: number, map: string }`
- `values` 是**允许档位数组**；`map` 是 CEL（可为 `"{}"` = 无副作用）
- **默认档取 `values.at(-1)`**（数组末位 = 最强档）：`model-selection-config.ts:65` `const reasoningLevel = model?.config.optionSpecs.reasoningLevel.values.at(-1);`
- 两层配置：`model.config.optionSpecs`（注册表）vs `model.personalConfig.optionSpecs`（用户），带继承（`inherited?.optionSpecs?.reasoningLevel`）
- **用户在 UI 里可直接编辑** `values` 与 `map`（`ui/src/settings/model-provider-section/ProviderModelMetadata.ts`，含去重/非空/完整性校验）
- 校验错误码：`reasoning-level-missing` + `values` 成员校验（`registry.ts:138-148`）

### D9.8 `modelMatch` 级联（模型匹配是正则级联 + 局部覆盖）

`config/provider/zcode-builtin.json` 实测（节选）：

```json
{ "modelMatch": ".*glm-5(?:[.\\-:/\\[].*)?",
  "config": { "properties": { "contextWindow": 200000, "inputFormat": {"supportsImage": false, "supportsVideo": false} },
              "optionSpecs": { "reasoningLevel": {"values": ["disabled","enabled"]}, "maxOutputTokens": {"max": 64000} } } },
{ "modelMatch": ".*GLM-5\\.2(?:[.\\-:/\\[].*)?",
  "config": { "properties": { "contextWindow": 1000000, ... },
              "optionSpecs": { "reasoningLevel": {"values": ["disabled","high","max"]}, "maxOutputTokens": {"max": 128000} } } },
{ "modelMatch": ".*glm-5\\.3(?:-flash)?(?:[.\\-:/\\[].*)?",
  "config": { "properties": { "contextWindow": 1000000, ... },
              "optionSpecs": { "reasoningLevel": {"values": ["low","high","max"]}, "maxOutputTokens": {"max": 128000} } } }
```

- **规则是局部覆盖**（有的只给 `contextWindow`，有的只给 `maxOutputTokens.max`），按序合并
- 型号后缀约定：`.*\[1m\]` → `contextWindow: 1000000`（模型名带 `[1m]` 即长窗口变体）
- **★ 档位值集合逐代演进**：
  - `glm-5` → `["disabled","enabled"]`（开关式）
  - `GLM-5.2` → `["disabled","high","max"]`（档位式）
  - `glm-5.3` → `["low","high","max"]` —— **无 `disabled`，即思考不可关**

**最后一条与 models.dev 的「`reasoning_options[].values` 不含 `none`/`off` 即可推导不可关」是同一个信号**（两个独立来源第三次吻合）。

## D3 / D4 / D10 模型属性词汇表

`config.properties` 实测全集（**仅 8 项，极简**）：

| 字段 | 含义 |
| --- | --- |
| `contextWindow` | 上下文窗口 |
| `inputFormat` | `supportsText` / `supportsImage` / `supportsVideo` / `supportsAudio` / **`supportsPdf`** |
| `outputFormat` | `supportsText` |
| `supportsToolCall` | 工具调用 |
| `supportsJsonSchemaOutput` | JSON Schema 结构化输出 |
| `supportsNativeWebSearch` | 原生联网搜索 |
| **`supportsMidConversationSystem`** | **对话中途的 system 消息** |
| **`requiresMfjsToolSchema`** | **MFJS = Moonshot Flavored JSON Schema** |

### D4.1 ★ `requiresMfjsToolSchema` —— 跨厂商印证的工具 schema 兼容层

`ui/src/i18n/locales/zh-CN.ts:2849`：

> **MFJS 工具 Schema**：启用 **Moonshot Flavored JSON Schema**（Moonshot 的 JSON Schema 格式）兼容处理，常用于 **Moonshot 的 Kimi 模型接口**。仅在模型接口要求该格式时开启。

**这与 MiMo-Code 的 `sanitizeMoonshot`（`anyOf` 与父级 `type` 同级会被 Moonshot 校验器拒绝）是同一个问题**——小米与智谱**各自独立**实现了 Kimi 的工具 schema 兼容层。**跨厂商双重印证该优化真实存在且必要。**

### D3.1 `supportsMidConversationSystem` —— 与 DeepSeek 的 `in-history` 同源

「对话中途可插入 system 消息」= deepseek-harness 的 `systemPromptUpdate: 'in-history'`（端点读取 `messages` 任意位置的最新 system 作为完整系统提示）。**两个第一方独立印证同一模型能力位。**

## D6 / D7 / D8 未发现项（诚实记录）

| 维度 | 结果 |
| --- | --- |
| D6 压缩 | **三期探索者已找到**：压缩全链路在 `apps/zcode-cli/packages/core/src/compact/` + `runtime/methods/*compact*`（嵌套 workspace，一期未挖入）——三层体系：microcompact（本地零调用）→ auto compact → rapid-refill 熔断（详见三期 7/7 探索者 §1） |
| D7 缓存 | **三期核对修正**：原「未发现」搜索范围仅限 provider+services 两包——**CLI runtime 内实有完整锚点体系**（`apps/zcode-cli/.../provider-request-messages.ts:292-314` 单尾锚 + `context/builder.ts` system 三段锚 + skipCacheWrite），与本报告专项二 C 自相矛盾，以专项二为准（详见三期 7/7 探索者 §6） |
| D8 采样 | `temperature` **不是** per-model 选项（provider 层无该字段）；采样面只暴露 `maxOutputTokens`（含 `max` 上限与 `map`） |

## D0 ★ ZCode **没有**端点试探机制（与本次策略直接相关）

对 `packages/provider` / `packages/services` 全量 grep `probe` / `fallback` / `downgrade` / `unsupported param` 等：**命中项全部无关**（oauth 回退、插件路径回退、终端 conpty 回退）。**未发现「先发优化、被拒则降级」的机制。**

ZCode 应对「通道不确定」用的是另外两条路：

1. **声明 `apiType`**（`apiTypeMatch` 二维匹配）→ 让正确形状被选中，而不是试探
2. **霰弹枪**：对最不可预测的 `openai-chat-completions`，**一次写四种拼写**（`thinking.type` + `enable_thinking` + `reasoning_effort` + `reasoning.effort`），让端点各取所需

**与 DeepOrca 现有哲学的冲突点**：DeepOrca 明确反对发外来字段（`model-capabilities.ts` 对 stepfun 的注释：「an empty `reasoning_content` would be a **FOREIGN field** a strict compatibility layer could reject — replaying nothing is the universally accepted shape」）；qwen 也实证过第三方后端把 `metadata` 当字符串直接 400（issue #11590）。**即：霰弹枪与 DeepOrca 的保守取向相反。**

**因此你提的「端点试探」是第三条路**，且与 DeepOrca 既有取向一致：**乐观发送 → 被拒则弃用该优化并回落默认**。详见方案 §5.4。

---

# 跨厂商汇总 · ZCode 补测后的增量修订

> 前文「跨厂商共性汇总」的表基于六家。加入第 7 家 ZCode 后，以下条目需要修订或加强。

## 一、命中数更新

| # | 维度 | 原命中 | **补 ZCode 后** | 增量证据 |
| --- | --- | --- | --- | --- |
| C1 | 分派键 = 声明的协议方言 | 6/6 | **7/7** | ZCode `apiTypeMatch` ∈ {`anthropic-messages`, `openai-chat-completions`, `openai-responses`}，**与 kimi `ProtocolName`、Step `model.api` 三方收敛于同一套 3–4 个方言** |
| C2 | per-model 画像作为数据 | 6/6 | **7/7** | ZCode `modelMatch` 正则级联 + `properties`（8 项）+ `optionSpecs`，**且用户可在 UI 编辑** |
| C4 | thinking wire 形状按协议分派 | 5/6 | **6/7** | ZCode 把三协议三形状写成 **CEL 数据**（§D9.4），而非代码分支 |
| C6 | 压缩阈值含预留量/比例 | 6/6 | 6/7 | ZCode 公开投影中**未找到**压缩实现（诚实记录） |
| C7 | 输出预算与压缩触发互相牵制 | 3/6 | 3/7 | ZCode 有 `maxOutputTokens.max` 上限，但未见与压缩的联动 |
| C8 | temperature 是能力位 | 4/6 | 4/7 | ZCode **不做** per-model temperature（采样面只暴露 `maxOutputTokens`） |
| C13 | 工具 schema 按厂商变形 | 3/6 | **4/7** | **ZCode `requiresMfjsToolSchema`（MFJS = Moonshot Flavored JSON Schema）——与 MiMo `sanitizeMoonshot` 是同一问题的两家独立实现** |
| C15 | 系统提示装配策略 | 6/6 | 6/7 | ZCode 未在投影中暴露（其 `properties` 有 `supportsMidConversationSystem`，与 deepseek `in-history` 同源） |
| C17 | 失败大声而非静默降级 | 4/6 | **5/7** | ZCode 编译期 `assertObjectResultExpression`（递归校验三元所有分支）+ 运行期路径冲突抛错 |

## 二、ZCode 贡献的**新维度**（六家中无对应）

| # | 维度 | ZCode 做法 | 价值 |
| --- | --- | --- | --- |
| **C20** | **用受限表达式（数据）承载 wire 映射，而非代码分支** | `@zcode/model-option-map`：受限 CEL（tokenizer/parser/compiler/evaluator）+ JSON Merge Patch；`reasoningLevel.map` / `maxOutputTokens.map` 是**字符串** | 模型专属适配可**不改代码**完成，且用户可在 UI 编辑 |
| **C21** | **优化之间的 JSON 路径冲突检测** | `applyOrderedJsonMergePatches` 收集各 patch 写入路径，重叠即抛 `ModelOptionMapError` | 防止两个优化悄悄争抢同一请求字段——**这类 bug 在代码分支实现里极难发现** |
| **C22** | **匹配的二维化：`(模型, 协议)`** | `modelApiRules` 的 `modelMatch` + `apiTypeMatch` 配对 | 「同一模型按协议换 wire 形状」的**最干净表达**，且不需要节点/第一方判定 |
| **C23** | **架构强制门含模块 owner / 分层序 / 公共入口** | `architecture-policy.yaml`：`requires` / `layerOrder` / `publicEntrypoints` / `owner`，全局 `maxFileLines: 400` / `maxPublicMethods: 12` / `forbidCycles` / `forbidDeepImports` | DeepOrca 的 16 条门禁缺这三个维度 |
| **C24** | **领域术语表（ubiquitous language）独立成文件** | `CONTEXT.md`：逐条给定义 + `_Avoid_:` 禁用词 | 七家中唯一 |

## 三、ZCode 与前六家**取向相反**的一点（重要）

**ZCode 用「霰弹枪」应对通道不确定性**：对最不可预测的 `openai-chat-completions`，一条 map **同时写四种拼写**（`thinking.type` + `enable_thinking` + `reasoning_effort` + `reasoning.effort`），让端点各取所需。

**DeepOrca 的既有取向相反**（且证据支持保守）：

- `model-capabilities.ts` 对 stepfun 的注释：空 `reasoning_content`「would be a **FOREIGN field** a strict compatibility layer could reject — replaying nothing is the universally accepted shape」
- qwen 实证（issue #11590）：第三方后端把 DashScope 的 `metadata` 对象当字符串，**直接 400**

**结论**：DeepOrca 不应采用霰弹枪。用户提出的「**端点试探**」（乐观发送 → 被拒则弃用该优化 → 走默认）是**第三条路**，且与 DeepOrca 既有保守取向一致——详见方案 §5.4。

## 四、ZCode **没有**端点试探机制（与本次策略直接相关）

对 `packages/provider` / `packages/services` 全量搜索 `probe` / `fallback` / `downgrade` / `unsupported param`：**命中项全部无关**（oauth 回退、插件路径回退、终端 conpty 回退）。

**即：七家中没有一家做「先发优化、被拒则降级」。** 用户提出的端点试探在本次调研范围内是**原创策略**，无先例可抄——因此方案 §5.4 给了完整设计（粒度 / 触发时机 / **拒绝归因精确性** / 记账 / 重建 / 重试 / 诊断），其中**拒绝归因**是成败关键（绝不可把 auth/quota/限流误判为「优化被拒」）。

---

# 专项调研一：每家专属的 token 消耗优化方案（2026-09-22 二期）

> **定位**：分家专项，**暂不并入通用方案**（用户 2026-09-22 指示）。每家独立成节，证据格式同正文（文件:行号 + 关键常量）。
> 调研方法：本地 clone 仓库 grep/Read 核实；挖不到的维度明确标注「未发现」。

# 每家专属 token 消耗优化方案调研

## 阶跃 Step（stepfun）

- **A 工具输出裁剪**：有，但属常规截断而非形状剪裁。`packages/agent-core/src/harness/tools/read.ts:51` + `utils/truncate.ts:11-12`：read_file 截到 2000 行 / 50KB（先到者为准），超限提示用 offset 续读；`tools/bash.ts:57,130-133`：bash 输出截到**最后** 2000 行 / 50KB，截断时全量落盘 `fullOutputPath` 供后续读取。未发现按命令类型/输出形状的清洗管线。
- **B 工具结果预算**：弱。仅有单次截断上限（上条）+ 落盘；未发现跨轮的旧工具结果清理/microcompaction。
- **C 工具面/提示面缩减**：有两处专属优化。① `packages/providers/src/api/openai-completions.ts:827-829,1390-1440` + `types.ts:536`：`deferredToolsMode: "kimi"`——工具可延迟声明，首次出现于 toolResult 的 `addedToolNames` 时，才以 Kimi 专用「system 消息携带 tools 字段」的形式内联注入该工具定义，首轮 tools 列表同步过滤掉这些名字（`getDeferredToolNames`），直接缩小每轮工具声明面。② `packages/coding-agent/src/step/system-prompt.ts:182-402`：系统提示附录按**活跃工具集**动态组装——TOOL_RULES 只输出 active 集合中存在的工具条目；Planning/Task tracking/Coordination/Cron/Goal/Workflow/Frontend 等大段章节均以 `active.has(...)` / `hasAnyTool(...)` 门控，无该工具则整段不进 prompt。
- **D 压缩策略**：有。`packages/agent-core/src/harness/compaction/compaction.ts:154-170`：`reserveTokens: 24576`（注释：从 16384 上调，避免 0.8×reserve 的 maxTokens 上限触发 length-stop）、`keepRecentTokens: 20000`、摘要输出硬顶 `SUMMARY_OUTPUT_TOKENS_CEILING = 32000`；`pickSummaryMaxTokens()` 取 `max(0.8×reserve, min(model.maxTokens, 32k))`。另有 turn-prefix 摘要（单轮过大时只摘要轮内前缀、后缀原文保留）与文件操作账本（`computeFileLists`/`FileOperations` 把读/改文件集并入 compaction entry，增量续账）。摘要请求本身设 `cacheRetention:"none"` + 独立 sessionId，避免污染会话缓存。
- **E 输出预算联动**：有。`packages/providers/src/api/simple-options.ts:75-95`：`clampThinkingBudgetToAnswerRoom()`（thinking ≤ ceiling − MIN_ANSWER_TOKENS）与 `adjustMaxTokensForThinking()`（maxTokens = min(base+budget, modelMax)，冲突时反压 thinking）；`openai-completions.ts:950-952` 注释明确「无独立 budget 字段的供应商里 thinking 与正文共享 max_tokens，不封顶会吃光输出」。
- **F 图片 token**：未发现像素预算/压缩阶梯；`tools/image.ts` 直接以附件回传，工具结果纯图时以 `"(see attached image)"` 占位（openai-completions.ts:1384）。
- **G token 计量**：未发现专属估算器；`calculateContextTokens()`（compaction.ts:188）直接用 provider usage（totalTokens 或 input+output+cacheRead+cacheWrite）驱动压缩判断。
- **H 其它**：① 会话亲和 + 缓存复用：`openai-completions.ts:756-804` 按 `sessionAffinityFormat`（openai/openrouter）发 session 头，`prompt_cache_key` + `prompt_cache_retention:"24h"`（`supportsLongCacheRetention`），省的是缓存未命中钱；cached tokens 解析兼容三家字段（prompt_tokens_details.cached_tokens / prompt_cache_hit_tokens / cached）。② git 环境 5 秒缓存：`step/system-prompt.ts:129-130` `GIT_ENVIRONMENT_TTL_MS=5000`，注释明说 MCP 注册风暴中一次注册 N 工具会重建 prompt N 次、每次两个同步 git spawn（~29ms）→ 每 cwd 只付一次（这是延迟优化，非直接 token 优化，但服务于 prompt 重建路径）。
- **本家最独特的 1-2 条**：① **deferredToolsMode "kimi"**——工具定义按需延迟到首次调用点注入（借 Kimi 的 system-with-tools 语法），首轮即省一大块工具声明 token；② **系统提示按活跃工具集逐段门控组装**（十几个大章节 + 逐工具规则条目全部条件渲染），工具少时 prompt 显著缩水。

## 小米 MiMo（XiaomiMiMo_MiMo-Code，opencode fork）

- **A 工具输出裁剪**：**核心专属特性「Token Efficient Mode」**（默认关，`MIMOCODE_EXPERIMENTAL_TOKEN_EFFICIENCY` 单 flag 开启，不被 `MIMOCODE_EXPERIMENTAL=1` 派生）。两条管线串行，入口 `packages/opencode/src/tool/bash.ts:815-843`：① **通用过滤管线** `tool/bash_token_efficient_pipeline.ts`（4 层，顺序敏感）：progress（按行折叠 `\r` 进度条只留最后一帧，必须先于 ansi）→ ansi（4 条 ESC 正则剥 CSI/OSC/DCS + 退格 overstrike + 控制字节）→ redact（8 组行内密钥正则 Bearer/JWT/AWS `AKIA|ASIA`/`gh[pousr]_`/`sk-`/`sk-ant-`/`xox*`/通用 KEY=VALUE + 跨行 PEM 整块替换，必须在 longline 前防长密钥被拦腰折叠）→ longline（单行 >500 字符压成头 160 字符 + `<elided N chars>`，env 可调 `_MAX_LINE_CHARS`/`_LINE_HEAD_KEEP`）。② **启发式形状管线** `tool/bash_token_efficient_heuristic.ts`（560 行，需第二级 flag `MIMOCODE_EXPERIMENTAL_TOKEN_EFFICIENCY_HEURISTIC`）：双通道识别（命令名正则 + 内容指纹 head4k/tail4k 兜底，因用户常 pipe 嵌套），10 种形状各自剪裁——gitdiff（lockfile/min.js/dist 路径整段抑制 + 单 hunk 100 行 cap，预期 -85%）、pytest（4 态状态机只留 collected/E 行/file:line/FAILED/summary，-90%）、npm install（deprecated 警告折成 `[×N: top A,B,C]`，-65%）、make（砍 Entering/Leaving + bare 编译命令，-53%）、stacktrace（折叠 site-packages/.venv/node_modules 帧，连续≥2 合并，-69%）、tsc（按错误码 Top-5 + 文件 Top-8 分组各留 1 样本，-80%）、kubectl（只折全 Running 连续行不重写列，-70%）、json（裁 embedding/raw_html/body/base64 大字段或 schema-only 模式，-95%）、md（gh pr/issue view 清 HTML 注释/徽章/装饰）、gostest（NDJSON 流式按 pkg 聚合，-90%）。命令层 passthrough：`--json`/`-o json`/`| tee`/`| xxd`/`# nofilter` 直接放行。**never-worse 守门**：任一阶段 bytesOut + margin ≥ bytesIn 即回吐原文（margin 默认 0，env 可调）。
- **B 工具结果预算**：仅清 inline 不清落盘（bash.ts:815-818：输出溢出到 truncation file 即跳过清理，磁盘归档保持原始字节；TUI 预览 `metadata.output` 同样不动）；截断时头尾保留 + 中间以 `Math.ceil(bytes/4)` 估算 token 数提示（bash.ts:853-857，opencode 继承）。另有继承自 opencode 的 `session/prune.ts` 软裁剪：`SOFT_TRIM_THRESHOLD=4096` 保留头 1536 + 尾 1536。
- **C 工具面/提示面缩减**：未发现 MiMo 专属（无 deferred tools / MCP 渐进披露）。继承 opencode 的 prune/checkpoint 体系：`session/prune.ts:43-52` 按窗口大小分档的 checkpoint 触发密度（<25K 关闭；25–200K 4 档@20%；200–500K 9 档@10%；>500K 18 档@5%），`CHECKPOINT_RESERVED=13000` 安全余量，`PRUNE_MINIMUM=20000`/`PRUNE_PROTECT=40000`（skill 工具结果保护）。
- **D 压缩策略**：继承 opencode compaction，但加了 MiMo flag：`session/overflow.ts:90` `usable = effective × MIMOCODE_COMPACTION_TRIGGER_RATIO`（默认 0.9，可 env 覆盖），20K 余量覆盖摘要生成；`pressureLevel` 按 <0.50/…分档。checkpoint.md 重建优先于有损 compaction（密度随窗口分档，见 C）。
- **E 输出预算联动**：未发现。
- **F 图片 token**：未发现。
- **G token 计量**：无专属估算器；截断提示用 chars/4 粗估（继承 opencode）。
- **H 其它**：① **三路分流约束**是设计亮点：清理只作用于送 LLM 的 inline 输出，落盘归档与 TUI 预览保持原始字节（人可 debug、grep）；② 插件式扩展契约 `Shape { match, apply }`，新形状零侵入接入主入口；③ docs/harness/ 还有多语言文档（en/fr/ja/ru）同步维护该规范。
- **本家最独特的 1-2 条**：① **双管线 bash 输出清洗（通用正则层 + 10 形状启发式层）+ never-worse 字节守门**，全仓最有辨识度的工具输出裁剪实现，且每形状带实测减量百分比；② **"仅清 inline、不清落盘、不动 TUI"的三路分流**——省 token 的同时保证人工 debug 与归档完整性。

## 月之暗面 Kimi（MoonshotAI_kimi-code，重点 packages/agent-core-v2/src）

- **A 工具输出裁剪**：有，形状化截断而非内容清洗。`agent/toolResultTruncation/toolResultTruncationService.ts:22` `TOOL_RESULT_MAX_LINE_CHARS=2000`（单行整形 `shapeOutput`）；超限结果保留前 10MB（`DEFAULT_TOOL_RESULT_MAX_RETAINED_CHARS=10_000_000`，`tool/toolContract.ts:9`）落盘并生成 spill 指针。未发现 ANSI/密钥/进度条清洗类管线（与 MiMo 相反）。
- **B 工具结果预算**：有，体系完整。`tool/toolContract.ts:7` `DEFAULT_TOOL_RESULT_MAX_CHARS=50_000`（全局单结果字符上限）→ `toolResultTruncationService.truncateForModel()`：超限时 `shapeOutput` 整形（单行 2000 截断）→ 若整形后仍超限则整个替换为落盘指针（`renderPersistedToolResult`，含 outputPath + preservedChars + totalChars），`spillExempt` 豁免通道；bash 超限自动转后台任务并附 `task_id` + `TaskOutput(task_id=...)` 查询提示（`agent/tools/os/bash/bashTool.ts:350-375`）。
- **C 工具面/提示面缩减**：未发现 deferred tools / MCP 渐进披露。system-reminder 注入走工具结果尾部（见 H 的 repeat breaker），未发现按活跃工具集裁剪系统提示。
- **D 压缩策略**：有。`agent/fullCompaction/strategy.ts:14-26` `DEFAULT_COMPACTION_CONFIG`：`triggerRatio=0.85`、`blockRatio=0.85`、`reservedContextSize=50_000`（预留）、`maxRecentMessages=4` + `maxRecentSizeRatio=0.2`（保留近期消息窗口）、`maxOverflowCompactionAttempts=3`（溢出后压缩重试上限）、`minOverflowReductionRatio=0.05`（压缩无效检测：减量不足 5% 判定失败）；`RuntimeCompactionStrategy` 按模型 `max_input_tokens ?? max_context_tokens` 自适应；`checkAfterStep` 在 trigger≠block 时逐步检查。
- **E 输出预算联动**：未发现（maxTokens 钳制/thinking 反压未见）。
- **F 图片 token**：有，压缩阶梯完整。`agent/media/image-compress.ts:20,50-52`：`MAX_IMAGE_EDGE_PX=2000`（最长边上限，可配置覆盖）、`JPEG_QUALITY_STEPS=[80,60,40,20]` 逐级降质、`FALLBACK_EDGES_PX=[2000,1000,768,512,384,256]` 逐级降分辨率兜底；`agent/tools/read-media-file/readMediaFileTool.ts:458-479` 压缩后仍超 inline 限制/读预算则拒绝或转落盘，结果里明示"downsampled 到 WxH + 原坐标换算说明"。
- **G token 计量**：有，CJK-aware 估算器。`llm-adapter/contract/tokens.ts:5-16` `estimateTokens()`：ASCII 计数 /4 + **非 ASCII 每字符记 1 token**（对中文准确的保守估计，优于纯 chars/4）；策略 `measured+estimated | measured | estimated`（`agent/tokenCounting/tokenCounting.ts:4`），实测 usage 与估算 rebase 结合（`sessionTokenCountingService.rebase()`），`requestSize()` 把 systemPrompt + tools + messages 全部计入请求规模。
- **H 其它**：**toolDedupe repeat breaker**（`agent/toolDedupe/toolDedupeService.ts:57-60`）：同一 `toolName+canonicalArgs`（sha256 key）重复调用的阶梯干预——第 3 次起附 system-reminder 要求"先写一句期望新信息再行动"（`REPEAT_REMINDER_1_START=3`）、第 5 次升级为三选一（证伪检验/要输入/直接结论）（`=5`）、第 8 次要求纯文本最终回复（`=8`）、**第 12 次强制 stopTurn**（`REPEAT_FORCE_STOP_STREAK=12`，`REPEAT_BREAKER_STOP_REASON`）；同一步内完全相同的并发调用直接返回空占位结果（`DEDUPE_PLACEHOLDER_RESULT = { output: "" }`，不执行也不回传结果体）；跨步重复标记 `same_step`/`cross_step` 两种 dupType 进遥测。另有 `contextMemory/vacuousContent.ts`：空文本/空 think 内容部分在投影时识别为 vacuous 折叠掉。
- **本家最独特的 1-2 条**：① **repeat breaker 阶梯（3/5/8/12）**：不是省结果 token，而是掐灭无效重复调用的整条请求链（每次重复 = 一次完整 LLM 往返），同 key 同步去重直接返回空占位；② **ASCII/4 + 非ASCII=1 的 CJK 双速估算器** + measured/estimated 双轨 rebase，七家中唯一在估算层面区分中英文字符成本。

## DeepSeek（deepseek-ai_deepseek-harness，重点 packages/llm、packages/compaction）

- **A 工具输出裁剪**：有，确定性头/中/尾剪裁。`compaction/compaction-tool-result-pruner/src/config.ts:10-14`：`thresholdChars=8192`、`headChars=4096`、`tailChars=1024`，中间替换为固定标记 `PRUNE_MARKER = "\n\n[... tool result middle pruned ...]\n\n"`；按 **Unicode 码点**切（`codePointLength`，不劈代理对），非文本 block 原样保留顺序；配置校验强制 head+marker+tail ≤ threshold、剪后必须更小。无 ANSI/密钥清洗（与 MiMo 不同路线）。
- **B 工具结果预算**：有，且带可回放账目。`compaction-tool-result-pruner/src/index.ts:125-175` `pruneSession()`：对当前 surface 全部 `tool/result` 节点逐个检查，超限即以 `surfaceOp: replace` 生成替换节点，并在替换前同步追加 `compaction/prune` **shadow-price 事件**（`shadowedTokenCount = tokenMeter.estimateMessage(original)`），纯消费者无需逐节点状态即可扣减；配置可整体校验 + deepFreeze。另有独立 `spill/` 包族（spill、spill-local、spill-policy）负责落盘。
- **C 工具面/提示面缩减**：未发现（llm/compaction 两包内无 deferred tools、无 MCP 渐进披露、无系统提示动态组装）。
- **D 压缩策略**：有，家族化配置。`compaction/compaction-basic/src/config.ts:20-23,75-80`：`thresholdRatio=0.8`（请求压力比）、`headroomTokens=65536`（且缺省兼作摘要请求 maxTokens）、`retainRatio=0.16`（原文保留尾部比例）+ `retainTokens` 绝对值可选；支持 `modelPolicies` 按 provider+model 精确路由覆盖（`POLICY_CONFIG_KEYS` 九键），`compactionRetries`/`maxOverflowRetries`；摘要可路由到**不同的 summarizationProvider/summarizationModel**（便宜模型干摘要活）。
- **E 输出预算联动**：弱联动：摘要请求 `maxTokens ?? headroomTokens`（config.ts:76）；未发现 thinking 反压/动态钳制。
- **F 图片 token**：**有，image-offload 专属机制**。`compaction/compaction-image-offload/`：监听 `agent/request-error`，当图像路由报 `IMAGE_OFFLOAD_REQUIRED`（DeepSeek 适配器的 file-mode/inline-fallback 预算、pi-ai 的 base64 上限，各自回报需卸载数量）时，按模型请求序走 surface、跳过 assistant 节点与已标记图，把最旧超限图片**永久替换为"附件名 + 只读路径"的文本占位**后重试——重试不耗 provider retry 预算、不记 llm/retry；决定落在 `image/offload` 会话事件（seq + 深度优先 image index），跨路由切换/断点续跑/重放稳定；代价明确：provider 缓存复用在第一条被改消息处截断。
- **G token 计量**：有，独立 `llm/token-meter` 包（"决定何时压缩的计量与 LLM 家族服务分离"）。`estimate.ts:12-17`：`CHARS_PER_TOKEN=4`、`BLOCK_OVERHEAD=4`（每 block JSON 框架开销）、`ROLE_OVERHEAD=4`（每消息 role 字段开销）；text/reasoning/tool-call 各臂分别计价，未知 block 与图片引用按 **JSON.stringify 结构价**兜底；系统提示按纯文本密度计（无 block 开销）；`estimateToolsTokens` 把工具声明计入；replay-aware：锚定最近一次成功调用的 provider usage（`usageTokens` 求和不重复计 reasoning），`route-pricing.ts` 按路由重定价，压测判断 = 固定启发式锚点 + surface 增量。
- **H 其它**：① **capability-seam 架构**把压缩族拆成 5 个可独立挂载的包（compaction 契约 / basic 自动 / pruner / image-offload / command-compact），`dsh` 基座默认启用，可按组合调参；② shadow-price 协议让"剪了多少 token"成为会话日志的一等公民（审计/回放可精确扣减）。
- **本家最独特的 1-2 条**：① **image-offload**：以路由图片预算错误驱动的永久占位替换 + 零重试成本 + 重放稳定的七家独有图片瘦身机制；② **tool-result-pruner 的 shadow-price 事件协议**：剪裁不是静默改写，而是带 token 计量事件的可审计替换，回放时能精确恢复与扣账。

## MiniMax（MiniMax-AI_minimax-code，重点 packages/local-runtime、agent-tools、agent-core）

- **A 工具输出裁剪**：未发现（三个重点包内无 bash/命令输出清洗、形状剪裁管线）。
- **B 工具结果预算**：未发现专属（未见独立 tool-result-pruner / 落盘指针体系）。
- **C 工具面/提示面缩减**：**有，MCP 渐进披露（mcp-disclosure）**。`agent-tools/src/mcp-disclosure/plan.ts:32-66` + `local-runtime-v2/.../local-turn-tool-catalog.ts:480-498`：默认开启（`MAVIS_MCP_TOOL_SEARCH_ENABLED`，default true）；当配置的 MCP 工具 token 估算（`JSON.stringify({name,description,schema}).length / 4`）超过 **`thresholdPct(默认 0.15) × model.contextWindow`** 且候选数 ≥ `minDeferCount(默认 1)` 时进入 deferred 模式——内联只留原生工具，MCP 工具全部换成两个代理工具 **`tool_search`（topKDefault/topKMax 检索，索引由 buildOrReuseIndex 建，maxSchemaTextLen 截 schema）+ `mcp_invoke`（按名调用；三期核对：单下划线，`mcp-invoke.ts:83`）**；`modelWhitelist` 支持 `provider/id` glob（含 `*`）；contextWindow 无效/未命中白名单/低于阈值一律回退全内联（fail-open）。
- **D 压缩策略**：有。`agent-modules/context-manager/src/settings.ts:3-11,20-36`：`reserveTokens=16384`、`keepRecentTokens=20000`、`minMessagesToCompact=4`、`safetyMarginTokens=2048`、`contextWindowFallback=128000`；触发线 `contextWindow − max(reserve, perTurnMaxTokens + safety)`，**MiniMax-M3 的 512K/1M 模式走产品定死的 90% 线**（大窗口不按预留公式过早压缩）；`provider-budget.ts` 另有 proactiveReserve = min(reserve×2, window/4)。
- **E 输出预算联动**：**有，dynamic-max-tokens（最完整的一家）**。`local-runtime/src/runtime/dynamic-max-tokens.ts`：头部注释点名两大问题——静态大 max_tokens 会让 `input+max ≤ window` 直接 400、且按全额 maxTokens 预留会让压缩在 **200k 窗口的 ~35%** 就触发浪费大半窗口。方案：`effectiveMax = clamp(contextWindow − estimatedContext − margin, floor, configured)`，`DYNAMIC_MAX_TOKENS_FLOOR=16384`（低于此宁可压缩也不缩输出）、`SAFETY_MARGIN=2048`、`MIN_OUTPUT_TOKENS=1024`、估算失败退 provider 最小正整数（1）；只缩不涨；优先用 **remote `count_tokens` 快照**（beforeLlmCall 阶段计数、快照一次性消费防陈旧），无快照用本地估算兜底；**thinking 预算先扣再钳**——与 pi-ai `adjustMaxTokensForThinking` 的加回逻辑对齐（`PI_DEFAULT_THINKING_BUDGETS`: minimal 1024/low 2048/medium 8192/high 16384），adaptive thinking 不扣。仅 Messages 兼容 API 启用。
- **F 图片 token**：**三期核对勘误：实有完整管线**——`packages/local-runtime/src/utils/model-image-preprocess.ts`（275 行）：像素预算 `MODEL_IMAGE_MAX_EDGE_PX=1920` / `MODEL_IMAGE_MAX_BYTES=5MB`（:8-12）+ **JPEG 质量阶梯 `JPEG_QUALITIES=[82,72,62,52]`**（逐档尝试、超限继续缩边，`MIN_IMAGE_EDGE_PX=512` 兜底，:185-200）+ 双线性缩放 + alpha 白底压平 + PNG→JPEG；消费方 user-media.ts / cu-image-injector.ts / thumbnail.ts。纯 JS（jpeg-js/pngjs）实现，与 kimi 的 [80,60,40,20] 阶梯同族。
- **G token 计量**：有。`local-runtime/src/context/token-estimator.ts`：`estimateSystemPromptAndToolTokens()` 注释明说"消息估算单独看会系统性低估——大系统提示 + MCP 重工具注册轻松多出几万 token"，把系统提示与**每个工具的 name+description+schema JSON** 合成合成消息统一估算，触发门必须含这部分；另有 `remote-token-counter` / `count-tokens-body` / `context-usage-calibration`（实测校准）体系。
- **H 其它**：**runaway-guard**（`agent-modules/runaway-guard/`）：六类失控信号——`exact_action_repeat` / `exact_result_repeat` / `same_error_family` / **`abab_action_cycle`（A-B 交替循环）** / `polling_repeat` / `unchanged_progress_repeat`，工具策略分 detect/polling/exempt，HMAC 指纹 + 宿主捕获的可信执行溯源（truncated）——与 kimi repeat breaker 同族但分类更细（还抓轮询与无进展循环）。
- **本家最独特的 1-2 条**：① **mcp-disclosure**：以 `15% × contextWindow` 为阈值的 MCP 工具整体延迟披露，换成 tool_search + mcp_invoke 两个代理工具，白名单按模型 glob 控制；② **dynamic maxTokens 钳制**：七家中唯一把"输出预留与压缩触发的联动浪费"（35% 窗口洞察）写成显式机制，含 remote count_tokens 快照与 thinking 预算先扣再钳。

## 阿里 Qwen（QwenLM_qwen-code，Gemini CLI fork，重点 packages/core/src）

- **A 工具输出裁剪**：未发现 bash 输出清洗/形状剪裁管线（fork 自 Gemini CLI，未见 MiMo 式过滤）。
- **B 工具结果预算**：**有，microcompaction（旧工具结果清理，966 行）**。`services/microcompaction/microcompact.ts`：**体积+时间双触发**——体积：全部工具结果字符总量 > `DEFAULT_TOOL_RESULTS_TOTAL_CHARS_THRESHOLD = 500_000`（`config/clearContextDefaults.ts:7`）；时间：距上次 API 完成 > `toolResultsThresholdMinutes`（默认 60 分钟，-1 禁用，`evaluateTimeBasedTrigger` microcompact.ts:200-215）。清到**低水位 threshold/2** 而非贴线（:551 注释：贴线会让每轮都再触发、每请求多改写一个旧结果 → **打断 provider prompt-cache 前缀**）；`keepRecent` 保护最近 N 个结果；read_file 结果（可能是缓存命中占位）与 edit 结果（本就只有占位）特殊处理；零字符 ref（错误/已清/空输出）不参与清理；占位符 `[Old tool result content cleared]` / `[Old inline media cleared: mime]` 有**防伪正则**（防止用户文本冒充已清占位逃过计量，issue #4239 悬空占位防护）。
- **C 工具面/提示面缩减**：未发现 deferred tools / MCP 渐进披露。
- **D 压缩策略**：有，三层阈值体系（`services/chatCompressionService.ts:109-133,210-235`）：`DEFAULT_PCT=0.85`、`SUMMARY_RESERVE=20_000`（= COMPACT_MAX_OUTPUT_TOKENS，为摘要输出预留）、`AUTOCOMPACT_BUFFER=13_000`、`WARN_BUFFER=20_000`、`HARD_BUFFER=3_000`；auto = **min(0.85×window, (window−20000)−13000)**（比例项与绝对上限取小，小窗口退化为比例值）；微压缩（B 条）在宏压缩之下持续瘦身。PreCompact hook 的 `additionalContext` 有硬 cap（side-query 无输入截断重试，防止 hook 载荷膨胀引发 PTL）。
- **E 输出预算联动**：弱——压缩输出上限 COMPACT_MAX_OUTPUT_TOKENS=20_000 固定；未发现按窗口余量动态钳制。
- **F 图片 token**：有，占位符路线。`services/compactionInputSlimming.ts`：摘要 side-query 前把 `inlineData`/`fileData` 换成 `[image: mime]`/`[document: mime]` 短占位（摘要模型本来读不了 base64，运字节纯膨胀载荷）；mime 经 `sanitizeMimeForPlaceholder` 清 `\r\n\t[]` + 128 截断（**防 MCP 恶意 server 用 mime 构造提示注入**）；`DEFAULT_IMAGE_TOKEN_ESTIMATE=1600`/图；微压缩同样把旧 inline media 清成占位（B 条）。
- **G token 计量**：有。`TOKEN_TO_CHAR_RATIO = 4`（slimming 导出、`tokenEstimation.ts` 的 `CHARS_PER_TOKEN` 程序化引用同一常量防漂移）；**CJK-aware 摘要估算**（chatCompressionService.ts:135-166）：`CJK_CHAR_TOKEN_MULTIPLIER = 1.5`——摘要含 CJK 时按 非CJK/4 + CJK×1.5 估，并与通用估算取 max；显示层保留预算 `utils/toolResultDisplayCompaction.ts:26-30`（MAX_RETAINED_TOOL_RESULT_DISPLAY_CHARS=32000、AGENT_FIELD=8000、FILE_DIFF=50000、FILE_CONTENT=16000、ANSI 行数 200，按 surrogate-pair 安全切片）。
- **H 其它**：① **微压缩低水位设计明确以"不打断 prompt-cache 前缀"为约束**——七家中唯一把缓存前缀稳定性写进清理算法注释的；② 占位符伪造/悬空防护（正则由常量派生、生产者消费者不漂移）。
- **本家最独特的 1-2 条**：① **microcompaction 体积+时间双触发的旧工具结果清理**（500K chars / 60min 空闲，清到半水位且显式保护 prompt-cache 前缀）；② **compactionInputSlimming 的注入安全占位符**（mime 消毒 + 1600 token/图估算 + CJK×1.5 摘要计量）。

## 智谱 ZCode（zai-org_ZCode，重点 packages/model-option-map、config/provider/zcode-builtin.json）

- **A 工具输出裁剪**：未发现（该仓库为客户端/配置层，重点包内无 bash 输出清洗）。
- **B 工具结果预算**：未发现（重点包内无 tool-result-pruner / microcompaction；服务层仅见 `/compact` 命令透传，`packages/services/src/zcode-agent/zcodeTaskServiceAdapter.ts:2060` v4 CAS compact 协议）。
- **C 工具面/提示面缩减**：未发现（无 deferred tools / MCP 渐进披露）。模型属性面有 `supportsMidConversationSystem` 开关（zcode-builtin.json 各模型 properties），控制系统消息能否插入会话中部，属提示面形状约束而非缩减。
- **D 压缩策略**：仓内未见专属阈值体系（压缩执行在引擎侧，本仓库只承载 `/compact` 命令协议）；未发现。
- **E 输出预算联动**：**有，模型选项规约（optionSpecs）体系**。`config/provider/zcode-builtin.json`（schemaVersion 1，revision 30）按 modelMatch 正则给每个 GLM 模型配 `optionSpecs.maxOutputTokens.max` 上限：GLM-5.x 旗舰 128000–131072、**GLM-5.3-Flash 128000**（三期核对修正：modelMatch 大小写不敏感（`model-config.ts:404-408`），大写模板 ID 命中小写 `.*glm-5\.3` 规则；Turbo/highspeed 才是 64000）、glm-4.5/4.5-air 98304、glm-4.6v 视觉系 32768、**glm-4-flash-250414 = 16384**（1024 属 glm-4v-flash）、**codegeex-4 = 32768**（4096 属 charglm-4/emohaa）；同时声明 `contextWindow`（GLM-5.2/5.3 1000000、多数 200000、4.5 系 131072）与 `reasoningLevel` 枚举（disabled/enabled 或 low/high/max）。`packages/model-option-map/src/option-maps.ts:18-32`：Model 创建时把 `reasoningLevel`/`maxOutputTokens` 的 **map（受限 CEL DSL）编译一次**，每请求只把当轮冻结的选项值 evaluate 成 JSON merge patch 套到请求体上（tokenizer/parser/compiler/evaluator 四件套，`evaluateRestrictedCel`）；`packages/provider/src/config/model-config.ts:80-99` `LimitOptionSpecConfig { max, map }` 支持 overlay 叠加（用户配置覆盖内置）。
- **F 图片 token**：未发现（json 中仅 `inputFormat.supportsImage/supportsVideo` 能力位）。
- **G token 计量**：未发现（重点包内无估算器）。
- **H 其它**：① **受限 CEL 选项映射 DSL**：把"用户选的 reasoningLevel/maxOutputTokens"到"请求体 patch"的翻译做成可配置、可编译校验的小语言（zod schema 在编译期验证 map 可编译，`packages/shared/src/model-config.ts:5-17`）；② per-model `builtinModelIds` + templateRules（zai-api coding plan / zai-standard-api 双模板）绑定计费通道。
- **本家最独特的 1-2 条**：① **zcode-builtin.json 按模型正则分级的 maxOutputTokens 上限表 + 受限 CEL map DSL**——输出预算控制不在请求时代码里硬编码，而是数据驱动（revision 化的内置配置 + overlay），七家中唯一把"每模型输出上限/推理档位"做成可版本化发布物的；② 其余维度（裁剪/预算/压缩/计量）在本仓库均未发现——它是七家中唯一"token 优化主要落在模型能力配置层"而非 harness 运行时的仓库。

## 七家横向速览表

| 厂商 | A 工具输出裁剪 | B 工具结果预算 | C 工具面/提示面缩减 | D 压缩策略 | E 输出预算联动 | F 图片 token | G token 计量 | H 其它 |
|---|---|---|---|---|---|---|---|---|
| 阶跃 Step | 常规截断（2000行/50KB，头/尾保留） | 弱（仅截断+落盘） | **有：deferredToolsMode "kimi" + 按活跃工具集逐段门控系统提示** | 有：reserve 24576 / keep 20000 / 摘要顶 32K + turn-prefix 摘要 + 文件账本 | 有：thinking ≤ ceiling−answer 反压 | 无 | 无（用 provider usage） | session 亲和 + prompt_cache 24h；git 环境 5s 缓存 |
| 小米 MiMo | **有（最强）：通用 4 层管线 + 10 形状启发式，never-worse 守门，-53%~-95%** | 仅清 inline 不清落盘；软裁剪 4096/1536+1536 | 无专属（继承 opencode checkpoint 密度分档） | 继承 + `MIMOCODE_COMPACTION_TRIGGER_RATIO=0.9` | 无 | 无 | chars/4（继承） | 三路分流（inline/落盘/TUI）；Shape 插件契约 |
| Kimi | 弱（单行 2000 整形） | **有：全局 50K 字符上限 + spill 落盘指针 + TaskOutput 引导** | 无 | 有：trigger 0.85 / reserve 50K / 保留 4 条或 20% / 压缩无效检测 5% | 无 | **有：2000px 边 + JPEG [80,60,40,20] + 边长 6 级阶梯** | **有：ASCII/4 + 非ASCII=1 的 CJK 估算** + measured/estimated 双轨 | **repeat breaker 3/5/8/12 阶梯 + 同步去重空占位** |
| DeepSeek | **有：确定性头/中/尾剪裁（8192/4096/1024 + 标记）** | 有：prune + shadow-price 事件可回放扣账 | 无 | 有：threshold 0.8 / headroom 65536 / retain 0.16 + 按模型路由覆盖 + 摘要可换便宜模型 | 弱（摘要 maxTokens=headroom） | **有：image-offload 路由预算驱动永久占位替换** | 有：token-meter（4 chars/token + block/role 开销 + 工具声明计入 + 路由计价） | capability-seam 五包拆分 |
| MiniMax | 无 | 无 | **有：MCP 渐进披露（15%×窗口阈值 → tool_search+mcp_invoke）** | 有：reserve 16384 / keep 20000；**M3 512K/1M 走 90% 线** | **有（最强）：dynamic maxTokens 钳制（floor 16K）+ remote count_tokens + thinking 先扣** | **有：1920px+5MB+JPEG 质量阶梯[82,72,62,52]+512px 下限（三期核对补）** | 有：系统提示+工具声明合成估算 + 实测校准 | runaway-guard 六类信号（含 abab 循环/轮询） |
| Qwen | 无 | **有：microcompaction 体积 500K chars + 时间 60min 双触发，清到半水位护缓存前缀** | 无 | 有：auto=min(0.85×win, win−33K) + warn/hard 缓冲 + 摘要预留 20K | 弱（固定 20K） | 有：摘要前媒体换 `[image: mime]` 占位（mime 消毒防注入）+ 1600/图 | 有：TOKEN_TO_CHAR_RATIO=4 + **CJK×1.5** 摘要估算 | 占位符防伪正则；显示层保留预算 |
| ZCode | 无 | 无（仅 /compact 协议） | 无 | 无 | **有：per-model optionSpecs.maxOutputTokens.max 上限表（1K~131072 分级）** | 无（仅能力位） | 无 | 受限 CEL map DSL 数据驱动选项映射（revision 化内置配置） |

**一句话总结**：MiMo 重「输出清洗」、Kimi 重「掐无效调用 + CJK 计量 + 图片压缩」、DeepSeek 重「可审计剪裁 + 图片卸载」、MiniMax 重「工具面披露 + 动态输出预算」、Qwen 重「微压缩 + 缓存前缀保护」、Step 重「工具延迟声明 + 提示逐段门控 + 缓存复用」、ZCode 重「模型配置层的输出上限规约」——七家几乎在 A–H 八个维度上各占一格，互不重叠。


---

# 专项调研二：每家专属的缓存命中优化方案（2026-09-22 二期）

> **定位**：分家专项，**暂不并入通用方案**（用户 2026-09-22 指示）。每家独立成节，证据格式同正文。
> 调研方法：本地 clone 仓库 grep/Read 核实；挖不到的维度明确标注「未发现」。

# 每家专属缓存命中优化方案调研

## 阶跃 Step（stepfun）

- **A 前缀稳定性**：未发现显式的"动态内容下沉 message 层"纪律（agent-core 无 system-reminder 包装逻辑）；systemPrompt 在 `packages/agent-core/src/agent.ts:75` 作为一次性 state（`initialState?.systemPrompt ?? ""`）初始化后不再拼接动态内容。
- **B system prompt 更新策略**：未发现 in-history 追加式更新机制，systemPrompt 为固定 state 字段。
- **C cache_control 标记**：`packages/providers/src/api/openai-completions.ts:1049-1066` — compat `cacheControlFormat === "anthropic"` 时打三锚点：system prompt、最后一个 tool、最后一条对话消息；`cacheRetention === "none"` 时整体不打。TTL 由 `cacheRetention === "long" && supportsLongCacheRetention` 决定（anthropic 格式给 `{type:"ephemeral", ttl:"1h"}`，否则裸 ephemeral）。OpenAI 格式侧 `:799-804`：`prompt_cache_key` 仅当 baseUrl 含 `api.openai.com` 或 long retention + supportsLongCacheRetention 才发，值经 `openai-prompt-cache.ts` 的 `clampOpenAIPromptCacheKey` 截到 64 字符；`prompt_cache_retention: "24h"` 同样仅 long+支持时发。
- **D 装配指纹**：未发现 system+tools 哈希指纹（`shortHash` 仅用于生成 call id 后缀，`:1188`）。
- **E header 复用**：`:337` `cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId` — 副调用主动摘掉会话头，主对话一直继承同一 sessionId。
- **F 压缩×缓存**：`packages/coding-agent/src/core/compaction/compaction.ts:628` — `completeSummarization` 是所有摘要副调用的 chokepoint，统一 `cacheRetention: "none"`（注释："Avoid cache writes for one-off summaries"），且 sessionId 缺省时 fallback `uuidv7()` 新路由 ID；branch summary 一律拿新 ID。
- **G 会话亲和**：`:755-763` — compat `sendSessionAffinityHeaders` 开启时按 `sessionAffinityFormat` 发头：`openrouter` → `x-session-id`；`openai` → **三头**（`session_id` + `x-client-request-id` + `x-session-affinity`）；第三种格式 `openai-nosession` → 双头（三期核对修正：实为三值枚举 openai/openai-nosession/openrouter，`types.ts:531`）。`:1652` 自动探测：isOpenRouter ? "openrouter" : "openai"。
- **H 命中统计**：`:1504-1511` — cacheRead 统一从 `prompt_tokens_details.cached_tokens ?? prompt_cache_hit_tokens (DeepSeek) ?? cached_tokens (Kimi)` 三种字段名归一，cacheWrite 取 `cache_write_tokens`；cost 结构带 cacheRead/cacheWrite 两个计费位。
- **I 长缓存保留**：有 — `supportsLongCacheRetention` compat 位驱动两种格式（openai `prompt_cache_retention:"24h"` / anthropic `ttl:"1h"`）；副调用用 `cacheRetention:"none"` 关闭。
- **J 其它**：turn-prefix summarization（`agent-core/src/harness/compaction/compaction.ts:710`）——超大单 turn 只摘要前缀、后缀逐字保留，控制压缩失效边界。有 `openai-completions-prompt-cache.test.ts`、`cache-retention.test.ts`、`openai-completions-cache-control-format.test.ts` 三个专项测试锁行为。
- **本家最独特的 1-2 条**：① 摘要副调用统一 chokepoint 强制 `cacheRetention:"none"` + 新 uuid，防止 one-off 摘要污染/驱逐会话缓存路由；② sessionAffinityHeaders 三格式自适应（openrouter/openai 三头/openai-nosession 双头）+ prompt_cache_key 64 字符 clamp。

## 小米 MiMo（XiaomiMiMo_MiMo-Code，opencode fork）

- **A 前缀稳定性**：`docs/harness/Agent Multi-Skill Workflow Orchestration Design.md:35,82` — 明确以 prefix cache 命中率做架构论据：多 skill Reminder 作为 system-injected 消息**附在 user message 之后**（对齐 Anthropic long_conversation_reminder 模式），"前缀保持稳定，动态内容全部下沉到 message 层"；且条件触发（仅 /skill 引用 ≥2 的 turn 注入，其它 turn 零感知）。
- **B system prompt 更新策略**：未发现 in-history 机制（设计上直接放弃改写 system prompt——"破坏 prefix cache、遵循率低"）。
- **C cache_control 标记**：`packages/opencode/src/provider/transform.ts:514-547` `cacheMarkerOptions` 是按 SDK 命名空间的单一事实源（anthropic/openrouter 带 ttl、bedrock `cachePoint`、openaiCompatible/copilot/alibaba 各自形状）；`applyCaching`（:558-597）注释是全仓最详尽的缓存策略文档——最长公共前缀 + Anthropic ~20 block 回看窗口；放 **3 个锚点**（Anthropic 上限 4）：最后一条 system + 最后**两条**消息。尾部的 "rolling double buffer"：`[-2]` 供下轮回看 READ 命中、`[-1]` 是本轮 WRITE；双锚防 tool-call 重试/用户删最后一条/>20 block 的 turn 把唯一尾锚带走导致整段历史重算。刻意**不**做漂移中点或固定 before-last-user 下标。`supportsCacheMarkers`（:268）按 `model.api.npm` SDK 包判断而非模型名匹配（防 Claude 挂 OpenAI 兼容代理时 marker 被静默丢弃，引用 upstream opencode#26786）。
- **D 装配指纹**：未发现。
- **E header 复用**：`llm-server/completions.ts:163-165` — llm-server 侧用合成 per-request id 顶替 session，让按它索引 prompt cache 的 provider（Azure）把缓存 scope 到单请求，防跨 caller 泄露共享。
- **F 压缩×缓存**：未发现摘要副调用的前缀重放/缓存关闭策略。
- **G 会话亲和**：`provider/transform.ts:1780-1796` — 自家 opencode 网关发 `promptCacheKey=sessionID`（并 include `reasoning.encrypted_content`）；venice `promptCacheKey`、openrouter `prompt_cache_key`、ai-sdk-gateway `caching:"auto"`；`plugin/codex.ts:588` openai 走 codex 兼容头 `headers.session_id`（"Match codex cli"）。
- **H 命中统计**：`llm-server/protocol.ts:342` 透传 `prompt_tokens_details.cached_tokens`；`config/provider.ts:29` cost 模型带 `cache_read` 计费位。
- **I 长缓存保留**：有 — `config/provider.ts:56` `cachePromptTTL: "5m"|"1h"`，仅 Anthropic/OpenRouter SDK 透传 `ttl:"1h"`，其余忽略。
- **J 其它**：`plugin/codex.ts:376` Codex 订阅模型计费整体置零（cache read/write 也为 0）。代码注释引用 `docs/cache-policy.md` 但该文件实际不存在。
- **本家最独特的 1-2 条**：① 尾部"滚动双缓冲"双锚设计（[-2]读/[-1]写）+ 对回看窗口失效场景（重试、删消息、tool spam）的显式防护论证；② 以 prefix cache 命中率为第一论据的多 skill Reminder 注入位置决策（user message 后、条件触发、零改 system prompt）。

## 月之暗面 Kimi（MoonshotAI_kimi-code，重点 agent-core-v2）

- **A 前缀稳定性**：`features/reminder/systemReminder.ts:6` `wrapSystemReminder` 用 `<system-reminder>` 标签包裹；`features/reminder/reminderService.ts:66,135` Reminder 以 `role:'user'` 的 **injection 消息**追加到 context memory（origin.kind='injection'），不动 system prompt。tool 去重提示也走同一包装（`agent/toolDedupe/toolDedupeService.ts:21`）。
- **B system prompt 更新策略**：未发现 in-history 更新机制。
- **C cache_control 标记**：`human/llm/requester/bases/anthropic/format.ts:238-246` — Anthropic 侧三锚点：system prompt 整块、最后一个 tool、最后一条消息的最后一个可缓存 block（`injectCacheControlOnLastBlock`，:53-63，带 CACHEABLE_TYPES 白名单且 tool_result-only 消息不锚）；仅裸 ephemeral（contract.ts 无 ttl 形状）。OpenAI 侧走 body 参数而非 cache_control（见 G）。
- **D 装配指纹**：未发现 system+tools 哈希指纹。
- **E header 复用**：未发现显式 header 继承规则；cacheKey 经 `resolveRequestParams`（`agent/profile/profileService.ts:471`）恒为 `sessionContext.sessionId`。
- **F 压缩×缓存**：未发现摘要副调用的前缀重放或缓存关闭策略（有 `compactionHandoff.ts` / compaction-summary-prefix 模板，但无缓存交互逻辑）。
- **G 会话亲和**：`human/llm/requester/bases/openai/trait.ts:16` 定义 **`encodeCacheKey?` trait 钩子**——各模型 trait 可自定义缓存键编码；默认 `format.ts:61` / openai-responses `format.ts:328` 都是 `prompt_cache_key = cacheKey`（= sessionId）；Anthropic 侧把 cacheKey 塞进 `metadata.user_id`（format.ts:244）。有专项测试 `human/test/llm/cache-key.test.ts`（含自定义 trait 编码用例）。
- **H 命中统计**：`human/llm/usage.ts:4-5` 统一 TokenUsage 字段 `inputCacheRead`/`inputCacheCreation`；`openai/format.ts:133` 归一 `usage.cached_tokens ?? prompt_tokens_details?.cached_tokens`；最独特的是 `agent/usage/cacheProbeService.ts` — **fork 会话的第一条 turn 用量自动打 `prompt_cache_probe` 遥测事件**（记录 input_cache_read/creation），量化"fork 后前缀缓存继承率"。
- **I 长缓存保留**：未发现 supportsLongCacheRetention / cacheRetention 概念。
- **J 其它**：`agent/media/mediaResolverService.ts:262` 图片上传结果按 `fileId+provider+protocol+baseUrl+accountHash` 记忆化并持久化缓存（避免重复上传扰动）。compaction 用 markdown 模板（compaction-summary-prefix.md）生成稳定摘要前缀。
- **本家最独特的 1-2 条**：① `encodeCacheKey` trait 钩子——把"缓存键如何编码进请求"做成每模型可覆写的扩展点（而不只是 header/参数二选一）；② cacheProbeService：fork 会话首 turn 自动遥测 cache read，把"fork 能否吃到母会话前缀缓存"变成可观测指标。

## DeepSeek（deepseek-ai_deepseek-harness）

- **A 前缀稳定性**：runtime context（OS/工具等动态内容）不进 system prompt，由 `packages/core/agent-loop/src/runtime-context.ts` 的 `RuntimeContextProjection` 以 user message 快照形式落 surface，仅在内容变化时替换（"Create an uncommitted snapshot only when the retained value differs"）。
- **B system prompt 更新策略**：**全仓最核心的专属设计**。`packages/llm/llm/src/types.ts:390-397` 声明 `SystemPromptUpdate = 'in-history'`（"model reads the latest system message at any position… a changed prompt can follow the cached history instead of rewriting message 0"）；实现于 `packages/core/agent-loop/src/runtime-context.ts:88` `SystemPromptProjection.project()`：continuing series 且非空 prompt 变化时走 `surfaceOp:'append'` **追加**新 system 节点（缓存历史保持逐字节复用），只有 incapable 路由/新 series/清空 prompt 才归一化首节点并排空后续节点（原地 replace）。`agent.ts:392-400` 以 `inHistory + startsSeries + toolsChanged` 三要素决策。
- **C cache_control 标记**：经 pi-ai 兼容层（`packages/llm/llm-pi-ai/src/catalog.ts` 的 COMPAT_GATE 声明 `cacheControlFormat`/`supportsLongCacheRetention`/`supportsCacheControlOnTools` 为 'offer' 级 compat 位，带防漂移 drift gate）；profile 级 `cacheRetention: 'none'|'short'|'long'`（config.ts:340）经 adapter.ts:125 透传。
- **D 装配指纹**：变体——`agent.ts:591-611` `canonicalHeader({config, adapterDefaults, tools})` 构成请求头指纹，仅在 `!headerEquals(baseline, header)` 时追加 `request/header` 事件（reason: initial/resume/change/series），请求体 = `...header.config + messages`。
- **E header 复用**：同上——**只有 config/adapterDefaults/tools 变化才重写 header；消息/prompt 变化不触发**；新 request series（surface generation 变化）以 reason:'series' 重新标记。
- **F 压缩×缓存**：`packages/compaction/compaction-basic/src/summarizer.ts:71-76,112` — 摘要副调用**逐字节重放**上一个路由请求的 system prompt、tools schema、前导消息，仅把压缩指令作为最后一条 user message 追加（注释："Reproducing the last routed request's system prompt, tools, and leading messages verbatim lets the auxiliary call reuse the provider's warm prefix cache"）；压缩替换本身"invalidates reuse from the first shadowed history token"（三期核对修正出处：该引文实出自 `packages/core/agent-loop/README.md:176`，等价表述在 `packages/compaction/compaction-basic/README.md:179-181`；原文误标 compaction/README.md:149-152——该文件仅 55 行且无 KV 小节）。llm-deepseek 侧副调用还带 `purpose:'compaction'` → 请求头 `x-deepseek-harness-compact: '1'`（adapter.ts:124）。
- **G 会话亲和**：`packages/llm/llm-deepseek/src/adapter.ts:122` 专属头 `x-deepseek-harness-session-id`（+ `x-deepseek-harness-user-id`）；compat 位 `sendSessionAffinityHeaders`/`sessionAffinityFormat` 在 catalog 中标为 'withhold'（DeepSeek 自有路由不透传通用亲和头）。
- **H 命中统计**：`SummaryResult.usage` 记录 provider-reported usage（含缓存位）；token-meter 包统一计量。未见独立的命中率指标化事件（对照 kimi 的 probe）。
- **I 长缓存保留**：有 — `supportsLongCacheRetention` compat 位（catalog.ts:250 等 'offer'）+ `cacheRetention` 三档 profile 配置。
- **J 其它（文档纪律最重）**：① **每个包 README 的 Model Experience 契约强制含 "#### KV Cache effect" 小节**（`docs/cookbook/adding-a-package.md` + `.agents/notes/implemented/process/2026-07-12-package-model-experience-contract.md`），逐段声明该组件对前缀缓存的影响（agent-loop README:160-176 即 system prompt 的 in-history 分析）；② **图片 stepped high-watermark 策略**（llm-deepseek/README.md:99）：按 byte/count 量子成段移除最老图片前缀 + 占位文本，"avoids rewriting an old request prefix after every new image"；③ compaction-image-offload 包同样有 KV Cache effect 分析（"cache reuse ends at the first changed image"）。
- **本家最独特的 1-2 条**：① `systemPromptUpdate:'in-history'` 投影——中途改 system prompt 不重写 message 0 而是追加在缓存历史之后，且把"何时退化为原地替换"（新 series/无能力路由/清空）形式化成 project() 决策表；② 强制的 "KV Cache effect" README 契约——每个包作者必须回答自己的组件如何影响前缀缓存，是七家中唯一把缓存影响做成文档级 lint 的。

## MiniMax（MiniMax-AI_minimax-code）

- **A 前缀稳定性**：`packages/agent-tools/src/mcp-disclosure/hint.ts:3` MCP disclosure 提示用 `<system-reminder>` 标签注入（消息层）；无专门的缓存论据文档。
- **B system prompt 更新策略**：未发现 in-history 机制。
- **C cache_control 标记**：`packages/local-runtime/src/context/messages-count-tokens-payload.ts:236-247` `getCacheControl` — anthropic-messages 格式：`cacheRetention` 默认取 env `PI_CACHE_RETENTION==='long'?'long':'short'`；'none' 不打标；long + `supportsLongCacheRetention` 才给 `ttl:'1h'`，否则裸 ephemeral；`:211` 仅 `supportsCacheControlOnTools` 时给 tool 定义打 cache_control。compat 默认值带厂商特判（三期核对修正：fireworks 的 `sendSessionAffinityHeaders` **默认开**（`?? !!(isFireworks || isCloudflareAiGateway)`）；默认**关**的是 supportsCacheControlOnTools / supportsLongCacheRetention / supportsEagerToolInputStreaming，`:255-263`）。
- **D 装配指纹**：**有，全七家最系统**。`packages/agent-core/src/pi-turn-runner/assembly-fingerprint.ts` — `fingerprintAssembly()` 对 system prompt 与 tools 接口分别做 sha256 16 位截断指纹；system prompt 保留原始空白（注释："Preserve whitespace exactly: prompt caches observe it even when humans do not"）；tools 保序但对定义内对象 key 做规范化排序（canonicalStringify，防键序噪声）；**消息历史被刻意排除**（"Message history is intentionally excluded so normal loop growth does not look like system/tool assembly churn"）。
- **E header 复用**：指纹按 `(sessionId, provider, model)` 键存进程内 LRU（metrics.ts:331-356），只用于变更检测，不直接决定 header 重写。
- **F 压缩×缓存**：`local-runtime-v2/.../compaction/agent-host-compaction-executor.ts:680-697` 与 `context-compaction.ts:228-243` — 压缩副调用透传同一 turn preparation 的 `systemPrompt`、`tools`、`messages` 与 `cacheRetention`（结构上复用装配前缀），但未见 deepseek 式"逐字节重放 warm prefix"显式注释。
- **G 会话亲和**：`packages/config/src/config.ts:1126` ProviderOptions 有 `setCacheKey?: boolean` 开关（provider 级配置，未发现更深消费点）；compat 位 `sendSessionAffinityHeaders`（fireworks/cloudflare-ai-gateway 默认开）。
- **H 命中统计**：**指标化最完整**。`pi-turn-runner/metrics.ts:972-1004` — 每次请求结算算 `cacheOutcome: 'read'|'no_read'|'telemetry_unknown'`（看 `final.usage.cacheRead>0`），打 `pi_llm_cache_outcome_total` 计数器；`:1000-1004` 把 cacheRead/cacheWrite 分项打 `pi_llm_cache_tokens_total{operation=read|write}`；`:380-392` 装配指纹变化打 `pi_llm_assembly_stability_total{part=system_prompt|tools, result=stable|changed}` + 结构化日志 `pi_llm_assembly_fingerprint_changed`（区分 within_turn/across_turn 作用域）——**把"前缀为什么没命中"归因到 system/tools 漂移的可观测闭环**。
- **I 长缓存保留**：有 — env `PI_CACHE_RETENTION=long` + `supportsLongCacheRetention` compat → `ttl:'1h'`；session-report（agent-extension/src/session-report.ts:38）记录每会话实际 cacheRetention。
- **J 其它**：turn metrics 里还有 lastLLMRequestSettledAtBySession 的 LRU（请求间隔基线）。`withCacheRetention` 包装器（llm.ts:514-522）让 host 配置与 per-turn 指定合并、turn 内优先。
- **本家最独特的 1-2 条**：① assembly-fingerprint + `pi_llm_assembly_stability_total` 指标——用"指纹排除消息历史、保留空白敏感度、规范化键序"三原则把缓存失效归因为 system_prompt 还是 tools 漂移，并区分 turn 内/跨 turn 作用域；② `pi_llm_cache_outcome_total` + `pi_llm_cache_tokens_total{read|write}` 把命中率做成 Prometheus 级一等指标。

## 阿里 Qwen（QwenLM_qwen-code，Gemini CLI fork）

- **A 前缀稳定性**：`packages/core/src/core/anthropicContentGenerator/converter.ts:1058-1110` `buildSystemWithCacheControl` 的 **`staticSystemPrefix` 拆分**——稳定 system 前缀与易变尾段（git status、session-start context 等 client 追加的 volatile tails）拆成两个 text block 各带一个断点：稳定前缀可 `scope:'global'` 跨会话复用；尾段刻意**不带 global scope**（"suffix varies per session, cross-session reuse has ~zero hit rate"），尾段变化（如 /cd 刷新 git status）时前缀断点保住大块不重新计费。请求侧拆分不影响存储的历史。
- **B system prompt 更新策略**：未发现 in-history 机制。
- **C cache_control 标记**：`contentGenerator.ts:109-138` + `converter.ts` — 三锚点 `system` / `tool`（最后一个工具定义）/ `user.last`（仅尾随一条 user 消息，**刻意不做滑动多轮窗口**）；`enableCacheControl` 总开关；`forceGlobalCacheScope`（代理厂商如 Routify/OpenRouter 下强制 `scope:'global'`，需代理转发 `prompt-caching-scope-2026-01-05` beta）；**TTL 合法性自动归一**（converter.ts:1005-1049）：Anthropic 要求长 TTL 锚点必须在短 TTL 之前上线，`resolveCacheRetention` 反向扫描把 '1h' 锚点之前的锚点自动提升为 '1h'，任何 per-anchor 组合都合法（`{system:'1h'}` 自动连带提升 tool 锚）。
- **D 装配指纹**：未发现 system+tools 哈希。
- **E header 复用**：未发现指纹式 header 继承规则。
- **F 压缩×缓存**：`openaiContentGenerator/prefix-caching.ts:94` 显式断点扫描"Skip the trailing compression directive"（从倒数第二条消息向前找 user/tool 边界，放 2 个断点同时覆盖 pending tool result 场景），说明压缩指令在尾部、不破坏前缀断点；未见逐字节重放副调用。
- **G 会话亲和**：两条线——① `prefix-caching.ts:80-88` `prompt_cache_key = "qwen-code:" + sessionId (+可选 partition)`（带自家命名空间前缀防碰撞）；② `provider/dashscope.ts:720-780` DashScope 聚合网关的平台私有 `metadata: {sessionId, promptId, channel}` 追踪字段，**按 wire model 是否 qwen 家族门控**（非 qwen 模型经网关转发时第三方后端把 metadata 当 string 会 400，issue #11590），`enableRequestMetadata` 三态覆盖。
- **H 命中统计**：usage metadata 常规解析；`pipeline.omniCacheInvalidation.test.ts` 是 oss:// 媒体缓存失效专项（429/RESOURCE_EXHAUSTED 不失效、无 scheme 不失效等边界锁测试），未见独立命中率指标。
- **I 长缓存保留**：有 — `cacheRetention:'ephemeral'|'1h'` 全局默认 + `cacheRetentionByBlock` 三锚点分别覆盖（settings.json `model.generationConfig.cacheRetention`）；'1h' 无模型白名单（实测 Haiku 4.5–Opus 4.8/Sonnet 5 全支持，未来模型 400 直接暴露而非静默掩蔽）。
- **J 其它**：`prefix-caching.ts` 还实现了 OpenAI **explicit breakpoint** 协议：仅 gpt≥5.6 支持（版本号正则判定），`prompt_cache_options.mode:'explicit'` + 2 个 `prompt_cache_breakpoint`；`isOfficialOpenAIEndpoint` 严格限定 hostname 才走官方缓存路径。openaiContentGenerator/provider/ 目录按厂商（dashscope/deepseek/mimo/minimax/zai 等 **12 个**模块：11 具名 + default；三期核对修正：原记 13 家）做请求增强分治。
- **本家最独特的 1-2 条**：① staticSystemPrefix 双 block 拆分——同一 system prompt 内把"稳定前缀（global scope 跨会话）"与"易变尾段（仅会话内缓存）"分离定价；② `resolveCacheRetention` 的 TTL 单调性归一——任何 per-anchor TTL 组合都自动变成 Anthropic 合法请求（前锚自动随 '1h' 后锚提升）。

## 智谱 ZCode（zai-org_ZCode）

- **A 前缀稳定性**：`apps/zcode-cli/packages/core/src/system-reminder/source.ts` `wrapSystemReminder` 标签化 reminder；`runtime/helpers/provider-request-messages.ts` 投影时把 runtime meta 从消息剥离（strippedRuntimeMetaCount 诊断），保持发给 provider 的文本与存储一致。
- **B system prompt 更新策略**：**有模型能力位 `supportsMidConversationSystem`**（`packages/shared/src/model-config.ts:77`，provider 配置 + settings UI 可改，手动添加模型默认 true）。消费端 `runtime/helpers/provider-mid-conversation-system.ts:34-90` `projectMidConversationSystemEntries`：把会话中途产生的 system 内容（reminder、微上下文）**投影为历史中间的 `role:'system'` 消息**（可合并且锚定在前一条消息之后）；模型不支持时回退（fallbackBody）为净化后的普通 user 文本。runtime 配置 `midConversationSystem.mode: 'auto'|'force'`（types.ts:135）可强制开。
- **C cache_control 标记**：`runtime/helpers/provider-request-messages.ts:292-314` `finalizeLatestNonSystemMessageCacheControl` — 每次先**清空全部非 system 消息上的旧标记**，再只在最后一条非 system 消息打 `{type:'ephemeral'}`（单尾锚，滚动清理防旧标记残留）；system 消息的标记来自 entry 级 `cacheControl` 原样透传（:197-198）。
- **D 装配指纹**：未发现。
- **E header 复用**：未发现。
- **F 压缩×缓存**：`runtime/methods/compact-active-helpers.ts:78-90` `buildCompactSummaryRequestMessages` — 摘要请求 = 被摘要 entries 原样 + compact prompt 作为最后一条 user 消息，`applyCacheControl: true, skipCacheWrite: true`；`skipCacheWrite` 让缓存 marker **前移到 compact prompt 之前的真实上下文消息**（:301-305 中文注释："不作为 cache write breakpoint，marker 应前移到 compact prompt 前的真实上下文"）——副调用吃真实前缀的缓存读，且不把 compact prompt 边界写成缓存锚。
- **G 会话亲和**：未发现显式 session id header / prompt_cache_key（服务端 BigModel 平台侧按 usage monitor 归因）。
- **H 命中统计**：**厂商计费口径直连** — `packages/services/src/usage-stats/providers/bigmodelUsageMonitorMapper.ts:107-135` 映射智谱 BigModel usage monitor 的 `cachedInputCreditsUsage`/`cachedInputTokensUsage`（含 `cached_input`/`cache_input` 等多字段名归一），`packages/shared/src/usage-stats.ts:177-178,304-305` 的用量面板 schema 直接暴露 `cacheReadTokens`、`cacheHitRate`、**`cacheHitRateTrend`**（缓存命中率趋势）。
- **I 长缓存保留**：未发现 1h/ttl/retention 配置。
- **J 其它**：① **microcompact**（`runtime/methods/microcompact.ts`）——本地（非 LLM）微压缩，估算 token 后只动条目结构不产生副调用，天然不扰动前缀缓存；compact-active 选择被摘要条目时同样受 `useMidConversationSystem` 影响（摘要与主请求的消息投影保持同构）；② `preserveCanonicalContextPrefix` 保证压缩替换保留规范上下文前缀。
- **本家最独特的 1-2 条**：① `supportsMidConversationSystem` 能力位 + 投影/回退双形态——支持模型吃"历史中间 system 消息"，不支持模型自动降级为 user 文本，且 compaction/微压缩全链路复用同一投影；② compact 副调用的 `skipCacheWrite` 标记前移——缓存 write 断点刻意落在 compact prompt 之前，副调用只读缓存不污染写边界。

## 七家横向速览表

| 厂商 | A 前缀稳定 | B sysPrompt更新 | C cache_control | D 装配指纹 | E header复用 | F 压缩×缓存 | G 会话亲和 | H 命中统计 | I 长保留 | J 其它 |
|---|---|---|---|---|---|---|---|---|---|---|
| 阶跃 Step | 未发现显式纪律 | 无 | 有：anthropic 三锚点+ttl；prompt_cache_key 64字符clamp | 无 | 副调用摘 sessionId | 副调用 cacheRetention:"none"+新uuid | 有：三格式亲和头自适应 | 三字段名归一 cacheRead/Write 计费 | 有：24h/1h 双格式 | turn-prefix 摘要；3 个专项测试 |
| 小米 MiMo | 有：Reminder 附 user 后+缓存论据文档 | 无（明确拒绝改 sysPrompt） | 有：3 锚点滚动双缓冲，6 SDK 形状 | 无 | llm-server 合成 per-request id 隔离 Azure | 未发现 | 有：4 家 provider 键各自透传 | cached_tokens 透传 | 有：cachePromptTTL 5m/1h | codex 计费置零 |
| Kimi | 有：system-reminder 消息层注入 | 无 | 有：anthropic system/tool/last-block 三锚 | 无 | cacheKey 恒为 sessionId | 未发现 | 有：encodeCacheKey trait 钩子+metadata.user_id | 统一字段+fork 首 turn cache_probe 遥测 | 无 | 图片上传记忆化 |
| DeepSeek | 有：runtime context 走 user 快照 | **有：in-history 追加投影** | 经 pi-ai compat 位 | 变体：canonicalHeader 指纹 | **有：仅 config/tools 变更才重写** | **有：逐字节重放 warm prefix** | 有：x-deepseek-harness-session-id | usage 记录（无指标化） | 有：supportsLongCacheRetention | **KV Cache effect README 强制契约**；stepped 高水位图片策略；compact:1 头 |
| MiniMax | 部分：system-reminder 标签 | 无 | 有：getCacheControl+env PI_CACHE_RETENTION | **有：sha256 双指纹，历史刻意排除** | 指纹 LRU（仅观测） | 前缀结构透传（无显式重放注释） | setCacheKey 配置位 | **最全：outcome/stability/read/write 四指标** | 有：env+compat→1h | withCacheRetention 合并器 |
| Qwen | 有：staticSystemPrefix 稳定/易变拆分 | 无 | **有：三锚点+per-anchor TTL+TTL 单调归一+global scope** | 无 | 无 | 尾部压缩指令跳过断点 | 有：qwen-code: 前缀 cache_key+DashScope metadata 门控 | oss 媒体缓存失效测试 | 有：cacheRetentionByBlock | OpenAI explicit breakpoint（gpt≥5.6）；12 个 provider 分治 |
| 智谱 ZCode | 有：runtime meta 投影剥离 | **有：supportsMidConversationSystem 投影/回退** | 有：单尾锚+滚动清理旧标记 | 无 | 无 | **有：skipCacheWrite 标记前移** | 未发现 | **有：cacheHitRate+Trend 面板（厂商 monitor 直连）** | 无 | microcompact 本地压缩零副调用 |

## 总评（一句话）

- **DeepSeek** 把缓存当成 first-class 架构约束（in-history 投影 + 文档契约 + warm prefix 重放），是七家中体系化程度最高的。
- **MiniMax** 把缓存做成可观测性闭环（指纹归因 + Prometheus 指标），**Qwen** 把 anthropic cache_control 语义吃得最深（per-anchor TTL 归一 + global scope + 双 block 拆分）。
- **智谱** 走"模型能力协商"路线（mid-conversation system 能力位），**Kimi** 把缓存键做成 trait 扩展点，**MiMo** 强在锚点策略的工程论证（滚动双缓冲），**Step** 强在副调用防污染与会话头自适应。

---

# 三期调研（2026-09-22）：双角度串行复核

> **规程**（用户 2026-09-22 指示）：串行推进（一仓库一仓库），每仓库**双 agent 并行**——「核对者」验证已落盘断言（方案核对），「探索者」从未覆盖角度挖掘新优化（调研）。每家完成后交叉比对落盘。
> 并发：峰值 2（≤3）。核对者产出三态判定（✅ CONFIRMED / ❌ REFUTED / ⚠️ UNVERIFIABLE）。

## 1/7 Step-Code（阶跃）· 核对者结果

**84 条断言：✅ 75 / ❌ 7 / ⚠️ 2（准确率约九成）。** 7 条 REFUTED 已就地修正进正文（见上方各处「三期核对」标注）。

| # | 原断言 | 实际情况 | 证据 |
| --- | --- | --- | --- |
| R1 | detectCompat 派生 **26 旗标** | **25 字段** | `openai-completions.ts:1617-1661`；`types.ts:473-535` |
| R2 | `thinkingFormat` **6 值枚举** | 类型枚举 **11 值**（openai/openrouter/deepseek/together/baseten/zai/qwen/chat-template/qwen-chat-template/string-thinking/ant-ling）；detectCompat 只派生 6 种，余 5 种供 per-model 声明（qwen/baseten 分支在 `:860-866` 消费） | `types.ts:496-508`；`model-config.ts:87-99` |
| R3 | D4.1「step-* 前缀工具改名表」 | 行号处字符串是**合成 toolCallId**（`tool-profile.ts:293-317`）与**日志文件名前缀**（:1171），非模型面工具名；真实模型面名是 9 个**无前缀**名（STEP_TOOL_NAMES `:60-71`） | `tool-profile.ts:60-71` |
| R4 | stepfun 有 `THINKING_TOKEN_BUDGET_FIELD_GATE` drift gate | stepfun 无 `catalog.ts`；三拼写仅为联合类型 `ThinkingTokenBudgetField`。**drift gate 实属 deepseek-harness 的 llm-pi-ai**（两家同源，我误归属） | `types.ts:71,:519-524` |
| R5 | stepfun 有 `CHAT_TEMPLATE_VARS` gate | 无。coding-agent schema `$var` 只允许 enabled/effort 两值 | `model-config.ts:66-70`；`types.ts:509-511` |
| R6 | 档位后缀正则在 `defaults.ts:56`/`main.ts:302` 且「同一正则」 | 实为 `defaults.ts:175`/`main.ts:299`；两处不同（main.ts 带 `i` 旗标 + 先 toLowerCase） | 同名文件 |
| R7 | openai 格式发 `session_id`，「其它」双头 | openai 发**三头**；双头的是第三种格式 `openai-nosession`（枚举实为三值） | `openai-completions.ts:755-763`；`types.ts:531` |

**⚠️ UNVERIFIABLE（2）**：「src/step/ 51 个文件」（现为 63，判定时点漂移）；「main.ts:300 重复 Set」（Set 仅 4 模型且非重复，解释注释在 defaults.ts:9-10）。

**核对者附注（7 条，已并入正文或备查）**：
1. **双 compaction 副本**：`coding-agent/src/core/compaction/` 与 `agent-core/src/harness/compaction/` 近乎同构（常量一致、行号差约 10 行；前者保留 fromHook 判断）。**引用必须注明路径**。
2. 缓存专项测试实有 **4 个**（另有 `anthropic-cache-write-1h-cost.test.ts`）。
3. **`requiresReasoningContentOnAssistantMessages` 面更宽**：除 deepseek 派生与 kimi-k3 外，`generate-models.ts:2127`（openrouter kimi 系）、`:2339-2354`（vercel-ai-gateway）、`:2427` 也置 true——**DeepOrca 登记时应按「kimi-k3 多网关家族」而非单一 provider**。
4. `supportsThinkingTokenBudget` 只是 `thinkingTokenBudgetField:"thinking_token_budget"` 的别名（`types.ts:525`）。
5. `OPENAI_PROMPT_CACHE_KEY` clamp 按 **Unicode 码点**切片（Array.from），代理对不截半。
6. `resumeFromRunId` 100% cache hit（:281）、temperature 有值才发（:823-825）、Copilot 动态图片头（:746-753）等杂项全部精确命中。
7. 行号以本地 clone HEAD（2026-09-22 15:47 +0800）为准。

## 1/7 Step-Code（阶跃）· 探索者结果 + 双角度交叉比对

**探索者从 10 个未覆盖维度挖掘，另有 1 条对一期的额外证伪**（已就地修正）：一期「未发现 JSON 修复链」错误——`json-parse.ts` 有 repairJson + partial-json 四级瀑布。

### 探索者 TOP 3（全文见 `/tmp/modelcode/r3-explore-stepfun.md`，以下为收编摘要）

**① 三层模型输出/服务端失败自愈金字塔**（传输重试 → JSON 修复 → 标记泄漏重采样）
- `providers/src/utils/provider-retry.ts`：`x-should-retry` 头优先（:23-35）；退避 `min(0.5×2ⁿ, 8s)` 带 -25%~0 抖动（:65-67）；**服务端要求的退避超 60s 直接抛错而非无限等**（:37-49）；SDK 重试计时器不响应 AbortSignal 故 `maxRetries:0` + 自包可中断 sleep（:97-104）。
- `utils/retry.ts`：**「配额型 429 不可重试 vs 瞬时限流可重试」分流**（:7-24 NON_RETRYABLE：insufficient_quota/billing 等）；~40 个可重试模式白名单（含「stream ended before message_stop」过早流结束）。
- `agent-loop.ts:293-316`：**工具标记泄漏重采样**——turn 无可执行 toolCall 但纯文本出现 `<tool_call>`/`<function=` 标记 = 服务端解析器失败签名 → 相同上下文重采样 ≤2 次（泄漏尝试 pop 出请求、不留污染）。
- `:418-443`：**stopReason=length 时整批工具调用拒绝执行**（截断参数可能「parse 成功但内容不完整」，宁可拒绝也不半执行）。

**② 溢出三形态识别 + 一次性 compact-and-retry + autopilot 续跑梯**
- `overflow.ts:37-63`：20+ 家 provider 溢出报错正则库；`:134-163` 三形态：报错型 / **静默溢出**（z.ai 不报错但 `input+cacheRead > contextWindow`）/ **length 截断型**（MiMo 截满后 output=0，判据 `input >= contextWindow×0.99`）；`:74-78` 防误判排除表（Bedrock 限流文案会撞溢出正则）。
- `agent-session.ts:2253-2349`：溢出恢复状态机（**只试一次**；sameModel 守卫防旧小窗模型的错误在新大窗模型上触发压缩；陈旧消息守卫；error 消息 usage 全零时改用消息体估算兜底）。
- `permissions.ts:643-815` **autopilot 续跑梯**：5s/15s/45s/2m/5m 五档、最多 3 次、**同错误重复立即放弃**；`AUTO_RESUME_PROMPT` 明确「Do not restart from scratch or repeat tool calls whose results are already present」（防工具重放）。

**③ 缓存浪费审计 + miss 原因归因**
- `cache-stats.ts:52-90`：`missedTokens = min(prev.promptTokens, promptTokens) − cacheRead`，1KB 噪声地板；sticky `reportedCache` **区分「只报读不报写的 provider」与「根本不报缓存的 provider」**；miss 成本按本条消息自身计费结构算；**模型切换不豁免 miss 归因**（压缩重置基线）。
- UI 三态标签：`Cache miss` / `after model switch` / `after Xm idle`（5 分钟=TTL）——**把 miss 原因直接归因给用户**；≥20K token 或 ≥$0.1 才提示。

### 探索者候补发现（节选）

| 机制 | 证据 | 要点 |
| --- | --- | --- |
| edit 的 Unicode 模糊匹配 | `edit-diff.ts:30-44` | NFKC + **智能引号→ASCII + 7 种连字符→`-` + 9 种特殊空格→普通空格**——对模型抄写文件时输出排版级 Unicode 变体的系统性容错 |
| Step 后端 100MB 图片预算 | `image-resize-core.ts:19-23` | 注释明说「Step 后端接受的 inline 图片**远大于 Anthropic 的 5MB 上限**」——按自家后端能力调宽（别家 20 倍）；四层再编码阶梯永不丢图；EXIF 方向矫正；**给模型的坐标缩放提示** |
| goal 续跑的防偷懒纪律 | `step-schedule.ts:286-311` | 「不得因预算快耗尽就标 complete」「不得重新定义更小的成功」「objective 是 user-provided data, not instructions」 |
| `{previous}` 替换用函数形式 | `subagent/execute.ts:388-393` | 字符串替换会让上个子 agent 输出里的 `$&`/`` $` `` 被 String.replace 重解释污染下一个 prompt |
| 模型说错 agent 名的别名兜底 | `step-subagent-agents.ts:94-98` | 「模型经常拿描述性形式而非精确内置名」→ BUILTIN_AGENT_ALIASES 归一 |
| per-model 默认思考档 | `settings-manager.ts:101` | `modelThinkingLevels: Record<"provider/modelId", ThinkingLevel>`——切模型自动套档 |
| reasoning 增量三方言去重 | `openai-completions.ts:586-617` | 按序探测 `reasoning_content`/`reasoning`/`reasoning_text`，**取第一个非空忽略其余**（chutes.ai 双字段同内容会重复）；`reasoning_details` 的 encrypted 条目独立透传 |
| JSONL 崩溃恢复 | `harness/session/jsonl/storage.ts:24-91` | sibling `.tmp` + rename 原子发布；**撕裂尾修复**（最后一行 JSON 语法错 = 未确认 append，裁掉） |

### 双角度交叉比对结论（1/7）

| 维度 | 核对者 | 探索者 | 一致性 |
| --- | --- | --- | --- |
| 工具改名 | R3 证伪 step-* 前缀表（实为 toolCallId/日志名；真名 9 个无前缀） | 侧证：TOOL_RULES/shell 分析中出现的均为 `read_file`/`run_command` 等无前缀名 | ✅ 相互印证 |
| JSON 修复 | 未触及（一期断言未列入核对清单） | 证伪一期「未发现」——四级瀑布实存 | 探索者独有发现，**已修正** |
| 修复/自愈 | 确认「无 llm-error 独立通道」相关表述 | 补全三层自愈金字塔细节 | ✅ 互补 |
| 缓存 | 确认三锚点/64 字符 clamp/三字段归一 | 新增 miss 归因审计与三态标签 | ✅ 互补 |
| 冲突 | — | — | **两 agent 间零矛盾** |

**1/7 结论**：一期该家准确率约九成（75/84）；双角度合计修正 8 条断言、新增约 20 项未覆盖机制。TOP 3 中「标记泄漏重采样」「length 整批拒绝」「静默溢出检测」「miss 原因归因」四项为 DeepOrca 完全缺失的能力。

## 2/7 MiMo-Code（小米）· 核对者结果 + 双角度交叉比对

**核对者：约 96 条断言，✅ 86 / ❌ 5 / ⚠️ 5。** 常量值零错误（40_000/8_000/128K/32K/5min/0.9/4096/1536/500/160 全对），约 40 个行号断言仅 3–4 处漂移 ≤3 行。

| # | 原断言 | 实际情况 | 证据 |
| --- | --- | --- | --- |
| R1 | D5.1 MCP 渐进披露三重门属 MiMo | **张冠李戴**——该代码在本仓库不存在（属 MiniMax）；与专项一「未发现」自相矛盾 | 全仓 grep 零命中 |
| R2 | session 工具 8 verb | **13** verb（多 send/dashboard/status/join/set-title） | `tool/session.ts:34` |
| R3 | 提示文件 15 个 | **16** 个（自列清单即 16，计数笔误） | `ls \| wc -l` |
| R4 | harness 文档每份 5 语言 | 前 4 份 5 语言；`xiaomi-media-api-doc.md` 无翻译 | `ls docs/harness/` |
| R5 | 共性表 C12 计 MiMo 有 MCP disclosure | MiMo **仅 tool search** | 同 R1 |

**核对者附注要点**：① `MIMOCODE_EXPERIMENTAL_ORCHESTRATOR` **会被** `MIMOCODE_EXPERIMENTAL=1` 派生（flag.ts:396），与 TOKEN_EFFICIENCY 的「不派生」形成对照——「单 flag 显式 opt-in」论据只适用后者；② 10 个形状的减量百分比**只存在于设计文档**（代码无对应常量），引用应标「设计文档宣称值」；③ 环境段注入另有前置 flag `MIMOCODE_ENABLE_DYNAMIC_SYSTEM_PROMPT`；④ loop-streak 哈希为 sha256 截前 16 hex；⑤ `metadata.output` 实现是 `last || preview(output)`，比设计文档的绝对表述略弱。

## 2/7 探索者结果（新角度，全文见 `/tmp/modelcode/r3-explore-mimo.md`）

### 探索者 TOP 3（收编摘要）

**① 「单响应工具批次」治理栈**（`tool/gate.ts` 188 行 + `session/toolcall-flooding.ts` 109 行 + `session/try-best-detector.ts` 265 行）
- **ToolGate**：read/grep/glob 可并发，其余全部 barrier 级；**失败级联**——一个非只读工具失败，同批排队全部以 `FailCascadeError`（recoverable）取消。
- **洪流熔断**：`TOOLCALL_FLOODING_LIMIT = 16`，作为 AI SDK 中间件包在流上，超限**取消全部调用** + 注入 `<system-reminder>`「Prefer 1–3 tool calls per step. Avoid more than 8」。
- **try-best 无进展探测**：`edit_repeat`（diff 归一化后 **3-gram shingle + Jaccard > 0.8**，同路径窗口 12 内 ≥2 次）/ `bash_retry`（归一化命令——tmp 路径→`<TMP>`、6+位数字→`<NUM>`——失败 ≥3 次）/ `action_streak`（4 次无进展）；**进展判定**：verify 命令输出归一化后与上次比较，**输出变了就算进展**。`try_best_detected` 直接入遥测。

**② bash 的 tree-sitter AST 权限扫描 + `bash_delete` forced-ask + 凭据 env 隔离**
- 三语言 WASM（bash/powershell/tree-sitter）惰性加载，按 AST 节点产出 `dirs/patterns/always/deletes` 四集合；`deletes` 含 `GIT_DESTRUCTIVE` 映射（`branch -D`/`reset --hard`/`push --force` 等）。
- **删除强制询问**：「没有任何 allow 规则（包括 `"*": allow`）能静默预批；只有显式 deny 能拦截」；tmp 豁免**五重 fail-closed**（实参不可解析→ask，「`rm -rf $BUILD_DIR/*` 必须仍然询问」是 load-bearing 用例）。
- **凭据 env 隔离**：`MIMOCODE_AUTH_CONTENT`（含 provider key + OAuth refresh token）**禁止被子进程继承**——bash 跑的是 agent 写的命令、本地 MCP server 是第三方二进制。
- **git 身份地板**：agent 在临时 worktree commit 时注入项目仓库自身的 `user.name/email`（只传播已解析值绝不发明占位）。

**③ max-mode：schema-only 工具的 propose-only 多候选 + LLM 裁判**
- 核心技巧：**剥掉工具的 `execute` 闭包**即得 propose-only 流（AI SDK 停止执行但仍发射调用）——`DEFAULT_CANDIDATES = 5` 并发收集。
- 「候选完成前对外零发射 ⇒ **可全量中流重试**」——主路径不可重试的 mid-stream ECONNRESET 在这里完全可恢复。
- 裁判只要一个整数，**解析失败回退 pick=0，flaky 裁判永不阻塞**。附 `/goal` 裁判再入（只读转录本的独立裁判判定目标是否满足，「冷感 vs 工作 agent 的乐观」）。

### 探索者候补发现（节选）

| 机制 | 证据 | 要点 |
| --- | --- | --- |
| **`strict:false` 显式钉死** | `provider/transform.ts:1088-1130` | OpenAI Responses 把**省略 strict** 的工具当 strict 对待；Codex 后端不拒绝而是**自动改补 schema** 然后**生成期解码失败——200 已提交、错误中途到达**＝「答案写一半停止」。修法：出站咽喉点对 `@ai-sdk/openai`/`azure` 显式 `strict:false`（得到干净 502）。**「省略≠默认关」的实证** |
| limitImages 中毒历史自愈 | `transform.ts:860-940` | 历史里一张 >5MB 图让**之后每个请求都 400 且永久卡死**；紧贴发送前嗅探/转码（BMP→PNG）/计数帽丢最老/重压或剥占位——**自愈已中毒的历史**（含已落盘 tool_result 里的图） |
| 重试分类学 | `session/retry.ts` | 六类 RetryKind × 独立预算；**network/rate_limit/server 是 persistent 模式（无上限）**——「等待越久恢复概率越高」；Retry-After 三级提取（头→头→**错误消息正则**）；传输错误按「形状」识别而非封闭枚举（「总会滞后于 undici」） |
| MiMo 网关错误语义重标 | `provider/error.ts:215-239` | MiMo 网关把内容风控以 400 返回：code 421→内容审核、441→风控拦截；真实原因常在 `error.param` 而消息泛化 |
| auto-continuation 三契约 | `session/prompt.ts:4070-4290` | length 续写（≤3 次，「Continue from the exact point」）/ 无效输出按**角色分策略** nudge（≤2 次）/ goal 裁判再入 |
| QuickJS 确定性沙箱 | `workflow/sandbox.ts` | 剥离 guest `Date`/`Math.random` + seed=hash(runID)——「相同 seed ⇒ 相同序列（**resume replay 必需**）」；双时钟预算（墙钟 12h + 只计非挂起时间） |
| BM25 技能检索 | `skill/search.ts` | 不用 LLM 不用嵌入，纯本地 BM25 且**全部超参 flag 化**——零成本替代 LLM 选技能 |
| RecoverableError 双通道 | `tool/recoverable.ts` | 「模型下一轮可自愈」的工具失败：TUI 渲染为**静音删除线、无红色错误块**，但完整消息仍发给 agent——「不惊吓用户，不隐瞒模型」 |

### 双角度交叉比对结论（2/7）

- **核对者 R1（MCP 披露误植）与探索者零冲突**：探索者 TOP 1 治理栈、TOP 2 权限栈均为本仓库实存代码，且与专项一「未发现 MCP 披露」一致——**双角度共同坐实了 R1**。
- 探索者 §7.3「未发现 partial JSON 修复器」与一期断言一致（无矛盾）。
- 两 agent 对 `MIMOCODE_DISABLE_TOOLCALL_FLOODING_DETECT`/try-best 等旗标的描述相互吻合。
- **2/7 结论**：一期该家准确率高（常量零错误）；错误集中在**一处误植（MCP 披露）及其连带计数**；新增约 25 项未覆盖机制，其中「工具批次治理栈」「AST 权限 + 删除强制询问」「max-mode propose-only」「strict:false 战争故事」「中毒历史自愈」五组为 DeepOrca 完全缺失或弱项。

## 3/7 kimi-code（月之暗面）· 双角度交叉比对

**核对者：96 条断言，✅ 94 / ❌ 0 / ⚠️ 2——零实质错误，六家中精确度最高。** 常量（0.85/50_000/3-5-8-12/2000/50_000/10_000_000/[80,60,40,20] 等）、接口形状、英文文案（L1/L2/L3 提醒、HANDOFF_VETO_TEXT）、11 个状态键清单均逐字可复现；十余处行号引用全部精确，仅 4 处微漂 ≤4 行（内容逐字成立）。

**核对者附注（措辞级微瑕，非错误）**：① `modelSource` 实为 `CatalogProviderInfo` 的字段（经 `entry.info` 消费），文档并列句读作 entry 直属；② 「bash 超限自动转后台」实为两个机制（超限 spill 转 `task_id` 引用 vs 超时 `autoBackgroundOnTimeout`），原文捏在一句；③ `AnthropicTrait` 与 `OpenAITrait` 风格同构但成员集不同（多 `acceptedImageMimes`，少 `encodeCacheKey`/`extractUsage`/`reasoningKey` 等）。

## 3/7 探索者结果（全文见 `/tmp/modelcode/r3-explore-kimi.md`）

### 探索者 TOP 3

**① 观察式上下文窗口学习 + 溢出恢复环**（`agent/fullCompaction/fullCompactionService.ts:305-331, 468-495`）
- **真实 413/overflow 被当作窗口探针**：`floor(估算 tokens × 0.85)` 记入 per-model 的 `observedMaxContextTokensByModel` Map；此后压缩阈值取 **catalog 声明值与观察值的较小者**——目录说 1M 但端点实际 128K 时，一次溢出就永久学会。
- 恢复环：「压缩 → 等待 → **原地 retry 失败请求**」，连续次数上限防死循环；裸 413 需过 `≥0.5×effectiveMax` 谓词，防「图片过大」误触发学习。
- **与 DeepOrca 的相关性**：这是「端点试探」思想在**窗口维度**的实例——目录数据不可信时，用真实错误校准。

**② Tower 的 AIMD 容量调控**（`features/tower/towerRateLimitService.ts:10-71`）
- 子 agent fan-out 的客户端自适应并发：首撞 429 → 容量砍到 `activeCount-1`；每 2s 最多再 -1；**静默 180s 才 +1 恢复**；429 后 60s 暂停 spawn；预算上限 16。
- **Additive-Increase Multiplicative-Decrease**——TCP 拥塞控制思想用于 LLM 并发治理。

**③ 配额耗尽 vs 瞬时限流的语义级分类**（`packages/kosong/src/providers/kimi-errors.ts:6-87`）
- 5 个锚定账单词汇的正则 + `exceeded_current_quota_error` 结构化信号；三层 `error.error.error` 遍历兼容 OpenAI/Anthropic 两种 SDK 错误形状；产出**不可重试**的 `APIProviderQuotaExhaustedError`。
- 配套 retry 白名单：filtered 空响应不重试、quota/context_overflow 不重试、**529 可重试**、Retry-After 尊重。
- **与 Step-Code 的同类发现互证**（其 NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN）——两家独立实现「同为 429，配额 vs 限流要分流」。

### 探索者次级发现（节选）

| 机制 | 证据 | 要点 |
| --- | --- | --- |
| AST 级危险命令判定 | tree-sitter-bash 包装器 | 解嵌套；`rm -rf` /tmp 白名单；**unanalyzable 即 fail-safe 问询** |
| 13 层有序权限策略链 | — | 含**会话级审批记忆** |
| readTool 收敛循环 | readTool.ts | max_chars 逐次收敛 / **Next Read 续读参数** / 编码转码向模型披露 |
| tool_call 流式缓冲 | — | 「先名后流」缓冲 + **跨轮 ID 去重 normalizer** |
| think-only 空响应显式建错 | — | 不静默 |
| bash 超时自动转后台 | — | 且**工具描述同步告知模型**该行为 |
| 媒体丢弃显式占位 | — | `[image omitted]` 文本，不静默消失 |
| wire 日志损坏自愈 | — | 备份 + 截断至有效前缀 |
| skill 按需加载为工具 | — | **非 system 注入**——技能是一个可调用的工具 |
| GUI login-shell PATH 探针 | — | **对 Electron 形态的 DeepOrca 直接可用** |

### 双角度交叉比对结论（3/7）

- 核对者零证伪 ⇒ 一期该家记录无需修正（仅 3 条措辞级附注）。
- 探索者的「观察式窗口学习」与核对者确认的 `DEFAULT_COMPACTION_CONFIG` 恰好构成闭环：**静态比例（0.85）之上叠了一层动态校准（observed）**——一期只记录了静态层。
- 探索者「配额 vs 限流」与 Step-Code 期发现互证，构成跨厂商共性 C25 候选。
- **3/7 结论**：一期 kimi 章节 98% 精确；新增约 15 项机制，TOP 3 全部为 DeepOrca 缺失（窗口观察学习直接补 C6 差距的「动态版」）。

## 4/7 deepseek-harness（DeepSeek 官方）· 双角度交叉比对

**核对者：68 条断言，✅ 67 / ❌ 1 / ⚠️ 0。** 几乎所有引文逐字命中、行号误差普遍 ±1 行以内。唯一证伪是**引文出处标错**（内容属实）：一段 KV Cache 引文被标到 `compaction/README.md:149-152`（该文件仅 55 行且无 KV 小节），实际出自 `agent-loop/README.md:176` / `compaction-basic/README.md:179-181`——已修正。

**核对者附注要点**：① 「60+ 个包」建议精确为「54 个分组目录、workspace glob `packages/*/*`、100+ 工作区包」；② 「摘要换便宜模型」的「便宜」是解读——机制是 summarizationProvider/Model 可路由**任意**模型；③ 顺手核实 DeepOrca 侧 `think-level.ts:72-78` 的 `DEEPSEEK_V4_FAMILY` 与文档所引映射完全一致。

## 4/7 探索者结果（全文见 `/tmp/modelcode/r3-explore-deepseek.md`）

### 探索者 TOP 3

**① 持久化重试 + 会话投影 + 不变量伴生的三位一体**（`llm-retry/src/index.ts:123-138` + `invariant.ts` + `session-projection`）
- 重试计数挂在 **session projection**（key = `[provider, policyKey]`，`step/start`/`turn/end` 清零）；**先 append `llm/retry` 持久事件、再进入可取消等待**——「Each scheduled retry is durable before its cancellable wait」，崩溃恢复后按 prior+1 精确续数。
- **每个产出持久事件的域都带 invariant 伴生插件**（llm-retry / goal / schedule / hook / authorization / credentials / sandbox-policy）：加载期校验全史、追加期校验单事件（如「retry 的 provider 必须等于该 step 最近 `request/header` 里的 provider」）。
- 退避：指数上限 2^1024 防溢出 + 乘性对称 jitter；**Retry-After 超 maxDelayMs 时 normal 放弃 / always 回落本地退避**（永不服从过大的服务器指令）。
- **对 DeepOrca**：重试状态在进程内存里，桌面崩溃即丢——可能无限重试或提前放弃；与 JSONL 持久化天然契合。

**② sandbox 拒绝即教学**（`sandbox/src/escalation.ts`）
- 拒绝 marker 全家统一词汇；拒绝之上**同回合**骑一条升级 hint：「用 `sandbox_permissions`（最窄够用档）+ justification **原样重试一次**；the approval prompt asks the user」——提示在决策点，不依赖模型记忆文档。
- 严格变宽表**执行期检查**（「schema 是 registry-global，effective mode 是 per-call truth」）；`allowed-once` 授权只作用于发起的那一次调用；无 approval service 全部 fail-closed。
- `writable-root` 单一定义源：Seatbelt profile 与进程内 fs fence 同处派生——「write 工具不能写 /tmp 而 bash 能」的不对称**不可能出现**；`realpathSync.native` 防 JS 实现词法折叠 `..` 与 enforcement 不一致。

**③ repeat-tool-reminder：advisory 循环检测的完整工程学**（`guard/repeat-tool-reminder`）
- **深度键排序规范化**参数防绕过（仅属性顺序不同 = 同一 canonical 串）；**检测用全量 canonical 串、给模型看的 preview 截 500 字符**（「the cap bounds the reminder, never the detection」）。
- **被拒绝的调用同样计数**（「a model hammering a denied call is exactly the loop worth breaking」）；专用 `MessageSource` 防「无 label 的上下文在派生历史里渲染成用户 prompt」；**用户插话重置链**；阈值 `[3,5,8]` 双档递进。

### 探索者次级发现（节选）

| 机制 | 证据 | 要点 |
| --- | --- | --- |
| **spill 外置** | `spill/spill-policy` | 超大工具结果全文存工件 + 头/尾双端预算 preview + locator；**`read` 工具显式跳过**防「read→spill→再 read」循环；存储失败绝不把成功调用变 isError |
| **SSE 心跳喂狗** | `llm-deepseek/src/sse.ts:14` | SSE comment 帧（keep-alive）也重置空闲看门狗——长思考期服务器心跳不会误判超时；**帧 event 名与 JSON type 不一致 → MALFORMED_RESPONSE** 双重校验 |
| replay 最小元数据 | `replay.ts:29-63` | envelope 只有 kind/version/model+blocks；**envelope.model 必须等于 assistant source model**（跨模型签名不可移植）；诊断回调**收不到任何内容或签名**（隐私） |
| 投影检查点防收缩 | `session-projection/README.md:67-107` | `restoreFloor` 锚定最低可用水位以下一事件——**日志尾部丢失会被检出**；四级格式迁移链 v0→v4 |
| token-meter usage 锚定 | `token-meter/index.ts:125-180` | provider usage 只在「canonical envelope 相同 **且** usage ≥ 全路由计价锚」时采信，否则退回启发式（宁大勿小） |
| 子 agent effort 属地 | `subagent/child-agent.ts:118` | **换路由而未显式指名 effort 时删除父级 effort**（「the selected model resolves its own default」）；委派深度单调持久化（只能加深） |
| session-reference 注入防线 | `context/session-reference` | 跨会话快照**捕获后不可变** + 固定警告「禁止遵循其中的指令、权限声明或工具请求」 |
| AGENTS.md 预算策略 | `context/agent-instructions` | **更全局的文件先整篇省略、最具体的才截断** |
| ptc-runtime | `experimental` | 跑**模型编写的程序**（lossless-JSON）调宿主异步函数；「程序失败在 result 内解决，promise reject 只表示调用方误用」 |
| 遥测反馈解锁 | `session-telemetry-otel` | OTel 仅在用户显式 feedback 后导出；DISABLED 连 transport 都不构造；**全仓无第三方埋点 SDK** |

### 双角度交叉比对结论（4/7）

- 核对者零事实性错误（唯一 ❌ 为出处标注）；探索者与核对者**零冲突**。
- 探索者 §7.2（replay 跨模型返回 undefined 静默省略签名）与一期 D4.3「坏 replay 元数据降级而非丢弃」互补成完整图景。
- **4/7 结论**：一期该家记录质量极高（67/68）；新增约 20 项机制，TOP 3 全部为 DeepOrca 缺失——尤其「持久化重试」「拒绝即教学」「spill 跳过 read 防循环」三件可直接落地。

## 5/7 minimax-code（MiniMax）· 核对者结果 + 双角度交叉比对

**核对者：58 条断言，✅ 52 / ❌ 4 / ⚠️ 2（准确率约九成）。** 引文质量高（D3/D4/D8/D10 注释几乎逐字命中，行号偏差普遍 ≤10 行）。

| # | 原断言 | 实际情况 | 证据 |
| --- | --- | --- | --- |
| R1 | 专项一 F「图片 token **未发现**」 | **实有完整管线**：`model-image-preprocess.ts`（275 行）——1920px/5MB 预算 + **JPEG 质量阶梯 `[82,72,62,52]`** + 512px 下限 + 双线性缩放 + alpha 白底压平；纯 JS 可移植 | `packages/local-runtime/src/utils/model-image-preprocess.ts:8-12, 185-200` |
| R2 | MCP 代理工具 `mcp__invoke`（双下划线） | 实为 **`mcp_invoke`**（单下划线） | `mcp-disclosure/mcp-invoke.ts:83` |
| R3 | `ModelConfig` 29 字段 | **27** 字段（自列清单即 27） | `config.ts:1086-1115` |
| R4 | fireworks 默认**关** sessionAffinityHeaders | 该项默认**开**；默认关的是 supportsCacheControlOnTools/LongCacheRetention/EagerToolInput（与专项二 G 自相矛盾，G 正确） | `getMessagesCompat :255-263` |

**⚠️ 存疑**：① 汇总表 C17 的「MiniMax variantFor 400」在公开投影零命中——**疑似从 MiMo 类比误植**（该机制在 MiMo 的 `llm-server/completions.ts:93-118`），已加注；② 「architecture.md 仅一章」实为两章（行文小误差）。

**核对者附注要点**：① D5.1 归属链（一期误植 MiMo → 三期改判 MiniMax）在本仓**完全实证，勘误闭环**；② M3 90% 线的窗口值是**字面量等值匹配**（512_000/1_000_000，非 ≥ 判断）；③ runaway 六信号名、PI_DEFAULT_THINKING_BUDGETS 四档、DYNAMIC 四常量逐字符无误。

## 5/7 探索者结果（全文见 `/tmp/modelcode/r3-explore-minimax.md`）

### 探索者 TOP 3

**① 重试的「可见输出提交边界」+ 缓冲重放**（`agent-core/src/pi-turn-runner/llm-retry.ts:459-474, 810-851`）
- 整个 provider 流**先缓冲到内存**；「**A visible delta is the retry commit boundary for every provider**」——首个非空可见增量（text/thinking/toolcall delta 或非空 end）出现前失败 → **静默丢弃该物理请求并重发**；出现后 → `replayStream()` 把已缓冲事件按序重放，**重试对调用方完全透明**；终止失败先重放再抛。
- 配套：**16 类错误枚举**（TPM 限流/配额/余额单列，529=overloaded）+ **仅 5 类可重试的白名单**（「generic 5xx and unknown failures deliberately fail closed」）+ MiniMax 私有数字码映射（1400010161/2056/2045…）+ 从 message 文本恢复结构化事实 + 有界 BFS no-throw 提取。
- **对 DeepOrca**：回答了「流式响应什么时候还能安全重试」这个普适问题，纯函数可移植。

**② read→edit 回路三件容错套件**（`edit-line-number-retry.ts` + `read-guards.ts` + `output-limit.ts`）
- **行号前缀一次性重试**：模型把带行号的行抄进 `oldText` 导致 not found 时，**仅当每行都是前缀形状**才剥离重试一次；二次失败重抛原始错误——「breaking the core read→edit loop (Codex Review !4027 P1)」的修复。与 DeepOrca 的 snippet_id 强约束**互补**（失败驱动的宽松自愈，无需改协议）。
- **read 预检双守卫**：设备守卫（`/dev/zero`、`/proc/<pid>/fd/*`——「never returns; the whole turn hangs」；`/dev/null` 故意放行）+ 二进制守卫（`.zip`/`.docx`/HEIC「**silently becomes tens of KB of U+FFFD garbage**」；扩展名黑名单 + 4KB 内容采样）。
- **截断=可续读协议**：`continuation_hint{tool, preserve_args, instruction}` + `next_offset`，头 45%/尾 55% 预算，UTF-8 边界拟合。

**③ 按模型模态压制回退工具 + 装配稳定性/缓存指标闭环**
- **原生模态 vs 工具模拟二选一**：`support_image/video` 为 true 时，回退上传理解工具（`images_understand` 等）**从 tools 数组删除**——「工具面按模型模态能力收窄」，C12 的新实例，分派键是**模型模态能力**。
- **bash→LLM 缺口相关性**：LRU 记录每会话最后 bash 完成时间，下一请求发 `pi_llm_post_bash_cache_outcome_total{bashDurationClass, gapClass, outcome}`——**「工具间隙是否打断前缀缓存」变成可统计实验**；`pi_llm_inter_request_gap_ms` 的 5 分钟分档即缓存 TTL 假设。

### 探索者次级发现（节选）

| 机制 | 证据 | 要点 |
| --- | --- | --- |
| **pi-mono 补丁台账** | `third_party/pi-mono/MINIMAX_CHANGES.md`（33 条） | 每条 = 事故描述 + generic-upstreamable vs host-opt-in + 验证命令。关键补丁：**按主机的 system-role 方言**（DashScope 等无 `developer` role）；**SSE 头超时与体超时是两个失败面**（头>10s 被中止→30s）；**signature-only thinking 块**（空文本但有签名，跳过即回放丢签名）；Claude 5 须保留 `output_config.effort` |
| sandbox 凭据哨兵 | `credential-sentinel.ts` | 真值→`fake_value_<uuid>`，出口到 allowlisted 目的时换回；**长度保持填充**（Content-Length 不变）；**按凭据目的主机门控**（防洗钱）；`DATABASE_URL` 结构化掩码保语法 |
| OAuth lease | `oauth-lease-protocol` | 工具子进程凭 capability 换 **5 分钟短租约**，主凭证永不进子进程 |
| 排队消息防伪造 | `queued-message-wrapper.ts` | `<queued-user-message>` 包裹 + **用户文本内嵌的同名标签先转义**（防伪造带外插入提权） |
| bash 子进程双层净化 | `bash-subprocess-env.ts` | Layer A 恒开剥运行时边界键（「不是密钥外泄，是**边界正确性**：子进程可冒充父会话」）；Layer B 三档（CI 自动 scrub） |
| turn 队列仲裁 | `queue.dispatcher.ts` | **自治 Goal 让位排队用户工作**（不取消不重排）；steering 幂等键；pause 是**持久化行**（崩溃重启仍保持） |
| fork settled 前缀 | `fork/side-history-boundary.ts` | 分支只能建立在**已结算的历史前缀**上（不等 live 工具） |
| 终端空响应恢复 | `terminal-response-recovery.ts` | 工具后空回复给一次有界重试，再空以 `terminal_empty` 显式失败——**不再无声成功** |
| 崩溃压缩标记修复 | `stale-compaction-repair.ts` | 加载时把「非本进程写入或非末位」的 compaction_start 改写为 failed |
| iso-bmff 时长 | `iso-bmff-duration.ts` | **不解码媒体字节读 MP4/MOV 时长**（手工解析 moov→mvhd） |

### 双角度交叉比对结论（5/7）

- 核对者 R1（图片管线「未发现」被推翻）与探索者 §4（18 个矩阵工具+模态压制）**同向**：一期对 MiniMax 多模态面**系统性低估**——因投影里它分散在 local-runtime/utils 与 cloud/matrix-tools，两期都没扫到。
- 核对者 U1（variantFor 疑似误植）与探索者 §1.2（自有 16 类分类器）互证：MiniMax 的「不支持档位报错」走自有码表而非 MiMo 式 variantFor。
- 两 agent 对 runaway-guard/装配指纹/MCP 披露的描述相互吻合，零矛盾。
- **5/7 结论**：一期该家准确率九成；错误集中在**多模态低估**与**跨仓库类比误植**；新增约 25 项机制，TOP 3 全部可直接落地（重试提交边界、read→edit 自愈、模态压制+指标闭环）。

## 6/7 qwen-code（阿里）· 核对者结果 + 双角度交叉比对

**核对者：约 111 条断言，✅ 105 / ❌ 4 / ⚠️ 2（≈94.6%）。** 常量与公式**零错误**（九个压缩常量、4/20/20/1600/1.5/32000/8000 全对；`microcompact.ts` 966 行整、`README.md:214` 逐字命中、reasoning-overrides 决策链**逐字一致**）。4 条证伪均为「事实存在、引用路径/枚举数错误」型：

| # | 原断言 | 实际情况 | 证据 |
| --- | --- | --- | --- |
| R1 | desktop/mobile/**web**-shell 三者被排除出 workspace | 排除的是 desktop-shell / **live-host** / mobile-shell；**web-shell 是 workspace 成员** | `pnpm-workspace.yaml:19-21` |
| R2 | openaiContentGenerator/provider/ 13 家分治 | **12 个**（11 具名 + default） | 目录列表 |
| R3 | 代码评审独立 prompt `assets/prompts/code-review/` | 该路径不存在；实为 bundled skill（`skills/bundled/review/`）+ CLI 命令 | 同左 |
| R4 | 错误工具 `rateLimit.js` 等五文件 | 全部是 `.ts` | `packages/core/src/utils/` |

**⚠️ 存疑**：① 「'1h' 实测全支持、未来模型 400 直接暴露」是真机行为结论（代码侧「无白名单」已核实）；② 「产品面六家最宽」是横向比较判断。

**核对者附注**：① 「24 个包」口径 = 13 个未排除的顶层 package.json + 11 channels（计入 integrations 则 26）；② 核对中还发现文档未提的 **#7960**（vLLM 小窗口 4K floor 仍超窗的 400 案例）与 **#9103**；③ 半水位护缓存前缀与 staticSystemPrefix 是**同一条缓存纪律的两个面**，两处引用互证。

## 6/7 探索者结果（全文见 `/tmp/modelcode/r3-explore-qwen.md`）

### 探索者 TOP 3

**① omni reactive-degrade + smart-resize：服务端反馈驱动的多模态降级闭环**
- `omni/reactive-degrade.ts:8-30`：**「本地 token 估算对多模态计费必然失真」被承认为一等工程事实**——实测（qwen3.5-omni 按**采样帧**计费、~4fps 采样上限、**480p/10fps 降档不降账单**）；**服务端 400 是唯一可靠超限信号** → oss URL sha256 反查 → 本地文件 → 策略升档 → 降级衍生物 → 重传 → **聊天历史 fileUri 原位替换** → 重试。
- `omni/smart-resize.ts:8-45`（移植 Qwen-MM-Plugins）：**Qwen-VL 14px patch × 2×2 merge = 28px 网格因子**，缩放 snap 到网格倍数防边缘浪费；「1 token = factor² 像素」。
- 与 `contextLengthError.ts`（解析 DashScope「Range of input length」拿**服务端真实上限**）成对。

**② 错误分类器 + 三预算流恢复——retry 升级为「错误法学」**
- `retryErrorClassification.ts:51-293`：kind×diagnosis 双轴；**DashScope `Throttling.AllocationQuota`（分配配额，429 外观）→ fail-fast**（重试永不成功）；transport code 仅在 5xx/无 status 时压过 HTTP status；**无 body 的 4xx + cause 链有 network error → 被包装的断连而非真客户端错 → retryable**。
- **request-id 存在性区分「无 status 错误」**：网关往已 200 的 SSE 推错误帧时 SDK 丢 status——上游错误有 provider request id、本地错误（MISSING_API_KEY 等）没有。注释：「下一个网关 bug 不应先教会这个文件才能停止杀 turn」——**未知上游码默认可重试（fail-open）**。
- replay/continuation 分离预算：**replay 仅在任何 chunk 送达前合法；continuation 保留已送达输出**注入恢复 user-turn（1200 字符尾部 + `RECOVERY_RESUME_INSTRUCTION`「Resume directly — no apology, no recap」）；续传去重用 **Markdown 结构锚点**（`## `、表格行）+ 双层地板。
- `ESTIMATE_CLAMP_OVERHEAD_PAD=20_000`：历史派生计数漏 system+tools+skill 的系统性低估（**低估是 prompt+max_tokens 溢出窗口的唯一途径**，#5950）。

**③ AUTO 模式 LLM 权限分类器全家桶**
- 两级分类器：Stage 1 fast（**max_tokens=32、thinking 关、~300ms**）→ Stage 2 review（4096 token，复审 block 降假阳）；**fail-closed：任何非 abort 失败 → shouldBlock=true**。
- 三条互补防线治分类器系统性弱点：**Layer 0 确定性正则兜底**（`git reset --hard` 等；`git commit --amend` 除非是本会话 agent 自己的提交）；**运行时剥离危险 allow 规则**（进 AUTO 时剥 `Bash(npx *)` 等最常见 always-allow——「绕过分类器最干净的通道」）；**拒绝状态机**（连续 block → 单调用降级人工确认而非退出 AUTO）。
- **shell-semantics**：`cat /etc/passwd → read_file`、`curl → web_fetch(domain)`——文件/网络权限规则覆盖 shell 旁路。
- **WebFetch 恒 'ask'**：「模型产出的 URL 本身就是外泄通道，无论主机多可信」。

### 探索者次级发现（节选）

| 机制 | 证据 | 要点 |
| --- | --- | --- |
| 上下文构成分类计量 | `telemetry/context-usage.ts:14-28` | token 按 **system_prompt/builtin_tools/mcp_tools/memory_files/skills/messages 六类拆分**上报——「上下文预算去哪了」归因遥测（DeepOrca ledger 只有总量） |
| priorReadEnforcement | `tools/priorReadEnforcement.ts:19-46` | mutate 工具要求**本会话真实读过该文件且盘上指纹仍匹配**——防「盲改」 |
| edit 自诊断错误 | `tools/edit.ts:164-318` | 0 次命中返回**转义/空白/缩进/用 ReadFile 验证**的指引 |
| skill-curator | `skills/skill-curator.ts:18-40` | 自动策展（7 天巡检/30 天 stale/90 天归档）+ **读上限防御**（「symlink 到 /dev/zero 不能驱动无界读取」） |
| session-recovery | `core/session-recovery.ts:19-58` | **恢复计划而非静默修复**（kind/repairs/canAutoContinue/visibleNotice）；trailing 通知**权威计数**（信 recorder 盖章，不信形状——「正文恰是裸信封的真实用户 prompt」不被误裁） |
| loop_wakeup | `tools/loop-wakeup.ts` | turn 结束前调度「N 秒后向自己注入 prompt」；**默认权限恒 'ask'** + token 预算熔断 |
| per-agent MCP 遮蔽 | `subagent-manager.ts:1272-1400` | front-end `mcpServers` 遮蔽 session 级同名 server；per-server 并行发现（`Promise.allSettled`——单个坏 server 不串行拖慢） |
| SubagentManager 规模 | 2431 行 | plan-revision 是 Config 会话级单例——原型链 set/clear 会被 wrapper 遮蔽，需显式转发 mutation |
| followup/speculation | — | 跟进投机执行（未深挖，标注） |

### 双角度交叉比对结论（6/7）

- 核对者 4 条证伪**零动摇结论方向**（全是引用级错误）；探索者与核对者零矛盾。
- 探索者的 reactive-degrade 与核对者确认的 `contextLengthError`（DashScope 真实上限解析）**同向闭环**：一个管多模态计费、一个管文本窗口，共同体现「服务端反馈 > 本地估算」哲学——与 kimi 的观察式窗口学习互为印证。
- **6/7 结论**：一期该家 94.6% 精确；新增约 25 项机制，TOP 3 中「服务端反馈降级」「错误法学」「LLM 权限分类器」均为 DeepOrca 完全缺失的能力域。

## 7/7 ZCode（智谱 GLM 官方）· 核对者结果 + 双角度交叉比对

**核对者：86 条断言，✅ 75 / ❌ 5 / ⚠️ 6。** **10 处行号引用全部精确命中**（`model-selection-config.ts:65`、`zh-CN.ts:2849`、`model-config.ts:77` 等），核心机制（CEL DSL、merge-patch、modelMatch 级联、缓存锚）高度可靠。

| # | 原断言 | 实际情况 | 证据 |
| --- | --- | --- | --- |
| R1 | `apiTypeMatch` 取值 4 个（含 `.*`） | 内置配置实为 **3 个**（38+24+10=72 条规则）；全仓无 `.*` | `zcode-builtin.json`；`provider-data-schema.ts:4-8` |
| R2 | GLM-5.3-Flash 64000 | **128000**——modelMatch **大小写不敏感**（`model-config.ts:404-408`），大写模板 ID 命中小写规则 | 级联模拟 |
| R3 | glm-4-flash-250414 = 1024 | **16384**（1024 属 glm-4v-flash） | 规则原文 |
| R4 | codegeex-4 = 4096 | **32768**（4096 属 charglm-4） | 规则原文 |
| R5 | D7「未发现 cache_control，ZCode 不做前缀缓存锚点」 | **搜索范围过窄**——CLI runtime 内实有完整锚点体系；**与专项二 C 自相矛盾** | `provider-request-messages.ts:292-314` |

**核对者附注要点**：① DSL 实际还支持文档未列的 `< <= > >=`、`%`、一元 `+`（文档清单为真子集）；② 「119 map / 111 非空」的口径 = 非 `{}`（8 条 no-op）；③ 速览「1K~131072」就 GLM 系成立，全表实为 deepseek-v4 系的 **384000**。

## 7/7 探索者结果（全文见 `/tmp/modelcode/r3-explore-zcode.md`）——**一期两处「未发现」的翻案**

新矿区：`apps/zcode-cli/packages/`（嵌套 workspace：adapters/bootstrap/cli/contracts/core/dynamic-workflow/i18n/…）。一期「压缩未找到」「缓存只有单尾锚」均因未挖入此层。

### 探索者 TOP 3

**① 三层压缩体系：microcompact（本地零调用）→ auto compact → rapid-refill 熔断**
- `compact/policy.ts:6-14`：`DEFAULT_COMPACT_CONTEXT_WINDOW=200_000`；`DEFAULT_AUTOCOMPACT_OUTPUT_RESERVE_TOKENS=32_000`（注释：「否则请求预算和压缩窗口按两套常量计算」——**正是 DeepOrca 当前的问题**）；`PREFLIGHT_RESERVE=21_000`；`BUFFER=13_000`；阈值 = effectiveWindow − buffer，**effectiveWindow = contextWindow − min(outputReserve, 21K)**（「provider 的窗口是 input+output 共享；压缩只能让出输入侧」）；`MAX_CONSECUTIVE_FAILURES=3` 熔断。
- **microcompact**（`microcompact.ts`）：阈值 = `min(autoThreshold×0.9, autoThreshold−2000)`——**永远先于摘要触发**；保最近 **5 组**工具结果；**媒体块永不清**；**256-token 最小节省门槛**（不够省就整体回滚——防白碎缓存）；双触发器（60 分钟空闲 + token 压力）。
- **rapid-refill 熔断**（`turn-loop-state.ts:21-22`）：压缩后 3 个工具回合内又达阈值、连续 3 次 → 停止 auto compact 并抛「A file or tool output may be too large. Read it in smaller chunks」——**封死「巨输出→压缩→又巨输出」的烧钱死循环**。
- 摘要工程细节：**工具定义 >100 个时摘要请求不带工具**（「massive MCP 工具会撑爆 compact summary 的 context」）；prompt-too-long 三级降级；token 估算修正（**toolCalls 入参单独计入**——旧实现只读 content，大入参发给 provider 却计 0；reasoning 用独立投影）。

**② cache_control 三段锚 + skipCacheWrite 第二语义**
- **system 拆三段各打 ephemeral 锚**（`context/builder.ts:239-277`）：cli_prefix / **stable body** / dynamic body——稳定前缀在动态尾部变化时仍命中；section 有 `cacheHint: "stable"|"dynamic"` 元数据驱动分段。
- 每请求**先清全部旧标记再打唯一对话尾锚**（位置单调前移）；相邻 user 消息合并保留锚。
- **skipCacheWrite**：compact summary 请求把锚**前移到上一条消息**——一次性摘要不污染缓存写断点（中文注释原文在 `provider-request-messages.ts:301`）。

**③ 流中只读工具执行 + SSE 停滞 core 级 10 次锚点恢复**
- `streaming-tool-coordinator.ts`：默认 `mode="readOnly"`——**只读工具在模型还在流式输出时就开跑**（tool_call 参数流中一完整即执行，失败回退 end-of-stream）。
- `streaming-recovery.ts`：「只恢复 1 次会让连续短暂抖动直接失败」→ **`STREAM_RECOVERY_MAX_RETRIES = 10`**；安全锚点体系（end-of-stream attempt / tool-result / previous-message anchor）——**部分内容块已提交后禁止重放**。
- **provider 专属准入重试**：Start Plan 繁忙码 3008/3009/3010 只对 `account:bigmodel-start-plan`/`account:zai-start-plan` 做 [1s,2s] 退避——智谱自家套餐专属处理。

### 探索者次级发现（节选）

| 机制 | 证据 | 要点 |
| --- | --- | --- |
| 权限能力元数据 | `permission/service.ts`（690 行） | readOnly/destructive/**riskLevel 三档**/sideEffectScope/needsApproval/alwaysAsk/**denyPriority("beforeAsk")**；模式矩阵决策；**alwaysAsk 压过 yolo 直通但压不过硬阻断**（「否则被禁用的工具退化成弹个窗就能跑」） |
| AmendWorkflow 归属制钥匙 | service.ts:360-404 | 放行依据 = journal 的 parent_session_id（**重启冷恢复后依然成立，没有可播种可撤销的字段**）——「钥匙是 run 的归属，不是字段的在场」 |
| bash 只读语义级判定 | `bash-readonly-policy*`（~20 文件） | argv 逐命令判定（git-subcommands/multiword/flags 各专项） |
| **git 运行时安全** | `bash-git-runtime-safety.ts:23-155` | 检查 cwd 及父目录的 **.git 形态**（symlink 外指/worktree 外指/>32KiB/含 \0/bare）——「git 会加载 hooks/config = 代码执行」；`cd && git` 强制审批 |
| SQLite 会话存储 | `adapters/src/storage/` | 22 版迁移全保留可回放；**PENDING part 崩溃恢复**（流式工具开始执行前先落 PENDING） |
| 空响应还原业务错误 | `model-errors.ts:126-168` | 「adapter 偶发把业务错误落成空 finish + 零 usage」→ **从 providerMetadata 还原 providerCode** |
| formal-proof | `packages/formal-proof/` | **产品行为状态空间枚举器**——穷举 compact×fork×goal×queue×steering 组合验证 runtime |
| zcode-cua | — | **fail-closed 占位包模式**：API 兼容但全部报告 unavailable——可选重能力的编译期安全降级 |
| Explore 白名单 | `explore-tools.ts:4-24` | 刻意不含写工具——「Bash 是唯一副作用入口，只读语义靠 prompt 约束」 |

### 双角度交叉比对结论（7/7）

- 核对者 R5（D7「未发现」范围过窄）与探索者 §6（完整锚点体系）**互为印证**——双角度合起来才拼出全貌：核对者证明「provider+services 内无」，探索者找到「CLI runtime 内有」。
- 核对者 U1（D6 压缩 hedge）被探索者 §1 **完全翻案**——嵌套 workspace 是一期盲区。
- **7/7 结论**：一期该家核心机制高度可靠（75/86）；错误集中在数值抄录与两处「搜索范围当全仓」的「未发现」；探索者翻案 2 项 + 新增约 25 项机制。

---

# 三期总结（2026-09-22）

## 总账

| 仓库 | 断言数 | ✅ | ❌ | ⚠️ | 探索者新增 |
| --- | --- | --- | --- | --- | --- |
| 1/7 Step-Code | 84 | 75 | 7 | 2 | ~20 项 |
| 2/7 MiMo-Code | 96 | 86 | 5 | 5 | ~25 项 |
| 3/7 kimi-code | 96 | 94 | 0 | 2 | ~15 项 |
| 4/7 deepseek-harness | 68 | 67 | 1 | 0 | ~20 项 |
| 5/7 minimax-code | 58 | 52 | 4 | 2 | ~25 项 |
| 6/7 qwen-code | 111 | 105 | 4 | 2 | ~25 项 |
| 7/7 ZCode | 86 | 75 | 5 | 6 | ~25 项 |
| **合计** | **599** | **554** | **26** | **19** | **~155 项** |

**总体准确率 ≈92.5%（554/599）**；26 条证伪**全部已就地修正**（正文各处「三期核对」标注）。

## 证伪的类别分布（教训）

| 类别 | 条数 | 例 |
| --- | --- | --- |
| **引用/归属级**（事实对、出处错/张冠李戴） | ~12 | drift gate 误归属、MCP 披露误植、KV 引文出处、code-review 路径、variantFor 类比误植 |
| **数值/枚举抄录** | ~9 | 25/26 字段、27/29 字段、3/4 方言、上限表三处、6/11 枚举 |
| **「未发现」搜索范围过窄** | ~4 | ZCode 压缩与缓存锚（嵌套 workspace 盲区）、MiniMax 图片管线、Step JSON 修复链 |
| **机制误读** | ~1 | Step 的 step-* 工具名（实为 toolCallId） |

**结论**：一期记录的**机制层结论全部成立**（无一被推翻方向）；错误集中在抄录层与搜索范围层——这正是双角度规程的价值所在。

## 三期新挖掘的跨厂商共性候选（补充 C25–C31）

| # | 共性 | 实证 |
| --- | --- | --- |
| C25 | **配额 vs 限流的语义分流**（同为 429） | Step NON_RETRYABLE_LIMIT · kimi QuotaExhausted · qwen AllocationQuota fail-fast · MiniMax 16 类含 TPM/配额/余额 · deepseek persistent/bounded 两档 |
| C26 | **流式响应的重试安全边界** | MiniMax「可见增量=提交边界」+缓冲重放 · qwen replay/continuation 分离 · ZCode 安全锚点+10 次恢复 · Step「ended without」白名单 |
| C27 | **上下文窗口的动态校准** | kimi 观察式学习（413 探针）· qwen DashScope 真实上限解析 · ZCode token 双源（usage 优先）· MiMo 静默溢出三形态 |
| C28 | **循环/无进展检测的工具语义化** | kimi repeat breaker · MiMo try-best（Jaccard/命令归一化）· MiniMax runaway 六信号 · deepseek repeat-tool-reminder · ZCode 每回合警告预算 |
| C29 | **「服务端反馈 > 本地估算」** | qwen reactive-degrade · kimi 窗口学习 · ZCode 空响应还原 providerCode |
| C30 | **read→edit 回路的失败自愈** | MiniMax 行号前缀剥离 · Step Unicode 归一 · ZCode levenshtein+行号剥离 · MiMo 三级替换器 |
| C31 | **拒绝/失败的教学化**（错误附带下一步动作） | deepseek sandbox 升级 hint · MiniMax 续读协议 · qwen edit 自诊断 · ZCode rapid-refill 的「分块读取」提示 |

## 对 DeepOrca 方案的增量输入（按三期发现重排 P 级优先级）

三期发现使原方案的 P 级清单需要**增补与重排**（待并入 v5 方案，此处仅记录）：

1. **P0 增补候选**：C25（配额/限流分流——DeepOrca `llm-error.ts` 现无此分）；C30（read→edit 自愈——snippet_id 之外的失败驱动互补路径）
2. **P1 增补候选**：C26（流式重试边界——DeepOrca 断流即整轮失败）；C27（窗口动态校准——与「端点试探」同构，天然互补）；ZCode 式「输出预留从分母扣除」的统一预算口径
3. **P2 增补候选**：C28（循环检测工具语义化——比纯文本 ngram 更准）；C31（教学化拒绝）；MiniMax 式 16 类错误枚举
4. **三期最强单点推荐**（跨七家评分）：**kimi 观察式窗口学习**（机制最小、收益直接、与 v4 端点试探哲学完全同构）+ **MiniMax 流式重试提交边界**（解决普适痛点）+ **ZCode microcompact + rapid-refill 熔断**（压缩分层 + 死循环封口）

---

# 四期补测：子家族与代际断层专项（2026-09-22）

> **缘由**（用户 2026-09-22）：家族内部存在**代际/架构断层**，一家一画像粒度不够。点名五组：kimi-2.7/2.8（与 K3 完全不同）、glm-5.3-flash 子系、deepseek V4 vs V4.1（完全不同架构）、qwen3.8 vs 3.8-next-flash（不同架构）、minimax m3.1。
> **方法**：① models.dev 快照**强制刷新**（223 providers / 8003 models，2026-09-22）逐型号比对；② 七家仓库 grep 逐型号分支；③ 公开资料查证架构事实。

## 一、★ models.dev 的 `family` 字段本身就承认了断层

刷新快照实测，五组中有四组在目录里**已经是两个 family**——子家族键不需要我们发明，**数据已分层**：

| 用户点名组 | 目录 family 划分 | 数据差异实证 |
| --- | --- | --- |
| kimi 2.5–2.8 vs K3 | **`kimi-k2` vs `kimi-k3`** | k2.5 toggle+budget(≤81920)/temp=true/256K/out 32K vs **k3 toggle+effort[low,high,max]/temp=false/1M/out 128K** |
| glm-5.3 vs 5.3-flash | **`glm` vs `glm-flash`** | 5.3 attach=**false**（纯文本）vs flash attach=**true**（原生视觉）；effort 同为 [low,high,max]；另有 flashx 同 flash |
| deepseek flash 系 vs pro | **`deepseek-flash` vs `deepseek-thinking`** | flash attach=true（V4.1-Flash 原生多模态）vs pro attach=false；effort 已趋同（快照更新后 pro 也 [low,high,max]） |
| minimax M2 系 vs M3 | **`minimax` vs `minimax-m3`** | M2 全系（M2/M2.1/M2.5/M2.7）ro=**[]**/temp=true/attach=false/**204K** vs M3 ro=[toggle]/attach=true/**1M**/out 512K |
| qwen 3.8 vs 3.8-next | 同为 `qwen`（**未分层**） | 3.8-flash/max 官方：toggle+effort[low,medium,xhigh]+budget(≤262144)/1M/131K；**flash-next 仅在第三方（requesty/amd），官方 DashScope 未列** |

## 二、五组逐一结论

### 2.1 kimi：K2.5+ 与 K3 确为两代架构；K2.8 用「同 id 换模型」

- **K2.5**（2026-01-27）：开源 1T MoE、A32B（384 专家选 8）、61 层、原生多模态、Agent Swarm（至多 100 子代理）、MuonClip+QK-Clip。
- **K2.7 Code**（2026-09 初）：编程专项（效率/成本优化）；官方目录 `kimi-k2.7-code` ro=**[]**（无结构化档位）、temp=**false**。
- **K2.8 Preview**（2026-09-11，Kimi Code 平台全量）：**Model ID 保持 `kimi-for-coding` 不变**（官方明示「客户端无需修改配置」）、1M 上下文全员开放、图像/视频多模态、**low/high/max 三档 effort 与 K3 对齐**、性能逼近 K3——被定位为「K2 系向 K3 过渡」。
- **K3**（2026-07）：完全不同的架构——2.8T、~104B active、**Stable LatentMoE（896 专家选 16+2 共享）**、**Kimi Delta Attention（混合线性注意力）**、Attention Residuals、NoPE、原生视觉 + 1M。
- **仓库实证**：kimi 自家 `acp-server/src/model-catalog.ts:45` `TOGGLEABLE_THINKING_MODELS = new Set(['kimi-for-coding','kimi-code'])`——第一方的答案是**稳定别名 + 服务端目录元数据**（capabilities `thinking`/`always_thinking`、`default_effort`、`support_efforts` 运行时下发），客户端零代际硬编码。Step 与 MiniMax(pi) 均 `kimi-coding → kimi-for-coding` 别名。qwen-code 有 kimi-k3 逐型号正则（`tokenLimits.ts:275,323`：1M 窗口/128K 输出；`modalityDefaults.ts:95`：image+video）。
- **k2.8/k2.7 字样在任何仓库源码中零命中**——它们活在别名之后。

### 2.2 glm-5.3-flash：GLM-5 系**首个原生多模态**模型，独立子家族

- 官方文档：GLM-5.3-Flash/FlashX 是 **GLM-5 系列首个原生多模态模型**；混合稀疏架构 **320B 总参 / 仅 18B 激活**；30T token 多模态基座**原生**训练（非文本模型后期融合视觉）；1M 上下文。
- **相比 GLM-5.3：注意力计算量降 3.01×、KV 缓存降 4.44×**——架构级缓存差异（对 DeepOrca 的 H 系缓存策略有直接影响：flash 的缓存经济学完全不同）。
- 目录实证：`glm-5.3`（attach=false，fam=glm）vs `glm-5.3-flash`/`flashx`（attach=true，fam=**glm-flash**）；effort 同为 [low,high,max]（无 disabled → 思考不可关）。
- 仓库实证：qwen-code `modalityDefaults.ts:83` `[/^glm-5\.3-flash/, {image:true}]` 注释明说「**natively integrates vision input (no v suffix)**」——打破 GLM 的 `-v` 后缀命名惯例；ZCode modelRules 后置 `.*glm-5\.3-flash` 规则**只补 supportsImage:true**。

### 2.3 deepseek V4 vs V4.1：确为两代架构（wire 契约趋同）

- **V4**：V2 以来的 MoE 谱系（`deepseek-v4-flash`/`deepseek-v4-pro`）。
- **V4.1-Flash**（2026-09-09）：官方四支柱=「**新模型架构**、原生视觉、更强、更低推理成本」——**Causal Encoder-Decoder 架构**（prefill 仅激活 ~8B、decode 16B）、**KV cache 大幅压缩**、1M 窗口、原生视觉；官方定位「V4.1 Flash 实质替代 V4 Pro」。
- **目录对照**（快照刷新后）：`deepseek-flash`（=V4.1-Flash）、`deepseek-v4.1-flash`（alibaba-cn）、`deepseek-v4-flash` 三者 ro/窗口/输出**已趋同**（toggle + effort[low,high,max] + 1M/384K + attach=true）；v4-pro 的 effort 也从 [high,max] 扩为 [low,high,max]——**架构两代，wire 契约趋同**（对我们是好消息：deepseek 家族现有 `reasoningReplay:"content"` + effort 映射可继续覆盖，但**图片/缓存行为按代际有差**）。
- 仓库实证：`deepseek-harness` 的 `DEFAULT_MODELS` 只有 `deepseek-flash`（名 V4.1-Flash）+ `deepseek-v4-pro`；qwen-code `[/^deepseek-(?:v4|flash)/, 384K]` 输出上限正则覆盖两代。

### 2.4 qwen3.8 vs 3.8-next：Next = Qwen4 架构的开放权重预览

- **Qwen3.8-Flash**（2026-08-26 晚，闭源 API）与 **Qwen3.8-Flash-Next**（同步开源权重）：官方口径「**两者本质是同一个模型**」，Next 强调其采用**下一代（Qwen4）架构**——官方明确「Next 指下一代架构，是 Qwen4 系列的雏形，提前释出结构改动供社区构建 Qwen4」。
- 架构：**125B MoE 主模型 + 51B n-gram 嵌入表**（新组件）。
- 另有独立的 **qwen3-coder-next** 线（生成速度 2×、价格 2.3×）与 qwen3-next-80b-a3b（旧 Next 线，131K/32K）。
- **目录注意**：官方 DashScope **未列** flash-next（只在 requesty/amd 等）——用官方端点时 `qwen3.8-flash` 即该模型；**自托管/第三方才见 `-next` 后缀**。这是「同模型多 id」的镜像案例（与 kimi 的「同 id 多模型」相反）。
- DeepSeek 官方 harness 实证（互为参照）：`README.md:50`「**the model id passes through to the wire, so new DeepSeek models need no re-registration**」。

### 2.5 minimax M3.1：公开渠道暂无；M2↔M3 断层巨大

- **models.dev 刷新快照（8003 模型）与公开搜索均未见「M3.1」**——官方最新为 **M3**（2026-06-01）：自研 **MSA（MiniMax Sparse Attention）**、428B 总参/23B 激活、interleaved thinking（**起源于 M2 系**，M3 延续强化）、1M 下计算量为上代 1/20、prefill 提速 9×。
- 仓库源码 `m3.1/m3.5` 零命中。**如实结论**：M3.1 若已发布则早于目录与搜索引擎的收录窗口。
- **方案承接**：M3.1 命中 `^minimax-` 家族 → 按「M3 子家族（m3 前缀）+ 端点试探」处理；目录收录后自动获得准确数据。
- **M2↔M3 数据断层**（承接价值仍在）：M2 全系 204K/纯文本/无档位声明 vs M3 1M/视觉/toggle——DeepOrca 若把 `^minimax-` 当一家，M2 用户会拿到 M3 的 1M 阈值（错 5 倍）。

## 三、★ 对匹配层的三个新认识（方案 v5 需升级）

| # | 认识 | 证据 | 方案影响 |
| --- | --- | --- | --- |
| **F1** | **子家族键不用发明——目录 `family` 字段已分层**（kimi-k2/kimi-k3、glm/glm-flash、deepseek-flash/deepseek-thinking、minimax/minimax-m3） | 快照实测 | 家族 pattern 之外增加**子家族层**：优先消费目录 `family`；无目录时用子家族 pattern（`^kimi-k3` vs `^kimi-k2` / `^kimi-` 等） |
| **F2** | **别名层是第一方官方答案**：`kimi-for-coding` 稳定别名背后换模型（K2.7→K2.8），能力经服务端目录元数据（support_efforts/default_effort/always_thinking）运行时下发 | kimi `model-catalog.ts:45` + K2.8 发布口径 | 匹配链最前面加**别名解析**：已知别名表（kimi-for-coding/kimi-code/kimi-coding）→ 运行时目录/端点元数据定代际；**同 id 换模型是真实存在的运营模式**，纯模型串匹配对此天然失效 |
| **F3** | **「前瞻默认 + 显式钉旧」处理未来代际** | qwen-code `tokenLimits.ts:257-260`：「1M is the forward default for new GLM releases (GLM-5.2+…)** so they need no future code change**. Confirmed 200K families are pinned explicitly first」 | 子家族 pattern 用「新代默认 + 旧代钉住」写法，如 `^glm-(5\.2|[6-9]|\d{2,})` → 新默认；`^glm-5(\.[01])?` → 钉旧。**未来型号零改码** |

另：qwen 的「**同模型多 id**」（官方 3.8-flash = 第三方 3.8-flash-next）与 kimi 的「同 id 多模型」构成一对镜像——**模型串不是稳定标识**，目录 family + 运行时元数据才是。这与 v5 的「端点试探」哲学再次同构。

---

# 四期补测 · 修正与增补（2026-09-22 二次）

> 用户指正两处：① glm-5.3-flash 的「-v 后缀」归因表述；② M3.1 应查 MiniMax 自家仓库。核查后**两处均成立**，且暴露了四期首轮的一个**grep 语法假阴性**（`grep -E "a\|b"` 中 `\|` 是字面竖线非"或"——k2.7/5.3-flash/v4.1/coder-next 的"零命中"全部作废，本轮已用修正正则重搜）。

## 一、★ MiniMax-M3.1：第一方仓库已支持（models.dev 滞后）

**`MiniMax-M3.1` 在 minimax-code 仓库有 27 处提及**（四期首轮漏检系 grep bug，用户指正后修正正则命中）。**全部位于 local-runtime-v2 的 model-system 测试**（agent-model-selection / model-selection / list-models / model-ref / queue-repository）——生产代码零硬编码，**经 catalog 配置进入系统**（与 kimi 别名层同构的第一方模式）。

### M3.1 能力面（第一方测试断言实证）

| 维度 | M3.1 | 对照 M3 |
| --- | --- | --- |
| 思考模式 | **`thinking_config: { mode: 'forced_on' }`** —— **不可关**（`effort:'off'` → throw `Invalid model thinking.effort`） | `[{type:"toggle"}]` on/off 二元 |
| 档位 | **`effortOptions: ['low','high','max']`，defaultEffort `'high'`** —— 有档位 | **无档位**（"effort values do not change thinking depth"） |
| 上下文 | **`contextWindowOptions: [512_000, 1_000_000]` 离散档位**，硬校验（768K → throw `Invalid model context_limit`；2147483648 → throw） | 1M 连续 |
| 代码路径 | **不命中 `isMiniMaxM3ModelId`**（该函数精确匹配 `'minimax-m3'`，`thinking.ts:30-34`）→ 走**通用 effort 路径**（`resolveModelThinkingProtocol`） | 专用 `resolveMiniMaxM3ThinkingProtocol`（on/off + adaptive + 删字段补丁） |
| 地位 | **`defaultModel: 'minimax/MiniMax-M3.1'` + `defaultModelThinking:{effort:'max'}`**（v2 runtime 默认）；`model_order` 排 M3 之前 | 上一代旗舰 |
| limit | `{ context: 512_000, output: 128_000 }`（选 1M 档时走 contextWindowOptions） | out 512_000 |

**结论**：M3 → M3.1 是**真实的代际断层**——从「on/off 二元 + 专用补丁」跳到「forced_on + 三档 + 离散上下文档位 + 通用路径」。DeepOrca 若按 `^minimax-` 一家处理：M3.1 会被错套 M3 的 on/off 协议、M2 用户会拿到 5 倍窗口。**子家族必须三分**：`minimax-m2*` / `^minimax-m3$`（精确）/ `MiniMax-M3.1`（及未来 m3.x → 按 m3.1 形状 + 目录/试探校准）。

**证据链顺序教训**：M3.1 的存在性是「第一方仓库 > models.dev（9/22 刷新仍无）> 公开搜索」——**第一方仓库是最快的先行指标**。

## 二、★ kimi-k2.7-code 的逐型号分支（首轮 grep 假阴性翻案）

修正正则后，**k2.7 在三家仓库有专属分支**（原"零命中"作废；k2.8 仍零命中——活在 `kimi-for-coding` 别名后，结论不变）：

**① stepfun `generate-models.ts:952-959`（always-thinking 实证）**：
```ts
if ((provider === "moonshotai" || "moonshotai-cn") &&
    (id === "kimi-k2.7-code" || id === "kimi-k2.7-code-highspeed")) {
  // Kimi K2.7 Code is always-thinking. Official docs say
  // `thinking: { type: "disabled" }` is rejected, and callers can omit
  // the thinking parameter to use the enabled default.
  mergeThinkingLevelMap(model, { off: null });
}
```
→ **K2.7 Code 不可关思考**（`thinking:{type:"disabled"}` 被官方拒绝）——与 K3、glm-5.3 系、MiniMax-M3.1 同属 always-thinking 梯队。同函数还有一组**同厂商跨渠道的 per-model 修正表**：`opencode-go/kimi-k2.6`「thinking 是 on/off 不是档位」（minimal/low/medium 全 null）、`fireworks/glm-5p2` 档位折叠、`opencode-go/glm-5.2` 专属映射——**子家族 × 渠道**两维修正的实例库。

**② qwen-code `providers/presets/moonshot.ts`（K2.6 vs K2.7 vs K3 一屏对比）**：

| 型号 | 能力声明 | 窗口 | 模态 |
| --- | --- | --- | --- |
| `kimi-k3` | `thinkingMandatory: true`（注释："K3 always thinks: the API exposes reasoning_effort but no way to turn thinking off"） | 1M | image+video |
| **`kimi-k2.7-code`(-highspeed)** | **`toggleOnly: true, canDisable: false, disableField: 'thinking'`** + `thinkingMandatory: true` | 262144 | image+video |
| `kimi-k2.6` | `thinking: true`（可关，非 mandatory） | — | — |

→ **K2.6 → K2.7 的断层在预设里写死**；且 k2.7 的 `disableField` 是 **`'thinking'`（DeepSeek 式信封）**，不是 qwen 系的 `enable_thinking`——同一家族内部 wire 形状也不同。

## 三、deepseek V4/V4.1 的官方拼写口径（qwen-code 注释）

`tokenLimits.ts:247-252`：
> The official DeepSeek API serves V4 flash as `deepseek-flash` (the **`deepseek-v4.1-flash` spelling is DashScope's**); both V4 names carry the 1M window, so flash must not fall through to the 128K family rule.

→ 「同模型多 id」的官方注脚：`deepseek-flash`（官方）= `deepseek-v4.1-flash`（DashScope 拼写）。ZCode builtin.json 同时列两个拼写（`:432/:507`）。

## 四、修正：glm-5.3-flash 的「-v 后缀」表述（用户指正）

原表述「qwen-code 专门写了注释…打破了 GLM 的 -v 命名惯例」**归因不当**（引文本身无误）。修正：

- 命名惯例的**变化方是智谱自己**：GLM 历来以 `-v` 后缀标视觉（`glm-4.6v-flash` 等，qwen-code `modalityDefaults.ts:80` `[/^glm-[0-9.]+v/, {image:true}]` 即此惯例的被动适配）；**glm-5.3-flash 无 `-v` 后缀而原生含视觉**是智谱的新一代命名决定。
- **权威第一方证据是 ZCode 自家配置**：`zcode-builtin.json` modelRules 后置 `.*glm-5\.3-flash` 规则**专为其补 `supportsImage: true`**（`:454/:503` 亦列入模型清单）；qwen-code 的注释（`modalityDefaults.ts:81`）只是第三方对此的被动适配记录。
- 方案引用时以 ZCode 为主证、qwen-code 为旁证。

## 五、方法论记录

- **grep 教训**：`grep -E "a\|b"` 的 `\|` 是字面竖线——四期首轮的"零命中"结论（k2.7/5.3-flash/v4.1/coder-next）全部是假阴性，本轮修正正则后翻案 4 项。**否定性结论（"未发现"）必须用两组以上独立正则交叉验证后才可落盘**——本条已补进核对者规程。

---

# 四期补测 · 三次增补：StepFun step-5 断层（2026-09-22）

> 用户指正（2026-09-22）：**Step-Code 仓库是面向 step-5 适配的，此前 stepfun 优化方案基于 step-3.7-flash，可能需完全重写。** 核实：**成立**——Step-Code 的 `STEP_DEFAULT_MODEL = "step-5-preview"`（`defaults.ts:4`），而 DeepOrca 现有 stepfun 家族条目是 2026-08-27 针对 step-3.7-flash 写的（`model-capabilities.ts:171-184`：家族级 256K 窗口）。

## 一、目录实证（刷新快照 + Step Plan 通道）

| 型号 | effort | 窗口/输出 | 多模态 | 通道 |
| --- | --- | --- | --- | --- |
| **step-5-preview** | [low,medium,high] | **1M / 1M** | attach=true | **仅 Step Plan 订阅**（stepfun-step-plan）+ 第三方（nano-gpt/vercel 等）；**官方按量通道不列** |
| step-3.7-flash | [low,medium,high] | 256K / 256K | attach=true | 官方 + Step Plan 双通道 |
| step-3.5-flash(-2603) | **[low,high]**（无 medium！） | 256K / 256K | attach=**false** | 双通道 |
| step-router-v1 | 无声明 | 256K | false | — |

## 二、架构与定位（公开资料）

- **Step 5 Preview**（2026-09-21 前后发布）：稀疏 MoE **~600B 总参 / ~27B 激活**（3.7 的 3 倍规模）、**1M 上下文**、定位真实世界 Agentic 任务。
- **Step 3.7 Flash**：196B(+1.8B ViT) / 11B 激活、256K、400 tok/s、原生图片+视频理解。

## 三、仓库实证（Step-Code @ 2026-09-22 HEAD）

- `step-5-preview` 仅作**默认型号 id** 出现（`defaults.ts:4,15`、`environment.ts:137`、`command-compat.ts:228`），**无 per-model 专属分支**（无 kimi-k2.7 式 thinkingLevelMap 修正）——thinking 控制路径与 3.7 相同（顶层 `reasoning_effort`、不可关 off→low）。
- 即：**Step-Code 对 step-5 的适配 = 换默认 id + 既有 wire 协议沿用**。

## 四、★ 对 DeepOrca 既有 stepfun 条目的影响判定

**wire 协议层（保留，不需重写）**：顶层 reasoning_effort、思考不可关（off→low）、`delta.reasoning` 读取、`max_tokens` 字段、assistant 纯字符串、会话亲和——step-5-preview 沿用同一协议（第一方仓库零新分支佐证）。

**能力/子家族层（必须重写）**：

| DeepOrca 现状（2026-08-27，针对 3.7） | 问题 | 修正 |
| --- | --- | --- |
| 家族级 `contextWindowTokens: 256K` | **step-5-preview 用户会在 256K 被压缩——比真实窗口早 4 倍** | 子家族拆分 + 前瞻默认：`^step-5` → 1M；`^step-3` 钉 256K |
| `THINK_LEVELS_BY_FAMILY.stepfun = [low,medium,high]` | **step-3.5 系只有 [low,high]**——medium 对 3.5 是无效档 | 子家族档位表（或目录 `reasoning_options[].values` 驱动——P0.2 已覆盖） |
| 家族级 `multimodal: true` | step-3.5 纯文本（attach=false） | 目录 `attachment` 驱动（P0 已覆盖） |
| `FAMILY_MODEL_SUGGESTIONS.stepfun = [step-3.7-flash, step-router-v1]` | 缺 step-5-preview | 建议列表更新 |
| `MODEL_OVERRIDES` 无 step-5 | — | step-5-preview 登记（1M 窗口、思考默认开） |

**结论**：不是「方案完全重写」，而是**wire 层保留 + 能力层按子家族重写**——且大部分修正（窗口/档位/多模态）恰好被 v5.1 的「数据外置 + 目录驱动」设计天然承接：step-5-preview 在目录中数据齐全（1M/档位/attach），**P0 目录驱动落地后 stepfun 能力层自动正确，仅需补子家族 pattern（1M 前瞻默认）与建议列表**。

---

# 四期补测 · 收官：C32「新一代统一 1M 窗口」（2026-09-22）

> 用户指出（2026-09-22）：其点名的各家族**新一代模型全部为 1M 上下文**。逐型号核对（官方/第一方条目）：**成立**。

## 实测矩阵

| 新一代模型 | 窗口 | 输出 | 旧代对照（窗口） |
| --- | --- | --- | --- |
| kimi-k3 | 1,048,576 | 131,072 | k2.7-code 262,144 |
| kimi-k2.8 | 1M（发布口径"全员开放"；目录未收录） | — | k2.5 262,144 |
| glm-5.3 / 5.3-flash | 1,000,000 | 131,072 | glm-5/5.1 200,000（GLM 5.2 起已先行 1M） |
| deepseek-flash / v4.1-flash / v4-pro | 1,000,000 | 384,000 | （deepseek 家族自 v4 起即 1M） |
| qwen3.8-max / flash | 1,000,000 | 131,072 | qwen3-next 系 131,072 |
| MiniMax-M3 / M3.1 | 1,048,576 / 离散 [512K,1M] | 512,000 / 128,000 | M2 全系 204,800 |
| step-5-preview | 1,000,000 | 1,000,000 | step-3.x 256,000 |

**结论（C32）**：1M 是 2026 下半年新一代的**统一窗口基准**——代际线即 1M 线（七家无一例外；仅 k2.7-code 与 M3.1 的 512K 档为局部例外，由目录/离散档位承接）。

## 方案推论

1. **子家族登记统一简化**：「新代前瞻默认 = 1M」成为跨七家共用的一条规则（qwen-code 的 GLM 写法推广到全部家族）；各家族只需写**代际边界**（kimi k3+ / step 5+ / glm 5.2+ / minimax m3+ / deepseek v4+ / qwen 3.8+），值统一；旧代按各自值钉住。
2. **压缩策略从"改进"升为"必需"**：1M 窗口 + 现有预检 0.9 比例 ⇒ **~900K token 才触发压缩**——单次请求 input 成本、prefill 延迟、摘要副调用规模都被放大一个量级。P1 的三档阶梯、输出预留扣分母、摘要预算、rapid-refill 熔断全部前置为刚需；同时"压缩触发跟随窗口比例（七家共识）vs 设经济上限"记为**产品可配置项**（`settings.compactTokenThreshold` 已有覆盖机制，DeepOrca 的 deepseek 512K 触发值即此类产品值——"触发值≠窗口"）。
3. **token 计量精度权重放大**：1M 下 5% 计量误差 = 50K token——本地计数（DeepSeek 精确 BPE / 其它家族启发式）的校准（T6：CJK 处理、工具入参计入）重要性提升。
4. **缓存收益线性放大**：1M 前缀未命中的成本巨大——H 系（锚点/装配指纹/miss 归因）与 DeepSeek 硬盘缓存（24h）的价值随窗口放大；miss 归因（H7）成为成本控制的核心仪表。
