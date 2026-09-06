// Root-cause fix regression suite (审计驱动, specs/editor-copilot).
// 对比性验收: these tests encode the AUDIT-confirmed defect behaviors; on
// the pre-fix tree they fail (RED baseline), on the fixed tree they pass.
// Covered: E1 (AI rows must not mark dirty), B1 (discard after line drift),
// B2 (doc swap mid-stream), B3 (phase never wedges), B5 (EOF selection),
// C-b (LSP URI building), readOnly compartment.

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";

let dom: DomHandle | undefined;
let stub: ApiStub | undefined;
/** Mutated per-test: overrides are read at call time by the stub proxy. */
const apiOverrides: Record<string, unknown> = {};

type KernelMod = typeof import("../renderer/components/editor/cm6-kernel");
let K: KernelMod | undefined;
type StreamMod = typeof import("../renderer/components/editor/cm6-buffer-stream");
let S: StreamMod | undefined;
type DecoMod = typeof import("../renderer/components/editor/cm6-deco");
let D: DecoMod | undefined;
type LspMod = typeof import("../renderer/components/editor/cm6-lsp");
let L: LspMod | undefined;

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  stub = createApiStub(apiOverrides);
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  K = await import("../renderer/components/editor/cm6-kernel");
  S = await import("../renderer/components/editor/cm6-buffer-stream");
  D = await import("../renderer/components/editor/cm6-deco");
  L = await import("../renderer/components/editor/cm6-lsp");
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom?.cleanup();
});

const DOC = "line1\nline2\nline3\nline4\nline5";
const CODE_REPLY = (code: string): string => `Here you go:\n\`\`\`ts\n${code}\n\`\`\`\ndone`;

function mount(doc = DOC): {
  handle: import("../renderer/components/editor/cm6-kernel").Cm6KernelHandle;
  host: HTMLDivElement;
  changes: string[];
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const changes: string[] = [];
  const handle = K!.mountEditorView(host, {
    file: "a.ts",
    doc,
    appearance: "dark",
    onDocChanged: (c) => changes.push(c),
  });
  return { handle, host, changes };
}

function makeStream(handle: import("../renderer/components/editor/cm6-kernel").Cm6KernelHandle): {
  stream: import("../renderer/components/editor/cm6-buffer-stream").BufferStream;
  phases: Array<[string, unknown]>;
  checkpoints: string[];
} {
  const phases: Array<[string, unknown]> = [];
  const checkpoints: string[] = [];
  const stream = new S!.BufferStream(
    () => handle.view,
    {
      onPhase: (p, d) => phases.push([p, d]),
      onStage: () => {},
      onCheckpoint: (iso) => checkpoints.push(iso),
      onStats: () => {},
      onHunks: () => {},
    },
    () => handle.docGeneration,
    (flag) => handle.setReadOnly(flag)
  );
  return { stream, phases, checkpoints };
}

afterEach(() => {
  document.querySelectorAll(".ui-editor-cm6-host").forEach((n) => n.remove());
  for (const key of Object.keys(apiOverrides)) delete apiOverrides[key];
});

/* ── E1: AI-tagged transactions must NOT fire onDocChanged (draft stays clean
   until apply) ─────────────────────────────────────────────────────────── */

test("E1: aiTransaction-tagged dispatch bypasses onDocChanged; plain edits do not", async () => {
  assert.ok(K, "kernel module");
  const aiAnn = K!.aiTransaction;
  assert.ok(aiAnn, "kernel must export aiTransaction annotation (fix artifact)");
  const { handle, host, changes } = mount();
  try {
    // Plain edit → onDocChanged fires.
    handle.view.dispatch({ changes: { from: 0, to: 0, insert: "x" } });
    assert.equal(changes.length, 1, "plain edit notifies draft");
    const before = handle.view.state.doc.toString();
    // AI-tagged edit → no notification.
    handle.view.dispatch({
      changes: { from: 0, to: 0, insert: "AI" },
      annotations: [aiAnn.of(true)],
    });
    assert.equal(changes.length, 1, "AI-tagged dispatch must NOT notify draft (E1)");
    assert.notEqual(handle.view.state.doc.toString(), before);
  } finally {
    handle.destroy();
    host.remove();
  }
});

/* ── B1: discard after user edits shifted line numbers must remove the AI
   block (decoration-mapped), never the user's rows ─────────────────────── */

test("B1: discard after line drift excises the AI block, keeps user rows", async () => {
  apiOverrides.editorAgentRun = async () => ({
    ok: true,
    content: CODE_REPLY("newA\nnewB\nnewC"),
    iterations: 1,
  });
  const { handle, host } = mount();
  const { stream, phases } = makeStream(handle);
  try {
    await stream.run({
      file: "a.ts",
      selection: { text: "line2\nline3", startLine: 2, endLine: 3 },
      instruction: "go",
    });
    assert.equal(phases.at(-1)?.[0], "review", "run settles into review");
    // User inserts a row ABOVE the AI block during review (line drift).
    const driftPos = handle.view.state.doc.line(1).to + 1;
    handle.view.dispatch({ changes: { from: driftPos, insert: "userX\n" } });
    // Discard: must remove newA/newB/newC, keep userX and all original lines.
    stream.discard();
    const out = handle.view.state.doc.toString();
    assert.ok(out.includes("userX"), "user row survives discard");
    assert.ok(!out.includes("newA") && !out.includes("newC"), "AI rows excised");
    assert.ok(out.includes("line2") && out.includes("line5"), "original rows intact");
  } finally {
    stream.dispose();
    handle.destroy();
    host.remove();
  }
});

