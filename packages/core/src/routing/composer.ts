/**
 * Composer — compatibility-aware planning (Compose stage).
 *
 * Implements the selection objective (Eq.4) and DAG construction from
 * "Compositional Skill Routing for LLM Agents" (Gao, 2026,
 * arxiv.org/abs/2606.18051, §3.3).
 *
 * For each sub-task, the planner picks the skill that maximizes a joint
 * score of retrieval relevance and inter-step compatibility:
 *
 *   σ(tₖ) = argmax_{s ∈ cand(tₖ)}  α·sim(tₖ, s) + (1-α)·c̄ₖ(s)
 *
 * where c̄ₖ(s) is the average compatibility of s with the skills selected
 * for preceding steps. Compatibility uses three measures:
 *   1. I/O type coercion — structural alignment of output→input types.
 *   2. Category Jaccard — functional tag overlap.
 *   3. Keyword co-occurrence — descriptive terminology overlap.
 *
 * After selection, dependencies are detected (linguistic markers + I/O
 * overlap) to form a DAG for potential parallel execution.
 */

import type { CompositionalSkill, CompositionPlan, PlanStep, SkillCandidate, SubTask } from "./types";
import { categoryJaccard } from "./sad";

export interface ComposeStageOptions {
  /** α trade-off between relevance and compatibility (default 0.5). */
  alpha: number;
  /** Min score for a skill to be selected (default 0.3). Below → null skill. */
  minSelectionScore: number;
}

export const DEFAULT_COMPOSE_STAGE_OPTIONS: ComposeStageOptions = {
  alpha: 0.5,
  minSelectionScore: 0.3,
};

/**
 * Compose a plan from sub-tasks and their candidate skills.
 *
 * @param subTasks    Ordered atomic sub-tasks from SAD.
 * @param candidates  Per sub-task: list of candidate skills with similarity.
 * @param opts        Compose tuning options.
 * @returns A composition plan with selected skills + DAG dependencies.
 */
export function composePlan(
  subTasks: SubTask[],
  candidates: SkillCandidate[][],
  opts: ComposeStageOptions = DEFAULT_COMPOSE_STAGE_OPTIONS
): CompositionPlan {
  if (subTasks.length === 0) {
    return { steps: [], dependencies: [], decomposed: true };
  }

  const steps: PlanStep[] = [];
  const selectedSkills: (CompositionalSkill | null)[] = [];

  for (let k = 0; k < subTasks.length; k++) {
    const task = subTasks[k]!;
    const cands = candidates[k] ?? [];

    if (cands.length === 0) {
      const step: PlanStep = {
        subTask: task,
        skill: null,
        score: 0,
        similarity: 0,
        compatibility: 0,
      };
      steps.push(step);
      selectedSkills.push(null);
      continue;
    }

    // Score each candidate: α·sim + (1-α)·avg_compat.
    let bestSkill: CompositionalSkill | null = null;
    let bestScore = -Infinity;
    let bestSim = 0;
    let bestCompat = 0;

    for (const cand of cands) {
      const sim = cand.similarity;
      const compat = avgCompatibility(cand.skill, selectedSkills);
      const score = opts.alpha * sim + (1 - opts.alpha) * compat;

      if (score > bestScore) {
        bestScore = score;
        bestSkill = cand.skill;
        bestSim = sim;
        bestCompat = compat;
      }
    }

    // Threshold: if best score too low, leave skill null (no good match).
    const chosen = bestScore >= opts.minSelectionScore ? bestSkill : null;
    steps.push({
      subTask: task,
      skill: chosen,
      score: bestScore,
      similarity: bestSim,
      compatibility: bestCompat,
    });
    selectedSkills.push(chosen);
  }

  // Build DAG dependencies based on I/O type overlap between consecutive steps.
  const dependencies = detectDependencies(steps);

  return { steps, dependencies, decomposed: true };
}

/**
 * Average compatibility of a candidate skill with already-selected preceding skills.
 * Combines three measures per the paper (equal weight):
 *   1. I/O type coercion
 *   2. Category Jaccard
 *   3. Keyword co-occurrence
 *
 * Returns 0 if no preceding skills are selected yet (first step).
 */
