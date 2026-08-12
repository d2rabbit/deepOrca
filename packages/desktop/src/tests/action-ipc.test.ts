/**
 * Tests for the defineAction desktop IPC bridge (action-ipc.ts).
 *
 * Proves the IPC surface (the third leg): the ping action — already reachable
 * as an LLM tool via dispatchToolCall and listed via toToolDefinitions in core —
 * is also reachable through the IPC handlers `registerActionIpc` wires, with
 * progress streamed over the injected `emit`. Together with core's actions.test
 * this closes IPC + MCP/LLM = all three surfaces of "define once". See
 * specs/define-action/design.md §六 (Phase 0).
 *
 * Electron-free: action-ipc.ts injects `handle`/`emit`/`getProjectRoot`, so we
 * mock them here. ElectronNodeSpawner spawns a real node subprocess.
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

import {
  ActionError,
  ActionRegistry,
  pingDefinition,
  pingRun,
  reviewRunDefinition,
  reviewRun,
  configureReviewController,
  type ReviewController,
  type ReviewResult,
} from "@deeporca/core";

import {
  ElectronNodeSpawner,
  registerActionIpc,
  IpcActionChannel,
  IpcActionEvent,
  type ActionIpcHelpers,
} from "../main/action-ipc.js";

const PROJECT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "action-ipc-"));

/** Build a registry with the ping action registered — mirrors what
 * SessionManager constructs in production (the unified registry). */
function makeRegistryWithPing(root: string = PROJECT_ROOT): ActionRegistry {
  const r = new ActionRegistry({ projectRoot: root });
  r.register(pingDefinition, pingRun);
  return r;
}

// Captured IPC handlers: channel → registered fn. Mocks ipcMain.handle.
function makeCapturingHelpers(): {
  helpers: ActionIpcHelpers;
  handlers: Map<string, (...args: never[]) => unknown>;
} {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const capture =
    (kind: string) =>
    <T>(channel: string, fn: (...args: never[]) => T | Promise<T>): void => {
      void kind;
      handlers.set(channel, fn as (...args: never[]) => unknown);
    };
  return {
    helpers: { handle: capture("handle"), handlePrivileged: capture("privileged") },
    handlers,
  };
}

describe("ElectronNodeSpawner", () => {
  test("spawn streams stdout lines and resolves exit code", async () => {
    const spawner = new ElectronNodeSpawner();
    const proc = spawner.spawn(process.execPath, ["-e", "process.stdout.write('alpha\\nbravo\\n'); process.exit(0)"]);
    const lines: string[] = [];
    for await (const line of proc.stdout) lines.push(line);
    const exit = await proc.exited;
    assert.deepEqual(lines, ["alpha", "bravo"]);
    assert.equal(exit.code, 0);
  });

  test("non-zero exit code is reported", async () => {
    const spawner = new ElectronNodeSpawner();
    const proc = spawner.spawn(process.execPath, ["-e", "process.exit(3)"]);
    const exit = await proc.exited;
    assert.equal(exit.code, 3);
  });

  test("resolveNodeRunner returns the host executable", () => {
    assert.equal(new ElectronNodeSpawner().resolveNodeRunner(), process.execPath);
  });

  test("kill terminates a long-running process", async () => {
    const spawner = new ElectronNodeSpawner();
    const proc = spawner.spawn(process.execPath, ["-e", "setInterval(()=>0, 1000)"]);
    proc.kill("SIGTERM");
    const exit = await proc.exited;
    assert.ok(exit.code !== 0, `expected non-zero exit after kill, got ${exit.code}`);
  });
});

describe("review.run via IPC (Phase 1 — same action, second surface)", () => {
  // Proves the SAME review.run action reachable from the LLM (core's executor
  // dispatch) is also reachable through the IPC handler. Uses a mock
  // ReviewController — the real OcrCliController lives in desktop/main/tools.
  const cleanup = (): void => configureReviewController(null);
  afterEach(cleanup);

  test("ActionRun('review.run') returns structured comments via controller", async () => {
    const mockResult: ReviewResult = {
      status: "success",
      llm: { model: "deepseek-v4-pro" },
      summary: { filesReviewed: 3, comments: 1, totalTokens: 5000 },
      comments: [{ path: "src/ipc.ts", startLine: 5, content: "ipc finding", suggestionCode: "fix" }],
    };
    configureReviewController({
      isAvailable: () => true,
      runReview: async (_root, _opts, onProgress) => {
        onProgress?.({ message: "mock review", percent: 50 });
        return mockResult;
      },
    });

    const registry = new ActionRegistry({ projectRoot: PROJECT_ROOT });
    registry.register(pingDefinition, pingRun);
    registry.register(reviewRunDefinition, reviewRun);

    const emitted: { channel: string; payload: unknown }[] = [];
    const { helpers, handlers } = makeCapturingHelpers();
    registerActionIpc(helpers, {
      emit: (channel, payload) => emitted.push({ channel, payload }),
      getRegistry: () => registry,
    });
    const runFn = handlers.get(IpcActionChannel.Run)! as (id: string, input: unknown) => Promise<unknown>;
    const res = (await runFn("review.run", {})) as {
      ok: boolean;
      output: ReviewResult;
    };
    assert.equal(res.ok, true);
    assert.equal(res.output.comments.length, 1);
    assert.equal(res.output.comments[0].path, "src/ipc.ts");
    assert.equal(res.output.comments[0].startLine, 5);
    assert.equal(res.output.summary?.comments, 1);
    // Progress streamed over the unified action channel.
    assert.ok(emitted.some((e) => e.channel === IpcActionEvent.Progress));
  });

  test("ActionList includes both ping and review_run definitions", () => {
    const registry = new ActionRegistry({ projectRoot: PROJECT_ROOT });
    registry.register(pingDefinition, pingRun);
    registry.register(reviewRunDefinition, reviewRun);
    const { helpers, handlers } = makeCapturingHelpers();
    registerActionIpc(helpers, { emit: () => {}, getRegistry: () => registry });
    const ids = ((handlers.get(IpcActionChannel.List)! as () => unknown[])() as { id: string }[]).map((d) => d.id);
    assert.ok(ids.includes("system.ping"));
    assert.ok(ids.includes("review.run"));
  });
});

