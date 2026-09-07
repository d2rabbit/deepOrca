export type LineDiff = { added: string[]; removed: string[] };

/** Set-based line diff — semantic-ID content keeps line identity stable across revisions. */
export function diffLines(before: string, after: string): LineDiff {
  const aSet = new Set(
    before
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  );
  const bSet = new Set(
    after
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  );
  return {
    added: after.split("\n").filter((line) => line.trim() && !aSet.has(line.trim())),
    removed: before.split("\n").filter((line) => line.trim() && !bSet.has(line.trim())),
  };
}

export function summarizeDiff(diff: LineDiff): { added: number; removed: number; lines: string[] } {
  return {
    added: diff.added.length,
    removed: diff.removed.length,
    lines: [
      ...diff.removed.slice(0, 12).map((line) => `- ${line.trim()}`),
      ...diff.added.slice(0, 12).map((line) => `+ ${line.trim()}`),
    ],
  };
}
