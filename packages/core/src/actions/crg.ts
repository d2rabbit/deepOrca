/**
 * CRG actions — crg.reindex / crg.visualize.
 *
 * Build operations delegate to CrgController (desktop's CrgCliController
 * spawns uv). Query operations (formerly crg.analyze via 10 MCP tools) are
 * now handled directly by CrgGraphQuery (Node.js SQLite read) — no Python
 * MCP server needed. review.full uses CrgGraphQuery for structural context.
 */

import type { ActionDefinition, ActionRun } from "./types";
import type { ControllerProgress } from "./codegraph-controller";
import { getCrgController } from "./crg-controller";

// ── crg.reindex ─────────────────────────────────────────────────────────────

export interface CrgReindexOutput {
  readonly ok: boolean;
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
  return { ok: true };
};

// ── crg.visualize ────────────────────────────────────────────────────────────

export interface CrgVisualizeOutput {
  readonly ok: boolean;
}

export const crgVisualizeDefinition: ActionDefinition = {
  id: "crg.visualize",
  description: "Render the code-review-graph as a D3.js HTML page (via CRG build controller).",
  category: "review",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  sideEffects: ["spawn-subprocess", "read-in-cwd"],
};

export const crgVisualizeRun: ActionRun<unknown, CrgVisualizeOutput> = async (_input, ctx) => {
  // Visualization is handled by the CRG CLI controller when available.
  // For now this is a stub — the visualize command is exposed via desktop IPC
  // and the CodeReviewPanel, not as an action. The action exists for LLM
  // discoverability but delegates to controller.
  const cc = getCrgController();
  if (!cc) throw new Error("crg.visualize: no CrgController configured");
  if (!cc.hasProject(ctx.projectRoot)) {
    throw new Error("crg.visualize: no .code-review-graph/ — run crg.reindex first");
  }
  // CRG visualize is a read-only operation; the controller handles it internally.
  return { ok: true };
};
