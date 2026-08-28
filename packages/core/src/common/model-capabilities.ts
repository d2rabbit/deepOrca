/**
 * Model family registry — the single source of truth for model-dependent
 * behavior: thinking defaults, multimodal support, context windows, background
 * task models, and the protocol keys used to dispatch thinking-request
 * construction and reasoning replay.
 *
 * HARD CONSTRAINT: this module must stay dependency-free (no Node built-ins,
 * no `openai` imports) so the desktop renderer can bundle it directly via the
 * `@deeporca/core/capabilities` subpath export.
 *
 * Family independence: every vendor lives in its own family entry (+ optional
 * exact-model overrides). Registering or editing one family never changes the
 * behavior of another family or of the UNKNOWN fallback.
 */

export type ModelFamilyId = "deepseek" | "stepfun" | "glm" | "kimi" | "minimax" | "qwen" | "unknown";

// Unified thinking-effort scale + per-family native mappings (think-level.ts).
// Only the symbols the renderer consumes are re-exported here — the
// dependency-free `@deeporca/core/capabilities` subpath stays the single
// renderer-facing entry; core-internal callers import from ./think-level.
export { THINK_LEVEL_ORDER, THINK_LEVELS, familyThinkLevels } from "./think-level";

/** How replayed assistant messages carry reasoning content. */
export type ReasoningReplayMode = "empty-field" | "omit" | "content";

/** Key into the per-family thinking-request builder table (openai-thinking.ts). */
export type ThinkingProtocolId = ModelFamilyId;

export type ModelFamilySpec = {
  id: ModelFamilyId;
  /** Primary resolution: patterns tested against the trimmed model string. */
  modelPatterns: RegExp[];
  /** Fallback resolution when the model string matches no family: hostname patterns. */
  baseURLHostHints?: RegExp[];
  /** Family default context window — also the compaction trigger threshold. */
  contextWindowTokens: number;
  defaultsToThinking: boolean;
  multimodal: boolean;
  /** Family "flash-equivalent" for background LLM tasks; undefined = no lightweight tier. */
  lightweightModel?: string;
  thinkingProtocol: ThinkingProtocolId;
  /** Field name used to persist and replay reasoning content. */
  reasoningField: string;
  /** Ordered streaming-delta fields to read reasoning from (nullish coalescing chain). */
  reasoningReadFields: string[];
  reasoningReplay: ReasoningReplayMode;
};

export type ModelSpec = ModelFamilySpec & {
  model: string;
  /** false when resolution fell through to the UNKNOWN fallback. */
  familyResolved: boolean;
};

/** User-declared per-model capabilities from an endpoint's `models[]` registration. */
export type ModelCapabilityRegistration = {
  thinking?: boolean;
  vision?: boolean;
};

/**
 * DeepSeek family. The family default is the product's DeepSeek compaction
 * trigger: 512K across the series (2026-08-28 product decision — the V4
 * models' established trigger; discontinued deepseek-chat/reasoner keep
 * resolving with the same value so existing settings stay consistent).
 * The known V4 models still override via MODEL_OVERRIDES key-for-key
 * (thinking defaults, multimodal) — matching the old DEEPSEEK_V4_MODELS /
 * NON_MULTIMODAL_MODELS sets. `deepseek-chat` / `deepseek-reasoner` stay
 * registered even though DeepSeek discontinued them (2026-07-24) so
 * existing settings keep resolving with their historical capabilities.
 */
const DEEPSEEK_FAMILY: ModelFamilySpec = {
  id: "deepseek",
  modelPatterns: [/^deepseek-/i],
  baseURLHostHints: [/^(.+\.)?api\.deepseek\.com$/i],
  contextWindowTokens: 512 * 1024,
  defaultsToThinking: false,
  multimodal: true,
  lightweightModel: "deepseek-v4-flash",
  thinkingProtocol: "deepseek",
  reasoningField: "reasoning_content",
  reasoningReadFields: ["reasoning_content", "reasoning"],
  reasoningReplay: "empty-field",
};

/**
 * Exact-model overrides within a family (keyed by the raw model string, no
 * trimming — same exact-match semantics as the old Sets). Used for per-variant
 * differences like thinking defaults or context windows.
 */
