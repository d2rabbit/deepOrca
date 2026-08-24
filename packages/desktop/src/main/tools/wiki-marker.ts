/**
 * openwiki run-completion marker (desktop-side helper).
 *
 * openwiki writes `openwiki/.last-update.json` — with `status: "complete"`,
 * the model, and the run's gitHead — as its FINAL act, before process exit.
 * That makes the marker the authoritative "the wiki work is done" signal,
 * independent of when (or whether) the CLI process actually exits: exit can
 * be delayed indefinitely when pipe-inherited MCP connector children keep the
 * stdio streams open (Node's `close` waits for them). Real-machine report:
 * "wiki finished but the status never changed — I had to guess".
 *
 * Kept in a dependency-free module of its own so it is unit-testable without
 * pulling @deeporca/core into the test runtime.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type WikiCompletionMarker = {
  readonly status: string;
  readonly model?: string;
};

/**
 * Read the marker iff it was written during THIS run (mtime >= sinceMs) and
 * carries a string status. Returns null for: no marker yet, a stale marker
 * from a previous run, an unreadable/partially-written file (openwiki may be
 * mid-write — the next poll picks it up).
 */
export function readWikiCompletionMarker(root: string, sinceMs: number): WikiCompletionMarker | null {
  try {
    const markerPath = path.join(root, "openwiki", ".last-update.json");
    const st = fs.statSync(markerPath);
    if (st.mtimeMs < sinceMs) return null;
    const parsed = JSON.parse(fs.readFileSync(markerPath, "utf-8")) as { status?: unknown; model?: unknown };
    if (typeof parsed.status !== "string") return null;
    return {
      status: parsed.status,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
    };
  } catch {
    return null;
  }
}
