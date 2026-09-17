// Transport dispatch seam (specs/model-fleet-adaptation §七 X2.2): the
// off-path invariance assertion the spec requires EXPLICITLY — with
// `experimentalSdkTransport` unset, requests flow through the injected
// OpenAI client and NEVER reach the experimental channel; with it set, the
// reverse. Runs end-to-end against a local SSE HTTP server (no network
// mocks in the experimental path), so fetch/undici/streamText/the FULL
// production reduce loop all run for real. The fixture carries reasoning
// and streamed tool-call deltas so the reduce's reassembled message is
// asserted, not just plain text.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import { SessionManager } from "../session";
import { getUserConfigRoot } from "../common/app-dirs";
import { usageLedgerPath } from "../common/usage-ledger";
import { resolveSettings, resolveSettingsSources } from "../settings";
import { registerSessionTestCleanup, setHomeDir } from "./session-test-utils";

// Ledger isolation: appendAccounting writes to ~/.deeporca/... on EVERY call
// — without a temp HOME these tests would pollute the developer's real
// usage ledger. registerSessionTestCleanup restores HOME afterwards.
registerSessionTestCleanup();
setHomeDir(fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-dispatch-")));

class TestableManager extends SessionManager {
  // Expose the protected chokepoint for the dispatch assertions.
  callStream(client: unknown, request: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown> {
    return this.createChatCompletionStream(client as never, request, options);
  }
}

const DEFAULTS = { model: "deepseek-v4-pro", baseURL: "https://api.example.test" };

type Harness = {
  manager: TestableManager;
  legacyClient: unknown;
  legacyCalls: Array<{ body: Record<string, unknown> }>;
  serverHits: () => number;
  capturedBodies: () => Array<Record<string, unknown>>;
  close: () => Promise<void>;
};

/**
 * Legacy client spy + local SSE server; fresh per subtest. The SSE stream
 * carries the full delta vocabulary the reduce loop consumes — reasoning,
 * streamed tool-call arguments, finish_reason, usage — so the on-path
 * assertions cover the assembled message, not just plain text.
 */
async function makeHarness(enableExperimental: boolean): Promise<Harness> {
  const legacyCalls: Array<{ body: Record<string, unknown> }> = [];
  const capturedBodies: Array<Record<string, unknown>> = [];
  let serverHits = 0;

  const server = http.createServer((req, res) => {
    serverHits += 1;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        capturedBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch {
        // probe requests (models.list warmup) may carry no body — ignore
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
      send({ choices: [{ delta: { role: "assistant" } }] });
      send({ choices: [{ delta: { reasoning_content: "thinking " } }] });
      send({ choices: [{ delta: { reasoning_content: "hard" } }] });
      send({ choices: [{ delta: { content: "sdk says hi" } }] });
      send({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "bash", arguments: "" } }],
            },
          },
        ],
      });
      send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"command":"ls"}' } }] } }] });
      send({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
      send({
        choices: [],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 3,
          total_tokens: 8,
          prompt_cache_hit_tokens: 2,
        },
      });
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const port = (server.address() as AddressInfo).port;

  const legacyClient = {
    chat: {
      completions: {
        // Non-streaming fallback shape (no asyncIterator) — the legacy
        // channel's documented provider-ignored-stream:true fallback, so the
        // spy result flows straight through the reduce.
        create: async (body: Record<string, unknown>) => {
          legacyCalls.push({ body });
          return {
            choices: [{ message: { content: "legacy says hi" } }],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
          };
        },
      },
    },
    apiKey: "test-key",
    baseURL: `http://127.0.0.1:${port}/v1`,
  };

  const manager = new TestableManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () =>
      ({
        client: legacyClient,
        model: "deepseek-v4-pro",
        baseURL: `http://127.0.0.1:${port}/v1`,
        thinkingEnabled: false,
      }) as never,
    getResolvedSettings: () => ({ model: "deepseek-v4-pro", experimentalSdkTransport: enableExperimental }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  return {
    manager,
    legacyClient,
    legacyCalls,
    serverHits: () => serverHits,
    capturedBodies: () => capturedBodies,
    close: () => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())),
  };
}

const REQUEST = {
  model: "deepseek-v4-pro",
  messages: [
    { role: "system", content: "leading system block" },
    { role: "user", content: "hi" },
    // Mid-conversation system: task-recall hints / task-lineage ride here.
    // Positional preservation is the prefix-cache + hint-placement contract.
    { role: "system", content: "<task-recall-hints>prefer pnpm</task-recall-hints>" },
    { role: "assistant", content: "ok" },
    { role: "user", content: "go on" },
  ],
};

