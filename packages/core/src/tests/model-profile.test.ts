// specs/model-vendor-profiles P0.10 — 解析矩阵（别名/白名单/家族/UNKNOWN）、
// 目录派生（thinkingMandatory / effortValues）、第一方判定、试探归因精确性。
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resolveModelProfile,
  thinkingMandatoryFromCatalog,
  catalogEffortValues,
  isFirstPartyChannel,
} from "../common/model-profile";
import type { CatalogModelEntry as CatalogModelEntryLike } from "../common/model-catalog";
import {
  isAttributableRejection,
  recordWireOptimizationRejection,
  resetWireOptimizationProbe,
  shouldApplyWireOptimizations,
} from "../common/model-probe";

beforeEach(() => {
  resetWireOptimizationProbe();
});

// ── ⓪ 别名层 ────────────────────────────────────────────────────────────────

test("alias: kimi-for-coding resolves to the kimi family with catalog-driven generation", () => {
  const profile = resolveModelProfile({
    model: "kimi-for-coding",
    catalogEntry: {
      id: "kimi-for-coding",
      reasoning: true,
      toolCall: true,
      multimodal: true,
      reasoningOptions: [{ type: "toggle" }, { type: "effort", values: ["low", "high", "max"] }],
    },
  });
  assert.equal(profile.vendor, "kimi");
  assert.equal(profile.matchedBy, "model");
  // K2.8 口径：三档与 K3 对齐 → mandatory 派生为真（无 none/off）。
  assert.equal(profile.wire.thinkingMandatory, true);
  assert.deepEqual(profile.wire.effortValues, ["low", "high", "max"]);
});

test("alias: catalog unavailable still matches the family (conservative)", () => {
  const profile = resolveModelProfile({ model: "kimi-code" });
  assert.equal(profile.vendor, "kimi");
  assert.equal(profile.matchedBy, "model");
  assert.equal(profile.wire.thinkingMandatory, undefined);
});

// ── ① 白名单（具名，大小写不敏感）────────────────────────────────────────────

test("whitelist: all seven families resolve with matchedBy=model", () => {
  const cases: Array<[string, string]> = [
    ["deepseek-flash", "deepseek"],
    ["deepseek-v4-pro", "deepseek"],
    ["step-5-preview", "stepfun"],
    ["step-3.7-flash", "stepfun"],
    ["kimi-k3", "kimi"],
    ["kimi-k2.7-code-highspeed", "kimi"],
    ["MiniMax-M3", "minimax"], // 官方 PascalCase id
    ["qwen3.8-flash", "qwen"],
    ["qwen3.8-plus", "qwen"],
    ["glm-5.3-flash", "glm"],
    ["mimo-v2.6-pro", "mimo"],
  ];
  for (const [model, vendor] of cases) {
    const profile = resolveModelProfile({ model });
    assert.equal(profile.vendor, vendor, model);
    assert.equal(profile.matchedBy, "model", model);
  }
});

test("whitelist: qwen3.8-max-preview derives thinkingMandatory from catalog", () => {
  // models.dev 实测：effort [low, medium, xhigh] — 无 none/off。
  const profile = resolveModelProfile({
    model: "qwen3.8-max-preview",
    catalogEntry: {
      id: "qwen3.8-max-preview",
      reasoning: true,
      toolCall: true,
      multimodal: true,
      reasoningOptions: [{ type: "effort", values: ["low", "medium", "xhigh"] }],
    },
  });
  assert.equal(profile.wire.thinkingMandatory, true);
  assert.deepEqual(profile.wire.effortValues, ["low", "medium", "xhigh"]);
});

test("whitelist: glm-5.3 catalog has no disabled value → mandatory", () => {
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
});

