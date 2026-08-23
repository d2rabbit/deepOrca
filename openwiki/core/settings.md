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
- **Endpoint merging** (`normalizeEndpoints`): project endpoints override user endpoints by id, **duplicate ids are rejected**; the primary endpoint is determined by `primaryEndpointId`, and when not configured, a single endpoint is synthesized from env (backward compatible).
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
- `ENDPOINT_PRESETS`: preset endpoints (DeepSeek, etc.).
- `normalizeEndpoints`: merges/validates endpoints; `buildModelKey(endpointId, modelId)` / `parseModelKey`: unique model keys across endpoints.
- `collectAllModelKeys` / `findEndpointForModel`: collection across all endpoints and reverse lookup.
- `writeModelConfigSelection` / `applyModelConfigSelection`: model selection persistence (`modelConfigKey` combines thinkingEnabled + reasoningEffort).
- When `endpoints` is missing, a single endpoint is synthesized from `env.API_KEY` + `env.BASE_URL` (backward compatible).

## Model Capability Registry (`common/model-capabilities.ts`)

- Model family registry (`ModelCapabilityRegistration`/`ModelFamilySpec`): five series (G0 native track, specs/model-fleet-adaptation), DeepSeek baseline registration; `deepseek-chat`/`deepseek-reasoner` also remain registered (legacy models).
- `resolveModelSpec({ model })` resolution order: **exact model override (matches the trimmed string against `modelPatterns`, **anchored** — `my-deepseek-v4-pro` does not count as a deepseek model) → merges into its family entry → `baseURLHostHints` hostname fallback → `UNKNOWN_FAMILY`**; `familyResolved` distinguishes "true family" from fallback. `reasoningField` (`reasoning_content` vs `thinking`) follows family.
- `resolveModelCapability`/`supportsMultimodal`/`defaultsToThinkingMode`: resolve capabilities by model/family — `deepseek-v4-flash`/`deepseek-v4-pro` default to thinking + 512K context; `deepseek-v4-flash-vision-exp` is multimodal.
- `resolveBackgroundLlm`/`findModelRegistration`: background chain (flash-vision-exp/opencode-zen·go cross-endpoint scenarios).
- `getCompactPromptTokenThreshold`: compaction threshold (V4 512K, others 128K).
- `think-level.ts`: five-level thinking scale (low/medium/high/xhigh/max) + family mapping `mapThinkLevel` (`buildThinkingRequestOptions` selects the request shape by `thinkingProtocol`; deepseek family maps to native low/high/max).
- Tests: `model-capabilities.test.ts` (13KB: anchored matching, endpoint overrides family table), `settings-and-notify.test.ts` (31KB), `openai-thinking.test.ts` (five-level mapping).

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