/**
 * Functional tests for BuildJobManager's stage state machine (R3-5): folding
 * "[n/3]" progress lines into per-stage states, console logs, failure
 * surfacing from stages[], settled events, idempotent start, and the auto
 * mode probe — via a stub action registry (no real build work).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BuildJobManager } from "../main/build-job-manager";
import type { ActionRegistry } from "@deeporca/core";
import type { KnowledgeBuildJobSnapshot } from "../shared/ipc";

type ProgressEvent = { message?: string; percent?: number };

type StubPlan = {
  /** Progress events emitted before resolving the action result. */
  events: ProgressEvent[];
  /** Result the action resolves with (index.build-all returns stages[]). */
  result?: { mode: string; stages: Array<{ stage: string; ok: boolean; skipped?: boolean; error?: string }> };
  /** Reject the action instead of resolving (registry-level throw). */
  reject?: Error;
};

type Emitted = { actionId: string; message?: string; percent?: number; data?: unknown };

function makeRegistry(plan: StubPlan): ActionRegistry {
  return {
    execute: () => {
      // Ref object: property access is not control-flow-narrowed after a
      // closure assignment (a plain `let` narrows back to null at the call).
      const cbRef: { current: ((e: ProgressEvent) => void) | null } = { current: null };
      const promise = (async () => {
        // Yield one microtask so execute()'s caller registers onProgress
        // before the (synchronous-body) plan starts emitting.
        await Promise.resolve();
        for (const e of plan.events) cbRef.current?.(e);
        if (plan.reject) throw plan.reject;
        return plan.result;
      })();
      return {
        onProgress(cb: (e: ProgressEvent) => void): () => void {
          cbRef.current = cb;
          return () => {};
        },
        result: promise,
      };
    },
  } as unknown as ActionRegistry;
}

/**
 * start() returns the START snapshot; the async run mutates job state after.
 * Wait for the run to settle, then read the FINAL state from status().
 */
async function runToCompletion(
  manager: BuildJobManager,
  root: string,
  mode?: "init" | "update" | "auto"
): Promise<KnowledgeBuildJobSnapshot> {
  manager.start(root, mode);
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 5));
    const job = manager.status().find((j) => j.root === root);
    if (job && !job.running) return job;
  }
  throw new Error("job did not settle within 250ms");
}