test("whitelist: MiniMax-M3.1 is NOT whitelisted (hidden, unreleased)", () => {
  const profile = resolveModelProfile({ model: "MiniMax-M3.1" });
  // 家族 pattern 命中但非白名单 → 保守默认，无专属优化。
  assert.equal(profile.vendor, "minimax");
  assert.equal(profile.matchedBy, "family");
  assert.deepEqual(profile.wire, {});
});

// ── ② 家族 pattern（白名单外 → 保守默认）────────────────────────────────────

test("family fallback: non-whitelist generations get no optimizations", () => {
  for (const model of [
    "kimi-k2.6",
    "kimi-k2.5",
    "minimax-m2.5",
    "glm-5.2",
    "step-3.5-flash",
    "mimo-v2-flash",
    "qwen3.5-flash",
  ]) {
    const profile = resolveModelProfile({ model });
    assert.equal(profile.matchedBy, "family", model);
    assert.deepEqual(profile.wire, {}, model);
    assert.deepEqual(profile.local, {}, model);
  }
});

// ── ③ UNKNOWN ────────────────────────────────────────────────────────────────

test("unknown: unrelated model ids fall through to the empty profile", () => {
  for (const model of ["gpt-5.2", "claude-opus-5", "llama-4-405b", ""]) {
    const profile = resolveModelProfile({ model });
    assert.equal(profile.vendor, "unknown");
    assert.equal(profile.matchedBy, "fallback");
    assert.deepEqual(profile.wire, {});
  }
});

// ── 目录派生 ────────────────────────────────────────────────────────────────

test("thinkingMandatoryFromCatalog: none/off/disabled ladders are disable-able", () => {
  const withNone: CatalogModelEntryLike = {
    id: "x",
    reasoning: true,
    toolCall: true,
    multimodal: false,
    reasoningOptions: [{ type: "effort", values: ["none", "low", "high"] }],
  };
  assert.equal(thinkingMandatoryFromCatalog(withNone), false);
  const withOff: CatalogModelEntryLike = {
    id: "x",
    reasoning: true,
    toolCall: true,
    multimodal: false,
    reasoningOptions: [{ type: "effort", values: ["off", "high"] }],
  };
  assert.equal(thinkingMandatoryFromCatalog(withOff), false);
});

test("thinkingMandatoryFromCatalog: toggle-only / no-options / non-reasoning → false", () => {
  const toggleOnly: CatalogModelEntryLike = {
    id: "x",
    reasoning: true,
    toolCall: true,
    multimodal: false,
    reasoningOptions: [{ type: "toggle" }],
  };
  assert.equal(thinkingMandatoryFromCatalog(toggleOnly), false);
  assert.equal(thinkingMandatoryFromCatalog(null), false);
  const notReasoning: CatalogModelEntryLike = {
    id: "x",
    reasoning: false,
    toolCall: true,
    multimodal: false,
    reasoningOptions: [{ type: "effort", values: ["low"] }],
  };
  assert.equal(thinkingMandatoryFromCatalog(notReasoning), false);
});

test("catalogEffortValues: first effort option wins; absent → undefined", () => {
  const entry: CatalogModelEntryLike = {
    id: "x",
    reasoning: true,
    toolCall: true,
    multimodal: false,
    reasoningOptions: [{ type: "effort", values: ["low", "high", "max"] }],
  };
  assert.deepEqual(catalogEffortValues(entry), ["low", "high", "max"]);
  assert.equal(catalogEffortValues(undefined), undefined);
});

test("interleaved.field drives reasoningReadFields for whitelisted models", () => {
  const profile = resolveModelProfile({
    model: "glm-5.3-flash",
    catalogEntry: {
      id: "glm-5.3-flash",
      reasoning: true,
      toolCall: true,
      multimodal: true,
      interleavedField: "reasoning_content",
    },
  });
  assert.deepEqual(profile.wire.reasoningReadFields, ["reasoning_content", "reasoning_content", "reasoning"]);
});

// ── 第一方通道（仅试探加速）─────────────────────────────────────────────────

