/**
 * Phase 2 telemetry tests (specs/memory-remediation): per-call generation
 * reporting + aggregate usage counters.
 *
 * 1. DeepOrcaLLMRunner emits one onGeneration per run() — layer derived from
 *    taskId, tokens summed across tool-loop rounds, ok=false + error on API
 *    failure (run() still rejects).
 * 2. createGenerationRecorder aggregates counters and appends the JSONL audit
 *    trail best-effort (log-write failure never breaks recording).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { DeepOrcaHostAdapter, type DeepOrcaMemoryConfig, type MemoryGenerationInfo } from "../adapter.js";
import { createGenerationRecorder } from "../memory-manager.js";
import type { LLMRunner } from "../tdai/core/types.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-mem-phase2-"));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ScriptedTurn {
  content?: string | null;
  toolCalls?: Array<{ id: string; name: string; args: unknown }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function installScriptedFetch(script: ScriptedTurn[]): { restore: () => void } {
  let index = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    const turn = script[Math.min(index, script.length - 1)];
    index += 1;
    const toolCalls = turn.toolCalls?.length
      ? turn.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        }))
      : undefined;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: turn.content ?? "", ...(toolCalls ? { tool_calls: toolCalls } : {}) } }],
        usage: turn.usage,
      }),
    };
  }) as typeof fetch;
  return { restore: () => void (globalThis.fetch = original) };
}

function makeRunner(config: DeepOrcaMemoryConfig, enableTools: boolean): LLMRunner {
  return new DeepOrcaHostAdapter(config).getLLMRunnerFactory().createRunner({ enableTools });
}

test("onGeneration: tokens summed across tool-loop rounds, layer derived from taskId", async () => {
  const dir = tmpDir();
  const workspace = path.join(dir, "scene_blocks");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "a.md"), "x");
  const events: MemoryGenerationInfo[] = [];
  const mock = installScriptedFetch([
    {
      toolCalls: [{ id: "c1", name: "read", args: { path: "a.md" } }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    },
    { content: "ok", usage: { prompt_tokens: 150, completion_tokens: 5 } },
  ]);
  try {
    const runner = makeRunner(
      {
        baseUrl: "http://127.0.0.1:1/v1",
        apiKey: "k",
        model: "m",
        dataDir: dir,
        onGeneration: (info) => events.push(info),
      },
      true
    );
    await runner.run({ prompt: "p", taskId: "scene-extract-42", workspaceDir: workspace });

    assert.equal(events.length, 1);
    const event = events[0];
    assert.equal(event.ok, true);
    assert.equal(event.layer, "l2");
    assert.equal(event.rounds, 2);
    assert.equal(event.promptTokens, 250);
    assert.equal(event.completionTokens, 15);
    assert.equal(event.totalTokens, 265);
    assert.ok(event.latencyMs >= 0);
  } finally {
    mock.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("onGeneration: layer mapping covers l1/l3/other", async () => {
  const dir = tmpDir();
  const events: MemoryGenerationInfo[] = [];
  const mock = installScriptedFetch([{ content: "x" }]);
  try {
    const config: DeepOrcaMemoryConfig = {
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: "k",
      model: "m",
      dataDir: dir,
      onGeneration: (info) => events.push(info),
    };
    const runner = makeRunner(config, false);
    for (const taskId of ["l1-extraction", "persona-generation", "l1-conflict-detection", "something-else"]) {
      await runner.run({ prompt: "p", taskId });
    }
    assert.deepEqual(
      events.map((event) => [event.taskId, event.layer]),
      [
        ["l1-extraction", "l1"],
        ["persona-generation", "l3"],
        ["l1-conflict-detection", "l1"],
        ["something-else", "other"],
      ]
    );
  } finally {
    mock.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("onGeneration: failed calls are reported with ok=false and re-thrown", async () => {
  const dir = tmpDir();
  const events: MemoryGenerationInfo[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false,
    status: 500,
    statusText: "Boom",
    text: async () => "err",
  })) as typeof fetch;
  try {
    const runner = makeRunner(
      {
        baseUrl: "http://127.0.0.1:1/v1",
        apiKey: "k",
        model: "m",
        dataDir: dir,
        onGeneration: (info) => events.push(info),
      },
      false
    );
    await assert.rejects(runner.run({ prompt: "p", taskId: "l1-extraction" }), /LLM call failed: 500/);
    assert.equal(events.length, 1);
    assert.equal(events[0].ok, false);
    assert.match(events[0].error ?? "", /LLM call failed: 500/);
    assert.equal(events[0].rounds, 0);
  } finally {
    globalThis.fetch = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("createGenerationRecorder: counters + JSONL audit trail, best-effort on IO failure", async () => {
  const dir = tmpDir();
  try {
    const recorder = createGenerationRecorder(dir);
    recorder.record({
      ts: 1,
      layer: "l1",
      taskId: "l1-extraction",
      model: "m",
      latencyMs: 5,
      rounds: 1,
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
      ok: true,
    });
    recorder.record({
      ts: 2,
      layer: "l2",
      taskId: "scene-extract-1",
      model: "m",
      latencyMs: 6,
      rounds: 3,
      promptTokens: 30,
      completionTokens: 4,
      totalTokens: 34,
      ok: true,
    });
    recorder.record({
      ts: 3,
      layer: "l2",
      taskId: "scene-extract-2",
      model: "m",
      latencyMs: 1,
      rounds: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      ok: false,
      error: "x",
    });

    const usage = recorder.getUsage();
    assert.equal(usage.calls, 3);
    assert.equal(usage.failedCalls, 1);
    assert.equal(usage.totalTokens, 46);
    assert.deepEqual(usage.byLayer.l1, { calls: 1, totalTokens: 12 });
    assert.deepEqual(usage.byLayer.l2, { calls: 2, totalTokens: 34 });

    // Fire-and-forget append needs a tick to land. Concurrent appends go
    // through the threadpool, so LINE ORDER is not guaranteed — assert by
    // content, not position.
    await sleep(50);
    const logPath = path.join(dir, ".metadata", "generation-log.jsonl");
    const entries = fs
      .readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { taskId: string; ok: boolean });
    assert.deepEqual(entries.map((entry) => entry.taskId).sort(), [
      "l1-extraction",
      "scene-extract-1",
      "scene-extract-2",
    ]);
    assert.equal(entries.find((entry) => entry.taskId === "scene-extract-2")?.ok, false);

    // IO failure path: dataDir occupied by a FILE → mkdir fails → recording
    // must continue undisturbed.
    const blocked = path.join(dir, "occupied");
    fs.writeFileSync(blocked, "not a dir");
    const hostile = createGenerationRecorder(path.join(blocked, "sub"));
    hostile.record({
      ts: 4,
      layer: "l3",
      taskId: "persona-generation",
      model: "m",
      latencyMs: 1,
      rounds: 1,
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      ok: true,
    });
    assert.equal(hostile.getUsage().calls, 1);
    await sleep(30);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
