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
import { appendUsageRecord, getProjectCode, readUsageLedger } from "@deeporca/core";
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

/** Exact windows: one bucket per request, keyed off the record timestamp. */
function ledgerWindows(
  records: ReadonlyArray<{ ts: string; prompt: number; completion: number }>,
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
  const startOfWeekMs = startOfTodayMs - weekday * 24 * 60 * 60 * 1000;

  const add = (window: SummaryTimeWindow, prompt: number, completion: number) => {
    window.prompt += prompt;
    window.completion += completion;
    window.total += prompt + completion;
    window.reqs += 1;
  };
  for (const record of records) {
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
      out.requests += num(usage.total_reqs);
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

  const ledger = readUsageLedger(usageLedgerPathForIndex(indexPath));
  if (ledger.length > 0) {
    out.windows = ledgerWindows(ledger, now);
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
 * exact time windows cover old data too. Idempotent by marker: any existing
 * ledger file (even one torn line) means the workspace is already on the new
 * regime — post-rework requests land there natively. Fully synchronous, so
 * concurrent IPC calls cannot interleave into a double import.
 *
 * Returns the number of sessions imported.
 */
export function migrateLegacyUsageIntoLedger(indexPath: string): number {
  const ledgerPath = usageLedgerPathForIndex(indexPath);
  if (fs.existsSync(ledgerPath)) {
    return 0;
  }
  const entries = readIndexEntries(indexPath).filter((entry) => entry.usage);
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
  return entries.length;
}