test("first-party: host suffix match per family; unlisted/unjudgeable → false", () => {
  assert.equal(isFirstPartyChannel({ vendor: "minimax", baseURL: "https://api.minimax.io/anthropic/v1" }), true);
  assert.equal(isFirstPartyChannel({ vendor: "minimax", baseURL: "https://api.minimaxi.com/v1" }), true);
  assert.equal(isFirstPartyChannel({ vendor: "kimi", baseURL: "https://api.moonshot.cn/v1" }), true);
  assert.equal(
    isFirstPartyChannel({ vendor: "qwen", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" }),
    true
  );
  // 第三方网关（opencode）→ false。
  assert.equal(isFirstPartyChannel({ vendor: "deepseek", baseURL: "https://opencode.ai/zen/v1" }), false);
  // 仿冒 host（evil-minimax.io）→ false（后缀必须整段）。
  assert.equal(isFirstPartyChannel({ vendor: "minimax", baseURL: "https://api.evil-minimax.io/v1" }), false);
  assert.equal(isFirstPartyChannel({ vendor: "unknown", baseURL: "https://x.example" }), false);
  assert.equal(isFirstPartyChannel({ vendor: "kimi" }), false);
});

// ── 试探：记账与同轮重试语义 ────────────────────────────────────────────────

test("probe: optimistic until an attributable rejection is recorded for (channel, model)", () => {
  assert.equal(shouldApplyWireOptimizations("qwen3.8-max-preview", "https://api.example.com/v1"), true);
  const first = recordWireOptimizationRejection("qwen3.8-max-preview", "https://api.example.com/v1", "test");
  assert.equal(first, true); // 首次 → 调用方据此同轮重发一次
  assert.equal(shouldApplyWireOptimizations("qwen3.8-max-preview", "https://api.example.com/v1"), false);
  assert.equal(shouldApplyWireOptimizations("qwen3.8-max-preview", "https://other.example.com/v1"), true); // 通道隔离
  assert.equal(shouldApplyWireOptimizations("qwen3.8-flash", "https://api.example.com/v1"), true); // 模型隔离
  const second = recordWireOptimizationRejection("qwen3.8-max-preview", "https://api.example.com/v1", "again");
  assert.equal(second, false); // 重复记录 → 不再触发重发
});

// ── 试探：归因精确性（R5 硬红线）────────────────────────────────────────────

function errWith(status: number | undefined, message: string, type?: string): Error {
  const error = new Error(message) as Error & { status?: number; type?: string };
  if (status !== undefined) error.status = status;
  if (type !== undefined) error.type = type;
  return error;
}

test("attribution: plain 400 with unrecognized wording IS attributable", () => {
  assert.equal(isAttributableRejection(errWith(400, "Invalid parameter: thinking")), true);
});

test("attribution: auth / quota / rate-limit / overflow NEVER attributable (R5)", () => {
  assert.equal(isAttributableRejection(errWith(401, "Unauthorized")), false);
  assert.equal(isAttributableRejection(errWith(403, "Forbidden")), false);
  assert.equal(isAttributableRejection(errWith(402, "Payment required")), false);
  assert.equal(isAttributableRejection(errWith(429, "Too many requests")), false);
  assert.equal(isAttributableRejection(errWith(400, "This model's maximum context length is 1000000 tokens")), false);
  assert.equal(isAttributableRejection(errWith(500, "Internal server error")), false);
  assert.equal(isAttributableRejection(errWith(undefined, "fetch failed")), false);
});

test("attribution: OpenAI-shaped invalid_request_error without status", () => {
  assert.equal(isAttributableRejection(errWith(undefined, "Unknown parameter", "invalid_request_error")), true);
  // 但同一形状若语义类别已知（如限流文案）→ 不可归因。
  assert.equal(
    isAttributableRejection(errWith(undefined, "Requests rate limit exceeded", "invalid_request_error")),
    false
  );
});
