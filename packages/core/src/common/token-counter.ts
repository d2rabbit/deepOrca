// Family-routed local token counting — the single source of every token
// number the engine produces for itself (P0/P1 of the token-statistics
// rework, 2026-09): pre-flight context budgeting, compaction stage-A
// projection, the streaming progress badge, and the local usage ledger.
//
// Policy (user directive 2026-09-02): local counting is the ONLY accounting
// source — API-returned usage is not consulted for statistics. Accuracy
// therefore equals tokenizer fidelity: the deepseek family gets exact BPE
// counts once the tokenizer warms up; every other family (and the warmup
// window itself) falls back to the unified heuristic below. All consumers
// treat results as estimates.
//
// Loading follows the embedding-loader pattern: dynamic import, fail-open,
// no console.* — a missing or broken tokenizer degrades to the heuristic
// without ever touching the LLM request path.

import { resolveModelSpec } from "./model-capabilities";

/** Chat-template overhead folded onto every message (kept from the original
 *  compaction estimator; families can tune this later via the registry). */
export const PER_MESSAGE_TOKEN_OVERHEAD = 12;

/** Multimodal image parts are counted at this fixed size — local counting
 *  cannot know a provider's image patching math. */
export const IMAGE_PART_TOKENS = 1024;

const isCjkCodePoint = (code: number): boolean =>
  (code >= 0x4e00 && code <= 0x9fff) ||
  (code >= 0x3000 && code <= 0x30ff) ||
  (code >= 0xff00 && code <= 0xffef) ||
  (code >= 0xac00 && code <= 0xd7af);

/**
 * The ONE heuristic for the whole engine (previously two estimators with
 * divergent coefficients lived in compaction.ts and session-manager-base.ts).
 * CJK code points count ~1 token each (they tokenize far denser than the
 * 4-chars-per-token ASCII approximation); deliberately biased high for
 * unknown families — compacting early is safe, blowing the window is not.
 */
export function estimateTextTokensHeuristic(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (isCjkCodePoint(ch.codePointAt(0) ?? 0)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return cjk + Math.ceil(other / 4);
}

// ── deepseek exact path (fail-open) ──────────────────────────────────────────

/** The tokenizer instance is callable: tok(text, {add_special_tokens}) → {input_ids}. */
type CountableTokenizer = (
  text: string,
  options: { add_special_tokens: boolean }
) => { input_ids: number[] | number[][] };

let warmTokenizer: CountableTokenizer | null = null;
let tokenizerLoad: Promise<CountableTokenizer | null> | null = null;

/**
 * Warm the local tokenizer for models whose family ships one. Fire-and-forget
 * at the call site (the chokepoint never awaits it); returns the load promise
 * so tests can await an exact-path assertion. Cheap no-op for every other
 * family and after the first call. Until the load resolves, countTextTokens
 * uses the heuristic for that family too.
 */
export function warmTokenCounter(model: string): Promise<void> {
  if (resolveModelSpec({ model }).id !== "deepseek") {
    return Promise.resolve();
  }
  if (!tokenizerLoad) {
    tokenizerLoad = (async () => {
      try {
        const mod = await import("@tlibnx/tokenizer-deepseek_v4");
        const tokenizer = await mod.fromPreTrained();
        const callable = tokenizer as unknown as CountableTokenizer;
        const probe = callable("warmup", { add_special_tokens: false });
        if (!Array.isArray(probe?.input_ids)) {
          return null;
        }
        return callable;
      } catch {
        return null; // fail-open: heuristic keeps serving this process
      }
    })();
    void tokenizerLoad.then(
      (tokenizer) => {
        warmTokenizer = tokenizer;
      },
      () => {
        warmTokenizer = null;
      }
    );
  }
  return tokenizerLoad.then(() => undefined);
}

// Value-keyed memo: conversation strings are stable across loop iterations
// (they come from the session message cache), so only fresh content pays the
// counting cost. Holds string references — no copies.
const countCache = new Map<string, number>();
const COUNT_CACHE_MAX = 2048;

function cacheStore(text: string, value: number): void {
  if (countCache.size >= COUNT_CACHE_MAX) {
    const oldest = countCache.keys().next().value;
    if (oldest !== undefined) {
      countCache.delete(oldest);
    }
  }
  countCache.set(text, value);
}

function exactCountIfWarm(text: string): number | null {
  if (!warmTokenizer) {
    return null;
  }
  const cached = countCache.get(text);
  if (cached !== undefined) {
    return cached;
  }
  let value: number | null = null;
  try {
    const ids = warmTokenizer(text, { add_special_tokens: false }).input_ids;
    if (Array.isArray(ids)) {
      value = ids.length;
    }
  } catch {
    value = null; // not cached — retried after the next warmup
  }
  if (value === null) {
    return null;
  }
  cacheStore(text, value);
  return value;
}

function heuristicCountCached(text: string): number {
  const cached = countCache.get(text);
  if (cached !== undefined) {
    return cached;
  }
  const value = estimateTextTokensHeuristic(text);
  cacheStore(text, value);
  return value;
}

/** Exact for the deepseek family (once warmed), heuristic everywhere else. */
export function countTextTokens(model: string, text: string): number {
  if (text.length === 0) {
    return 0;
  }
  if (resolveModelSpec({ model }).id === "deepseek") {
    const exact = exactCountIfWarm(text);
    if (exact !== null) {
      return exact;
    }
  }
  return heuristicCountCached(text);
}

// ── payload-level counting ───────────────────────────────────────────────────

type CountableMessage = {
  role?: unknown;
  content?: unknown;
  messageParams?: unknown;
  tool_calls?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** tool_calls arguments used to be invisible to the old estimator; for
 *  agent transcripts they are often the bulk of an assistant message. */
function countToolCalls(model: string, message: CountableMessage): number {
  const calls = Array.isArray(message.tool_calls)
    ? (message.tool_calls as unknown[])
    : Array.isArray((message.messageParams as { tool_calls?: unknown } | null | undefined)?.tool_calls)
      ? ((message.messageParams as { tool_calls?: unknown }).tool_calls as unknown[])
      : [];
  let tokens = 0;
  for (const raw of calls) {
    if (!isRecord(raw)) {
      continue;
    }
    const fn = isRecord(raw.function) ? raw.function : null;
    if (fn && typeof fn.name === "string") {
      tokens += countTextTokens(model, fn.name);
    }
    const args = fn?.arguments;
    if (typeof args === "string") {
      tokens += countTextTokens(model, args);
    } else if (args != null) {
      tokens += countTextTokens(model, JSON.stringify(args));
    }
  }
  return tokens;
}

function countMessageContent(model: string, content: unknown): number {
  if (typeof content === "string") {
    return countTextTokens(model, content);
  }
  if (Array.isArray(content)) {
    let tokens = 0;
    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }
      if (part.type === "text" && typeof part.text === "string") {
        tokens += countTextTokens(model, part.text);
      } else if (part.type === "image_url" || part.type === "image") {
        tokens += IMAGE_PART_TOKENS;
      } else {
        tokens += countTextTokens(model, JSON.stringify(part));
      }
    }
    return tokens;
  }
  return content == null ? 0 : countTextTokens(model, JSON.stringify(content));
}

