// specs/model-vendor-profiles P0.10 — 解析矩阵（别名/白名单/家族/UNKNOWN）、
// 目录派生（thinkingMandatory / effortValues）、第一方判定、试探归因精确性。
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  carriesThinkingWirePatch,
  resolveModelProfile,
  thinkingMandatoryFromCatalog,
  catalogEffortValues,
  isFirstPartyChannel,
} from "../common/model-profile";
import type { CatalogModelEntry as CatalogModelEntryLike } from "../common/model-catalog";
import { catalogLookupModel, configureModelCatalog } from "../common/model-catalog";
import {
  isAttributableRejection,
  matchRejectionAttribution,
  recordWireOptimizationRejection,
  resetWireOptimizationProbe,
  resetWireProbe,
  shouldApplyWireOptimizations,
} from "../common/model-probe";

beforeEach(() => {
  resetWireOptimizationProbe();
});

// ── ⓪ 别名层 ────────────────────────────────────────────────────────────────

test("alias: kimi-for-coding resolves to the kimi family with catalog-driven generation", () => {
  // models.dev 实测（moonshotai/kimi-k3）：toggle 与 effort 并存 → 有
  // toggle 即可关 → mandatory=false。切换成纯 effort 阶梯（无 toggle）的
  // 条目才派生 mandatory=true（见 ① 白名单 toggle 用例）。
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
  // toggle 在 → 可关（models.dev toggle 语义）。
  assert.equal(profile.wire.thinkingMandatory, false);
  assert.deepEqual(profile.wire.effortValues, ["low", "high", "max"]);
});

test("derivation: effort-only ladder without toggle → thinkingMandatory=true (qwen3.8-max-preview 实测)", () => {
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
  assert.equal(profile.vendor, "qwen");
  assert.equal(profile.matchedBy, "model");
  assert.equal(profile.wire.thinkingMandatory, true);
  assert.deepEqual(profile.wire.effortValues, ["low", "medium", "xhigh"]);
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
    ["agnes-2.5-flash", "agnes"],
    ["agnes-3.0-flash", "agnes"],
  ];
  for (const [model, vendor] of cases) {
    const profile = resolveModelProfile({ model });
    assert.equal(profile.vendor, vendor, model);
    assert.equal(profile.matchedBy, "model", model);
  }
});

// ── agnes 家族（2026-09-24 新增；思考形状走 optionMap 数据路径）──────────────

test("agnes: whitelist models carry the chat_template_kwargs option map (F1 seam covered)", () => {
  for (const model of ["agnes-2.5-flash", "agnes-3.0-flash"]) {
    const profile = resolveModelProfile({ model, catalogEntry: null });
    assert.equal(profile.vendor, "agnes", model);
    assert.equal(profile.matchedBy, "model", model);
    // 思考开关 = enable_thinking 布尔（opt-in，非 mandatory、非 effort 阶梯）。
    assert.equal(profile.wire.thinkingMandatory, undefined, model);
    assert.match(profile.wire.optionMaps?.reasoningLevel ?? "", /chat_template_kwargs/);
    // 记账门认 map 形态——400 后可禁用同轮重发（F1 语义对新家族即刻生效）。
    assert.equal(carriesThinkingWirePatch(profile), true, model);
  }
});

test("agnes: non-whitelist family models fall back conservatively (2.5-pro / image / video)", () => {
  for (const model of ["agnes-2.5-pro", "agnes-image-25-flash", "agnes-video-25"]) {
    const profile = resolveModelProfile({ model });
    assert.equal(profile.vendor, "agnes", model);
    assert.equal(profile.matchedBy, "family", model);
    assert.deepEqual(profile.wire, {}, model);
  }
});

