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
  /** Plain conversations WITHOUT a task tree (user ask 2026-09-03: 历史任务树
   *  要收录普通会话任务，GVGL 案例)。Caller pre-filters: silent subagents and
   *  taskRef-bound sessions (those surface as their tree) are excluded, sorted
   *  newest-first. `status` is the raw core SessionStatus string. */
  listChats?(): Array<{ id: string; title: string; status: string; updatedAt: string }>;
  /** Editor pair runs (specs/editor-copilot 链路 D) — newest-first. Mirrors
   *  editor-runs-store's EditorRunRecord (behavior + token fields included). */
  listEditorRuns?(): Array<{
    runId: string;
    file: string;
    instruction: string;
    status: "done" | "error";
    startedAt: string;
    endedAt?: string;
    added?: number;
    removed?: number;
    iterations?: number;
    durationMs?: number;
    tokens?: { prompt: number; completion: number };
  }>;
}

/** Core SessionStatus → hub node status. Everything still alive reads as
 *  running/warning so the rail dot reflects "not finished yet". */
const CHAT_STATUS: Record<string, TaskHubNode["status"]> = {
  processing: "running",
  pending: "running",
  completed: "done",
  failed: "error",
  interrupted: "warning",
  paused: "warning",
  permission_denied: "warning",
  ask_permission: "warning",
  waiting_for_user: "warning",
};

const DOMAIN_ORDER: TaskHubDomain[] = ["session", "index", "review", "prototype", "editor"];

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

  // ── plain conversations (user ask 2026-09-03) — sessions that never called
  //    task.create are still 会话任务: appended as chat nodes so the hub
  //    collects the workspace's whole session history. No local sort needed —
  //    the tail pass below sorts every group by startedAt desc, interleaving
  //    trees and chats on one timeline.
  try {
    for (const s of deps.listChats?.() ?? []) {
      group("session").push({
        id: s.id,
        domain: "session",
        title: s.title || "session",
        status: CHAT_STATUS[s.status] ?? "done",
        startedAt: s.updatedAt,
        source: { kind: "session-chat", sessionId: s.id },
      });
    }
  } catch {
    // fail-open — chats simply don't list
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

  // ── editor domain — pair runs from the editor-runs store (链路 D) ─────
  try {
    for (const r of deps.listEditorRuns?.() ?? []) {
      group("editor").push({
        id: r.runId,
        domain: "editor",
        title: r.instruction.slice(0, 80) || "pair run",
        status: r.status === "error" ? "error" : "done",
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        source: { kind: "editor-run", runId: r.runId, file: r.file },
        // added/removed ride only when the settlement knew them (editor-run
        // records currently settle without diff stats — display stays honest
        // instead of showing a permanent +0 −0).
        meta: {
          file: r.file,
          ...((r.added ?? 0) > 0 || (r.removed ?? 0) > 0 ? { added: r.added, removed: r.removed } : {}),
          // Behavior + cost (2026-09-06 user ask: token 消耗与 agent 行为记录进任务树)
          ...(r.tokens ? { tokens: { ...r.tokens, total: r.tokens.prompt + r.tokens.completion } } : {}),
          ...(r.iterations !== undefined ? { iterations: r.iterations } : {}),
          ...(r.durationMs !== undefined ? { durationMs: r.durationMs } : {}),
        },
      });
    }
  } catch {
    // fail-open: an unreadable store costs only the editor group
  }

  // Sorted LAST so the editor domain joins the same ordering contract as
  // every other group (previously editor nodes relied on the store being
  // newest-first — an implicit contract any store change would silently break).
  for (const g of groups) g.nodes.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return { root: deps.root, generatedAt: new Date().toISOString(), groups };
}

/** Total node count across groups (panel badge / pills). */
export function taskHubCount(hub: WorkspaceTaskHub): number {
  return hub.groups.reduce((s, g) => s + g.nodes.length, 0);
}
