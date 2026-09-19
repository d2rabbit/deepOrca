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
