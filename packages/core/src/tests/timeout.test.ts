/**
 * withTimeoutNull truth table (specs/sop-extraction P2.1 — the 2s race budget
 * shared by the action-facing memory seam).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { withTimeoutNull } from "../common/timeout";

test("withTimeoutNull: fast promise wins; slow promise and rejection both resolve null", async () => {
  assert.equal(await withTimeoutNull(Promise.resolve("hit"), 500), "hit");
  const slow = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 200));
  assert.equal(await withTimeoutNull(slow, 10), null, "slow lookup degrades to null");
  assert.equal(await withTimeoutNull(Promise.reject(new Error("boom")), 500), null, "failure degrades to null");
});
