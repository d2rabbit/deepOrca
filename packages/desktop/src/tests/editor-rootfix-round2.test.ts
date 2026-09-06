// Round-2 root-fix regressions (specs/editor-copilot 全部修复 batch):
// rollback (D10), fence hardening (B8), editor-runs store (链路 D),
// palette commands/preview (D13/D14), lane checkpoints content (D8).

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";

let dom: DomHandle | undefined;
let stub: ApiStub | undefined;
const apiOverrides: Record<string, unknown> = {};

type K = typeof import("../renderer/components/editor/cm6-kernel");
let K: K | undefined;
type S = typeof import("../renderer/components/editor/cm6-buffer-stream");
let S: S | undefined;
type Store = typeof import("../main/tools/editor-runs-store");
let Store: Store | undefined;

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  stub = createApiStub(apiOverrides);
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  K = await import("../renderer/components/editor/cm6-kernel");
  S = await import("../renderer/components/editor/cm6-buffer-stream");
  Store = await import("../main/tools/editor-runs-store");
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

type KernelHandle = import("../renderer/components/editor/cm6-kernel").Cm6KernelHandle;

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

test("D10: apply captures a snapshot; rollbackTo restores it exactly", async () => {
  apiOverrides.editorAgentRun = async () => ({ ok: true, content: CODE("newA\nnewB"), iterations: 1 });
  const { handle, host } = mount();
  const checkpoints: Array<{ atIso: string; content: string }> = [];
  const stream = new S!.BufferStream(
    () => handle.view,
    {
      onPhase: () => {},
      onStage: () => {},
      onCheckpoint: (atIso, content) => checkpoints.push({ atIso, content }),
      onStats: () => {},
      onHunks: () => {},
    },
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
    stream.apply();
    assert.equal(checkpoints.length, 1, "checkpoint recorded on apply");
    assert.ok(checkpoints[0]!.content.includes("newA"), "snapshot carries post-apply content");
    // User edits further after the apply.
    handle.view.dispatch({ changes: { from: 0, insert: "ZZ" } });
    // Rollback to the checkpoint restores exactly the post-apply state.
    stream.rollbackTo(checkpoints[0]!.content);
    assert.equal(handle.view.state.doc.toString(), checkpoints[0]!.content, "D10 exact restore");
    assert.ok(handle.view.state.doc.toString().includes("newA"));
    assert.ok(!handle.view.state.doc.toString().includes("ZZ"));
  } finally {
    stream.dispose();
    handle.destroy();
    host.remove();
  }
});

test("B8: CRLF fences stream; unclosed a2ui does not swallow the code fence", async () => {
  const ex = S!.extractFirstFence;
  // CRLF open fence
  assert.deepEqual(ex("```ts\r\nconst a = 1;\r\n```"), { rows: ["const a = 1;"], closed: true });
  // Unclosed a2ui block followed by the code fence — the code fence survives.
  const out = ex('```a2ui\n{"q":1\n```ts\nrow1\n```');
  assert.ok(out, "code fence found after an unclosed-then-closed a2ui");
  assert.ok(out!.rows.includes("row1"), `rows: ${JSON.stringify(out!.rows)}`);
  // Empty fence body yields no rows (no stray empty pending line).
  assert.deepEqual(ex("```ts\n```"), { rows: [], closed: true });
});

test("链路 D: editor-runs store round-trips records newest-first", () => {
  const root = mkdtempSync(join(tmpdir(), "edruns-"));
  try {
    mkdirSync(join(root, ".deeporca"), { recursive: true });
    const storePath = join(root, ".deeporca", "editor-runs.jsonl");
    writeFileSync(
      storePath,
      [
        JSON.stringify({
          runId: "r1",
          file: "a.ts",
          instruction: "first",
          status: "done",
          startedAt: "2026-09-05T01:00:00Z",
        }),
        JSON.stringify({
          runId: "r2",
          file: "b.ts",
          instruction: "second",
          status: "error",
          startedAt: "2026-09-05T02:00:00Z",
        }),
        "{corrupt line",
      ].join("\n") + "\n",
      "utf8"
    );
    const runs = Store!.listEditorRuns(root);
    assert.equal(runs.length, 2, "corrupt line skipped");
    assert.equal(runs[0]!.runId, "r2", "newest first");
    Store!.appendEditorRun(root, {
      runId: "r3",
      file: "c.ts",
      instruction: "third",
      status: "done",
      startedAt: "2026-09-05T03:00:00Z",
    });
    const runs2 = Store!.listEditorRuns(root);
    assert.equal(runs2.length, 3);
    assert.equal(runs2[0]!.runId, "r3");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("E5: historyFlags snapshot stays render-safe (no mid-render kernel read)", async () => {
  const { handle, host } = mount();
  try {
    const before = handle.historyFlags;
    assert.equal(before.canUndo, false, "fresh doc has nothing to undo");
    handle.view.dispatch({ changes: { from: 0, to: 0, insert: "x" } });
    const after = handle.historyFlags;
    assert.equal(after.canUndo, true, "flag snapshot updates after transactions");
  } finally {
    handle.destroy();
    host.remove();
  }
});

test("D7: onDiagnosticsChanged fires with counts (kernel callback contract)", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let summary: { errors: number; warnings: number; firstLine: number | null } | null = null;
  const handle = K!.mountEditorView(host, {
    file: "a.ts",
    doc: "hello",
    appearance: "dark",
    onDocChanged: () => {},
    onDiagnosticsChanged: (s) => {
      summary = s;
    },
  });
  try {
    // Push diagnostics via the lint extension's setDiagnostics effect —
    // exactly how the LSP client's serverDiagnostics lands in state.
    const { setDiagnostics } = await import("@codemirror/lint");
    handle.view.dispatch(
      setDiagnostics(handle.view.state, [
        { from: 0, to: 2, severity: "error", message: "boom", source: "test" },
        { from: 3, to: 4, severity: "warning", message: "meh", source: "test" },
      ]) as never
    );
    // The kernel debounces 400ms.
    await new Promise((r) => setTimeout(r, 550));
    assert.ok(summary, "callback fired");
    assert.equal((summary as { errors: number }).errors, 1);
    assert.equal((summary as { warnings: number }).warnings, 1);
    assert.equal((summary as { firstLine: number | null }).firstLine, 1);
  } finally {
    handle.destroy();
    host.remove();
  }
});
