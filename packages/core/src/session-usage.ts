// Usage-accounting math shared by the session engine (token/cache tallies).
import type { ModelUsage } from "./session-types";

export function isUsageRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addUsageValue(current: unknown, next: unknown): unknown {
  if (typeof next === "number") {
    return (typeof current === "number" ? current : 0) + next;
  }

  if (isUsageRecord(next)) {
    const currentRecord = isUsageRecord(current) ? current : {};
    const result: Record<string, unknown> = { ...currentRecord };
    for (const [key, value] of Object.entries(next)) {
      result[key] = addUsageValue(currentRecord[key], value);
    }
    return result;
  }

  return next;
}

export function accumulateUsage(current: ModelUsage | null, next: unknown | null | undefined): ModelUsage | null {
  if (next == null) {
    return current ?? null;
  }
  return addUsageValue(current, next) as ModelUsage;
}

function usageWithRequestCount(usage: ModelUsage): ModelUsage {
  const totalReqs = typeof usage.total_reqs === "number" ? usage.total_reqs + 1 : 1;
  return {
    ...usage,
    total_reqs: totalReqs,
  };
}

export function accumulateUsagePerModel(
  current: Record<string, ModelUsage> | null | undefined,
  model: string,
  next: ModelUsage | null | undefined
): Record<string, ModelUsage> | null {
  if (next == null) {
    return current ?? null;
  }

  const usagePerModel = { ...(current ?? {}) };
  const modelName = model.trim() || "unknown";
  usagePerModel[modelName] = accumulateUsage(usagePerModel[modelName] ?? null, usageWithRequestCount(next))!;
  return usagePerModel;
}

/**
 * Prompt-side size of the most recent request: every token the model had to
 * ingest (cache hits included, since they still occupy the context window).
 * This — not cumulative total_tokens — is the right pressure reading for the
 * compaction threshold.
 */
export function getLastPromptTokens(usage: ModelUsage | null | undefined): number {
  if (!isUsageRecord(usage)) {
    return 0;
  }
  const promptTokens = usage.prompt_tokens;
  return typeof promptTokens === "number" ? promptTokens : 0;
}

function getCacheReadTokens(usage: ModelUsage | null | undefined): number {
  if (!isUsageRecord(usage)) {
    return 0;
  }
  const deepseekCacheHit = usage.prompt_cache_hit_tokens;
  if (typeof deepseekCacheHit === "number") {
    return deepseekCacheHit;
  }
  const details = isUsageRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : null;
  const openAiCached = details?.cached_tokens;
  return typeof openAiCached === "number" ? openAiCached : 0;
}

/**
 * Input tokens that actually hit the model fresh (prompt minus cache reads).
 * Mirrors dsh's mutually-exclusive conversion: cache hits are already paid for
 * at the cache-read rate and must not be double-counted as fresh input.
 */
export function getFreshInputTokens(usage: ModelUsage | null | undefined): number {
  const promptTokens = getLastPromptTokens(usage);
  return Math.max(0, promptTokens - getCacheReadTokens(usage));
}
