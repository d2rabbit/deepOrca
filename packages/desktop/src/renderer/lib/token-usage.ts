// Token-usage aggregation for the consumption panel.
//
// Every session already carries its `usage` (grand total) and `usagePerModel`
// breakdown from the core engine, serialized straight through IPC. This module
// rolls those per-session records up into workspace totals + a per-model table,
// plus small formatters — all pure so it can be unit-tested and memoized.

import type { ModelUsage, SerializableSessionEntry, WorkspaceSessions } from "../../shared/ipc";

/** Flat token counters accumulated from one or many `ModelUsage` records. */
export type UsageTotals = {
  prompt: number;
  completion: number;
  total: number;
  reqs: number;
  cacheHit: number;
  cacheMiss: number;
};

/** A single model's rolled-up usage row. */
export type ModelUsageRow = UsageTotals & { model: string };

/** The full aggregate surfaced to the panel. */
export type UsageAggregate = {
  totals: UsageTotals;
  perModel: ModelUsageRow[];
  /** Sessions that contributed any usage. */
  sessionCount: number;
};

function emptyTotals(): UsageTotals {
  return { prompt: 0, completion: 0, total: 0, reqs: 0, cacheHit: 0, cacheMiss: 0 };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Add a single `ModelUsage` record into a totals accumulator (in place). */
function addUsage(into: UsageTotals, usage: ModelUsage | null | undefined): void {
  if (!usage) return;
  into.prompt += num(usage.prompt_tokens);
  into.completion += num(usage.completion_tokens);
  into.total += num(usage.total_tokens);
  into.reqs += num(usage.total_reqs);
  into.cacheHit += num(usage.prompt_cache_hit_tokens);
  into.cacheMiss += num(usage.prompt_cache_miss_tokens);
}

/** Roll every session's usage up into workspace totals + a per-model table. */
export function aggregateUsage(sessions: SerializableSessionEntry[]): UsageAggregate {
  const totals = emptyTotals();
  const perModel = new Map<string, ModelUsageRow>();
  let sessionCount = 0;

  for (const session of sessions) {
    if (session.usage) {
      addUsage(totals, session.usage);
      sessionCount += 1;
    }
    if (session.usagePerModel) {
      for (const [model, usage] of Object.entries(session.usagePerModel)) {
        const name = model.trim() || "unknown";
        let row = perModel.get(name);
        if (!row) {
          row = { model: name, ...emptyTotals() };
          perModel.set(name, row);
        }
        addUsage(row, usage);
      }
    }
  }

  const rows = [...perModel.values()].sort((a, b) => b.total - a.total);
  return { totals, perModel: rows, sessionCount };
}

/** Compact token count for headline stats: 1234 → "1.2k", 2_500_000 → "2.5M". */
export function formatTokens(value: number): string {
  const n = num(value);
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Exact, locale-grouped integer for tables/tooltips: 1234567 → "1,234,567". */
export function formatExact(value: number): string {
  return num(value).toLocaleString();
}

/** USD for the cost estimate line: 0.0042 → "$0.004", 12.5 → "$12.50". */
export function formatUsd(value: number): string {
  const n = num(value);
  if (n < 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

// Compaction threshold now comes from the model family registry via the
// dependency-free `@deeporca/core/capabilities` subpath — the active-context
// size at which the engine summarizes the middle of the conversation.
import { getCompactPromptTokenThreshold } from "@deeporca/core/capabilities";

/** Token budget before automatic compaction kicks in, for the given model. */
export function compactTokenThreshold(model: string, override?: number): number {
  return override !== undefined && override > 0 ? override : getCompactPromptTokenThreshold(model);
}

/** Percentage of prompt tokens served from cache, 0 when unknown. */
export function cacheHitRate(totals: UsageTotals): number {
  const denom = totals.cacheHit + totals.cacheMiss;
  return denom > 0 ? Math.round((totals.cacheHit / denom) * 100) : 0;
}

/** A workspace's rolled-up usage row for the by-workspace breakdown. */
export type WorkspaceUsageRow = UsageTotals & { root: string; label: string; sessionCount: number };

/** Roll each workspace's (non-archived) sessions up into a per-workspace table. */
export function aggregateByWorkspace(tree: WorkspaceSessions): WorkspaceUsageRow[] {
  const rows: WorkspaceUsageRow[] = [];
  for (const ws of tree.workspaces) {
    const totals = emptyTotals();
    let sessionCount = 0;
    for (const session of ws.sessions) {
      if (session.usage) {
        addUsage(totals, session.usage);
        sessionCount += 1;
      }
    }
    rows.push({ root: ws.root, label: ws.label, sessionCount, ...totals });
  }
  return rows.sort((a, b) => b.total - a.total);
}

/** Approximate time-window usage buckets. */
export type TimeWindowUsage = { last5h: UsageTotals; today: UsageTotals; thisWeek: UsageTotals };

/**
 * Approximate consumption by time window. The core engine records only a
 * per-session grand total (no per-request timestamps), so each session's whole
 * usage is attributed to its last-activity time (`updateTime`). This is an
 * intentional approximation, surfaced with a note in the UI.
 */
export function aggregateByTimeWindow(sessions: SerializableSessionEntry[], now: number = Date.now()): TimeWindowUsage {
  const last5h = emptyTotals();
  const today = emptyTotals();
  const thisWeek = emptyTotals();

  const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();
  // Week starts on Monday (ISO): shift Sunday(0) to 6.
  const weekday = (startOfToday.getDay() + 6) % 7;
  const startOfWeekMs = startOfTodayMs - weekday * 24 * 60 * 60 * 1000;

  for (const session of sessions) {
    if (!session.usage) continue;
    const ts = session.updateTime ? Date.parse(session.updateTime) : NaN;
    if (!Number.isFinite(ts)) continue;
    if (ts >= fiveHoursAgo) addUsage(last5h, session.usage);
    if (ts >= startOfTodayMs) addUsage(today, session.usage);
    if (ts >= startOfWeekMs) addUsage(thisWeek, session.usage);
  }
  return { last5h, today, thisWeek };
}
