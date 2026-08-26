// Small shared helpers for the session layer.

/**
 * Whether a UI locale string denotes a Chinese variant. Used by document readers
 * to prefer a sibling `.zh.md` localized doc when present. Kept in core (not the
 * desktop layer) so the locale decision is centralized and UI-agnostic.
 */
export function isChineseLocale(locale?: string): boolean {
  if (!locale) return false;
  const lower = locale.toLowerCase();
  return lower === "zh" || lower.startsWith("zh-");
}

export function summarizeCompletionOptions(options?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!options) {
    return undefined;
  }
  return {
    ...options,
    signal: options.signal instanceof AbortSignal ? { aborted: options.signal.aborted } : options.signal,
  };
}
