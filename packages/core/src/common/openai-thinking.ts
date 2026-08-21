import type { ReasoningEffort } from "../settings";
import { resolveModelSpec, type ThinkingProtocolId } from "./model-capabilities";

type ThinkingConfig = {
  type: "enabled" | "disabled";
};

type ThinkingRequestOptions = {
  thinking?: ThinkingConfig;
  extra_body?: {
    reasoning_effort?: ReasoningEffort;
  };
};

type ThinkingBuilder = (thinkingEnabled: boolean, reasoningEffort: ReasoningEffort) => ThinkingRequestOptions;

// Per-family request shapes, keyed by `ModelFamilySpec.thinkingProtocol`.
// `deepseek` and `unknown` are byte-identical today — the table exists so new
// families (S1–S4) can diverge without touching any other entry.
const openAiCompatibleBuilder: ThinkingBuilder = (thinkingEnabled, reasoningEffort) => ({
  thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
  ...(thinkingEnabled ? { extra_body: { reasoning_effort: reasoningEffort } } : {}),
});

const THINKING_BUILDERS: Partial<Record<ThinkingProtocolId, ThinkingBuilder>> = {
  deepseek: openAiCompatibleBuilder,
  unknown: openAiCompatibleBuilder,
};

export function buildThinkingRequestOptions(
  thinkingEnabled: boolean,
  baseURL?: string,
  reasoningEffort: ReasoningEffort = "max",
  model?: string
): ThinkingRequestOptions {
  const spec = resolveModelSpec({ model: model ?? "", baseURL });
  const builder = THINKING_BUILDERS[spec.thinkingProtocol] ?? openAiCompatibleBuilder;
  return builder(thinkingEnabled, reasoningEffort);
}
