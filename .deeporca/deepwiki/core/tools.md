---
type: package
title: 内置工具与 ToolExecutor
description: 刻意精简的内置工具集（bash/read/write/edit/AskUserQuestion/UpdatePlan/WebSearch/WebFetch）与 ToolExecutor 执行契约（含 snippet 编辑）。
tags: [core, tools, executor]
---

# Built-in Tools and ToolExecutor

The built-in tool set is **deliberately minimal**: `bash`, `read`, `write`, `edit`, `AskUserQuestion`, `UpdatePlan`, `WebSearch`, `WebFetch`. This reduces pattern uncertainty, makes permission analysis tractable, and gives the model a predictable, repeatable operation language; all external capabilities go through MCP (new built-in tools are not lightly added — an AGENTS.md red line).

## ToolExecutor (`tools/executor.ts`)

- Constructor injection: projectRoot, `createOpenAIClient`, `mcpManager`, `actionRegistry`, `fetchWebPage`, `memoryTools` (MemoryToolBridge).
- Registry: `Map<string, ToolHandler>` containing all 8 handlers; alias resolution `BUILT_IN_TOOL_NAME_ALIASES` — `Bash`/`Read`/`Write`/`Edit` (Title Case) → lowercase names.
- Dispatch order: built-in handlers → MCP (`mcpManager.isMcpTool()` → `executeMcpTool`) → Action tools (`dispatchToolCall`) → memory tools (`memoryTools.invoke`, **resolved last** — the memory bridge never shadows built-in/MCP/Action tools).
- Argument parsing: JSON string parsing; on failure, a structured `InputParseError:` error is returned (remediation via `lenientParseToolArguments` takes precedence; see [Message Conversion](../architecture/message-conversion.md)).
- **1:1 result mapping**: `parseToolCall` generates synthetic failure results for malformed calls (missing id/missing function/non-string name), with **synthetic ids shaped like `invalid_tool_call_<index>`** and error name `invalid_tool_call` — exactly one output per input (no more silently dropping via `.filter(Boolean)`), guaranteeing that the assistant's N tool_calls receive N tool messages (otherwise the OpenAI protocol reports a dangling tool_call id).
- Result serialization: `{ ok, name, output?, error?, metadata? }`; `AskUserQuestion` sets `awaitUserResponse: true` to pause the loop.
- Execution hooks: `hooks.shouldStop`, `pathGrant` (derived per call), `bashSandbox` (sandbox spawner); see [Architecture/Sandbox](../architecture/sandbox.md).
- **Error classification**: INTERNAL by default; Action tool argument errors are classified as INVALID_INPUT (asserted in `tool-executor.test.ts`).
- **ToolExecutionHooks → audit bus**: `onProcessStart`/`onBeforeFileMutation`/`onAfterFileMutation`/`onPathGateVerdict` are wired by `appendToolMessages` to `sandbox/audit.ts` (`appendProcessStart`/`appendFileWrite`/`appendPathGate`) and to file-history checkpoints — file mutations both enter the audit chain and are recorded in GitFileHistory (executor end-to-end assertions in `audit.test.ts`: allow and deny gate verdicts both reach the audit hooks).

## The 8 Tools

### bash (`bash-handler.ts`)

- Side-effect declaration contract (`sideEffects` array) → permission decision; see [Permission System](../architecture/permission-system.md).
- Adaptive timeout: `clampBashTimeoutMs` + `BASH_TIMEOUT_INCREMENT_MS`/`DECREMENT_MS` (`AdjustBashTimeout` IPC), extending long-running commands as needed.
- Process tracking: `addSessionProcess`/`removeSessionProcess` (session entry `processes`), background commands, `killProcessTree`/`killLiveProcesses` (session cleanup).
- Sandbox wiring: `BashSandboxSpawner` (wraps macOS sandbox-exec); on Windows, Git Bash is used (`setShellIfWindows`).
- Output cap: `MAX_OUTPUT_CHARS`; timeout adjustment feedback (`BashTimeoutAdjustment`).
- `clearSessionWorkingDir`: session working-directory cleanup.

### read (`read-handler.ts`)

- **Snippet contract**: returns file content + session-local file state + `snippet_id` (metadata includes path, line range, preview, version, scope type).
- A file must be read before it can be edited; the snippet must belong to the current session; the file must not have been modified since it was read.
- **快路径**（2026-08-27，commit 5da928f3）：相对路径先直接 resolve 判存，命中即返回，仅未命中才付全树消歧扫描（大 monorepo 下每次踩中省数百 ms~秒级同步阻塞）；直接命中的语义等价于旧路径的 `resolvedPath` 分支。
- **大文件流式切片**：>2MB 的 offset/limit 分页走单遍流式读取（`streamSliceTextFile`，StringDecoder 跨块安全解码，行语义与 `raw.split("\n")` 逐一对齐——LF/CRLF/多字节 × 首/中/尾窗口对拍验证）；`content` 保留整行、仅 `output` 截断，维持 `markFileRead` 全量一致性。
- Supports line ranges, JSON/image metadata (`readTextFileWithMetadata`); `MAX_OUTPUT_CHARS` truncation + pagination hint.

