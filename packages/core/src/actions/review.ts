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
import { getCrgController } from "./crg-controller";
import { getCrgGraphQuery, formatCrgContextForOcr, mergeReviewWithCrgRisk } from "./crg-query";
import type { BackendStatus, BackendStatusReport } from "../common/analysis-status";
import { describeBackendStatus } from "../common/analysis-status";
import { execFileSync } from "node:child_process";
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
  /** The scope this run covered (echoed onto the HTML report). */
  readonly scope: {
    readonly mode: "workspace" | "commit" | "range" | "all";
    readonly commit?: string;
    readonly from?: string;
    readonly to?: string;
  };
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

export interface ReviewFullInput {
  /** Scope: uncommitted workspace changes (default), one commit, a range, or
   *  the whole repository (`all`). */
  readonly commit?: string;
  readonly from?: string;
  readonly to?: string;
  readonly all?: boolean;
  readonly background?: string;
}

export const reviewFullDefinition: ActionDefinition = {
  id: "review.full",
  description:
    "Full code review — the Code Review module's one-click composite. Scope: uncommitted workspace changes by default; pass `commit` to review one commit or `from`+`to` for a range. Runs ocr AI semantic review AND, when the CRG risk graph is built, enriches each finding with structural impact (changed nodes + blast radius). Returns a unified {review, risk} report.",
  category: "review",
  parameters: {
    type: "object",
    properties: {
      commit: { type: "string", description: "Commit mode: review the changes of this single commit (e.g. HEAD)." },
      all: {
        type: "boolean",
        description: "Whole-repository scope: review every tracked file (全域审查). Slow on large repos.",
      },
      from: { type: "string", description: "Range mode: source ref (with `to`)." },
      to: { type: "string", description: "Range mode: target ref (with `from`)." },
      background: { type: "string", description: "Business context for better review quality." },
    },
    additionalProperties: false,
  },
  sideEffects: ["spawn-subprocess", "read-in-cwd"],
};

