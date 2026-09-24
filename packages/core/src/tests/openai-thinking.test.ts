import { test } from "node:test";
import assert from "node:assert/strict";
import { buildThinkingRequestOptions } from "../common/openai-thinking";
import { resolveModelProfile } from "../common/model-profile";
import { recordWireOptimizationRejection, resetWireOptimizationProbe } from "../common/model-probe";
import { configureModelCatalog } from "../common/model-catalog";

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

test("glm map veto: falls back to NO thinking keys (round-3 G2), never an unverified generic shape", () => {
  recordWireOptimizationRejection("glm-5.3", "https://api.example.com/v2", "test", "thinking");
  // round-3 G2：map 家族的思考形状是该端点的唯一文档形状；被 veto 后回落
  // 「不发任何思考键」——绝不再发从未被该端点验证过的通用 builder 形状。
  assert.deepEqual(buildThinkingRequestOptions(true, "https://api.example.com/v2", "high", "glm-5.3"), {});
  resetWireOptimizationProbe();
});

test("mandatory models keep the enabled projection even after a probe veto (round-3 G1)", () => {
  // 目录实证 effort-only 阶梯 → mandatory；veto 记账后用户关思考仍不得回落
  // disabled 形状（目录已证伪）。mandatory 是保护不是补丁，不随 veto 解除。
  recordWireOptimizationRejection("glm-5.3", "https://api.example.com/v3", "test", "*");
  try {
    configureModelCatalog(
      JSON.stringify({
        p: {
          models: {
            "glm-5.3": {
              reasoning: true,
              reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
            },
          },
        },
        // 灌满 sanity floor（providers.size >= 20）的哑 provider。
        ...Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`filler${i}`, { models: {} }])),
      })
    );
    assert.deepEqual(buildThinkingRequestOptions(false, "https://api.example.com/v3", "high", "glm-5.3"), {
      thinking: { type: "enabled" },
      extra_body: { reasoning_effort: "high" },
    });
  } finally {
    configureModelCatalog(null);
    resetWireOptimizationProbe();
  }
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

// ── agnes 家族（chat_template_kwargs.enable_thinking，纯数据路径）────────────

test("agnes whitelist models toggle thinking via chat_template_kwargs (docs 2026-09-24)", () => {
  // 开思考：enable_thinking=true，无 thinking 信封、无 effort 字段——
  // 官方 OpenAI 兼容形状只有这一个扩展键。
  assert.deepEqual(buildThinkingRequestOptions(true, "https://apihub.agnes-ai.com/v1", "high", "agnes-3.0-flash"), {
    chat_template_kwargs: { enable_thinking: true },
  });
  // 关思考：显式 false（opt-in 开关，显式恒定确定）。
  assert.deepEqual(buildThinkingRequestOptions(false, "https://apihub.agnes-ai.com/v1", "high", "agnes-2.5-flash"), {
    chat_template_kwargs: { enable_thinking: false },
  });
});

test("agnes map veto: falls back to NO thinking keys (round-3 G2)", () => {
  recordWireOptimizationRejection("agnes-3.0-flash", "https://apihub.agnes-ai.com/v1", "test", "thinking");
  // Agnes 官方端点唯一文档形状是 chat_template_kwargs.enable_thinking；
  // veto 后不发任何思考键（服务端默认），不发未验证的通用形状。
  assert.deepEqual(buildThinkingRequestOptions(true, "https://apihub.agnes-ai.com/v1", "high", "agnes-3.0-flash"), {});
  resetWireOptimizationProbe();
});
