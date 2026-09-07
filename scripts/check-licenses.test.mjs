/**
 * Unit tests for the license gate's SPDX expression evaluator
 * (scripts/spdx-expression.mjs, consumed by check-licenses.js).
 *
 * Regression anchor for the 2026-09-07 double-review finding: the previous
 * implementation stripped parentheses and split on OR first, which accepted
 * "(MIT OR Apache-2.0) AND GPL-3.0-only" — a copyleft conjunct sneaking past
 * the gate. These cases pin conjunct refusal under nesting and fail-closed
 * behavior for anything unparsable.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedExpression } from "./spdx-expression.mjs";

const ALLOWED = new Set(["MIT", "ISC", "Apache-2.0", "BSD-2-Clause"]);

test("flat conjunction requires every side allowed", () => {
  assert.equal(isAllowedExpression("MIT AND ISC", ALLOWED), true);
  assert.equal(isAllowedExpression("MIT AND GPL-3.0-only", ALLOWED), false);
});

test("flat disjunction accepts when one side is allowed", () => {
  assert.equal(isAllowedExpression("GPL-3.0-only OR MIT", ALLOWED), true);
  assert.equal(isAllowedExpression("GPL-3.0-only OR AGPL-3.0-only", ALLOWED), false);
});

test("parenthesized disjunction under AND refuses the copyleft conjunct", () => {
  // The original finding: flattening parentheses made the left disjunct
  // satisfy an OR-first split and waved the GPL conjunct through.
  assert.equal(isAllowedExpression("(MIT OR Apache-2.0) AND GPL-3.0-only", ALLOWED), false);
  assert.equal(isAllowedExpression("(MIT OR Apache-2.0) AND ISC", ALLOWED), true);
});

test("AND binds tighter than OR without parentheses", () => {
  assert.equal(isAllowedExpression("GPL-3.0-only OR MIT AND ISC", ALLOWED), true);
  assert.equal(isAllowedExpression("MIT AND ISC OR GPL-3.0-only", ALLOWED), true);
  assert.equal(isAllowedExpression("MIT OR ISC AND GPL-3.0-only", ALLOWED), true);
});

test("nested parentheses evaluate recursively", () => {
  assert.equal(isAllowedExpression("((MIT))", ALLOWED), true);
  assert.equal(isAllowedExpression("(MIT AND (ISC OR Apache-2.0))", ALLOWED), true);
  assert.equal(isAllowedExpression("(MIT AND ISC) OR GPL-3.0-only", ALLOWED), true);
  assert.equal(isAllowedExpression("((MIT OR ISC) AND GPL-3.0-only) OR BSD-2-Clause", ALLOWED), true);
});

test("operators are case-insensitive, license ids are not", () => {
  assert.equal(isAllowedExpression("MIT and ISC", ALLOWED), true);
  assert.equal(isAllowedExpression("mit AND isc", ALLOWED), false);
});

test("trailing inferred-license star is dropped", () => {
  assert.equal(isAllowedExpression("MIT*", ALLOWED), true);
});

test("unparsable expressions fail closed", () => {
  assert.equal(isAllowedExpression("", ALLOWED), false);
  assert.equal(isAllowedExpression("(MIT OR ISC", ALLOWED), false);
  assert.equal(isAllowedExpression("MIT)", ALLOWED), false);
  assert.equal(isAllowedExpression("MIT OR", ALLOWED), false);
  assert.equal(isAllowedExpression("AND MIT", ALLOWED), false);
  assert.equal(isAllowedExpression("MIT WITH Classpath-exception-2.0", ALLOWED), false);
});