### write (`write-handler.ts`)

- Writes the file in full; paths pass through a runtime gate (`gateWrite` + `PathGrant`); `ensureParentDirectory`.

### edit (`edit-handler.ts`, 27KB)

- **`snippet_id` is required**; searches only within the snippet's scope; non-unique matches return candidate snippets instead of guessing; batch replacements can declare the expected occurrence count.
- Strict interface validation + tolerance for recoverable text errors (paired with the weak-model self-healing layer).
- File modified externally (snippet version mismatch) → structured error requires re-reading.

### AskUserQuestion (`ask-user-question-handler.ts`)

- Asks the user a question and pauses the loop (`awaitUserResponse: true` → `waiting_for_user`).

### UpdatePlan (`update-plan-handler.ts`)

- Updates/materializes the plan (Plan Mode approval flow); consumed by `PlanCard` in the rendering layer.

### WebSearch (`web-search-handler.ts` + `web-search-providers.ts`)

- **First-party search** (privacy contract: queries go directly to the search engine + product-name UA; no machine identifiers, no third-party proxies, no analytics).
- Providers: `duckduckgo` (default, keyless), `brave`/`tavily` (opt-in API keys; the `webSearchApiKey` setting is currently **disabled** due to security-audit C5 project-level credentials; the adapter is retained for a future key-storage solution).
- Zero new dependencies: fetch + regex parsing; the timeout covers the **entire** operation (headers + body; adversarial-review round-two fix).
- Active-tab sanitization: strips bidirectional override and zero-width characters (Mimosa medium-severity issue closed, commit 2df22b4d).
- `MAX_LINKS`/`MAX_OUTPUT_CHARS` bounds.

### WebFetch (`web-fetch-handler.ts` + desktop `web-fetch-provider.ts`)

- Rendering/static fallback: prefers the built-in headless Chromium rendering (desktop injects the offscreen provider); on failure, falls back to static HTML fetching.
- `validatePublicHttpUrl` SSRF defense (`common/public-url.ts`); redirect hardening (converged via adversarial review).
- **DNS 钉扎**（P2 加固，2026-08-27，commit e9578124）：静态路径在**首跳与逐跳重定向**前调用 `assertPublicResolvedHost`（`common/public-url.ts`）——解析主机名后把全部 A/AAAA 记录（含 v4-mapped 十六进制与 RFC5952 点分双形态）过同一私网分类器；解析失败 fail-open（连接层自败，非旁路）。渲染路径（desktop `web-fetch-provider.ts`）的 `will-redirect` 同样先 `preventDefault`、挂起被取消导航的 finish/fail（含 ERR_ABORTED）、DNS 复检通过后重放，跳数上限 5 与静态路径一致（commit e9da728f）。`setPublicUrlDnsLookup` 测试桩保持单测密闭。注意残余的经典 rebinding 竞态（首查诚实、复检与引擎 connect 之间投毒）已记录并接受——只有连接级 pinning dispatcher 才能闭合。
- `DEFAULT_TIMEOUT_MS`/`MAX_OUTPUT_CHARS` exports.

## GitFileHistory (`common/file-history.ts`, undo foundation)

- One internal branch per session: `refs/heads/<sessionId>`; manifest file `.deeporca-file-history.json` (compatibility fallback to the old name `.deepcode-file-history.json`).
- `recordCheckpoint` snapshots the files "changed since the last checkpoint"; `restoreSessionCode` restores from the recorded points, **preserving files that existed before the first tracked change** (it does not arbitrarily revert untracked historical files).
- Tests: `session.test.ts` (`restoreSessionCode` restores project files from Git checkpoints; the Write tool advances file-history while preserving user-prompted checkpoints).

## Tool Templates

`templates/tools/*.md(.ejs)` are the tool documents (the instructions the LLM sees); see [Architecture/Prompt System](../architecture/prompt-system.md).

## Focused Tests

- `tool-handlers.test.ts` (42KB): bash side effects/timeouts, read snippet, edit unique matching and versioning, write boundaries.
- `tool-executor.test.ts`: dispatch/aliases/1:1 mapping/malformed-call synthesis.
- `web-fetch.test.ts`, `web-search-handler.test.ts`, `web-search-providers.test.ts`: timeouts, sanitization, provider parsing.
- `bash-timeout` related coverage in `session.test.ts` (process tracking/timeout adjustment full paths).

## Related Pages

- [Architecture/Session Lifecycle](../architecture/session-lifecycle.md) (execution entry point appendToolMessages)
- [Architecture/Permission System](../architecture/permission-system.md), [Architecture/Sandbox](../architecture/sandbox.md)
- [mcp](mcp.md) (MCP tool fallback), [actions](actions.md) (Action tools)