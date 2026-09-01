/**
 * Workspace task hub — aggregates the workspace's FOUR record domains into
 * one unified task tree (task-tree-hub design §4). Zero new storage: every
 * domain is read in place (task-trees / reviews / designs / jobs stores) and
 * normalized into TaskHubNode meta — payloads stay in their home stores.
 *
 * Pure + fs-free: the caller (IpcRequest.TaskHubList handler) injects the
 * per-root readers, so the aggregation rules unit-test cold.
 */

import type {
  IndexJobRecord,
  ReviewReportMeta,
  TaskHubDomain,
  TaskHubGroup,
  TaskHubNode,
  WorkspaceTaskHub,
} from "../../shared/ipc";
import type { TaskTreeSummary } from "@deeporca/core";

/** Design artifact meta — structural subset (avoids importing the ipc type twice). */
type DesignMeta = { id: string; title: string; pipeline: string; updatedAt: string; createdAt?: string };

export interface TaskHubDeps {
  root: string;
  listTrees(): TaskTreeSummary[];
  listReviews(): ReviewReportMeta[];
  listDesigns(): DesignMeta[];
  listJobs(): IndexJobRecord[];
  /** file-history HEAD hash per tree (git binding badge); empty → 无 git 记录. */
  treeGitHash?(treeId: string): string | null;
}

const DOMAIN_ORDER: TaskHubDomain[] = ["session", "index", "review", "prototype"];

/**
 * Build one workspace's aggregated task tree. Per-domain fail-open: a reader
 * that throws costs only its own domain (annotated via a meta.error stub
 * node is NOT added — the group simply lists what it could read; the panel
 * shows the empty-state per group), matching TaskTreeService's discipline.
 */
export function buildTaskHub(deps: TaskHubDeps): WorkspaceTaskHub {
  const groups: TaskHubGroup[] = DOMAIN_ORDER.map((domain) => ({ domain, nodes: [] as TaskHubNode[] }));
  const group = (domain: TaskHubDomain): TaskHubNode[] => groups.find((g) => g.domain === domain)!.nodes;

  // ── session domain — one node per TaskTree (TaskTreeService untouched) ──
  try {
    for (const t of deps.listTrees()) {
      let gitHash: string | null = null;
      try {
        gitHash = deps.treeGitHash?.(t.id) ?? null;
      } catch {
        gitHash = null;
      }
      group("session").push({
        id: t.id,
        domain: "session",
        title: t.title || "task tree",
        status: t.archived ? "archived" : "done",
        startedAt: t.updatedAt,
        endedAt: t.updatedAt,
        source: { kind: "session-tree", treeId: t.id, branchCount: t.branchCount },
        meta: {
          branchCount: t.branchCount,
          nodeCount: t.nodeCount,
          sessionCount: t.sessionIds.length,
          activeBranch: t.activeBranch,
          gitHash,
        },
      });
    }
  } catch {
    // fail-open — session domain lists empty
  }

  // ── index domain — settled build jobs (`.deeporca/jobs/`) ───────────────
  try {
    for (const j of deps.listJobs()) {
      group("index").push({
        id: j.id,
        domain: "index",
        title: `索引与知识构建 · ${j.mode === "init" ? "初始化" : "更新"}`,
        status: j.status === "done" ? "done" : "error",
        startedAt: j.startedAt,
        endedAt: j.endedAt,
        source: { kind: "index-job", jobId: j.id },
        meta: { stages: j.stages, error: j.error },
      });
    }
  } catch {
    // fail-open
  }

  // ── review domain — persisted runs (`.deeporca/reviews/`) ───────────────
  try {
    for (const r of deps.listReviews()) {
      const status: TaskHubNode["status"] =
        r.status === "completed_with_errors" ? "error" : r.status === "completed_with_warnings" ? "warning" : "done";
      group("review").push({
        id: r.id,
        domain: "review",
        title: `代码审查${r.scopeLabel ? ` · ${r.scopeLabel}` : ""}`,
        status,
        startedAt: r.generatedAt,
        endedAt: r.generatedAt,
        source: { kind: "review-report", reportId: r.id },
        meta: {
          filesReviewed: r.filesReviewed,
          comments: r.comments,
          statusNote: r.statusNote,
          scopeLabel: r.scopeLabel,
        },
      });
    }
  } catch {
    // fail-open
  }

  // ── prototype domain — design artifacts ARE the records ─────────────────
  try {
    for (const d of deps.listDesigns()) {
      group("prototype").push({
        id: d.id,
        domain: "prototype",
        title: d.title || d.id,
        status: "done",
        startedAt: d.createdAt ?? d.updatedAt,
        endedAt: d.updatedAt,
        source: { kind: "design-artifact", artifactId: d.id, pipeline: d.pipeline },
        meta: { pipeline: d.pipeline },
      });
    }
  } catch {
    // fail-open
  }

  for (const g of groups) g.nodes.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return { root: deps.root, generatedAt: new Date().toISOString(), groups };
}

/** Total node count across groups (panel badge / pills). */
export function taskHubCount(hub: WorkspaceTaskHub): number {
  return hub.groups.reduce((s, g) => s + g.nodes.length, 0);
}
