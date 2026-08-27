import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultsToThinkingMode,
  isStepfunBaseUrl,
  familyThinkLevels,
  findModelRegistration,
  getCompactPromptTokenThreshold,
  resolveBackgroundLlm,
  resolveModelSpec,
  supportsMultimodal,
} from "../common/model-capabilities";
import { buildThinkingRequestOptions } from "../common/openai-thinking";
import { OpenAIMessageConverter } from "../common/openai-message-converter";

test("familyThinkLevels serves each family's actually-supported tiers", () => {
  // DeepSeek V4: the API effectively serves low/high/max — medium is folded
  // to high server-side, so the menu must not offer it.
  assert.deepEqual(
    familyThinkLevels("deepseek").map((l) => l.id),
    ["low", "high", "max"]
  );
  // Unknown family: the generic visible scale (hidden tiers stay hidden).
  assert.deepEqual(
    familyThinkLevels("unknown").map((l) => l.id),
    ["low", "medium", "high"]
  );
});
import type { SessionMessage } from "../session";

// ---------------------------------------------------------------------------
// Resolution matrix — every value below locks the PRE-registry behavior
// (old DEEPSEEK_V4_MODELS / NON_MULTIMODAL_MODELS sets, key for key).
// ---------------------------------------------------------------------------

test("deepseek v4 models keep their pre-registry capabilities", () => {
  for (const model of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
    const spec = resolveModelSpec({ model });
    assert.equal(spec.id, "deepseek");
    assert.equal(spec.familyResolved, true);
    assert.equal(spec.defaultsToThinking, true);
    assert.equal(spec.multimodal, false);
    assert.equal(spec.contextWindowTokens, 512 * 1024);
    assert.equal(spec.lightweightModel, "deepseek-v4-flash");
    assert.equal(spec.reasoningReplay, "empty-field");
    assert.equal(spec.reasoningField, "reasoning_content");
    assert.deepEqual(spec.reasoningReadFields, ["reasoning_content", "reasoning"]);
  }
});

test("deepseek-v4-flash-vision-exp registers as the multimodal experimental variant", () => {
  const spec = resolveModelSpec({ model: "deepseek-v4-flash-vision-exp" });
  assert.equal(spec.id, "deepseek");
  assert.equal(spec.familyResolved, true);
  assert.equal(spec.defaultsToThinking, true);
  assert.equal(spec.multimodal, true, "vision experimental model accepts image input");
  assert.equal(spec.contextWindowTokens, 512 * 1024);
  assert.equal(spec.lightweightModel, "deepseek-v4-flash");
});

test("legacy deepseek-chat/reasoner keep their pre-registry capabilities", () => {
  for (const model of ["deepseek-chat", "deepseek-reasoner"]) {
    const spec = resolveModelSpec({ model });
    assert.equal(spec.id, "deepseek");
    assert.equal(spec.defaultsToThinking, false, `${model} never defaulted to thinking`);
    assert.equal(spec.multimodal, false);
    assert.equal(spec.contextWindowTokens, 128 * 1024);
  }
});

// ---------------------------------------------------------------------------
// StepFun family (id "stepfun"; step-3.7-flash adaptation, 2026-08-27) — first-party
// vision/reasoning model: 256K window, native multimodal, always-thinking
// (reasoning_effort low/medium/high, no off), reasoning_content convention.
// ---------------------------------------------------------------------------

test("step-3.7-flash resolves to the stepfun family with vision capabilities", () => {
  const spec = resolveModelSpec({ model: "step-3.7-flash" });
  assert.equal(spec.id, "stepfun");
  assert.equal(spec.familyResolved, true);
  assert.equal(spec.defaultsToThinking, true, "reasoning cannot be disabled server-side");
  assert.equal(spec.multimodal, true, "native image (and video) input");
  assert.equal(spec.contextWindowTokens, 256 * 1024);
  assert.equal(spec.lightweightModel, undefined, "no assumed lightweight tier (step-3.5-flash unverified)");
  assert.equal(spec.thinkingProtocol, "stepfun");
  assert.equal(spec.reasoningField, "reasoning_content");
  assert.deepEqual(spec.reasoningReadFields, ["reasoning_content", "reasoning"]);
  assert.equal(spec.reasoningReplay, "omit", "never send a foreign reasoning field on replay");
});