describe("registerActionIpc (the IPC surface)", () => {
  test("registers List and Run channels", () => {
    const registry = makeRegistryWithPing();
    const { helpers, handlers } = makeCapturingHelpers();
    registerActionIpc(helpers, { emit: () => {}, getRegistry: () => registry });
    assert.ok(handlers.has(IpcActionChannel.List));
    assert.ok(handlers.has(IpcActionChannel.Run));
  });

  test("ActionList returns the registered ping definition", () => {
    const registry = makeRegistryWithPing();
    const { helpers, handlers } = makeCapturingHelpers();
    registerActionIpc(helpers, { emit: () => {}, getRegistry: () => registry });
    const fn = handlers.get(IpcActionChannel.List)!;
    const defs = (fn as () => unknown[])();
    assert.ok(defs.some((d) => (d as { id: string }).id === "system.ping"));
  });

  test("ActionList returns [] when no registry is available (no project)", () => {
    const { helpers, handlers } = makeCapturingHelpers();
    registerActionIpc(helpers, { emit: () => {}, getRegistry: () => null });
    const defs = (handlers.get(IpcActionChannel.List)! as () => unknown[])();
    assert.equal(defs.length, 0);
  });

  test("ActionRun executes ping and forwards progress + result (the three-surface proof)", async () => {
    const registry = makeRegistryWithPing();
    const emitted: { channel: string; payload: unknown }[] = [];
    const { helpers, handlers } = makeCapturingHelpers();
    registerActionIpc(helpers, {
      emit: (channel, payload) => emitted.push({ channel, payload }),
      getRegistry: () => registry,
    });
    const runFn = handlers.get(IpcActionChannel.Run)! as (id: string, input: unknown) => Promise<unknown>;
    const res = (await runFn("system.ping", { name: "via-ipc" })) as {
      ok: boolean;
      output: { pong: string; echo: string; projectRoot: string };
    };
    // Result surface.
    assert.equal(res.ok, true);
    assert.equal(res.output.pong, "pong");
    assert.equal(res.output.echo, "via-ipc");
    assert.equal(res.output.projectRoot, PROJECT_ROOT);
    // Progress surface — ping emits one event at percent 50.
    const progressEmits = emitted.filter((e) => e.channel === IpcActionEvent.Progress);
    assert.ok(progressEmits.length >= 1, "expected at least one progress emit");
    const payload = progressEmits[0].payload as { actionId: string; message: string; percent: number };
    assert.equal(payload.actionId, "system.ping");
    assert.match(payload.message, /ping received/);
    assert.equal(payload.percent, 50);
  });

  test("ActionRun returns a structured error for an unknown action", async () => {
    const registry = makeRegistryWithPing();
    const { helpers, handlers } = makeCapturingHelpers();
    registerActionIpc(helpers, { emit: () => {}, getRegistry: () => registry });
    const runFn = handlers.get(IpcActionChannel.Run)! as (id: string, input: unknown) => Promise<unknown>;
    const res = (await runFn("missing.thing", {})) as { ok: false; code: string };
    assert.equal(res.ok, false);
    assert.equal(res.code, "ACTION_NOT_FOUND");
  });

  test("ActionRun returns NO_PROJECT when no registry is available", async () => {
    const { helpers, handlers } = makeCapturingHelpers();
    registerActionIpc(helpers, { emit: () => {}, getRegistry: () => null });
    const runFn = handlers.get(IpcActionChannel.Run)! as (id: string, input: unknown) => Promise<unknown>;
    const res = (await runFn("system.ping", {})) as { ok: false; code: string };
    assert.equal(res.ok, false);
    assert.equal(res.code, "NO_PROJECT");
  });
});

// Reference imports kept for type alignment (pingRun signature parity with core).
void pingRun;
void ActionError;
