// Round-4 root-fix regressions (2026-09-06 audit batch):
// C2 runSeq token (stale run continuation), C3 streamed-row excise
// (error/clarify/no-code/discard during streaming), C4 apply/rollback
// file guards, M3 rollback releases the canvas lock, M4 iteration resets
// the preview, H2 CRLF fences, M8 c++/c# fence language tags.

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";

let dom: DomHandle | undefined;
let stub: ApiStub | undefined;
const apiOverrides: Record<string, unknown> = {};
// Renderer-minted runId of the most recent editorAgentRun call — progress
// events are runId-scoped (root fix: explain + pair share the broadcast),
// so emits must target the run under test via this capture.
let lastRunId = "";
const stubRun =
  (fn: (input?: { runId?: string }) => unknown) =>
  (input?: { runId?: string }): unknown => {
    lastRunId = typeof input?.runId === "string" ? input.runId : "";
    return fn(input);
  };

type K = typeof import("../renderer/components/editor/cm6-kernel");
let K: K | undefined;
type S = typeof import("../renderer/components/editor/cm6-buffer-stream");
let S: S | undefined;

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  stub = createApiStub(apiOverrides);
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  K = await import("../renderer/components/editor/cm6-kernel");
  S = await import("../renderer/components/editor/cm6-buffer-stream");
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
const FENCE = (rows: string): string => `lead\n\`\`\`ts\n${rows}\n`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function mount(doc = DOC): {
  handle: import("../renderer/components/editor/cm6-kernel").Cm6KernelHandle;
  host: HTMLDivElement;
} {
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

function makeStream(
  handle: import("../renderer/components/editor/cm6-kernel").Cm6KernelHandle,
  currentFile: () => string | null = () => null
): {
  stream: InstanceType<S["BufferStream"]>;
  locked: (boolean | null)[];
  checkpoints: Array<{ content: string; file: string }>;
} {
  const locks: (boolean | null)[] = [];
  const checkpoints: Array<{ content: string; file: string }> = [];
  const stream = new S!.BufferStream(
    () => handle.view,
    {
      onPhase: () => {},
      onStage: () => {},
      onCheckpoint: (_a, content, file) => checkpoints.push({ content, file }),
      onStats: () => {},
      onHunks: () => {},
    },
    () => handle.docGeneration,
    (flag) => {
      locks.push(flag);
      handle.setReadOnly(flag);
    },
    currentFile
  );
  return { stream, locked: locks, checkpoints };
}

test("C2: a discarded run's late resolve writes nothing and cannot steal the lock", async () => {
  let resolveRun!: (v: unknown) => void;
  const gate = new Promise<unknown>((r) => {
    resolveRun = r;
  });
  apiOverrides.editorAgentRun = stubRun(() => gate);
  const { handle, host } = mount();
  const { stream, locked } = makeStream(handle);
  const runA = stream.run({
    file: "a.ts",
    selection: { text: "line2", startLine: 2, endLine: 2 },
    instruction: "go",
  });
  await sleep(10);
  stub!.emit("onEditorAgentProgress", { runId: lastRunId, phase: "delta", text: FENCE("rowA") });
  await sleep(120); // flush cadence (STREAM_FLUSH_MS = 90)
  assert.ok(handle.view.state.doc.toString().includes("rowA"), "streamed row lands before discard");
  assert.equal(locked.at(-1), true, "streaming locks the canvas");

  stream.discard();
  assert.equal(stream.currentPhase, "idle");
  const afterDiscard = handle.view.state.doc.toString();
  assert.ok(!afterDiscard.includes("rowA"), "discard excises the streamed row (C3 excise from streamedRows)");
  assert.equal(locked.at(-1), false, "discard releases the lock");

  // The real race: run B starts (new lock, red stream) while run A's invoke
  // is still in flight — then A resolves. Without the run token, A's
  // continuation rides B's "streaming" phase and writes at A's stale offset.
  let resolveRunB!: (v: unknown) => void;
  const gateB = new Promise<unknown>((r) => {
    resolveRunB = r;
  });
  let nextIsB = false;
  apiOverrides.editorAgentRun = stubRun(() => {
    if (nextIsB) return gateB;
    return gate;
  });
  nextIsB = true;
  const runB = stream.run({
    file: "a.ts",
    selection: { text: "line4", startLine: 4, endLine: 4 },
    instruction: "go too",
  });
  await sleep(10);
  assert.equal(stream.currentPhase, "streaming", "run B is streaming");

  resolveRun({ ok: true, content: CODE("rowA\nrowB"), iterations: 1 });
  await runA;
  assert.equal(stream.currentPhase, "streaming", "stale run A must not settle/cancel run B");
  assert.equal(handle.view.state.doc.toString(), afterDiscard, "stale continuation writes nothing");

  // Let B finish its own run — the lock and phase belong to B.
  resolveRunB({ ok: true, content: CODE("rowC"), iterations: 1 });
  await runB;
  assert.equal(stream.currentPhase, "review", "run B completes review");
  const finalDoc = handle.view.state.doc.toString();
  assert.ok(finalDoc.includes("rowC"), "run B's rows land");
  assert.ok(!finalDoc.includes("rowA"), "run A's rows never land");
  stream.dispose();
  handle.destroy();
  host.remove();
});

test("C3: agent error mid-stream excises the streamed rows and settles idle", async () => {
  apiOverrides.editorAgentRun = stubRun(() => new Promise(() => {}));
  const { handle, host } = mount();
  const { stream } = makeStream(handle);
  void stream.run({
    file: "a.ts",
    selection: { text: "line2", startLine: 2, endLine: 2 },
    instruction: "go",
  });
  await sleep(10);
  stub!.emit("onEditorAgentProgress", { runId: lastRunId, phase: "delta", text: FENCE("rowA\nrowB") });
  await sleep(120);
  assert.ok(handle.view.state.doc.toString().includes("rowA"), "rows streamed");

  stub!.emit("onEditorAgentProgress", { runId: lastRunId, phase: "error", error: "boom" });
  await sleep(20);
  const out = handle.view.state.doc.toString();
  assert.ok(!out.includes("rowA") && !out.includes("rowB"), "error path excises streamed rows");
  assert.equal(stream.currentPhase, "idle");
  stream.dispose();
  handle.destroy();
  host.remove();
});

test("M4: iteration event excises the previous round's preview and restarts the stream", async () => {
  apiOverrides.editorAgentRun = stubRun(() => new Promise(() => {}));
  const { handle, host } = mount();
  const { stream } = makeStream(handle);
  void stream.run({
    file: "a.ts",
    selection: { text: "line2", startLine: 2, endLine: 2 },
    instruction: "go",
  });
  await sleep(10);
  stub!.emit("onEditorAgentProgress", { runId: lastRunId, phase: "delta", text: FENCE("rowA") });
  await sleep(120);
  assert.ok(handle.view.state.doc.toString().includes("rowA"), "round-1 preview rows land");

  stub!.emit("onEditorAgentProgress", { runId: lastRunId, phase: "iteration", message: "round 2" });
  await sleep(20);
  assert.ok(!handle.view.state.doc.toString().includes("rowA"), "iteration excises the previous round");

  stub!.emit("onEditorAgentProgress", { runId: lastRunId, phase: "delta", text: FENCE("rowC") });
  await sleep(120);
  const out = handle.view.state.doc.toString();
  assert.ok(out.includes("rowC"), "round-2 streams after the reset");
  assert.ok(!out.includes("rowA"), "round-1 rows never return");
  stream.dispose();
  handle.destroy();
  host.remove();
});

test("C4: apply refuses a stale block (run file ≠ shown file) and settles idle", async () => {
  apiOverrides.editorAgentRun = stubRun(async () => ({ ok: true, content: CODE("r1\nr2"), iterations: 1 }));
  const { handle, host } = mount();
  let shownFile = "a.ts";
  const { stream, checkpoints } = makeStream(handle, () => shownFile);
  await stream.run({
    file: "a.ts",
    selection: { text: "line2", startLine: 2, endLine: 2 },
    instruction: "go",
  });
  assert.equal(stream.currentPhase, "review");

  // Same-content tab switch keeps the kernel doc state (no setDoc) — only
  // the FILE identity check can catch this.
  shownFile = "b.ts";
  stream.apply();
  assert.equal(checkpoints.length, 0, "stale apply records no checkpoint");
  assert.equal(stream.currentPhase, "idle", "stale apply settles idle");
  assert.ok(!handle.view.state.doc.toString().includes("r1"), "stale block is excised, not left half-applied");
  stream.dispose();
  handle.destroy();
  host.remove();
});

test("M3: rollbackTo mid-stream releases the lock, settles idle and ignores late deltas", async () => {
  apiOverrides.editorAgentRun = stubRun(() => new Promise(() => {}));
  const { handle, host } = mount();
  const { stream, locked } = makeStream(handle);
  void stream.run({
    file: "a.ts",
    selection: { text: "line2", startLine: 2, endLine: 2 },
    instruction: "go",
  });
  await sleep(10);
  stub!.emit("onEditorAgentProgress", { runId: lastRunId, phase: "delta", text: FENCE("rowA") });
  await sleep(120);
  assert.equal(locked.at(-1), true, "streaming locks the canvas");

  stream.rollbackTo(DOC);
  assert.equal(stream.currentPhase, "idle", "rollback settles the phase");
  assert.equal(locked.at(-1), false, "rollback releases the canvas lock (M3)");
  const out = handle.view.state.doc.toString();
  assert.ok(!out.includes("rowA"), "rollback replaces the streamed rows");

  stub!.emit("onEditorAgentProgress", { runId: lastRunId, phase: "delta", text: FENCE("rowZ") });
  await sleep(120);
  assert.ok(!handle.view.state.doc.toString().includes("rowZ"), "late deltas after rollback do not write");
  stream.dispose();
  handle.destroy();
  host.remove();
});

test("H2: splitResult tolerates CRLF replies and c++/c# fence tags", () => {
  assert.equal(S!.splitResult("prose\n```ts\r\ncodeA\r\ncodeB\r\n```").code, "codeA\ncodeB");
  assert.equal(S!.splitResult("```c++\nint main(){}\n```").code, "int main(){}");
  assert.equal(S!.splitResult("```c#\nFoo();\n```").code, "Foo();");
  assert.equal(S!.splitResult("```ts\ncode()\n```").code, "code()", "plain LF stays intact");
});

test("H2: extractFirstFence normalizes CRLF rows to LF identity", () => {
  const f = S!.extractFirstFence("```ts\r\nrowA\r\nrowB\r\n```");
  assert.ok(f, "CRLF fence opens");
  assert.deepEqual(f!.rows, ["rowA", "rowB"], "rows drop the \\r");
  assert.equal(f!.closed, true);
});

test("多 hunk: apply splices per-hunk decisions and excises the original rows", async () => {
  apiOverrides.editorAgentRun = stubRun(async () => ({ ok: true, content: CODE("l1\nX\nl3\nl4"), iterations: 1 }));
  const { handle, host } = mount("l1\nl2\nl3\nend");
  const { stream } = makeStream(handle);
  await stream.run({
    file: "a.ts",
    selection: { text: "l1\nl2\nl3", startLine: 1, endLine: 3 },
    instruction: "go",
  });
  assert.equal(stream.currentPhase, "review");
  // reject l2→X, accept the pure addition l4
  stream.setHunkDecision(0, false);
  stream.apply();
  const out = handle.view.state.doc.toString();
  assert.ok(out.includes("l2"), "rejected hunk keeps the original line");
  assert.ok(out.includes("l4"), "accepted hunk contributes its new line");
  assert.ok(!out.includes("X"), "accepted hunk still replaces its original line");
  assert.ok(!out.includes("newA"), "accept excises the ghosted original rows (no duplication)");
  assert.equal(stream.currentPhase, "applied");
  stream.dispose();
  handle.destroy();
  host.remove();
});
