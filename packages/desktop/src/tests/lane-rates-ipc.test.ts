// Unit tests for tools/lane-rates-ipc.ts (the extracted LaneRatesGet
// pipeline). Plain Node — no DOM, no Electron: exercises the
// select → preload → collect → compute flow against a temp project dir.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { laneRatesReport, readLaneRateTranscripts, selectRecentLaneSessions } from "../main/tools/lane-rates-ipc";

const T0 = "2026-09-07T10:00:00Z";

/** sessions-index entry shape used across the selection test — mirrors core's
 *  persisted SessionEntry (createTime/updateTime; there is no updateTime). */
type Entry = { id: string; isSilentSubagent?: boolean; updateTime?: string; createTime?: string };

/** Fresh temp project dir; caller removes it in a finally block. */
function makeProjectDir(): string {
  return mkdtempSync(join(tmpdir(), "deeporca-lane-rates-"));
}

function writeIndex(projectDir: string, entries: unknown[]): void {
  writeFileSync(join(projectDir, "sessions-index.json"), JSON.stringify({ entries }), "utf8");
}

function writeTranscript(projectDir: string, id: string, lines: unknown[]): void {
  writeFileSync(join(projectDir, `${id}.jsonl`), lines.map((line) => JSON.stringify(line)).join("\n"), "utf8");
}

/** A session message line shaped like the on-disk transcript format. */
function line(role: string, text: string, createTime?: string): object {
  return { role, content: text, createTime, meta: { userPrompt: { text } } };
}

test("selectRecentLaneSessions keeps the newest 80 non-silent entries", () => {
  const base = Date.UTC(2026, 8, 7, 0, 0, 0);
  const iso = (ms: number): string => new Date(ms).toISOString();
  const entries: Entry[] = Array.from({ length: 85 }, (_, i) => ({ id: `s${i}`, updateTime: iso(base + i * 60_000) }));
  // Newest entry overall is a silent subagent — must be filtered, not selected.
  const all: Entry[] = [...entries, { id: "agent-x", isSilentSubagent: true, updateTime: iso(base + 85 * 60_000) }];

  const out = selectRecentLaneSessions(all);
  assert.equal(out.length, 80);
  assert.ok(out.every((entry) => !entry.isSilentSubagent));
  // The 5 OLDEST (s0..s4) are dropped by the bound — re-review H1 regression:
  // a field-name mixup here degenerates the sort and keeps the oldest instead.
  assert.ok(out.every((entry) => Number(entry.id.slice(1)) >= 5));
  for (let i = 1; i < out.length; i += 1) {
    assert.ok(Date.parse(out[i - 1]!.updateTime!) >= Date.parse(out[i]!.updateTime!), "sorted updateTime desc");
  }
  // Custom bound is honoured.
  assert.equal(selectRecentLaneSessions(all, 3).length, 3);
  // Missing timestamps are NaN-safe: they sink to the tail and get dropped by
  // the bound instead of surfacing in the selection.
  const withNoDate = selectRecentLaneSessions([{ id: "nodate" }, ...entries]);
  assert.equal(withNoDate.length, 80);
  assert.ok(withNoDate.every((entry) => entry.id !== "nodate"));
  // createTime fallback: entries without updateTime still order by creation.
  const byCreation = selectRecentLaneSessions(
    [
      { id: "old-create", createTime: "2026-09-01T00:00:00Z" },
      { id: "new-create", createTime: "2026-09-06T00:00:00Z" },
      { id: "newer-update", updateTime: "2026-09-07T00:00:00Z" },
    ],
    3
  );
  assert.deepEqual(
    byCreation.map((entry) => entry.id),
    ["newer-update", "new-create", "old-create"]
  );
});

test("readLaneRateTranscripts: missing file and corrupt line degrade to empty samples", async () => {
  const dir = makeProjectDir();
  try {
    writeTranscript(dir, "good", [line("user", "hello", T0), { role: "assistant", content: "hi" }]);
    // A corrupt JSONL line poisons only its own file (per-file catch).
    writeFileSync(join(dir, "broken.jsonl"), `${JSON.stringify(line("user", "hi", T0))}\n{corrupt`, "utf8");

    const map = await readLaneRateTranscripts(dir, [{ id: "good" }, { id: "missing" }, { id: "broken" }]);
    assert.equal(map.get("good")?.length, 2);
    assert.deepEqual(map.get("missing"), []);
    assert.deepEqual(map.get("broken"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("laneRatesReport end-to-end: deep negative + express follow-up", async () => {
  const dir = makeProjectDir();
  try {
    writeIndex(dir, [
      { id: "deep1", lane: "deep", updateTime: "2026-09-07T10:06:00Z" },
      { id: "exp1", lane: "express", updateTime: "2026-09-07T10:07:00Z" },
    ]);
    writeTranscript(dir, "deep1", [
      line("user", "帮我写一份详细的市场分析报告", T0),
      { role: "assistant", content: "好的，报告如下……" },
      line("user", "太啰嗦了，直接点", "2026-09-07T10:05:00Z"), // inside the 10-min window
    ]);
    writeTranscript(dir, "exp1", [
      line("user", "how to fix the login bug", T0),
      line("user", "the login bug is still failing", "2026-09-07T10:04:00Z"), // related follow-up
    ]);

    const report = await laneRatesReport(dir, { evaluateL1: () => null });
    assert.ok(report);
    assert.equal(report.deepSessions, 1);
    assert.equal(report.expressSessions, 1);
    assert.equal(report.deepNegativeFeedbackRate, 1);
    assert.equal(report.expressFollowUpRate, 1);
    assert.deepEqual(report.samples, { followUps: 1, negatives: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("laneRatesReport: silent subagent entry and missing transcript degrade gracefully", async () => {
  const dir = makeProjectDir();
  try {
    writeIndex(dir, [
      { id: "real", lane: "express", updateTime: "2026-09-07T10:00:00Z" },
      { id: "ghost", isSilentSubagent: true, updateTime: "2026-09-07T11:00:00Z" },
      { id: "nofile", updateTime: "2026-09-07T09:00:00Z" },
    ]);
    writeTranscript(dir, "real", [line("user", "quick question about css grid", T0)]);

    const report = await laneRatesReport(dir, { evaluateL1: () => null });
    assert.ok(report);
    assert.equal(report.expressSessions, 1);
    assert.equal(report.deepSessions, 0);
    assert.equal(report.expressFollowUpRate, 0); // one express session, no follow-up
    assert.equal(report.deepNegativeFeedbackRate, null); // no deep sessions → rate undefined
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("laneRatesReport: corrupt sessions-index.json fails open with null", async () => {
  const dir = makeProjectDir();
  try {
    writeFileSync(join(dir, "sessions-index.json"), "{ not json", "utf8");
    assert.equal(await laneRatesReport(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
