// Apply/excise data-loss regressions (2026-09-06 review batch, "全部逐级修复"):
// every case here lost or corrupted USER lines before its root fix. All
// assertions are FULL-DOCUMENT equals — the round-4 suite's `includes(...)`
// style is exactly what let these slip through.

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";

let dom: DomHandle | undefined;
let stub: ApiStub | undefined;
const apiOverrides: Record<string, unknown> = {};
// Renderer-minted runId of the most recent editorAgentRun call — progress
// events are runId-scoped, so emits must target the run under test.
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
  lastRunId = "";
});

const CODE = (code: string): string => `Here:\n\`\`\`ts\n${code}\n\`\`\`\ndone`;
const FENCE = (rows: string): string => `lead\n\`\`\`ts\n${rows}\n`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function mount(doc: string): {
  handle: import("../renderer/components/editor/cm6-kernel").Cm6KernelHandle;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const handle = K!.mountEditorView(host, {
    file: "a.ts",
    doc,
    appearance: "dark",
    onDocChanged: () => {},
  });
  return { handle };
}

function makeStream(handle: import("../renderer/components/editor/cm6-kernel").Cm6KernelHandle): {
  stream: InstanceType<S["BufferStream"]>;
  checkpoints: Array<{ content: string; file: string }>;
} {
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
    () => {},
    () => "a.ts"
  );
  return { stream, checkpoints };
}

test("apply off-by-one: the user line AFTER the block survives (full doc)", async () => {
  apiOverrides.editorAgentRun = stubRun(async () => ({ ok: true, content: CODE("NEW"), iterations: 1 }));
  const { handle } = mount("l1\nl2\nl3\nAFTER1\nAFTER2");
  const { stream, checkpoints } = makeStream(handle);
  await stream.run({
    file: "a.ts",
    selection: { text: "l2", startLine: 2, endLine: 2 },
    instruction: "go",
  });
  assert.equal(stream.currentPhase, "review");
  stream.apply();
  assert.equal(stream.currentPhase, "applied");
  assert.equal(
    handle.view.state.doc.toString(),
    "l1\nNEW\nl3\nAFTER1\nAFTER2",
    "apply replaces exactly [orig ghost + AI rows] — the block's next line (l3) must survive"
  );
  assert.equal(checkpoints.at(-1)?.content, "l1\nNEW\nl3\nAFTER1\nAFTER2", "checkpoint rides the same content");
});

test("apply resolves the LIVE block: user edits above the block during review (full doc)", async () => {
  apiOverrides.editorAgentRun = stubRun(async () => ({ ok: true, content: CODE("NEW"), iterations: 1 }));
  const { handle } = mount("l1\nl2\nl3\nl4");
  const { stream } = makeStream(handle);
  await stream.run({
    file: "a.ts",
    selection: { text: "l3", startLine: 3, endLine: 3 },
    instruction: "go",
  });
  assert.equal(stream.currentPhase, "review");
  // The canvas is unlocked in review — the user edits ABOVE the block.
  handle.view.dispatch({ changes: { from: 0, insert: "USER\n" } });
  stream.apply();
  assert.equal(
    handle.view.state.doc.toString(),
    "USER\nl1\nl2\nNEW\nl4",
    "apply splices the LIVE decoration-anchored block, not the run's stale selStartLine snapshot"
  );
});

test("iteration clears the streamed-row multiset: error after round 2 never eats user lines below (full doc)", async () => {
  apiOverrides.editorAgentRun = stubRun(() => new Promise(() => {}));
  const { handle } = mount("sel\n}\nconst keep = 1;\n}");
  const { stream } = makeStream(handle);
  void stream.run({
    file: "a.ts",
    selection: { text: "sel", startLine: 1, endLine: 1 },
    instruction: "go",
  });
  await sleep(10);
  // Round 1 streams a "}" — identical to the USER "}" two lines below.
  stub!.emit("onEditorAgentProgress", { runId: lastRunId, phase: "delta", text: FENCE("}") });
  await sleep(120);
  assert.ok(handle.view.state.doc.toString().includes("}\n}"), "round-1 row landed");
  // A new agent round begins: round-1 rows are excised, the multiset MUST reset.
  stub!.emit("onEditorAgentProgress", { runId: lastRunId, phase: "iteration", message: "round 2" });
  stub!.emit("onEditorAgentProgress", { runId: lastRunId, phase: "delta", text: FENCE("NEWROW") });
  await sleep(120);
  stub!.emit("onEditorAgentProgress", { runId: lastRunId, phase: "error", error: "boom" });
  assert.equal(stream.currentPhase, "idle");
  assert.equal(
    handle.view.state.doc.toString(),
    "sel\n}\nconst keep = 1;\n}",
    "error excises THIS round's rows only — the user's own } below the block survives"
  );
});

