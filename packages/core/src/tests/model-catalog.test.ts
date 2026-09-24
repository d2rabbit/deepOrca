// models.dev catalog battery (specs/model-fleet-adaptation §七 X3.2):
// fail-open behavior, UNKNOWN-family facade enhancement (native families
// always win), host-keyed suggestions, cost multipliers.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  configureCatalogHints,
  configureModelCatalog,
  hasModelCatalog,
  catalogLookupModel,
  catalogSuggestModels,
} from "../common/model-catalog";
import {
  defaultsToThinkingMode,
  getCompactPromptTokenThreshold,
  resolveBackgroundLlm,
  supportsMultimodal,
} from "../common/model-capabilities";

/** Build a fixture snapshot: 20 providers (sanity floor) with real data on two. */
function fixtureJson(): string {
  const providers: Record<string, unknown> = {};
  for (let i = 0; i < 18; i += 1) {
    providers[`filler-${i}`] = { id: `filler-${i}`, api: `https://filler-${i}.test`, models: {} };
  }
  providers["zhipuai"] = {
    id: "zhipuai",
    api: "https://api.zhipuai.test",
    npm: "@ai-sdk/openai-compatible",
    models: {
      "glm-5-plus": {
        id: "glm-5-plus",
        name: "GLM 5 Plus",
        attachment: false,
        reasoning: true,
        tool_call: true,
        limit: { context: 260_000, output: 32_000 },
        cost: { input: 0.6, output: 2.2, cache_read: 0.06 },
      },
      "glm-5-air": {
        id: "glm-5-air",
        name: "GLM 5 Air",
        attachment: false,
        reasoning: false,
        tool_call: true,
        limit: { context: 128_000, output: 16_000 },
        cost: { input: 0.1, output: 0.4 },
      },
    },
  };
  providers["minimax"] = {
    id: "minimax",
    api: "https://api.minimax.test/v1",
    npm: "@ai-sdk/anthropic",
    models: {
      "minimax-m3": {
        id: "minimax-m3",
        attachment: true,
        reasoning: true,
        tool_call: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_000_000, output: 64_000 },
      },
    },
  };
  return JSON.stringify(providers);
}

beforeEach(() => {
  configureModelCatalog(null);
});

test("no catalog: everything fails open to today's behavior", () => {
  assert.equal(hasModelCatalog(), false);
  assert.equal(catalogLookupModel("glm-5-plus"), null);
  assert.deepEqual(catalogSuggestModels("https://api.zhipuai.test"), []);
  // UNKNOWN-family registry default (200K in the current registry) stands.
  assert.equal(getCompactPromptTokenThreshold("glm-5-plus"), 200 * 1024);
  assert.equal(supportsMultimodal("glm-5-plus"), true);
});

test("malformed or undersized snapshots are rejected (proxied error pages)", () => {
  configureModelCatalog("<html>gateway error</html>");
  assert.equal(hasModelCatalog(), false);
  configureModelCatalog(JSON.stringify({ "only-one": { api: "https://x.test", models: {} } }));
  assert.equal(hasModelCatalog(), false);
  assert.equal(catalogLookupModel("glm-5-plus"), null);
});

test("UNKNOWN-family facades enrich from the catalog; native families keep their values", () => {
  configureModelCatalog(fixtureJson());

  // UNKNOWN family: the catalog's real window beats the registry's blind default.
  assert.equal(getCompactPromptTokenThreshold("glm-5-plus"), 260_000);
  // UNKNOWN family: catalog multimodal default beats the blind true.
  assert.equal(supportsMultimodal("minimax-m3"), true);
  // Native deepseek family ALWAYS wins over the catalog (R12: resolution
  // order unchanged — the catalog never overrides a registered family).
  assert.equal(getCompactPromptTokenThreshold("deepseek-v4-pro"), 512 * 1024);
  // User registration still overrides everything.
  assert.equal(supportsMultimodal("glm-5-plus", { vision: true }), true);
  assert.equal(supportsMultimodal("minimax-m3", { vision: false }), false);
});

