/**
 * Whole-workspace token accounting (user ask 2026-09-01: 无论什么操作，只要
 * 涉及 LLM 的使用就记录) — aggregates the usage tallies of EVERY session in
 * the project's sessions-index, INCLUDING silent-subagent sessions (index
 * builds, arch LLM judging, prototype pipelines): those entries carry the
 * same usage/usagePerModel fields, they are merely hidden from the session
 * list. Reads the on-disk index directly — no bridge involvement, so the
 * numbers are workspace-scoped, not active-root-scoped.
 *
 * P2 (2026-09-02, local-accounting rework): time windows now come from the
 * per-request usage ledger (exact request timestamps) with a legacy
 * approximation fallback, plus an estimated USD cost from the built-in price
 * table. migrateLegacyUsageIntoLedger() backfills pre-rework session totals
 * into the ledger exactly once so windows cover old data too.
 *
 * Out of scope (cannot be attributed here): the bundled OCR reviewer's own
 * API calls (external CLI with its own key) and local ONNX embeddings (zero
 * tokens by nature).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { appendUsageRecord, getProjectCode, listUsageLedgerShards, readUsageLedger } from "@deeporca/core";
import type { UsageSource } from "@deeporca/core";
import { estimateCostUsd } from "./token-pricing";

export interface TokenModelUsage {
  prompt: number;
  completion: number;
  total: number;
  cacheRead: number;
  reqs: number;
}

export interface SummaryTimeWindow {
  prompt: number;
  completion: number;
  total: number;
  reqs: number;
}

export interface WorkspaceTokenSummary {
  root: string;
  /** Session files counted (all sessions, silent subagents included). */
  sessions: number;
  silentSessions: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  requests: number;
  perModel: Record<string, TokenModelUsage>;
  /** Last activity seen in the index (max updateTime). */
  lastAt: string | null;
  /** Exact time windows from the per-request ledger (P2). */
  windows: { last5h: SummaryTimeWindow; today: SummaryTimeWindow; thisWeek: SummaryTimeWindow };
  /**
   * True when the ledger had no records and windows fell back to attributing
   * each legacy session's whole usage to its updateTime (approximation).
   */
  windowsApproximate: boolean;
  /** Estimated USD spend (built-in price table); null when nothing priced. */
  costUsd: number | null;
}

type IndexEntry = {
  id?: string;
  usage?: Record<string, unknown> | null;
  usagePerModel?: Record<string, Record<string, unknown>> | null;
  updateTime?: string;
  isSilentSubagent?: boolean;
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** thisWeek reaches ≤7 days back — bound the ledger parse to ~8 days so
 *  long-lived workspaces don't re-parse their whole (possibly multi-shard)
 *  history on every panel open. */
const LEDGER_READ_BOUND_MS = 8 * 24 * 60 * 60 * 1000;

function emptyModel(): TokenModelUsage {
  return { prompt: 0, completion: 0, total: 0, cacheRead: 0, reqs: 0 };
}

function emptyWindow(): SummaryTimeWindow {
  return { prompt: 0, completion: 0, total: 0, reqs: 0 };
}

/** Project dir holding sessions-index.json — mirrors core's persistence layout. */
export function projectSessionsIndexPath(userConfigRoot: string, root: string): string {
  return path.join(userConfigRoot, "projects", getProjectCode(root), "sessions-index.json");
}

/**
 * Ledger path beside the index — the layout owner is core's
 * usageLedgerPath(userConfigRoot, root); both files live in the same project
 * dir, so deriving from the index path keeps this testable with fixture dirs.
 */
export function usageLedgerPathForIndex(indexPath: string): string {
  return path.join(path.dirname(indexPath), "usage-ledger.jsonl");
}

/** Zero summary — returned for an unregistered root (nothing read or enumerated). */
export function emptyTokenSummary(root: string): WorkspaceTokenSummary {
  const windows = { last5h: emptyWindow(), today: emptyWindow(), thisWeek: emptyWindow() };
  return {
    root,
    sessions: 0,
    silentSessions: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    requests: 0,
    perModel: {},
    lastAt: null,
    windows,
    windowsApproximate: false,
    costUsd: null,
  };
}

function readIndexEntries(indexPath: string): IndexEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as { entries?: IndexEntry[] };
    return Array.isArray(raw.entries) ? raw.entries : [];
  } catch {
    return []; // no index yet — zero summary
  }
}

