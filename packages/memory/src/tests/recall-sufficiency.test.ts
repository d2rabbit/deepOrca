/**
 * CMB-8 (specs/cmb-adoption): agentic-recall sufficiency follow-up.
 *
 * Truth table pins:
 *   - sparse round 1 (< minResults) fires the follow-up on the unused
 *     deterministic variants and merges deduped results;
 *   - a rich round 1 never triggers extra queries;
 *   - disabled flag = single round (byte-stable);
 *   - a throwing variant query is skipped fail-open, round-1 lines survive;
 *   - the query budget is a hard cap even when still below the bar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applySufficiencyFollowUp } from "../tdai/core/hooks/recall-sufficiency.js";

const L = (content: string) => `- [episodic] ${content} (记录于 2026-09-04)`;

function runQueryStub(byQuery: Record<string, string[] | Error>) {
  const calls: string[] = [];
  return {
    calls,
    run: async (query: string): Promise<string[]> => {
      calls.push(query);
      const hit = byQuery[query];
      if (hit instanceof Error) throw hit;
      return hit ?? [];
    },
  };
}

test("CMB-8: sparse round 1 fires a follow-up on the unused variant and merges", async () => {
  const variant = "的预算评审结论怎么样"; // the actual time-stripped variant of the primary
  const stub = runQueryStub({
    上周的预算评审结论怎么样: [L("用户参加了评审")],
    [variant]: [L("用户参加了评审"), L("评审结论是推迟两周")],
  });
  const out = await applySufficiencyFollowUp({
    userText: "上周的预算评审结论怎么样",
    primaryQuery: "上周的预算评审结论怎么样",
    lines: [L("用户参加了评审")],
    runQuery: stub.run,
    minResults: 2,
    maxFollowUpQueries: 2,
    enabled: true,
  });
  assert.equal(out.rounds, 2);
  assert.equal(out.lines.length, 2); // dedupe: the overlapping line counted once
  assert.ok(out.lines.some((l) => l.includes("推迟两周")));
});

test("CMB-8: rich round 1 never triggers extra queries", async () => {
  const stub = runQueryStub({});
  const lines = [L("a"), L("b"), L("c")];
  const out = await applySufficiencyFollowUp({
    userText: "anything",
    primaryQuery: "anything",
    lines,
    runQuery: stub.run,
    minResults: 2,
    maxFollowUpQueries: 2,
    enabled: true,
  });
  assert.equal(out.rounds, 1);
  assert.equal(out.followUpQueries.length, 0);
  assert.equal(stub.calls.length, 0);
  assert.deepEqual(out.lines, lines);
});

test("CMB-8: disabled flag keeps a single round (byte-stable)", async () => {
  const stub = runQueryStub({ v: [L("x")] });
  const lines: string[] = [];
  const out = await applySufficiencyFollowUp({
    userText: "q",
    primaryQuery: "q",
    lines,
    runQuery: stub.run,
    minResults: 2,
    maxFollowUpQueries: 2,
    enabled: false,
  });
  assert.equal(out.rounds, 1);
  assert.equal(stub.calls.length, 0);
  assert.deepEqual(out.lines, []);
});

test("CMB-8: a throwing variant query is skipped fail-open", async () => {
  const stub = runQueryStub({ v: new Error("fts exploded") });
  const lines = [L("only hit")];
  const out = await applySufficiencyFollowUp({
    userText: "上周 v 的事",
    primaryQuery: "上周 v 的事",
    lines,
    runQuery: stub.run,
    minResults: 2,
    maxFollowUpQueries: 2,
    enabled: true,
  });
  assert.ok(out.rounds >= 1);
  assert.deepEqual(out.lines, lines); // round-1 survives untouched
});

test("CMB-8: follow-up count bounded by available variants AND the hard cap", async () => {
  const stub = runQueryStub({});
  const out = await applySufficiencyFollowUp({
    userText: "上周的预算评审结论",
    primaryQuery: "上周的预算评审结论",
    lines: [],
    runQuery: stub.run,
    minResults: 99, // unreachable bar — exercises the bound, not the bar
    maxFollowUpQueries: 2,
    enabled: true,
  });
  // Today's variant generator derives exactly one non-primary variant, so the
  // bound is availability; if variants grow, the cap (2) still holds.
  assert.ok(out.followUpQueries.length >= 1 && out.followUpQueries.length <= 2);
  assert.equal(stub.calls.length, out.followUpQueries.length);
  assert.equal(out.rounds, 1 + out.followUpQueries.length);
});
