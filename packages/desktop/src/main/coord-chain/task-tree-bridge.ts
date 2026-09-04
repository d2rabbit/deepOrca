// Task-tree ↔ coordination-chain bridge (R14/R15; OC3 task 15/16 groundwork).
//
// The local TaskTree (packages/core/src/tasks, merged from
// feat/modern-ui-redesign) models HOW the agent worked on this machine:
// fork branches that must carry a `why`, cherry-pick merges that mark the
// source branch `mergedInto`, and an append-only reflog. The chain models the
// SAME genealogy DECENTRALIZED: `task.share` records linked by
// `parentRecordId` (a fork = a child task record), with `commitRef`
// cross-binding the ws.commit that carries the branch's file changes.
//
// This module is the loss-less-ish mapping between the two worlds:
//   local tree branch ──branchToTaskSharePayload──▶ task.share body
//   chain task.share records ──buildChainGenealogy──▶ fork forest + text
//
// It stays Electron-free and depends only on structural shapes (compatible
// with core's TaskTreeIndex/TaskNode/TaskReflogEntry), so it is unit-testable
// without booting the tree service or Electron.

/** Structural subset of core's TaskNode — compatibility by shape, not import. */
export interface TaskNodeLike {
  id: string;
  parentId: string | null;
  kind: "root" | "step" | "fork" | "merge" | "memory-spawn";
  title: string;
  why: string;
  artifactRefs: string[];
  status: "planned" | "running" | "done" | "abandoned";
  meta?: {
    mergeConflicts?: Array<{ artifactRef: string; targetTitle: string }>;
  };
}

/** Structural subset of core's TaskReflogEntry. */
export interface ReflogEntryLike {
  at: string;
  op: "create" | "fork" | "switch" | "append" | "merge" | "abandon" | "archive" | "unarchive";
  branch: string;
  nodeId?: string;
  detail?: string;
}

export interface BranchBranchPeer {
  name: string;
  abandoned?: boolean;
  mergedInto?: string;
}

export interface TreeBranchSnapshot {
  treeId: string;
  treeTitle: string;
  branch: string;
  /** Head node of the branch (why/narrative carrier). */
  head?: TaskNodeLike;
  /** Nodes belonging to this branch's lineage (head ancestry). */
  nodes: TaskNodeLike[];
  /** Whole-tree reflog (append-only op journal). */
  reflog: ReflogEntryLike[];
  /** Set when this branch's picks were merged into another branch. */
  mergedInto?: string;
  /** Other branches of the tree — unfinished ones become leftovers. */
  peers: BranchBranchPeer[];
}

export interface TaskSharePayload {
  title: string;
  goal: string;
  /** Compressed reflog: op counts + the fork/merge story lines (≤50). */
  trajectory: string;
  filesTouched: string[];
  conclusion: string;
  leftovers: string[];
  commitRef?: string;
}

const TRAJECTORY_STORY_OPS = new Set(["fork", "merge", "abandon"]);
const MAX_TRAJECTORY_LINES = 50;

/**
 * Map one local task-tree branch onto a `task.share` record body (R14).
 * `parentRecordId` (the chain-side upstream task) is supplied by the caller
 * when this share continues an existing chain genealogy.
 */
export function branchToTaskSharePayload(
  snapshot: TreeBranchSnapshot,
  opts?: { commitRef?: string }
): TaskSharePayload {
  const storyLines = snapshot.reflog
    .filter((entry) => TRAJECTORY_STORY_OPS.has(entry.op))
    .map((entry) => `${entry.op}:${entry.branch}${entry.detail ? ` ${entry.detail}` : ""}`);
  const opCounts = new Map<string, number>();
  for (const entry of snapshot.reflog) {
    opCounts.set(entry.op, (opCounts.get(entry.op) ?? 0) + 1);
  }
  const countsLine = [...opCounts.entries()].map(([op, count]) => `${op}×${count}`).join(" ");

  const filesTouched = [...new Set(snapshot.nodes.flatMap((node) => node.artifactRefs))].sort();
  const conflicts = snapshot.nodes
    .flatMap((node) => node.meta?.mergeConflicts ?? [])
    .map((conflict) => `${conflict.artifactRef}→${conflict.targetTitle}`);

  const conclusionParts: string[] = [];
  if (snapshot.mergedInto) {
    conclusionParts.push(`已并入 ${snapshot.mergedInto}`);
  }
  const headStatus = snapshot.head?.status;
  if (headStatus === "done") {
    conclusionParts.push("分支已完成");
  } else if (headStatus === "abandoned") {
    conclusionParts.push("分支已放弃");
  }
  if (conflicts.length > 0) {
    conclusionParts.push(`合并冲突待确认: ${conflicts.join("; ")}`);
  }

  // Leftovers = unfinished sibling work: not self, not abandoned, not
  // already merged elsewhere, and not a merge TARGET (the trunk this branch
  // was merged into is converged work, not leftover).
  const mergeTargets = new Set(
    snapshot.peers.filter((peer) => peer.mergedInto !== undefined).map((peer) => peer.mergedInto as string)
  );
  const leftovers = snapshot.peers
    .filter(
      (peer) =>
        peer.name !== snapshot.branch &&
        !peer.abandoned &&
        peer.mergedInto === undefined &&
        !mergeTargets.has(peer.name)
    )
    .map((peer) => peer.name);

  const trajectoryLines = [countsLine, ...storyLines.slice(0, MAX_TRAJECTORY_LINES - 1)];
  // The branch's goal is the nearest non-empty `why` on the head ancestry —
  // fork nodes always carry one ("a branch without a story is a UI lie"),
  // plain steps may not.
  const storyWhy = snapshot.nodes.map((node) => node.why).find((why) => why.length > 0);
  return {
    title: `${snapshot.treeTitle} · ${snapshot.branch}`,
    goal: storyWhy || snapshot.treeTitle,
    trajectory: trajectoryLines.join("\n"),
    filesTouched,
    conclusion: conclusionParts.join("；") || "进行中",
    leftovers,
    ...(opts?.commitRef !== undefined ? { commitRef: opts.commitRef } : {}),
  };
}