test("agnes: first-party channel detection for the official apihub host", () => {
  assert.equal(isFirstPartyChannel({ vendor: "agnes", baseURL: "https://apihub.agnes-ai.com/v1" }), true);
  assert.equal(isFirstPartyChannel({ vendor: "agnes", baseURL: "https://some-proxy.example.com/v1" }), false);
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
  // 路径级隔离：同 host 不同路径入口（stepfun /v1 vs /step_plan/v1）是
  // 不同网关栈，一处的拒绝不波及另一处。
  assert.equal(shouldApplyWireOptimizations("qwen3.8-max-preview", "https://api.example.com/step_plan/v1"), true);
  // 尾斜杠等价：规范化后同键。
  assert.equal(shouldApplyWireOptimizations("qwen3.8-max-preview", "https://api.example.com/v1/"), false);
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

// ── 试探：维度级记账（backlog 落地；S1-F2 归因加强）─────────────────────────

test("dimension accounting: a thinking-named rejection disables only the thinking dimension", () => {
  const attribution = matchRejectionAttribution(errWith(400, "Invalid parameter: reasoning_effort"));
  assert.deepEqual(attribution, { kind: "dimension", dimension: "thinking" });
  const first = recordWireOptimizationRejection(
    "glm-5.3",
    "https://d.example.com/v1",
    "e",
    attribution.kind === "dimension" ? attribution.dimension : "*"
  );
  assert.equal(first, true);
  // thinking 维度被禁；同通道该模型的其他维度查询不受通配影响。
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://d.example.com/v1", "thinking"), false);
  // 无维度参数的查询 = 通配意图：仅维度被记时保持乐观（未记通配键）。
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://d.example.com/v1"), true);
});

test("dimension accounting: a wildcard rejection disables everything for (channel, model)", () => {
  const attribution = matchRejectionAttribution(errWith(400, "Bad Request"));
  assert.deepEqual(attribution, { kind: "unknown" });
  recordWireOptimizationRejection("glm-5.3", "https://d.example.com/v2", "e", "*");
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://d.example.com/v2", "thinking"), false);
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://d.example.com/v2"), false);
});

test("dimension accounting: rejections naming unrelated fields are NOT recorded (S1-F2)", () => {
  // tools / temperature / max_tokens 等字段不是我们补丁写的——归因为 unrelated。
  assert.deepEqual(matchRejectionAttribution(errWith(400, "Invalid schema for tool 'read'")), { kind: "unrelated" });
  assert.deepEqual(matchRejectionAttribution(errWith(400, "temperature does not support 0.7")), { kind: "unrelated" });
  // 同轮处理：unrelated → 不记账 → 优化保持开启。
  // (record 只应由 lifecycle 在 attribution.kind !== "unrelated" 时调用。)
});

test("attribution: mixed wording (thinking + unrelated field) blames the thinking patch (F3 self-heal)", () => {
  // 混合措辞说明补丁在拒绝面内——禁用补丁后重发可能直接修复；若判
  // unrelated 跳过，该会话每轮必败且永不自愈。
  assert.deepEqual(matchRejectionAttribution(errWith(400, "'enable_thinking' cannot be used together with tools")), {
    kind: "dimension",
    dimension: "thinking",
  });
});

test("attribution: field names are matched exactly — prose 'reason' is NOT blamed (F4)", () => {
  assert.deepEqual(matchRejectionAttribution(errWith(400, "no valid reason given")), { kind: "unknown" });
  assert.deepEqual(matchRejectionAttribution(errWith(400, "unreasonable request shape")), { kind: "unknown" });
  // 完整字段名（含下划线拼写）仍然命中。
  assert.deepEqual(matchRejectionAttribution(errWith(400, "Invalid parameter: enable_thinking")), {
    kind: "dimension",
    dimension: "thinking",
  });
});

// ── 试探记账门：carriesThinkingWirePatch（F1——镜像 wire 应用谓词）──────────

test("accounting gate: optionMaps-only profiles carry the patch even without catalog (glm F1 seam)", () => {
  // 目录缺席（models.dev 快照缺失是文档化常态）→ thinkingMandatory 缺失，
  // 但 glm map 补丁照发 wire——记账门必须认它，否则 400 后永不记账。
  const noCatalog = resolveModelProfile({ model: "glm-5.3", catalogEntry: null });
  assert.equal(noCatalog.wire.thinkingMandatory, undefined);
  assert.ok(noCatalog.wire.optionMaps?.reasoningLevel);
  assert.equal(carriesThinkingWirePatch(noCatalog), true);
});

test("accounting gate: mandatory projection and clean fallback profiles", () => {
  const mandatory = resolveModelProfile({
    model: "qwen3.8-max-preview",
    catalogEntry: {
      id: "qwen3.8-max-preview",
      reasoning: true,
      toolCall: true,
      multimodal: false,
      reasoningOptions: [{ type: "effort", values: ["low", "medium", "xhigh"] }],
    },
  });
  assert.equal(carriesThinkingWirePatch(mandatory), true);

  // 无补丁画像：deepseek（无 mandatory 无 map）、家族兜底、UNKNOWN。
  assert.equal(carriesThinkingWirePatch(resolveModelProfile({ model: "deepseek-v4-pro", catalogEntry: null })), false);
  assert.equal(
    carriesThinkingWirePatch(resolveModelProfile({ model: "deepseek-legacy-x", catalogEntry: null })),
    false
  );
  assert.equal(carriesThinkingWirePatch(resolveModelProfile({ model: "gpt-who-knows", catalogEntry: null })), false);
});

test("dimension accounting: per-turn expiry clears dimension and wildcard keys", () => {
  recordWireOptimizationRejection("glm-5.3", "https://d.example.com/v3", "e", "thinking");
  recordWireOptimizationRejection("glm-5.3", "https://d.example.com/v4", "e", "*");
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://d.example.com/v3", "thinking"), false);
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://d.example.com/v4", "thinking"), false);
  resetWireProbe(); // 新用户轮次
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://d.example.com/v3", "thinking"), true);
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://d.example.com/v4", "thinking"), true);
});

// ── round-3 G5/G7/G8：per-session 记账隔离 / 目录大小写回退 / 三态派生 ────────

test("probe accounting is session-scoped: another session's reset never re-arms my vetoes (G5)", () => {
  recordWireOptimizationRejection("glm-5.3", "https://d.example.com/v1", "e", "thinking", "session-A");
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://d.example.com/v1", "thinking", "session-A"), false);
  // 会话 B 的用户轮只清自己的记账——A 的 veto 存活。
  resetWireProbe("session-B");
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://d.example.com/v1", "thinking", "session-A"), false);
  // A 自己的新用户轮过期自己的记账（端点可能在两轮之间被修复）。
  resetWireProbe("session-A");
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://d.example.com/v1", "thinking", "session-A"), true);
});

test("catalog lookup falls back case-insensitively (G7: minimax-m3 vs MiniMax-M3)", () => {
  configureModelCatalog(
    JSON.stringify({
      minimax: {
        api: "https://api.minimax.test/v1",
        models: {
          "MiniMax-M3": {
            reasoning: true,
            tool_call: true,
            reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
          },
        },
      },
      ...Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`filler${i}`, { models: {} }])),
    })
  );
  try {
    const pascal = catalogLookupModel("MiniMax-M3");
    const lower = catalogLookupModel("minimax-m3");
    assert.ok(pascal && lower, "both spellings must resolve");
    // 白名单小写命中后，目录派生必须同源——不同拼写不得拿到不同 wire。
    const viaPascal = resolveModelProfile({ model: "MiniMax-M3", catalogEntry: pascal });
    const viaLower = resolveModelProfile({ model: "minimax-m3", catalogEntry: lower });
    assert.equal(viaPascal.wire.thinkingMandatory, viaLower.wire.thinkingMandatory);
    assert.deepEqual(viaPascal.wire.effortValues, viaLower.wire.effortValues);
  } finally {
    configureModelCatalog(null);
  }
});

