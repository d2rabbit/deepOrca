// Transport batteries B2/B3/B5/B6 (specs/model-fleet-adaptation §七) for the
// experimental AI SDK channel. A mock fetch captures the request body and
// feeds fixture SSE, so the full stack runs for real: streamText →
// openai-compatible parsing → synthetic OpenAI chunk mapping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAiSdkChatCompletionStream } from "../common/ai-sdk-transport";
import type { LlmTransportChannel } from "../common/llm-transport";
import { withStreamIdleTimeout } from "../session-stream";
import { classifyLlmError } from "../common/llm-error";
import { resolveSettings, resolveSettingsSources } from "../settings";

// X1.0 port conformance: the experimental channel implements the shared
// transport port (compile-time assertion — the shared request type is what
// battery B2 exercises both channels through).
runAiSdkChatCompletionStream satisfies LlmTransportChannel;

// ── Mock fetch plumbing ─────────────────────────────────────────────────────

type CapturedRequest = { url: unknown; body: Record<string, unknown> };

function sseResponse(
  chunks: unknown[],
  options?: {
    stallAfter?: number;
    /** Fail the stream with this error once the data is consumed. */
    failWith?: unknown;
  }
): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const stallAfter = options?.stallAfter ?? Number.POSITIVE_INFINITY;
  // A stalled ReadableStream holds no event-loop handle, so the (unref'd)
  // watchdog timer would never fire before the loop drains. In stall mode a
  // ref'd no-op interval keeps the loop alive; cancel() clears it once the
  // watchdog rejection unwinds the consumer.
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = () => {
        if (index >= chunks.length) {
          if (options?.failWith !== undefined) {
            controller.error(options.failWith);
            return;
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        if (index >= stallAfter) {
          keepAlive = setInterval(() => {}, 1e9);
          return; // no more data — idle-watchdog battery (B6)
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunks[index])}\n\n`));
        index += 1;
        push();
      };
      push();
    },
    cancel() {
      if (keepAlive) clearInterval(keepAlive);
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Fixture SSE: reasoning → text → streamed tool call → usage. */
const FIXTURE_CHUNKS: unknown[] = [
  { id: "c0", choices: [{ delta: { role: "assistant" } }] },
  { id: "c0", choices: [{ delta: { reasoning_content: "think " } }] },
  { id: "c0", choices: [{ delta: { reasoning_content: "hard" } }] },
  { id: "c0", choices: [{ delta: { content: "Hello" } }] },
  { id: "c0", choices: [{ delta: { content: " world" } }] },
  {
    id: "c0",
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "bash", arguments: "" } }],
        },
      },
    ],
  },
  { id: "c0", choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"command"' } }] } }] },
  { id: "c0", choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"ls"}' } }] } }] },
  { id: "c0", choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  {
    id: "c0",
    choices: [],
    usage: {
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
      prompt_tokens_details: { cached_tokens: 4 },
      completion_tokens_details: { reasoning_tokens: 3 },
      // DeepSeek nonstandard cache fields — the provider's loose schema keeps
      // them in LanguageModelUsage.raw; toOpenAIUsage forwards them so the
      // session manager's cache merge keeps full fidelity (X2.4/B4.1).
      prompt_cache_hit_tokens: 4,
      prompt_cache_miss_tokens: 7,
    },
  },
];

const REQUEST_BODY = {
  model: "deepseek-v4-pro",
  messages: [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: "prior",
      reasoning_content: "stored reasoning",
      tool_calls: [{ id: "call_prev", type: "function", function: { name: "bash", arguments: '{"command":"pwd"}' } }],
    },
    { role: "tool", tool_call_id: "call_prev", content: '{"ok":true}' },
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "bash",
        description: "run",
        parameters: { type: "object", properties: { command: { type: "string" } } },
      },
    },
  ],
  temperature: 0.2,
  // Family thinking envelope (top-level request keys → verbatim passthrough, X2.3).
  thinking: { type: "enabled" },
  extra_body: { reasoning_effort: "high" },
} as unknown as Parameters<typeof runAiSdkChatCompletionStream>[0];

async function collectStream(stream: AsyncIterable<Record<string, unknown>>): Promise<Record<string, unknown>[]> {
  const chunks: Record<string, unknown>[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

/** Miniature replica of the session manager's reduce loop (chokepoint). */
function reduceChunks(chunks: Array<Record<string, unknown>>) {
  let content = "";
  let reasoning = "";
  const toolCalls = new Map<number, { id?: string; function?: { name?: string; arguments?: string } }>();
  let usage: Record<string, unknown> | null = null;
  for (const chunk of chunks) {
    if (chunk.usage != null) usage = chunk.usage as Record<string, unknown>;
    for (const choice of (chunk.choices as Array<{ delta?: Record<string, unknown> }>) ?? []) {
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string") content += delta.content;
      const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoningDelta === "string") reasoning += reasoningDelta;
      for (const call of (delta.tool_calls as Array<Record<string, unknown>>) ?? []) {
        const index = typeof call.index === "number" ? call.index : toolCalls.size;
        const current = toolCalls.get(index) ?? {};
        if (typeof call.id === "string") current.id = call.id;
        const fn = call.function as Record<string, unknown> | undefined;
        if (fn) {
          current.function = current.function ?? {};
          if (typeof fn.name === "string") current.function.name = `${current.function.name ?? ""}${fn.name}`;
          if (typeof fn.arguments === "string") {
            current.function.arguments = `${current.function.arguments ?? ""}${fn.arguments}`;
          }
        }
        toolCalls.set(index, current);
      }
    }
  }
  return {
    content,
    reasoning,
    toolCalls: Array.from(toolCalls.entries())
      .sort(([a], [b]) => a - b)
      .map(([, v]) => v),
    usage,
  };
}

// ── B2: reduce parity with the fixture parsed directly as OpenAI chunks ────

test("B2 synthetic chunks reduce to the same result as the raw OpenAI fixture", async () => {
  const captured: CapturedRequest[] = [];
  const fetchMock = async (url: unknown, init: { body?: string }): Promise<Response> => {
    captured.push({ url, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
    return sseResponse(FIXTURE_CHUNKS);
  };

  const stream = await runAiSdkChatCompletionStream(REQUEST_BODY, {
    apiKey: "test-key",
    baseURL: "https://api.example.test/v1",
    fetch: fetchMock,
  });
  const synthetic = await collectStream(stream as AsyncIterable<Record<string, unknown>>);
  const viaTransport = reduceChunks(synthetic);
  const viaFixture = reduceChunks(FIXTURE_CHUNKS as Array<Record<string, unknown>>);

  assert.deepEqual(viaTransport.content, viaFixture.content);
  assert.deepEqual(viaTransport.reasoning, viaFixture.reasoning);
  assert.deepEqual(viaTransport.toolCalls, viaFixture.toolCalls);
  assert.deepEqual(viaTransport.usage, viaFixture.usage);
  assert.equal(viaTransport.content, "Hello world");
  assert.equal(viaTransport.reasoning, "think hard");
  assert.deepEqual(viaTransport.toolCalls, [
    { id: "call_1", function: { name: "bash", arguments: '{"command":"ls"}' } },
  ]);
  assert.equal((viaTransport.usage as { prompt_tokens: number }).prompt_tokens, 11);
  assert.equal(
    ((viaTransport.usage as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details ?? {})
      .cached_tokens,
    4
  );
  // DeepSeek nonstandard cache fields survive the round-trip (X2.4 direct-through).
  assert.equal((viaTransport.usage as { prompt_cache_hit_tokens?: number }).prompt_cache_hit_tokens, 4);
  assert.equal((viaTransport.usage as { prompt_cache_miss_tokens?: number }).prompt_cache_miss_tokens, 7);
});

// ── B3: request determinism + envelope passthrough (X2.3) ──────────────────

test("B3 identical requests produce byte-identical bodies; thinking envelope passes through", async () => {
  const captured: CapturedRequest[] = [];
  const fetchMock = async (url: unknown, init: { body?: string }): Promise<Response> => {
    captured.push({ url, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
    return sseResponse(FIXTURE_CHUNKS);
  };
  const context = {
    apiKey: "test-key",
    baseURL: "https://api.example.test/v1",
    fetch: fetchMock,
  };
  await collectStream(
    (await runAiSdkChatCompletionStream(REQUEST_BODY, context)) as AsyncIterable<Record<string, unknown>>
  );
  await collectStream(
    (await runAiSdkChatCompletionStream(REQUEST_BODY, context)) as AsyncIterable<Record<string, unknown>>
  );

  assert.equal(captured.length, 2);
  const first = JSON.stringify(captured[0]?.body);
  const second = JSON.stringify(captured[1]?.body);
  assert.equal(first, second);

  const body = captured[0]!.body;
  // Thinking envelope forwarded verbatim (X2.3: providerOptions passthrough).
  assert.deepEqual(body.thinking, { type: "enabled" });
  assert.deepEqual(body.extra_body, { reasoning_effort: "high" });
  // includeUsage parity with the legacy channel.
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(body.model, "deepseek-v4-pro");
  assert.equal(body.temperature, 0.2);
  // Tools survive the JSON-Schema passthrough.
  assert.equal((body.tools as Array<{ function: { name: string } }>)[0]?.function.name, "bash");
  // Translated message chain preserves the replayed reasoning + tool pairing.
  const messages = body.messages as Array<Record<string, unknown>>;
  assert.equal(messages.length, 4);
  const replayed = messages[2] as Record<string, unknown>;
  assert.equal(replayed.role, "assistant");
  assert.equal(replayed.reasoning_content, "stored reasoning");
});

// ── B5: error mapping feeds classifyLlmError unchanged ─────────────────────

test("B5 429 responses surface as RATE_LIMIT through classifyLlmError", async () => {
  const fetchMock = async (): Promise<Response> => jsonResponse(429, { error: { message: "Too many requests" } });
  const stream = await runAiSdkChatCompletionStream(REQUEST_BODY, {
    apiKey: "k",
    baseURL: "https://api.example.test/v1",
    fetch: fetchMock,
  });
  await assert.rejects(collectStream(stream as AsyncIterable<Record<string, unknown>>), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 429);
    assert.equal(classifyLlmError(error), "RATE_LIMIT");
    return true;
  });
});

test("B5 401 responses surface as AUTH", async () => {
  const fetchMock = async (): Promise<Response> => jsonResponse(401, { error: { message: "Invalid key" } });
  const stream = await runAiSdkChatCompletionStream(REQUEST_BODY, {
    apiKey: "k",
    baseURL: "https://api.example.test/v1",
    fetch: fetchMock,
  });
  await assert.rejects(collectStream(stream as AsyncIterable<Record<string, unknown>>), (error: unknown) => {
    assert.equal(classifyLlmError(error), "AUTH");
    return true;
  });
});

test("B5 pre-aborted signal rejects with an abort-like error", async () => {
  const fetchMock = async (): Promise<Response> => sseResponse(FIXTURE_CHUNKS);
  const controller = new AbortController();
  controller.abort();
  const stream = await runAiSdkChatCompletionStream(REQUEST_BODY, {
    apiKey: "k",
    baseURL: "https://api.example.test/v1",
    fetch: fetchMock,
    signal: controller.signal,
  });
  await assert.rejects(collectStream(stream as AsyncIterable<Record<string, unknown>>), (error: unknown) => {
    const name = (error as Error).name;
    const ctor = (error as object).constructor.name;
    assert.ok(name === "AbortError" || ctor === "APIUserAbortError", `unexpected abort error shape: ${name}/${ctor}`);
    return true;
  });
});

// ── B6: idle watchdog composes with the synthetic stream ───────────────────

test("B6 withStreamIdleTimeout trips on a stalling synthetic stream", async () => {
  const fetchMock = async (): Promise<Response> => sseResponse(FIXTURE_CHUNKS, { stallAfter: 1 }); // first chunk only, then silence
  const stream = await runAiSdkChatCompletionStream(REQUEST_BODY, {
    apiKey: "k",
    baseURL: "https://api.example.test/v1",
    fetch: fetchMock,
  });
  const watched = withStreamIdleTimeout(stream, 80);
  await assert.rejects(
    (async () => {
      for await (const _chunk of watched) {
        // consume until the watchdog trips
      }
    })(),
    (error: unknown) => {
      assert.equal((error as Error).name, "LlmStreamIdleTimeoutError");
      assert.equal(classifyLlmError(error), "TIMEOUT");
      return true;
    }
  );
});

// ── X0.2 settings resolution: default off, user/env on, project excluded ───

const SETTINGS_DEFAULTS = { model: "deepseek-v4-pro", baseURL: "https://api.deepseek.test" };

test("experimentalSdkTransport defaults to false and never reads project sources", () => {
  // Default: nothing configured anywhere.
  assert.equal(resolveSettings(null, SETTINGS_DEFAULTS, {}).experimentalSdkTransport, false);

  // User settings enable it.
  assert.equal(
    resolveSettingsSources({ experimentalSdkTransport: true }, null, SETTINGS_DEFAULTS, {}).experimentalSdkTransport,
    true
  );

  // System env enables it (DEEPORCA_EXPERIMENTAL_SDK_TRANSPORT).
  assert.equal(
    resolveSettingsSources(null, null, SETTINGS_DEFAULTS, { DEEPORCA_EXPERIMENTAL_SDK_TRANSPORT: "1" })
      .experimentalSdkTransport,
    true
  );

  // User env (settings-file env block) enables it.
  assert.equal(
    resolveSettingsSources({ env: { EXPERIMENTAL_SDK_TRANSPORT: "1" } }, null, SETTINGS_DEFAULTS, {})
      .experimentalSdkTransport,
    true
  );

  // PROJECT settings and env CANNOT enable it (structural quarantine).
  assert.equal(
    resolveSettingsSources(null, { experimentalSdkTransport: true }, SETTINGS_DEFAULTS, {
      DEEPORCA_PROJECT_EXPERIMENTAL_SDK_TRANSPORT: "1",
    }).experimentalSdkTransport,
    false
  );
});

// ── X2.5 extensions: mid-stream 500, RetryError unwrap, option mapping ─────

test("B5 mid-stream stream failure keeps the real provider status (cause drill-down)", async () => {
  // The SDK wraps body-processing failures of successful responses as
  // statusCode-200 APICallErrors with the original as cause — the mapping
  // must drill down or a mid-stream 5xx classifies as UNKNOWN.
  const fetchMock = async (): Promise<Response> =>
    sseResponse([{ id: "c0", choices: [{ delta: { content: "par" } }] }], {
      failWith: { name: "AI_APICallError", message: "boom", statusCode: 500, responseBody: "internal" },
    });
  const stream = await runAiSdkChatCompletionStream(REQUEST_BODY, {
    apiKey: "k",
    baseURL: "https://api.example.test/v1",
    fetch: fetchMock,
  });
  await assert.rejects(collectStream(stream as AsyncIterable<Record<string, unknown>>), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 500);
    assert.equal(classifyLlmError(error), "SERVER");
    return true;
  });
});

test("B5 RetryError wrapper unwraps to the last provider attempt", async () => {
  // Defensive: with maxRetries:0 the channel itself never produces a
  // RetryError, but the unwrap keeps the mapping total for wrapped shapes.
  const fetchMock = async (): Promise<Response> =>
    sseResponse([], {
      failWith: {
        name: "AI_RetryError",
        message: "Failed after 3 attempts",
        errors: [
          { name: "AI_APICallError", message: "attempt one", statusCode: 500 },
          { name: "AI_APICallError", message: "Too many requests", statusCode: 429, responseBody: "quota" },
        ],
      },
    });
  const stream = await runAiSdkChatCompletionStream(REQUEST_BODY, {
    apiKey: "k",
    baseURL: "https://api.example.test/v1",
    fetch: fetchMock,
  });
  await assert.rejects(collectStream(stream as AsyncIterable<Record<string, unknown>>), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 429);
    assert.equal(classifyLlmError(error), "RATE_LIMIT");
    return true;
  });
});

test("option mapping: forced tool_choice and max_completion_tokens reach the wire", async () => {
  const captured: CapturedRequest[] = [];
  // Fixture ends with a real bash tool call — a forced tool_choice with a
  // non-calling stream would trip the SDK's ToolChoiceViolationError.
  const fetchMock = async (url: unknown, init: { body?: string }): Promise<Response> => {
    captured.push({ url, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
    return sseResponse(FIXTURE_CHUNKS);
  };
  await collectStream(
    (await runAiSdkChatCompletionStream(
      {
        ...REQUEST_BODY,
        max_completion_tokens: 4096,
        tool_choice: { type: "function", function: { name: "bash" } },
      } as typeof REQUEST_BODY,
      { apiKey: "k", baseURL: "https://api.example.test/v1", fetch: fetchMock }
    )) as AsyncIterable<Record<string, unknown>>
  );
  const body = captured[0]!.body;
  // AI SDK tool_choice {type:'tool',toolName} → OpenAI wire shape.
  assert.deepEqual(body.tool_choice, { type: "function", function: { name: "bash" } });
  // maxOutputTokens maps back to the OpenAI max_tokens body key.
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.max_completion_tokens, undefined, "raw max_completion_tokens key is never forwarded");
});

test("F1 system position: multiple system messages keep their conversation positions", async () => {
  const captured: CapturedRequest[] = [];
  const fetchMock = async (url: unknown, init: { body?: string }): Promise<Response> => {
    captured.push({ url, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
    return sseResponse(FIXTURE_CHUNKS);
  };
  await collectStream(
    (await runAiSdkChatCompletionStream(
      {
        ...REQUEST_BODY,
        messages: [
          { role: "system", content: "leading block" },
          { role: "user", content: "hi" },
          { role: "system", content: "<task-recall-hints>mid hint</task-recall-hints>" },
          { role: "user", content: "go on" },
        ],
      } as typeof REQUEST_BODY,
      { apiKey: "k", baseURL: "https://api.example.test/v1", fetch: fetchMock }
    )) as AsyncIterable<Record<string, unknown>>
  );
  const wire = (captured[0]!.body.messages ?? []) as Array<{ role: string; content: string }>;
  assert.deepEqual(
    wire.map((m) => ({ role: m.role, content: m.content })),
    [
      { role: "system", content: "leading block" },
      { role: "user", content: "hi" },
      { role: "system", content: "<task-recall-hints>mid hint</task-recall-hints>" },
      { role: "user", content: "go on" },
    ]
  );
});

test("StepFun top-level reasoning_effort remaps through the provider option (not clobbered)", async () => {
  const captured: CapturedRequest[] = [];
  const fetchMock = async (url: unknown, init: { body?: string }): Promise<Response> => {
    captured.push({ url, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
    return sseResponse(FIXTURE_CHUNKS);
  };
  await collectStream(
    (await runAiSdkChatCompletionStream({ ...REQUEST_BODY, reasoning_effort: "low" } as typeof REQUEST_BODY, {
      apiKey: "k",
      baseURL: "https://api.example.test/v1",
      fetch: fetchMock,
    })) as AsyncIterable<Record<string, unknown>>
  );
  // The provider writes the recognized camelCase option back onto the wire.
  assert.equal(captured[0]!.body.reasoning_effort, "low");
});
