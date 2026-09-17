// Token pricing (specs/model-fleet-adaptation §七 X3.4): the vendored
// models.dev catalog is the PRIMARY price source (with the cache-read tier),
// the built-in DeepSeek ballpark table is the offline fallback, and unknown
// models price as null (the UI hides the cost).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { configureModelCatalog } from "@deeporca/core";
import { estimateCostUsd, priceForModel } from "../main/tools/token-pricing";

function fixtureJson(): string {
  const providers: Record<string, unknown> = {};
  // 19 fillers + zhipuai = the 20-provider sanity floor in core's parser.
  for (let i = 0; i < 19; i += 1) {
    providers[`filler-${i}`] = { id: `filler-${i}`, api: `https://filler-${i}.test`, models: {} };
  }
  providers["zhipuai"] = {
    id: "zhipuai",
    api: "https://api.zhipuai.test",
    models: {
      "glm-5-plus": {
        id: "glm-5-plus",
        attachment: false,
        reasoning: true,
        tool_call: true,
        limit: { context: 260_000, output: 32_000 },
        cost: { input: 0.6, output: 2.2, cache_read: 0.06 },
      },
    },
  };
  return JSON.stringify(providers);
}

beforeEach(() => {
  configureModelCatalog(null);
});

test("catalog prices win over the built-in table and carry the cache-read tier", () => {
  configureModelCatalog(fixtureJson());
  const price = priceForModel("glm-5-plus");
  assert.ok(price);
  assert.equal(price.promptUsdPerM, 0.6);
  assert.equal(price.completionUsdPerM, 2.2);
  assert.equal(price.cacheReadUsdPerM, 0.06);
});

test("cost estimate uses the cache-read tier and clamps overflow", () => {
  configureModelCatalog(fixtureJson());
  // (1M − 400K) × $0.6 + 400K × $0.06 + 500K × $2.2 = $1.484.
  const cost = estimateCostUsd({ "glm-5-plus": { prompt: 1_000_000, completion: 500_000, cacheRead: 400_000 } });
  assert.ok(Math.abs((cost ?? 0) - 1.484) < 1e-9);
  // Overflow clamp: cacheRead beyond prompt counts at most prompt tokens.
  const clamped = estimateCostUsd({ "glm-5-plus": { prompt: 1000, completion: 0, cacheRead: 5000 } });
  assert.ok(Math.abs((clamped ?? 0) - (1000 * 0.06) / 1_000_000) < 1e-15);
});

test("unpriced models cost null; the fallback table covers deepseek offline", () => {
  configureModelCatalog(fixtureJson());
  // Catalog model WITHOUT pricing (no cost fields) → null, not zero.
  assert.equal(estimateCostUsd({ "totally-unknown-model": { prompt: 1_000_000, completion: 500_000 } }), null);
  // Offline fallback: deepseek-v4-pro prices from the built-in ballpark table
  // even with a catalog snapshot that does not know it.
  const fallback = estimateCostUsd({ "deepseek-v4-pro": { prompt: 1_000_000, completion: 1_000_000 } });
  assert.ok(Math.abs((fallback ?? 0) - (0.28 + 1.1)) < 1e-9);
  // An output-only catalog entry must NOT price prompts as free — fall back.
  configureModelCatalog(null);
  configureModelCatalog(fixtureJson());
  assert.equal(priceForModel("glm-5-plus")?.promptUsdPerM, 0.6);
});
