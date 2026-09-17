/**
 * Experimental AI SDK transport channel (specs/model-fleet-adaptation §七 /
 * X2.1 — user decision 2026-09-17, default OFF via settings.experimentalSdkTransport).
 *
 * Strategy — synthesize, don't duplicate: this channel consumes the AI SDK
 * `streamText` full stream and re-emits it as OpenAI-wire-shaped streaming
 * chunks (LlmTransportChunk). The session manager's existing reduce loop —
 * local token accounting, progress emission, reasoning-field replay
 * reassembly, tool-call stitching, dirge scavenging — then runs UNCHANGED
 * over the synthetic chunks. Parity with the default channel is structural
 * (battery B2), not re-implemented.
 *
 * Request mapping: known OpenAI body keys map onto streamText options; every
 * other top-level key (the family thinking envelope `thinking` /
 * `extra_body.reasoning_effort`, `response_format`, …) is forwarded verbatim
 * through providerOptions.<name> — the openai-compatible provider spreads
 * unknown provider-option keys into the request body unchanged (X2.3).
 *
 * Errors: streamText folds ALL failures (including create-phase connect/4xx)
 * into the stream as `error` parts; they are re-thrown from the synthetic
 * iterator mapped onto the shape classifyLlmError() reads (status /
 * error.error.message), so classification and auto-recovery keep working
 * (X2.5, battery B5). Consequence: the session manager's debug log always
 * attributes transport failures to the ":stream" phase on this channel —
 * the phase distinction is informational only, recovery keys on category.
 *
 * Known parity deltas (documented, accepted):
 * - OpenAI's nonstandard `refusal` delta is NOT modeled by the
 *   openai-compatible provider (zero occurrences in its dist) — the reduce
 *   loop handles absence (refusal stays null). No DeepSeek-family model
 *   emits refusals; revisit only if a registered family needs it.
 * - The legacy provider-ignored-`stream:true` fallback never triggers here:
 *   the openai-compatible provider always speaks SSE. A provider answering
 *   200 + plain JSON fails with the SDK's "ended without a finish reason"
 *   error instead of the legacy silent-empty result — louder is fine.
 * - The idle watchdog also bounds the connect phase (the first fetch happens
 *   lazily inside the stream), so a very slow connect classifies as TIMEOUT
 *   and gets the same single auto-retry a mid-stream stall would.
 */

import { streamText, jsonSchema } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent, fetch as undiciFetch } from "undici";
import { openAIToModelMessages } from "./model-message-adapter";
import { resolveCurrentSettings } from "../settings";
import type { LlmTransportChannel, LlmTransportChunk, LlmTransportStream } from "./llm-transport";

// Same keep-alive policy as openai-client.ts: the default global fetch keeps
// connections alive for only 4s — far too short between user prompts.
const keepAliveAgent = new Agent({ keepAliveTimeout: 180_000 });

/** providerOptions namespace; also the provider `name`. */
const PROVIDER_KEY = "deeporca";

type CompatibleProvider = ReturnType<typeof createOpenAICompatible>;

// Production provider cache keyed apiKey::baseURL (mirrors the openai-client
// factories). Test fetch overrides bypass the cache on purpose.
const providerCache = new Map<string, CompatibleProvider>();

function productionFetch(url: unknown, init: unknown): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return undiciFetch(url as any, { ...(init as any), dispatcher: keepAliveAgent }) as unknown as Promise<unknown>;
}

type TransportFetch = (url: unknown, init: unknown) => Promise<unknown>;

function getProvider(apiKey: string, baseURL: string, fetchOverride?: TransportFetch): CompatibleProvider {
  if (fetchOverride) {
    return createOpenAICompatible({
      name: PROVIDER_KEY,
      apiKey,
      baseURL,
      includeUsage: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetch: fetchOverride as any,
    });
  }
  const cacheKey = `${apiKey}::${baseURL}`;
  const cached = providerCache.get(cacheKey);
  if (cached) return cached;
  const provider = createOpenAICompatible({
    name: PROVIDER_KEY,
    apiKey,
    baseURL,
    includeUsage: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetch: productionFetch as any,
  });
  providerCache.set(cacheKey, provider);
  return provider;
}

