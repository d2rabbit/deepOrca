// True fuzzy scoring for the ⌘K command layer (E3): subsequence matching
// with bonuses for consecutive runs and word starts, so "tpe" ranks Tape
// above Types and a full prefix wins over a scattered match. Score 0 = no
// match; the empty query matches everything with a neutral score.

const WORD_SEPARATORS = new Set([" ", "-", "_", "/", ".", "·", "：", ":"]);

export function fuzzyScore(query: string, target: string): number {
  const q = query.trim().toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 1;
  let score = 0;
  let qi = 0;
  let prevHit = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    score += 1;
    if (ti === prevHit + 1) score += 3;
    if (ti === 0 || WORD_SEPARATORS.has(t[ti - 1])) score += 5;
    if (qi === 0 && ti === 0) score += 8;
    prevHit = ti;
    qi++;
  }
  return qi === q.length ? score : 0;
}

/** Rank items by fuzzy score against `textOf(item)`, best first, stable. */
export function rankFuzzy<T>(
  query: string,
  items: T[],
  textOf: (item: T) => string
): Array<{ item: T; score: number }> {
  const scored = items.map((item, i) => ({ item, i, score: fuzzyScore(query, textOf(item)) }));
  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ item, score }) => ({ item, score }));
}
