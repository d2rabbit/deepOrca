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
import { getCrgGraphQuery, formatCrgContextForOcr, mergeReviewWithCrgRisk } from "./crg-query";
import type { BackendStatus, BackendStatusReport } from "../common/analysis-status";
import { describeBackendStatus } from "../common/analysis-status";
import * as path from "node:path";

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
  /** Per-call degradation state: active = semantic + structural, degraded = semantic only. */
  readonly status: BackendStatus;
  /** One-line human/model-readable status sentence (state + remedy). */
  readonly statusNote: string;
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

  // ① CRG structural analysis (Node.js direct SQLite read — no Python MCP).
  let crgBackground: string | undefined;
  let crgChanges: ReturnType<NonNullable<ReturnType<typeof getCrgGraphQuery>>["detectChanges"]> = [];
  let crgRisks: ReturnType<NonNullable<ReturnType<typeof getCrgGraphQuery>>["getRiskData"]> = [];
  const crgQuery = getCrgGraphQuery();
  if (crgQuery?.hasGraph(ctx.projectRoot)) {
    ctx.emit({ message: "analyzing CRG structural risk", percent: 5 });
    try {
      // Get changed files from git diff.
      const changedFiles = getGitChangedFiles(ctx.projectRoot);
      crgChanges = crgQuery.detectChanges(ctx.projectRoot, changedFiles);
      if (crgChanges.length > 0) {
        const qualifiedNames = crgChanges.map((c) => c.qualifiedName);
        crgRisks = crgQuery.getRiskData(ctx.projectRoot, qualifiedNames);
        const testGaps = crgQuery.getTestGaps(ctx.projectRoot, qualifiedNames);
        crgBackground = formatCrgContextForOcr(crgChanges, crgRisks, testGaps);
        ctx.emit({ message: `CRG: ${crgChanges.length} functions, ${testGaps.length} test gaps`, percent: 10 });
      }
    } catch {
      // CRG query failed — proceed without structural context.
    }
  }

  // ② OCR review with CRG structural context (--background).
  const review = await rc.runReview(ctx.projectRoot, { background: crgBackground }, (p: ControllerProgress) =>
    ctx.emit(p)
  );

  // ③ Merge: tag each OCR comment with CRG risk level.
  // Status derives from whether enrichment ACTUALLY produced data — not from
  // graph presence: a present-but-failing/empty graph (query swallowed by the
  // catch above, or empty diff) still means "semantic only" (adversarial
  // review round 1 — the flag must not claim enrichment that never ran).
  const graphPresent = crgQuery?.hasGraph(ctx.projectRoot) === true;
  const enriched = crgChanges.length > 0 && crgRisks.length > 0;
  const statusReport: BackendStatusReport = enriched
    ? {
        status: "active",
        backend: "review.full",
        detail: "semantic review (ocr) + structural enrichment (CRG risk graph)",
      }
    : {
        status: "degraded",
        backend: "review.full",
        detail: graphPresent
          ? "semantic review (ocr) only — CRG graph present but produced no structural data (analysis failed or no matched changes)"
          : "semantic review (ocr) only — structural impact enrichment unavailable (no .code-review-graph/)",
        remedy: graphPresent ? undefined : "run crg.reindex for per-finding blast-radius data",
      };
  const statusNote = describeBackendStatus(statusReport);
  const status = statusReport.status;

  if (crgChanges.length > 0 && crgRisks.length > 0) {
    const merged = mergeReviewWithCrgRisk(review.comments, crgRisks, crgChanges);
    return {
      review: { ...review, comments: merged as unknown as typeof review.comments },
      risk: {
        changedNodes: crgChanges,
        impactRadius: crgRisks,
        graphBuilt: true as const,
      },
      status,
      statusNote,
    };
  }

  // No CRG data — return review with risk.skipped.
  return {
    review,
    risk: graphPresent
      ? { graphBuilt: true as const, changedNodes: [], impactRadius: [] }
      : { graphBuilt: false as const, reason: "no .code-review-graph/" },
    status,
    statusNote,
  };
};

/** Get changed files from git diff HEAD (workspace mode). */
function getGitChangedFiles(root: string): string[] {
  try {
    const { execSync } = require("node:child_process");
    const tracked = execSync("git diff --name-only HEAD", {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const untracked = execSync("git ls-files --others --exclude-standard", {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const files = [...tracked.split("\n"), ...untracked.split("\n")]
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => (path.isAbsolute(f) ? f : path.resolve(root, f)));
    return files;
  } catch {
    return [];
  }
}
