/**
 * Repair-sequence diff (specs/repair-rule-memory P0) — the deterministic
 * core of repair-rule mining, ported conceptually from EMG's offline graph
 * edit path (KDD 2027; no upstream code): a failed parent branch and its
 * repaired child share a task, so the repair signal is expressible as a
 * plain sequence diff over their tool-call trajectories — LCS spine, the
 * parent-only runs become "deleted failure clusters", the child-only calls
 * become "repair insertions". No graph matching needed for same-task forks.
 *
 * Pure functions, zero IO, zero LLM — fully unit-testable. The alignment
 * unit is {tool, argsDigest}: the tool name plus a one-token digest of its
 * most identifying argument (command verb / file basename / query head).
 */

/** One aligned action in a trajectory. */
export interface ToolCallUnit {
  readonly tool: string;
  readonly argsDigest: string;
}

/** Deterministic diff of a failed parent vs its repaired child. */
export interface EditPath {
  /** Longest common subsequence — the shared correct workflow (EMG's common subgraph). */
  readonly spine: readonly ToolCallUnit[];
  /** Parent-only consecutive runs — the failure clusters to stop repeating. */
  readonly deletedClusters: readonly ToolCallUnit[][];
  /** Child-only calls — the repair actions, in child order. */
  readonly insertions: readonly ToolCallUnit[];
  readonly parentLength: number;
  readonly childLength: number;
}

/** EMG's graceful-degradation gate, safe side: no signal → no rule, ever. */
export function editPathHasSignal(path: EditPath, opts?: { minSpine?: number }): boolean {
  const minSpine = opts?.minSpine ?? 3;
  return path.spine.length >= minSpine && path.deletedClusters.length > 0;
}

/**
 * Extract the tool-call trajectory from session transcript messages (JSONL
 * entries as parsed objects): assistant messages carry `messageParams.
 * tool_calls` in execution order. Everything else is ignored.
 */
export function extractToolSequence(messages: readonly unknown[]): ToolCallUnit[] {
  const units: ToolCallUnit[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const message = raw as { role?: unknown; messageParams?: unknown };
    if (message.role !== "assistant") continue;
    const params = message.messageParams;
    if (!params || typeof params !== "object") continue;
    const toolCalls = (params as { tool_calls?: unknown }).tool_calls;
    if (!Array.isArray(toolCalls)) continue;
    for (const call of toolCalls) {
      if (!call || typeof call !== "object") continue;
      const fn = (call as { function?: unknown }).function;
      if (!fn || typeof fn !== "object") continue;
      const tool = typeof (fn as { name?: unknown }).name === "string" ? (fn as { name: string }).name : "";
      if (!tool) continue;
      units.push({ tool, argsDigest: digestArgs((fn as { arguments?: unknown }).arguments) });
    }
  }
  return units;
}

/** One identifying token per well-known argument shape; `{}` otherwise. */
function digestArgs(argsRaw: unknown): string {
  let args: Record<string, unknown>;
  if (typeof argsRaw === "string") {
    try {
      args = JSON.parse(argsRaw) as Record<string, unknown>;
    } catch {
      return "{}";
    }
  } else if (argsRaw && typeof argsRaw === "object") {
    args = argsRaw as Record<string, unknown>;
  } else {
    return "{}";
  }
  for (const key of ["command", "cmd"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      const first = value.trim().split(/\s+/)[0] ?? "";
      return first.split(/[\\/]/).pop() || first;
    }
  }
  for (const key of ["path", "file", "filePath", "file_path", "snippet_id"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().split(/[\\/]/).pop() || value.trim();
    }
  }
  for (const key of ["query", "url"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().split(/\s+/).slice(0, 3).join(" ");
    }
  }
  return "{}";
}

function sameUnit(a: ToolCallUnit, b: ToolCallUnit): boolean {
  return a.tool === b.tool && a.argsDigest === b.argsDigest;
}

/**
 * Per-sequence length ceiling for the LCS table (full-domain audit round-2).
 * The classic (n+1)×(m+1) DP allocates ~200MB in the Electron main process
 * for two ~5k-call trajectories — `memory.mine-repairs` over long-histories
 * could OOM the app. Mining semantics only need the RECENT trajectory (the
 * failure cluster and its repair both sit at the tail of a same-task fork),
 * so each sequence is trimmed to its LAST this-many units before diffing.
 * 1500² ≈ 2.25M table cells ≈ ~18MB transient — bounded for any input.
 */
export const MAX_SEQUENCE_UNITS = 1_500;

/**
 * LCS-based sequence diff. Classic dynamic programming over unit equality;
 * the reconstruction walks the table once. Parent-only runs between spine
 * anchors collapse into deleted clusters (EMG "parallelizing consecutive
 * invalid actions" — a repeated-failure run is ONE cluster, not N events).
 *
 * Inputs longer than {@link MAX_SEQUENCE_UNITS} are tail-trimmed first (see
 * the constant's doc); `parentLength`/`childLength` still report the ORIGINAL
 * lengths so callers' stats stay truthful about the trajectories compared.
 */
export function diffSequences(parent: readonly ToolCallUnit[], child: readonly ToolCallUnit[]): EditPath {
  const tail = (seq: readonly ToolCallUnit[]): readonly ToolCallUnit[] =>
    seq.length > MAX_SEQUENCE_UNITS ? seq.slice(seq.length - MAX_SEQUENCE_UNITS) : seq;
  const parentUnits = tail(parent);
  const childUnits = tail(child);
  const n = parent.length;
  const m = child.length;
  // table[i][j] = LCS length of parent[i..] × child[j..]
  const table: number[][] = Array.from({ length: parentUnits.length + 1 }, () =>
    new Array<number>(childUnits.length + 1).fill(0)
  );
  for (let i = parentUnits.length - 1; i >= 0; i -= 1) {
    for (let j = childUnits.length - 1; j >= 0; j -= 1) {
      table[i]![j] = sameUnit(parentUnits[i]!, childUnits[j]!)
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const spine: ToolCallUnit[] = [];
  const insertions: ToolCallUnit[] = [];
  const deletedClusters: ToolCallUnit[][] = [];
  let pendingDeletion: ToolCallUnit[] = [];
  const flushDeletion = () => {
    if (pendingDeletion.length > 0) {
      deletedClusters.push(pendingDeletion);
      pendingDeletion = [];
    }
  };
  let i = 0;
  let j = 0;
  while (i < parentUnits.length && j < childUnits.length) {
    if (sameUnit(parentUnits[i]!, childUnits[j]!)) {
      flushDeletion();
      spine.push(parentUnits[i]!);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      pendingDeletion.push(parentUnits[i]!);
      i += 1;
    } else {
      insertions.push(childUnits[j]!);
      j += 1;
    }
  }
  while (i < parentUnits.length) {
    pendingDeletion.push(parentUnits[i]!);
    i += 1;
  }
  while (j < childUnits.length) {
    insertions.push(childUnits[j]!);
    j += 1;
  }
  flushDeletion();
  return { spine, deletedClusters, insertions, parentLength: n, childLength: m };
}
