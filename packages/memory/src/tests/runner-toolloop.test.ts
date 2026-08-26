/**
 * Phase 1 regression tests (specs/memory-remediation): sandboxed LLM file
 * tools + L3 failure backoff.
 *
 * 1. resolveSandboxedPath: containment (absolute / drive / UNC / `..`
 *    segments / backslash traversal rejected; valid relative paths pass).
 * 2. DeepOrcaLLMRunner tool loop (via DeepOrcaHostAdapter's factory, with a
 *    scripted globalThis.fetch — no network): write happy path, traversal
 *    blocked inside the loop, iteration cap, and tool-less runners ignoring
 *    hallucinated tool_calls (L1 path).
 * 3. MemoryPipelineManager L3 failure backoff: a failing L3 run must not
 *    re-trigger after every subsequent L2 completion (the pre-Phase-1
 *    cold-start infinite-retry defect).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { DeepOrcaHostAdapter, type DeepOrcaMemoryConfig } from "../adapter.js";
import { executeFileTool, resolveSandboxedPath } from "../runner-tools.js";
import { MemoryPipelineManager, type CapturedMessage } from "../tdai/utils/pipeline-manager.js";
import type { LLMRunner } from "../tdai/core/types.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-mem-phase1-"));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── resolveSandboxedPath ─────────────────────────────────────────────────────

test("resolveSandboxedPath rejects every escape vector", () => {
  const root = path.join(os.tmpdir(), "ws");
  const escapes = [
    "/etc/passwd", // absolute POSIX
    "C:\\Windows\\system32", // Windows drive
    "\\\\server\\share\\f", // UNC (becomes //server/... after normalization)
    "../secret.txt", // parent traversal
    "foo/../../secret.txt", // embedded traversal
    "..\\..\\secret.txt", // backslash traversal
    "foo/../bar.md", // non-leading .. segment
    "", // empty
    ".", // workspace root itself
  ];
  for (const candidate of escapes) {
    assert.equal(resolveSandboxedPath(root, candidate), null, `must reject: ${candidate}`);
  }

  assert.equal(resolveSandboxedPath(root, "scene.md"), path.resolve(root, "scene.md"));
  assert.equal(resolveSandboxedPath(root, "./sub/dir/file.md"), path.resolve(root, "sub/dir/file.md"));
  assert.equal(resolveSandboxedPath(root, "sub\\win-style.md"), path.resolve(root, "sub/win-style.md"));
});

// ── scripted fetch ───────────────────────────────────────────────────────────

interface ScriptedTurn {
  content?: string | null;
  toolCalls?: Array<{ id: string; name: string; args: unknown }>;
}

interface RecordedRequest {
  body: { model: string; messages: Array<Record<string, unknown>>; tools?: unknown };
}

function installScriptedFetch(script: ScriptedTurn[]): { calls: RecordedRequest[]; restore: () => void } {
  const calls: RecordedRequest[] = [];
  let index = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    calls.push({ body: JSON.parse(init.body) });
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
      }),
    };
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

function makeRunner(config: DeepOrcaMemoryConfig, enableTools: boolean): LLMRunner {
  return new DeepOrcaHostAdapter(config).getLLMRunnerFactory().createRunner({ enableTools });
}

function baseConfig(dataDir: string): DeepOrcaMemoryConfig {
  return { baseUrl: "http://127.0.0.1:1/v1", apiKey: "test-key", model: "test-model", dataDir };
}

// ── tool loop ────────────────────────────────────────────────────────────────

test("tool-enabled runner executes model file writes inside the sandbox", async () => {
  const dir = tmpDir();
  const workspace = path.join(dir, "scene_blocks");
  const mock = installScriptedFetch([
    {
      toolCalls: [{ id: "c1", name: "write", args: { path: "work.md", content: "# Scene\n\nDeep work." } }],
    },
    { content: "done" },
  ]);
  try {
    const runner = makeRunner(baseConfig(dir), true);
    const result = await runner.run({
      prompt: "consolidate",
      taskId: "scene-extract-test",
      workspaceDir: workspace,
    });
    assert.equal(result, "done");
    assert.equal(fs.readFileSync(path.join(workspace, "work.md"), "utf-8"), "# Scene\n\nDeep work.");
    // The second POST must carry the assistant tool_call + tool result messages.
    const secondMessages = mock.calls[1]?.body.messages as Array<{
      role?: string;
      tool_calls?: unknown[];
      tool_call_id?: string;
    }>;
    const assistantWithTools = secondMessages.find((m) => m.role === "assistant" && m.tool_calls);
    assert.ok(assistantWithTools, "assistant message with tool_calls must be echoed back");
    const toolMessage = secondMessages.find((m) => m.role === "tool");
    assert.equal(toolMessage?.tool_call_id, "c1");
    assert.match(String(toolMessage?.content ?? ""), /\{"success":true\}/);
  } finally {
    mock.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("traversal attempts are refused and reported back to the model, not written", async () => {
  const dir = tmpDir();
  const workspace = path.join(dir, "scene_blocks");
  fs.mkdirSync(workspace, { recursive: true });
  const escapeTarget = path.join(dir, "escape.txt");
  const mock = installScriptedFetch([
    { toolCalls: [{ id: "c1", name: "write", args: { path: "../escape.txt", content: "pwn" } }] },
    { content: "gave up" },
  ]);
  try {
    const runner = makeRunner(baseConfig(dir), true);
    const result = await runner.run({ prompt: "p", taskId: "t", workspaceDir: workspace });
    assert.equal(result, "gave up");
    assert.equal(fs.existsSync(escapeTarget), false, "file must not be created outside the sandbox");
    const secondMessages = mock.calls[1]?.body.messages as Array<{
      role?: string;
      content?: unknown;
    }>;
    const toolMessage = secondMessages.find((m) => m.role === "tool");
    assert.match(String(toolMessage?.content ?? ""), /escapes workspace boundary/);
  } finally {
    mock.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tool loop stops at the iteration cap instead of looping forever", async () => {
  const dir = tmpDir();
  const workspace = path.join(dir, "scene_blocks");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "a.md"), "x");
  // Every response asks for another read — the cap must break the cycle.
  const mock = installScriptedFetch([{ toolCalls: [{ id: "c", name: "read", args: { path: "a.md" } }] }]);
  try {
    const runner = makeRunner(baseConfig(dir), true);
    const result = await runner.run({ prompt: "p", taskId: "t", workspaceDir: workspace });
    assert.equal(result, ""); // scripted turns carry no text content
    assert.equal(mock.calls.length, 21, "exactly MAX_TOOL_ITERATIONS + 1 POSTs");
  } finally {
    mock.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tool-less runner never executes hallucinated tool_calls (L1 path)", async () => {
  const dir = tmpDir();
  const workspace = path.join(dir, "scene_blocks");
  fs.mkdirSync(workspace, { recursive: true });
  const mock = installScriptedFetch([
    { content: "extracted", toolCalls: [{ id: "c1", name: "write", args: { path: "x.md", content: "nope" } }] },
  ]);
  try {
    const runner = makeRunner(baseConfig(dir), false);
    const result = await runner.run({ prompt: "p", taskId: "l1-extraction", workspaceDir: workspace });
    assert.equal(result, "extracted");
    assert.equal(mock.calls.length, 1, "no follow-up POST");
    assert.equal(mock.calls[0]?.body.tools, undefined, "tools must be omitted from the request");
    assert.equal(fs.existsSync(path.join(workspace, "x.md")), false, "no file side effects");
  } finally {
    mock.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("executeFileTool reports invalid JSON arguments without throwing", async () => {
  const dir = tmpDir();
  try {
    const result = await executeFileTool("read", "{not json", dir);
    assert.match(result, /not valid JSON/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── L3 failure backoff ───────────────────────────────────────────────────────

test("failing L3 run backs off instead of re-triggering after every L2", async () => {
  const noop = () => {};
  const manager = new MemoryPipelineManager(
    {
      everyNConversations: 1,
      enableWarmup: false,
      l1: { idleTimeoutSeconds: 3600 },
      l2: { delayAfterL1Seconds: 0, minIntervalSeconds: 0, maxIntervalSeconds: 99_999, sessionActiveWindowHours: 24 },
    },
    { debug: noop, info: noop, warn: noop, error: noop }
  );

  let l3Runs = 0;
  let l2Runs = 0;
  manager.setL1Runner(async () => ({ processedCount: 1 }));
  manager.setL2Runner(async () => {
    l2Runs += 1;
    return {};
  });
  manager.setL3Runner(async () => {
    l3Runs += 1;
    return { ok: false };
  });
  manager.setPersister(async () => {});

  const message: CapturedMessage = {
    role: "user",
    content: "hello",
    timestamp: new Date().toISOString(),
  };

  try {
    manager.start({});
    // Round 1: L1 → L2 → L3 runs once and fails → backoff armed (30 min).
    await manager.notifyConversation("s1", [message]);
    await sleep(80);
    assert.equal(l3Runs, 1, "L3 must have run exactly once");
    assert.equal(l2Runs, 1);

    // Round 2: L1 and L2 flow again, but L3 stays suppressed by backoff.
    await manager.notifyConversation("s1", [message]);
    await sleep(80);
    assert.equal(l2Runs, 2, "L2 must keep flowing — the suppression is L3-specific");
    assert.equal(l3Runs, 1, "L3 must NOT re-run during backoff");
  } finally {
    await manager.destroy();
  }
  assert.equal(l3Runs, 1, "destroy-flush must not bypass the backoff either");
});

// ── PersonaGenerator × tool-loop integration ─────────────────────────────────

test("PersonaGenerator end-to-end: the model writes persona.md through the tool loop", async () => {
  const dir = tmpDir();
  const personaBody = "# 用户画像\n\n- Alice 偏好 TypeScript\n- 常在下午写代码\n";
  const mock = installScriptedFetch([
    {
      toolCalls: [
        {
          id: "c1",
          name: "write",
          args: { path: "persona.md", content: personaBody },
        },
      ],
    },
    { content: "persona written" },
  ]);
  try {
    const { PersonaGenerator } = await import("../tdai/core/persona/persona-generator.js");
    const generator = new PersonaGenerator({
      dataDir: dir,
      config: null,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      llmRunner: makeRunner(baseConfig(dir), true),
    });
    const ok = await generator.generateLocalPersona("cold-start");
    assert.equal(ok, true, "generation must succeed when the LLM writes persona.md via tools");

    const written = fs.readFileSync(path.join(dir, "persona.md"), "utf-8");
    assert.ok(written.includes("Alice 偏好 TypeScript"), "persona content survives post-processing");
    // workspaceDir for the L3 call is the dataDir itself — a write aimed at
    // the same file through `../` must never succeed (belt-and-braces: the
    // sandbox only ever resolves inside dataDir).
    assert.equal(fs.existsSync(path.join(dir, "..", "persona.md")), false);
  } finally {
    mock.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── adversarial-review fixes: allowlist + read cap ──────────────────────────

test("allowedFiles hardens the L3 sandbox: persona.md yes, vectors.db never", async () => {
  const dir = tmpDir();
  const mock = installScriptedFetch([
    {
      // Prompt-injected instruction: clobber the sqlite store.
      toolCalls: [{ id: "c1", name: "write", args: { path: "vectors.db", content: "garbage" } }],
    },
    { toolCalls: [{ id: "c2", name: "write", args: { path: "persona.md", content: "ok" } }] },
    { content: "done" },
  ]);
  try {
    const runner = makeRunner(baseConfig(dir), true);
    const result = await runner.run({
      prompt: "p",
      taskId: "persona-generation",
      workspaceDir: dir,
      allowedFiles: ["persona.md"],
    });
    assert.equal(result, "done");
    assert.equal(fs.existsSync(path.join(dir, "vectors.db")), false, "store must be untouchable");
    assert.equal(fs.readFileSync(path.join(dir, "persona.md"), "utf-8"), "ok", "allowlisted file writable");
    // The refused call's error must be fed back to the model as a tool message.
    const refusal = (mock.calls[1]?.body.messages as Array<{ role?: string; content?: string }>).find(
      (m) => m.role === "tool" && m.content?.includes("vectors.db")
    );
    assert.ok(refusal, "refusal reported back to the model");
    assert.match(String(refusal?.content), /not in the allowed file list/);
  } finally {
    mock.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("read tool truncates oversized files instead of flooding the context", async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "big.md"), "x".repeat(300 * 1024));
  try {
    const result = await executeFileTool("read", JSON.stringify({ path: "big.md" }), dir);
    assert.ok(result.length < 300 * 1024, "output must be capped");
    assert.match(result, /256KB/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
