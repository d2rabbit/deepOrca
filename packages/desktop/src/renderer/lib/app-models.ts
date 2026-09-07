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
   * Gate status AT CAPTURE TIME (ask_permission / waiting_for_user). Live
   * flips for background roots are not streamed to this renderer, so this
   * is a snapshot signal by design — returning to the root gives the live,
   * full-fidelity state.
   */
  blockedAtCapture: boolean;
};

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
