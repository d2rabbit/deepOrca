---
type: package
title: Settings System
description: DeepcodingSettings schema, user/project settings parsing and merging, multi-endpoint model registration, model family capability registry (five series), configuration file locations, and the product's own configuration directory.
tags: [settings, configuration, models, endpoints]
---

# Settings System

`packages/core/src/settings.ts` (~50KB) defines the settings schema, parsing and merging, endpoint and model registration, and config file reading/writing.

## All DeepcodingSettings Fields

| Field | Description |
| --- | --- |
| `apiKey` / `baseURL` | Primary endpoint credentials (baseURL is derived from `env.BASE_URL` or `ENDPOINT_PRESETS`) |
| `model` / `temperature` | Primary model and temperature |
| `thinkingEnabled` / `reasoningEffort` | Thinking toggle and level (`ReasoningEffort = ThinkLevel` five levels) |
| `debugLogEnabled` | chat completion debug logging |
| `notify` | Task completion system notification script |
| `webSearchTool` / `webSearchProvider` | Search tool and first-party provider (duckduckgo/brave/tavily) |
| `mcpServers` | MCP server configuration (`McpServerConfig`) |
| `permissions` | Three permission lists + defaultMode (see [Permission System](../architecture/permission-system.md)) |
| `enabledSkills` | Skills toggle |
| `statusline` | Status line configuration |
| `memory` | Memory configuration (embedding provider, retentionDays, everyNConversations) |
| `endpoints` / `primaryEndpointId` | Multi-endpoint list and primary endpoint |
| `secondaryModel` / `secondaryEndpointId` | Background/secondary model (review, indexing, subagents; default `deepseek-v4-flash`) |
| `visionModel` / `visionEndpointId` | Built-in vision MCP plugin model |
| `routing` | Semantic routing configuration (enabled/skillTopK/mcpToolGating, etc.) |
| `streamIdleTimeoutMs` | Stream idle watchdog (default 300000ms) |
| `compactTokenThreshold` | User override for compaction trigger threshold |
| `openuiInlineMode` | OpenUI inline rendering gray toggle |
| `behaviorContext` | activity-frames behavior context injection toggle |
| `resumePendingToolCalls` | Pending tool call resume mode: `"synthesize"` (default, persists TOOL_NOT_STARTED/TOOL_OUTCOME_UNKNOWN placeholders) or `"replay"` (re-executes) |

## Parsing and Merging

- `resolveCurrentSettings(projectRoot)` / `resolveSettings`: merges user settings + project settings (project takes precedence); `ResolvedDeepcodingSettings` expands all default values.
- `resolveSettingsSources`: source priority — **env `API_KEY`/`BASE_URL` ranks highest** (overrides user/project files), then project settings, and finally user settings; `failClosedPermissionDefault`: permissions default to fail-closed.
- **信任 fail-closed 夹紧**（P0 加固，2026-08-27，commit e9578124）：`resolveSettingsSources` 收到 `workspaceTrust` 参数（来自 `effectiveWorkspaceTrust`——**首开未作答信任对话框的工作区按 quarantine 解析**）；只要工作区不是显式 `trusted`，**整个项目级执行面被夹紧**——`safeProject` 置 null，项目的 `env`/`model`/`endpoints`/`primaryEndpointId`/`memory`/`webSearchTool`/`webSearchProvider` 等字段全部失去项目覆盖力（恶意仓库无法在信任决定前拉起 MCP、把用户 API key 路由到攻击者端点或静默启动记忆抽取）。有意推翻 e6e5140a 的旧默认（旧默认未作答=trusted）。
- **Endpoint merging** (`normalizeEndpoints`): project endpoints override user endpoints by id, **duplicate ids are rejected**; the primary endpoint is determined by `primaryEndpointId`, and when not configured, a single endpoint is synthesized from env (backward compatible). **opencode 存量端点 /v1 只读迁移**（2026-08-27）：`normalizeEndpoints` 精确匹配旧预设 URL（`https://opencode.ai/zen` / `https://opencode.ai/zen/go`，无 `/v1` 后缀）并改写为带 `/v1` 的新值——OpenAI 兼容网关要求 `/v1`，老用户后台链 HTML-404 自愈；用户自定义 URL 不受影响。
- `applyModelConfigSelection`: on model switching, **thinking is constrained by the actual capabilities of the selected model/endpoint** — when a model declares `thinking === false`, thinking is force-disabled and effort is cleared, avoiding sending thinking options to unsupported models; `endpointId` and `model` are persisted atomically (prevents provider mismatch).
- env compatibility: `collectDeepcodeEnv` collects `DEEPORCA_*`/`DEEPCODE_*` environment variables (`.deepcode`/`.deeporca` bidirectional compatibility).
- Error tracing: `getLastSettingsReadError`/`resetLastSettingsReadError` (invalid/io-error).

