/**
 * Index/knowledge build-job history — per-run records under
 * `<root>/.deeporca/jobs/` (task-tree-hub design §4.4).
 *
 * BuildJobManager's jobs were memory-only: once a build settled, the task
 * tree hub had nothing to show for the 索引与知识 domain. One `<id>.json`
 * per settled job (written ONCE at settle, never during flight), capped
 * like the review store. Pure fs + validation — no Electron imports.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IndexJobRecord } from "../../shared/ipc";

/** History cap: newest N jobs survive a prune (review-store 同款纪律). */
export const JOBS_KEEP = 20;

const jobsDir = (root: string): string => path.join(root, ".deeporca", "jobs");

/** `job-<timestamp>` — the only id shape resolveJobFile accepts. */
function isSafeJobId(id: string): boolean {
  return /^job-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}$/.test(id);
}

function makeId(d: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  return (
    `job-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`
  );
}

/**
 * Persist one settled build job. Collision-safe (walks the clock forward,
 * review-store 同款); best-effort — a stuck write never fails the build.
 */
export function saveIndexJobRecord(root: string, record: Omit<IndexJobRecord, "id">): IndexJobRecord | null {
  try {
    const dir = jobsDir(root);
    fs.mkdirSync(dir, { recursive: true });
    let id = makeId(new Date(record.startedAt));
    while (fs.existsSync(path.join(dir, `${id}.json`))) {
      // Same-ms collision: nudge forward instead of overwriting.
      record = { ...record, startedAt: new Date(new Date(record.startedAt).getTime() + 1).toISOString() };
      id = makeId(new Date(record.startedAt));
    }
    const full: IndexJobRecord = { ...record, id };
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(full, null, 2), "utf-8");
    pruneIndexJobs(root);
    return full;
  } catch (err) {
    console.warn("[jobs-store] save failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Newest-first job records (malformed/unreadable entries skipped). */
export function listIndexJobs(root: string): IndexJobRecord[] {
  const dir = jobsDir(root);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: IndexJobRecord[] = [];
  for (const f of entries) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as IndexJobRecord;
      if (typeof rec?.id === "string" && isSafeJobId(rec.id) && typeof rec?.startedAt === "string") {
        out.push(rec);
      }
    } catch {
      // unreadable — skip
    }
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Keep the newest JOBS_KEEP records; delete the rest. Best-effort. */
export function pruneIndexJobs(root: string): void {
  try {
    const dir = jobsDir(root);
    for (const rec of listIndexJobs(root).slice(JOBS_KEEP)) {
      try {
        fs.rmSync(path.join(dir, `${rec.id}.json`), { force: true });
      } catch {
        // raced — next prune retries
      }
    }
  } catch {
    // pruning is cosmetic
  }
}
