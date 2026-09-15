/**
 * App-shell models shared with App.tsx: the main-area tab union, PiP entry,
 * permission-reply envelope, plus the small pure helpers that derive plan /
 * synthetic-message values. Extracted from App.tsx so the composition root
 * stays under the file-length ceiling; use-command-items types its palette
 * dep from here as well.
 */

import type { PermissionResult } from "./permissions";
import { buildToolSummary, getPlanLines } from "./messages";
import type { SessionMessage } from "../../shared/ipc";

/** The main-area tab model — module-level so the extracted ⌘K palette hook
 *  (use-command-items) can type its setActiveTab dep. */
export type MainTab =
  | { kind: "chat" }
  | { kind: "settings" }
  | { kind: "plugins" }
  | { kind: "editor" }
  | { kind: "knowledge"; root: string }
  | { kind: "review"; root: string }
  | { kind: "prototype"; root: string; suiteId?: string; tab?: string }
  | { kind: "design"; root: string; suiteId?: string; tab?: string }
  | { kind: "task"; treeId: string }
  | { kind: "taskhub"; root: string };

export type PendingPermissionReply = {
  sessionId: string;
  permissions: PermissionResult["permissions"];
  alwaysAllows: PermissionResult["alwaysAllows"];
  alwaysAllowPaths: PermissionResult["alwaysAllowPaths"];
};

/**
 * Picture-in-picture entry (real-machine ask 2026-08-27): a workspace whose
 * conversation is parked because the user switched to ANOTHER workspace. The
 * transcript is frozen at capture time (events for background roots are not
 * streamed into the view); returning re-selects the root and history reloads
 * fresh from disk, so freezing never loses anything.
 */
export type PipEntry = {
  root: string;
  label: string;
  sessionId: string | null;
  title: string | null;
  /** Last turns at capture time, oldest→newest, capped slice. */
  frozen: SessionMessage[];
  /**
   * Gate status (ask_permission / waiting_for_user). Captured at park time
   * and refreshed live by the corner status poll (reconcilePipEntries ×
   * listWorkspaceSessions) — the dot/alerts track the real state, and the
   * entry leaves the stack on its own once the session settles.
   */
  blockedAtCapture: boolean;
};

/** Minimal cross-root session listing (from api.listWorkspaceSessions). */
export type PipStatusSource = {
  workspaces: Array<{
    root: string;
    sessions: Array<{ id: string; status: string; askPermissions?: unknown[] | null }>;
  }>;
};

/** Settled statuses: the session no longer needs a corner player. */
const PIP_SETTLED_STATUSES = new Set(["completed", "failed", "interrupted", "permission_denied"]);

/**
 * Reconcile parked PiP entries against a fresh cross-root session listing.
 * Entries whose session settled (completed/failed/interrupted/denied) or
 * vanished from the index leave the stack on their own — the corner player
 * and the top-right gate alerts never pile up stale markers. Surviving
 * entries get their gate flag refreshed to the LIVE state (was frozen at
 * capture time). Pure; shared by App's corner poll and tests.
 */
export function reconcilePipEntries(prev: PipEntry[], source: PipStatusSource): PipEntry[] {
  const next: PipEntry[] = [];
  for (const entry of prev) {
    // sessionId 为 null 的条目没有可对账的会话——保留停车时的信号。
    if (!entry.sessionId) {
      next.push(entry);
      continue;
    }
    const session = source.workspaces
      .find((g) => g.root === entry.root)
      ?.sessions.find((s) => s.id === entry.sessionId);
    if (!session) continue; // 删除/归档清理 → 停车理由已不存在
    if (PIP_SETTLED_STATUSES.has(session.status)) continue; // 完结 → 会话列表可找回
    const liveBlocked =
      session.status === "ask_permission" ||
      session.status === "waiting_for_user" ||
      Boolean(session.askPermissions && session.askPermissions.length > 0);
    next.push(liveBlocked === entry.blockedAtCapture ? entry : { ...entry, blockedAtCapture: liveBlocked });
  }
  return next;
}

/** Extract the markdown plan from the newest UpdatePlan tool message, if any. */
export function findLatestPlan(messages: SessionMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "tool") continue;
    const lines = getPlanLines(buildToolSummary(message));
    if (lines.length > 0) return lines.join("\n");
  }
  return null;
}

export function syntheticUserMessage(sessionId: string, content: string): SessionMessage {
  const now = new Date().toISOString();
  return {
    id: `synthetic-${Date.now()}`,
    sessionId,
    role: "user",
    content,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: now,
    updateTime: now,
  };
}
