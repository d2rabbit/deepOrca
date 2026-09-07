/**
 * CMB-4 (specs/cmb-adoption batch D): auxiliary LLM call contract.
 *
 * Pins:
 *   - applyAuxSchema / auxEnumSchema truth tables (shape / enum / unparseable);
 *   - judgeViaLlm retry semantics: content-level failures retry within
 *     AUX_CONTENT_RETRY_BUDGET, transport-level failures never retry;
 *   - completeTextViaLlm: schema-less = legacy single-shot string behavior,
 *     with schema = same content-budget contract.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { applyAuxSchema, auxEnumSchema, AUX_CONTENT_RETRY_BUDGET } from "../common/aux-llm-contract";
import { SessionManager } from "../session";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aux-contract-"));
}

type Harness = {
  manager: SessionManager;
  calls: number[];
  outputs: string[];
};

/** SessionManager with the two LLM seams stubbed; each call shifts one canned
 *  output ("THROW" = transport error). Records the attempt count. */
function createHarness(): Harness {
  const calls: number[] = [];
  const outputs: string[] = [];
  const manager = new SessionManager({
    projectRoot: tempRoot(),
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text: string) => text,
    onAssistantMessage: () => {},
  });
  const stub = manager as unknown as Record<string, unknown>;
  stub.createBackgroundLlm = () => ({ client: {}, model: "m", baseURL: "https://x", debugLogEnabled: false });
  stub.createOpenAIClient = () => ({ client: {}, model: "m", baseURL: "https://x", debugLogEnabled: false });
  stub.createChatCompletionStream = async () => {
    calls.push(1);
    const content = outputs.shift();
    if (content === "THROW") throw new Error("transport boom");
    return { choices: [{ message: { content } }] };
  };
  return { manager, calls, outputs };
}

async function judge(manager: SessionManager, prompt: string, choices: string[]): Promise<string | null> {
  return (manager as unknown as { judgeViaLlm: (p: string, c: string[]) => Promise<string | null> }).judgeViaLlm(
    prompt,
    choices
  );
}

async function complete(
  manager: SessionManager,
  messages: Array<{ role: "system" | "user"; content: string }>,
  opts?: { schema?: { describe: string; validate: (parsed: unknown) => unknown } }
): Promise<unknown> {
  return (
    manager as unknown as {
      completeTextViaLlm: (
        m: Array<{ role: "system" | "user"; content: string }>,
        o?: { schema?: unknown }
      ) => Promise<unknown>;
    }
  ).completeTextViaLlm(messages, opts);
}

// ── pure contract helpers ───────────────────────────────────────────────────

test("CMB-4: applyAuxSchema truth table — parse failure, shape failure, success", () => {
  const schema = {
    describe: "number",
    validate: (parsed: unknown) => (typeof parsed === "number" ? parsed : null),
  };
  assert.deepEqual(applyAuxSchema("not json", schema), { ok: false });
  assert.deepEqual(applyAuxSchema('{"v":1}', schema), { ok: false });
  assert.deepEqual(applyAuxSchema("42", schema), { ok: true, value: 42 });
});

test("CMB-4: applyAuxSchema strips markdown code fences before parsing", () => {
  const schema = {
    describe: "number",
    validate: (parsed: unknown) => (typeof parsed === "number" ? parsed : null),
  };
  assert.deepEqual(applyAuxSchema("```json\n42\n```", schema), { ok: true, value: 42 });
  assert.deepEqual(applyAuxSchema("```\n42\n```", schema), { ok: true, value: 42 });
  assert.deepEqual(applyAuxSchema('```json\n{"v":1}\n```', schema), { ok: false }); // fence stripped, shape still wrong
});

test("CMB-4: auxEnumSchema accepts members and rejects everything else", () => {
  const schema = auxEnumSchema(["express", "deep"] as const);
  assert.deepEqual(applyAuxSchema('"deep"', schema), { ok: true, value: "deep" });
  assert.deepEqual(applyAuxSchema('"DEEP"', schema), { ok: false }); // case-sensitive
  assert.deepEqual(applyAuxSchema('"other"', schema), { ok: false });
  assert.deepEqual(applyAuxSchema("null", schema), { ok: false });
  assert.equal(AUX_CONTENT_RETRY_BUDGET, 2);
});

// ── retry semantics on the primitives ───────────────────────────────────────

test("CMB-4: judgeViaLlm retries content-level garbage within budget, then succeeds", async () => {
  const h = createHarness();
  h.outputs.push("total garbage", '{"choice": "a"}');
  assert.equal(await judge(h.manager, "pick", ["a", "b"]), "a");
  assert.equal(h.calls.length, 2);
});

test("CMB-4: judgeViaLlm exhausts the content budget and fails open to null", async () => {
  const h = createHarness();
  h.outputs.push("garbage", "garbage", "garbage");
  assert.equal(await judge(h.manager, "pick", ["a", "b"]), null);
  assert.equal(h.calls.length, 1 + AUX_CONTENT_RETRY_BUDGET);
});

test("CMB-4: judgeViaLlm never retries transport-level failures", async () => {
  const h = createHarness();
  h.outputs.push("THROW");
  assert.equal(await judge(h.manager, "pick", ["a", "b"]), null);
  assert.equal(h.calls.length, 1);
});

test("CMB-4: completeTextViaLlm without schema keeps legacy single-shot string behavior", async () => {
  const h = createHarness();
  h.outputs.push("plain answer");
  assert.equal(await complete(h.manager, [{ role: "user", content: "hi" }]), "plain answer");
  assert.equal(h.calls.length, 1);
});

test("CMB-4: completeTextViaLlm with a schema applies the content budget", async () => {
  const h = createHarness();
  const numberSchema = {
    describe: "number",
    validate: (parsed: unknown) => (typeof parsed === "number" ? parsed : null),
  };
  h.outputs.push("nope", "7");
  assert.equal(await complete(h.manager, [{ role: "user", content: "hi" }], { schema: numberSchema }), 7);
  assert.equal(h.calls.length, 2);

  h.outputs.push("nope", "nope", "nope");
  assert.equal(await complete(h.manager, [{ role: "user", content: "hi" }], { schema: numberSchema }), null);
  assert.equal(h.calls.length, 2 + 1 + AUX_CONTENT_RETRY_BUDGET);
});
