---
type: package
title: MCP Lifecycle and Built-in Servers
description: McpManager client management, stdio JSON-RPC, tool discovery caching, crash handling, and built-in MCP servers (codegraph/serena/skill-spector/dembrandt/a2ui/activity-frames/vision/gitmcp) along with the controller seam pattern.
tags: [mcp, mcp-manager, gitmcp, seams]
---

# MCP Lifecycle and Built-in Servers

`@deeporca/core` manages external capabilities through `McpManager` (`mcp/mcp-manager.ts`, 38KB): one child process per server, stdio JSON-RPC communication, and three-sided discovery of tools/prompts/resources.

## McpManager

- `initialize(servers)`: Connects to all configured servers (lazy-connect tracked by `declaredMcpServers`).
- `connectInProcessServer`: In-process servers (desktop-injected builder artifacts such as a2ui/activity-frames).
- `reconnectMcpServer(name)`: Single-server reconnect (the renderer's "Reconnect" button; `SessionBridge` calls it via `this.manager.reconnectMcpServer(name, config)`) — successfully reinitializes a previously failed server (asserted in `session.test.ts`).
- Tool discovery: caches `tools/list`; `tools/list` change notifications refresh `mcpToolDefinitions` (visible to the session manager).
- `executeMcpTool`/`getMcpPrompt`/`readMcpResource`: The three call surfaces.
- Crash handling: `onServerCrash` state handling, `pruneDisconnectedClients`, `silentlyClose`; `setStatus` pushes `McpStatusChanged`.
- Tool description construction: `buildMcpToolDescription` (long-description truncation/structuring).

### Namespacing (`buildMcpNamespacedName`)

Tool names use the format **`mcp__<server>__<tool>`**: the server name and tool name are each sanitized (illegal characters replaced/collapsed), with the API-safety constraint `/^[a-zA-Z0-9_-]+$/` and a maximum of 64 characters; name collisions get a short hash + `_N` suffix appended. The original dispatch name is preserved at the session layer (`session.test.ts` asserts: API-safe names are exposed externally, original names are used for dispatch).

### Hostile Server Boundaries (Constants)

| Boundary | Value |
| --- | --- |
| `MAX_TOOLS_PER_SERVER` | 500 (maximum tool count) |
| `MAX_TOOL_SCHEMA_CHARS` | 256KiB (schema truncation) |
| `MAX_TOOL_RESULT_CHARS` | 512KiB (result truncation) |
| `STDERR_RING_BUFFER_BYTES` | 4096 (stderr ring buffer; failed state carries the tail) |
| `MAX_PAGES` | 100 (prompt/resource pagination) |

There are also startup/invocation timeouts (`connectWithTimeout`, etc.).

### Lifecycle

State machine `starting → ready | failed | reconnecting`: **a single failed attempt stays failed (no automatic retry)** — the failed state carries the stderr tail for UI troubleshooting; recovery is triggered by the user via "Reconnect" or a new session. `declaredMcpServers` only tracks declared server names; the routing layer's `collectServerNames` provides lazy-connect hints (see [routing](routing.md)).

## Built-in MCP Servers (`SessionManager.augmentMcpServersWithBuiltins`)

| Server | Condition | Implementation Form |
| --- | --- | --- |
| `codegraph` | Project has `.codegraph/` and not disabled | Child process (npm-shim.js); indexing/sync goes through the desktop `SdkCodegraphController` |
| `serena` | uv available and not disabled | Host-injected `SerenaController.buildMcpServerConfig` (SolidLSP, symbol operations for 40+ languages) |
| `skill-spector` | uv available and not disabled | `SkillSpectorCliController` (AI skill/MCP security scanning; installed from git+SHA — the PyPI package is malware) |
| `dembrandt` | Project has design context (designs/ or `.deeporca/DESIGN.md`) and not disabled | Pinned npx spawn (self-managed Playwright browser); URL → W3C DTCG tokens / DESIGN.md + drift gate |
| `a2ui` | Desktop-injected builder | In-process `deeporca-a2ui` server (11 tools incl. `save_archmap`; see [design-system](../desktop/design-system.md)) |
| `activity-frames` | Desktop-injected builder | In-process behavioral memory server (see [activity-frames](../desktop/activity-frames.md)) |
| `vision` | `visionModel` non-empty | Desktop-injected `VisionServerBuilder` (built-in vision MCP plugin) |
| `gitmcp:*` | Dynamic prefix | One server per GitHub repo (placeholder config → host resolves the real spawn) |

## Controller Seam Pattern

core defines the seams; desktop injects implementations at startup (AGENTS.md red line: vendor paths and implementations are always provided by the host):

- `configureSerenaController`/`getSerenaController` (`actions/serena-controller.ts`)
- `configureSkillSpectorController`/`getSkillSpectorController`
- `configureActivityFramesServerBuilder`/`getActivityFramesServerBuilder` (`mcp/activity-frames-seam.ts`)
- `configureVisionServerBuilder`/`getVisionServerBuilder` (`mcp/vision-seam.ts`)
- `configureA2uiServerBuilder`/`getA2uiServerBuilder`/`setA2uiDisabled`/`isA2uiDisabled` (`mcp/a2ui-seam.ts`) — the `A2uiLifecycle` seam also exposes **scoped persistence**: `persistSurfaces(projectRoot, idPrefix?, sinceStamp?)` (prefix-scoped flush for background tasks; unknown files never swept) and `surfaceStamp()` (monotonic mutation stamp for "flush exactly what THIS task produced" — see [design-system](../desktop/design-system.md) and [session-lifecycle](../architecture/session-lifecycle.md)).
- `configureGitmcpConfigBuilder`/`getGitmcpConfigBuilder` (`mcp/gitmcp-seam.ts`)

## GitMCP Module (`gitmcp/resolve.ts` + desktop `main/tools/gitmcp/`)

- `parseRepoSlug`: Repository slug parsing; `gitmcpServerNameForSlug`/`gitmcpSlugFromServerName`/`isGitmcpServerName`: namespace conversion.
- Placeholder config: `buildGitmcpPlaceholderConfig` (`{ command: "gitmcp" }`) → replaced with a real spawn by `resolveGitmcpServers` within the session; unresolvable placeholders are kept so failures surface as visible server errors rather than the repo silently disappearing.
- `GITMCP_SERVER_PREFIX`/`GITMCP_PLACEHOLDER_COMMAND`; `buildGitmcpMaintenanceCommand`/`resolveGitmcpServerEntry`.
- Desktop side: 8 gitmcp tools (the four zread research enhancements were tracked as a separate case, commit bdc6227a), tested in `gitmcp-tools.test.ts` (22KB).

## spawn-spec

`mcp/spawn-spec.ts`: `createMcpSpawnSpec`/`McpSpawnSpec` — constructs a controlled spawn spec from `McpServerConfig` (command/args/env) with env filtering and cwd constraints. **Non-Windows startup stays shell-free** (direct exec, no shell parsing — asserted in `mcp-client.test.ts`); the necessary shell-based scenarios on Windows are handled separately.

## Focused Tests

- `mcp-client.test.ts`: Client protocol (initialize/tools.list/execute).
- `codegraph.test.ts`: codegraph configuration and disabled flag.
- `gitmcp-tools.test.ts` (desktop): End-to-end paths for the 8 tools.
- Built-in server augmentation path in `session.test.ts` (augmentMcpServersWithBuiltins).

## Related Pages

- [Architecture/Session Lifecycle](../architecture/session-lifecycle.md) (tool merging, lazy-connect)
- [desktop/main-tools](../desktop/main-tools.md) (CLI controller implementations)
- [desktop/activity-frames](../desktop/activity-frames.md), [desktop/design-system](../desktop/design-system.md)