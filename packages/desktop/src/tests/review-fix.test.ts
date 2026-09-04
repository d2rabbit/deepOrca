/**
 * Tests for the review one-click fix brief (real-machine feature: findings →
 * fix PLAN in session mode → execution). Pins:
 *   - every finding (path:line, issue, suggestion, risk tag) reaches the brief,
 *   - the brief MANDATES plan-first (UpdatePlan) + verify + report steps,
 *   - extraction tolerates the action output's unknown shape (never throws),
 *   - nothing to fix → empty brief (button contract stays total).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReviewFixPrompt, extractReviewFindings, type ReviewFinding } from "../renderer/lib/review-fix";

const findings: ReviewFinding[] = [
  {
    path: "packages/core/src/session.ts",
    startLine: 100,
    endLine: 104,
    content: "Race condition: two updates rebase on the stale file state.",
    suggestionCode: "const pending = readPending();",
    crgRisk: "HIGH (12 callers)",
  },
  {
    path: "packages/desktop/src/main/index.ts",
    startLine: 42,
    content: "Unhandled promise rejection in the IPC handler.",
  },
];

test("brief carries every finding with location, issue, suggestion and risk tag", () => {
  const brief = buildReviewFixPrompt(findings);
  assert.match(brief, /共 2 项，涉及 2 个文件/);
  assert.match(brief, /packages\/core\/src\/session\.ts:100-104/);
  assert.match(brief, /\[结构风险 HIGH \(12 callers\)\]/);
  assert.match(brief, /Race condition/);
  assert.match(brief, /const pending = readPending\(\);/);
  assert.match(brief, /packages\/desktop\/src\/main\/index\.ts:42/);
  assert.match(brief, /Unhandled promise rejection/);
});

test("brief mandates plan-first, scoped fixes, verification and reporting", () => {
  const brief = buildReviewFixPrompt(findings);
  assert.match(brief, /UpdatePlan/);
  assert.match(brief, /覆盖以上全部病灶/);
  assert.match(brief, /不做无关重构/);
  assert.match(brief, /npm run typecheck/);
  assert.match(brief, /逐项汇报/);
});

test("huge suggestion blocks are clipped, not dropped", () => {
  const big = { ...findings[0], suggestionCode: `line\n`.repeat(500) };
  const brief = buildReviewFixPrompt([big]);
  assert.ok(brief.length < 5000, `brief should stay readable, got ${brief.length}`);
  assert.match(brief, /已截断/);
});

test("empty or invalid findings produce an empty brief", () => {
  assert.equal(buildReviewFixPrompt([]), "");
  assert.equal(buildReviewFixPrompt([{ path: "", startLine: 0, content: "" }]), "");
});

test("extraction reads review.full output shape and tolerates junk", () => {
  const output = {
    review: {
      comments: [
        { path: "a.ts", startLine: 3, endLine: 5, content: "x", suggestionCode: "fix()", crgRisk: "LOW" },
        { path: "b.ts", start_line: 7, content: "snake_case tolerated" },
        { path: "", startLine: 9, content: "no path — dropped" },
        null,
        42,
      ],
    },
    risk: { graphBuilt: false, reason: "no graph" },
    status: "degraded",
  };
  const got = extractReviewFindings(output);
  assert.equal(got.length, 2);
  assert.deepEqual(
    { path: got[0].path, startLine: got[0].startLine, crgRisk: got[0].crgRisk },
    { path: "a.ts", startLine: 3, crgRisk: "LOW" }
  );
  assert.equal(got[1].startLine, 7);

  assert.deepEqual(extractReviewFindings(null), []);
  assert.deepEqual(extractReviewFindings("nope"), []);
  assert.deepEqual(extractReviewFindings({ review: { comments: "not-an-array" } }), []);
});

test("extraction strips the delegation [SEVERITY] content prefix", () => {
  // Review round 2026-09-01: the brief carries the severity through the
  // [结构风险 …] tag — a verbatim [HIGH] prefix made every item read
  // "HIGH … [结构风险 HIGH …]".
  const output = {
    review: {
      comments: [
        { path: "a.ts", startLine: 3, content: "[HIGH] race on shared map" },
        { path: "b.ts", startLine: 4, content: "[CRITICAL]\nmulti-line finding" },
        { path: "c.ts", startLine: 5, content: "no prefix at all" },
      ],
    },
  };
  const got = extractReviewFindings(output);
  assert.equal(got[0].content, "race on shared map");
  assert.equal(got[1].content, "multi-line finding");
  assert.equal(got[2].content, "no prefix at all");

  const brief = buildReviewFixPrompt(got);
  assert.ok(!/\[HIGH\] race/.test(brief), "brief must not repeat the raw severity prefix");
});