export const reviewFullRun: ActionRun<ReviewFullInput, ReviewFullOutput> = async (input, ctx) => {
  const rc = getReviewController();
  if (!rc) {
    throw new Error("review.full: no ReviewController configured");
  }

  // ⓪ Ensure the CRG risk graph EXISTS before the review (user ask
  // 2026-08-31: the order must be graph-first, and "风险图谱未构建" is not an
  // acceptable steady state — a one-click review builds what it needs). A
  // failed build degrades to the semantic-only path below.
  const crgController = getCrgController();
  if (crgController && !crgController.hasProject(ctx.projectRoot)) {
    ctx.emit({ message: "CRG risk graph missing — building it first (crg.reindex)", percent: 3 });
    try {
      await crgController.reindex(ctx.projectRoot, (p: ControllerProgress) => ctx.emit(p));
    } catch (err) {
      ctx.emit({
        message: `CRG build failed — continuing with semantic-only review: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }

  // Scope resolution (workspace default; commit / range opt-in).
  const scopeInput = input ?? {};
  const scope: ReviewFullOutput["scope"] = scopeInput.all
    ? { mode: "all" }
    : scopeInput.commit
      ? { mode: "commit", commit: scopeInput.commit }
      : scopeInput.from && scopeInput.to
        ? { mode: "range", from: scopeInput.from, to: scopeInput.to }
        : { mode: "workspace" };

  // ① CRG structural analysis (Node.js direct SQLite read — no Python MCP).
  let crgBackground: string | undefined;
  let crgChanges: ReturnType<NonNullable<ReturnType<typeof getCrgGraphQuery>>["detectChanges"]> = [];
  let crgRisks: ReturnType<NonNullable<ReturnType<typeof getCrgGraphQuery>>["getRiskData"]> = [];
  // Kept at the composite scope so the degradation note can tell "nothing
  // changed outside generated dirs" apart from "the query layer failed".
  let changedFiles: string[] = [];
  const crgQuery = getCrgGraphQuery();
  if (crgQuery?.hasGraph(ctx.projectRoot)) {
    ctx.emit({ message: "analyzing CRG structural risk", percent: 5 });
    try {
      // Get changed files for the chosen scope.
      changedFiles = getGitChangedFiles(ctx.projectRoot, scope);
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

  // ② OCR review with CRG structural context (--background) — same scope.
  const review = await rc.runReview(
    ctx.projectRoot,
    {
      background: crgBackground,
      ...(scope.mode === "commit" ? { commit: scope.commit } : {}),
      ...(scope.mode === "range" ? { from: scope.from, to: scope.to } : {}),
      ...(scope.mode === "all" ? { all: true } : {}),
    },
    (p: ControllerProgress) => ctx.emit(p)
  );

  // ②′ HEAD fallback: when the controller re-scoped the run to the latest
  // commit, re-run the CRG change detection for THAT scope so risk tagging
  // matches what was actually reviewed (the workspace-scope detection above
  // saw nothing or saw unrelated junk).
  let effScope: ReviewFullOutput["scope"] = scope;
  if (review.effectiveScope?.mode === "commit" && crgQuery?.hasGraph(ctx.projectRoot)) {
    effScope = { mode: "commit", commit: review.effectiveScope.commit };
    ctx.emit({ message: "re-analyzing CRG structural risk for HEAD", percent: 20 });
    try {
      changedFiles = getGitChangedFiles(ctx.projectRoot, { mode: "commit", commit: effScope.commit });
      crgChanges = crgQuery.detectChanges(ctx.projectRoot, changedFiles);
      if (crgChanges.length > 0) {
        const qualifiedNames = crgChanges.map((c) => c.qualifiedName);
        crgRisks = crgQuery.getRiskData(ctx.projectRoot, qualifiedNames);
        const testGaps = crgQuery.getTestGaps(ctx.projectRoot, qualifiedNames);
        crgBackground = formatCrgContextForOcr(crgChanges, crgRisks, testGaps);
      }
    } catch {
      // best-effort enrichment — the semantic review stands without it
    }
  }

  // ③ Merge: tag each OCR comment with CRG risk level.
  // Status derives from whether enrichment ACTUALLY produced data — not from
  // graph presence: a present-but-failing/empty graph (query swallowed by the
  // catch above, or empty diff) still means "semantic only" (adversarial
  // review round 1 — the flag must not claim enrichment that never ran).
  const graphPresent = crgQuery?.hasGraph(ctx.projectRoot) === true;
  // crgChanges > 0 alone proves enrichment ran: the CRG background was built
  // and injected into the OCR review. Zero RISK rows is a valid outcome
  // (changed leaf functions with no risk data), not a failure.
  const enriched = crgChanges.length > 0;
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
          ? changedFiles.length === 0
            ? "semantic review (ocr) only — no changes outside generated/tooling directories (dot-paths excluded), nothing to structurally enrich"
            : "semantic review (ocr) only — CRG graph present but produced no structural data for this scope (analysis failed or no matched changes)"
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
      scope: effScope,
      status,
      statusNote,
    };
  }

  // No CRG data — return review with risk.skipped.
  return {
    review,
    risk: graphPresent
      ? { graphBuilt: true as const, changedNodes: crgChanges, impactRadius: crgRisks }
      : { graphBuilt: false as const, reason: "no CRG graph" },
    scope: effScope,
    status,
    statusNote,
  };
};

/** List changed files for one scope. Workspace = diff HEAD + untracked;
 *  commit = that commit's diff (vs its first parent); range = from..to.
 *  Dot-files and
 * dot-folders (.git, .deeporca, .code-review-graph, .env & friends) are
 * hard-excluded — same policy as the delegate preview's --exclude (user rule
 * 2026-08-31). Everything the toolchain generates (arch maps, wiki, graph DBs,
 * review reports) lives under dot-directories, so this filter is also what
 * keeps CRG change detection from "reviewing" generated artifacts.
 * Exported for tests. */
export function getGitChangedFiles(
  root: string,
  scope: {
    mode: "workspace" | "commit" | "range" | "all";
    commit?: string;
    from?: string;
    to?: string;
  } = { mode: "workspace" }
): string[] {
  try {
    // SECURITY (CWE-78, same discipline as sqlite-runtime): scope refs are
    // external values — argv-array execFileSync, never a shell string.
    const gitArgs =
      scope.mode === "commit"
        ? ["diff", "--name-only", `${scope.commit ?? "HEAD"}^`, scope.commit ?? "HEAD"]
        : scope.mode === "range"
          ? ["diff", "--name-only", `${scope.from ?? "HEAD"}...${scope.to ?? "HEAD"}`]
          : scope.mode === "all"
            ? ["ls-files"]
            : ["diff", "--name-only", "HEAD"];
    const tracked = execFileSync("git", gitArgs, {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const untracked =
      scope.mode === "workspace"
        ? execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
            cwd: root,
            encoding: "utf8",
            timeout: 5000,
            windowsHide: true,
            stdio: ["ignore", "pipe", "ignore"],
          }).trim()
        : "";
    const files = [...tracked.split("\n"), ...untracked.split("\n")]
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => (path.isAbsolute(f) ? f : path.resolve(root, f)))
      // "all" on a huge repo could exceed downstream SQL placeholder limits —
      // cap the detection set (risk coverage is already top-N downstream).
      .slice(0, 800)
      // Drop anything under a dot-directory or a dot-file itself.
      .filter((f) => {
        const rel = path.relative(root, f).split(/[\\/]/);
        return !rel.some((segment) => segment.startsWith("."));
      });
    return files;
  } catch {
    return [];
  }
}
