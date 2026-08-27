// Commit lineage helpers (design §8.2/§8.3, R30).
//
// Parallel commits with the same parent are retained as a lineage fork (v1
// has no merge). The default head is last-writer-wins over (ts, commitCid);
// users can explicitly switch heads — these helpers are the pure core of that
// UI surface.

import type { Commit } from "./commit.js";

/** All ancestors of a commit (itself included), parents-first traversal, cycle-safe. */
export function ancestorsOf(commitCid: string, commitByCid: Map<string, Commit>): string[] {
  const visited = new Set<string>();
  const queue = [commitCid];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    const commit = commitByCid.get(current);
    if (commit) {
      queue.push(...commit.parents);
    }
  }
  return [...visited];
}

/** Commits that are not referenced as a parent by any other commit. */
export function headsOf(commits: Commit[]): string[] {
  const isParent = new Set<string>();
  const byCid = new Map<string, Commit>();
  for (const commit of commits) {
    byCid.set(commit.commitCid, commit);
    for (const parent of commit.parents) {
      isParent.add(parent);
    }
  }
  return commits.map((commit) => commit.commitCid).filter((cid) => !isParent.has(cid));
}

/** Default head selection: max by (ts, commitCid). */
export function lwwHead(headCids: string[], commitByCid: Map<string, Commit>): string | null {
  let best: string | null = null;
  for (const cid of headCids) {
    const commit = commitByCid.get(cid);
    if (!commit) {
      continue;
    }
    if (best === null) {
      best = cid;
      continue;
    }
    const bestCommit = commitByCid.get(best);
    if (bestCommit && (commit.ts > bestCommit.ts || (commit.ts === bestCommit.ts && cid > best))) {
      best = cid;
    }
  }
  return best;
}