const MODEL_OVERRIDES: Record<string, Partial<ModelFamilySpec>> = {
  // Step Plan channel router (deepseek-v4-pro ↔ step-3.7-flash): images are
  // REJECTED server-side (unsupported_content_type) even though one route is
  // a vision model — the router itself never accepts multimodal input
  // (Chat Completions API doc, Step Plan channel field table).
  "step-router-v1": { multimodal: false },
  "deepseek-v4-flash": { defaultsToThinking: true, multimodal: false, contextWindowTokens: 512 * 1024 },
  "deepseek-v4-pro": { defaultsToThinking: true, multimodal: false, contextWindowTokens: 512 * 1024 },
  // Image-understanding experimental variant (2026-08-21 pricing page): thinking
  // defaults on like its siblings, but unlike them it IS multimodal — inherits
  // the family's `multimodal: true` by not overriding it. Compaction threshold
  // keeps the product's 512K V4 value (docs list a 1M window / 384K output;
  // 512K is the established trigger, not the raw window).
  "deepseek-v4-flash-vision-exp": {
    defaultsToThinking: true,
    contextWindowTokens: 512 * 1024,
  },
  "deepseek-chat": { multimodal: false },
  "deepseek-reasoner": { multimodal: false },
};

/**
 * StepFun family (step-3.7-flash, 2026-08-27 adaptation). First-party vision
 * model: natively multimodal (image AND video input), sparse-MoE 198B/11B,
 * 256K context. OpenAI-compatible `/v1/chat/completions` with streaming and
 * tool calls, plus an Anthropic-compatible `/v1/messages` we don't use (the
 * engine speaks the OpenAI protocol). Reasoning is ALWAYS on — the API's only
 * effort control is `reasoning_effort` low/medium/high (see the step thinking
 * builder) — so the family defaults to thinking mode and off projects to low.
 * Reasoning output streams in `delta.reasoning` (OpenAI-style — StepFun's
 * DEFAULT wire format per their reasoning best-practices page; the
 * `reasoning_content` DeepSeek-style field only appears behind an explicit
 * format param), which the read-fields chain covers while our canonical
 * persisted/UI field stays `reasoning_content` (the renderer's thinking
 * timeline and persistence read that key). Replay is "omit": unlike DeepSeek,
 * Step documents no requirement to resend the reasoning field on replayed
 * assistant messages, and an empty `reasoning_content` would be a FOREIGN
 * field a strict compatibility layer could reject — replaying nothing is the
 * universally accepted shape. No lightweight tier is registered: the
 * text-only sibling step-3.5-flash is NOT assumed to be served by the
 * endpoint, and a wrong-id background call would fail closed — backgrounds
 * run on secondary/primary instead. The pattern ^step- also covers the Step
 * Plan channel's step-router-v1 (routes deepseek-v4-pro ↔ step-3.7-flash)
 * and the text-only step-3.5-flash(-2603) — all served under the same family.
 */
const STEPFUN_FAMILY: ModelFamilySpec = {
  id: "stepfun",
  modelPatterns: [/^step-/i],
  baseURLHostHints: [/^(.+\.)?api\.stepfun\.com$/i],
  contextWindowTokens: 256 * 1024,
  defaultsToThinking: true,
  multimodal: true,
  thinkingProtocol: "stepfun",
  reasoningField: "reasoning_content",
  reasoningReadFields: ["reasoning_content", "reasoning"],
  reasoningReplay: "omit",
};

/**
 * First-class fallback for models that resolve to no family. Product default
 * compaction trigger is 200K (2026-08-28; was 128K). Every other value equals
 * the pre-registry behavior for unknown models: thinking off by default,
 * multimodal permitted, today's thinking-request shape, dual reasoning read
 * fields. Being a registry entry (not an implicit else) keeps those
 * semantics documented and test-locked.
 */
const UNKNOWN_FAMILY: ModelFamilySpec = {
  id: "unknown",
  modelPatterns: [],
  contextWindowTokens: 200 * 1024,
  defaultsToThinking: false,
  multimodal: true,
  thinkingProtocol: "unknown",
  reasoningField: "reasoning_content",
  reasoningReadFields: ["reasoning_content", "reasoning"],
  reasoningReplay: "empty-field",
};

/** Registered families. New vendors land here as one entry (plus overrides). */
const FAMILIES: readonly ModelFamilySpec[] = [DEEPSEEK_FAMILY, STEPFUN_FAMILY];

