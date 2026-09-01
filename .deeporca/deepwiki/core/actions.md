---
type: package
title: Actions 能力层（defineAction / ActionRegistry）
description: defineAction 定义可组合的项目能力：注册表、三面暴露（LLM 工具/IPC/组合工作流）、内置 action 族、无会话后台任务通道（runBackgroundTask）与聚焦测试。
tags: [core, actions, registry]
---

# Actions Capability Layer

`defineAction` / `ActionRegistry` (`actions/registry.ts`, `actions/types.ts`, `actions/define.ts`; design in `specs/define-action/design.md`) defines project capabilities as composable Actions. The Nth capability costs only O(1) — one `defineAction` — with no need to hand-write three bindings.

## ActionRegistry

- Constructor injects `RegistryHost`: `projectRoot`, `spawner` (child process, default `NULL_SPAWNER`), `executeMcpTool`, `runSubagent` (silent subagent), `judgeViaLlm`, `taskTrees`, `activeSessionId`, `setSessionTaskRef`, etc. — **accepts dependencies, does not create dependencies**.
- `register(def, run)`: the id must be lowercase dotted (`ACTION_ID_PATTERN`); duplicate/malformed ids throw (setup-time errors).
- `toToolDefinitions()`: generates LLM function-tool definitions (dotted id → underscore tool name, e.g. `review.run` → `review_run`).
- `actionIdForToolName(toolName)`: **round-trip resolution** from tool name to action id (per id, comparing after replacing `.` with `_`; `actions.test.ts` has round-trip assertions). **Conflicts are unreachable**: the first segment of an action tool name is a pure-lowercase id segment, so it can never start with the `mcp__` prefix — action names and the MCP namespace are naturally isolated.
- `execute(id, input, { signal })`: returns `RunHandle<O>` — `result` (rejects with `ActionError`), `onProgress` (subscribe to progress), `cancel` (idempotent). **Synchronous throws** never happen; progress is buffered until the first subscriber attaches (avoiding async-defer races with test runners).
- `list()`: stable registration order (tool-list stability).
- **`NULL_SPAWNER` semantics**: when the host has not injected a real spawner, a spawn-based action's `spawn()` returns stdout/stderr streams and `exited` that reject immediately (the error message directs callers to `configureActionSpawner`), and `resolveNodeRunner` returns null — the action fails with a clear error rather than silently not running.

## Three-Surface Exposure

```mermaid
flowchart LR
    A["defineAction"] --> R["ActionRegistry"]
    R -->|"toToolDefinitions"| L["LLM function tool"]
    R -->|"ActionList/ActionRun IPC"| I["桌面渲染层"]
    R -->|"registry.execute"| C["组合工作流（index.build-all）"]
```

- LLM surface: `SessionManager.activateSession` merges `actionRegistry.toToolDefinitions()` into the tool list; `ToolExecutor`'s action branch (parse arguments → `dispatchToolCall` (`actions/mcp-bridge.ts`) → `classifyThrownError` maps action errors to tool-result classifications) dispatches same-named tool calls back to the registry.
- IPC surface: `registerActionIpc` in desktop `action-ipc.ts` — `ActionList` (unprivileged, enumeration) + `ActionRun` (privileged, can spawn child processes); progress is pushed via `event:actionProgress`, returning a structured `ActionRunResult` (`{ ok: true, output } | { ok: false, error, code }`, with a NO_PROJECT error when there is no registry). Test `action-ipc.test.ts` (three-surface proof: ActionRun executes ping through the registry and forwards progress + result).
- Composition surface: `registry.execute` orchestrates directly (BuildJobManager uses `index.build-all` to serially build the knowledge index).

## Built-in Action Families

