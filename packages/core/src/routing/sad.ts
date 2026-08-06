/**
 * SAD — Iterative Skill-Aware Decomposition.
 *
 * Implements Algorithm 1 from "Compositional Skill Routing for LLM Agents"
 * (Gao, 2026, arxiv.org/abs/2606.18051, §3.1 + Appendix F).
 *
 * Standard LLM decomposition produces generic sub-task descriptions that
 * poorly align with available skill metadata. SAD fixes this with an
 * input-side feedback loop: it retrieves skills for the initial decomposition,
 * feeds them back as hints, and re-decomposes — aligning granularity with
 * the actual skill library before retrieval is finalized.
 *
 * Convergence: a fixed-point iteration over a finite skill library. In
 * practice "Round 1 captures the majority of DA gain" and one iteration
 * suffices (default T=1). Convergence is detected via Jaccard similarity of
 * hint sets between iterations (default threshold τ=0.6).
 */

import type { CompositionalSkill, LLMDecomposer, SubTask } from "./types";
import type { VectorIndex } from "./vector-index";

export interface SadOptions {
  maxIterations: number;
  convergenceThreshold: number;
  hintCount: number;
}

export const DEFAULT_SAD_OPTIONS: SadOptions = {
  maxIterations: 1,
  convergenceThreshold: 0.6,
  hintCount: 15,
};

/**
 * Run SAD on a query against a skill library.
 *
 * @param decomposer  LLM that splits a query into atomic sub-tasks.
 * @param index       Vector index over the skill library (must be rebuilt for the skills).
 * @param query       The user's complex query.
 * @param allSkills   Full skill library (for building hint lists — index only stores ids+texts).
 * @param opts        SAD tuning options.
 * @returns Ordered list of atomic sub-tasks (null on decomposer failure).
 */
export async function runSad(
  decomposer: LLMDecomposer,
  index: VectorIndex,
  query: string,
  allSkills: CompositionalSkill[],
  opts: SadOptions = DEFAULT_SAD_OPTIONS
): Promise<SubTask[] | null> {
  // Pass 1: vanilla decomposition (no hints).
  let decomposition = await decomposer.decompose(query);
  if (!decomposition || decomposition.length === 0) {
    return null;
  }

  // Single sub-task → no need for iterative refinement (it's atomic already).
  if (decomposition.length <= 1) {
    return decomposition;
  }

  const skillMap = new Map(allSkills.map((s) => [s.name, s]));
  let prevHints: Set<string> | null = null;

  for (let iter = 0; iter < opts.maxIterations; iter++) {
    // Retrieve candidate skills for each sub-task (Algorithm 1, line 3-4).
    const allHits = await Promise.all(decomposition.map((st) => index.query(st.description, opts.hintCount)));

    // Build the hint set as the union of all sub-task candidates, keeping the
    // max similarity per skill id (Algorithm 1, line 5: top-H from union).
    const hintScores = new Map<string, number>();
    for (const hits of allHits) {
      for (const h of hits) {
        const prev = hintScores.get(h.id);
        if (prev === undefined || h.score > prev) hintScores.set(h.id, h.score);
      }
    }

    // Top-H hints by similarity score (paper: "top-H skills from union").
    const currentHints = new Set(
      [...hintScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, opts.hintCount)
        .map(([id]) => id)
    );

    // Convergence check (Jaccard of hint sets, Algorithm 1, line 5-7).
    if (prevHints && prevHints.size > 0) {
      const jaccard = jaccardSet(prevHints, currentHints);
      if (jaccard >= opts.convergenceThreshold) {
        break; // converged — no re-decomposition needed.
      }
    }
    prevHints = currentHints;

    // Build hint skill list for the re-decomposition prompt (Appendix F).
    const hintSkills = [...currentHints]
      .map((id) => skillMap.get(id))
      .filter((s): s is CompositionalSkill => s !== undefined);
    if (hintSkills.length === 0) {
      break; // no hints available — keep vanilla decomposition.
    }

    // Re-decompose with skill hints (input-side feedback).
    const refined = await decomposer.decompose(query, hintSkills);
    if (refined && refined.length > 0) {
      decomposition = refined;
    }
  }

  return decomposition;
}

/**
 * Jaccard similarity between two sets: |A∩B| / |A∪B|.
 * Used for SAD convergence detection (paper Algorithm 1, line 5).
 */
export function jaccardSet(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const x of a) {
    if (b.has(x)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Category Jaccard between two skills' category tags.
 * Used in the Compose stage for inter-step compatibility.
 */
export function categoryJaccard(a: CompositionalSkill, b: CompositionalSkill): number {
  const ca = a.categories ?? [];
  const cb = b.categories ?? [];
  if (ca.length === 0 || cb.length === 0) return 0;
  const sa = new Set(ca);
  const sb = new Set(cb);
  return jaccardSet(sa, sb);
}
