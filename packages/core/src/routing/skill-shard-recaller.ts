/**
 * SkillShardRecaller — G3 recall side: rank a sharded skill's sections against
 * the current user prompt via the shared embedding service + VectorIndex
 * (content-hash disk cache keeps re-injection cheap across turns).
 *
 * Fail-open: ANY failure (no service, not ready, embed error, too few shards)
 * returns null and the caller injects the FULL document — routing can never
 * break a session (design.md §铁律 2).
 */

import { VectorIndex, type VectorIndexEntry } from "./vector-index";
import type { RoutingEmbeddingService } from "./types";
import type { SkillShard, ShardedSkillDocument } from "./skill-sharding";

export class SkillShardRecaller {
  private readonly index: VectorIndex;
  private readonly embeddingService: RoutingEmbeddingService | null;
  /** Cache key: last shard set indexed (per skill — recalled one skill at a time). */
  private indexedSignature: string | null = null;

  constructor(embeddingService: RoutingEmbeddingService | null, cacheDir?: string) {
    this.embeddingService = embeddingService;
    this.index = new VectorIndex({ cacheDir });
    if (embeddingService) {
      this.index.attach(embeddingService);
    }
  }

  /**
   * Recall the top-K shards for `query`. Returns null when recall cannot run
   * (fail-open → full document) — never throws.
   */
  async recall(query: string, doc: ShardedSkillDocument, topK: number): Promise<SkillShard[] | null> {
    if (!this.embeddingService || !this.embeddingService.isReady()) return null;
    if (!query.trim() || doc.shards.length <= topK) return null;

    try {
      const entries: VectorIndexEntry[] = doc.shards.map((s) => ({
        id: String(s.id),
        // Heading weighted first: section titles carry the routing signal.
        text: `${s.heading}\n${s.heading}\n${s.text.slice(0, 600)}`,
      }));
      const signature = `${entries.length}:${entries.map((e) => e.text.length).join(",")}`;
      if (signature !== this.indexedSignature) {
        const ok = await this.index.rebuild(entries);
        if (!ok) return null;
        this.indexedSignature = signature;
      }
      const hits = await this.index.query(query, topK);
      const byId = new Map(doc.shards.map((s) => [String(s.id), s]));
      const picked = hits.map((h) => byId.get(h.id)).filter((s): s is SkillShard => Boolean(s));
      return picked.length > 0 ? picked : null;
    } catch {
      return null;
    }
  }
}