| Family | Definition/Run | Description |
| --- | --- | --- |
| `ping` | `actions/actions/ping.ts` | Phase-0 proof action |
| `review.*` | `actions/review.ts` + `review-controller.ts` | Open Code Review (OCR CLI); `review.run`/`review.check_available`/`review.full`; `configureReviewController` seam |
| `crg.*` | `actions/crg.ts` + `crg-query.ts` + `crg-controller.ts` | Code risk graph: reindex/visualize/graph query (`CrgGraphQuery` reads SQLite directly); `mergeReviewWithCrgRisk`, `formatCrgContextForOcr` |
| `codegraph.*` | `actions/codegraph.ts` + `codegraph-controller.ts` | reindex/list (`SdkCodegraphController` injected) |
| `wiki.*` | `actions/wiki.ts` + `wiki-controller.ts` | OpenWiki init/update/listPages/readPage (`WikiCliController` injected) |
| `wiki-variants` | `actions/wiki-variants.ts` | **变体文件谓词**（2026-08-27 双语翻译 stage 移除后的唯一幸存者）：`isWikiVariantFile` 判定 `*.zh.md`/`*.en.md`——跑过旧翻译构建的工作区仍残留变体文件，所有列表/计数面过滤它们以免显示为重复页（旧 `wiki.translate` action、`WikiPageEntry.translation` 字段与 `wiki-translate.test.ts` 已随 a17fc6fc 全部删除） |
| `index.build-all` | `actions/index-build.ts` | 一键知识索引构建（串行 **3 阶段**：codegraph → wiki → arch-scan，**arch-scan 双模式都跑**——update 跳过 arch 曾被真机反馈为「架构图没有执行」）；`IndexBuildStage` 分阶段输出；arch-scan 阶段运行在**无会话后台通道**（`runBackgroundTask`，R2-2），经 `ctx.signal` 取消；**按产物自动判别 init/update**（`hasExistingWikiArtifacts`/`hasExistingArchmaps`——已存在产物走增量 update/refresh-in-place，无论按哪个按钮；判别用**内容权重**：wiki 页/archmap > 512B 才算真产物，防止残缺 init 留下的骨架被当作已初始化）；arch-scan 完成后**后置验证**（`hasExistingArchmaps` 复查，模型没调 `save_archmap` 则阶段报错）；「首个坏阶段即停」——前序阶段真实失败则后续标 skipped，仅「未注入控制器」的 skipped 不阻断 |
| `arch-scan.run` | `actions/arch-scan.ts` | **架构图扫描**：优先走 `runBackgroundTask`（无会话后台 LLM 循环），回退 `runSubagent`；产出 **Mermaid 架构图文档**（`.deeporca/prototypes/arch-<name>.md`，经 a2ui MCP `save_archmap` 落盘），取代早期 A2UI surface JSON 输出 |
| `task.*` | `actions/task.ts` | Task tree operations (create/step/fork/switch/abandon/list/merge/recall, via `TaskTreeService`) |
| `design.*` | `actions/design.ts` | `design.materialize` (A2UI materialization) / `design.extract` (dembrandt brand extraction) |
| `design.audit` | `actions/design-audit.ts` | Three-axis automated check (design-quality audit action) |
| `browser.*` | `actions/browser.ts` | Browser sessions/commands (BrowserSkill integration) |
| `bento.create` | `actions/bento.ts` | bento template generation (vendored templates refreshed at build time) |

## Key Types

- `ActionDefinition` (id/description/parameters zod→JSON Schema), `ActionContext` (emit progress, signal, runSubagent, **runBackgroundTask**, executeMcpTool, judgeViaLlm, **completeViaLlm**（主模型自由文本补全——内容形态 action 的文本通道，判别走 judgeViaLlm flash 通道）, spawner, taskTrees, projectRoot).
- `BackgroundLlmTaskOptions`/`BackgroundLlmTaskResult`（R2-2，导出自 `@deeporca/core`）：`skill`/`prompt`/`input`/`root`/`signal`/`onProgress`；结果 `{ content, iterations }`。
- `ActionError` + `ActionErrorCode` (`ACTION_NOT_FOUND`/`INPUT_INVALID`/`ACTION_FAILED`/`CANCELLED`).
- `Spawner`/`SpawnedProcess` (line-buffered stdout/stderr async iterable; desktop `ElectronNodeSpawner` is the production implementation, injected via `configureActionSpawner`).

## Focused Tests

- `actions.test.ts` (15KB): registry registration/execution/progress buffering/cancellation.
- `phase-actions.test.ts`: phase action contract（arch-scan：无 agent 运行时返回 pending；注入 `runBackgroundTask` 时优先走它、不碰 runSubagent；缺失时回退 runSubagent；**update 模式也追踪 arch-scan 阶段**——双模式都跑，无后台通道时标 skipped 但必须存在）。
- `background-task.test.ts`（145 行）：`runBackgroundLlmTask` 零会话残留（无 sessions-index 条目/无消息 JSONL/无活动会话切换/无流）。
- `design-action.test.ts`, `design-audit.test.ts` (10KB), `design-dembrandt.test.ts` (30KB, core)。
- `action-ipc.test.ts` (desktop, 10KB): IPC surface。
- `review`-related tests are in `phase-actions.test.ts` + desktop `app-boot.test.ts`。

## Related Pages

- [Architecture/Session Lifecycle](../architecture/session-lifecycle.md) (actionRegistry injection and tool merging)
- [desktop/main-process](../desktop/main-process.md) (action-ipc wiring), [desktop/knowledge-indexing](../desktop/knowledge-indexing.md) (index.build-all consumption)
- [task-tree](task-tree.md) (backend for task.* actions)