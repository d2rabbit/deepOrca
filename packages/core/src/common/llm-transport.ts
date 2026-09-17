/**
 * LLM transport port types (specs/model-fleet-adaptation §七 / X1.0).
 *
 * The mechanism ("verb") abstraction over LLM transports — the counterpart of
 * the semantic ("noun") abstraction in model-capabilities.ts. The registry
 * NAMES things (which fields carry reasoning, how to replay it); this module
 * SHAPES the transport contract both channels implement:
 *
 *   transport layer → { this port, the registry }   (dependency direction)
 *   this port       → (type-only) SDK message types
 *   the registry    → nothing (stays renderer-bundleable)
 *
 * Placement rules (spec red line L1 / §2.0):
 * - MAIN-PROCESS-INTERNAL module: may `import type` from `openai`/`ai`, and
 *   must NEVER be exported through the `@deeporca/core/capabilities` subpath
 *   nor imported by model-capabilities.ts.
 * - Both channels (the default OpenAI SDK path in session-manager-base.ts and
 *   the experimental AI SDK path in ai-sdk-transport.ts) satisfy
 *   `LlmTransportChannel`, locked by a compile-time assertion in the
 *   ai-sdk-transport tests (battery B2 uses the shared request type).
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/**
 * A single synthetic or native streaming chunk in OpenAI chat-completions
 * wire shape — the exact shape the session manager's reduce loop consumes
 * (content / reasoning_content / refusal / tool_calls deltas + trailing
 * usage). Keeping this structurally identical to OpenAI SDK chunks is what
 * lets the experimental channel reuse the ENTIRE existing reduce semantics
 * (accounting, progress, dirge scavenging, final-message reassembly) without
 * duplication.
 */
export type LlmTransportChunk = {
  choices?: Array<{ delta?: Record<string, unknown> } & Record<string, unknown>>;
  usage?: Record<string, unknown> | null;
} & Record<string, unknown>;

/** The stream a transport channel yields; wrapped by withStreamIdleTimeout. */
export type LlmTransportStream = AsyncIterable<LlmTransportChunk>;

/** Per-call transport context (credentials + cancellation + test seam). */
export type LlmTransportContext = {
  apiKey: string | undefined;
  baseURL: string | undefined;
  /** Cancellation signal carried by the legacy channel's `options` argument. */
  signal?: AbortSignal | undefined;
  /**
   * Fetch override (tests only — batteries B2/B3/B5/B6 inject a mock fetch to
   * capture request bodies and feed fixture SSE). Production leaves this
   * undefined so the shared undici keep-alive agent is used.
   */
  fetch?: ((url: unknown, init: unknown) => Promise<unknown>) | undefined;
};

/**
 * The transport channel contract: takes the OpenAI-wire-shaped request body
 * the session manager already builds (messages, tools, thinking envelope —
 * all merged top-level, exactly what the default channel sends) and returns
 * the chunk stream. Create-phase failures throw from the returned promise;
 * mid-stream failures throw from the iterator.
 */
export type LlmTransportChannel = (
  request: LlmTransportRequestBody,
  context: LlmTransportContext
) => Promise<LlmTransportStream>;

/**
 * The request body shape shared by both channels. Kept as a loose record on
 * purpose: the engine merges family-specific keys (thinking envelope:
 * `thinking` / `extra_body` / `reasoning_effort`) top-level before the
 * chokepoint, and the transports forward them verbatim.
 */
export type LlmTransportRequestBody = {
  model: string;
  messages: ChatCompletionMessageParam[];
  tools?: unknown[];
  tool_choice?: unknown;
  temperature?: number;
} & Record<string, unknown>;
