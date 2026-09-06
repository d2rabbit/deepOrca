/**
 * Line-level diff for the review model (2026-09-06 user ask: 设计稿的多 hunk
 * 能力 — hunk 逐块 ✓/✕、↑↓ 导航、预览差异). A bounded LCS over LINES (not
 * chars) splits the (original selection ↔ AI replacement) pair into ordered
 * groups: unchanged runs ("same") and change hunks ({"change"}). Groups
 * reconstruct the replacement EXACTLY, so apply can splice per-hunk
 * accept/reject decisions without touching anything else.
 */

export type DiffGroup =
  | { type: "same"; origLines: string[] }
  | { type: "change"; origLines: string[]; newLines: string[] };

/** Hard cell cap for the DP table — beyond it the whole region degrades to
 *  one change hunk (still correct, just less granular). */
const MAX_DP_CELLS = 250_000;

export function lineDiffGroups(orig: string[], next: string[]): DiffGroup[] {
  const n = orig.length;
  const m = next.length;
  if (n === 0 && m === 0) return [];
  if (n * m > MAX_DP_CELLS) {
    return n || m ? [{ type: "change", origLines: [...orig], newLines: [...next] }] : [];
  }

  // dp[i][j] = LCS length of orig[i..) vs next[j..)
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  const at = (i: number, j: number): number => i * width + j;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[at(i, j)] = orig[i] === next[j] ? dp[at(i + 1, j + 1)] + 1 : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
    }
  }

  const groups: DiffGroup[] = [];
  let cur: { origLines: string[]; newLines: string[] } | null = null;
  const flush = (): void => {
    if (cur && (cur.origLines.length > 0 || cur.newLines.length > 0)) {
      groups.push({ type: "change", origLines: cur.origLines, newLines: cur.newLines });
    }
    cur = null;
  };
  const addDel = (line: string): void => {
    cur ??= { origLines: [], newLines: [] };
    cur.origLines.push(line);
  };
  const addAdd = (line: string): void => {
    cur ??= { origLines: [], newLines: [] };
    cur.newLines.push(line);
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (orig[i] === next[j]) {
      flush();
      const last = groups[groups.length - 1];
      if (last?.type === "same") last.origLines.push(orig[i]);
      else groups.push({ type: "same", origLines: [orig[i]] });
      i += 1;
      j += 1;
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
      addDel(orig[i]);
      i += 1;
    } else {
      addAdd(next[j]);
      j += 1;
    }
  }
  while (i < n) {
    addDel(orig[i]);
    i += 1;
  }
  while (j < m) {
    addAdd(next[j]);
    j += 1;
  }
  flush();
  return groups;
}

/** Reconstruct the "after" lines from diff groups honoring per-hunk
 *  decisions — accepted hunks contribute new lines, rejected (and unchanged
 *  runs) contribute the original lines. */
export function spliceGroups(groups: DiffGroup[], accepted: ReadonlyArray<boolean>): string[] {
  const lines: string[] = [];
  let hi = 0;
  for (const g of groups) {
    if (g.type === "same") lines.push(...g.origLines);
    else {
      lines.push(...(accepted[hi] === false ? g.origLines : g.newLines));
      hi += 1;
    }
  }
  return lines;
}
