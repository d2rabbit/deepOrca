---
type: desktop
title: IPC Contract (shared/ipc.ts)
description: IPC contract shared by main/preload/renderer: IpcRequest channels, IpcEvent events, serialization types, and privileged channel policies.
tags: [ipc, contract, types]
---

# IPC Contract (shared/ipc.ts)

`packages/desktop/src/shared/ipc.ts` (43KB) is the single source of truth for the IPC contract: **dependency-free** (type-only imports + channel constants), bundled on both the main and preload sides, with the renderer using it indirectly through preload.

## Channel List

### `IpcRequest` (renderer → main, `ipcRenderer.invoke`, ~90 channels)

Grouped by domain: app/window (PickFolder, SetProjectRoot, WindowMinimize…), session (list/get/messages/setActive/delete/rename/archive/unarchive/export), prompt (send/interrupt/pause/resume/enhance), permission (deny/adjustBashTimeout), settings/model (get/update/set/thinkingMode/sessionLocale), skills/plugins (search/refresh/readDoc/upsertMcpServer/remove/builtin*), mcp (status/reconnect), undo, workspace, git (status/stage/unstage/discard/commit/branches/checkout/stash/diff/log/commitDiff/commitFiles), codegraph, review, crg, wiki, gitmcp, editor, memory, knowledge (status/build/renderArchmap/listSymbols/readAgents), design, tasktree, a2ui (action/openWindow/requestPayload), action (list/run).

### `IpcEvent` (main → renderer, `webContents.send`, 15 channels)

`assistantMessage`, `sessionEntryUpdated`, `llmStreamProgress`, `mcpStatusChanged`, `processStdout`, `projectRootChanged`, `pluginEvent`, `codegraphProgress`, `reviewProgress`, `crgProgress`, `wikiProgress`, `a2uiSurfaceUpdate`, `a2uiWindowPayload`, `actionProgress` (unified progress stream), `sandboxStatusChanged`.

## Key Types

| Type | Description |
| --- | --- |
| `DesktopApi` | Full API shape of `window.deeporca` (preload implementation) |
| `SerializableSessionEntry` | JSON-safe form of SessionEntry (flattened processes + `archived`/`workspaceRoot`) |
| `WorkspaceGroup` / `WorkspaceSessions` | VSCode-style workspace tree |
| `KnowledgeStatusResponse` / `MemoryRoutingStatus` / `KnowledgeSymbol` | Knowledge dashboard payloads |
| `EditableSettings` / `SettingsSummary` | Editable surface of the settings panel |
| `DesignArtifactMeta`, `ReviewComment`, `ReviewProgressEvent`, `CrgIndexEntry`, `WikiPageEntry`, `WikiProgressEvent`, `CodegraphProgressEvent`, `A2uiSurfaceUpdateEvent`, `A2uiWindowPayloadEvent`, `ThinkingModeSelection`, `UndoRestoreMode` | Per-domain payloads |
| `ActionRunResult` | Structured return of ActionRun: `{ ok: true, output } \| { ok: false, error, code }` (defined in action-ipc.ts, one of the three surfaces exposed by [actions](../core/actions.md)) |

## Privilege Policy (ipc-security.ts)

The main `registerIpc` uses three-tier helpers (`createIpcHelpers`):

- `handle`: regular channels (read-only/low-risk, such as session reads, settings, knowledge status)—only accepts the main renderer.
- `handlePrivileged`: high-risk channels (file writes, running processes, MCP management, session deletion, ActionRun, KnowledgeBuild)—same validation + writes audit lines for high-risk mutations.
- `handleShared`: shared by main + tracked prototype windows (only `WindowClose`/`A2uiAction`/`A2uiRequestPayload`).

**Sender validation `isMainRenderer` in three steps**: ① `webContents.id` matches the main window → ② `isMainFrame` (subframes rejected, even from the main window) → ③ exact URL match—in production, the exact renderer file URL computed via `pathToFileURL`; in dev, the configured dev origin (exact host + port, **no prefix matching**—localhost-prefix host attacks are rejected even if a dev origin is configured). `isAllowedRendererNavigationUrl` ignores `?query`/`#hash`.

**New channel rules**: bare `ipcMain.handle` calls must not be added—one of the three tiers is required (`ipc-contract.test.ts` asserts that every known dangerous channel is in the contract and is not in the prototype allowlist).

**Silent subagent filtering** (SessionBridge): `onAssistantMessage`/`onSessionEntryUpdated` drop `isSilentSubagent` sessions—pipeline runs (index builds, etc.) never enter the renderer message stream or sidebar list; `listSessions` filters the same way.

**Workspace grouping** (workspace-registry.ts): grouped by normalized `rootKey` (resolve + realpath, lowercased on win32)—different spellings of the same physical directory don't split into two rows; temporary roots (under `$TMPDIR`) and invalid roots are excluded; the archive sidecar (archive-store.ts) merges + cascades `purgeArchivedId`.

**Change rules (AGENTS.md)**: when changing the contract, first modify `shared/ipc.ts`, then wire up the main handler and preload methods at the same time; **must not** make temporary `ipcRenderer` calls in the renderer.

## Focused Tests

- `ipc-contract.test.ts`: methods exposed by preload correspond one-to-one with IpcRequest/IpcEvent channels.
- `ipc-security.test.ts`: privileged channels reject calls from non-main renderers.
- `action-ipc.test.ts`: ActionList/ActionRun contract.

## Related Pages

- [main-process](main-process.md) (handler registration), [preload](preload.md) (bridge implementation)
- [session-bridge](session-bridge.md) (backend for session-type channels)