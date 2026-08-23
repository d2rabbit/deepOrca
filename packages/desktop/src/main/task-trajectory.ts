/**
 * Task trajectory extraction (task-tree R3-7) — pure function reading a
 * task's bound-session JSONLs and reducing them to OPERATION records.
 *
 * Extracted from the IPC handler for testability: given session ids + the
 * project storage dir, walk each `<sessionId>.jsonl`, keep only tool-role
 * messages, and derive {at, tool, ok, summary, files} per operation.
 * Conversation content (assistant/user text) is never read into the result.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TaskTrajectory, TaskTrajectoryOp } from "../shared/ipc";

/** Max sessions scanned per extraction (most recent first — matches panel). */
const MAX_SESSIONS = 8;
/** Cap on returned operations (ring of the most recent). */
const MAX_OPERATIONS = 500;

type SessionLine = {
  role?: unknown;
  content?: unknown;
  createTime?: unknown;
  meta?: { paramsMd?: unknown } | undefined;
};

export function extractTaskTrajectory(sessionIds: string[], projectDir: string): TaskTrajectory {
  const operations: TaskTrajectoryOp[] = [];
  for (const sessionId of sessionIds.slice(-MAX_SESSIONS)) {
    let raw: string;
    try {
      raw = readFileSync(join(projectDir, `${sessionId}.jsonl`), "utf-8");
    } catch {
      continue; // missing/unreadable session file — skip, not fatal
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let msg: SessionLine;
      try {
        msg = JSON.parse(line) as SessionLine;
      } catch {
        continue;
      }
      if (msg.role !== "tool" || typeof msg.content !== "string") continue;
      try {
        const parsed = JSON.parse(msg.content) as { ok?: unknown; name?: unknown };
        const tool = typeof parsed.name === "string" ? parsed.name : "tool";
        const params = typeof msg.meta?.paramsMd === "string" ? msg.meta.paramsMd.trim() : "";
        const summary = params.split("\n")[0]?.slice(0, 160) || undefined;
        const files: string[] = [];
        const filePath = params.match(/"file_path"\s*:\s*"([^"]+)"/) ?? params.match(/file_path=([^\s"']+)/);
        if (filePath?.[1]) files.push(filePath[1]);
        operations.push({
          at: typeof msg.createTime === "string" ? msg.createTime : "",
          tool,
          ok: parsed.ok !== false,
          summary,
          files: files.length > 0 ? files : undefined,
        });
      } catch {
        // non-JSON tool content — skip
      }
    }
  }
  operations.sort((a, b) => a.at.localeCompare(b.at));
  const toolCounts: Record<string, number> = {};
  for (const op of operations) toolCounts[op.tool] = (toolCounts[op.tool] ?? 0) + 1;
  const filesTouched = [...new Set(operations.flatMap((op) => op.files ?? []))];
  return {
    operations: operations.slice(-MAX_OPERATIONS),
    toolCounts,
    filesTouched,
    sessionCount: sessionIds.length,
  };
}
