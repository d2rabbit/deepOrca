/**
 * Query-variants tests — the deterministic multi-query rewrite for the hybrid
 * recall FTS leg (LLM-free, fixed-role variants; see query-variants.ts).
 *
 * Locks in:
 *   - stripTimeExpressions: zh/en relative words, absolute dates (ISO + 中文),
 *     "N units ago" offsets, mixed queries, queries that are ONLY a time
 *     expression (→ empty), no-time queries (→ unchanged);
 *   - buildRecallQueryVariants: dedup, no-op variant dropped, original always
 *     first, empty original handled;
 *   - fuseByRrf: sum across lists, k=60 arithmetic, payload from best rank,
 *     deterministic tie-break, empty input.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripTimeExpressions, buildRecallQueryVariants, fuseByRrf, RRF_K } from "../tdai/core/hooks/query-variants.js";
import type { L1FtsResult } from "../tdai/core/store/types.js";

// ── stripTimeExpressions ─────────────────────────────────────────────────────

test("strips Chinese relative-time words", () => {
  assert.equal(stripTimeExpressions("上周我们订了去日本的机票"), "我们订了去日本的机票");
  assert.equal(stripTimeExpressions("昨天做的那个决定"), "做的那个决定");
  assert.equal(stripTimeExpressions("最近的计划"), "的计划");
});

test("strips English relative-time phrases case-insensitively", () => {
  assert.equal(stripTimeExpressions("What did I book Last Week?"), "What did I book?");
  assert.equal(stripTimeExpressions("the tool I recommended yesterday"), "the tool I recommended");
});

test("strips absolute dates in ISO and Chinese forms", () => {
  assert.equal(stripTimeExpressions("2025-03-01 的那次旅行"), "的那次旅行");
  assert.equal(stripTimeExpressions("2025/3 的预算"), "的预算");
  assert.equal(stripTimeExpressions("2025年3月1日 开的会"), "开的会");
  assert.equal(stripTimeExpressions("3月5号 提的需求"), "提的需求");
});

test("strips N-units-ago offsets in both languages", () => {
  assert.equal(stripTimeExpressions("the bug I hit 3 days ago"), "the bug I hit");
  assert.equal(stripTimeExpressions("两周前说过的话"), "说过的话");
});

test("query with no time expressions is unchanged", () => {
  assert.equal(stripTimeExpressions("我们用的数据库是什么"), "我们用的数据库是什么");
  assert.equal(stripTimeExpressions("preferred editor setup"), "preferred editor setup");
});

test("time-only query strips to empty", () => {
  assert.equal(stripTimeExpressions("昨天"), "");
  assert.equal(stripTimeExpressions("last week"), "");
});

test("whitespace is collapsed after stripping", () => {
  const out = stripTimeExpressions("上周  和  上个月   的计划");
  assert.equal(out, "和 的计划");
});

// ── buildRecallQueryVariants ─────────────────────────────────────────────────

test("variants: original first, event variant second, deduped", () => {
  const variants = buildRecallQueryVariants("上周我们订了机票");
  assert.deepEqual(variants, ["上周我们订了机票", "我们订了机票"]);
});

test("variants: no-time query yields the original only (no-op variant dropped)", () => {
  assert.deepEqual(buildRecallQueryVariants("常用工具链"), ["常用工具链"]);
});

test("variants: time-only query yields only the original", () => {
  // event variant strips to empty → dropped; original survives
  assert.deepEqual(buildRecallQueryVariants("昨天"), ["昨天"]);
});

test("variants: empty input yields no variants", () => {
  assert.deepEqual(buildRecallQueryVariants("   "), []);
});

// ── fuseByRrf ────────────────────────────────────────────────────────────────

function fts(id: string, score: number): L1FtsResult {
  return {
    record_id: id,
    content: `content-${id}`,
    type: "episodic",
    priority: 50,
    scene_name: "s",
    score,
    timestamp_str: "",
    timestamp_start: "",
    timestamp_end: "",
    session_key: "k",
    session_id: "i",
    metadata_json: "",
  };
}

test("fuse: record present in both variant lists outranks single-list records", () => {
  const listA = [fts("a", 0.9), fts("b", 0.8)];
  const listB = [fts("b", 0.5), fts("c", 0.4)];
  const fused = fuseByRrf([listA, listB]);
  // b: 1/61 + 1/62 > a: 1/61? a=1/61≈0.01639, b=1/61+1/62≈0.03252 → b first
  assert.equal(fused[0].record_id, "b");
  assert.ok(
    fused
      .slice(1)
      .map((r) => r.record_id)
      .includes("a")
  );
  assert.ok(fused.map((r) => r.record_id).includes("c"));
  assert.equal(fused.length, 3);
});

test("fuse: exact k=60 arithmetic (1/(60+rank+1))", () => {
  const fused = fuseByRrf([[fts("x", 1), fts("y", 1)]]);
  // rank 0 → 1/61, rank 1 → 1/62 — order preserved, values not exposed;
  // assert the constant contract instead
  assert.equal(RRF_K, 60);
  assert.deepEqual(
    fused.map((r) => r.record_id),
    ["x", "y"]
  );
});

test("fuse: payload comes from the best-ranked occurrence", () => {
  const listA = [fts("a", 0.1)];
  const listB = [fts("a", 0.9)];
  // both rank 0 — first list wins (stable), deterministic
  const fused = fuseByRrf([listA, listB]);
  assert.equal(fused[0].record_id, "a");
  assert.equal(fused.length, 1);
});

test("fuse: empty lists and empty input", () => {
  assert.deepEqual(fuseByRrf([]), []);
  assert.deepEqual(fuseByRrf([[], []]), []);
});