test("happy path: [n/3] lines fold into stage states, job completes, settled emitted", async () => {
  const emitted: Emitted[] = [];
  const manager = new BuildJobManager(
    () =>
      makeRegistry({
        events: [
          { message: "[1/3] CodeGraph symbol index", percent: 5 },
          { message: "[1/3] indexed 42 symbols", percent: 20 },
          { message: "[1/3] CodeGraph done", percent: 33 },
          { message: "[2/3] OpenWiki document index", percent: 38 },
          { message: "[2/3] openwiki --init 运行中 40s", percent: undefined },
          { message: "[2/3] wiki done", percent: 66 },
          { message: "[3/3] arch-scan", percent: 70 },
          { message: "[3/3] arch-scan: 5 steps", percent: undefined },
          { message: "index.buildAll (init) complete", percent: 100 },
        ],
        result: {
          mode: "init",
          stages: [
            { stage: "codegraph", ok: true },
            { stage: "wiki", ok: true },
            { stage: "arch-scan", ok: true },
          ],
        },
      }),
    (channel, payload) => emitted.push(payload as Emitted)
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-bjm-"));
  const job = await runToCompletion(manager, root);

  assert.equal(job.running, false);
  assert.equal(job.stage, "done");
  assert.equal(job.percent, 100);
  assert.equal(job.error, null);
  // Stage state machine: all three done; wiki's LAST detail is the heartbeat,
  // then "wiki done" flips it done (detail keeps the last running detail).
  assert.deepEqual(
    job.stages.map((s) => s.status),
    ["done", "done", "done"]
  );
  assert.equal(job.stages[1]?.labelKey, "wiki");
  assert.equal(job.stages[2]?.labelKey, "arch");
  // Console ring: startup line + every progress line.
  assert.ok(job.logs.length >= 10);
  assert.ok(
    job.logs.every((l) => /^\d{2}:\d{2}:\d{2} /.test(l)),
    "logs carry HH:MM:SS stamps"
  );
  assert.ok(job.logs.some((l) => l.includes("build init started")));
  assert.ok(job.logs.some((l) => l.includes("build complete")));
  // Broadcasts carry the full snapshot; settled fires once at the end.
  const buildEvents = emitted.filter((e) => e.actionId === "index.build-all");
  assert.ok(buildEvents.length >= 2);
  assert.ok((buildEvents[0].data as { job?: unknown })?.job, "progress events embed the job snapshot");
  const settled = emitted.filter((e) => e.actionId === "knowledge.buildComplete");
  assert.equal(settled.length, 1);
});

test("stage failure surfaces as job error + settled event (result returns normally)", async () => {
  const emitted: Emitted[] = [];
  const manager = new BuildJobManager(
    () =>
      makeRegistry({
        events: [
          { message: "[1/3] CodeGraph done", percent: 33 },
          { message: "[2/3] wiki done", percent: 66 },
        ],
        result: {
          mode: "init",
          stages: [
            { stage: "codegraph", ok: true },
            { stage: "wiki", ok: false, error: "openwiki exited 1: boom" },
            { stage: "arch-scan", ok: true },
          ],
        },
      }),
    (channel, payload) => emitted.push(payload as Emitted)
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-bjm-"));
  const job = await runToCompletion(manager, root);
  await new Promise((r) => setTimeout(r, 0)); // let the async run settle

  assert.equal(job.running, false);
  assert.equal(job.stage, "failed");
  assert.match(job.error ?? "", /wiki: openwiki exited 1: boom/);
  assert.equal(job.stages[1]?.status, "failed");
  assert.equal(job.stages[1]?.error, "openwiki exited 1: boom");
  assert.equal(job.stages[2]?.status, "done");
  assert.ok(job.logs.some((l) => l.includes("build FAILED")));
  assert.equal(emitted.filter((e) => e.actionId === "knowledge.buildComplete").length, 1);
});

test("registry throw fails the job and marks the running stage failed", async () => {
  const emitted: Emitted[] = [];
  const manager = new BuildJobManager(
    () =>
      makeRegistry({
        events: [{ message: "[2/3] OpenWiki document index", percent: 38 }],
        reject: new Error("no project open"),
      }),
    (channel, payload) => emitted.push(payload as Emitted)
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-bjm-"));
  const job = await runToCompletion(manager, root);
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(job.stage, "failed");
  assert.match(job.error ?? "", /no project open/);
  assert.equal(job.stages[1]?.status, "failed", "wiki was running when the action threw");
  // codegraph never emitted a single [1/3] line — "skipped" is the honest
  // verdict (auto-completion only upgrades stages that actually RAN).
  assert.equal(job.stages[0]?.status, "skipped");
  assert.equal(emitted.filter((e) => e.actionId === "knowledge.buildComplete").length, 1);
});

test("idempotent start: second call while running returns the in-flight job", async () => {
  const releaseRef: { current: (() => void) | null } = { current: null };
  const gate = new Promise<void>((r) => {
    releaseRef.current = r;
  });
  const registry = {
    execute: () => ({
      onProgress: () => () => {},
      result: gate.then(() => ({ mode: "init", stages: [{ stage: "codegraph", ok: true }] })),
    }),
  } as unknown as ActionRegistry;
  const manager = new BuildJobManager(
    () => registry,
    () => {}
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-bjm-"));
  const first = manager.start(root);
  assert.equal(first.running, true);
  const second = manager.start(root);
  assert.equal(second.running, true);
  releaseRef.current?.();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(manager.status()[0]?.running, false);
});

test("auto mode: init without indexes, update when both exist", async () => {
  const emitted: Emitted[] = [];
  const modes: string[] = [];
  const registryFor = (mode: string): ActionRegistry =>
    ({
      execute: (_id: string, input: { mode?: string }) => {
        modes.push(input.mode ?? "?");
        return {
          onProgress: () => () => {},
          result: Promise.resolve({ mode, stages: [] }),
        };
      },
    }) as unknown as ActionRegistry;
  const manager = new BuildJobManager(
    () => registryFor("init"),
    (_c, p) => emitted.push(p as Emitted)
  );

  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-bjm-"));
  manager.start(emptyRoot);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(modes[0], "init", "no indexes → init");

  const builtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-bjm-"));
  fs.mkdirSync(path.join(builtRoot, ".codegraph"), { recursive: true });
  fs.writeFileSync(path.join(builtRoot, ".codegraph", "codegraph.db"), "x");
  fs.mkdirSync(path.join(builtRoot, "openwiki"), { recursive: true });
  manager.start(builtRoot, "auto");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(modes[1], "update", "both indexes → update");
  // update mode only tracks the two deterministic stages.
  const job = manager.status().find((j) => j.root === builtRoot);
  assert.equal(job?.stages.length, 2);
});
