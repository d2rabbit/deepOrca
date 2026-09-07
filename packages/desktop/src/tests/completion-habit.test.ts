// Habit-based completion (2026-09-06 user ask: 习惯性补全) — frecency store
// + the fallback source's boost/badge/apply wiring, exercised against a
// stubbed CompletionContext with the DOM harness's localStorage.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { installDom, type DomHandle } from "./dom-harness";

let dom: DomHandle | undefined;
type H = typeof import("../renderer/components/editor/completion-habit");
let H: H | undefined;
type K = typeof import("../renderer/components/editor/cm6-kernel");
let K: K | undefined;

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  H = await import("../renderer/components/editor/completion-habit");
  K = await import("../renderer/components/editor/cm6-kernel");
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom?.cleanup();
});

const DOC = `function transferAmount() {}
const platforms = 1;
transferAmount();
platforms;
GVGLCore;
`;

function contextFor(
  pos: number,
  explicit = false
): Parameters<NonNullable<typeof import("../renderer/components/editor/cm6-kernel").documentWordCompletion>>[0] {
  const doc = DOC;
  return {
    pos,
    explicit,
    state: { doc: { toString: () => doc, sliceString: (f: number, t: number) => doc.slice(f, t) } },
    matchBefore: (expr: RegExp) => {
      const before = doc.slice(0, pos);
      const m = new RegExp(expr.source + "$").exec(before);
      return m ? { from: pos - m[0].length, to: pos, text: m[0] } : null;
    },
  } as unknown as Parameters<
    NonNullable<typeof import("../renderer/components/editor/cm6-kernel").documentWordCompletion>
  >[0];
}

test("frecency store: bump/boost/badge + typing-collection seam", () => {
  const h = H!;
  h.resetHabitForTests();
  h.bumpHabit("platforms");
  h.bumpHabit("platforms");
  h.bumpHabit("platforms");
  assert.equal(h.habitCount("platforms"), 3);
  assert.ok(h.habitBoost("platforms") > 0, "recent word boosts");
  assert.equal(h.habitBoost("transferAmount"), 0, "unknown word has no boost");
  // typing collection: separator at pos finishes the word before it
  const pos = DOC.indexOf("platforms") + "platforms".length;
  h.recordSeparatorCompletion((f, t) => DOC.slice(f, t), pos);
  assert.equal(h.habitCount("platforms"), 4);
  h.resetHabitForTests();
});

test("fallback source: habit words rank first and carry ★N + apply records", () => {
  const h = H!;
  h.resetHabitForTests();
  h.bumpHabit("platforms");
  h.bumpHabit("platforms");
  // pos after typing "pl" → candidates: platforms (+ others containing p/l)
  const pos = DOC.indexOf("platforms") + 2;
  const result = K!.documentWordCompletion(contextFor(pos));
  assert.ok(result, "source fires");
  const labels = result!.options.map((o) => o.label);
  assert.ok(labels.includes("platforms"));
  const first = labels.indexOf("platforms");
  assert.equal(first, 0, "habit word ranks first");
  const platform = result!.options[first] as { detail?: string; boost?: number; apply?: unknown };
  assert.equal(platform.detail, "★2");
  assert.ok((platform.boost ?? 0) > 0);
  assert.equal(typeof platform.apply, "function", "apply hook present for habit recording");
  h.resetHabitForTests();
});
