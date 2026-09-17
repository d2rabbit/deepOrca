// Token price estimates (P2 of the token-statistics rework; X3.4 upgrade
// 2026-09-17: the vendored models.dev catalog is now the PRIMARY pricing
// source — fresher and broader (7.8k models, cache-read tier included) than
// any hand-tuned table — with the built-in DeepSeek ballparks kept as the
// offline fallback when no catalog snapshot is vendored).
//
// Pure data + lookup — the cost column is an ESTIMATE rendered with a "≈":
// local usage counts already carry tokenizer-fidelity error, prices drift,
// and cache-discount tiers beyond the read tier are not modeled. Unknown
// models price as null (the UI hides the cost).

import { catalogLookupModel } from "@deeporca/core";

export type TokenPrice = {
  /** USD per 1M prompt tokens. */
  promptUsdPerM: number;
  /** USD per 1M completion tokens. */
  completionUsdPerM: number;
  /** USD per 1M cached prompt tokens (models.dev cache_read tier). */
  cacheReadUsdPerM?: number;
};

/** First match wins; patterns are checked case-insensitively on the model id. */
const PRICES: Array<{ match: RegExp; price: TokenPrice }> = [
  // DeepSeek list-price ballpark (2026 public pricing pages; estimates).
  // Offline fallback — the models.dev catalog wins whenever it knows the model.
  { match: /^deepseek-v4-flash/i, price: { promptUsdPerM: 0.07, completionUsdPerM: 0.28 } },
  { match: /^deepseek-v4-pro/i, price: { promptUsdPerM: 0.28, completionUsdPerM: 1.1 } },
  { match: /^deepseek-(chat|v3)/i, price: { promptUsdPerM: 0.27, completionUsdPerM: 1.1 } },
  { match: /^deepseek-(reasoner|r1)/i, price: { promptUsdPerM: 0.55, completionUsdPerM: 2.18 } },
];

export function priceForModel(model: string): TokenPrice | null {
  const trimmed = model.trim();
  if (!trimmed) return null;
  // models.dev catalog (§七 X3.4): exact-id lookup, fail-open to the table.
  // Require the INPUT price to use the catalog — an output-only entry would
  // silently price prompt tokens as free, which reads as "unknown" in the UI.
  const entry = catalogLookupModel(trimmed);
  if (entry && entry.costInputPerMTok !== undefined) {
    return {
      promptUsdPerM: entry.costInputPerMTok,
      completionUsdPerM: entry.costOutputPerMTok ?? 0,
      ...(entry.costCacheReadPerMTok !== undefined ? { cacheReadUsdPerM: entry.costCacheReadPerMTok } : {}),
    };
  }
  const hit = PRICES.find((entry) => entry.match.test(trimmed));
  return hit?.price ?? null;
}

/**
 * Estimated USD spend over a per-model usage table. Returns null when NO
 * priced model contributed anything (nothing to show), and silently skips
 * unpriced models (their cost is unknown, not zero). Cache-read tokens use
 * the catalog's cache_read tier when present (DeepSeek's discount is real
 * and large — ignoring it overstated flash spend badly in real workspaces).
 */
export function estimateCostUsd(
  perModel: Record<string, { prompt: number; completion: number; cacheRead?: number }>
): number | null {
  let cost = 0;
  let priced = false;
  for (const [model, usage] of Object.entries(perModel)) {
    const price = priceForModel(model);
    if (!price || !usage) continue;
    const cacheRead = Math.max(0, Math.min(usage.cacheRead ?? 0, usage.prompt));
    const cachePrice = price.cacheReadUsdPerM ?? price.promptUsdPerM;
    cost += ((usage.prompt - cacheRead) / 1_000_000) * price.promptUsdPerM;
    cost += (cacheRead / 1_000_000) * cachePrice;
    cost += (usage.completion / 1_000_000) * price.completionUsdPerM;
    priced = true;
  }
  return priced ? cost : null;
}
