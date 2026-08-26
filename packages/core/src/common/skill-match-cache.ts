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
 */
export class SkillMatchCache {
  private readonly entries = new Map<string, string[]>();

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

  set(poolSignature: string, prompt: string, matched: string[]): void {
    const key = this.key(poolSignature, prompt);
    // Refresh insertion order on re-set so recently used entries survive eviction.
    this.entries.delete(key);
    this.entries.set(key, matched);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private key(poolSignature: string, prompt: string): string {
    return `${poolSignature}\u0000${prompt}`;
  }
}
