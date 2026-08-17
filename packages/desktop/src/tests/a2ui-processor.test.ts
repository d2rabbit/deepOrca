/**
 * Tests for the A2UI processor's garbage collection + component-tree handling.
 *
 * These lock in the fix for the orphan-retention bug: deleting a parent left
 * its children (whose parentId no longer matched any component) promoted to
 * the root level instead of being pruned.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { processA2uiMessages, getSurface } from "../renderer/a2ui/processor";

const SURFACE = "test-surface";

function createSurface(): void {
  processA2uiMessages(JSON.stringify([{ type: "createSurface", surfaceId: SURFACE, title: "T" }]));
}

function replace(components: unknown[]): void {
  processA2uiMessages(JSON.stringify([{ type: "updateComponents", surfaceId: SURFACE, components }]));
}

function merge(components: unknown[]): void {
  processA2uiMessages(JSON.stringify([{ type: "updateComponents", surfaceId: SURFACE, components, mode: "merge" }]));
}

function ids(): string[] {
  return (getSurface(SURFACE)?.components ?? []).map((c) => c.id);
}

beforeEach(() => {
  // Reset by deleting the surface; recreate per test.
  processA2uiMessages(JSON.stringify([{ type: "deleteSurface", surfaceId: SURFACE }]));
});

test("GC: deleting a parent prunes its children (no orphan promotion)", () => {
  createSurface();
  replace([
    { id: "root", type: "card" },
    { id: "child", type: "text", parentId: "root", properties: { text: "hi" } },
  ]);
  assert.deepEqual(ids().sort(), ["child", "root"]);

  // Merge-delete the parent. The child is now an orphan and must be removed
  // (earlier code promoted it to a root and kept it).
  merge([{ id: "root", _delete: true }]);
  assert.deepEqual(ids(), [], "deleting a parent must prune its orphaned children");
});

test("GC: nested delete prunes the whole subtree", () => {
  createSurface();
  replace([
    { id: "root", type: "card" },
    { id: "mid", type: "card", parentId: "root" },
    { id: "leaf", type: "text", parentId: "mid" },
  ]);
  // Delete the middle node: leaf (child of mid) must also go.
  merge([{ id: "mid", _delete: true }]);
  assert.deepEqual(ids().sort(), ["root"], "nested delete must prune the entire descendant subtree");
});

test("GC: a true root (no parentId) is retained", () => {
  createSurface();
  replace([
    { id: "root", type: "card" },
    { id: "btn", type: "button", parentId: "root", properties: { label: "ok" } },
  ]);
  merge([{ id: "btn", properties: { label: "changed" }, type: "button", parentId: "root" }]);
  assert.deepEqual(ids().sort(), ["btn", "root"]);
});

test("GC: replace mode wipes then re-adds (no merge GC)", () => {
  createSurface();
  replace([{ id: "root", type: "card" }]);
  // Replace with a fresh single root — old root removed by the wipe, not GC.
  replace([{ id: "root2", type: "card" }]);
  assert.deepEqual(ids(), ["root2"]);
});

test("GC: orphan present from the start (replace) is kept until a merge triggers GC", () => {
  createSurface();
  // Replace seeds an orphan directly (parentId points to nothing).
  replace([
    { id: "root", type: "card" },
    { id: "orphan", type: "text", parentId: "missing", properties: { text: "x" } },
  ]);
  // Replace mode does not run GC, so the orphan is still present here.
  assert.deepEqual(ids().sort(), ["orphan", "root"]);
  // A no-op merge triggers GC, which prunes the orphan.
  merge([]);
  assert.deepEqual(ids(), ["root"], "an orphan whose parent never existed must be pruned on merge GC");
});

test("GC: parental cycle does not loop forever and prunes the cycle", () => {
  createSurface();
  replace([
    { id: "root", type: "card" },
    // A two-node cycle with no entry from a root — must be pruned, not loop.
    { id: "a", type: "card", parentId: "b" },
    { id: "b", type: "card", parentId: "a" },
  ]);
  // Trigger GC via a no-op merge; the cycle is unreachable from roots.
  merge([]);
  assert.deepEqual(ids(), ["root"], "a parental cycle unreachable from roots must be pruned, not retained");
});
