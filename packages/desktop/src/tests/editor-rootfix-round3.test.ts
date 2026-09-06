// Round-3 root-fix regressions (re-audit 驱动): encode the regression
// behaviors found by the post-fix re-audit. Each test failed on the
// pre-round-3 tree by construction (the defects were confirmed by direct
// code reading) and must stay green now.

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";

let dom: DomHandle | undefined;
let stub: ApiStub | undefined;
const apiOverrides: Record<string, unknown> = {};

type K = typeof import("../renderer/components/editor/cm6-kernel");
type KernelHandle = import("../renderer/components/editor/cm6-kernel").Cm6KernelHandle;
let K: K | undefined;
type S = typeof import("../renderer/components/editor/cm6-buffer-stream");
let S: S | undefined;
type L = typeof import("../renderer/components/editor/cm6-lsp");
let L: L | undefined;
type Lane = typeof import("../renderer/hooks/use-pair-lane");
let Lane: Lane | undefined;

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  stub = createApiStub(apiOverrides);
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  K = await import("../renderer/components/editor/cm6-kernel");
  S = await import("../renderer/components/editor/cm6-buffer-stream");
  L = await import("../renderer/components/editor/cm6-lsp");
  Lane = await import("../renderer/hooks/use-pair-lane");
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom?.cleanup();
});

afterEach(() => {
  document.querySelectorAll(".ui-editor-cm6-host").forEach((n) => n.remove());
  for (const key of Object.keys(apiOverrides)) delete apiOverrides[key];
});

const DOC = "line1\nline2\nline3\nline4\nline5";
const CODE = (code: string): string => `Here:\n\`\`\`ts\n${code}\n\`\`\`\ndone`;

function mount(doc = DOC): { handle: KernelHandle; host: HTMLDivElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const handle = K!.mountEditorView(host, {
    file: "a.ts",
    doc,
    appearance: "dark",
    onDocChanged: () => {},
  });
  return { handle, host };
}

/* Re-audit #2/#3: a doc swap mid-stream must settle the phase AND the flush
 * timer must never spin — the completion path returns to idle. */
test("R3-1: doc swap mid-stream settles idle (no wedged streaming phase)", async () => {
  let release: (v: unknown) => void = () => {};
  const gate = new Promise((res) => {
    release = res;
  });
  apiOverrides.editorAgentRun = async () => {
    await gate;
    return { ok: true, content: CODE("alien"), iterations: 1 };
  };
  const { handle, host } = mount();
  const stream = new S!.BufferStream(
    () => handle.view,
    { onPhase: () => {}, onStage: () => {}, onCheckpoint: () => {}, onStats: () => {}, onHunks: () => {} },
    () => handle.docGeneration,
    (flag) => handle.setReadOnly(flag)
  );
  try {
    const running = stream.run({
      file: "a.ts",
      selection: { text: "line2", startLine: 2, endLine: 2 },
      instruction: "go",
    });
    handle.setDoc("b.ts", "OTHER");
    release(null);
    await running;
    assert.equal(stream.currentPhase, "idle", "phase settled after mid-stream doc swap");
    // The run must remain reusable (the old tree wedged forever).
    apiOverrides.editorAgentRun = async () => ({ ok: true, content: CODE("x"), iterations: 1 });
    await stream.run({ file: "b.ts", selection: { text: "OTHER", startLine: 1, endLine: 1 }, instruction: "again" });
    assert.equal(stream.currentPhase, "review", "stream reusable after swap abort");
  } finally {
    stream.dispose();
    handle.destroy();
    host.remove();
  }
});

