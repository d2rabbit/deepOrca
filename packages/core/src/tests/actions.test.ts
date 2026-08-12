/**
 * Tests for the defineAction primitive (ActionRegistry + RunHandle + dispatch).
 * Pure-logic: no real subprocess, no electron. Proves the three-surface
 * mechanism (register → toToolDefinitions → execute → progress → cancel) that
 * Phase 1+ module migrations rely on. See `specs/define-action/design.md`.
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { ActionRegistry, defineAction, dispatchToolCall } from "../actions";
import { ActionError, NULL_SPAWNER } from "../actions";
import type { ActionDefinition, ActionProgress, Spawner, SpawnedProcess } from "../actions";
import { pingDefinition, pingRun } from "../actions";
import { reviewRunDefinition, reviewRun, configureReviewController } from "../actions";
import type { ReviewResult } from "../actions";
import { ToolExecutor } from "../tools/executor";

const PROJECT_ROOT = "/tmp/test-project";

function makeRegistry(spawner: Spawner = NULL_SPAWNER): ActionRegistry {
  return new ActionRegistry({ projectRoot: PROJECT_ROOT, spawner });
}

// NOTE: a single outer describe is deliberate. This file's async/abort tests
// trip node:test's --test-force-exit when describe blocks are top-level and
// concurrent (the runner exits after the first batch completes). One top-level
// point makes force-exit wait for the whole suite. Do not "flatten" this.
describe("defineAction primitive", { concurrency: 1 }, () => {
  describe("ActionRegistry.register", () => {
    test("registers and lists in insertion order", () => {
      const r = makeRegistry();
      defineAction(r, pingDefinition, pingRun);
      defineAction(r, { ...pingDefinition, id: "system.echo", description: "echo" }, pingRun);
      assert.deepEqual(
        r.list().map((d) => d.id),
        ["system.ping", "system.echo"]
      );
    });

    test("rejects duplicate id", () => {
      const r = makeRegistry();
      defineAction(r, pingDefinition, pingRun);
      assert.throws(() => r.register(pingDefinition, pingRun), /duplicate id "system\.ping"/);
    });

    test("rejects malformed id (not dotted lowercase)", () => {
      const r = makeRegistry();
      const bad: ActionDefinition = { ...pingDefinition, id: "nope" };
      assert.throws(() => r.register(bad, pingRun), /invalid id "nope"/);
      const caps: ActionDefinition = { ...pingDefinition, id: "System.Ping" };
      assert.throws(() => r.register(caps, pingRun), /invalid id/);
    });
  });

  describe("ActionRegistry.toToolDefinitions", () => {
    test("generates OpenAI function tools with dotted→underscore names", () => {
      const r = makeRegistry();
      defineAction(r, pingDefinition, pingRun);
      const tools = r.toToolDefinitions();
      assert.equal(tools.length, 1);
      assert.equal(tools[0].type, "function");
      assert.equal(tools[0].function.name, "system_ping");
      assert.equal(tools[0].function.description, pingDefinition.description);
      assert.equal(tools[0].function.parameters, pingDefinition.parameters);
    });

    test("tool-name ↔ action-id round-trip", () => {
      const r = makeRegistry();
      defineAction(r, pingDefinition, pingRun);
      assert.equal(r.actionIdForToolName("system_ping"), "system.ping");
      assert.equal(r.actionIdForToolName("unknown_tool"), null);
    });
  });

  describe("ActionRegistry.execute", () => {
    test("runs a deterministic action and returns its result", async () => {
      const r = makeRegistry();
      defineAction(r, pingDefinition, pingRun);
      const handle = r.execute<PingInput, PingOutput>("system.ping", { name: "deeporca" });
      const out = await handle.result;
      assert.equal(out.pong, "pong");
      assert.equal(out.echo, "deeporca");
      assert.equal(out.projectRoot, PROJECT_ROOT);
    });

    test("forwards progress via onProgress", async () => {
      const r = makeRegistry();
      defineAction(r, pingDefinition, pingRun);
      const events: ActionProgress[] = [];
      const handle = r.execute("system.ping", { name: "x" });
      handle.onProgress((e) => events.push(e));
      await handle.result;
      assert.ok(events.length >= 1);
      assert.match(events[0].message, /ping received/);
      assert.equal(events[0].percent, 50);
    });

    test("onProgress unsubscribe stops further callbacks", async () => {
      const r = makeRegistry();
      // Emit AFTER a tick so the emit lands after the synchronous subscribe+unsub.
      defineAction(r, pingDefinition, async (_input, ctx) => {
        await new Promise((res) => setImmediate(res));
        ctx.emit({ message: "late", percent: 100 });
        return { pong: "pong", echo: "", projectRoot: "" };
      });
      const events: ActionProgress[] = [];
      const handle = r.execute("system.ping", {});
      const unsub = handle.onProgress((e) => events.push(e));
      unsub();
      await handle.result;
      assert.equal(events.length, 0);
    });

    test("ACTION_NOT_FOUND for unknown id", async () => {
      const r = makeRegistry();
      const handle = r.execute("missing.action", {});
      await assert.rejects(
        () => handle.result,
        (err: unknown) => err instanceof ActionError && err.code === "ACTION_NOT_FOUND"
      );
    });

    test("INPUT_INVALID when object expected but not given", async () => {
      const r = makeRegistry();
      defineAction(r, pingDefinition, pingRun);
      const handle = r.execute("system.ping", "not-an-object");
      await assert.rejects(
        () => handle.result,
        (err: unknown) => err instanceof ActionError && err.code === "INPUT_INVALID"
      );
    });

    test("wraps a thrown run error as ACTION_FAILED", async () => {
      const r = makeRegistry();
      defineAction(r, pingDefinition, async () => {
        throw new Error("boom");
      });
      const handle = r.execute("system.ping", {});
      await assert.rejects(
        () => handle.result,
        (err: unknown) => err instanceof ActionError && err.code === "ACTION_FAILED" && /boom/.test(err.message)
      );
    });

    test("cancel() during run surfaces CANCELLED", async () => {
      const r = makeRegistry();
      const events: ActionProgress[] = [];
      defineAction(r, pingDefinition, async (_input, ctx) => {
        ctx.emit({ message: "started" });
        // Poll the signal with short-lived ticks (self-cleaning; no never-
        // resolving promise that could leak a handle if the test aborts early).
        while (!ctx.signal.aborted) {
          await new Promise((res) => setImmediate(res));
        }
        throw new Error("aborted mid-run");
      });
      const handle = r.execute("system.ping", {});
      handle.onProgress((e) => events.push(e));
      assert.equal(events.length, 1, "action should have started before cancel");
      handle.cancel("mid-run");
      await assert.rejects(
        () => handle.result,
        (err: unknown) => err instanceof ActionError && err.code === "CANCELLED"
      );
    });

    test("pre-aborted signal propagates as CANCELLED", async () => {
      const r = makeRegistry();
      defineAction(r, pingDefinition, async (_input, ctx) => {
        if (ctx.signal.aborted) throw new Error("already aborted");
        return { pong: "pong", echo: "", projectRoot: "" };
      });
      const ac = new AbortController();
      ac.abort("before");
      const handle = r.execute("system.ping", {}, { signal: ac.signal });
      await assert.rejects(
        () => handle.result,
        (err: unknown) => err instanceof ActionError && err.code === "CANCELLED"
      );
    });
  });

  describe("Spawner seam", () => {
    test("NULL_SPAWNER rejects spawn with a clear message", async () => {
      const proc = NULL_SPAWNER.spawn("anything", []);
      await assert.rejects(() => proc.exited, /NULL_SPAWNER/);
      assert.equal(NULL_SPAWNER.resolveNodeRunner(), null);
    });

    test("mock spawner is injected and observable by an action", async () => {
      const seen: string[] = [];
      const mock: Spawner = {
        spawn(command, args) {
          seen.push(`${command} ${args.join(" ")}`);
          const proc: SpawnedProcess = {
            stdout: asyncIterableOf(["line1"]),
            stderr: asyncIterableOf([]),
            exited: Promise.resolve({ code: 0 }),
            kill() {},
          };
          return proc;
        },
        resolveNodeRunner: () => "/fake/node",
      };
      const r = makeRegistry(mock);
      defineAction(r, pingDefinition, async () => {
        const proc = r === null ? null : null;
        void proc;
        // Use the injected spawner through a fresh action to prove the seam.
        return { pong: "pong", echo: "spawned", projectRoot: "" };
      });
      // Separate action that actually uses ctx.spawner:
      defineAction(r, { ...pingDefinition, id: "system.spawn-probe" }, async (_i, ctx) => {
        const p = ctx.spawner.spawn("ocr", ["review"]);
        const lines: string[] = [];
        for await (const line of p.stdout) lines.push(line);
        const exit = await p.exited;
        return { pong: "ok", echo: lines.join("|"), projectRoot: `${exit.code}` };
      });
      const out = await r.execute<unknown, { echo: string }>("system.spawn-probe", {}).result;
      assert.deepEqual(seen, ["ocr review"]);
      assert.equal(out.echo, "line1");
    });
  });

  describe("dispatchToolCall (mcp-bridge)", () => {
    test("routes an LLM tool call to its action and returns output", async () => {
      const r = makeRegistry();
      defineAction(r, pingDefinition, pingRun);
      const res = await dispatchToolCall(r, "system_ping", { name: "via-tool" });
      assert.equal(res.ok, true);
      assert.equal((res.output as PingOutput).echo, "via-tool");
    });

    test("throws ACTION_NOT_FOUND for unknown tool", async () => {
      const r = makeRegistry();
      await assert.rejects(
        () => dispatchToolCall(r, "missing_tool", {}),
        (err: unknown) => err instanceof ActionError && err.code === "ACTION_NOT_FOUND"
      );
    });
  });

  describe("ToolExecutor dispatch (LLM surface)", () => {
    // Proves the third leg end-to-end at the engine level: the same action the
    // agent sees as a tool (toToolDefinitions) is routed by ToolExecutor through
    // the registry when the LLM emits a tool call for it.
    test("dispatches a system_ping tool call via the registry", async () => {
      const registry = new ActionRegistry({ projectRoot: PROJECT_ROOT });
      registry.register(pingDefinition, pingRun);
      const executor = new ToolExecutor(PROJECT_ROOT, undefined, undefined, registry);
      const res = await executor.executeToolCalls("s1", [
        { id: "t1", type: "function", function: { name: "system_ping", arguments: '{"name":"executor-path"}' } },
      ]);
      assert.equal(res.length, 1);
      assert.equal(res[0].result.ok, true);
      assert.equal(res[0].result.name, "system_ping");
      assert.match(res[0].result.output ?? "", /executor-path/);
    });

    test("a non-existent action tool name falls through to Unknown tool", async () => {
      const registry = new ActionRegistry({ projectRoot: PROJECT_ROOT });
      const executor = new ToolExecutor(PROJECT_ROOT, undefined, undefined, registry);
      const res = await executor.executeToolCalls("s1", [
        { id: "t2", type: "function", function: { name: "totally_missing", arguments: "{}" } },
      ]);
      assert.equal(res[0].result.ok, false);
      assert.match(res[0].result.error ?? "", /Unknown tool/);
    });

    test("ToolExecutor without a registry still works (back-compat)", async () => {
      const executor = new ToolExecutor(PROJECT_ROOT);
      const res = await executor.executeToolCalls("s1", [
        { id: "t3", type: "function", function: { name: "system_ping", arguments: "{}" } },
      ]);
      // No registry → action not recognized → Unknown tool (does not throw).
      assert.equal(res[0].result.ok, false);
      assert.match(res[0].result.error ?? "", /Unknown tool/);
    });
  });

  describe("review.run action (Phase 1 — ocr gains an MCP surface)", () => {
    const cleanupResolver = (): void => configureReviewController(null);
    afterEach(() => cleanupResolver());

    const mockResult: ReviewResult = {
      status: "success",
      llm: { model: "deepseek-v4-pro" },
      summary: { filesReviewed: 1, comments: 1, totalTokens: 1000 },
      comments: [{ path: "src/a.ts", startLine: 10, content: "null deref", suggestionCode: "guard" }],
    };

    test("returns structured comments via controller", async () => {
      configureReviewController({
        isAvailable: () => true,
        runReview: async () => mockResult,
      });
      const r = new ActionRegistry({ projectRoot: PROJECT_ROOT });
      r.register(reviewRunDefinition, reviewRun);
      const out = await r.execute<unknown, ReviewResult>("review.run", {}).result;
      assert.equal(out.comments.length, 1);
      assert.equal(out.comments[0].path, "src/a.ts");
      assert.equal(out.status, "success");
    });

    test("throws ACTION_FAILED when no ReviewController configured", async () => {
      configureReviewController(null);
      const r = new ActionRegistry({ projectRoot: PROJECT_ROOT });
      r.register(reviewRunDefinition, reviewRun);
      await assert.rejects(
        () => r.execute("review.run", {}).result,
        (err: unknown) =>
          err instanceof ActionError && err.code === "ACTION_FAILED" && /no ReviewController/.test(err.message)
      );
    });

    test("toToolDefinitions exposes review_run (ocr's first MCP/LLM tool surface)", () => {
      const r = new ActionRegistry({ projectRoot: PROJECT_ROOT });
      r.register(reviewRunDefinition, reviewRun);
      const tools = r.toToolDefinitions();
      const reviewTool = tools.find((t) => t.function.name === "review_run");
      assert.ok(reviewTool, "review_run tool must be generated");
      assert.match(reviewTool!.function.description, /code review/i);
    });

    test("ToolExecutor dispatches review_run via the registry (LLM surface)", async () => {
      configureReviewController({
        isAvailable: () => true,
        runReview: async () => mockResult,
      });
      const r = new ActionRegistry({ projectRoot: PROJECT_ROOT });
      r.register(reviewRunDefinition, reviewRun);
      const executor = new ToolExecutor(PROJECT_ROOT, undefined, undefined, r);
      const res = await executor.executeToolCalls("s1", [
        { id: "rv1", type: "function", function: { name: "review_run", arguments: "{}" } },
      ]);
      assert.equal(res[0].result.ok, true);
      assert.equal(res[0].result.name, "review_run");
      assert.match(res[0].result.output ?? "", /src\/a\.ts/);
    });
  });
}); // close outer "defineAction primitive" describe

// --- helpers -----------------------------------------------------------------

type PingInput = { name?: string };
type PingOutput = { pong: string; echo: string; projectRoot: string };

function asyncIterableOf(lines: string[]): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next(): Promise<IteratorResult<string>> {
          if (i < lines.length) return Promise.resolve({ value: lines[i++], done: false });
          return Promise.resolve({ value: undefined as unknown as string, done: true });
        },
      };
    },
  };
}