test("tri-state: reasoning:true with EMPTY reasoning_options is unknown, never stamped false (G8)", () => {
  // kimi-k2.7 生产形态（moonshotai-cn 空声明）——目录没给控制形状。
  const profile = resolveModelProfile({
    model: "kimi-k2.7-code",
    catalogEntry: { id: "kimi-k2.7-code", reasoning: true, toolCall: true, multimodal: false },
  });
  assert.equal(profile.wire.thinkingMandatory, undefined, "no control shape declared → unknown, not known-off");
  // 对照：有形状声明（纯 effort 阶梯）→ 实证不可关 true。
  const known = resolveModelProfile({
    model: "kimi-k2.7-code",
    catalogEntry: {
      id: "kimi-k2.7-code",
      reasoning: true,
      toolCall: true,
      multimodal: false,
      reasoningOptions: [{ type: "effort", values: ["low", "high"] }],
    },
  });
  assert.equal(known.wire.thinkingMandatory, true);
});

// ── round-4 H5/M7/M10：联合读 / 会话删除回收 / budget-only 三态 ─────────────

test("unkeyed queries consult ALL session buckets (H5): aux calls honor any session's veto", () => {
  recordWireOptimizationRejection("glm-5.3", "https://u.example.com/v1", "e", "thinking", "session-A");
  // 无 sessionId（辅助调用形态）：联合读命中 A 的记账。
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://u.example.com/v1", "thinking"), false);
  // 有 sessionId 的其它会话：只读自己的桶，不受 A 影响（主循环语义不变）。
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://u.example.com/v1", "thinking", "session-B"), true);
  // A 过期自己的记账后，最后一个持有者消失 → 联合读恢复乐观。
  resetWireProbe("session-A");
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://u.example.com/v1", "thinking"), true);
});

test("resetWireProbe(undefined) only clears the unkeyed bucket — never other sessions (H1)", () => {
  recordWireOptimizationRejection("glm-5.3", "https://u2.example.com/v1", "e", "*", "session-A");
  recordWireOptimizationRejection("glm-5.3", "https://u2.example.com/v1", "e", "*", undefined);
  resetWireProbe(undefined);
  // "" 桶被清；A 的桶存活。
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://u2.example.com/v1", "thinking", "session-A"), false);
});

test("budget-only reasoning_options is unknown, never known-off (M10)", () => {
  const profile = resolveModelProfile({
    model: "kimi-k3",
    catalogEntry: {
      id: "kimi-k3",
      reasoning: true,
      toolCall: true,
      multimodal: false,
      reasoningOptions: [{ type: "budget_tokens" } as never],
    },
  });
  assert.equal(profile.wire.thinkingMandatory, undefined, "budget-only control shape is not evidence of off-ability");
});

test("channel key strips query strings (L12): key-in-query never lands in probe keys", () => {
  recordWireOptimizationRejection("glm-5.3", "https://api.example.com/v1?key=SECRET", "e", "thinking", "s");
  // 无 query 的同 origin+path 查询命中同一键——证明键本身剥了 query。
  assert.equal(shouldApplyWireOptimizations("glm-5.3", "https://api.example.com/v1", "thinking", "s"), false);
});
