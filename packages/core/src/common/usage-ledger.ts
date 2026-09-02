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
export type UsageSource = "chat" | "compaction" | "background" | "auxiliary";

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

/** Append one record. Swallows every error — see header. */
export function appendUsageRecord(ledgerPath: string, record: UsageRecord): void {
  try {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // best-effort only
  }
}

/** Read the whole ledger; missing file or corrupt lines yield partial/empty
 *  results instead of throwing (append-only files can end mid-line if the
 *  process died between write and flush). */
export function readUsageLedger(ledgerPath: string): UsageRecord[] {
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
    try {
      records.push(JSON.parse(trimmed) as UsageRecord);
    } catch {
      // torn tail line — skip
    }
  }
  return records;
}
