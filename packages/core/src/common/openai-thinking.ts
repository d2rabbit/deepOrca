import type { ReasoningEffort } from "../settings";
import { mapThinkLevel } from "./think-level";
import { resolveModelSpec, type ThinkingProtocolId } from "./model-capabilities";

type ThinkingConfig = {
  type: "enabled" | "disabled";
};

type ThinkingRequestOptions = {
  thinking?: ThinkingConfig;
  extra_body?: {
    reasoning_effort?: ReasoningEffort;
  };
  /** StepFun-style TOP-LEVEL effort param (`/v1/chat/completions` accepts
   *  `reasoning_effort` directly — unlike DeepSeek it has no `thinking`
   *  envelope, and the nested extra_body form never reaches the wire). The
   *  OpenAI SDK types this field as the low/medium/high triple, so the value
   *  is narrowed before it can be spread into a typed create() call. */
  reasoning_effort?: "low" | "medium" | "high";
};

type ThinkingBuilder = (thinkingEnabled: boolean, reasoningEffort: ReasoningEffort) => ThinkingRequestOptions;

// Per-family request shapes, keyed by `ModelFamilySpec.thinkingProtocol`.
// `deepseek` and `unknown` are byte-identical today — the table exists so new
// families (S1–S4) can diverge without touching any other entry.
const openAiCompatibleBuilder: ThinkingBuilder = (thinkingEnabled, reasoningEffort) => ({
  thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
  ...(thinkingEnabled ? { extra_body: { reasoning_effort: reasoningEffort } } : {}),
});

// StepFun (step-3.7-flash): reasoning cannot be turned OFF — the API's only
// control is reasoning_effort low/medium/high — so the app's thinking-off
// projects onto `low` (the honest weakest tier), and ON sends the mapped tier
// as a top-level param. No `thinking` envelope: that is DeepSeek's param shape
// and Step's compatibility layer neither needs nor documents it. The clamp
// mirrors the stepfun family map (xhigh/max fold to high) so a model-less call
// site can never leak a tier the API rejects.
const stepfunEffort = (level: ReasoningEffort): "low" | "medium" | "high" =>
  level === "low" || level === "medium" ? level : "high";

const stepfunBuilder: ThinkingBuilder = (thinkingEnabled, reasoningEffort) => ({
  reasoning_effort: thinkingEnabled ? stepfunEffort(reasoningEffort) : "low",
});

const THINKING_BUILDERS: Partial<Record<ThinkingProtocolId, ThinkingBuilder>> = {
  deepseek: openAiCompatibleBuilder,
  stepfun: stepfunBuilder,
  unknown: openAiCompatibleBuilder,
};

export function buildThinkingRequestOptions(
  thinkingEnabled: boolean,
  baseURL?: string,
  reasoningEffort: ReasoningEffort = "high",
  model?: string
): ThinkingRequestOptions {
  const spec = resolveModelSpec({ model: model ?? "", baseURL });
  const builder = THINKING_BUILDERS[spec.thinkingProtocol] ?? openAiCompatibleBuilder;
  // Unified tier → the family's native effort tiers (identity fallback for
  // unregistered families; DeepSeek folds medium/xhigh into high server-side
  // — common/think-level.ts).
  const nativeEffort = mapThinkLevel(spec.id, reasoningEffort) as ReasoningEffort;
  return builder(thinkingEnabled, nativeEffort);
}
