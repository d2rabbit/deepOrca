/**
 * CRG actions — crg.reindex.
 *
 * Build operations delegate to CrgController (desktop's CrgCliController
 * spawns uv). Query operations (formerly crg.analyze via 10 MCP tools) are
 * now handled directly by CrgGraphQuery (Node.js SQLite read) — no Python
 * MCP server needed. review.full uses CrgGraphQuery for structural context.
 * (crg.visualize was deregistered — the in-app risk map reads graph.db
 * through crg-risk-graph.ts instead.)
 */

import type { ActionDefinition, ActionRun } from "./types";
import type { ControllerProgress } from "./codegraph-controller";
import { getCrgController } from "./crg-controller";
import type { BackendStatus } from "../common/analysis-status";

// ── crg.reindex ─────────────────────────────────────────────────────────────

export interface CrgReindexOutput {
  readonly ok: boolean;
  /** Per-call degradation state ("active" on a successful build). */
  readonly status: BackendStatus;
}

export const crgReindexDefinition: ActionDefinition = {
  id: "crg.reindex",
  description:
    "Build (or rebuild) the code-review-graph (CRG) for the current project — the analysis-layer knowledge graph powering risk/impact/architecture queries. Requires uv + CRG wheel (bundled). Run before risk analysis.",
  category: "review",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  sideEffects: ["spawn-subprocess", "write-in-cwd"],
};

export const crgReindexRun: ActionRun<unknown, CrgReindexOutput> = async (_input, ctx) => {
  const cc = getCrgController();
  if (!cc) {
    throw new Error("crg.reindex: no CrgController configured (host must call configureCrgController at boot)");
  }
  await cc.reindex(ctx.projectRoot, (p: ControllerProgress) => ctx.emit(p));
  return { ok: true, status: "active" };
};