test("B5: no phantom blank line when the doc already ends with a newline (full doc)", async () => {
  apiOverrides.editorAgentRun = stubRun(async () => ({ ok: true, content: CODE("NEW"), iterations: 1 }));
  const { handle } = mount("l1\nl2\n");
  const { stream } = makeStream(handle);
  // Selection reaches EOF through the trailing empty line (line 3).
  await stream.run({
    file: "a.ts",
    selection: { text: "l2\n", startLine: 2, endLine: 3 },
    instruction: "go",
  });
  assert.equal(stream.currentPhase, "review");
  assert.equal(
    handle.view.state.doc.toString(),
    "l1\nl2\nNEW\n",
    "no double blank between the ghost block and the AI row (old behavior: l1\\nl2\\n\\nNEW\\n)"
  );
  stream.apply();
  assert.equal(stream.currentPhase, "applied");
  assert.equal(
    handle.view.state.doc.toString(),
    "l1\nNEW\n",
    "apply recognizes the block whose first AI row sits INSIDE the trailing ghost line"
  );
});

test("B5 counterpart: an at-EOF selection on a newline-less doc still gets its separator (full doc)", async () => {
  apiOverrides.editorAgentRun = stubRun(async () => ({ ok: true, content: CODE("NEW"), iterations: 1 }));
  const { handle } = mount("l1\nl2");
  const { stream } = makeStream(handle);
  await stream.run({
    file: "a.ts",
    selection: { text: "l2", startLine: 2, endLine: 2 },
    instruction: "go",
  });
  assert.equal(stream.currentPhase, "review");
  assert.equal(handle.view.state.doc.toString(), "l1\nl2\nNEW\n", "separator exactly once");
  stream.apply();
  assert.equal(handle.view.state.doc.toString(), "l1\nNEW\n");
});

test("runId isolation: a FOREIGN run's deltas never enter this run's fence buffer", async () => {
  apiOverrides.editorAgentRun = stubRun(() => new Promise(() => {}));
  const { handle } = mount("l1\nl2\nl3");
  const { stream } = makeStream(handle);
  void stream.run({
    file: "a.ts",
    selection: { text: "l2", startLine: 2, endLine: 2 },
    instruction: "go",
  });
  await sleep(10);
  // A concurrent explain run's prose hits the shared broadcast channel.
  stub!.emit("onEditorAgentProgress", { runId: "someone-elses-explain-run", phase: "delta", text: FENCE("EXPLAIN") });
  await sleep(120);
  assert.equal(
    handle.view.state.doc.toString(),
    "l1\nl2\nl3",
    "foreign-run delta is dropped — the pair buffer stays untouched"
  );
  // The run's own delta still lands.
  stub!.emit("onEditorAgentProgress", { runId: lastRunId, phase: "delta", text: FENCE("PAIRROW") });
  await sleep(120);
  assert.ok(handle.view.state.doc.toString().includes("PAIRROW"), "own-run delta lands");
  stream.discard();
  assert.equal(handle.view.state.doc.toString(), "l1\nl2\nl3", "discard restores the original");
});

test("fence grammar agrees between the streaming extractor and splitResult", () => {
  const S2 = S!;
  // A mid-line ``` must NOT close the fence in either implementation.
  const reply = "```ts\nconst a = 1```\n说明\n```";
  const streamed = S2.extractFirstFence(reply.replace(/^```ts\n/, "lead\n```ts\n"));
  const final = S2.splitResult(reply);
  assert.ok(final.code !== null && final.code.includes("说明"), "splitResult keeps the fence open past a mid-line ```");
  assert.equal(streamed?.closed ?? true, true, "extractFirstFence also closes only at a line-start ```");
  // The row COUNT both sides derive must agree (the excise multiset depends on it).
  const finalRows = (final.code ?? "").split("\n");
  assert.equal(streamed?.rows.length, finalRows.length, "streamed rows === final rows for the same fence");
});
