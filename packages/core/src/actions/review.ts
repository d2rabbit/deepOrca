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
import {
  getCrgGraphQuery,
  formatCrgContextForOcr,
  mergeReviewWithCrgRisk,
  type ChangedLineRange,
  type CrgChangedFunction,
  type CrgRiskData,
} from "./crg-query";
import { CRG_DATA_DIR } from "../common/generated-dirs";
import type { BackendStatus, BackendStatusReport } from "../common/analysis-status";
import { describeBackendStatus } from "../common/analysis-status";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
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
        readonly changedNodes?: CrgChangedFunction[];
        readonly impactRadius?: CrgRiskData[];
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

// One review.full at a time per root (review round 2026-09-01): the chat
// surface and the panel button can both trigger a run, and two concurrent
// composites double the OCR pipeline AND both see `!hasProject` in ⓪ —
// racing two 20-minute crg.reindex builds against each other. Same
// per-root discipline as desktop's wiki-cli lock.
const reviewFullQueues = new Map<string, Promise<unknown>>();
function serializeReviewFull<T>(root: string, body: () => Promise<T>): Promise<T> {
  const prev = reviewFullQueues.get(root) ?? Promise.resolve();
  // The next body runs regardless of whether the predecessor resolved or
  // threw; failures must not poison the chain.
  const next = prev.then(body, body);
  reviewFullQueues.set(
    root,
    next.catch(() => undefined)
  );
  return next;
}

