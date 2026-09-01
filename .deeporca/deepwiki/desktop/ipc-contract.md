---
type: desktop
title: IPC 契约（shared/ipc.ts）
description: 两端共享的 IPC 契约：IpcRequest/IpcEvent 通道清单、关键类型（含符号关系图/轨迹/构建阶段）、三档权限策略与 sender 校验、跨工作区任务树读取。
tags: [desktop, ipc, contract]
---

# IPC Contract (shared/ipc.ts)

`packages/desktop/src/shared/ipc.ts` (43KB) is the single source of truth for the IPC contract: **dependency-free** (type-only imports + channel constants), bundled on both the main and preload sides, with the renderer using it indirectly through preload.

## Channel List

### `IpcRequest` (renderer → main, `ipcRenderer.invoke`, ~90 channels)

Grouped by domain: app/window (PickFolder, SetProjectRoot, WindowMinimize…), session (list/get/messages/setActive/delete/rename/archive/unarchive/export), prompt (send/interrupt/pause/resume/enhance), permission (deny/adjustBashTimeout), settings/model (get/update/set/thinkingMode/sessionLocale), skills/plugins (search/refresh/readDoc/upsertMcpServer/remove/builtin*), mcp (status/reconnect), undo, workspace, git (status/stage/unstage/discard/commit/branches/checkout/stash/diff/log/commitDiff/commitFiles), codegraph (**list only** — `codegraph:reindex` 已删除，2026-08-27 e9da728f), review (**no raw run/check channels** — OCR 走 action 面), crg, wiki, gitmcp, editor, memory, knowledge (status/build/readArchmap/listSymbols/symbolGraph/readAgents + **gitPreflight/gitBootstrap**（2026-08-28 构建前置 git 引导，见 [knowledge-indexing](knowledge-indexing.md)）+ **EndpointQuota/EndpointTest**（2026-08-27 模型池端点化，bccb1a90）), design, tasktree (incl. `tasktree:trajectory`), a2ui (action/openWindow/requestPayload), action (list/run).

### `IpcEvent` (main → renderer, `webContents.send`, 14 channels)

`assistantMessage`, `sessionEntryUpdated`, `llmStreamProgress`, `mcpStatusChanged`, `processStdout`, `projectRootChanged`, `pluginEvent`, `crgProgress`, `wikiProgress`, `a2uiSurfaceUpdate`, `a2uiWindowPayload`, `actionProgress` (unified progress stream — OCR/codegraph 进度也走它), `sandboxStatusChanged`, `designChanged` (design-store 保存/删除广播). `codegraphProgress`/`reviewProgress` 已删除（e9da728f 僵尸契约清理）。

## Key Types

| Type | Description |
| --- | --- |
| `DesktopApi` | Full API shape of `window.deeporca` (preload implementation) |
| `SerializableSessionEntry` | JSON-safe form of SessionEntry (flattened processes + `archived`/`workspaceRoot`) |
| `WorkspaceGroup` / `WorkspaceSessions` | VSCode-style workspace tree |
| `KnowledgeStatusResponse` / `MemoryRoutingStatus` / `KnowledgeSymbol` | Knowledge dashboard payloads |
| `KnowledgeSymbolGraph` / `KnowledgeSymbolGraphNode` / `KnowledgeSymbolGraphEdge` | Display-only symbol relationship graph (R3-6): `knowledgeSymbolGraph(root, query)`; nodes carry `role: focus/caller/callee`, edges `calls/references/instantiates/implements`, `truncated` flag at the 300-edge cap |
| `KnowledgeArchmapContent` / `KnowledgeArchmapSurface` | `knowledgeReadArchmap(path)` result: exactly one of `surface` (legacy `.json`) or `markdown` (current `.md`) |
| `WikiPageEntry` | Wiki 页面条目（`title`/`path`/`mtime`）。**`translation` 字段已删除**（a17fc6fc，2026-08-27）：`wiki.translate` action 与 原文/译文 切换一并移除，遗留 `*.zh.md`/`*.en.md` 变体文件由 core `isWikiVariantFile` 谓词在列表/计数面过滤（见 [knowledge-indexing](knowledge-indexing.md)） |
| `EndpointQuotaResponse` | 端点额度（bccb1a90）：`kind=stepfun-account` → 实时余额（GET /v1/accounts，60s TTL 缓存；`type` prepaid/postpaid、`balance`/`totalCashBalance`/`totalVoucherBalance`、`fetchedAt`）；`kind=opencode-subscription` → 静态滚动限额（`limits`：5h/周/月，平台无余额 API）；无额度面的端点 `ok:false` |
| `EndpointTestResponse` | 端点连通性探测（bccb1a90）：可达性（任何 HTTP 应答）+ API 可用性（GET {baseURL}/models 鉴权）；`status` ∈ ok/auth-failed/http-error/no-models-route/network-error，附 `latencyMs`/`modelsCount`（200 且 payload 可解析时） |
| `KnowledgeBuildStageState` | One pipeline stage (`codegraph`/`wiki`/`arch-scan` — `wiki-translate` 已随 a17fc6fc 删除) with status/startedAt/endedAt/error — part of `KnowledgeBuildJobSnapshot` (plus `updatedAt` and a 500-line `logs` ring buffer). **三阶段在每次构建都跑**（含 arch-scan，不再 init-only） |
| `TaskTrajectory` / `TaskTrajectoryOp` | Operation trace over a task's bound sessions (`taskTreeTrajectory`): tool/ok/summary/files — deliberately **not** conversation content |
| `EditableSettings` / `SettingsSummary` | Editable surface of the settings panel |
| `DesignArtifactMeta`, `ReviewComment`, `CrgIndexEntry`, `WikiPageEntry`, `WikiProgressEvent`, `A2uiSurfaceUpdateEvent`, `A2uiWindowPayloadEvent`, `ThinkingModeSelection`, `UndoRestoreMode` | Per-domain payloads（`ReviewProgressEvent`/`CodegraphProgressEvent` 已随 e9da728f 删除——OCR/codegraph 进度统一走 `actionProgress`） |
| `ActionRunResult` | Structured return of ActionRun: `{ ok: true, output } \| { ok: false, error, code }` (defined in action-ipc.ts, one of the three surfaces exposed by [actions](../core/actions.md)) |

**Cross-workspace reads**（task-tree R3-7）：`taskTreeList`/`taskTreeGet`/`taskTreeReflog`/`taskTreeTrajectory`/`taskTreeFork`/`taskTreeSwitch`/`taskTreeAbandon`/`taskTreeMerge` 均接受可选 `workspaceRoot`——省略时回落到活动工作区；显式 root 时 main 侧用 `new TaskTreeService(root)` 读取该工作区已落盘的树状态（与归档处理同一一致性论证）。

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
- [session-bridge](session-bridge.md) (backend for session-type channels)s.
- `ipc-security.test.ts`: privileged channels reject calls from non-main renderers.
- `action-ipc.test.ts`: ActionList/ActionRun contract.

## Related Pages

- [main-process](main-process.md) (handler registration), [preload](preload.md) (bridge implementation)
- [session-bridge](session-bridge.md) (backend for session-type channels)