/* ── B2: doc swap mid-stream must never write AI rows into the new doc ── */

test("B2: tab switch mid-stream leaves the new document untouched and resets phase", async () => {
  let release: (v: unknown) => void = () => {};
  const gate = new Promise((res) => {
    release = res;
  });
  apiOverrides.editorAgentRun = async () => {
    await gate;
    return { ok: true, content: CODE_REPLY("alienRow"), iterations: 1 };
  };
  const { handle, host } = mount();
  const { stream, phases } = makeStream(handle);
  try {
    const running = stream.run({
      file: "a.ts",
      selection: { text: "line2", startLine: 2, endLine: 2 },
      instruction: "go",
    });
    // Simulate the workspace swapping to another file while the run is in flight.
    handle.setDoc("b.ts", "OTHER-DOC");
    release(null);
    await running;
    assert.equal(handle.view.state.doc.toString(), "OTHER-DOC", "new doc must stay clean (B2)");
    assert.equal(stream.currentPhase, "idle", "phase must reset after doc swap (B2)");
  } finally {
    stream.dispose();
    handle.destroy();
    host.remove();
  }
});

/* ── B3: a throwing preamble must wedge nothing — stream stays reusable ── */

test("B3: out-of-range selection errors to idle and the stream stays reusable", async () => {
  apiOverrides.editorAgentRun = async () => ({
    ok: true,
    content: CODE_REPLY("ok"),
    iterations: 1,
  });
  const { handle, host } = mount();
  const { stream, phases } = makeStream(handle);
  try {
    // Stale selection pointing past the doc: doc.line() throws in the preamble.
    await stream.run({ file: "a.ts", selection: { text: "ghost", startLine: 99, endLine: 100 }, instruction: "go" });
    assert.equal(stream.currentPhase, "idle", "phase must return to idle after a throwing run (B3)");
    const surfaced = phases.some(
      ([p, d]) => p === "idle" && d != null && typeof d === "object" && "error" in (d as object)
    );
    assert.ok(surfaced, "error surfaced");
    // Reusability: a valid run right after the failure must work.
    await stream.run({ file: "a.ts", selection: { text: "line2", startLine: 2, endLine: 2 }, instruction: "go" });
    assert.equal(stream.currentPhase, "review", "stream reusable after failure (B3)");
  } finally {
    stream.dispose();
    handle.destroy();
    host.remove();
  }
});

/* ── B5: selection touching EOF must not throw / must land on its own rows ── */

test("B5: selection through the last line streams onto its own rows", async () => {
  apiOverrides.editorAgentRun = async () => ({
    ok: true,
    content: CODE_REPLY("tailA\ntailB"),
    iterations: 1,
  });
  const { handle, host } = mount();
  const { stream } = makeStream(handle);
  try {
    await stream.run({ file: "a.ts", selection: { text: "line5", startLine: 5, endLine: 5 }, instruction: "go" });
    assert.equal(stream.currentPhase, "review", "EOF selection settles into review (B5)");
    const out = handle.view.state.doc.toString();
    assert.ok(out.includes("tailA") && out.includes("tailB"), "AI rows present");
    assert.ok(/line5\ntailA/.test(out), "first AI row starts on its own line after EOF ghost (B5)");
  } finally {
    stream.dispose();
    handle.destroy();
    host.remove();
  }
});

/* ── C-b: LSP file URI building — absolutize + encode ──────────────────── */

test("C-b: buildFileUri absolutizes relative paths and encodes unsafe chars", () => {
  const build = (L as unknown as { buildFileUri?: (root: string, file: string) => string }).buildFileUri;
  assert.ok(build, "cm6-lsp must export buildFileUri (fix artifact)");
  const root = "/Volumes/x/我的 project";
  // Relative path against root
  assert.equal(build(root, "src/a b.ts"), "file:///Volumes/x/%E6%88%91%E7%9A%84%20project/src/a%20b.ts");
  // Already absolute passes through encoded
  assert.equal(build("/r", "/r/c#tag.ts"), "file:///r/c%23tag.ts");
  // Windows-style backslashes normalized
  assert.equal(build("C:\\ws", "src\\m.ts"), "file:///C:/ws/src/m.ts");
});

/* ── readOnly compartment during streaming ─────────────────────────────── */

test("kernel: setReadOnly toggles the compartment flag (B6 gate)", async () => {
  assert.ok(K, "kernel module");
  const { handle, host } = mount();
  try {
    handle.setReadOnly(true);
    assert.equal(handle.view.state.readOnly, true, "readOnly on (DOM input blocked by CM6)");
    // Programmatic AI writes remain allowed by design (the stream writes
    // through dispatch); the readOnly facet gates user-side editing only.
    handle.view.dispatch({ changes: { from: 0, insert: "ai" } });
    assert.ok(handle.view.state.doc.toString().startsWith("ai"), "programmatic write passes the gate");
    handle.setReadOnly(false);
    assert.equal(handle.view.state.readOnly, false, "readOnly off");
  } finally {
    handle.destroy();
    host.remove();
  }
});

/* ── doc generation: setDoc bumps it (B2 guard's clock) ────────────────── */

test("kernel: docGeneration increments on setDoc", () => {
  const { handle, host } = mount();
  try {
    const g = (handle as unknown as { docGeneration: number }).docGeneration;
    assert.ok(typeof g === "number", "docGeneration exposed (fix artifact)");
    handle.setDoc("b.ts", "x");
    assert.ok(handle.docGeneration > 0, "generation bumped after setDoc");
  } finally {
    handle.destroy();
    host.remove();
  }
});
