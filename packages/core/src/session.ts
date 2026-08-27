// Portions Copyright (c) 2026 lessweb — engine code adapted from Deep Code
// (deepcode-cli, MIT); see the repository NOTICE for the preserved MIT grant.

// NOTE: SessionManager is a thin composition root. The implementation lives in
// the session-manager-*.ts layer chain (fields+constructor+LLM core → mcp →
// skills → persistence → lifecycle → tasks); this file keeps the module's
// public surface (types, helpers, re-exports) stable for importers.

export type { PermissionScope } from "./settings";
export type {
  AskPermissionRequest,
  AskPermissionScope,
  BashPermissionScope,
  MessageToolPermission,
  PermissionDecision,
  UserToolPermission,
} from "./common/permissions";
export { getProjectCode } from "./common/app-dirs";
// Compaction threshold moved to the model family registry (model-capabilities);
// re-exported here to keep the session module's public surface stable.
export { getCompactPromptTokenThreshold } from "./common/model-capabilities";

export type {
  MemoryProvider,
  SessionStatus,
  ModelUsage,
  SessionProcessEntry,
  BashTimeoutAdjustment,
  SessionEntry,
  SessionsIndex,
  SessionMessageRole,
  MessageMeta,
  SessionMessage,
  UndoTarget,
  UserPromptContent,
  SkillInfo,
  BuiltinPluginInfo,
  BuiltinPluginGroup,
  McpServerConfigEntry,
  LlmStreamProgress,
} from "./session-types";
export { isChineseLocale } from "./session-helpers";
export { LlmStreamIdleTimeoutError, withStreamIdleTimeout } from "./session-stream";
export { getLastPromptTokens, getFreshInputTokens } from "./session-usage";

import { SessionManagerTasks } from "./session-manager-tasks";

export class SessionManager extends SessionManagerTasks {
  dispose(): void {
    const controller = this.activePromptController;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    this.activePromptController = null;
    for (const sessionController of this.sessionControllers.values()) {
      if (!sessionController.signal.aborted) {
        sessionController.abort();
      }
    }
    this.killLiveProcesses();
    this.sessionControllers.clear();
    this.processTimeoutControls.clear();
    this.sessionAuditLogs.clear();
    this.bashSandboxBySession.clear();
    this.bashBackendBySession.clear();
    this.mcpManager.disconnect();
    // Flush any pending debounced index write before teardown. Best-effort:
    // a disk failure here must not abort the remaining teardown steps (A2UI
    // persist, cache release, router drop) — there is no caller left to
    // surface the error to. flushSessionsIndex retains pendingIndex on
    // failure, so the state is still recoverable by the next manager.
    try {
      this.flushSessionsIndex();
    } catch {
      // Teardown continues below.
    }
    // Persist prototype surfaces to disk before teardown.
    this.currentA2uiLifecycle?.persistSurfaces(this.projectRoot);
    this.currentA2uiLifecycle = null;
    // Release cached messages to free memory.
    this.messageCache.clear();
    // Drop the router bundle so a disposed manager cannot keep serving routes.
    // The embedding service itself is a process-wide singleton shared with other
    // SessionManagers, so it is deliberately NOT closed here — the host closes it
    // on app teardown via closeEmbeddingService().
    this.routerBundle = null;
    this.shardConfig = null;
    this.frozenToolRoutes.clear();
    this.routerInitPromise = null;
    // Flip LAST: everything above (including the final index flush) must still
    // run. From here on, late async handlers aborted by dispose() — e.g. the
    // activation-loop catch stamping status:"interrupted" — are barred from
    // rebuilding a stale snapshot and racing the replacement manager's index
    // writes (see the disposed guard in saveSessionsIndex/flushSessionsIndex).
    this.disposed = true;
  }
}
