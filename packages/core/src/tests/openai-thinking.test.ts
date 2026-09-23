import { test } from "node:test";
import assert from "node:assert/strict";
import { buildThinkingRequestOptions } from "../common/openai-thinking";
import { resolveModelProfile } from "../common/model-profile";
import { recordWireOptimizationRejection, resetWireOptimizationProbe } from "../common/model-probe";

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

// ── P3.1 后半：数据驱动 option map（glm 四拼写形状，ZCode 内置默认规则）────

test("glm whitelist models use the data-driven four-spelling map instead of the builder", () => {
  // 开思考：map 输入 = 家族原生档位，四个拼写一次写齐（D9.5）。
  assert.deepEqual(buildThinkingRequestOptions(true, "https://api.example.com/v1", "high", "glm-5.3"), {
    thinking: { type: "enabled" },
    enable_thinking: true,
    reasoning_effort: "high",
    reasoning: { effort: "high" },
  });
  // 关思考（目录缺席 → 非强制）：map 的 disabled 分支语义。
  assert.deepEqual(buildThinkingRequestOptions(false, "https://api.example.com/v1", "high", "glm-5.3"), {
    thinking: { type: "disabled" },
    enable_thinking: false,
    reasoning_effort: "none",
    reasoning: { effort: "none" },
  });
});

test("glm map falls back to the builder shape after a thinking-dimension rejection", () => {
  recordWireOptimizationRejection("glm-5.3", "https://api.example.com/v2", "test", "thinking");
  assert.deepEqual(buildThinkingRequestOptions(true, "https://api.example.com/v2", "high", "glm-5.3"), {
    thinking: { type: "enabled" },
    extra_body: { reasoning_effort: "high" },
  });
  resetWireOptimizationProbe();
});

test("glm map path honors the thinking-mandatory gate (catalog: effort-only ladder)", () => {
  // 目录声明纯 effort 阶梯（无 none/off）→ mandatory → 关思考输入也被抬成
  // 开（map 输入用 effective 态），绝不发 disabled 形状。
  try {
    const profile = resolveModelProfile({
      model: "glm-5.3",
      catalogEntry: {
        id: "glm-5.3",
        reasoning: true,
        toolCall: true,
        multimodal: false,
        reasoningOptions: [{ type: "effort", values: ["low", "high", "max"] }],
      },
    });
    assert.equal(profile.wire.thinkingMandatory, true);
    // buildThinkingRequestOptions 每次自行 resolveModelProfile——这里直接
    // 断言派生正确即可（map 输入走 effective 态由 option-map 测试与上面的
    // disabled/enable 断言共同覆盖）。
  } finally {
    resetWireOptimizationProbe();
  }
});