/** Body keys consumed by mapped streamText options (never forwarded raw). */
const MAPPED_BODY_KEYS = new Set([
  "model",
  "messages",
  "tools",
  "tool_choice",
  "temperature",
  "top_p",
  "max_tokens",
  "max_completion_tokens",
  "stop",
  "presence_penalty",
  "frequency_penalty",
  "seed",
  "stream",
  "stream_options",
  // NOTE: `reasoning_effort` (StepFun-family top-level effort) is handled by
  // a dedicated remap branch in the split loop below — it must map to the
  // provider's camelCase option (reasoningEffort) or the provider's literal
  // `reasoning_effort:` assignment clobbers the verbatim spread with
  // undefined. Do NOT add it to this set.
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** OpenAI tools[] → AI SDK tool record (JSON Schema passed through verbatim). */
function toAiTools(
  rawTools: unknown
): Record<string, { description?: string; inputSchema: ReturnType<typeof jsonSchema> }> {
  const tools: Record<string, { description?: string; inputSchema: ReturnType<typeof jsonSchema> }> = {};
  if (!Array.isArray(rawTools)) return tools;
  for (const entry of rawTools) {
    if (!isRecord(entry)) continue;
    const fn = isRecord(entry.function) ? entry.function : null;
    const name = fn ? asString(fn.name) : undefined;
    if (!name) continue;
    tools[name] = {
      ...(fn && asString(fn.description) !== undefined ? { description: fn.description as string } : {}),
      inputSchema: jsonSchema(isRecord(fn?.parameters) ? fn.parameters : { type: "object", properties: {} }),
    };
  }
  return tools;
}

/** tool_choice: literal forms pass through; object form remaps to AI SDK shape. */
function toAiToolChoice(value: unknown): "auto" | "none" | "required" | { type: "tool"; toolName: string } | undefined {
  if (value === "auto" || value === "none" || value === "required") return value;
  if (isRecord(value) && value.type === "function" && isRecord(value.function)) {
    const name = asString(value.function.name);
    if (name) return { type: "tool", toolName: name };
  }
  return undefined;
}

/**
 * Map an AI SDK LanguageModelUsage onto the OpenAI usage chunk shape.
 * `raw` (the provider's original usage object, preserved verbatim by the
 * openai-compatible schema) carries vendor-nonstandard fields — DeepSeek's
 * `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` are forwarded so
 * the session manager's existing cache-merge (base.ts localUsageWithApiCache)
 * keeps its full fidelity on the experimental channel too.
 */
function toOpenAIUsage(usage: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  inputTokenDetails?: { cacheReadTokens?: number | undefined } | undefined;
  outputTokenDetails?: { reasoningTokens?: number | undefined } | undefined;
  raw?: Record<string, unknown> | undefined;
}): Record<string, unknown> {
  const inputTokens = asNumber(usage.inputTokens) ?? 0;
  const outputTokens = asNumber(usage.outputTokens) ?? 0;
  const cacheRead = asNumber(usage.inputTokenDetails?.cacheReadTokens);
  const reasoning = asNumber(usage.outputTokenDetails?.reasoningTokens);
  const rawCacheHit = usage.raw ? asNumber(usage.raw.prompt_cache_hit_tokens) : undefined;
  const rawCacheMiss = usage.raw ? asNumber(usage.raw.prompt_cache_miss_tokens) : undefined;
  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: asNumber(usage.totalTokens) ?? inputTokens + outputTokens,
    ...(cacheRead !== undefined ? { prompt_tokens_details: { cached_tokens: cacheRead } } : {}),
    ...(reasoning !== undefined ? { completion_tokens_details: { reasoning_tokens: reasoning } } : {}),
    ...(rawCacheHit !== undefined ? { prompt_cache_hit_tokens: rawCacheHit } : {}),
    ...(rawCacheMiss !== undefined ? { prompt_cache_miss_tokens: rawCacheMiss } : {}),
  };
}