test("step-router-v1 opts out of multimodal (Step Plan router rejects images)", () => {
  // Chat Completions API doc, Step Plan channel field table: the router
  // returns unsupported_content_type for image/document input even though
  // one of its routes is a vision model.
  const spec = resolveModelSpec({ model: "step-router-v1" });
  assert.equal(spec.id, "stepfun");
  assert.equal(spec.multimodal, false, "router never accepts image input");
  // Direct vision models keep multimodal through the same pattern.
  assert.equal(resolveModelSpec({ model: "step-3.7-flash" }).multimodal, true);
});

test("isStepfunBaseUrl gates both StepFun channels (and only StepFun)", () => {
  for (const url of ["https://api.stepfun.com/v1", "https://api.stepfun.com", "https://api.stepfun.com/step_plan/v1"]) {
    assert.equal(isStepfunBaseUrl(url), true, url);
  }
  for (const url of ["https://api.deepseek.com", "https://evil.stepfun.com.attacker.io", "", undefined]) {
    assert.equal(isStepfunBaseUrl(url), false, String(url));
  }
});

test("stepfun family resolves by api.stepfun.com baseURL hint when the model name is opaque", () => {
  const spec = resolveModelSpec({ model: "custom-tuned-alias", baseURL: "https://api.stepfun.com/v1" });
  assert.equal(spec.id, "stepfun");
  assert.equal(spec.familyResolved, true);
});

test("stepfun family serves exactly low/medium/high effort tiers", () => {
  assert.deepEqual(
    familyThinkLevels("stepfun").map((l) => l.id),
    ["low", "medium", "high"]
  );
});

test("stepfun thinking requests carry a top-level reasoning_effort (no thinking envelope)", () => {
  // ON: the mapped native tier, top-level (StepFun's documented param shape).
  assert.deepEqual(buildThinkingRequestOptions(true, "https://api.stepfun.com/v1", "high", "step-3.7-flash"), {
    reasoning_effort: "high",
  });
  // Unified medium passes through (step serves it natively); xhigh/max fold to high.
  assert.equal(
    buildThinkingRequestOptions(true, "https://api.stepfun.com/v1", "xhigh", "step-3.7-flash").reasoning_effort,
    "high"
  );
  assert.equal(
    buildThinkingRequestOptions(true, "https://api.stepfun.com/v1", "max", "step-3.7-flash").reasoning_effort,
    "high"
  );
  // OFF: the model has no off switch — the weakest tier is the honest floor.
  assert.deepEqual(buildThinkingRequestOptions(false, "https://api.stepfun.com/v1", "high", "step-3.7-flash"), {
    reasoning_effort: "low",
  });
});

test("unlisted deepseek-* models keep the conservative family defaults", () => {
  const spec = resolveModelSpec({ model: "deepseek-experimental" });
  assert.equal(spec.id, "deepseek");
  assert.equal(spec.defaultsToThinking, false);
  // Pre-registry semantics: models absent from NON_MULTIMODAL_MODELS were
  // treated as multimodal-capable. Lock that in.
  assert.equal(spec.multimodal, true);
  assert.equal(spec.contextWindowTokens, 128 * 1024);
});

test("unknown models fail open to the conservative UNKNOWN spec", () => {
  const spec = resolveModelSpec({ model: "some-unknown-model" });
  assert.equal(spec.id, "unknown");
  assert.equal(spec.familyResolved, false);
  assert.equal(spec.defaultsToThinking, false);
  assert.equal(spec.multimodal, true);
  assert.equal(spec.contextWindowTokens, 128 * 1024);
  assert.equal(spec.reasoningReplay, "empty-field");
  assert.deepEqual(spec.reasoningReadFields, ["reasoning_content", "reasoning"]);
  assert.equal(spec.lightweightModel, undefined);
});

test("not-yet-registered families (glm/kimi/…) behave exactly like unknown models", () => {
  // Family independence: registering deepseek must not change how other
  // vendors' model strings resolve until their own family entry lands.
  for (const model of ["glm-5", "kimi-k3", "minimax-m3", "qwen-3.8"]) {
    const spec = resolveModelSpec({ model });
    assert.equal(spec.id, "unknown", model);
    assert.equal(spec.defaultsToThinking, false);
    assert.equal(spec.multimodal, true);
    assert.equal(spec.contextWindowTokens, 128 * 1024);
  }
});

test("pattern matching is anchored — 'my-deepseek-v4-pro' is not a deepseek model", () => {
  assert.equal(resolveModelSpec({ model: "my-deepseek-v4-pro" }).id, "unknown");
});

