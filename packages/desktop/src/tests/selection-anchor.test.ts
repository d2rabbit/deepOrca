import assert from "node:assert/strict";
import { test } from "node:test";
import { computeFloatPlacement } from "../renderer/lib/selection-anchor";

const VIEW = { viewportWidth: 1600, viewportHeight: 900, panelWidth: 380, panelHeight: 320 };

test("anchor: default right-below placement", () => {
  const p = computeFloatPlacement({ anchor: { x: 200, y: 200, lineHeight: 18 }, ...VIEW });
  assert.deepEqual(p, { left: 214, top: 228, placement: "right-below" });
});

test("anchor: flips left near the right viewport edge", () => {
  const p = computeFloatPlacement({ anchor: { x: 1500, y: 200, lineHeight: 18 }, ...VIEW });
  assert.equal(p.placement, "left-below");
  // 1500 - 14 - 380 = 1106
  assert.equal(p.left, 1106);
  assert.equal(p.top, 228);
});

test("anchor: flips above near the bottom viewport edge", () => {
  const p = computeFloatPlacement({ anchor: { x: 200, y: 860, lineHeight: 18 }, ...VIEW });
  assert.equal(p.placement, "right-above");
  assert.equal(p.left, 214);
  // 860 - 14 - 320 = 526
  assert.equal(p.top, 526);
});

test("anchor: flips both near the bottom-right corner", () => {
  const p = computeFloatPlacement({ anchor: { x: 1500, y: 860, lineHeight: 18 }, ...VIEW });
  assert.equal(p.placement, "left-above");
  assert.equal(p.left, 1106);
  assert.equal(p.top, 526);
});

test("anchor: clamps into the viewport when even the flipped side overflows", () => {
  // Tiny viewport: flipped left would be negative → clamped to margin 8.
  const p = computeFloatPlacement({
    anchor: { x: 100, y: 100, lineHeight: 18 },
    viewportWidth: 300,
    viewportHeight: 200,
    panelWidth: 380,
    panelHeight: 320,
  });
  assert.equal(p.left, 8);
  assert.equal(p.top, Math.max(8, Math.min(128, 200 - 320 - 8)));
});