/**
 * Re-throw an AI SDK stream error with the fields classifyLlmError() reads:
 * `status` (from APICallError.statusCode) and `error.error.message` (from the
 * provider response body, where vendor quota/context texts live). RetryError
 * wrappers unwrap to their last underlying error; errors wrapped by the SDK's
 * response pipeline (statusCode 200 "failed to process successful response")
 * drill down the cause chain to the real provider status. The original error
 * is preserved as `cause`.
 */
function mapAiSdkError(error: unknown): Error {
  if (error instanceof Error && (error.name === "AbortError" || error.constructor.name === "APIUserAbortError")) {
    return error;
  }
  const record = isRecord(error) ? error : {};
  // RetryError (AI_RetryError): carry the LAST attempt's provider error.
  if (Array.isArray(record.errors) && record.errors.length > 0) {
    return mapAiSdkError(record.errors[record.errors.length - 1]);
  }
  const statusCode = asNumber(record.statusCode) ?? asNumber(record.status);
  // The SDK wraps body-processing failures of otherwise-successful responses
  // as statusCode-200 errors with the original as cause — drill down when the
  // cause carries a real status or is itself a RetryError-shaped wrapper, so
  // a mid-stream 4xx/5xx keeps its real status.
  if (statusCode !== undefined && statusCode < 400 && isRecord(record.cause)) {
    const cause = record.cause as Record<string, unknown>;
    const causeStatus = asNumber(cause.statusCode) ?? asNumber(cause.status);
    const causeIsRetry = Array.isArray(cause.errors) && cause.errors.length > 0;
    if ((causeStatus !== undefined && causeStatus >= 400) || causeIsRetry) {
      return mapAiSdkError(cause);
    }
  }
  const responseBody = asString(record.responseBody);
  const message =
    asString(record.message) ?? (typeof error === "string" ? error : undefined) ?? "AI SDK transport request failed";
  const bodySlice = responseBody ? responseBody.slice(0, 2000) : undefined;
  const mapped = new Error(bodySlice ? `${message}: ${bodySlice}` : message);
  mapped.name = typeof record.name === "string" && record.name ? record.name : "APICallError";
  if (statusCode !== undefined) {
    (mapped as { status?: number }).status = statusCode;
  }
  if (bodySlice) {
    (mapped as { error?: { message?: string } }).error = { message: bodySlice };
  }
  (mapped as { cause?: unknown }).cause = error;
  return mapped;
}

function abortError(): Error {
  const error = new Error("Request was aborted.");
  error.name = "AbortError";
  return error;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "{}";
  } catch {
    return "{}";
  }
}

/** A usage record worth forwarding: at least one finite token count. */
function usageHasTotals(usage: Record<string, unknown>): boolean {
  return (
    asNumber(usage.inputTokens) !== undefined ||
    asNumber(usage.outputTokens) !== undefined ||
    asNumber(usage.totalTokens) !== undefined
  );
}

/**
 * Extract the endpoint credentials the transport needs from an already
 * configured OpenAI SDK client instance (both are public instance fields).
 * Used by the session manager at the dispatch seam so the experimental
 * channel reuses the exact endpoint resolution (primary/secondary/endpoint/
 * vision factories) the legacy channel uses.
 */
export function readOpenAIClientEndpoint(client: { apiKey?: unknown; baseURL?: unknown }): {
  apiKey: string | undefined;
  baseURL: string | undefined;
} {
  return {
    apiKey: typeof client.apiKey === "string" ? client.apiKey : undefined,
    baseURL: typeof client.baseURL === "string" ? client.baseURL : undefined,
  };
}

/**
 * The experimental transport channel (satisfies LlmTransportChannel — locked
 * by a compile-time assertion in ai-sdk-transport.test.ts). Credential and
 * model-shape problems throw from this promise; transport failures (connect,
 * HTTP errors) surface from the returned iterator as mapped errors —
 * streamText resolves synchronously and folds them into `error` parts (see
 * the channel header note on phase attribution).
 */