## Configuration File Locations

| File | Scope |
| --- | --- |
| `~/.deeporca/settings.json` (or legacy name `.deepcode`) | User-level |
| `<project-root>/.deeporca/settings.json` | Project-level |
| `.env` / `.env.local` | Local secrets/configuration (gitignored) |

## Endpoint and Model Registration

- `EndpointConfig`: `{ id, name, baseURL, apiKey, models: ModelRegistration[] }`.
- `ENDPOINT_PRESETS`: preset endpoints — DeepSeek、**StepFun（`https://api.stepfun.com/v1`）与 StepFun Plan（`https://api.stepfun.com/step_plan/v1`，订阅额度计费通道，同域同模型）**、opencode Zen/Go。StepFun 的 `/v1` 段**必需**：SDK 原样拼接 `/chat/completions`，StepFun 只在 `/v1/chat/completions` 提供 OpenAI 兼容面。
- `normalizeEndpoints`: merges/validates endpoints; `buildModelKey(endpointId, modelId)` / `parseModelKey`: unique model keys across endpoints.
- `collectAllModelKeys` / `findEndpointForModel`: collection across all endpoints and reverse lookup.
- `writeModelConfigSelection` / `applyModelConfigSelection`: model selection persistence (`modelConfigKey` combines thinkingEnabled + reasoningEffort).
- When `endpoints` is missing, a single endpoint is synthesized from `env.API_KEY` + `env.BASE_URL` (backward compatible).

## Model Capability Registry (`common/model-capabilities.ts`)