test("off path (default): legacy client serves the request; the experimental channel is never touched", async () => {
  const harness = await makeHarness(false);
  try {
    const response = (await harness.manager.callStream(harness.legacyClient, REQUEST)) as {
      choices?: Array<{ message?: { content?: string } }>;
      localUsage?: { total_tokens?: number };
    };
    assert.equal(harness.legacyCalls.length, 1, "legacy client called exactly once");
    assert.equal(harness.legacyCalls[0]?.body.stream, true, "legacy request keeps stream:true injection");
    assert.equal(
      (harness.legacyCalls[0]?.body.stream_options as Record<string, unknown> | undefined)?.include_usage,
      true
    );
    assert.equal(response.choices?.[0]?.message?.content, "legacy says hi");
    // localUsage is LOCALLY counted (the accounting source), not the API's 8 —
    // assert structure and positivity, not equality with the spy usage.
    assert.ok((response.localUsage?.total_tokens ?? 0) > 0, "local accounting intact on the legacy path");
    assert.ok((response.localUsage?.prompt_tokens ?? 0) > 0);
    assert.equal(harness.serverHits(), 0, "local SSE server saw ZERO requests");
  } finally {
    await harness.close();
  }
});

test("on path: experimental channel serves the request; the production reduce assembles reasoning + tools", async () => {
  const harness = await makeHarness(true);
  try {
    const response = (await harness.manager.callStream(harness.legacyClient, REQUEST)) as {
      choices?: Array<{ message?: Record<string, unknown> }>;
      usage?: { prompt_tokens?: number; prompt_cache_hit_tokens?: number };
      localUsage?: { total_tokens?: number };
    };
    assert.equal(harness.legacyCalls.length, 0, "legacy client NEVER called");
    assert.ok(harness.serverHits() >= 1, "local SSE server served the experimental channel");

    // Production reduce parity: the assembled message carries the replayed
    // reasoning under the family field and the stitched tool call.
    const message = response.choices?.[0]?.message ?? {};
    assert.equal(message.content, "sdk says hi");
    assert.equal(message.reasoning_content, "thinking hard");
    assert.deepEqual(message.tool_calls, [
      { id: "call_1", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } },
    ]);

    assert.equal(response.usage?.prompt_tokens, 5, "usage chunk mapped through");
    assert.equal(
      response.usage?.prompt_cache_hit_tokens,
      2,
      "DeepSeek nonstandard cache field survives usage.raw passthrough"
    );
    // Local counting identical in STRUCTURE across channels (value is locally
    // derived, not the API's number — see the off-path note).
    assert.ok((response.localUsage?.total_tokens ?? 0) > 0, "local accounting intact on the experimental path");

    // F1 (system position): the wire body keeps BOTH system messages, each at
    // its original index — the leading cache-stable block stays leading and
    // the mid-conversation hint stays at its decision point.
    const wireMessages = (harness.capturedBodies()[0]?.messages ?? []) as Array<{ role: string; content: string }>;
    assert.deepEqual(
      wireMessages.map((m) => ({ role: m.role, content: m.content })),
      [
        { role: "system", content: "leading system block" },
        { role: "user", content: "hi" },
        { role: "system", content: "<task-recall-hints>prefer pnpm</task-recall-hints>" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "go on" },
      ]
    );
  } finally {
    await harness.close();
  }
});

test("experimental-channel accounting lands in the (temp-HOME) usage ledger", async () => {
  const harness = await makeHarness(true);
  try {
    await harness.manager.callStream(harness.legacyClient, REQUEST);
    const ledgerFile = usageLedgerPath(getUserConfigRoot(), process.cwd());
    assert.ok(fs.existsSync(ledgerFile), "ledger file created");
    const lines = fs.readFileSync(ledgerFile, "utf8").trim().split("\n");
    const record = JSON.parse(lines[lines.length - 1] ?? "{}") as {
      source?: string;
      model?: string;
      apiUsage?: { prompt_tokens?: number };
    };
    assert.equal(record.source, "chat");
    assert.equal(record.model, "deepseek-v4-pro");
    assert.equal(record.apiUsage?.prompt_tokens, 5, "apiUsage merged from the mapped usage chunk");
  } finally {
    await harness.close();
  }
});

test("the dispatch flag reads exactly the resolved settings value (settings → seam contract)", () => {
  // Off-by-default is the settings layer's contract (locked in detail by the
  // settings cases in ai-sdk-transport.test.ts); assert the composite here so
  // the seam's input contract is explicit at this level too.
  assert.equal(resolveSettings(null, DEFAULTS, {}).experimentalSdkTransport, false);
  assert.equal(
    resolveSettingsSources(null, null, DEFAULTS, { DEEPORCA_EXPERIMENTAL_SDK_TRANSPORT: "true" })
      .experimentalSdkTransport,
    true
  );
});
