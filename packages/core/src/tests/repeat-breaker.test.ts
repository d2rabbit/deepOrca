// specs/model-vendor-profiles P2.1 — 循环干预阶梯：tier 边界、canonical key
// 归一（键序/循环引用）、文案选择。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  repeatTierFor,
  canonicalToolCallKey,
  reminderForTier,
  REPEAT_FORCE_STOP,
  REPEAT_VETO_TEXT,
} from "../common/repeat-breaker";

test("tier: kimi 3/5/8/12 boundaries", () => {
  assert.equal(repeatTierFor(0), 0);
  assert.equal(repeatTierFor(2), 0);
  assert.equal(repeatTierFor(3), 1);
  assert.equal(repeatTierFor(4), 1);
  assert.equal(repeatTierFor(5), 2);
  assert.equal(repeatTierFor(7), 2);
  assert.equal(repeatTierFor(8), 3);
  assert.equal(repeatTierFor(11), 3);
  assert.equal(repeatTierFor(12), 4);
  assert.equal(repeatTierFor(50), 4);
});

test("canonical key: property order does not matter; cyclic args survive", () => {
  const a = canonicalToolCallKey("bash", { command: "ls", cwd: "/x", env: { B: 2, A: 1 } });
  const b = canonicalToolCallKey("bash", { env: { A: 1, B: 2 }, cwd: "/x", command: "ls" });
  assert.equal(a, b);
  // 不同名 → 不同 key。
  assert.notEqual(canonicalToolCallKey("bash", { c: 1 }), canonicalToolCallKey("read", { c: 1 }));
  // 循环引用不抛（降级为占位）。
  const cyclic: Record<string, unknown> = { self: null };
  cyclic.self = cyclic;
  const key = canonicalToolCallKey("bash", cyclic);
  assert.equal(typeof key, "string");
});

test("reminders: L1/L2/L3 mapped; tier 0 and 4 carry no reminder (veto path)", () => {
  assert.ok(reminderForTier(1)!.includes("one sentence"));
  assert.ok(reminderForTier(2)!.includes("(1) Falsification check"));
  assert.ok(reminderForTier(3)!.includes("Text only"));
  assert.equal(reminderForTier(0), null);
  assert.equal(reminderForTier(4), null);
  assert.ok(REPEAT_VETO_TEXT.includes(String(REPEAT_FORCE_STOP)));
});
