/**
 * analysis-status tests — tri-state vocabulary and rendering for per-call
 * degradation reporting in analysis-layer actions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeBackendStatus } from "../common/analysis-status";

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
