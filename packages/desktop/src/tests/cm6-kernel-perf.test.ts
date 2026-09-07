// CM6 kernel performance baseline (specs/editor-copilot A7).
// Headless benchmarks over the real kernel state pipeline: creating a
// 100k-line document state, streaming 1k single-line transactions with the
// AI decoration domain attached, and mapping the decoration set through
// them. Assertions use generous ceilings — they guard against order-of-
// magnitude regressions, not micro-benchmarks (jsdom timing is noisy).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { installDom, type DomHandle } from "./dom-harness";

let dom: DomHandle | undefined;
type KernelModule = typeof import("../renderer/components/editor/cm6-kernel");
type DecoModule = typeof import("../renderer/components/editor/cm6-deco");
type ViewModule = typeof import("@codemirror/view");

let kernel: KernelModule | undefined;
let deco: DecoModule | undefined;
let viewMod: ViewModule | undefined;

before(async () => {
  dom = installDom();
  (globalThis as unknown as { window: { deeporca: Record<string, unknown> } }).window.deeporca = {};
  kernel = await import("../renderer/components/editor/cm6-kernel");
  deco = await import("../renderer/components/editor/cm6-deco");
  viewMod = await import("@codemirror/view");
});

after(() => {
  dom?.cleanup();
});

function bigDoc(lines: number): string {
  const parts: string[] = [];
  for (let i = 0; i < lines; i += 1) {
    parts.push(
      `export function handler${i}(root: string, day: string): Summary { return { day, input: ${i}, output: ${i} * 2 }; }`
    );
  }
  return parts.join("\n");
}

test("cm6 baseline: 100k-line state creation stays under ceiling", () => {
  assert.ok(kernel);
  const t0 = performance.now();
  const state = kernel!.createEditorState({
    file: "big.ts",
    doc: bigDoc(100_000),
    appearance: "dark",
    onDocChanged: () => {},
  });
  const ms = performance.now() - t0;
  assert.equal(state.doc.lines, 100_000);
  // Ceiling ~10x observed headless timing — regression tripwire only.
  assert.ok(ms < 2500, `100k-line state creation took ${ms.toFixed(0)}ms (>2500ms ceiling)`);
});

test("cm6 baseline: 1k streaming transactions with decorations stay under ceiling", () => {
  assert.ok(kernel && deco && viewMod);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const handle = kernel.mountEditorView(host, {
    file: "stream.ts",
    doc: bigDoc(2_000),
    appearance: "dark",
    onDocChanged: () => {},
  });
  try {
    const view = handle.view;
    const insertAt = view.state.doc.line(1_000).to + 1;
    const t0 = performance.now();
    let pos = insertAt;
    for (let i = 0; i < 1_000; i += 1) {
      const line = `const streamed${i} = bucketize(${i});`;
      view.dispatch({
        changes: { from: pos, insert: `${line}\n` },
        effects: deco.addAi.of(deco.pendingLineRanges(pos)),
      });
      pos += line.length + 1;
    }
    const ms = performance.now() - t0;
    // Ceiling ~10x observed — each transaction also remaps the accumulated
    // decoration RangeSet; this pins the auto-mapping cost as streaming grows.
    assert.ok(ms < 8000, `1k streaming transactions took ${ms.toFixed(0)}ms (>8000ms ceiling)`);
    // Decorations survived and mapped: field is non-empty at the final pos.
    const field = view.state.field(deco.aiField, false);
    let count = 0;
    field?.between(0, view.state.doc.length, () => {
      count += 1;
    });
    assert.ok(count > 0, "AI decoration set should be non-empty after streaming");
  } finally {
    handle.destroy();
    host.remove();
  }
});
