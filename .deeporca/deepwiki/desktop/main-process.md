---
type: desktop
title: Main Process Composition Root (main/index.ts)
description: Electron main process startup sequence, module-level singletons, IPC registration groups, window security policy, controller injection, and lifecycle cleanup.
tags: [electron, main-process, ipc, composition-root]
---

# Main Process Composition Root (main/index.ts)

`packages/desktop/src/main/index.ts` (~2300 lines) is the composition root of desktop: it boots Electron, injects all core seams, registers all IPC, and manages window and process lifecycle.

## Module-Level Singletons

| Singleton | Description |
| --- | --- |
| `bridge` (SessionBridge) | `getBridge()` lazily creates, wraps SessionManager per projectRoot |
| `pluginManager` | Plugin/skill/MCP server management |
| `memoryManager` | In-process memory pipeline (module-level functions `startMemory`/`stopMemory`/`reconcileMemory`) |
| `buildJobs` (BuildJobManager) | Background knowledge indexing build jobs (R2-1) |
| `prototypeWindows` | A2UI prototype popup window registry |

## Startup Sequence

```mermaid
sequenceDiagram
    participant App as app
    participant Main as main/index.ts
    participant Core as @deeporca/core
    participant Bridge as SessionBridge
    participant Mem as @deeporca/memory

    App->>Main: app.whenReady()
    Main->>Main: V8 性能参数（whenReady 之前）
    Main->>Main: configure*Controller 批量注入（serena/skill-spector/crg/codegraph/wiki/vision/a2ui/activity-frames/gitmcp/routing）
    Main->>Main: setShellIfWindows + resolveModernNode(22)
    Main->>Main: createWindow（frame:false、contextIsolation、导航封锁）
    Main->>Bridge: 创建 SessionBridge（resolveInitialRoot）
    Main->>Mem: startMemory()（settings.memory.enabled 时）
    Main->>Main: registerIpc()（各 register*Ipc 组）
    Main->>Main: refreshVendoredToolsInBackground()
```

- **Controller injection** (AGENTS.md red line: vendor paths and implementations are provided by the host): `configureSerenaController`, `configureSkillSpectorController`, `configureCrgController`, `configureCodegraphController`, `configureWikiController`, `configureVisionServerBuilder`, `configureA2uiServerBuilder`, `configureActivityFramesServerBuilder`, `configureGitmcpConfigBuilder`, `configureRoutingModelDir`/`configureRoutingLogger`, `configureActionSpawner` (`ElectronNodeSpawner`), `configureDembrandtVendorRoot`/`configureDembrandtCdpEndpointGetter`, `configureUvVendorRoot`/`configureCrgVersionRoot`, `configureSpawnTrackedLogger`（core `spawnTracked` 的 host 日志注入，`console.log`）。
- **Wiki language**: `WikiCliController.getLanguage` returns the **app UI locale** (synced from the renderer via `SessionLocaleSet`, mapped through `APP_LOCALE_TO_BCP47`: zh→zh-CN, zh-TW, zh-HK, ja, ko, en), not the OS locale — wiki pages come out in the language the user reads the app in (see [knowledge-indexing](knowledge-indexing.md)).
- **Window**: 1180×820, `frame:false`, `contextIsolation:true`, `nodeIntegration:false`, `sandbox:false`, `spellcheck:false`; brand icon `applyAppIcon`.
- **Window security**: `will-navigate` interception (only allows its own renderer files or dev origin; external http(s) goes through `shell.openExternal`); `setWindowOpenHandler` always denies and opens externally.
- **单实例锁**（e9da728f）：`app.requestSingleInstanceLock()` 在模块作用域求值；失败的实例 `app.quit()`，且**所有 window/进程侧 boot 副作用都收进 `gotSingleInstanceLock` 守卫**（`app.on("second-instance")` 只注册聚焦处理器）——消除「ready 先于 quit 生效时短暂起窗/抢端口」的时序窗。当前持久理由：userData 存储（session index、sqlite 库）的并发与重复启动 UX（原固定 CDP 端口争抢已随随机端口子进程根除）。
- **全局错误兜底**（e9da728f）：main 注册 `unhandledRejection`/`uncaughtException`（日志 + `main-crash.log` 面包屑）；renderer 窗口级监听 + `ErrorBoundary` 包根（黑屏根治的最后一层）。
- **dembrandt CDP 子进程**：`startDembrandtProvider` 惰性启动 `ensureDembrandtBrowserProvider`（未打包且无 vendored dembrandt 的裸 dev 检出不启动）；CDP 监听只存在于隔离子进程（随机 loopback 端口 + 私有 userData + stdout 单行握手 + stdin EOF 随父退出），主进程**不再持有任何 CDP 端口**（见 [main-tools](main-tools.md)）。

## IPC Registration Groups (`registerIpc`)