test("baseURL host hint resolves the family when the model string does not", () => {
  const hinted = resolveModelSpec({ model: "custom-gateway-model", baseURL: "https://api.deepseek.com/v1" });
  assert.equal(hinted.id, "deepseek");
  assert.equal(hinted.lightweightModel, "deepseek-v4-flash");

  assert.equal(resolveModelSpec({ model: "custom-gateway-model", baseURL: "https://other.example.com" }).id, "unknown");
  // Subdomain of a lookalike host must not match.
  assert.equal(resolveModelSpec({ model: "x", baseURL: "https://api.deepseek.com.evil.example.com" }).id, "unknown");
  // Invalid baseURL strings degrade to no hint instead of throwing.
  assert.equal(resolveModelSpec({ model: "x", baseURL: "not a url" }).id, "unknown");
});

// ---------------------------------------------------------------------------
// Facade parity — the exact assertions the old Sets satisfied.
// ---------------------------------------------------------------------------

test("defaultsToThinkingMode matches the old DEEPSEEK_V4_MODELS set", () => {
  assert.equal(defaultsToThinkingMode("deepseek-v4-flash"), true);
  assert.equal(defaultsToThinkingMode("deepseek-v4-pro"), true);
  assert.equal(defaultsToThinkingMode("deepseek-chat"), false);
  assert.equal(defaultsToThinkingMode("deepseek-reasoner"), false);
  assert.equal(defaultsToThinkingMode("gpt-4o"), false);
});

test("supportsMultimodal matches the old NON_MULTIMODAL_MODELS set", () => {
  assert.equal(supportsMultimodal("deepseek-v4-pro"), false);
  assert.equal(supportsMultimodal("deepseek-v4-flash"), false);
  assert.equal(supportsMultimodal("deepseek-chat"), false);
  assert.equal(supportsMultimodal("deepseek-reasoner"), false);
  assert.equal(supportsMultimodal("qwen-vl-max"), true);
  assert.equal(supportsMultimodal("  deepseek-chat  "), false, "trims like the old facade");
});

test("getCompactPromptTokenThreshold keeps the 512K/128K split", () => {
  assert.equal(getCompactPromptTokenThreshold("deepseek-v4-flash"), 512 * 1024);
  assert.equal(getCompactPromptTokenThreshold("deepseek-v4-pro"), 512 * 1024);
  assert.equal(getCompactPromptTokenThreshold("deepseek-chat"), 128 * 1024);
  assert.equal(getCompactPromptTokenThreshold("anything-else"), 128 * 1024);
});

// ---------------------------------------------------------------------------
// User registration precedence (R5).
// ---------------------------------------------------------------------------

test("explicit endpoint registration overrides the family table", () => {
  assert.equal(defaultsToThinkingMode("deepseek-v4-pro", { thinking: false }), false);
  assert.equal(defaultsToThinkingMode("gpt-4o", { thinking: true }), true);
  assert.equal(supportsMultimodal("deepseek-chat", { vision: true }), true);
  assert.equal(supportsMultimodal("qwen-vl-max", { vision: false }), false);
});

test("findModelRegistration prefers the primary endpoint, then any endpoint", () => {
  const endpoints = [
    { id: "other", models: [{ id: "shared-model", thinking: true }] },
    { id: "primary", models: [{ id: "shared-model", thinking: false }] },
  ];
  assert.equal(findModelRegistration(endpoints, "shared-model", "primary")?.thinking, false);
  assert.equal(findModelRegistration(endpoints, "shared-model", "missing-id")?.thinking, true);
  assert.equal(findModelRegistration(endpoints, "absent-model"), undefined);
});

// ---------------------------------------------------------------------------
// Background LLM resolution chain (R3/R4).
// ---------------------------------------------------------------------------

test("deepseek primaries resolve to the family lightweight model", () => {
  assert.deepEqual(resolveBackgroundLlm({ primaryModel: "deepseek-v4-pro" }), {
    tier: "lightweight",
    model: "deepseek-v4-flash",
  });
  // Host hint counts as deepseek too (pre-registry behavior sent the same
  // flash constant to any endpoint).
  assert.deepEqual(resolveBackgroundLlm({ primaryModel: "test-model", baseURL: "https://api.deepseek.com" }), {
    tier: "lightweight",
    model: "deepseek-v4-flash",
  });
});

test("unknown families fall back to the explicit secondary, then the primary model", () => {
  assert.deepEqual(resolveBackgroundLlm({ primaryModel: "glm-5", secondaryModel: "glm-5-flash" }), {
    tier: "secondary",
    model: "glm-5-flash",
  });
  assert.deepEqual(resolveBackgroundLlm({ primaryModel: "glm-5" }), {
    tier: "primary",
    model: "glm-5",
  });
});