- Model family registry (`ModelCapabilityRegistration`/`ModelFamilySpec`): seven family ids（`deepseek`/`stepfun`/`glm`/`kimi`/`minimax`/`qwen`/`unknown`），实际注册 **deepseek + stepfun 两个家族**（未注册家族按 unknown 语义处理）；`deepseek-chat`/`deepseek-reasoner` 仍保留注册（legacy 模型）。模块**必须零依赖**（无 Node built-ins、无 openai 导入）——renderer 经 `@deeporca/core/capabilities` 子路径直接打包。
- `resolveModelSpec({ model })` resolution order: **exact model override (matches the trimmed string against `modelPatterns`, **anchored** — `my-deepseek-v4-pro` does not count as a deepseek model) → merges into its family entry → `baseURLHostHints` hostname fallback → `UNKNOWN_FAMILY`**; `familyResolved` distinguishes "true family" from fallback. `reasoningField` (`reasoning_content` vs `thinking`) follows family.
- **StepFun 家族**（`step-3.7-flash`，2026-08-27 接入）：一厂商一家族条目的独立原则；256K 窗口、原生多模态（图+视频）、**推理常开**（API 只有 `reasoning_effort` low/medium/high，无 off——应用 thinking-off 投影到 low，xhigh/max 折叠到 high）；`^step-` 模式同时覆盖 Step Plan 通道的 `step-router-v1`（deepseek-v4-pro ↔ step-3.7-flash 路由，**多模态被服务端拒绝**——`MODEL_OVERRIDES` 置 `multimodal: false`）与纯文本 `step-3.5-flash`；推理流字段链 `["reasoning_content", "reasoning"]`（StepFun 默认线格式是 `delta.reasoning`），回放 `reasoningReplay: "omit"`（与 DeepSeek 不同，Step 无重发推理字段要求，空 `reasoning_content` 反而是外来字段）；**不注册 lightweight tier**（不能假设 text-only 兄弟模型由同一端点提供，错误 id 的后台调用会 fail-closed）。
- `resolveModelCapability`/`supportsMultimodal`/`defaultsToThinkingMode`: resolve capabilities by model/family — `deepseek-v4-flash`/`deepseek-v4-pro` default to thinking + 512K context; `deepseek-v4-flash-vision-exp` is multimodal.
- `resolveBackgroundLlm`/`findModelRegistration`: background chain (flash-vision-exp/opencode-zen·go cross-endpoint scenarios).
- `getCompactPromptTokenThreshold`: compaction threshold — **deepseek 全系 512K**（含 legacy chat/reasoner，产品 2026-08-28 决策）、stepfun 256K、未知模型 **200K**（原 128K）。
- **端点家族绑定**：`endpointModelFamily({ baseURL, registeredModelIds, fallback })`——端点 add-model 建议列表绑定到端点家族（首个可解析家族即胜出 → host 提示 → 调用方 preset fallback → unknown）；`FAMILY_MODEL_SUGGESTIONS` 为各家族策展的已知模型 id（deepseek: v4-pro/flash/flash-vision-exp；stepfun: step-3.7-flash/step-router-v1；legacy/停产 id 可解析但**不**被建议）。
- **端点额度面**：`endpointQuotaKind(baseURL)` → `"stepfun-account"`（api.stepfun.com 两通道共用，实时余额）| `"opencode-subscription"`（静态滚动限额，平台无余额 API，anomalyco/opencode#10448）| null（无额度面）；`isStepfunBaseUrl` 主机名判定。core 提供判定，desktop main 的 `endpoint-quota.ts` 做探测（见 [desktop/main-process](../desktop/main-process.md)）。
- `think-level.ts`: five-level thinking scale (low/medium/high/xhigh/max) + family mapping `mapThinkLevel` (`buildThinkingRequestOptions` selects the request shape by `thinkingProtocol`; deepseek family maps to native low/high/max; **stepfun 原生低/中/高三档**，xhigh/max 折叠到 high)。
- Tests: `model-capabilities.test.ts`（anchored matching、endpoint overrides family table、**StepFun 家族/step-router-v1 多模态否决/额度 host 映射/端点家族绑定/建议清单覆盖**）、`settings-and-notify.test.ts` (31KB)、`openai-thinking.test.ts`（five-level mapping + stepfun 顶层 `reasoning_effort` 请求形状）。

## Product's Own Configuration Directory (`<root>/.deeporca/`)

| Path | Contents |
| --- | --- |
| `settings.json` | Project settings |
| `plugins/` | Project-level CLI plugins (cwd.mjs, git-branch.mjs, model-info.mjs, session-stats.mjs, tool-usage.mjs) |
| `prototypes/` | A2UI prototype artifacts (arch-scan's update_surface output, etc.) |
| `task-trees/` | Task trace tree storage (see [task-tree](task-tree.md)) |
| `AGENTS.md` | Project agent instructions |
| `skills/` | Project-level skills (one of the default skill discovery roots) |

## Focused Tests

- `settings-and-notify.test.ts`: parsing and merging, source priority, endpoints normalization, notification script.
- `model-capabilities.test.ts`: family registry, multimodal/thinking defaults, compaction threshold.

## Related Pages

- [Architecture/Session Lifecycle](../architecture/session-lifecycle.md) (settings snapshot consumer)
- [desktop/session-bridge](../desktop/session-bridge.md) (settings IPC and model selection persistence)
- [desktop/main-process](../desktop/main-process.md) (settings save triggers memory reconcile)