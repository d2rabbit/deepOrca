// Per-request local usage ledger (P1 of the token-statistics rework).
//
// Every LLM request through the engine's single chokepoint appends one
// record here — chat turns, compaction summaries, background tasks and
// auxiliary helper calls alike. This deliberately does NOT touch the
// sessions-index write path (debounced pendingIndex — see AGENTS.md): a
// plain append-only JSONL next to it has no debounce, no read-modify-write,
// and no way to corrupt session state. Best-effort by design — accounting
// must never break the LLM loop.
//
// Desktop consumers (tokens summary / time-window panels) read this file
// read-only, under the same registered-root rules as sessions-index access.

import * as fs from "node:fs";
import * as path from "node:path";
import { getProjectCode } from "./app-dirs";

/** Which engine path issued the request. */
export type UsageSource = "chat" | "compaction" | "background" | "auxiliary" | "backfill";

export type UsageRecord = {
  /** Request start timestamp — the anchor for exact time-window reporting. */
  ts: string;
  model: string;
  /** Locally counted prompt side (full payload: system chain + tools + history). */
  prompt: number;
  /** Locally counted completion side (content + reasoning + tool calls). */
  completion: number;
  source: UsageSource;
  sessionId?: string;
  /** Local counts are estimates by construction — UI surfaces a "≈". */
  estimated: true;
  /**
   * API-returned usage for this request, passively retained (never read for
   * statistics): future calibration data for the local counter's per-family
   * error coefficients, at zero extra cost since include_usage is already on.
   */
  apiUsage?: Record<string, unknown> | null;
};

/** Ledger path beside sessions-index.json for the given project root. */
export function usageLedgerPath(userConfigRoot: string, projectRoot: string): string {
  return path.join(userConfigRoot, "projects", getProjectCode(projectRoot), "usage-ledger.jsonl");
}

/** Size cap for the active ledger: past it the file rotates to a timestamped
 *  archive shard next to it, so the append path stays O(1) and window reads
 *  never rescan unbounded history. Shards are kept on disk (calibration and
 *  forensics) but no longer count as "the ledger" for window reads. */
const MAX_LEDGER_BYTES = 16 * 1024 * 1024;

/** Rotate an oversized active ledger out of the way. Rename loss (file locked
 *  on Windows, etc.) degrades to unbounded growth — never to dropped records. */
function rotateIfOversized(ledgerPath: string): void {
  let size = 0;
  try {
    size = fs.statSync(ledgerPath).size;
  } catch {
    return; // no file yet
  }
  if (size < MAX_LEDGER_BYTES) {
    return;
  }
  const archive = path.join(path.dirname(ledgerPath), `usage-ledger-rotated-${Date.now()}.jsonl`);
  try {
    fs.renameSync(ledgerPath, archive);
  } catch {
    // keep appending to the active file instead
  }
}

/** Active ledger + rotated shards for a project dir. Legacy-backfill scans
 *  all of them (its marker may live in any shard); window reads target only
 *  the active file. */
export function listUsageLedgerShards(projectDir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(projectDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => /^usage-ledger.*\.jsonl$/.test(name))
    .sort()
    .map((name) => path.join(projectDir, name));
}

/** Append one record. Swallows every error — see header. */
export function appendUsageRecord(ledgerPath: string, record: UsageRecord): void {
  try {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    rotateIfOversized(ledgerPath);
    fs.appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // best-effort only
  }
}

/** Cheap pre-JSON.parse recency check: every writer serializes `ts` first
 *  (JSON key order = insertion order), so the ISO stamp is a leading
 *  `"ts":"…"`. Ancient lines are skipped without paying a full parse of
 *  their (apiUsage-laden) payload. Unexpected shapes fall through to the
 *  parse rather than silently disappearing. */
function lineMightBeRecent(trimmedLine: string, sinceMs: number): boolean {
  const match = trimmedLine.match(/^{"ts":"([^"]+)"/);
  if (!match) {
    return true;
  }
  const ts = Date.parse(match[1] ?? "");
  return !Number.isFinite(ts) || ts >= sinceMs;
}

/** Read a ledger file; missing file or corrupt lines yield partial/empty
 *  results instead of throwing (append-only files can end mid-line if the
 *  process died between write and flush).
 *
 *  `sinceMs` bounds the parse to records at/after the timestamp — window
 *  reads pass a ~1-week bound so long-lived workspaces don't re-parse the
 *  whole (possibly rotated-many-times) history on every panel open. Pass 0
 *  for the full shard (legacy-backfill needs the complete id/marker set). */
export function readUsageLedger(ledgerPath: string, sinceMs = 0): UsageRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(ledgerPath, "utf8");
  } catch {
    return [];
  }
  const records: UsageRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (sinceMs > 0 && !lineMightBeRecent(trimmed, sinceMs)) {
      continue;
    }
    try {
      records.push(JSON.parse(trimmed) as UsageRecord);
    } catch {
      // torn tail line — skip
    }
  }
  return records;
}