Each registration group uses `IpcHelpers` (three tiers: `handle` / `handlePrivileged` / `handleShared`; see [ipc-contract](ipc-contract.md)):

| Group | Responsibility |
| --- | --- |
| `registerCoreIpc` | Session/prompt/permissions/settings/model/skills/MCP/undo/workspace trust |
| `registerPluginsIpc` | Skill search/documentation, MCP server add/remove, built-in plugin enumeration |
| `registerFileScannerIpc` | `@file` mention scanning |
| `registerWorkspaceIpc` | Workspace session list/archive |
| `registerGitIpc` | git-service status/stage/commit/branch/diff/log |
| `registerCodegraphIpc` | Index repository **list only**（`codegraph:reindex` 通道 2026-08-27 e9da728f 删除——重建走知识构建 action 面） |
| `registerCrgIpc` | CRG availability/list/reindex/visualization |
| `registerMemoryIpc` | Memory availability/start-stop/search/stats/clear |
| `registerKnowledgeIpc` | Knowledge status aggregation (codegraph/openwiki/AGENTS/archmaps), archmap read (`KnowledgeReadArchmap`: `.md` → markdown / `.json` → A2UI surface——`.html` 板形式 2026-08-28 退役；**多工作区围栏**——目标必须位于已注册工作区 ∪ 当前 projectRoot 的 `.deeporca/prototypes/` 下且 basename 匹配 `arch-*.{md,json}`，见 [knowledge-indexing](knowledge-indexing.md)），symbol graph (`KnowledgeSymbolGraph`), KnowledgeBuild, **git preflight/bootstrap**（`KnowledgeGitPreflight`/`KnowledgeGitBootstrap`——2026-08-28 构建前置引导，handler 在 `registerKnowledgeIpc` 注册、经 `resolveRegisteredRoot` pin 到注册工作区，逻辑在 `main/git-preflight.ts`） |
| `registerDesignIpc` | Design artifacts CRUD/form state/export (ddp/ddu), symbol list (SQLite read-only), AGENTS read; `DesignChanged` 事件（`event:designChanged`，payload `{ root }`）在 design-store 保存/删除时广播，面板据此实时刷新（见 [design-system](design-system.md)） |
| `registerTaskTreeIpc` | All task tree operations — cross-workspace reads (`rootService(workspaceRoot)` spins a fresh `TaskTreeService` over a non-active root's flushed disk state; omitted root = active workspace), plus `TaskTreeTrajectory` (operation trace extraction via `main/task-trajectory.ts`, see [renderer-components](renderer-components.md)) |
| `registerA2uiIpc` | A2UI surface actions/window opening |
| `registerA2uiPrototypeWindowIpc` | Prototype window payload handshake |
| `registerWikiIpc` | OpenWiki availability/init/update/list/read |
| `registerMcpManagementIpc` / `registerGitmcpIpc` / `registerEditorIpc` / `registerAgentChangesIpc` / `registerSessionExportIpc` | MCP management, GitMCP module, Monaco editor, agent changes, session export |
| `registerActionIpc` | ActionList/ActionRun for defineAction ([core/actions](../core/actions.md)) |

**IPC 收敛（僵尸契约清理，e9da728f）**：删除无 handler 的 `ReviewRun`/`ReviewCheckAvailable`/`CodegraphReindex` 通道与永不发射的 `CodegraphProgress`/`ReviewProgress` 事件（含 preload 方法、孤儿类型、`TaskProgressPanel` 死订阅组件——OCR/codegraph 进度统一走 `actionProgress`）。**`resolveRegisteredRoot` 把 knowledge/taskTree 全族通道 pin 到注册工作区**——未注册 root 降级空态绝不枚举（与 archmap 围栏同款论证）。

## Lifecycle Cleanup

- `killHelperProcesses`: long-running child processes such as ocr/openwiki (`activeHelperProcesses` collection).
- `before-quit`: `closeEmbeddingService()` (onnxruntime handle), memory `destroy`, `cleanupLeakedSubagentSessions`.
- `subagent-cleanup.ts`: cleanup of leaked silent subagent sessions — 2026-08-27 起改为 **temp+rename 原子写**，不再有截断写导致索引清空的级联（e9da728f）。

## Focused Tests

- `app-boot.test.ts`: boot path (bridge/memory/injection assembly).
- `ipc-security.test.ts`: renderer process policy and privileged channel validation.
- `ipc-contract.test.ts`: channel consistency between preload API and main handlers.

## Related Pages

- [session-bridge](session-bridge.md), [ipc-contract](ipc-contract.md), [preload](preload.md)
- [knowledge-indexing](knowledge-indexing.md), [design-system](design-system.md), [main-tools](main-tools.md)
- [Architecture Overview](../architecture/overview.md) (layer rules)ad](preload.md)
- [knowledge-indexing](knowledge-indexing.md), [design-system](design-system.md), [main-tools](main-tools.md)
- [Architecture Overview](../architecture/overview.md) (layer rules)