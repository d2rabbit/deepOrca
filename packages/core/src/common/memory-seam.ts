/**
 * Host-side binders for the action-facing memory/behavior seams
 * (specs/sop-extraction P2.1/P2.2). Extracted as pure functions so the
 * availability gate, the sync-throw guard and the 2s race budget are
 * unit-testable without instantiating a SessionManager.
 */

import { withTimeoutNull } from "./timeout";

/** Structural slice of MemoryProvider — keeps this module layer-free. */
type KnownMemorySource = {
  isAvailable(): boolean;
  searchMemories(query: string, limit?: number): Promise<{ text: string } | null>;
};

/**
 * Read-only L1 lookup behind the same 2s race budget as the session-creation
 * recall. Absent, unavailable, failing (sync or async), slow or empty-result
 * memory all degrade to null — the caller's slot simply stays empty.
 */
export function bindKnownMemorySearch(
  getProvider: () => KnownMemorySource | null,
  ms = 2000
): (query: string, limit?: number) => Promise<string | null> {
  return (query, limit) => {
    if (!query.trim()) return Promise.resolve(null);
    try {
      const provider = getProvider();
      if (!provider || !provider.isAvailable()) return Promise.resolve(null);
      return withTimeoutNull(
        provider
          .searchMemories(query, limit)
          .then((hit) => (hit && typeof hit.text === "string" && hit.text.trim() ? hit.text : null)),
        ms
      );
    } catch {
      return Promise.resolve(null);
    }
  };
}

/**
 * Behavioral profile collector behind an explicit opt-in gate (the same
 * settings.behaviorContext gate as the boot-context injection). Gated off,
 * empty or throwing collectors degrade to null. The optional `fallback`
 * (specs/sop-extraction P2.2: profile block behind the workflow-oriented
 * builder) is tried only when the primary collector YIELDS null/blank — a
 * throwing primary aborts both legs (fail-closed to null: don't run more
 * collectors in an environment that just proved broken).
 */
export function bindBehaviorContextCollector(
  isEnabled: () => boolean,
  collect: () => string | null,
  fallback?: () => string | null
): () => string | null {
  return () => {
    try {
      if (!isEnabled()) return null;
      const block = collect();
      if (block && block.trim()) return block;
      if (fallback) {
        const fb = fallback();
        if (fb && fb.trim()) return fb;
      }
      return null;
    } catch {
      return null;
    }
  };
}
