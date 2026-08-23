---
type: package
title: "@deeporca/core Overview"
description: The core package's public API export surface, directory layout, no-UI-dependency principle, ESM build notes, and how tests are run.
tags: [core, package, api-surface]
---

# @deeporca/core Overview

`@deeporca/core` is DeepOrca's engine library: LLM session management, 8 built-in tools, MCP client, permissions, settings, semantic routing, Actions, task tree. **No UI dependency** (doesn't import react/electron, no direct console.* — the host injects the logger), consumed by `@deeporca/desktop`.

- `main`/`types`: `dist/index.js` / `dist/index.d.ts`; exports also include the `./capabilities` subpath (model-capabilities).
- Dependencies: `openai`, `undici`, `@modelcontextprotocol/sdk`, `zod`, `ejs`, `gray-matter`, `ignore`, `chalk`, `@deeporca/embedding`.
- Tests: `node src/tests/run-tests.mjs` (node:test + tsx, Node ≥ 22.5 guard).

## Directory Layout

| Directory | Responsibility | Deep-dive page |
| --- | --- | --- |
| `src/session.ts` (~6000 lines) | `SessionManager` class | [Architecture/Session Lifecycle](../architecture/session-lifecycle.md) |
| `src/settings.ts` | Settings schema, parsing, endpoints, model registration | [settings](settings.md) |
| `src/prompt.ts` | Prompt templates | [Architecture/Prompt System](../architecture/prompt-system.md) |
| `src/tools/` | `ToolExecutor` + 8 handlers | [tools](tools.md) |
| `src/mcp/` | `McpManager` + built-in server seams | [mcp](mcp.md) |
| `src/actions/` | `ActionRegistry`/`defineAction` + built-in actions | [actions](actions.md) |
| `src/routing/` | Embedded semantic routing | [routing](routing.md) |
| `src/tasks/` | `TaskTreeService` | [task-tree](task-tree.md) |
| `src/sandbox/` | Audit/policy/backends | [Architecture/Sandbox](../architecture/sandbox.md) |
| `src/common/` | Common utilities | [common-utilities](common-utilities.md) |
| `src/gitmcp/` | GitMCP slug/path resolution | [mcp](mcp.md) |
| `src/tests/` | Unit tests (50+ files) | "Focused Tests" on each page |

## Public API Export Surface (index.ts Sections)

`packages/core/src/index.ts` exports grouped by domain:

1. **App config directory**: `getUserConfigRoot`/`getProjectConfigRoot`/`getEnvVar`, `CONFIG_DIR_NAME` (.deeporca)/`LEGACY_CONFIG_DIR_NAME` (.deepcode bidirectional compatibility), workspace trust store read/write.
2. **Settings**: `resolveCurrentSettings`/`resolveSettingsSources`/`readSettings`/`writeSettings`/`writeModelConfigSelection`/`ENDPOINT_PRESETS`/`buildModelKey`, etc. + all settings types.
3. **Session**: `SessionManager`, `getProjectCode`, `getCompactPromptTokenThreshold` + types such as `SessionMessage`/`SessionEntry`/`SkillInfo`.
4. **Prompts**: `getSystemPrompt`/`getCompactPrompt`/`getRuntimeContext`/`getTools`, etc.
5. **Tools**: `ToolExecutor` + 7 handlers such as `handleBashTool`/`handleReadTool` + `DEFAULT_TIMEOUT_MS` constant + types such as `ToolCall`.
6. **MCP**: `McpManager`, `createMcpSpawnSpec`.
7. **OpenAI client family**: `createOpenAIClient`/`createSecondaryClient`/`createVisionClient`/`createEndpointClient`, `buildThinkingRequestOptions`.
8. **Files and paths**: `readTextFileWithMetadata`/`buildDiffPreview`/`gateWrite`/`gateRead`/`grantOutsideRootsFlags`.
9. **Sandbox**: full `AuditLog` suite, `SandboxPolicyEngine`, `NoopSandboxBackend`, `MacosSandboxExecBackend`/`buildSeatbeltProfile`/`detectBashSandboxBackend`, `applyQuarantinePermissionClamp`.
10. **State and history**: `normalizeFilePath`/`getSnippet`/`recordFileState`/`GitFileHistory`/`killProcessTree`/`launchNotifyScript`.
11. **Knowledge index configuration**: codegraph (`buildCodegraphMcpServerConfig`), CRG (`configureCrgVersionRoot`/`runCrgResetWithOutput`), Serena, SkillSpector, Dembrandt, `resolveModernNode`, `resolveUvBinary`.
12. **Host injection seams**: `configureSerenaController`, `configureSkillSpectorController`, `configureActivityFramesServerBuilder`, `configureGitmcpConfigBuilder`, `configureVisionServerBuilder`, `configureA2uiServerBuilder`, `configureRoutingModelDir`.
13. **GitMCP resolution**: `parseRepoSlug`/`gitmcpServerNameForSlug`/`buildGitmcpPlaceholderConfig`, etc.
14. **Model capabilities**: `supportsMultimodal`/`defaultsToThinkingMode`/`resolveModelSpec`/`resolveBackgroundLlm` + types.
15. **Permissions**: `computeToolCallPermissions`/`buildPermissionToolExecution`/`appendProjectAllowedPaths`, etc. + types.
16. **Actions**: `ActionRegistry`/`defineAction`/`dispatchToolCall`/`configureActionSpawner` + all built-in action definitions and run functions + controller seam.
17. **Task tree**: `TaskTreeService` + types.
18. **Session prompt i18n**: `configureSessionLocale`/`formatSessionPrompt`.

## ESM Build Notes

`tsc` emits extensionless relative imports, and Node ESM requires `.js`; `scripts/rewrite-esm-imports.js` patches `core/dist/` after the build. **When adding new files in core, source imports omit the extension** (the script adds it), consistent with existing files. `verbatimModuleSyntax: true` → type imports must use `import type`.

## Host Injection Pattern (Throughout the Package)

core defines seams (`configure*`/`get*`), and desktop injects implementations at startup: controllers (serena/skill-spector/crg/codegraph/wiki), MCP builders (vision/a2ui/activity-frames/gitmcp), Spawner (action-ipc), vendor roots (codegraph/crg/uv/skill-spector/routing model dir), logger (routing/skill-spector). Violating this pattern (deriving vendor paths from `__dirname` inside core) previously caused semantic routing to fail silently.

## Related Pages

- [Architecture Overview](../architecture/overview.md), [Session Lifecycle](../architecture/session-lifecycle.md)
- [settings](settings.md), [tools](tools.md), [mcp](mcp.md), [actions](actions.md), [routing](routing.md), [task-tree](task-tree.md), [common-utilities](common-utilities.md)