/** Collect a branch snapshot from the core TaskTree shapes (thin adapter). */
export function collectBranchSnapshot(
  index: {
    id: string;
    title: string;
    branches: Record<string, BranchBranchPeer & { headId: string }>;
    activeBranch: string;
  },
  allNodes: TaskNodeLike[],
  reflog: ReflogEntryLike[],
  branch: string
): TreeBranchSnapshot {
  const branchInfo = index.branches[branch];
  if (!branchInfo) {
    throw new Error(`unknown branch: ${branch}`);
  }
  // Head ancestry: walk parents from the branch head.
  const byId = new Map(allNodes.map((node) => [node.id, node]));
  const nodes: TaskNodeLike[] = [];
  let cursor: string | null = branchInfo.headId;
  while (cursor) {
    const node = byId.get(cursor);
    if (!node) {
      break;
    }
    nodes.push(node);
    cursor = node.parentId;
  }
  return {
    treeId: index.id,
    treeTitle: index.title,
    branch,
    head: byId.get(branchInfo.headId),
    nodes,
    reflog,
    ...(branchInfo.mergedInto !== undefined ? { mergedInto: branchInfo.mergedInto } : {}),
    peers: Object.values(index.branches).map((peer) => ({
      name: peer.name,
      ...(peer.abandoned !== undefined ? { abandoned: peer.abandoned } : {}),
      ...(peer.mergedInto !== undefined ? { mergedInto: peer.mergedInto } : {}),
    })),
  };
}

// ------------------------------------------------------- chain-side genealogy

/** One task.share record resolved into genealogy form (mirror of a fork node). */
export interface ChainTaskNode {
  recordId: string;
  /** Upstream task on the chain — the decentralized fork edge (R14). */
  parentRecordId?: string;
  title: string;
  goal: string;
  conclusion: string;
  author: string;
  ts: number;
  /** ws.commit cross-reference — "this task produced these changes" (R28). */
  commitRef?: string;
}

export interface GenealogyForest {
  roots: ChainTaskNode[];
  childrenByParent: Map<string, ChainTaskNode[]>;
  byRecordId: Map<string, ChainTaskNode>;
}

/** Assemble the fork forest from chain task.share records (parentRecordId edges). */
export function buildChainGenealogy(tasks: ChainTaskNode[]): GenealogyForest {
  const byRecordId = new Map(tasks.map((task) => [task.recordId, task]));
  const childrenByParent = new Map<string, ChainTaskNode[]>();
  const roots: ChainTaskNode[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    if (task.parentRecordId !== undefined && byRecordId.has(task.parentRecordId)) {
      const list = childrenByParent.get(task.parentRecordId) ?? [];
      list.push(task);
      childrenByParent.set(task.parentRecordId, list);
    } else {
      // No parent on this chain (or dangling parent) → a root of the forest.
      roots.push(task);
    }
    seen.add(task.recordId);
  }
  // Deterministic order: children sorted by (ts, recordId).
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.ts - b.ts || (a.recordId < b.recordId ? -1 : 1));
  }
  roots.sort((a, b) => a.ts - b.ts || (a.recordId < b.recordId ? -1 : 1));
  return { roots, childrenByParent, byRecordId };
}

/** Render the genealogy as an indented fork tree — panel/AI-readable (R17). */
export function formatGenealogy(forest: GenealogyForest): string {
  const lines: string[] = [];
  const walk = (task: ChainTaskNode, depth: number): void => {
    const indent = "  ".repeat(depth);
    const forkMark = depth > 0 ? "⑂ " : "";
    lines.push(`${indent}${forkMark}${task.title} — ${task.author.slice(4, 12)} · ${task.conclusion}`);
    for (const child of forest.childrenByParent.get(task.recordId) ?? []) {
      walk(child, depth + 1);
    }
  };
  for (const root of forest.roots) {
    walk(root, 0);
  }
  return lines.join("\n");
}