/** Exact windows: one bucket per request, keyed off the record timestamp.
 *  `backfill` marker records are bookkeeping, not requests — skipped. */
function ledgerWindows(
  records: ReadonlyArray<{ ts: string; prompt: number; completion: number; source?: UsageSource }>,
  now: number
): { last5h: SummaryTimeWindow; today: SummaryTimeWindow; thisWeek: SummaryTimeWindow } {
  const last5h = emptyWindow();
  const today = emptyWindow();
  const thisWeek = emptyWindow();

  const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();
  // Week starts on Monday (ISO): shift Sunday(0) to 6.
  const weekday = (startOfToday.getDay() + 6) % 7;
  // Calendar-day rollback (setDate), NOT today-minus-N×24h arithmetic: DST
  // shifts make the millisecond form land an hour off true local Monday
  // midnight, mis-bucketing records near the week edge.
  const startOfThisWeek = new Date(startOfToday);
  startOfThisWeek.setDate(startOfThisWeek.getDate() - weekday);
  const startOfWeekMs = startOfThisWeek.getTime();

  const add = (window: SummaryTimeWindow, prompt: number, completion: number) => {
    window.prompt += prompt;
    window.completion += completion;
    window.total += prompt + completion;
    window.reqs += 1;
  };
  for (const record of records) {
    if (record.source === "backfill") continue;
    const ts = Date.parse(record.ts);
    if (!Number.isFinite(ts)) continue;
    if (ts >= fiveHoursAgo) add(last5h, record.prompt, record.completion);
    if (ts >= startOfTodayMs) add(today, record.prompt, record.completion);
    if (ts >= startOfWeekMs) add(thisWeek, record.prompt, record.completion);
  }
  return { last5h, today, thisWeek };
}

/** Legacy approximation: whole-session usage attributed to its updateTime. */
function approximateWindows(entries: ReadonlyArray<IndexEntry>, now: number) {
  const synthesized = entries
    .filter((entry) => entry.usage && entry.updateTime)
    .map((entry) => ({
      ts: entry.updateTime!,
      prompt: num(entry.usage!.prompt_tokens),
      completion: num(entry.usage!.completion_tokens),
    }));
  return ledgerWindows(synthesized, now);
}

export function buildTokenSummary(
  root: string,
  indexPath: string,
  /** Clock seam — tests pin it for deterministic window buckets. */
  now: number = Date.now()
): WorkspaceTokenSummary {
  const out: WorkspaceTokenSummary = emptyTokenSummary(root);
  const entries = readIndexEntries(indexPath);
  if (entries.length === 0 && !fs.existsSync(indexPath)) {
    return out; // no index yet — zero summary
  }

  for (const e of entries) {
    out.sessions++;
    if (e.isSilentSubagent) out.silentSessions++;
    if (e.updateTime && (!out.lastAt || e.updateTime > out.lastAt)) out.lastAt = e.updateTime;
    for (const usage of [e.usage]) {
      if (!usage) continue;
      out.promptTokens += num(usage.prompt_tokens);
      out.completionTokens += num(usage.completion_tokens);
      out.totalTokens += num(usage.total_tokens);
      out.cacheReadTokens += num(usage.prompt_cache_hit_tokens);
    }
    for (const [model, u] of Object.entries(e.usagePerModel ?? {})) {
      const m = (out.perModel[model] ??= emptyModel());
      m.prompt += num(u.prompt_tokens);
      m.completion += num(u.completion_tokens);
      m.total += num(u.total_tokens);
      m.cacheRead += num(u.prompt_cache_hit_tokens);
      m.reqs += num(u.total_reqs);
    }
  }
  // requests: Σ per-model request counters. Entry-level usage never carries
  // total_reqs in production (the writer stamps usagePerModel only), so the
  // per-model layer is the only truthful source — and each request counts
  // toward exactly one model, so the sum never double-counts.
  for (const model of Object.values(out.perModel)) {
    out.requests += model.reqs;
  }

  // "Any ledger at all?" is a file-size probe: the recency-bounded read below
  // legitimately returns empty for a stale workspace, and that must not be
  // misread as a pre-rework workspace (the approximation fallback).
  let hasLedgerRecords = false;
  try {
    hasLedgerRecords = fs.statSync(usageLedgerPathForIndex(indexPath)).size > 0;
  } catch {
    // no ledger file yet
  }
  const ledger = readUsageLedger(usageLedgerPathForIndex(indexPath), now - LEDGER_READ_BOUND_MS);
  if (ledger.length > 0) {
    out.windows = ledgerWindows(ledger, now);
    out.windowsApproximate = false;
  } else if (hasLedgerRecords) {
    // Records exist but none within the read bound — windows are exact zeros.
    out.windows = { last5h: emptyWindow(), today: emptyWindow(), thisWeek: emptyWindow() };
    out.windowsApproximate = false;
  } else {
    out.windows = approximateWindows(entries, now);
    out.windowsApproximate = entries.some((entry) => entry.usage);
  }
  out.costUsd = estimateCostUsd(out.perModel);
  return out;
}