const reviewFullRunInner: ActionRun<ReviewFullInput, ReviewFullOutput> = async (input, ctx) => {
  // Input validation FIRST — before the ⓪ graph build (a 20-minute crg
  // build must not run for a request that can never be reviewed).
  // SECURITY (CWE-88): refs are free-form strings from the LLM action
  // surface — a value like "--output=…" would ride into git as an OPTION
  // (arbitrary file write); argv arrays stop shell injection, not option
  // injection. Fail LOUDLY here (the surface's own contract), and the two
  // git readers below degrade defensively on top.
  const scopeInputEarly = input ?? {};
  for (const [name, ref] of Object.entries({
    commit: scopeInputEarly.commit,
    from: scopeInputEarly.from,
    to: scopeInputEarly.to,
  })) {
    if (ref && ref.startsWith("-")) {
      throw new Error(
        `review.full: \`${name}\` looks like a git OPTION, not a revision (${JSON.stringify(ref)}) — pass a ref (SHA, branch, HEAD)`
      );
    }
  }
  if ((scopeInputEarly.from && !scopeInputEarly.to) || (!scopeInputEarly.from && scopeInputEarly.to)) {
    throw new Error(
      `review.full: range scope requires BOTH \`from\` and \`to\` (got ${scopeInputEarly.from ? "`from`" : "`to`"} only) — pass both refs or neither`
    );
  }

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

  // Scope resolution (workspace default; commit / range opt-in). The input
  // validations (option-shaped refs, half-specified range) already ran at
  // the top of the function — before any side effects.
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
  // True only when the structural background was built BEFORE the OCR review
  // and actually injected into it — the basis for an honest "semantic +
  // structural" status (review round 2026-09-01: the HEAD-fallback re-analysis
  // in ②′ runs AFTER the review, so it must not claim the reviewer saw it).
  let structuralContextInjected = false;
  let crgChanges: ReturnType<NonNullable<ReturnType<typeof getCrgGraphQuery>>["detectChanges"]> = [];
  let crgRisks: ReturnType<NonNullable<ReturnType<typeof getCrgGraphQuery>>["getRiskData"]> = [];
  // Kept at the composite scope so the degradation note can tell "nothing
  // changed outside generated dirs" apart from "the query layer failed".
  let changedFiles: string[] = [];
  const crgQuery = getCrgGraphQuery();
  if (crgQuery?.hasGraph(ctx.projectRoot)) {
    ctx.emit({ message: "analyzing CRG structural risk", percent: 5 });
    try {
      // Get changed files for the chosen scope — LINE-precise when the diff
      // hunks parse (mining item ①): the range map narrows detection to
      // functions whose definition actually overlaps a changed line, so a
      // 40-line file with a 2-line edit no longer flags every symbol.
      changedFiles = getGitChangedFiles(ctx.projectRoot, scope);
      const changedRanges = getGitChangedRanges(ctx.projectRoot, scope);
      crgChanges = crgQuery.detectChanges(ctx.projectRoot, changedFiles, changedRanges);
      if (crgChanges.length > 0) {
        const qualifiedNames = crgChanges.map((c) => c.qualifiedName);
        crgRisks = crgQuery.getRiskData(ctx.projectRoot, qualifiedNames);
        const testGaps = crgQuery.getTestGaps(ctx.projectRoot, qualifiedNames);
        // Mining items ③⑤: affected flows, true blast radius and
        // inheritance edges ride the background as review directives.
        const flows = crgQuery.getAffectedFlows(ctx.projectRoot, changedFiles);
        const impactedCount = crgQuery.getImpactRadius(ctx.projectRoot, qualifiedNames, 2).length;
        const inheritanceCount = crgQuery.getInheritanceEdges(ctx.projectRoot, qualifiedNames);
        const churnCounts = getChurnCounts(ctx.projectRoot);
        const churnHotspots = changedFiles
          .map((f) => {
            const key = toRepoPosix(ctx.projectRoot, f);
            const commits = churnCounts[key] ?? 0;
            return commits >= CHURN_HOTSPOT_MIN ? { file: key, commits } : null;
          })
          .filter((h): h is { file: string; commits: number } => h !== null)
          .sort((a, b) => b.commits - a.commits)
          .slice(0, 5);
        crgBackground = formatCrgContextForOcr(crgChanges, crgRisks, testGaps, {
          flows,
          impactedCount,
          inheritanceCount,
          changedFileCount: changedFiles.length,
          churnHotspots,
        });
        structuralContextInjected = true;
        ctx.emit({
          message: `CRG: ${crgChanges.length} functions, ${flows.length} flows, ${testGaps.length} test gaps`,
          percent: 10,
        });
      }
    } catch {
      // CRG query failed — proceed without structural context.
    }
  }

  // ⑥ Graph freshness (mining item ⑥, design-spec approved): a build-time
  // snapshot silently goes stale as the workspace moves — changed files
  // whose CONTENT differs from the graph's recorded file_hash would be
  // enriched against outdated line numbers. Compare (sampled) current
  // contents and say so in the status note; the review still runs.
  const staleFiles = crgQuery?.hasGraph(ctx.projectRoot) ? detectStaleFiles(ctx.projectRoot, changedFiles) : [];

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
  // saw nothing or saw unrelated junk). POST-HOC by design: the semantic
  // review already ran, so this only feeds the merge below — no background
  // is rebuilt here (it would be dead; the reviewer never sees it).
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
  // crgChanges > 0 alone proves enrichment RAN — but not that the reviewer
  // SAW the structural background: in the HEAD-fallback path ②′ re-detects
  // after the review, so the tags are real while the injection never happened
  // (review round 2026-09-01 — the status must not blur that distinction).
  const enriched = crgChanges.length > 0;
  const statusReport: BackendStatusReport = enriched
    ? {
        status: "active",
        backend: "review.full",
        detail: structuralContextInjected
          ? "semantic review (ocr) + structural enrichment (CRG risk graph)"
          : "semantic review (ocr) + post-hoc structural risk tags (CRG analyzed after the review — HEAD fallback re-scoped the run; the reviewer itself did not see the structural background)",
      }
    : {
        status: "degraded",
        backend: "review.full",
        detail: graphPresent
          ? changedFiles.length === 0
            ? "semantic review (ocr) only — no changes outside generated/tooling directories (dot-paths excluded), nothing to structurally enrich"
            : "semantic review (ocr) only — CRG graph present but produced no structural data for this scope (analysis failed or no matched changes)"
          : `semantic review (ocr) only — structural impact enrichment unavailable (no CRG graph under ${CRG_DATA_DIR}/)`,
        remedy: graphPresent ? undefined : "run crg.reindex for per-finding blast-radius data",
      };
  const statusNote = describeBackendStatus(statusReport);
  const status = statusReport.status;
  const stalenessNote =
    staleFiles.length > 0
      ? ` — CRG graph is stale: ${staleFiles.length} changed file(s) (${staleFiles
          .slice(0, 3)
          .join(
            ", "
          )}${staleFiles.length > 3 ? "…" : ""}) differ from the last build — run crg.reindex for accurate structural analysis`
      : "";

  if (crgChanges.length > 0 && crgRisks.length > 0) {
    // projectRoot lets the merge resolve the comments' repo-relative paths
    // into the graph's POSIX-absolute identity — without it the per-finding
    // CRG tags can never attach (review round 2026-09-01).
    const merged = mergeReviewWithCrgRisk(review.comments, crgRisks, crgChanges, ctx.projectRoot);
    return {
      // merged is ReviewComment-shaped plus the extra crgRisk tag — directly
      // assignable, no cast needed.
      review: { ...review, comments: merged },
      risk: {
        changedNodes: crgChanges,
        impactRadius: crgRisks,
        graphBuilt: true as const,
      },
      scope: effScope,
      status,
      statusNote: statusNote + stalenessNote,
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
    statusNote: statusNote + stalenessNote,
  };
};

/** Serialized composite (see reviewFullQueues): concurrent invocations queue
 *  per root instead of racing duplicate OCR pipelines / graph builds. */
export const reviewFullRun: ActionRun<ReviewFullInput, ReviewFullOutput> = (input, ctx) =>
  serializeReviewFull(ctx.projectRoot, () => reviewFullRunInner(input, ctx));

/** SECURITY (CWE-88, defense in depth under the action-level ref check): a
 *  ref beginning with "-" would ride into the git argv as an OPTION (e.g.
 *  `--output=<path>` writes the diff to an arbitrary file) — clamp to the
 *  fallback instead of executing it. */
function safeGitRef(ref: string | undefined, fallback: string): string {
  return ref && !ref.startsWith("-") ? ref : fallback;
}

/** List changed files for one scope. Workspace = diff HEAD + untracked;
 *  commit = that commit's diff (vs its first parent, empty tree for the root
 *  commit); range = from..to. Dot-files and
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
    // `diff-tree --root` (not `X^ X`): a repo-ROOT commit has no parent, so
    // `X^` fails git outright and the old catch silently returned [] — the
    // root commit's files would never be structurally enriched.
    const gitArgs =
      scope.mode === "commit"
        ? ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", safeGitRef(scope.commit, "HEAD")]
        : scope.mode === "range"
          ? ["diff", "--name-only", `${safeGitRef(scope.from, "HEAD")}...${safeGitRef(scope.to, "HEAD")}`]
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
    return toDetectionSet(root, [...tracked.split("\n"), ...untracked.split("\n")]);
  } catch {
    return [];
  }
}

/**
 * Post-process raw git name-output into the CRG detection set: trim, resolve
 * to absolute, drop dot-paths, THEN cap. The order is load-bearing
 * (review round 2026-09-01): `git ls-files` emits byte-order, and `.` sorts
 * before every letter — so a cap applied BEFORE the filter lets the
 * generated dot-tree fill the whole budget and evict every real source file
 * from detection (effective set 0 on repo-wide scopes). Exported for tests.
 */
export function toDetectionSet(root: string, rawFiles: string[]): string[] {
  return (
    [
      ...new Set(
        rawFiles
          .map((f) => f.trim())
          .filter(Boolean)
          .map((f) => (path.isAbsolute(f) ? f : path.resolve(root, f)))
          // Drop anything under a dot-directory or a dot-file itself.
          .filter((f) => {
            const rel = path.relative(root, f).split(/[\\/]/);
            return !rel.some((segment) => segment.startsWith("."));
          })
      ),
    ]
      // "all" on a huge repo could exceed downstream SQL placeholder limits —
      // cap the FILTERED, DEDUPED set (risk coverage is already top-N
      // downstream). Explicit dedupe: relative/absolute twins — or native/posix
      // spellings of one file where the platform renders them identically —
      // must not double-register nor eat cap budget.
      .slice(0, 800)
  );
}

/**
 * Parse `git diff --unified=0` output into per-file changed line intervals
 * (NEW-file side) — the line-precise detection feed (mining item ①,
 * upstream `parse_git_diff_ranges` + `_parse_unified_diff`).
 *
 * Keys are the repo-relative paths git prints (`b/…` side; `/dev/null`
 * deletions are skipped — the deleted file contributes no new lines, its
 * nodes still match by file membership fallback). Empty on unparseable
 * input — callers then fall back to file-level detection.
 */
export function parseUnifiedHunks(diffText: string): Record<string, ChangedLineRange[]> {
  const out: Record<string, ChangedLineRange[]> = {};
  if (!diffText) return out;
  let current: string | null = null;
  for (const line of diffText.split(/\r?\n/)) {
    const file = line.match(/^diff --git a\/(?:.*?) b\/(.+)$/);
    if (file) {
      const path = file[1];
      current = path === "/dev/null" ? null : path;
      continue;
    }
    const hunk = current ? line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/) : null;
    if (hunk && current) {
      const start = Number(hunk[1]);
      const count = Number(hunk[2] ?? "1");
      if (count > 0) {
        const list = out[current] ?? [];
        list.push([start, start + count - 1]);
        out[current] = list;
      }
    }
  }
  return out;
}

