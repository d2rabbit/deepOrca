/**
 * Task-tree domain types (spec: specs/task-tree/design.md, P0 subset).
 *
 * The tree is the HUMAN-facing trajectory of how the agent worked: nodes
 * carry a `why` narrative because a structure without story is useless to a
 * person deciding "which branch do I trust, what was abandoned and why".
 * The agent operates the tree via task.* actions; humans read it in the panel.
 */

export type TaskNodeKind = "root" | "step" | "fork" | "merge" | "memory-spawn";

export type TaskNodeStatus = "planned" | "running" | "done" | "abandoned";

export interface TaskNode {
  /** Content-addressed short hash (parentId + payload digest) — stable, immutable. */
  id: string;
  treeId: string;
  parentId: string | null;
  kind: TaskNodeKind;
  title: string;
  /**
   * The narrative for HUMANS: why this node exists / why the fork happened /
   * why this path was abandoned. Required on fork + memory-spawn nodes so the
   * panel never shows a branch without a story.
   */
  why: string;
  prompt?: string;
  /** Inherited context summary (fork lineage, compaction product). P0: optional passthrough. */
  contextSummary?: string;
  /** Bound execution session (P1 — not wired in P0). */
  sessionRef?: string;
  artifactRefs: string[];
  memoryRefs: string[];
  status: TaskNodeStatus;
  createdAt: string;
  meta: {
    createdBy: "user" | "agent" | "memory";
    memorySeed?: { unitIds: string[]; similarity: number; sourceTaskId: string };
    /** Merge-time artifact collisions — REPORTED for human confirmation, never auto-resolved. */
    mergeConflicts?: Array<{ artifactRef: string; targetTitle: string }>;
    /**
     * Artifact snapshot (P2, file-history reuse): checkpoint of the node's
     * resolvable artifact files in the tree-scoped history repo. Present only
     * when at least one artifactRef existed on disk at append time.
     */
    snapshot?: { hash: string; at: string; files: number };
  };
}

export interface TaskBranch {
  name: string;
  headId: string;
  createdAt: string;
  abandoned?: boolean;
}

/** On-disk index (lightweight — nodes live in nodes/<id>.json). */
export interface TaskTreeIndex {
  version: 1;
  id: string;
  rootId: string;
  title: string;
  branches: Record<string, TaskBranch>;
  activeBranch: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Sessions that have executed on this tree (bindSession accumulates,
   * removeSessionBinding prunes on session delete). Query face for the panel
   * and the archive cascade; single writer = the tree service.
   */
  sessionIds?: string[];
  /** Whole-tree archive — NEVER a delete: files stay, reflog stays, viewable. */
  archived?: boolean;
  archivedAt?: string;
}

/** One reflog line (append-only operation journal). */
export interface TaskReflogEntry {
  at: string;
  op: "create" | "fork" | "switch" | "append" | "abandon" | "archive" | "unarchive";
  branch: string;
  nodeId?: string;
  detail?: string;
}

/** Panel-facing summary (IPC payload). */
export interface TaskTreeSummary {
  id: string;
  title: string;
  activeBranch: string;
  branchCount: number;
  nodeCount: number;
  updatedAt: string;
  sessionIds: string[];
  archived: boolean;
}

/** A historical fork proposal surfaced at a decision point (memory-driven fork). */
export interface MemoryForkCandidate {
  treeId: string;
  treeTitle: string;
  branch: string;
  forkWhy: string;
  /** abandoned | merged | open — what happened to that branch. */
  outcome: "abandoned" | "merged" | "open";
  similarity: number;
  sourceNodeId: string;
}
