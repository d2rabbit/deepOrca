// specs/model-vendor-profiles P3.4 — 观察式窗口学习：413 探针、min 语义、
// 防误触谓词、只收紧不放宽。
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  recordObservedWindow,
  effectiveWindowTokens,
  resetObservedWindows,
  observedWindows,
} from "../common/window-observation";

beforeEach(() => {
  resetObservedWindows();
});

test("learning: one overflow permanently (in-session) tightens the threshold", () => {
  // 目录说 1M，端点实际 128K：估算 900K 撞 413。
  const changed = recordObservedWindow("qwen3.8-flash", "https://api.example.com/v1", 900_000, 1_000_000);
  assert.equal(changed, true);
  assert.equal(effectiveWindowTokens("qwen3.8-flash", "https://api.example.com/v1", 1_000_000), 765_000);
});

test("learning: min(declared, observed) — a smaller declared window wins untouched", () => {
  assert.equal(effectiveWindowTokens("unknown-model", undefined, 200_000), 200_000);
  recordObservedWindow("m", undefined, 900_000, 1_000_000);
  assert.equal(effectiveWindowTokens("m", undefined, 200_000), 200_000); // declared 更小 → 保持
});

test("learning: predicate rejects tiny estimates (image-too-large is not a window signal)", () => {
  // 估算 400K < 0.5×1M → 不学习。
  assert.equal(recordObservedWindow("m", undefined, 400_000, 1_000_000), false);
  assert.equal(effectiveWindowTokens("m", undefined, 1_000_000), 1_000_000);
});

test("learning: only tightens — a later larger observation never widens", () => {
  recordObservedWindow("m", undefined, 900_000, 1_000_000); // → 765K
  const tightened = recordObservedWindow("m", undefined, 950_000, 1_000_000); // → 807K > 765K
  assert.equal(tightened, false);
  assert.equal(effectiveWindowTokens("m", undefined, 1_000_000), 765_000);
  // 更小且过谓词的观察仍然收紧（600K ≥ 0.5×1M → 510K < 765K）。
  assert.equal(recordObservedWindow("m", undefined, 600_000, 1_000_000), true); // → 510K
  assert.equal(effectiveWindowTokens("m", undefined, 1_000_000), 510_000);
});

test("learning: channel isolation (host differs → separate observations)", () => {
  recordObservedWindow("m", "https://a.example.com/v1", 900_000, 1_000_000);
  assert.equal(effectiveWindowTokens("m", "https://b.example.com/v1", 1_000_000), 1_000_000);
  assert.equal(effectiveWindowTokens("m", "https://a.example.com/v1", 1_000_000), 765_000);
});

test("learning: degenerate inputs never learn", () => {
  assert.equal(recordObservedWindow("m", undefined, 0, 1_000_000), false);
  assert.equal(recordObservedWindow("m", undefined, 100, 0), false);
  assert.equal(observedWindows().size, 0);
});
