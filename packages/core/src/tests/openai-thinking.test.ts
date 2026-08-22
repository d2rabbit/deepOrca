import { test } from "node:test";
import assert from "node:assert/strict";
import { buildThinkingRequestOptions } from "../common/openai-thinking";

test("buildThinkingRequestOptions explicitly disables thinking", () => {
  assert.deepEqual(buildThinkingRequestOptions(false, "https://api.deepseek.com"), {
    thinking: { type: "disabled" },
  });
});

test("buildThinkingRequestOptions uses the same disabled payload for volces endpoints", () => {
  assert.deepEqual(buildThinkingRequestOptions(false, "https://ark.cn-beijing.volces.com/api/v3"), {
    thinking: { type: "disabled" },
  });
});

test("buildThinkingRequestOptions enables thinking with default reasoning effort", () => {
  assert.deepEqual(buildThinkingRequestOptions(true, "https://api.deepseek.com"), {
    thinking: { type: "enabled" },
    extra_body: { reasoning_effort: "high" },
  });
});

test("buildThinkingRequestOptions uses the same enabled payload for volces endpoints", () => {
  assert.deepEqual(buildThinkingRequestOptions(true, "https://ark.cn-beijing.volces.com/api/v3"), {
    thinking: { type: "enabled" },
    extra_body: { reasoning_effort: "high" },
  });
});

test("buildThinkingRequestOptions accepts high reasoning effort", () => {
  assert.deepEqual(buildThinkingRequestOptions(true, "https://api.deepseek.com", "high"), {
    thinking: { type: "enabled" },
    extra_body: { reasoning_effort: "high" },
  });
});

test("deepseek family maps the unified five-tier scale onto its native low/high/max", () => {
  // Unified tiers project per the thinking-mode guide's request→effective
  // table (common/think-level.ts): medium and xhigh fold into high.
  const cases: Array<[Parameters<typeof buildThinkingRequestOptions>[2], string]> = [
    ["low", "low"],
    ["medium", "high"],
    ["high", "high"],
    ["xhigh", "high"],
    ["max", "max"],
  ];
  for (const [unified, native] of cases) {
    assert.deepEqual(
      buildThinkingRequestOptions(true, "https://api.deepseek.com", unified, "deepseek-v4-pro"),
      { thinking: { type: "enabled" }, extra_body: { reasoning_effort: native } },
      `unified "${unified}" should map to native "${native}"`
    );
  }
});

test("unregistered families pass the unified tier through unchanged", () => {
  assert.deepEqual(buildThinkingRequestOptions(true, undefined, "medium", "some-unknown-model"), {
    thinking: { type: "enabled" },
    extra_body: { reasoning_effort: "medium" },
  });
});
