/**
 * analysis-status tests — tri-state vocabulary and rendering for per-call
 * degradation reporting in analysis-layer actions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeBackendStatus, formatBackendStatusBlock } from "../common/analysis-status";

test("describe: state + backend + detail", () => {
  assert.equal(
    describeBackendStatus({ status: "active", backend: "codegraph", detail: "index present" }),
    "status: active (codegraph) — index present"
  );
});

test("describe: remedy appended when present", () => {
  assert.equal(
    describeBackendStatus({
      status: "degraded",
      backend: "crg",
      detail: "no graph",
      remedy: "run crg.reindex",
    }),
    "status: degraded (crg) — no graph — remedy: run crg.reindex"
  );
});

test("describe: unavailable without remedy renders fine", () => {
  const line = describeBackendStatus({
    status: "unavailable",
    backend: "subagent",
    detail: "runtime missing",
  });
  assert.ok(line.startsWith("status: unavailable (subagent) — runtime missing"));
  assert.ok(!line.includes("remedy"));
});

test("block: description line + standing legend line", () => {
  const block = formatBackendStatusBlock({
    status: "degraded",
    backend: "review.full",
    detail: "semantic only",
  });
  const lines = block.split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("status: degraded (review.full) — semantic only"));
  assert.ok(lines[1].includes("degraded: partial result above"));
  assert.ok(lines[1].includes("unavailable: no analysis, do not guess"));
});