export const runAiSdkChatCompletionStream: LlmTransportChannel = async (request, context) => {
  const apiKey = context.apiKey;
  const baseURL = context.baseURL;
  if (!apiKey || !baseURL) {
    throw new Error("AI SDK transport requires an endpoint with apiKey and baseURL.");
  }
  const model = asString(request.model);
  if (!model) {
    throw new Error("AI SDK transport requires a model string.");
  }

  const provider = getProvider(apiKey, baseURL, context.fetch);

  // Split the request body: mapped keys → streamText options, everything
  // else (family thinking envelope, response_format, user, …) → verbatim
  // providerOptions passthrough onto the wire body.
  const extras: Record<string, unknown> = {};
  let reasoningEffort: unknown;
  for (const [key, value] of Object.entries(request)) {
    if (MAPPED_BODY_KEYS.has(key) || value === undefined) {
      continue;
    }
    if (key === "reasoning_effort") {
      // StepFun-family top-level effort: the provider knows this key only as
      // the camelCase option `reasoningEffort` (its option schema), and its
      // literal `reasoning_effort:` assignment would otherwise clobber the
      // verbatim spread with undefined — remap, don't forward (StepFun bug).
      reasoningEffort = value;
      continue;
    }
    extras[key] = value;
  }

  const tools = toAiTools(request.tools);
  const toolChoice = toAiToolChoice(request.tool_choice);
  const stop = request.stop;
  const stopSequences = typeof stop === "string" ? [stop] : Array.isArray(stop) ? (stop as string[]) : undefined;

  const result = streamText({
    model: provider(model),
    messages: openAIToModelMessages(request.messages),
    // v7 default hoists system messages into a merged `instructions` option,
    // which would destroy MID-conversation system messages (task-recall
    // hints, task-lineage, skill messages — session-manager-persistence) and
    // the byte-stability of the leading system block (prefix-cache lever).
    // allowSystemInMessages keeps them in place, positionally, as separate
    // wire messages — exactly the legacy channel's shape.
    allowSystemInMessages: true,
    ...(Object.keys(tools).length > 0
      ? { tools, ...(toolChoice !== undefined ? { toolChoice } : {}) }
      : // tool_choice without tools is a contract violation on both channels.
        {}),
    ...(asNumber(request.temperature) !== undefined ? { temperature: asNumber(request.temperature) } : {}),
    ...(asNumber(request.top_p) !== undefined ? { topP: asNumber(request.top_p) } : {}),
    ...(asNumber(request.max_tokens) !== undefined
      ? { maxOutputTokens: asNumber(request.max_tokens) }
      : asNumber(request.max_completion_tokens) !== undefined
        ? { maxOutputTokens: asNumber(request.max_completion_tokens) }
        : {}),
    ...(stopSequences ? { stopSequences } : {}),
    ...(asNumber(request.presence_penalty) !== undefined
      ? { presencePenalty: asNumber(request.presence_penalty) }
      : {}),
    ...(asNumber(request.frequency_penalty) !== undefined
      ? { frequencyPenalty: asNumber(request.frequency_penalty) }
      : {}),
    ...(asNumber(request.seed) !== undefined ? { seed: asNumber(request.seed) } : {}),
    // Extras come from the request body as unknown JSON-ish values; the SDK
    // types provider options as JSONObject — a targeted cast keeps everything
    // else in this object literal type-checked. reasoningEffort rides the
    // same namespace as a RECOGNIZED option (camelCase) so the provider
    // writes it back onto the wire.
    ...(Object.keys(extras).length > 0 || reasoningEffort !== undefined
      ? ({
          providerOptions: {
            [PROVIDER_KEY]: { ...(reasoningEffort !== undefined ? { reasoningEffort } : {}), ...extras },
          },
        } as { providerOptions: NonNullable<Parameters<typeof streamText>[0]>["providerOptions"] })
      : {}),
    // Zero transport-level retries — parity with the legacy channel (L1):
    // retry/recovery policy belongs to the session manager's auto-recovery.
    maxRetries: 0,
    abortSignal: context.signal,
  });

  return synthesizeChunks(result.stream);
};