function avgCompatibility(candidate: CompositionalSkill, preceding: (CompositionalSkill | null)[]): number {
  const valid = preceding.filter((s): s is CompositionalSkill => s !== null);
  if (valid.length === 0) return 0;

  let total = 0;
  for (const prev of valid) {
    const ioScore = ioTypeCoercion(prev, candidate);
    const catScore = categoryJaccard(prev, candidate);
    const kwScore = keywordCooccurrence(prev, candidate);
    total += (ioScore + catScore + kwScore) / 3;
  }
  return total / valid.length;
}

/**
 * I/O type coercion: structural alignment between a preceding skill's output
 * types and the current skill's input types. Returns the fraction of input
 * types that have a matching output type from the preceding step.
 */
export function ioTypeCoercion(prev: CompositionalSkill, curr: CompositionalSkill): number {
  const outputs = prev.outputTypes ?? [];
  const inputs = curr.inputTypes ?? [];
  if (outputs.length === 0 || inputs.length === 0) return 0;

  const outSet = new Set(outputs.map((t) => t.toLowerCase()));
  let matched = 0;
  for (const inp of inputs) {
    if (outSet.has(inp.toLowerCase())) matched++;
  }
  return matched / inputs.length;
}

/**
 * Keyword co-occurrence: overlap of descriptive terminology between two skills.
 * Tokenizes descriptions and computes Jaccard over meaningful tokens.
 */
export function keywordCooccurrence(a: CompositionalSkill, b: CompositionalSkill): number {
  const ta = tokenize(a.description);
  const tb = tokenize(b.description);
  if (ta.size === 0 || tb.size === 0) return 0;
  return jaccardStringSet(ta, tb);
}

/**
 * Detect DAG dependencies between plan steps.
 * A dependency exists when step j's input types overlap with step i's output
 * types (i < j), or when the sub-task description references the prior step.
 *
 * Returns edges as [fromIndex, toIndex] pairs.
 */
export function detectDependencies(steps: PlanStep[]): Array<[number, number]> {
  const edges: Array<[number, number]> = [];

  for (let j = 1; j < steps.length; j++) {
    const curr = steps[j]!.skill;
    if (!curr) continue;

    for (let i = 0; i < j; i++) {
      const prev = steps[i]!.skill;
      if (!prev) continue;

      // I/O dependency: prev output feeds curr input.
      const ioDep = ioTypeCoercion(prev, curr) > 0;
      // Linguistic marker: curr sub-task references prev step's index or skill.
      const langDep = referencesPrior(steps[j]!.subTask, steps[i]!.subTask);

      if (ioDep || langDep) {
        edges.push([i, j]);
      }
    }
  }

  return edges;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "need",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "and",
  "or",
  "but",
  "if",
  "then",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "they",
  "them",
  "their",
  "we",
  "you",
  "your",
  "our",
  "的",
  "了",
  "在",
  "是",
  "我",
  "你",
  "他",
  "她",
  "它",
  "们",
  "和",
  "与",
  "把",
  "被",
  "让",
  "给",
  "对",
  "向",
  "从",
  "到",
  "用",
  "以",
  "及",
]);

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  // Latin words
  const words = text.toLowerCase().match(/[a-z]{2,}/g) ?? [];
  for (const w of words) {
    if (!STOPWORDS.has(w)) tokens.add(w);
  }
  // CJK bigrams (simple approach — no jieba dependency here)
  const cjk = text.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const seg of cjk) {
    for (let i = 0; i < seg.length - 1; i++) {
      tokens.add(seg.slice(i, i + 2));
    }
  }
  return tokens;
}

function jaccardStringSet(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const x of a) {
    if (b.has(x)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function referencesPrior(currTask: SubTask, prevTask: SubTask): boolean {
  // Simple heuristic: curr description mentions "previous", "then", "after",
  // or the prior step number (e.g. "step 1").
  const desc = currTask.description.toLowerCase();
  const markers = ["previous", "then", "after", "next", "上一个", "上一步", "接着", "然后", "之后"];
  if (markers.some((m) => desc.includes(m))) return true;
  // References prior step number
  if (desc.includes(`step ${prevTask.step}`) || desc.includes(`第${prevTask.step}步`)) return true;
  return false;
}