test("suggestions are host-keyed, reasoning-first, and fail-open on unknown hosts", () => {
  configureModelCatalog(fixtureJson());
  const suggestions = catalogSuggestModels("https://api.zhipuai.test/v1");
  assert.deepEqual(
    suggestions.map((s) => s.id),
    ["glm-5-plus", "glm-5-air"] // reasoning model first
  );
  assert.equal(suggestions[0]?.reasoning, true);
  assert.equal(suggestions[0]?.contextTokens, 260_000);
  assert.deepEqual(catalogSuggestModels("https://unknown.example.test"), []);
});

test("R12 red line: catalog reasoning never leaks into thinking defaults or background routing", () => {
  configureModelCatalog(fixtureJson());
  // glm-5-plus has reasoning:true in the catalog — but the registry facades
  // must NOT derive thinking defaults from it (protocol semantics stay
  // hand-curated; the settings prefill expresses it as a USER registration).
  assert.equal(defaultsToThinkingMode("glm-5-plus"), false);
  // No lightweight model may be invented for catalog-only models — the
  // background chain falls through to primary as before.
  const resolved = resolveBackgroundLlm({ primaryModel: "glm-5-plus" });
  assert.deepEqual(resolved, { tier: "primary", model: "glm-5-plus" });
});

test("slim hints (renderer leg): facades enrich from hints when no full catalog exists", () => {
  configureModelCatalog(null);
  configureCatalogHints({ "glm-5-plus": { contextTokens: 260_000, multimodal: false } });
  // No full snapshot — the hint alone drives the UNKNOWN-family enhancement.
  assert.equal(getCompactPromptTokenThreshold("glm-5-plus"), 260_000);
  assert.equal(supportsMultimodal("glm-5-plus"), false);
  // Native families still win over hints.
  assert.equal(getCompactPromptTokenThreshold("deepseek-v4-pro"), 512 * 1024);
  configureCatalogHints(null);
  assert.equal(getCompactPromptTokenThreshold("glm-5-plus"), 200 * 1024);
});

// ── round-3 G3：同 id 多第一方碰撞——厂商自有序在第一方序之上 ────────────────

test("collision: the vendor's OWN entry beats a first-party reseller entry (kimi-k3 seam)", () => {
  // 复刻生产快照的碰撞形态：alibaba-cn（第一方转售）声明 effort-only 阶梯，
  // moonshotai（厂商自家）声明 toggle+effort。自有序必须让 moonshotai 胜出
  // ——否则 kimi-k3 被误判 thinkingMandatory=true，用户关思考被强制打开。
  const providers: Record<string, unknown> = {};
  for (let i = 0; i < 17; i += 1) {
    providers[`filler-${i}`] = { id: `filler-${i}`, api: `https://filler-${i}.test`, models: {} };
  }
  // 文件序上转售渠道在前——自有序必须穿透 first-wins。
  providers["alibaba-cn"] = {
    id: "alibaba-cn",
    api: "https://dashscope.cn",
    models: {
      "kimi-k3": {
        id: "kimi-k3",
        reasoning: true,
        tool_call: true,
        temperature: false,
        reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
      },
    },
  };
  providers["moonshotai"] = {
    id: "moonshotai",
    api: "https://api.moonshot.ai/v1",
    models: {
      "kimi-k3": {
        id: "kimi-k3",
        reasoning: true,
        tool_call: true,
        reasoning_options: [{ type: "toggle" }, { type: "effort", values: ["low", "high", "max"] }],
      },
    },
  };
  providers["bothub"] = {
    id: "bothub",
    api: "https://bothub.test",
    models: {
      // 聚合商条目永远兜底——不参与前两序。
      "kimi-k3": { id: "kimi-k3", reasoning: false, tool_call: false },
    },
  };
  configureModelCatalog(JSON.stringify(providers));

  // 判定面：toggle 在场 → thinkingMandatory 必须为 false（moonshotai 胜出）。
  const entry = catalogLookupModel("kimi-k3");
  assert.ok(entry, "kimi-k3 must resolve");
  assert.deepEqual(
    entry?.reasoningOptions?.map((option) => option.type),
    ["toggle", "effort"],
    "the vendor's own entry (toggle+effort) must win over the reseller's effort-only claim"
  );
});