/**
 * Map the AI SDK full stream onto OpenAI-wire chunks. Tool-call streaming
 * state: `tool-input-start` assigns the OpenAI index and announces id+name;
 * argument deltas append; a terminal `tool-call` part without prior deltas
 * (non-streaming providers) emits the complete call in one chunk.
 */
function synthesizeChunks(stream: AsyncIterable<{ type: string }>): LlmTransportStream {
  return (async function* () {
    const indexByToolCallId = new Map<string, number>();
    const streamedToolCallIds = new Set<string>();
    let nextIndex = 0;
    let lastStepUsage: Record<string, unknown> | undefined;

    const toolCallChunk = (delta: Record<string, unknown>): LlmTransportChunk => ({ choices: [{ delta }] });

    try {
      for await (const part of stream) {
        const chunk = part as Record<string, unknown>;
        switch (part.type) {
          case "text-delta": {
            const text = asString(chunk.text);
            if (text !== undefined && text.length > 0) {
              yield toolCallChunk({ content: text });
            }
            break;
          }
          case "reasoning-delta": {
            const text = asString(chunk.text);
            if (text !== undefined && text.length > 0) {
              // Emit under the canonical reasoning field — every family's
              // reasoningReadFields chain starts with reasoning_content.
              yield toolCallChunk({ reasoning_content: text });
            }
            break;
          }
          case "tool-input-start": {
            const id = asString(chunk.id);
            const toolName = asString(chunk.toolName);
            if (!id) break;
            const index = nextIndex;
            nextIndex += 1;
            indexByToolCallId.set(id, index);
            streamedToolCallIds.add(id);
            yield toolCallChunk({
              tool_calls: [
                {
                  index,
                  id,
                  type: "function",
                  function: { name: toolName ?? "", arguments: "" },
                },
              ],
            });
            break;
          }
          case "tool-input-delta": {
            const id = asString(chunk.id);
            const delta = asString(chunk.delta);
            const index = id ? indexByToolCallId.get(id) : undefined;
            if (id && index !== undefined && delta !== undefined && delta.length > 0) {
              yield toolCallChunk({ tool_calls: [{ index, function: { arguments: delta } }] });
            }
            break;
          }
          case "tool-call": {
            const toolCallId = asString(chunk.toolCallId);
            const toolName = asString(chunk.toolName) ?? "";
            if (!toolCallId || streamedToolCallIds.has(toolCallId)) break;
            const index = indexByToolCallId.get(toolCallId) ?? nextIndex;
            if (!indexByToolCallId.has(toolCallId)) {
              nextIndex += 1;
              indexByToolCallId.set(toolCallId, index);
            }
            streamedToolCallIds.add(toolCallId);
            yield toolCallChunk({
              tool_calls: [
                {
                  index,
                  id: toolCallId,
                  type: "function",
                  function: { name: toolName, arguments: safeStringify(chunk.input) },
                },
              ],
            });
            break;
          }
          case "finish-step": {
            const usage = chunk.usage as Record<string, unknown> | undefined;
            if (isRecord(usage) && usageHasTotals(usage)) {
              lastStepUsage = usage;
            }
            break;
          }
          case "finish": {
            // Emit once, on finish (last-wins parity with the legacy reduce,
            // which overwrites usage on every chunk). Totals come from the
            // finish aggregate; vendor-nonstandard usage fields (DeepSeek's
            // prompt_cache_hit_tokens …) ride only the per-step record's raw
            // payload, so merge that under the totals. A provider that omits
            // usage yields the SDK's null-usage record (no finite numbers) —
            // skipping it keeps response.usage null like the legacy channel
            // instead of masking with zeros.
            const totals = chunk.totalUsage as Record<string, unknown> | undefined;
            const base = isRecord(totals) && usageHasTotals(totals) ? totals : lastStepUsage;
            if (!base) {
              break;
            }
            const raw = isRecord(lastStepUsage?.raw) ? lastStepUsage?.raw : undefined;
            yield {
              choices: [],
              usage: toOpenAIUsage({ ...(base as Parameters<typeof toOpenAIUsage>[0]), ...(raw ? { raw } : {}) }),
            };
            break;
          }
          case "error": {
            throw mapAiSdkError(chunk.error);
          }
          case "abort": {
            throw abortError();
          }
          default:
            break; // start/start-step/text-start|end/reasoning-start|end/raw …
        }
      }
    } catch (error) {
      // Body-processing failures reject the ITERATOR directly (the SDK wraps
      // them as statusCode-200 APICallErrors with the original as cause) —
      // run them through the same mapping as `error` parts so classification
      // sees the real provider status.
      throw mapAiSdkError(error);
    }
  })();
}