/** Persisted conversation shape (SessionMessage / CompactionMessage): content
 *  + tool_calls + per-message overhead. Replaces the old estimator in
 *  compaction.ts — same role, now tool-call aware and family routed. */
export function countConversationTokens(
  model: string,
  messages: ReadonlyArray<{ role: string; content: string | null; messageParams?: unknown }>
): number {
  let tokens = 0;
  for (const message of messages) {
    tokens += countMessageContent(model, message.content);
    tokens += countToolCalls(model, message as CountableMessage);
    tokens += PER_MESSAGE_TOKEN_OVERHEAD;
  }
  return tokens;
}

/** The exact request shape about to hit the wire: messages (incl. the system
 *  prompt chain and multimodal parts) plus the tool definitions — the same
 *  payload Claude-Code-style context meters count, and the number the
 *  pre-flight budget decision reads. */
export function countRequestPayloadTokens(model: string, request: { messages?: unknown; tools?: unknown }): number {
  let tokens = 0;
  const messages = Array.isArray(request.messages) ? (request.messages as unknown[]) : [];
  for (const raw of messages) {
    if (!isRecord(raw)) {
      continue;
    }
    const message = raw as CountableMessage;
    tokens += countMessageContent(model, message.content);
    tokens += countToolCalls(model, message);
    tokens += PER_MESSAGE_TOKEN_OVERHEAD;
  }
  if (request.tools != null) {
    tokens += countTextTokens(model, JSON.stringify(request.tools) ?? "");
  }
  return tokens;
}

/** Completion side of a finished response: content + reasoning + refusal +
 *  emitted tool calls, counted over the accumulated text (never per-delta —
 *  BPE boundaries make per-chunk counting wrong). */
export function countCompletionTokens(
  model: string,
  completion: {
    content: string;
    reasoning: string;
    refusal: string | null;
    toolCalls: ReadonlyArray<{ function?: { name?: string; arguments?: string } }> | null;
  }
): number {
  let tokens = 0;
  if (completion.content.length > 0) {
    tokens += countTextTokens(model, completion.content);
  }
  if (completion.reasoning.length > 0) {
    tokens += countTextTokens(model, completion.reasoning);
  }
  if (completion.refusal != null && completion.refusal.length > 0) {
    tokens += countTextTokens(model, completion.refusal);
  }
  for (const call of completion.toolCalls ?? []) {
    const fn = call?.function;
    if (typeof fn?.name === "string") {
      tokens += countTextTokens(model, fn.name);
    }
    if (typeof fn?.arguments === "string") {
      tokens += countTextTokens(model, fn.arguments);
    }
  }
  return tokens;
}
