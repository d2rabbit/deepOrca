/**
 * task.* actions — the agent-facing surface of the task trajectory (P0).
 *
 * The tree itself is for HUMANS to read; these actions are how the agent
 * (or a user via the chat) operates it: create a tree for a multi-step task,
 * fork a branch when a genuinely different approach is worth trying, record
 * steps, switch, abandon. Every fork REQUIRES a `why` — the panel renders it
 * as the branch's story; a structure without narrative is useless to people.
 */

import type { ActionContext, ActionDefinition, ActionRun } from "./types";
import type { TaskTreeService } from "../tasks/task-tree-service";

export interface TaskCreateInput {
  prompt: string;
  why?: string;
  branchName?: string;
}
export interface TaskForkInput {
  treeId: string;
  name?: string;
  why: string;
  fromBranch?: string;
  /** Memory unit ids to seed the branch with (memory-driven fork, spec §3.2 step 5). */
  memorySnapshot?: string[];
}
export interface TaskSwitchInput {
  treeId: string;
  branch: string;
}
export interface TaskAbandonInput {
  treeId: string;
  branch: string;
}
export interface TaskStepInput {
  treeId: string;
  title: string;
  why?: string;
}

function service(ctx: ActionContext): TaskTreeService | null {
  // Host-injected lazy provider (same accept-dependencies rule as spawner).
  try {
    return ctx.taskTrees?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * Session binding (P1): when a task tree is created/forked from inside a
 * session, stamp the branch head's sessionRef and the session entry's taskRef
 * reverse pointer. Both are best-effort — binding failure never fails the task
 * action (the tree works unbound too).
 */
function bindSessionToTree(ctx: ActionContext, svc: TaskTreeService, treeId: string): void {
  try {
    const sessionId = ctx.activeSessionId?.();
    if (!sessionId) return;
    const tree = svc.getTree(treeId);
    if (!tree) return;
    const branch = tree.index.activeBranch;
    const headId = tree.index.branches[branch]?.headId;
    if (!headId) return;
    svc.bindSession(treeId, branch, sessionId);
    ctx.setSessionTaskRef?.(sessionId, { treeId, branch, nodeId: headId });
  } catch {
    // Binding is best-effort.
  }
}

export const taskCreateDefinition: ActionDefinition<TaskCreateInput> = {
  id: "task.create",
  description:
    "Create a task tree for a multi-step piece of work, then track progress with task.step. " +
    "Use for tasks that may need branches (trying alternative approaches). Not for simple one-shot requests.",
  category: "tasks",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "The overall task description (root node title)" },
      why: { type: "string", description: "Why this task exists — shown to the human in the tree panel" },
      branchName: { type: "string", description: "Optional initial branch name (default 'main')" },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const taskCreateRun: ActionRun<TaskCreateInput, { ok: boolean; treeId?: string; error?: string }> = async (
  input,
  ctx
) => {
  const svc = service(ctx);
  if (!svc) return { ok: false, error: "task tree service unavailable" };
  const prompt = input?.prompt?.trim();
  if (!prompt) return { ok: false, error: "prompt is required" };
  ctx.emit({ message: "🌳 创建任务树…", percent: 50 });
  const treeId = svc.createTree(prompt, { why: input.why, branchName: input.branchName });
  if (!treeId) return { ok: false, error: "failed to create task tree" };
  bindSessionToTree(ctx, svc, treeId);
  return { ok: true, treeId };
};

export const taskStepDefinition: ActionDefinition<TaskStepInput> = {
  id: "task.step",
  description: "Append a completed-or-planned step to the active branch of a task tree.",
  category: "tasks",
  parameters: {
    type: "object",
    properties: {
      treeId: { type: "string", description: "Task tree id from task.create" },
      title: { type: "string", description: "Short step title" },
      why: { type: "string", description: "Why this step / what it concluded (human-facing)" },
    },
    required: ["treeId", "title"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const taskStepRun: ActionRun<TaskStepInput, { ok: boolean; nodeId?: string; error?: string }> = async (
  input,
  ctx
) => {
  const svc = service(ctx);
  if (!svc) return { ok: false, error: "task tree service unavailable" };
  if (!input?.treeId?.trim() || !input?.title?.trim()) {
    return { ok: false, error: "treeId and title are required" };
  }
  const nodeId = svc.appendStep(input.treeId.trim(), {
    title: input.title.trim(),
    why: input.why,
  });
  return nodeId ? { ok: true, nodeId } : { ok: false, error: "tree not found or step rejected" };
};

export const taskForkDefinition: ActionDefinition<TaskForkInput> = {
  id: "task.fork",
  description:
    "Fork a new branch from a task tree's current head to try a genuinely different approach in parallel. " +
    "The new branch becomes active. REQUIRED: a human-readable `why` — the reason this alternative is worth trying.",
  category: "tasks",
  parameters: {
    type: "object",
    properties: {
      treeId: { type: "string", description: "Task tree id" },
      name: { type: "string", description: "New branch name (auto-generated when omitted)" },
      why: { type: "string", description: "Why fork here — the story shown next to the branch" },
      fromBranch: { type: "string", description: "Branch to fork from (default: active branch)" },
      memorySnapshot: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional memory unit ids recalled via task.recall to seed the branch (creates a memory-spawn node " +
          "whose context carries the recalled rationale)",
      },
    },
    required: ["treeId", "why"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const taskForkRun: ActionRun<
  TaskForkInput,
  { ok: boolean; branch?: string; nodeId?: string; error?: string }
> = async (input, ctx) => {
  const svc = service(ctx);
  if (!svc) return { ok: false, error: "task tree service unavailable" };
  const treeId = input?.treeId?.trim();
  const why = input?.why?.trim();
  if (!treeId || !why) return { ok: false, error: "treeId and why are required" };
  ctx.emit({ message: "🌱 分叉任务分支…", percent: 50 });
  const nodeId = svc.fork(treeId, {
    name: input.name,
    why,
    fromBranch: input.fromBranch,
    memorySnapshot: input.memorySnapshot,
  });
  if (!nodeId) return { ok: false, error: "fork rejected (tree missing, duplicate name, or empty why)" };
  // Follow the fork: rebind the session to the new branch head so later
  // plan materialization / design steps land on the branch the session is
  // now working on, not wherever the tree was left (spec §3.1 "fork switches").
  bindSessionToTree(ctx, svc, treeId);
  const tree = svc.getTree(treeId);
  return { ok: true, nodeId, branch: tree?.index.activeBranch };
};

export const taskSwitchDefinition: ActionDefinition<TaskSwitchInput> = {
  id: "task.switch",
  description: "Switch the task tree's active branch (subsequent task.step calls land on it).",
  category: "tasks",
  parameters: {
    type: "object",
    properties: {
      treeId: { type: "string" },
      branch: { type: "string" },
    },
    required: ["treeId", "branch"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const taskSwitchRun: ActionRun<TaskSwitchInput, { ok: boolean; error?: string }> = async (input, ctx) => {
  const svc = service(ctx);
  if (!svc) return { ok: false, error: "task tree service unavailable" };
  const ok = svc.switchBranch(input?.treeId?.trim() ?? "", input?.branch?.trim() ?? "");
  return ok ? { ok: true } : { ok: false, error: "branch not found or abandoned" };
};

export const taskAbandonDefinition: ActionDefinition<TaskAbandonInput> = {
  id: "task.abandon",
  description: "Mark a task branch as abandoned (archived, visible-but-greyed; the active branch cannot be abandoned).",
  category: "tasks",
  parameters: {
    type: "object",
    properties: {
      treeId: { type: "string" },
      branch: { type: "string" },
    },
    required: ["treeId", "branch"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const taskAbandonRun: ActionRun<TaskAbandonInput, { ok: boolean; error?: string }> = async (input, ctx) => {
  const svc = service(ctx);
  if (!svc) return { ok: false, error: "task tree service unavailable" };
  const treeId = input?.treeId?.trim() ?? "";
  const branch = input?.branch?.trim() ?? "";
  const ok = svc.abandon(treeId, branch);
  if (ok) recycleLineageMessage(ctx, treeId, branch, "abandoned", "");
  return ok ? { ok: true } : { ok: false, error: "branch not found or is the active branch" };
};

/**
 * Lineage recycle (spec §3.2 step 6): terminal branch events become a hidden
 * <task-lineage> system message in the active session — the existing memory
 * capture pipeline ingests it, so "the cost and payoff of forking" enters
 * long-term memory without any memory-package surgery.
 */
function recycleLineageMessage(
  ctx: ActionContext,
  treeId: string,
  branch: string,
  outcome: "merged" | "abandoned",
  note: string
): void {
  try {
    const sessionId = ctx.activeSessionId?.();
    if (!sessionId) return;
    const svc = ctx.taskTrees?.();
    const tree = svc?.getTree(treeId);
    const forkNode = tree?.nodes.find((n) => n.id === tree.index.branches[branch]?.headId) ?? null;
    const why = forkNode?.why ?? "(fork rationale not recorded)";
    ctx.appendSessionSystemMessage?.(
      sessionId,
      `<task-lineage>\ntask-tree branch "${branch}" of "${tree?.index.title ?? treeId}" reached outcome: ${outcome}.` +
        `\nFork rationale: ${why}` +
        (note ? `\nNote: ${note}` : "") +
        `\n</task-lineage>`
    );
  } catch {
    // Recycle is best-effort.
  }
}

export const taskListDefinition: ActionDefinition<Record<string, never>> = {
  id: "task.list",
  description: "List task trees (id, title, active branch, branch/node counts) so the agent can pick up prior work.",
  category: "tasks",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  sideEffects: [],
};

export const taskListRun: ActionRun<Record<string, never>, { ok: boolean; trees?: unknown[] }> = async (
  _input,
  ctx
) => {
  const svc = service(ctx);
  if (!svc) return { ok: false, error: "task tree service unavailable" };
  return { ok: true, trees: svc.listTrees() };
};

export interface TaskMergeInput {
  treeId: string;
  srcBranch: string;
  picks: string[];
  why?: string;
}

export const taskMergeDefinition: ActionDefinition<TaskMergeInput> = {
  id: "task.merge",
  description:
    "Cherry-pick merge: pick nodes from a source branch onto the tree's ACTIVE branch. " +
    "Merged content is the picked nodes' artifact references (references transfer, picks win) + a decision summary. " +
    "Returns a conflict list when an artifact already exists on the target — surface it to the human; nothing is auto-resolved.",
  category: "tasks",
  parameters: {
    type: "object",
    properties: {
      treeId: { type: "string" },
      srcBranch: { type: "string", description: "Branch to merge FROM (must differ from the active branch)" },
      picks: {
        type: "array",
        items: { type: "string" },
        description: "Node ids on the source branch lineage to merge",
      },
      why: { type: "string", description: "Why this merge — the human-facing decision summary" },
    },
    required: ["treeId", "srcBranch", "picks"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const taskMergeRun: ActionRun<
  TaskMergeInput,
  { ok: boolean; mergeNodeId?: string; conflicts?: Array<{ artifactRef: string; targetTitle: string }>; error?: string }
> = async (input, ctx) => {
  const svc = service(ctx);
  if (!svc) return { ok: false, error: "task tree service unavailable" };
  const treeId = input?.treeId?.trim();
  const srcBranch = input?.srcBranch?.trim();
  const picks = Array.isArray(input?.picks) ? input.picks.filter((p) => typeof p === "string" && p.trim()) : [];
  if (!treeId || !srcBranch || picks.length === 0) {
    return { ok: false, error: "treeId, srcBranch and non-empty picks are required" };
  }
  ctx.emit({ message: `⇄ 从 ${srcBranch} 合并 ${picks.length} 个节点…`, percent: 50 });
  const result = svc.merge(treeId, srcBranch, picks, { why: input.why });
  if (!result) {
    return { ok: false, error: "merge rejected (tree/branch missing, self-merge, or invalid picks)" };
  }
  recycleLineageMessage(ctx, treeId, srcBranch, "merged", input.why ?? "");
  return {
    ok: true,
    mergeNodeId: result.mergeNodeId,
    ...(result.conflicts.length > 0
      ? {
          conflicts: result.conflicts,
        }
      : {}),
  };
};

export interface TaskRecallInput {
  query: string;
  excludeCurrentTree?: boolean;
}

export const taskRecallDefinition: ActionDefinition<TaskRecallInput> = {
  id: "task.recall",
  description:
    "At a decision point (before choosing between approaches), recall historical task-tree forks similar to the " +
    "current situation — each candidate carries the fork rationale AND what happened to that branch " +
    "(merged/abandoned/open). Present them to the user when relevant; a fork proposal needs their approval " +
    "(task.fork with a memorySnapshot seeds the branch).",
  category: "tasks",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The current task/decision description to match against" },
      excludeCurrentTree: { type: "boolean", description: "Exclude the current session's tree (default true)" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  sideEffects: [],
};

export const taskRecallRun: ActionRun<
  TaskRecallInput,
  { ok: boolean; candidates?: Array<Record<string, unknown>> }
> = async (input, ctx) => {
  const svc = service(ctx);
  if (!svc) return { ok: false };
  const query = input?.query?.trim();
  if (!query) return { ok: true, candidates: [] };
  let excludeTreeId: string | undefined;
  if (input?.excludeCurrentTree !== false) {
    const sessionId = ctx.activeSessionId?.();
    excludeTreeId = sessionId ? (ctx.getSessionTaskRef?.(sessionId)?.treeId ?? undefined) : undefined;
  }
  const candidates = svc.recallAtDecision(query, { excludeTreeId });
  return {
    ok: true,
    candidates: candidates.map((c) => ({
      tree: c.treeTitle,
      branch: c.branch,
      why: c.forkWhy,
      outcome: c.outcome,
      similarity: Math.round(c.similarity * 100) / 100,
    })),
  };
};
