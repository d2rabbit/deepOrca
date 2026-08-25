---
type: package
title: Common Utilities Library (common/)
description: "The common utilities of core are grouped by responsibility: OpenAI client family, host integration and runtime resolution, files and state, errors and diagnostics, networking and security, and session assistance."
tags: [common, utilities, openai-client]
---

# Common Utilities Library (common/)

`packages/core/src/common/` houses leaf utilities shared by session, tools, mcp, and actions. They are grouped below by responsibility, to avoid a document that is merely a listing of names.

## OpenAI Client Family (First-Class Citizen)

`common/openai-client.ts` (8.3KB):

- `createOpenAIClient(settings)`: primary session client (retry, timeout, streaming; DeepSeek endpoint adaptation).
- `createSecondaryClient`: background/secondary model client (review, indexing, sub-agents, memory extraction).
- `createVisionClient`: vision model client.
- `createEndpointClient(endpoint)`: constructs an endpoint client from an `EndpointConfig`.
- Consumers: `SessionManager.activateSession` (primary), memory `DeepOrcaHostAdapter` (LLM bridge, see [memory](../memory/overview.md)), executor (WebSearch/WebFetch backend).

`common/openai-thinking.ts`: `buildThinkingRequestOptions` (see [Message Conversion](../architecture/message-conversion.md)).
`common/openai-message-converter.ts`: message conversion (see [Message Conversion](../architecture/message-conversion.md)).

## Host Integration and Runtime Resolution

| Module | Responsibility |
| --- | --- |
| `app-dirs.ts` | Config root compatible with both `.deeporca` and `.deepcode`; `getProjectCode` (project code, storage directory key); workspace trust store read/write (`readWorkspaceTrustStore`/`writeWorkspaceTrustStore`) |
| `sqlite-runtime.ts` | `resolveModernNode` (Node 22.5+ binary resolution, node:sqlite requirement); `CodegraphExecutable` type |
| `uv.ts` | `resolveUvBinary`/`configureUvVendorRoot` (shared uv resolution for CRG/Serena/SkillSpector) |
| `shell-utils.ts` | `findGitBashPath`/`resolveShellPath`/`setShellIfWindows` (Windows bash tools must use Git Bash) |
| `process-tree.ts` | `killProcessTree` (cleans up the process tree during session cleanup) |
| `spawn-tracked.ts` | **`spawnTracked` 加固单次子进程 runner**（`configureSpawnTrackedLogger` 注入 host 日志，core 从不直接 console）：`exit` 权威结算 + 2s stdout 冲刷宽限、硬超时（SIGKILL + reject）、心跳钩子带 `finishOk()` 强制按成功结算（权威完成标记——工作已完成只剩 exit 卡住时不得报失败）、单次结算防护、stderr 即时入 host 日志。wiki/CRG/OCR CLI 适配器共用的**唯一**实现（desktop 不得反向复制，见 [desktop/main-tools](../desktop/main-tools.md)） |
| `bash-timeout.ts` | `clampBashTimeoutMs` + increment/decrement constants |
| `notify.ts` | `launchNotifyScript` (system notification when a task completes) |

## Files and State

| Module | Responsibility |
| --- | --- |
| `file-utils.ts` | `readTextFileWithMetadata` (line number/line ending/size), `writeTextFile`, `buildDiffPreview`, `ensureParentDirectory`, `configureFileUtilsWriteBoundary` (grant-aware write boundary fallback), `PathBoundaryError` |
| `state.ts` | `normalizeFilePath`/`getSnippet`/`recordFileState`/`clearSessionState` (read tool snippet state machine) |
| `file-history.ts` | `GitFileHistory`: session-level lightweight Git repository (undo snapshots, `file-history/.git`) |
| `path-boundary.ts` | `gateRead`/`gateWrite`/`PathGrant`/`GateVerdict` (see [Architecture/Sandbox](../architecture/sandbox.md)) |

## Errors and Diagnostics

| Module | Responsibility |
| --- | --- |
| `error-logger.ts` | `logApiError` (writes API errors to disk) |
| `llm-error.ts` | `describeLlmError`/`classifyLlmError`/`getLlmErrorDetails` (CONTEXT_WINDOW_EXCEEDED/TIMEOUT classification, drives automatic recovery) |
| `debug-logger.ts` | `logOpenAIChatCompletionDebug` (DEEPORCA_DEBUG conditional compilation) |

## Networking and Security

| Module | Responsibility |
| --- | --- |
| `public-url.ts` | `validatePublicHttpUrl` (SSRF defense, used by WebFetch) |
| `validate.ts` | `executeValidatedTool`/`semanticBoolean` (semantic parsing of boolean parameters) |
| `permissions.ts` | Permission engine (see [Architecture/Permission System](../architecture/permission-system.md)) |

## Session Assistance

| Module | Responsibility |
| --- | --- |
| `session-prompts.ts` | `configureSessionLocale`/`formatSessionPrompt` (zh/en session prompt i18n; the 98KB messages live in the renderer; only prompt keys and formatting are here) |
| `resume-synthesis.ts` | Resume synthesis for suspended tool calls (TOOL_NOT_STARTED/TOOL_OUTCOME_UNKNOWN) |
| `compaction.ts` | Compaction helpers (thresholds/segmentation, see [Session Lifecycle](../architecture/session-lifecycle.md)) |
| `bucket-sample.ts` | Bucket sampling (three-state per-call banding for the design.audit analysis layer) |
| `analysis-status.ts` | Three-state analysis status (pending/running/done) |
| `os-link.ts` | Cross-shell command dictionary: `getOsLinkEntry`/`renderOsLinkPromptSection` (stable runtime context injection + bash tool documentation guidance) |
| `skill-match-cache.ts` | Skill match result cache |
| `tool-call-repair.ts` | Weak model self-healing (see [Message Conversion](../architecture/message-conversion.md)) |
| `tool-execution-gate.ts` | Execution-layer gate (see [Permission System](../architecture/permission-system.md)) |
| `tool-types.ts` | Types such as `ToolHandler`/`ToolCall`/`ToolExecutionContext`/`WebPageFetcher`/`BashSandboxSpawner` |
| `bucket-sample.ts` / `think-level.ts` / `codegraph.ts` / `crg.ts` / `serena-mcp.ts` / `skill-spector.ts` / `dembrandt.ts` | See [mcp](mcp.md) and the respective knowledge index pages |

## Focused Tests

- `path-boundary.test.ts`, `shell-utils.test.ts`, `process-tree.test.ts`, `llm-error.test.ts`, `error-logger.test.ts`, `bucket-sample.test.ts`, `os-link.test.ts`, `resume-synthesis.test.ts`, `analysis-status.test.ts`, `skill-match-cache.test.ts`.

## Related Pages

- [Architecture/Session Lifecycle](../architecture/session-lifecycle.md), [Architecture/Sandbox](../architecture/sandbox.md)
- [mcp](mcp.md) (codegraph/crg/dembrandt configuration modules)