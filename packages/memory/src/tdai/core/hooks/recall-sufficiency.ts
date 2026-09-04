/**
 * Agentic-recall sufficiency follow-up (CMB-8, the memory-side升档 of
 * "agent involvement scales with query complexity" — MemBrain M4, second
 * implementer of the depth-lane philosophy).
 *
 * Standard recall stays zero-agent (deterministic event-variant rewriting,
 * 08-17 #1). This helper adds the ESCALATION rung only: when the first round
 * comes back sparse (< minResults after budget), run ONE more bounded round
 * on the unused deterministic query variants — still zero LLM, ≤
 * maxFollowUpQueries extra searches, fail-open on any query error (round-1
 * lines survive untouched).
 *
 * Deterministic trigger + bounded budget + fail-open = the M1 rule
 * (specs/cmb-adoption design §0.3) applied to retrieval.
 */

import { buildRecallQueryVariants } from "./query-variants.js";

/** Runs one query and returns its formatted (post-budget) memory lines. */
export type SufficiencyQuery = (query: string) => Promise<string[]>;

/** Dedupe key for a formatted memory line: content without tag/time shell. */
function lineKey(line: string): string {
  const afterTag = line.includes("] ") ? line.slice(line.indexOf("] ") + 2) : line;
  return afterTag.replace(/\s*[（(][^）)]*[）)]\s*$/u, "").trim();
}

export type SufficiencyOutcome = {
  lines: string[];
  /** Total search rounds executed (1 = no follow-up). */
  rounds: number;
  /** The follow-up queries actually executed (empty when none). */
  followUpQueries: string[];
};

/**
 * Merge follow-up rounds into a sparse first round. Never throws — a failed
 * follow-up query is skipped, and the merged list preserves round-1 order
 * ahead of round-2 additions.
 */
export async function applySufficiencyFollowUp(opts: {
  userText: string;
  primaryQuery: string;
  lines: string[];
  runQuery: SufficiencyQuery;
  /** Sparse bar: below this, a follow-up round fires (default 2). */
  minResults: number;
  /** Hard cap on extra queries (default 2). */
  maxFollowUpQueries: number;
  enabled: boolean;
}): Promise<SufficiencyOutcome> {
  const { userText, primaryQuery, lines, runQuery } = opts;
  const minResults = opts.minResults > 0 ? opts.minResults : 2;
  const maxFollowUpQueries = opts.maxFollowUpQueries > 0 ? opts.maxFollowUpQueries : 2;

  if (!opts.enabled || lines.length >= minResults || !userText) {
    return { lines, rounds: 1, followUpQueries: [] };
  }

  const variants = buildRecallQueryVariants(userText)
    .filter((variant) => variant !== primaryQuery)
    .slice(0, maxFollowUpQueries);

  const merged = [...lines];
  const seen = new Set(merged.map(lineKey));
  const executed: string[] = [];
  for (const variant of variants) {
    if (merged.length >= minResults) break;
    executed.push(variant);
    try {
      const more = await runQuery(variant);
      for (const line of more) {
        const key = lineKey(line);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(line);
      }
    } catch {
      // Fail-open: this variant contributes nothing; round-1 lines stand.
    }
  }

  return { lines: merged, rounds: 1 + executed.length, followUpQueries: executed };
}
