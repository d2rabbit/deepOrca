---
type: architecture
title: Permission System
description: Side-effect-classification-based scoped permission engine: 10 permission scopes, computeToolCallPermissions decisions, Plan Mode forced ask, quarantine tightening, path-level always-allow, and ToolExecutionGate.
tags: [permissions, security, scopes]
---

# Permission System

DeepOrca's permission model is a scoped policy based on side-effect classification: low-risk operations pass through quickly, high-risk actions pause and ask, and command behavior is auditable. Permissions are not just a security feature; they give the model a predictable operational boundary and are part of agent quality.

## Permission Scopes

`PermissionScope` (`settings.ts`, 10 of them):

- Read/write/delete inside and outside the cwd: `read-in-cwd`, `write-in-cwd`, `delete-in-cwd`, `read-out-cwd`, `write-out-cwd`, `delete-out-cwd`.
- Network: `network`.
- Git: `query-git-log`, `mutate-git-log`.
- MCP: `mcp`.

`PermissionSettings` is configured with a three-column `deny`/`ask`/`allow` table plus `defaultMode` (`allowAll` | `askAll`).

## Decision Logic

`computeToolCallPermissions()` (`common/permissions.ts`, 33KB) analyzes all tool calls within one assistant turn and returns a `PermissionPlan` (per-message decisions plus the list requiring confirmation):

- **bash**: the tool schema requires the model to declare a `sideEffects` array (`read-in-cwd`, `write-in-cwd`, `delete-in-cwd`, `network`, `mutate-git-log`, etc.); unknown side effects → `unknown` scope.
- **File tools** (read/write/edit): the scope is derived from the path relative to projectRoot (path primitives live in `path-boundary.ts`).
- **Decision priority**: `deny > ask > allow > defaultMode fallback`.
- The result is attached to the assistant message's `meta.permissions`, persisted with the message, and replayed via `messagePermissions` on restoration.

### Forced Rules (Not Overridable by Configuration)

| Rule | Mechanism |
| --- | --- |
| Writes/deletes/Git mutations under Plan Mode always ask | `forceAskScopes: PLAN_MODE_FORCE_ASK_SCOPES` (unconditionally overrides allow, including explicit grants) |
| `allowAll` does not implicitly permit out-of-bounds writes/deletes | `forceAskDefaultedScopes: DEFAULT_FORCE_ASK_DEFAULTED_SCOPES` — only overrides allows that come from the defaultMode fallback, **without breaking** the explicit grants from the "always allow" button (decision 2026-08-15, specs/sandbox/design.md §4.2) |
| bash is forced to ask under quarantine with no sandbox backend | `forceAskTools: ["bash"]` (deny still takes precedence) |

## Quarantine Workspace Trust Tiers

- Trust level: `WorkspaceTrustLevel` (stored in a user-level trust store, `readWorkspaceTrustStore`/`writeWorkspaceTrustStore`, see `common/app-dirs.ts`), **never read from project files**.
- `applyQuarantinePermissionClamp` + `QUARANTINE_DENIED_SCOPES`: out-of-bounds R/W/D in quarantined repositories is denied outright at the permission layer (never asked); bash is forced to ask when there is no sandbox backend — a quarantined repository cannot "ask" its way past the boundary with pop-ups.

## Path-Level "Always Allow" and Runtime PathGrant

- `appendProjectAllowedPaths`: path-level grants are persisted separately; one click will **not** become a permanent blanket scope grant (task 14).
- `appendProjectPermissionAllows`: scope-level "always allow".
- `AskPermissionRequest.filePath`: lets the UI offer a PATH-level "always allow" option.
- `SessionManager.derivePathGrantForToolCall`: derives a `PathGrant` from the session for **each tool call** using the R2 algorithm — writeRoots/readRoots are normalized via `resolveGateRoot` (same-origin, realpath); read-exempt paths = skill scan roots + `allowedReadPaths`; `grantOutsideRootsFlags` are tightened by `applyQuarantinePermissionClamp` under quarantine. It is passed through to the handler via `ToolExecutionContext.pathGrant`.
- **TOCTOU/symlink hardening** (`path-boundary.ts`): `followSymlinkChain` (`MAX_SYMLINK_DEPTH = 10`) resolves the symlink chain before deciding; **targets that do not yet exist** are evaluated against their parent directory's realpath (preventing `..` traversal); when there is no grant, `gateWrite`/`gateRead` fail closed. This gate guards file tools during execution; see [sandbox](sandbox.md).

## ToolExecutionGate (Execution-Layer Latch)

`common/tool-execution-gate.ts`: a **synchronous** registry of before-tool-execution listeners at the execution layer (before `SessionManager.appendToolMessages`), **strictly after routing** — it never affects which tools the router selects. The first built-in listener is the permission check (`permissionGateListener`). Decision priority: deny > ask > allow. `SessionManager.registerBeforeToolExecution(name, listener)` exposes the registration surface; `ToolExecutionGate<PermissionPlan>` is genericized.

## ask_permission → Synthetic Tool Message Pipeline

1. `permissionGateListener`'s `permissionPlan.askPermissions` is non-empty → the session state is set to `ask_permission` (tool_calls suspended, decisions persisted with the message in `meta.permissions`).
2. The renderer's `PermissionCard` shows `AskPermissionRequest[]`; user decisions (allow/deny/always allow/path grant) re-enter `activateSession` via the permission-reply branch of `replySession`.
3. `appendToolMessages` calls `buildPermissionToolExecution(toolCall, { permissionOverrides, messagePermissions })` (`common/permissions.ts`): allow → returns null and executes normally; deny → synthesizes a "User denied… Do not try to bypass this decision." tool message; not authorized → synthesizes a "not authorized yet. Retry only if…" message. **Synthetic tool messages keep N:N pairing** — the model sees structured feedback rather than dangling calls.

## Desktop-Side Relay

- `SessionBridge.buildPermissionDecisions`/`buildPermissionSettings`: convert the renderer's user decisions (allow/deny/always allow/path grant) back into core's `UserToolPermission` shape.
- Renderer: `PermissionCard` (the ask card) + `lib/permissions.ts` (decision assembly).
- Event flow: session state `ask_permission` → renderer renders `AskPermissionRequest[]` → user decision → `replySession` replays with the permission reply.

## Focused Tests

- `permissions.test.ts` (33KB): scope derivation, decision priority, Plan Mode, always-allow.
- `quarantine.test.ts`: trust tiers and tightening.
- `path-grants.test.ts`: path-level grant persistence and derivation.
- `path-boundary.test.ts`, `tool-execution-gate.test.ts`.
- Desktop: `permissions-lib.test.ts`, `workspace-trust.test.ts`.

## Related Pages

- [Sandbox](sandbox.md) (audit/policy/backend), [Session Lifecycle](session-lifecycle.md) (ask_permission state)
- [core/settings](../core/settings.md) (PermissionSettings schema)
- [workflows/llm-tool-loop](../workflows/llm-tool-loop.md)