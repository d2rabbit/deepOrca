/**
 * Phase 2 CodeGraph actions (spec §四). Sink the symbol-level index lifecycle
 * into core actions so the agent and the unified index.buildAll orchestrator
 * can trigger it. Wraps the existing core helpers in `common/codegraph.ts`
 * (which own the vendored-binary + node:sqlite spawn). Requires Node 22.5+.
 */

import type { ActionDefinition, ActionRun } from "./types";
import { hasCodegraphProject, runCodegraphResetAsync } from "../common/codegraph";

export interface CodegraphReindexOutput {
  readonly ok: boolean;
}

export const codegraphReindexDefinition: ActionDefinition = {
  id: "codegraph.reindex",
  description:
    "Build (or rebuild) the CodeGraph symbol index (.codegraph/) for the current project — the navigation/retrieval layer powering symbol/caller/callee/impact queries. Resets then re-inits. Requires Node 22.5+ (node:sqlite). Run before code navigation queries.",
  category: "index",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  sideEffects: ["spawn-subprocess", "write-in-cwd"],
};

export const codegraphReindexRun: ActionRun<unknown, CodegraphReindexOutput> = async (_input, ctx) => {
  ctx.emit({ message: "rebuilding CodeGraph symbol index", percent: 10 });
  await runCodegraphResetAsync(ctx.projectRoot);
  ctx.emit({ message: "CodeGraph symbol index built", percent: 100 });
  return { ok: true };
};

export interface CodegraphIndexEntry {
  readonly root: string;
  readonly label: string;
  readonly initialized: boolean;
}

export const codegraphListDefinition: ActionDefinition = {
  id: "codegraph.list",
  description:
    "Report the CodeGraph index status for the current project: {root, label, initialized}. initialized=false means .codegraph/ is absent (run codegraph.reindex).",
  category: "index",
  parameters: { type: "object", properties: {}, additionalProperties: false },
};

export const codegraphListRun: ActionRun<unknown, CodegraphIndexEntry[]> = async (_input, ctx) => {
  const root = ctx.projectRoot;
  return [
    {
      root,
      label: root.split("/").pop() || root,
      initialized: hasCodegraphProject(root),
    },
  ];
};