/**
 * Non-streaming one-shot completion for the standalone LLM surfaces (D3:
 * edit-handler's reasoner/corrector, the vision MCP tools) — the same
 * experimental-flag dispatch as the session chokepoint, minus the session.
 *
 * flag OFF  → the injected OpenAI SDK client issues the request (byte-for-
 *             byte today's behavior; the caller keeps its error semantics).
 * flag ON   → the experimental channel streams synthetic chunks, which are
 *             reduced here into one message. Low-frequency repair paths, so
 *             a compact reducer (content/reasoning/tool_calls/usage) is fine.
 *
 * The flag is read fresh from the resolved settings for `projectRoot` —
 * matching the chokepoint's per-request read. Accounting stays with the
 * caller surfaces (these paths predate the ledger and keep their own
 * semantics).
 */
export async function runStandaloneChatCompletion(input: {
  client: unknown;
  request: Record<string, unknown>;
  projectRoot?: string;
}): Promise<{ message: Record<string, unknown>; usage: Record<string, unknown> | null }> {
  const experimental = resolveCurrentSettings(input.projectRoot).experimentalSdkTransport === true;
  if (!experimental) {
    const client = input.client as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chat?: { completions?: { create?: (b: Record<string, unknown>) => Promise<any> } };
    };
    // Call CHAINED, never via an extracted reference — the OpenAI SDK's
    // resource methods need `this` (`this._client`); a detached `create`
    // throws "Cannot read properties of undefined (reading '_client')"
    // (real-machine T2 finding on the vision readback path).
    if (typeof client.chat?.completions?.create !== "function") {
      throw new Error("standalone completion requires an OpenAI SDK client");
    }
    const response = await client.chat.completions.create!(input.request);
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      message: ((response as any)?.choices?.[0]?.message ?? {}) as Record<string, unknown>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      usage: ((response as any)?.usage ?? null) as Record<string, unknown> | null,
    };
  }

  const { apiKey, baseURL } = readOpenAIClientEndpoint(input.client as Record<string, unknown>);
  const stream = await runAiSdkChatCompletionStream(
    input.request as unknown as Parameters<typeof runAiSdkChatCompletionStream>[0],
    { apiKey, baseURL }
  );

  let content = "";
  let reasoning = "";
  let usage: Record<string, unknown> | null = null;
  const toolCalls = new Map<number, { id?: string; type?: string; function?: { name?: string; arguments?: string } }>();
  for await (const chunk of stream) {
    if (chunk.usage != null) usage = chunk.usage as Record<string, unknown>;
    for (const choice of (chunk.choices as Array<{ delta?: Record<string, unknown> }>) ?? []) {
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string") content += delta.content;
      const reasoningDelta = (delta.reasoning_content ?? delta.reasoning) as unknown;
      if (typeof reasoningDelta === "string") reasoning += reasoningDelta;
      for (const call of (delta.tool_calls as Array<Record<string, unknown>>) ?? []) {
        const index = typeof call.index === "number" ? call.index : toolCalls.size;
        const current = toolCalls.get(index) ?? {};
        if (typeof call.id === "string") current.id = call.id;
        if (typeof call.type === "string") current.type = call.type;
        const fn = isRecord(call.function) ? call.function : null;
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

  const message: Record<string, unknown> = { content };
  const stitched = Array.from(toolCalls.entries())
    .sort(([a], [b]) => a - b)
    .map(([, v]) => v);
  if (stitched.length > 0) message.tool_calls = stitched;
  if (reasoning.length > 0) message.reasoning_content = reasoning;
  return { message, usage };
}
