/**
 * CodeGraph actions — codegraph.reindex / codegraph.list.
 *
 * All SDK/subprocess logic has migrated to desktop's `SdkCodegraphController`
 * (implements `CodegraphController`). These action definitions delegate to the
 * host-injected controller. Core has zero CodeGraph-specific code.
 */

import type { ActionDefinition, ActionRun } from "./types";
import type { ControllerProgress } from "./codegraph-controller";
import { getCodegraphController } from "./codegraph-controller";

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
  const cg = getCodegraphController();
  if (!cg) {
    throw new Error(
      "codegraph.reindex: no CodegraphController configured (host must call configureCodegraphController at boot)"
    );
  }
  await cg.reindex(ctx.projectRoot, (p: ControllerProgress) => ctx.emit(p));
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
  const cg = getCodegraphController();
  const root = ctx.projectRoot;
  return [
    {
      root,
      label: root.split("/").pop() || root,
      initialized: cg ? cg.hasProject(root) : false,
    },
  ];
};
