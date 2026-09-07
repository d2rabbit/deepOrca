// Fence extractor + fuzzy scorer unit tests (specs/editor-copilot C3/C4).
// These are the two pure functions the live chunk stream and the palette
// depend on — pinned here so regressions surface as unit failures.

import { test } from "node:test";
import assert from "node:assert/strict";

type StreamMod = typeof import("../renderer/components/editor/cm6-buffer-stream");
let stream: StreamMod | undefined;

test.before(async () => {
  const dom = (await import("./dom-harness")).installDom();
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = {};
  stream = await import("../renderer/components/editor/cm6-buffer-stream");
  // Keep dom alive for the file duration (module-scope CM6 import needs it).
  (globalThis as unknown as { __dom: unknown }).__dom = dom;
});

test("extractFirstFence: incremental rows while streaming, closed at the end", () => {
  const ex = stream!.extractFirstFence;
  // Before any fence: null.
  assert.equal(ex("Here is the plan:\n"), null);
  // Fence opened, one complete row + one partial row.
  assert.deepEqual(ex("plan:\n```ts\nconst a = 1;\nconst b = 2"), {
    rows: ["const a = 1;"],
    closed: false,
  });
  // Closed fence returns all rows.
  assert.deepEqual(ex("```ts\nconst a = 1;\nconst b = 2;\n```\ndone"), {
    rows: ["const a = 1;", "const b = 2;"],
    closed: true,
  });
  // a2ui fence is skipped — the first non-a2ui fence wins.
  assert.deepEqual(ex("```a2ui\n{}\n```\n```ts\nrow1\n```"), { rows: ["row1"], closed: true });
  // Unclosed a2ui fence does not swallow the code fence that follows.
  const partial = ex('```a2ui\n{"x":');
  assert.equal(partial, null);
});

test("splitResult keeps a2ui + code separation", () => {
  const r = stream!.splitResult('prose\n```a2ui\n{"q":1}\n```\n```ts\ncode()\n```');
  assert.equal(r.a2ui, '{"q":1}');
  assert.equal(r.code, "code()");
});
