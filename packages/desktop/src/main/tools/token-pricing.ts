// Built-in token price estimates (P2 of the token-statistics rework).
//
// Pure data + lookup — the cost column is an ESTIMATE rendered with a "≈":
// local usage counts already carry tokenizer-fidelity error, prices drift,
// and cache-discount tiers are not modeled. Unknown models price as null
// (the UI hides the cost). To retune, edit PRICES — no code changes needed.
// A user-facing settings override is a deliberate follow-up, not shipped yet.

export type TokenPrice = {
  /** USD per 1M prompt tokens. */
  promptUsdPerM: number;
  /** USD per 1M completion tokens. */
  completionUsdPerM: number;
};

/** First match wins; patterns are checked case-insensitively on the model id. */
const PRICES: Array<{ match: RegExp; price: TokenPrice }> = [
  // DeepSeek list-price ballpark (2026 public pricing pages; estimates).
  { match: /^deepseek-v4-flash/i, price: { promptUsdPerM: 0.07, completionUsdPerM: 0.28 } },
  { match: /^deepseek-v4-pro/i, price: { promptUsdPerM: 0.28, completionUsdPerM: 1.1 } },
  { match: /^deepseek-(chat|v3)/i, price: { promptUsdPerM: 0.27, completionUsdPerM: 1.1 } },
  { match: /^deepseek-(reasoner|r1)/i, price: { promptUsdPerM: 0.55, completionUsdPerM: 2.18 } },
];

export function priceForModel(model: string): TokenPrice | null {
  const trimmed = model.trim();
  if (!trimmed) return null;
  const hit = PRICES.find((entry) => entry.match.test(trimmed));
  return hit?.price ?? null;
}

/**
 * Estimated USD spend over a per-model usage table. Returns null when NO
 * priced model contributed anything (nothing to show), and silently skips
 * unpriced models (their cost is unknown, not zero).
 */
export function estimateCostUsd(perModel: Record<string, { prompt: number; completion: number }>): number | null {
  let cost = 0;
  let priced = false;
  for (const [model, usage] of Object.entries(perModel)) {
    const price = priceForModel(model);
    if (!price || !usage) continue;
    cost += (usage.prompt / 1_000_000) * price.promptUsdPerM;
    cost += (usage.completion / 1_000_000) * price.completionUsdPerM;
    priced = true;
  }
  return priced ? cost : null;
}
