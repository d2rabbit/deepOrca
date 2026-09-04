/**
 * Whole-workspace token accounting (main tools/tokens-summary.ts) — the
 * "whatever the operation is, if it touched an LLM it gets counted" rule.
 * Pins: sums usage across ALL index entries INCLUDING silent-subagent
 * sessions, per-model tallies, cache-read separation, and zero-safe reads on
 * a missing index. P2 additions: exact ledger-based time windows (with the
 * legacy approximation fallback), one-time legacy migration, cost estimate.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildTokenSummary,
  migrateLegacyUsageIntoLedger,
  projectSessionsIndexPath,
  usageLedgerPathForIndex,
} from "../main/tools/tokens-summary";
import { getProjectCode, readUsageLedger } from "@deeporca/core";

async function makeIndex(root: string, entries: unknown[]): Promise<string> {
  // Production path-shaping keeps the fixture platform-adaptive — hand-rolled
  // separator replacement is exactly how the POSIX-only assumption crept in
  // (AGENTS.md: cross-platform path policy — reuse the production helpers).
  const code = getProjectCode(root);
  const dir = path.join(root, "projects", code);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, "sessions-index.json");
  await fsp.writeFile(file, JSON.stringify({ version: 1, entries }), "utf-8");
  return file;
}

async function writeLedger(indexPath: string, records: unknown[]): Promise<void> {
  await fsp.writeFile(
    usageLedgerPathForIndex(indexPath),
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf-8"
  );
}

// Entry-level usage as the index persists it — total_reqs lives ONLY on the
// per-model tallies (the production writer stamps usagePerModel), never here.
const usage = {
  prompt_tokens: 100,
  completion_tokens: 40,
  total_tokens: 140,
  prompt_cache_hit_tokens: 60,
};
const chatModelUsage = { ...usage, total_reqs: 2 };

test("tokens-summary: aggregates ALL sessions incl. silent subagents, per model", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "toksum-"));
  try {
    const file = await makeIndex(root, [
      { usage, usagePerModel: { "deepseek-chat": chatModelUsage }, updateTime: "2026-09-01T10:00:00.000Z" },
      {
        isSilentSubagent: true,
        usage,
        usagePerModel: { "deepseek-reasoner": { ...chatModelUsage, total_reqs: 1 } },
        updateTime: "2026-09-01T11:00:00.000Z",
      },
    ]);
    const s = buildTokenSummary("/r", file);
    assert.equal(s.sessions, 2);
    assert.equal(s.silentSessions, 1);
    assert.equal(s.totalTokens, 280);
    // requests = Σ per-model total_reqs (2 + 1) — entry-level usage never
    // carries a request counter in production.
    assert.equal(s.requests, 3);
    assert.equal(s.lastAt, "2026-09-01T11:00:00.000Z");
    assert.equal(s.perModel["deepseek-chat"].total, 140);
    // per-model tallies pass the persisted counters straight through
    assert.equal(s.perModel["deepseek-chat"].reqs, 2);
    assert.equal(s.perModel["deepseek-reasoner"].reqs, 1);
    assert.equal(s.perModel["deepseek-chat"].cacheRead, 60);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("tokens-summary: missing index → zero summary (no throw)", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "toksum2-"));
  try {
    const s = buildTokenSummary("/r", path.join(root, "projects", "none", "sessions-index.json"));
    assert.equal(s.sessions, 0);
    assert.equal(s.totalTokens, 0);
    assert.equal(s.lastAt, null);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("tokens-summary: index path mirrors core persistence layout", () => {
  const p = projectSessionsIndexPath("/home/u/.deeporca", "/work/repo");
  assert.match(p, /projects[\\/]-work-repo[\\/]sessions-index\.json$/);
});

test("tokens-summary: exact time windows from the usage ledger", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "toksum3-"));
  try {
    const now = Date.now();
    // Derive the local-time bucket boundaries with the same rules the
    // implementation uses, then place records deterministically relative to
    // them (TZ-robust: expectations follow the derived boundaries).
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();
    const weekday = (startOfToday.getDay() + 6) % 7;
    // Same calendar-day rollback the implementation uses (DST-safe) —
    // mirroring a different derivation would disagree by an hour in DST zones.
    const startOfThisWeek = new Date(startOfToday);
    startOfThisWeek.setDate(startOfThisWeek.getDate() - weekday);
    const weekMs = startOfThisWeek.getTime();
    // One record inside every bucket, one inside today but OUTSIDE the 5h
    // window, one inside the week but OUTSIDE today, one ancient.
    const tsAll = now - 60_000;
    const tsTodayOnly = Math.max(todayMs + 60_000, now - 5 * 3600_000 - 60_000);
    const tsWeekOnly = Math.max(weekMs + 60_000, todayMs - 60_000);
    const tsAncient = weekMs - 30 * 86_400_000;

    const file = await makeIndex(root, [
      {
        usage,
        usagePerModel: { "deepseek-chat": { ...usage } },
        updateTime: new Date(now - 6 * 3600_000).toISOString(),
      },
    ]);
    const records = [
      { ts: tsAll, total: 110 },
      { ts: tsTodayOnly, total: 220 },
      { ts: tsWeekOnly, total: 440 },
      { ts: tsAncient, total: 880 },
    ];
    await writeLedger(
      file,
      records.map((record) => ({
        ts: new Date(record.ts).toISOString(),
        prompt: record.total - 10,
        completion: 10,
        source: "chat",
        estimated: true,
      }))
    );
    const bucket = (cutoff: number) => records.filter((record) => record.ts >= cutoff);
    const s = buildTokenSummary("/r", file, now);
    assert.equal(s.windowsApproximate, false, "ledger present → exact windows");
    assert.equal(s.windows.last5h.reqs, bucket(now - 5 * 3600_000).length);
    assert.equal(s.windows.today.reqs, bucket(todayMs).length);
    assert.equal(s.windows.thisWeek.reqs, bucket(weekMs).length);
    assert.equal(
      s.windows.last5h.total,
      bucket(now - 5 * 3600_000).reduce((sum, record) => sum + record.total, 0)
    );
    assert.equal(
      s.windows.thisWeek.total,
      bucket(weekMs).reduce((sum, record) => sum + record.total, 0)
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("tokens-summary: legacy approximation fallback when no ledger exists", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "toksum4-"));
  try {
    const file = await makeIndex(root, [
      {
        usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
        updateTime: new Date(Date.now() - 60_000).toISOString(),
      },
    ]);
    const s = buildTokenSummary("/r", file);
    assert.equal(s.windowsApproximate, true);
    assert.equal(s.windows.last5h.total, 1500, "whole session attributed to its updateTime");
    assert.equal(s.windows.thisWeek.total, 1500);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("tokens-summary: legacy migration backfills once, then is a no-op", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "toksum5-"));
  try {
    const file = await makeIndex(root, [
      {
        id: "session-a",
        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
        usagePerModel: { "deepseek-chat": { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 } },
        updateTime: "2026-09-01T10:00:00.000Z",
      },
      { id: "session-b" }, // no usage → not imported
    ]);
    const imported = migrateLegacyUsageIntoLedger(file);
    assert.equal(imported, 1, "only the usage-bearing session is imported");

    const ledger = readUsageLedger(usageLedgerPathForIndex(file));
    assert.equal(ledger.length, 2, "imported record + backfill marker");
    assert.equal(ledger[0]?.sessionId, "session-a");
    assert.equal(ledger[0]?.model, "deepseek-chat");
    assert.equal(ledger[0]?.prompt, 100);
    assert.equal(ledger[0]?.estimated, true);
    assert.equal(ledger[1]?.source, "backfill", "marker record closes the backfill");

    // Idempotent: the backfill marker record — not file existence — marks
    // the workspace as migrated.
    assert.equal(migrateLegacyUsageIntoLedger(file), 0);

    // And the summary now reports exact windows off the imported record.
    const s = buildTokenSummary("/r", file);
    assert.equal(s.windowsApproximate, false);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("tokens-summary: migration after a native request imports legacy without duplicating ledgered sessions", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "toksum7-"));
  try {
    const now = Date.now();
    const file = await makeIndex(root, [
      {
        // Pre-rework session: totals in the index, no ledger records of its own.
        id: "legacy-a",
        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
        updateTime: new Date(now - 3600_000).toISOString(),
      },
      {
        // Post-rework session: its requests already landed in the ledger.
        id: "native-b",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        updateTime: new Date(now - 60_000).toISOString(),
      },
    ]);
    // The upgrade race: a native request created the ledger BEFORE the first
    // panel open — a file-existence check would (wrongly) skip the backfill.
    await writeLedger(file, [
      {
        ts: new Date(now - 60_000).toISOString(),
        model: "deepseek-chat",
        prompt: 10,
        completion: 5,
        source: "chat",
        sessionId: "native-b",
        estimated: true,
      },
    ]);

    const imported = migrateLegacyUsageIntoLedger(file);
    assert.equal(imported, 1, "legacy-a imported; native-b deduped by id");

    const ledger = readUsageLedger(usageLedgerPathForIndex(file));
    assert.equal(ledger.filter((record) => record.sessionId === "native-b").length, 1, "no duplicate");
    assert.ok(
      ledger.some((record) => record.source === "backfill"),
      "marker closes the backfill"
    );

    const s = buildTokenSummary("/r", file, now);
    assert.equal(s.windowsApproximate, false);
    assert.equal(s.windows.thisWeek.reqs, 2, "the marker record is not a request");
    assert.equal(s.windows.thisWeek.total, 155, "legacy + native totals, marker contributes zero");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("tokens-summary: cost estimate prices known models, null otherwise", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "toksum6-"));
  try {
    const priced = await makeIndex(root, [
      {
        usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
        usagePerModel: {
          "deepseek-chat": { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
        },
        updateTime: "2026-09-01T10:00:00.000Z",
      },
    ]);
    const s = buildTokenSummary("/r", priced);
    // deepseek-chat list estimate: $0.27 prompt/M + $1.10 completion/M
    assert.ok(Math.abs((s.costUsd ?? 0) - 1.37) < 0.001);

    const unpriced = await makeIndex(root, [
      {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        usagePerModel: { "some-unknown-model": { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        updateTime: "2026-09-01T10:00:00.000Z",
      },
    ]);
    assert.equal(buildTokenSummary("/r", unpriced).costUsd, null);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