/**
 * Changed LINE intervals for one scope — a `--unified=0` diff against the
 * same base `getGitChangedFiles` uses. `all` has no diff (whole-repo) and
 * untracked workspace files have no diff either; both fall back to
 * file-level detection by construction. Never throws — a failed parse yields
 * {} (detection degrades to the file level, never to nothing).
 */
export function getGitChangedRanges(
  root: string,
  scope: {
    mode: "workspace" | "commit" | "range" | "all";
    commit?: string;
    from?: string;
    to?: string;
  } = { mode: "workspace" }
): Record<string, ChangedLineRange[]> {
  if (scope.mode === "all") return {};
  try {
    const gitArgs =
      scope.mode === "commit"
        ? ["diff-tree", "--no-commit-id", "-r", "--root", "-p", "--unified=0", safeGitRef(scope.commit, "HEAD"), "--"]
        : scope.mode === "range"
          ? [
              "diff",
              "--no-ext-diff",
              "--unified=0",
              `${safeGitRef(scope.from, "HEAD")}...${safeGitRef(scope.to, "HEAD")}`,
              "--",
            ]
          : ["diff", "--no-ext-diff", "--unified=0", "HEAD", "--"];
    const out = execFileSync("git", gitArgs, {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseUnifiedHunks(out);
  } catch {
    return {};
  }
}

/** Minimum commit count for a file to surface as a churn hotspot. */
export const CHURN_HOTSPOT_MIN = 3;

/** Repo-relative POSIX spelling — the shape git and the churn map use. */
export function toRepoPosix(root: string, file: string): string {
  const abs = path.isAbsolute(file) ? file : path.resolve(root, file);
  return path.relative(root, abs).split(path.sep).join("/");
}

/**
 * Churn counts (upstream `compute_file_churn`, minimal form — advisory only,
 * never scores): commits touching each file in the last 90 days, from
 * `git log --numstat`. `-z` + `\0` segments so paths containing tabs or
 * spaces survive; keys are repo-relative POSIX. Never throws: a slow or
 * history-less repo degrades to {} (the hotspot paragraph simply vanishes).
 */
export function getChurnCounts(root: string, windowDays = 90): Record<string, number> {
  try {
    const out = execFileSync(
      "git",
      ["log", `--since=${windowDays}.days.ago`, "--numstat", "--no-renames", "--format=", "-z", "--"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 8000,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    const counts: Record<string, number> = {};
    for (const seg of out.split("\0")) {
      const line = seg.trim();
      if (!line) continue;
      // numstat: <add>\t<del>\t<path> — path may itself contain tabs, so
      // split on the FIRST TWO tab stops only.
      const i1 = line.indexOf("\t");
      if (i1 < 0) continue;
      const i2 = line.indexOf("\t", i1 + 1);
      if (i2 < 0) continue;
      const adds = line.slice(0, i1);
      if (!/^\d+$/.test(adds)) continue; // binary marker "-	-	path" or rename noise
      const filePath = line.slice(i2 + 1);
      if (!filePath || filePath.startsWith(".")) continue;
      counts[filePath] = (counts[filePath] ?? 0) + 1;
    }
    return counts;
  } catch {
    return {};
  }
}

/**
 * Files in the change set whose CURRENT content hash differs from the
 * graph's build-time `file_hash` — the graph is stale for these files and
 * structural enrichment may match outdated line numbers (mining item ⑥).
 *
 * Cost-bounded: hashes the first STALE_PROBE_MAX files (content hashing is
 * cheap, but a full-repo `all` scope can be thousands) — the probe is a
 * signal, not an audit. A file with no File node at all counts as stale
 * (it was indexed or deleted since the build).
 */
export const STALE_PROBE_MAX = 40;

export function detectStaleFiles(root: string, changedFiles: string[]): string[] {
  if (changedFiles.length === 0) return [];
  const probe = changedFiles.slice(0, STALE_PROBE_MAX);
  const hashes = getCrgGraphQuery()?.getFileHashes(root, probe) ?? {};
  if (Object.keys(hashes).length === 0) {
    // No File nodes at all — either a shell graph or hashes never recorded;
    // stay silent (a false "stale" scream on every run is worse than none).
    return [];
  }
  const stale: string[] = [];
  for (const f of probe) {
    const abs = path.isAbsolute(f) ? f : path.resolve(root, f);
    const graphKey = abs.replace(/\\/g, "/");
    let current: string | null = null;
    try {
      current = createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    } catch {
      continue; // file raced away — skip it, not stale
    }
    const recorded = hashes[graphKey];
    if (recorded === undefined || recorded !== current) stale.push(f);
  }
  return stale;
}
