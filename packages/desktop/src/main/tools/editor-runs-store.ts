/**
 * Editor pair-run store (specs/editor-copilot 链路 D): append-only JSONL so
 * the task hub's editor domain has a home store, read by buildTaskHub. One
 * line per editor:agentRun settlement (done/error) — writes are best-effort;
 * a store failure never blocks the run itself.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type EditorRunRecord = {
  runId: string;
  file: string;
  instruction: string;
  status: "done" | "error";
  startedAt: string;
  endedAt?: string;
  added?: number;
  removed?: number;
  /** LLM loop iterations the settlement reported (链路 D 行为记录). */
  iterations?: number;
  /** Wall-clock run duration in milliseconds. */
  durationMs?: number;
  /** Locally-counted token usage summed over the run's requests (delta of
   *  the project usage ledger across the run window, 2026-09-06 user ask). */
  tokens?: { prompt: number; completion: number };
};

function storePath(root: string): string {
  return join(root, ".deeporca", "editor-runs.jsonl");
}

export function appendEditorRun(root: string, record: EditorRunRecord): void {
  try {
    const dir = join(root, ".deeporca");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(storePath(root), JSON.stringify(record) + "\n", "utf8");
  } catch {
    // best-effort: the task hub simply won't list this run
  }
}

/** Newest-first; corrupt lines are skipped; capped at 200 lines read back. */
export function listEditorRuns(root: string): EditorRunRecord[] {
  try {
    const path = storePath(root);
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean).slice(-200);
    const out: EditorRunRecord[] = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line) as EditorRunRecord);
      } catch {
        // skip corrupt line
      }
    }
    return out.reverse();
  } catch {
    return [];
  }
}
