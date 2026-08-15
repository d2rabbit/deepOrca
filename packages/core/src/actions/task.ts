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
  return treeId ? { ok: true, treeId } : { ok: false, error: "failed to create task tree" };
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
  const nodeId = svc.fork(treeId, { name: input.name, why, fromBranch: input.fromBranch });
  if (!nodeId) return { ok: false, error: "fork rejected (tree missing, duplicate name, or empty why)" };
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
  const ok = svc.abandon(input?.treeId?.trim() ?? "", input?.branch?.trim() ?? "");
  return ok ? { ok: true } : { ok: false, error: "branch not found or is the active branch" };
};

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
