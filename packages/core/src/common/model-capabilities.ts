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

export type ModelFamilyId = "deepseek" | "glm" | "kimi" | "minimax" | "qwen" | "unknown";

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
 * DeepSeek family. Registered values reproduce the pre-registry behavior
 * exactly: the family defaults describe an *unlisted* `deepseek-*` model
 * (128K window, thinking off, multimodal allowed), and the four known models
 * override via MODEL_OVERRIDES — matching the old DEEPSEEK_V4_MODELS /
 * NON_MULTIMODAL_MODELS sets key-for-key. `deepseek-chat` / `deepseek-reasoner`
 * stay registered even though DeepSeek discontinued them (2026-07-24) so
 * existing settings keep resolving with their historical capabilities.
 */
const DEEPSEEK_FAMILY: ModelFamilySpec = {
  id: "deepseek",
  modelPatterns: [/^deepseek-/i],
  baseURLHostHints: [/^(.+\.)?api\.deepseek\.com$/i],
  contextWindowTokens: 128 * 1024,
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
 * First-class fallback for models that resolve to no family. Every value equals
 * the pre-registry behavior for unknown models: 128K threshold, thinking off by
 * default, multimodal permitted, today's thinking-request shape, dual reasoning
 * read fields. Being a registry entry (not an implicit else) keeps those
 * semantics documented and test-locked.
 */
const UNKNOWN_FAMILY: ModelFamilySpec = {
  id: "unknown",
  modelPatterns: [],
  contextWindowTokens: 128 * 1024,
  defaultsToThinking: false,
  multimodal: true,
  thinkingProtocol: "unknown",
  reasoningField: "reasoning_content",
  reasoningReadFields: ["reasoning_content", "reasoning"],
  reasoningReplay: "empty-field",
};

/** Registered families. New vendors land here as one entry (plus overrides). */
const FAMILIES: readonly ModelFamilySpec[] = [DEEPSEEK_FAMILY];

function hostnameOf(baseURL: string | undefined): string {
  if (!baseURL) return "";
  try {
    return new URL(baseURL).hostname.toLowerCase();
  } catch {
    return "";
  }
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
