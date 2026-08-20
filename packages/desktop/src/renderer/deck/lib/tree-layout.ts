// Task-tree branch lanes (E8 canvas): pure layout — walk each branch's head
// back to the root, then hang non-active branches off the first ancestor
// already placed in another lane (the fork point). Rendering stays a flat
// list of indented lanes, mirroring the design demo's treegraph.

import type { TaskBranch } from "@deeporca/core";
import type { TaskNode, TaskTreeIndex } from "../../../shared/ipc";

export type TreeLane = {
  /** Branch name; the active branch renders first. */
  branch: string;
  head: TaskBranch;
  /** Chain from just after the fork point (or the root) to the branch head. */
  nodes: TaskNode[];
  /** Indent depth — where this lane forks off an already-placed lane. */
  forkDepth: number;
  active: boolean;
  abandoned: boolean;
};

/** Walk a head back to the root, returned root-first. Cycles/gaps truncate. */
function chainToRoot(headId: string, byId: Map<string, TaskNode>): TaskNode[] {
  const out: TaskNode[] = [];
  const seen = new Set<string>();
  let cursor: string | null = headId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node: TaskNode | undefined = byId.get(cursor);
    if (!node) break;
    out.unshift(node);
    cursor = node.parentId;
  }
  return out;
}

/**
 * Lay out every branch of a tree as indented lanes. The active branch is the
 * main line (forkDepth 0); other branches fork off the shallowest already
 * placed ancestor — their segment starts right after that shared node.
 */
export function buildTreeLanes(index: TaskTreeIndex, nodes: TaskNode[]): TreeLane[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const placed = new Map<string, number>(); // nodeId → depth in its lane (global indent)
  const lanes: TreeLane[] = [];

  const branches = Object.entries(index.branches);
  const ordered = [
    ...branches.filter(([name]) => name === index.activeBranch),
    ...branches
      .filter(([name]) => name !== index.activeBranch)
      .sort(([, a], [, b]) => a.createdAt.localeCompare(b.createdAt)),
  ];

  for (const [name, head] of ordered) {
    const chain = chainToRoot(head.headId, byId);
    // Find the deepest node already placed — the fork point for this lane.
    let forkAt = -1;
    let forkDepth = 0;
    for (let i = chain.length - 1; i >= 0; i--) {
      const depth = placed.get(chain[i].id);
      if (depth !== undefined) {
        forkAt = i;
        forkDepth = depth;
        break;
      }
    }
    const segment = chain.slice(forkAt + 1);
    segment.forEach((node, i) => placed.set(node.id, forkDepth + 1 + i));
    lanes.push({
      branch: name,
      head,
      nodes: segment,
      forkDepth,
      active: name === index.activeBranch,
      abandoned: head.abandoned === true,
    });
  }
  return lanes;
}
