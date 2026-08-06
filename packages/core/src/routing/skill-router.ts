/**
 * SkillRouter — G1: reduces the skill candidate list via embedding recall.
 *
 * Before this, every user message sent ALL skill names+descriptions to a
 * flash LLM for classification. With many skills this is expensive and noisy.
 * SkillRouter embeds all skills once (cached), embeds the user prompt, and
 * returns a top-K shortlist — the flash LLM then only classifies the few.
 *
 * Fail-open: if the embedding model is unavailable or anything errors, returns
 * null and the caller uses the full candidate list (identical to pre-routing
 * behavior).
 */

import { VectorIndex, type VectorIndexEntry } from "./vector-index";
import type {
  ComposeOptions,
  CompositionalSkill,
  CompositionPlan,
  LLMDecomposer,
  RoutingConfig,
  RoutingEmbeddingService,
  RoutableSkill,
  SkillCandidate,
  SkillRouter,
  SubTask,
} from "./types";
import { runSad, type SadOptions } from "./sad";
import { composePlan } from "./composer";

export class SkillRouterImpl implements SkillRouter {
  private index: VectorIndex;
  private config: RoutingConfig;
  private embeddingService: RoutingEmbeddingService | null = null;
  /** Cache key: the last candidate set we indexed (by content hash). */
  private indexedSignature: string | null = null;

  constructor(config: RoutingConfig, embeddingService: RoutingEmbeddingService | null, cacheDir?: string) {
    this.config = config;
    this.embeddingService = embeddingService;
    this.index = new VectorIndex({ cacheDir });
    if (embeddingService) {
      this.index.attach(embeddingService);
    }
  }

  async shortlist(
    prompt: string,
    candidates: RoutableSkill[],
    opts?: { topK?: number }
  ): Promise<RoutableSkill[] | null> {
    // Fail-open: no embedding service, or routing disabled.
    if (!this.config.enabled || !this.embeddingService || !this.embeddingService.isReady()) {
      return null;
    }

    // Small pool → skip routing (cheaper to just classify all).
    if (candidates.length <= this.config.skillMinPool) {
      return null;
    }

    const topK = opts?.topK ?? this.config.skillTopK;

    // Separate already-loaded skills (always pass through, don't count vs topK).
    const loaded = candidates.filter((s) => s.isLoaded);
    const routable = candidates.filter((s) => !s.isLoaded);

    if (routable.length <= topK) {
      // Not enough routable candidates to warrant embedding.
      return null;
    }

    try {
      // Rebuild index if candidate set changed.
      await this.ensureIndexed(routable);

      const hits = await this.index.query(prompt, topK);
      if (hits.length === 0) return null;

      const hitIds = new Set(hits.map((h) => h.id));
      const shortlisted = routable.filter((s) => hitIds.has(s.name));

      // Merge loaded skills back in.
      return [...loaded, ...shortlisted];
    } catch {
      return null; // fail-open
    }
  }

  /**
   * Compositional routing (M4 — SkillWeaver Decompose-Retrieve-Compose).
   *
   * Pipeline:
   *   1. SAD: decompose the query into atomic sub-tasks (with skill hints).
   *   2. Retrieve: bi-encoder top-K candidates per sub-task.
   *   3. Compose: compatibility-aware selection + DAG construction.
   *
   * Fail-open: returns null if any stage fails or the query is atomic (single
   * sub-task) — callers should fall back to shortlist().
   */
  async composeRoute(
    query: string,
    candidates: CompositionalSkill[],
    decomposer: LLMDecomposer,
    opts?: ComposeOptions
  ): Promise<CompositionPlan | null> {
    if (!this.config.enabled || !this.embeddingService || !this.embeddingService.isReady()) {
      return null;
    }
    if (candidates.length === 0) return null;

    const options = opts ?? {};
    const sadOpts: SadOptions = {
      maxIterations: options.maxSadIterations ?? 1,
      convergenceThreshold: options.sadConvergenceThreshold ?? 0.6,
      hintCount: options.sadHintCount ?? 15,
    };

    try {
      // Stage 1: SAD decomposition.
      await this.ensureIndexedCompositional(candidates);
      const subTasks = await runSad(decomposer, this.index, query, candidates, sadOpts);

      if (!subTasks || subTasks.length === 0) return null;
      // Single sub-task → not compositional; caller should use shortlist().
      if (subTasks.length === 1) return null;

      // Stage 2: Retrieve candidates per sub-task.
      const retrieveK = options.retrieveTopK ?? 10;
      const candidateLists: SkillCandidate[][] = [];
      for (const st of subTasks) {
        const hits = await this.index.query(st.description, retrieveK);
        const cands: SkillCandidate[] = [];
        const skillMap = new Map(candidates.map((s) => [s.name, s]));
        for (const h of hits) {
          const skill = skillMap.get(h.id);
          if (skill) {
            cands.push({ skill, similarity: h.score });
          }
        }
        candidateLists.push(cands);
      }

      // Stage 3: Compose (compatibility-aware selection + DAG).
      const plan = composePlan(subTasks, candidateLists, {
        alpha: options.alpha ?? 0.5,
        minSelectionScore: options.minSelectionScore ?? 0.3,
      });

      return plan;
    } catch {
      return null; // fail-open
    }
  }

  private async ensureIndexedCompositional(skills: CompositionalSkill[]): Promise<void> {
    // Compositional skills may have richer metadata; index text includes categories.
    const signature = skills.map((s) => `${s.name}\0${s.description}\0${(s.categories ?? []).join(",")}`).join("\n");
    if (signature === this.indexedSignature && this.index.size > 0) return;

    const entries: VectorIndexEntry[] = skills.map((s) => ({
      id: s.name,
      text: `${s.name}\n${s.description}${s.categories?.length ? "\n" + s.categories.join(" ") : ""}`,
    }));

    const ok = await this.index.rebuild(entries, this.embeddingService?.getProviderInfo?.().model);
    if (!ok) {
      throw new Error("vector index rebuild failed (embedding unavailable)");
    }
    this.indexedSignature = signature;
  }

  private async ensureIndexed(skills: RoutableSkill[]): Promise<void> {
    const signature = skills.map((s) => `${s.name}\0${s.description}`).join("\n");
    if (signature === this.indexedSignature && this.index.size > 0) return;

    const entries: VectorIndexEntry[] = skills.map((s) => ({
      id: s.name,
      text: `${s.name}\n${s.description}`,
    }));

    const ok = await this.index.rebuild(entries, this.embeddingService?.getProviderInfo?.().model);
    if (!ok) {
      throw new Error("vector index rebuild failed (embedding unavailable)");
    }
    this.indexedSignature = signature;
  }
}
