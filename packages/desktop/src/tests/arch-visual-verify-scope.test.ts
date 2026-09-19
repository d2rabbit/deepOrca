/**
 * Tests for the arch-scan verification scope filter (full-domain audit
 * round-2): the revision loop used to verify EVERY delivered artifact under
 * `.deeporca/prototypes/` — a visually-failing legacy leftover from another
 * run dragged unrelated LLM revision rounds and reported non-convergence for
 * artifacts this run never touched. The scope is mtime-based (IR newer than
 * the run's start), not focus-name-based (artifact names are LLM-chosen).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { filterArtifactsSince } from "../main/tools/arch-visual-verify.js";

const art = (name: string, iso: string) => ({ name, mtime: iso });

test("undefined sinceMs keeps everything (verify-everything callers unchanged)", () => {
  const artifacts = [art("legacy", "2026-09-01T00:00:00.000Z"), art("fresh", "2026-09-20T00:00:00.000Z")];
  assert.equal(filterArtifactsSince(artifacts, undefined).length, 2);
});

test("artifacts older than or equal to the watermark are excluded; newer kept (strictly-newer)", () => {
  const artifacts = [
    art("legacy", "2026-09-01T00:00:00.000Z"),
    art("boundary", "2026-09-19T12:00:00.000Z"), // EXACTLY the watermark
    art("fresh", "2026-09-19T12:00:00.001Z"),
  ];
  const scoped = filterArtifactsSince(artifacts, Date.parse("2026-09-19T12:00:00.000Z"));
  assert.deepEqual(
    scoped.map((a) => a.name),
    ["fresh"],
    "strictly-newer only — an artifact touched during the same millisecond as run start still counts as pre-run"
  );
});

test("a re-delivered legacy name (refreshed mtime) stays in scope", () => {
  // The one legitimate "old name, this run" case: arch-scan revised an
  // existing diagram — the deliver gate rewrote its IR, mtime is fresh.
  const artifacts = [art("updated-legacy", "2026-09-20T00:00:05.000Z")];
  const scoped = filterArtifactsSince(artifacts, Date.parse("2026-09-20T00:00:00.000Z"));
  assert.deepEqual(
    scoped.map((a) => a.name),
    ["updated-legacy"]
  );
});

test("empty input and empty result shapes", () => {
  assert.deepEqual(filterArtifactsSince([], 123), []);
  assert.deepEqual(filterArtifactsSince([art("old", "1970-01-01T00:00:00.000Z")], Date.now()), []);
});

test("the host wiring forwards the sinceMs opts (R3 wiring fix)", () => {
  // The one-arg lambda `(root) => verifyArchArtifacts(root)` silently DROPPED
  // the opts argument — a narrower lambda is assignable to the seam type, so
  // only a source guard can pin the forwarding.
  const src = fs.readFileSync(path.join(process.cwd(), "../main/knowledge-ipc.ts"), "utf8");
  assert.ok(
    /configureArchVisualVerifier\(\(root: string, opts\?: \{ sinceMs\?: number \}\) => verifyArchArtifacts\(root, opts\)\)/.test(
      src
    ),
    "knowledge-ipc must forward the opts argument to verifyArchArtifacts"
  );
});