/* Re-audit #23: user rows typed between AI rows during review survive discard. */
test("R3-2: discard spares user rows interleaved into the AI block", async () => {
  apiOverrides.editorAgentRun = async () => ({ ok: true, content: CODE("newA\nnewB"), iterations: 1 });
  const { handle, host } = mount();
  const stream = new S!.BufferStream(
    () => handle.view,
    { onPhase: () => {}, onStage: () => {}, onCheckpoint: () => {}, onStats: () => {}, onHunks: () => {} },
    () => handle.docGeneration,
    (flag) => handle.setReadOnly(flag)
  );
  try {
    await stream.run({
      file: "a.ts",
      selection: { text: "line2\nline3", startLine: 2, endLine: 3 },
      instruction: "go",
    });
    assert.equal(stream.currentPhase, "review");
    // Insert a user row BETWEEN the two AI rows (doc is unlocked in review).
    const view = handle.view;
    let newB: { from: number; text: string } | null = null;
    for (let i = 1; i <= view.state.doc.lines; i += 1) {
      const l = view.state.doc.line(i);
      if (l.text === "newB") newB = { from: l.from, text: l.text };
    }
    assert.ok(newB, "AI rows present");
    view.dispatch({ changes: { from: newB.from, insert: "userMid\n" } });
    stream.discard();
    const out = view.state.doc.toString();
    assert.ok(out.includes("userMid"), "interleaved user row survives discard");
    assert.ok(!out.includes("newA") && !out.includes("newB"), "AI rows excised");
  } finally {
    stream.dispose();
    handle.destroy();
    host.remove();
  }
});

/* Re-audit #20: rolling back from review settles the phase. */
test("R3-3: rollbackTo from review settles idle", async () => {
  apiOverrides.editorAgentRun = async () => ({ ok: true, content: CODE("r1\nr2"), iterations: 1 });
  const { handle, host } = mount();
  const cps: Array<{ atIso: string; content: string; file: string }> = [];
  const stream = new S!.BufferStream(
    () => handle.view,
    {
      onPhase: () => {},
      onStage: () => {},
      onCheckpoint: (a, c, f) => cps.push({ atIso: a, content: c, file: f }),
      onStats: () => {},
      onHunks: () => {},
    },
    () => handle.docGeneration,
    (flag) => handle.setReadOnly(flag)
  );
  try {
    await stream.run({ file: "a.ts", selection: { text: "line2", startLine: 2, endLine: 2 }, instruction: "go" });
    stream.apply();
    assert.equal(cps.length, 1);
    assert.equal(cps[0]!.file, "a.ts", "checkpoint carries its file (re-audit #4)");
    stream.rollbackTo(cps[0]!.content);
    assert.equal(stream.currentPhase, "idle", "rollback settles review phase");
  } finally {
    stream.dispose();
    handle.destroy();
    host.remove();
  }
});

/* Re-audit #14: URI encoding covers kana/hangul/accents/%/spaces; UNC absolute. */
test("R3-4: buildFileUri encodes all non-ASCII + % + spaces; UNC is absolute", () => {
  const build = L!.buildFileUri;
  // kana + hangul + accent
  const uri = build("/r", "src/ファイル_한글.txt");
  assert.ok(!/[^\x20-\x7E]/.test(uri), "URI is pure ASCII after encoding");
  assert.equal(build("/r", "a%b.ts"), "file:///r/a%25b.ts", "literal % escaped");
  assert.equal(build("/r", "a b.ts"), "file:///r/a%20b.ts");
  assert.equal(build("/r", "c#t?.ts"), "file:///r/c%23t%3F.ts");
  // UNC stays absolute (not glued onto root)
  assert.equal(build("/r", "\\\\srv\\share\\m.ts"), "file://srv/share/m.ts");
});

/* Re-audit #26: lane clears the stale error when settling without detail. */
test("R3-5: lane clears stale error on detail-less idle settle", async () => {
  assert.ok(Lane);
  const { renderHook, act } = await import("@testing-library/react");
  const { usePairLane } = Lane;
  const rendered = renderHook(() => usePairLane());
  const { result } = rendered;
  await act(async () => {
    result.current.events.onPhase("idle", { error: "boom" });
  });
  assert.equal(result.current.state.error, "boom");
  await act(async () => {
    result.current.events.onPhase("idle"); // apply/discard settle — no detail
  });
  assert.equal(result.current.state.error, null, "stale error cleared on detail-less idle");
  rendered.unmount();
});
