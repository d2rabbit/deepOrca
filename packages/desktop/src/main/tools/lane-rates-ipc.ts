/**
 * Lane-rates scan for the desktop `LaneRatesGet` IPC channel — extracted from
 * main/index.ts into a pure-Node module (no Electron imports) so the
 * select → preload → collect → compute pipeline is unit-testable without
 * booting the app.
 *
 * The IPC handler in main/index.ts keeps only the root-pinning invariant
 * (`resolveRegisteredRoot`, main-process-only); everything data-related lives
 * here and fails open: any throw → null report → the panel shows "no data"
 * instead of erroring.
 */

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { collectLaneRateSessions, computeLaneRates, type LaneRateSession, type LaneRatesReport } from "@deeporca/core";

/** Perf review fix: bound the scan to the most recent N sessions. */
export const LANE_RATE_MAX_SESSIONS = 80;

/** Shape of the sessions-index.json entries the scan consumes. */
export type LaneRateIndexEntry = {
  id: string;
  isSilentSubagent?: boolean;
  lane?: "express" | "deep";
  updatedAt?: string;
};

/** Shape of the transcript JSONL lines the scan consumes. */
export type LaneRateTranscriptLine = {
  role?: string;
  content?: unknown;
  createTime?: string;
  meta?: { userPrompt?: { text?: string } } | null;
};

/**
 * Most-recent-N selection: silent subagents are filtered out, then entries
 * sort by updatedAt DESC and slice to the bound. Node's sort is stable, and
 * missing/unparseable timestamps map to 0 so they sink to the tail (dropped)
 * instead of poisoning the comparator with NaN.
 */
export function selectRecentLaneSessions<E extends { isSilentSubagent?: boolean; updatedAt?: string }>(
  entries: E[],
  maxSessions: number = LANE_RATE_MAX_SESSIONS
): E[] {
  const ts = (value: string | undefined): number => {
    const parsed = Date.parse(value ?? "");
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return entries
    .filter((entry) => !entry.isSilentSubagent)
    .sort((a, b) => ts(b.updatedAt) - ts(a.updatedAt))
    .slice(0, maxSessions);
}

/**
 * Preload session transcripts (fs.promises, off the sync main-process path)
 * into a map keyed by session id. Per-file failure — missing, unreadable or a
 * corrupt JSONL line — yields an empty array so one broken transcript cannot
 * sink the whole scan.
 */
export async function readLaneRateTranscripts(
  projectDir: string,
  entries: ReadonlyArray<{ id: string }>
): Promise<Map<string, LaneRateTranscriptLine[]>> {
  const transcripts = new Map<string, LaneRateTranscriptLine[]>();
  await Promise.all(
    entries.map(async (entry) => {
      try {
        const raw = await readFile(join(projectDir, `${entry.id}.jsonl`), "utf8");
        transcripts.set(
          entry.id,
          raw
            .split("\n")
            .filter((line) => line.trim())
            .map((line) => JSON.parse(line) as LaneRateTranscriptLine)
        );
      } catch {
        transcripts.set(entry.id, []); // missing/unreadable transcript → no samples
      }
    })
  );
  return transcripts;
}

/**
 * Build the lane-rates report for a project dir: read sessions-index.json,
 * bound to the most recent sessions, preload their transcripts, then feed
 * core's collector + rate computer. Fail-open — any throw → null.
 */
export async function laneRatesReport(
  projectDir: string,
  opts?: {
    evaluateL1?: (text: string) => { lane: "express" | "deep" } | null;
    maxSessions?: number;
  }
): Promise<LaneRatesReport | null> {
  try {
    const entries =
      (
        JSON.parse(readFileSync(join(projectDir, "sessions-index.json"), "utf8")) as {
          entries?: LaneRateIndexEntry[];
        }
      ).entries ?? [];
    const recent = selectRecentLaneSessions(entries, opts?.maxSessions ?? LANE_RATE_MAX_SESSIONS);
    const transcripts = await readLaneRateTranscripts(projectDir, recent);
    const sessions: LaneRateSession[] = collectLaneRateSessions({
      readIndex: () => recent,
      readTranscript: (sessionId) => transcripts.get(sessionId) ?? [],
      evaluateL1: opts?.evaluateL1,
    });
    return computeLaneRates(sessions) as LaneRatesReport;
  } catch {
    return null; // fail-open (corrupt index / unreadable storage → "no data")
  }
}
