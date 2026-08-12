/**
 * Code review actions — review.run / review.check-available / review.full.
 *
 * All spawn logic has migrated to desktop's `OcrCliController` (implements
 * `ReviewController`). These action definitions are thin wrappers that delegate
 * to the host-injected controller via `getReviewController()`. Core has zero
 * OCR-specific code (no spawn, no resolver, no JSON parsing).
 *
 * See specs/define-action/design.md + review-controller.ts for the Interface.
 */

import type { ActionDefinition, ActionRun } from "./types";
import type { ControllerProgress } from "./codegraph-controller";
import { getReviewController, type ReviewResult, type ReviewOptions } from "./review-controller";

export type ReviewInput = ReviewOptions;

export interface ReviewAvailability {
  readonly available: boolean;
}

// ── review.run ───────────────────────────────────────────────────────────────

export const reviewRunDefinition: ActionDefinition<ReviewInput> = {
  id: "review.run",
  description:
    "Run AI code review (Open Code Review / ocr) on uncommitted workspace changes vs HEAD. Returns structured {status, comments, summary} with path/start_line/end_line/content/suggestion_code per finding. Use when the user asks to review code, audit changes, or check quality before commit/PR.",
  category: "review",
  parameters: {
    type: "object",
    properties: {
      background: { type: "string", description: "Business context for better review quality." },
      from: { type: "string", description: "Range mode: source ref." },
      to: { type: "string", description: "Range mode: target ref." },
      commit: { type: "string", description: "Commit mode: single commit SHA." },
    },
    additionalProperties: false,
  },
  sideEffects: ["spawn-subprocess", "read-in-cwd"],
};

export const reviewRun: ActionRun<ReviewInput, ReviewResult> = async (input, ctx) => {
  const rc = getReviewController();
  if (!rc) {
    throw new Error("review.run: no ReviewController configured (host must call configureReviewController at boot)");
  }
  return rc.runReview(ctx.projectRoot, input ?? {}, (p: ControllerProgress) => ctx.emit(p));
};

// ── review.check-available ───────────────────────────────────────────────────

export const reviewCheckAvailableDefinition: ActionDefinition = {
  id: "review.check-available",
  description:
    "Check whether AI code review (Open Code Review / ocr) is bundled and available. Returns {available}. Use before review.run to confirm the tool is present.",
  category: "review",
  parameters: { type: "object", properties: {}, additionalProperties: false },
};

export const reviewCheckAvailableRun: ActionRun<unknown, ReviewAvailability> = async () => {
  const rc = getReviewController();
  return { available: rc ? rc.isAvailable() : false };
};

// ── review.full (composite: ocr + CRG risk enrich) ──────────────────────────

export interface ReviewFullOutput {
  readonly review: ReviewResult;
  readonly risk?:
    | {
        readonly changedNodes?: unknown;
        readonly impactRadius?: unknown;
        readonly graphBuilt: true;
      }
    | { readonly graphBuilt: false; readonly reason: string };
}

export const reviewFullDefinition: ActionDefinition = {
  id: "review.full",
  description:
    "Full code review of uncommitted changes — the Code Review module's one-click composite. Runs ocr AI semantic review AND, when the CRG risk graph is built, enriches each finding with structural impact (changed nodes + blast radius). Returns a unified {review, risk} report.",
  category: "review",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  sideEffects: ["spawn-subprocess", "read-in-cwd"],
};

export const reviewFullRun: ActionRun<unknown, ReviewFullOutput> = async (_input, ctx) => {
  const rc = getReviewController();
  if (!rc) {
    throw new Error("review.full: no ReviewController configured");
  }

  // 1. ocr semantic review (via controller — correct JSON schema).
  const review = await rc.runReview(ctx.projectRoot, {}, (p: ControllerProgress) => ctx.emit(p));

  // 2. CRG structural risk enrich (non-fatal — skip if no graph / no MCP dispatch).
  if (!ctx.executeMcpTool) {
    return { review, risk: { graphBuilt: false, reason: "MCP dispatch unavailable" } };
  }
  ctx.emit({ message: "enriching with CRG structural risk", percent: 95 });
  try {
    const detect = await ctx.executeMcpTool("mcp__code-review-graph__detect_changes_tool", {});
    let changedNodes: unknown = undefined;
    if (detect.ok && detect.output) {
      try {
        changedNodes = JSON.parse(detect.output);
      } catch {
        changedNodes = detect.output;
      }
    }
    let impactRadius: unknown = undefined;
    const impact = await ctx.executeMcpTool("mcp__code-review-graph__get_impact_radius_tool", {});
    if (impact.ok && impact.output) {
      try {
        impactRadius = JSON.parse(impact.output);
      } catch {
        impactRadius = impact.output;
      }
    }
    return { review, risk: { changedNodes, impactRadius, graphBuilt: true } };
  } catch (err) {
    return {
      review,
      risk: { graphBuilt: false, reason: err instanceof Error ? err.message : String(err) },
    };
  }
};