/**
 * One-time backfill (P2): sessions that predate the per-request ledger carry
 * only per-session totals. Import each as ONE aggregated ledger record so the
 * exact time windows cover old data too.
 *
 * "Already migrated" is a MARKER RECORD in the ledger, not file existence:
 * post-rework requests create the ledger natively (an upgrade where the user
 * chats before ever opening the panel — the exact race file-existence lost
 * legacy data to), and long-lived workspaces may have rotated the active file
 * into shards already. Migration therefore scans active file + shards, skips
 * session ids that already have ledger records (id-dedupe), imports the rest,
 * and finally appends the marker — which also makes a crash mid-import resume
 * (already-imported ids are skipped on the next pass) instead of duplicating.
 * Fully synchronous, so concurrent IPC calls cannot interleave.
 *
 * Returns the number of sessions imported.
 */
export function migrateLegacyUsageIntoLedger(indexPath: string): number {
  const ledgerPath = usageLedgerPathForIndex(indexPath);
  const existing = listUsageLedgerShards(path.dirname(ledgerPath)).flatMap((shard) => readUsageLedger(shard));
  if (existing.some((record) => record.source === "backfill")) {
    return 0;
  }
  const ledgeredSessionIds = new Set(
    existing.map((record) => record.sessionId).filter((id): id is string => typeof id === "string" && id.length > 0)
  );
  const entries = readIndexEntries(indexPath).filter(
    (entry) => entry.usage && !(entry.id && ledgeredSessionIds.has(entry.id))
  );
  if (entries.length === 0) {
    return 0;
  }
  for (const entry of entries) {
    const perModel = Object.entries(entry.usagePerModel ?? {});
    // Attribute the whole session to its dominant model; the windows only
    // need the timestamp to be right, mixed-model splits are cosmetic here.
    const dominant =
      perModel.length === 1
        ? perModel[0]![0]
        : (perModel.sort((a, b) => num(b[1]?.total_tokens) - num(a[1]?.total_tokens))[0]?.[0] ?? "legacy");
    appendUsageRecord(ledgerPath, {
      ts: entry.updateTime ?? new Date(0).toISOString(),
      model: dominant,
      prompt: num(entry.usage!.prompt_tokens),
      completion: num(entry.usage!.completion_tokens),
      source: "chat",
      ...(entry.id ? { sessionId: entry.id } : {}),
      estimated: true,
      apiUsage: entry.usage!,
    });
  }
  appendUsageRecord(ledgerPath, {
    ts: new Date().toISOString(),
    model: "legacy-backfill",
    prompt: 0,
    completion: 0,
    source: "backfill",
    estimated: true,
  });
  return entries.length;
}