test("endpoint model lists gate the lightweight tier", () => {
  // Endpoint serves only the primary → lightweight excluded → next ring.
  assert.deepEqual(
    resolveBackgroundLlm({
      primaryModel: "deepseek-v4-pro",
      endpointModelIds: ["deepseek-v4-pro"],
      secondaryModel: "cheap-model",
    }),
    { tier: "secondary", model: "cheap-model" }
  );
  // No secondary configured → safe tail is the primary session model.
  assert.deepEqual(resolveBackgroundLlm({ primaryModel: "deepseek-v4-pro", endpointModelIds: ["deepseek-v4-pro"] }), {
    tier: "primary",
    model: "deepseek-v4-pro",
  });
  // Lightweight listed → served.
  assert.deepEqual(
    resolveBackgroundLlm({
      primaryModel: "deepseek-v4-pro",
      endpointModelIds: ["deepseek-v4-pro", "deepseek-v4-flash"],
    }),
    { tier: "lightweight", model: "deepseek-v4-flash" }
  );
  // Empty list = unconstrained (legacy settings without models[]).
  assert.deepEqual(resolveBackgroundLlm({ primaryModel: "deepseek-v4-pro", endpointModelIds: [] }), {
    tier: "lightweight",
    model: "deepseek-v4-flash",
  });
});

test("cross-endpoint activation: family lightweight detected on another endpoint", () => {
  // flash NOT on the primary (pro on opencode-go), but registered on
  // opencode-zen → the background task routes to that endpoint, preferred
  // over the explicit secondary (family preference per the committed chain).
  assert.deepEqual(
    resolveBackgroundLlm({
      primaryModel: "deepseek-v4-pro",
      endpointModelIds: ["deepseek-v4-pro"],
      crossEndpointCandidates: [{ modelIds: ["glm-5"] }, { modelIds: ["deepseek-v4-flash"] }],
      secondaryModel: "cheap-model",
    }),
    { tier: "lightweight-cross-endpoint", model: "deepseek-v4-flash", endpointIndex: 1 }
  );
  // Candidate endpoints that don't carry the lightweight → ring ①' misses and
  // the chain continues to secondary.
  assert.deepEqual(
    resolveBackgroundLlm({
      primaryModel: "deepseek-v4-pro",
      endpointModelIds: ["deepseek-v4-pro"],
      crossEndpointCandidates: [{ modelIds: ["glm-5"] }],
      secondaryModel: "cheap-model",
    }),
    { tier: "secondary", model: "cheap-model" }
  );
  // No candidates at all (legacy settings) → unchanged pre-existing behavior.
  assert.deepEqual(resolveBackgroundLlm({ primaryModel: "deepseek-v4-pro", endpointModelIds: ["deepseek-v4-pro"] }), {
    tier: "primary",
    model: "deepseek-v4-pro",
  });
});

// ---------------------------------------------------------------------------
// Golden: thinking request shapes stay byte-identical (R4/R6).
// ---------------------------------------------------------------------------

test("buildThinkingRequestOptions golden shape with model dispatch", () => {
  assert.deepEqual(buildThinkingRequestOptions(true, "https://api.deepseek.com", "max", "deepseek-v4-pro"), {
    thinking: { type: "enabled" },
    extra_body: { reasoning_effort: "max" },
  });
  assert.deepEqual(buildThinkingRequestOptions(false, "https://api.deepseek.com", "max", "deepseek-chat"), {
    thinking: { type: "disabled" },
  });
  // Unknown families keep the legacy shape.
  assert.deepEqual(buildThinkingRequestOptions(true, undefined, "high", "mystery-model"), {
    thinking: { type: "enabled" },
    extra_body: { reasoning_effort: "high" },
  });
});

// ---------------------------------------------------------------------------
// Converter replay stays byte-identical for deepseek/unknown (R4/R6).
// ---------------------------------------------------------------------------

function assistantMessage(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: "msg-1",
    sessionId: "session-1",
    role: "assistant",
    content: "hello",
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-08-21T00:00:00.000Z",
    updateTime: "2026-08-21T00:00:00.000Z",
    ...overrides,
  } as SessionMessage;
}

test("message converter replays an empty reasoning_content field for deepseek thinking mode", () => {
  const converter = new OpenAIMessageConverter();
  const messages = converter.buildMessages([assistantMessage()], true, "deepseek-v4-pro");
  assert.equal(messages.length, 1);
  assert.deepEqual((messages[0] as { reasoning_content?: string }).reasoning_content, "");
  assert.deepEqual((messages[0] as { content: string }).content, "hello");
});