function hostnameOf(baseURL: string | undefined): string {
  if (!baseURL) return "";
  try {
    return new URL(baseURL).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * True when a baseURL points at StepFun's API host. Both channels — the
 * pay-as-you-go `…/v1` and the Step Plan subscription `…/step_plan/v1` —
 * share api.stepfun.com, so one hostname check gates the account-balance
 * probe for every StepFun endpoint shape (preset or custom).
 */
export function isStepfunBaseUrl(baseURL: string | undefined): boolean {
  return /^(.+\.)?api\.stepfun\.com$/i.test(hostnameOf(baseURL));
}

/**
 * Which quota probe an endpoint's baseURL selects (null = no quota surface).
 * Quota follows the ENDPOINT: StepFun's two channels (pay-as-you-go /v1 and
 * Step Plan /step_plan/v1) share api.stepfun.com and answer a live account
 * balance; OpenCode's zen gateways share opencode.ai and expose only static
 * plan limits (no balance API — anomalyco/opencode#10448). Shared by the
 * renderer (settings card gating) and desktop main (IPC probe dispatch).
 */
export type EndpointQuotaKind = "stepfun-account" | "opencode-subscription";

export function endpointQuotaKind(baseURL: string | undefined): EndpointQuotaKind | null {
  if (isStepfunBaseUrl(baseURL)) return "stepfun-account";
  return hostnameOf(baseURL) === "opencode.ai" ? "opencode-subscription" : null;
}

/**
 * Curated known model ids per family — the desktop settings pool binds each
 * endpoint's add-model suggestion list to the endpoint's family through this
 * table (family ↔ model-list binding). Curated rather than derived from
 * MODEL_OVERRIDES so legacy/discontinued ids (deepseek-chat / deepseek-reasoner)
 * stay resolvable without being suggested; not-yet-registered families serve an
 * empty list. An endpoint whose family can't be determined falls back to the
 * union of every family's list (see endpointModelFamily).
 */
export const FAMILY_MODEL_SUGGESTIONS: Readonly<Record<ModelFamilyId, readonly string[]>> = {
  deepseek: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"],
  stepfun: ["step-3.7-flash", "step-router-v1"],
  glm: [],
  kimi: [],
  minimax: [],
  qwen: [],
  unknown: [],
};

/**
 * Which family an ENDPOINT's model suggestions should come from. Resolution
 * mirrors resolveModelSpec, endpoint-flavored: the first registered model whose
 * family resolves wins (aggregator gateways — e.g. OpenCode's zen gateways —
 * serve one family's models in practice), then the baseURL host hints, then the
 * caller's fallback (the renderer passes a preset-id hint for gateways whose
 * host is not in the registry), else "unknown".
 */
export function endpointModelFamily(input: {
  baseURL?: string;
  registeredModelIds?: ReadonlyArray<string>;
  fallback?: ModelFamilyId;
}): ModelFamilyId {
  for (const id of input.registeredModelIds ?? []) {
    const spec = resolveModelSpec({ model: id });
    if (spec.familyResolved) return spec.id;
  }
  const byHost = resolveModelSpec({ model: "", baseURL: input.baseURL });
  if (byHost.familyResolved) return byHost.id;
  return input.fallback ?? "unknown";
}

/**
 * Resolve a model to its capability spec. Resolution order:
 *  1. exact-model override merged over its family entry (families matched by
 *     `modelPatterns` on the trimmed string),
 *  2. `baseURLHostHints` hostname fallback (aggregator gateways serving many
 *     families under one baseURL — hint only, never the primary rule),
 *  3. the UNKNOWN fallback spec.
 * Pure function: no IO, no state, safe to call from any process.
 */
export function resolveModelSpec(input: { model: string; baseURL?: string }): ModelSpec {
  const model = input.model;
  const trimmed = model.trim();
  const family =
    FAMILIES.find((candidate) => candidate.modelPatterns.some((pattern) => pattern.test(trimmed))) ??
    (input.baseURL
      ? FAMILIES.find((candidate) =>
          candidate.baseURLHostHints?.some((pattern) => pattern.test(hostnameOf(input.baseURL)))
        )
      : undefined);
  const base = family ?? UNKNOWN_FAMILY;
  const override = MODEL_OVERRIDES[model];
  return {
    ...base,
    ...(override ?? {}),
    id: base.id,
    model,
    familyResolved: base.id !== "unknown",
  };
}

/** Whether a model defaults to thinking/reasoning mode (registration overrides). */
export function defaultsToThinkingMode(model: string, registration?: ModelCapabilityRegistration): boolean {
  if (registration?.thinking !== undefined) return registration.thinking;
  return resolveModelSpec({ model }).defaultsToThinking;
}

/** Whether a model accepts image input (registration overrides). */
export function supportsMultimodal(model: string, registration?: ModelCapabilityRegistration): boolean {
  if (registration?.vision !== undefined) return registration.vision;
  // The pre-registry facade trimmed before its Set lookup; keep that exact
  // semantics (unlike the thinking/threshold facades, which never trimmed).
  return resolveModelSpec({ model: model.trim() }).multimodal;
}

/** Active-context size at which the engine compacts the conversation. */
export function getCompactPromptTokenThreshold(model: string): number {
  return resolveModelSpec({ model }).contextWindowTokens;
}

/** Structural slice of EndpointConfig — keeps this module settings-free. */
export type EndpointModelsLike = {
  id?: string;
  models?: ReadonlyArray<{ id: string; thinking?: boolean; vision?: boolean }>;
};

/**
 * Find a user's per-model capability registration across configured endpoints.
 * Mirrors the settings.ts precedence: the primary endpoint's declaration wins,
 * then any endpoint's, then undefined (callers fall back to the family table).
 */
export function findModelRegistration(
  endpoints: ReadonlyArray<EndpointModelsLike>,
  model: string,
  primaryEndpointId?: string
): ModelCapabilityRegistration | undefined {
  const onEndpoint = (endpoint: EndpointModelsLike | undefined) =>
    endpoint?.models?.find((entry) => entry.id === model);
  const primary = primaryEndpointId ? endpoints.find((endpoint) => endpoint.id === primaryEndpointId) : undefined;
  return onEndpoint(primary) ?? endpoints.map(onEndpoint).find(Boolean);
}

/** Which model + tier a background LLM task should run on. */
export type BackgroundLlmChoice =
  | { tier: "lightweight"; model: string }
  | { tier: "lightweight-cross-endpoint"; model: string; endpointIndex: number }
  | { tier: "secondary"; model: string }
  | { tier: "primary"; model: string };

/**
 * Pure background-task model resolution (compaction, skill matching,
 * classification, prompt enhancement, memory extraction):
 *  1. the family's lightweight model, unless the primary endpoint's registered
 *     model list excludes it (no list = unconstrained),
 *  1'. cross-endpoint activation: the family's lightweight model registered on
 *     ANOTHER configured endpoint (e.g. flash on opencode-zen while the session
 *     runs pro on opencode-go) — the caller routes the call to that endpoint,
 *  2. the user-configured secondary model (only counts when its client exists),
 *  3. the primary session model — always served, hence the safe tail.
 * A DeepSeek endpoint resolves at tier 1 to `deepseek-v4-flash`, identical to
 * the pre-registry hardcoded constants.
 */
export function resolveBackgroundLlm(input: {
  primaryModel: string;
  baseURL?: string;
  endpointModelIds?: ReadonlyArray<string>;
  /** Other credential-backed endpoints whose registered models may serve the family lightweight. */
  crossEndpointCandidates?: ReadonlyArray<{ modelIds: ReadonlyArray<string> }>;
  secondaryModel?: string;
}): BackgroundLlmChoice {
  const spec = resolveModelSpec({ model: input.primaryModel, baseURL: input.baseURL });
  const lightweight = spec.lightweightModel;
  const endpointModelIds = input.endpointModelIds;
  const lightweightServed =
    lightweight !== undefined &&
    (endpointModelIds === undefined || endpointModelIds.length === 0 || endpointModelIds.includes(lightweight));
  if (lightweightServed && lightweight !== undefined) {
    return { tier: "lightweight", model: lightweight };
  }
  if (lightweight !== undefined) {
    const candidates = input.crossEndpointCandidates ?? [];
    const endpointIndex = candidates.findIndex((candidate) => candidate.modelIds.includes(lightweight));
    if (endpointIndex !== -1) {
      return { tier: "lightweight-cross-endpoint", model: lightweight, endpointIndex };
    }
  }
  if (input.secondaryModel !== undefined && input.secondaryModel !== "") {
    return { tier: "secondary", model: input.secondaryModel };
  }
  return { tier: "primary", model: input.primaryModel };
}
