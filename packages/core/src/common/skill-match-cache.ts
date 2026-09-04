/**
 * Prompt-keyed cache for LLM skill matching (Phase 3 / T3.2,
 * specs/memory-remediation, defect D3).
 *
 * `identifyMatchingSkillNames` runs one flash-model classification per user
 * prompt — and the deferred-permission path re-sends the SAME prompt after a
 * permission grant, burning the identical call twice. This cache keys on
 * (candidate-pool signature, prompt text): a hit skips both the G1 embedding
 * shortlist and the LLM call. A pool change (skills added/removed/renamed)
 * changes the signature, so stale matches cannot leak across skill-set edits.
 *
 * Deliberately un-bounded by time: matches are deterministic-ish for a fixed
 * pool, and the FIFO cap keeps memory bounded. Empty results ARE cached —
 * "no skill matches this prompt" is a valid, repeatable answer.
 *
 * depth-lane (P0.3): the SAME single call now also returns the complexity
 * verdict, so the verdict rides the SAME cache key — one cache, one eviction
 * policy, no second cache. `getWithLane` replays skillNames + lane together;
 * the legacy `get` keeps the string[] shape so existing callers are unchanged.
 */

export type CachedLaneVerdict = {
  lane: "express" | "deep";
  T: number;
  P: number;
  C: number;
  R: number;
  reason: string | null;
};

export class SkillMatchCache {
  private readonly entries = new Map<string, string[]>();
  private readonly laneEntries = new Map<string, CachedLaneVerdict>();

  constructor(private readonly maxEntries = 64) {}

  /** Stable signature of the candidate pool (sorted names). */
  static poolSignature(skills: Array<{ name: string }>): string {
    return skills
      .map((skill) => skill.name)
      .sort()
      .join(",");
  }

  get(poolSignature: string, prompt: string): string[] | undefined {
    return this.entries.get(this.key(poolSignature, prompt));
  }

  /**
   * Replay skillNames AND the cached complexity verdict in one lookup. The
   * verdict is absent when the entry was cached with the gate disabled — the
   * caller then simply proceeds without a replayed verdict (fail-open).
   */
  getWithLane(
    poolSignature: string,
    prompt: string
  ): { skillNames: string[]; verdict?: CachedLaneVerdict } | undefined {
    const skillNames = this.entries.get(this.key(poolSignature, prompt));
    if (skillNames === undefined) {
      return undefined;
    }
    return { skillNames, verdict: this.laneEntries.get(this.key(poolSignature, prompt)) };
  }

  set(poolSignature: string, prompt: string, matched: string[], verdict?: CachedLaneVerdict): void {
    const key = this.key(poolSignature, prompt);
    // Refresh insertion order on re-set so recently used entries survive eviction.
    this.entries.delete(key);
    this.entries.set(key, matched);
    if (verdict) {
      this.laneEntries.set(key, verdict);
    } else {
      this.laneEntries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.laneEntries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
    this.laneEntries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private key(poolSignature: string, prompt: string): string {
    return `${poolSignature}\u0000${prompt}`;
  }
}
