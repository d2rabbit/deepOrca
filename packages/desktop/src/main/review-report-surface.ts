/**
 * Review report surface (user ask 2026-08-31: 审查结果渲染到专属工作区) —
 * the ActionIpc registry wrapper so EVERY review.full completion (one-click
 * button, chat tool call) produces a self-contained HTML report under
 * <reviewed-root>/.deeporca/reviews/. Reports live in structured history
 * (review-store): <id>.html + <id>.json pairs under .deeporca/reviews/, capped
 * at REVIEW_HISTORY_KEEP. They render IN-APP (review tab iframe) — the
 * dedicated child window is gone (user ask 2026-08-31: the review surface must
 * follow the index-module pattern, never pop out).
 *
 * Extracted from main/index.ts (file-length hard limit) — the wiring needs
 * only the active root, the registered-workspace check and the app locale,
 * injected via deps.
 */

import { basename, isAbsolute } from "node:path";
import { ActionError, type ActionRegistry, type ExecuteOptions, type RunHandle } from "@deeporca/core";
import { buildReviewReportHtml } from "./tools/review-report.js";
import { resolveReportFile, saveReviewReport } from "./tools/review-store.js";

export interface ReviewReportSurfaceDeps {
  /** The ACTIVE workspace root — fallback when a run carries no input.root. */
  getActiveRoot: () => string;
  /** Registered-workspace validation for input.root (resolveRegisteredRoot in
   *  knowledge-ipc). ReviewFullInput.root's doc promises exactly this: a root
   *  outside the registered set fails the run INSTEAD of spawning CRG/OCR/git
   *  against an arbitrary renderer-supplied path. */
  isKnownRoot: (root: string) => boolean;
  /** App UI locale in BCP-47 (drives the report language). */
  getLocale: () => string;
}

let reviewReportWrapped: { source: ActionRegistry; wrapped: ActionRegistry } | null = null;

export function withReviewReportSurface(
  registry: ActionRegistry | null,
  deps: ReviewReportSurfaceDeps
): ActionRegistry | null {
  if (!registry) return null;
  if (reviewReportWrapped?.source === registry) return reviewReportWrapped.wrapped;
  const wrapper = Object.create(registry) as ActionRegistry;
  (wrapper as { execute: unknown }).execute = (
    id: string,
    input?: unknown,
    execOpts?: ExecuteOptions
  ): RunHandle<unknown> => {
    if (id !== "review.full") return registry.execute<unknown>(id, input, execOpts);
    const inputRoot = (input as { root?: unknown } | undefined)?.root;
    if (typeof inputRoot === "string" && inputRoot && !deps.isKnownRoot(inputRoot)) {
      return {
        result: Promise.reject(new ActionError("INPUT_INVALID", id, `unknown workspace: ${inputRoot}`)),
        onProgress: () => () => {},
        cancel: () => {},
      };
    }
    const handle = registry.execute<unknown>(id, input, execOpts);
    // Progress subscribers registered through this wrapper (action-ipc) also
    // receive the synthetic post-save event below, so an open review tab can
    // refresh AND select the fresh report instead of polling (cb4486e's
    // "select the newest report" intent, actually delivered this time).
    let onSaved: ((e: { message: string; percent?: number; data?: unknown }) => void) | null = null;
    return {
      result: handle.result.then(async (output) => {
        const report = writeReviewReport(output, input, deps);
        if (report) {
          Object.assign(output as object, { reportPath: report.htmlPath, reportId: report.id });
          onSaved?.({
            message: "review report saved",
            percent: 100,
            data: { done: true, reportId: report.id },
          });
        }
        return output;
      }),
      onProgress: (cb) => {
        onSaved = cb;
        return handle.onProgress(cb);
      },
      cancel: (reason) => handle.cancel(reason),
    };
  };
  reviewReportWrapped = { source: registry, wrapped: wrapper };
  return wrapper;
}

function writeReviewReport(
  output: unknown,
  input: unknown,
  deps: ReviewReportSurfaceDeps
): { root: string; htmlPath: string; id: string } | null {
  try {
    const out = output as {
      review?: {
        status?: string;
        summary?: { filesReviewed?: number; comments?: number; excludedByPolicy?: number; unsupportedFiles?: number };
        comments?: unknown[];
      };
      statusNote?: string;
    };
    if (!out?.review || !Array.isArray(out.review.comments)) return null;
    // On-demand review targets input.root (any workspace row, no switch) —
    // the report must land in THAT workspace's history, not whatever
    // workspace happens to be active when the run finishes.
    const inputRoot = (input as { root?: unknown } | undefined)?.root;
    const root = typeof inputRoot === "string" && isAbsolute(inputRoot) ? inputRoot : deps.getActiveRoot();
    if (!root) return null;
    const locale = deps.getLocale();
    const zh = locale.toLowerCase().startsWith("zh");
    const generatedAtIso = new Date().toISOString();
    const scope = (out as { scope?: { mode: string; commit?: string; from?: string; to?: string } }).scope;
    const modeLabel = zh
      ? scope?.mode === "commit"
        ? `提交 ${scope.commit ?? "HEAD"} 的变更`
        : scope?.mode === "range"
          ? `变更范围 ${scope.from}...${scope.to}`
          : scope?.mode === "all"
            ? "全仓库（全域审查）"
            : "未提交的工作区变更（vs HEAD）"
      : scope?.mode === "commit"
        ? `changes of commit ${scope.commit ?? "HEAD"}`
        : scope?.mode === "range"
          ? `changes ${scope.from}...${scope.to}`
          : scope?.mode === "all"
            ? "entire repository"
            : "uncommitted workspace changes (vs HEAD)";
    const html = buildReviewReportHtml({
      root,
      projectName: basename(root),
      status: String(out.review.status ?? "success"),
      statusNote: String(out.statusNote ?? ""),
      generatedAtIso,
      language: locale,
      modeLabel,
      summary: out.review.summary,
      comments: out.review.comments as Record<string, unknown>[],
    });
    const summary = out.review.summary ?? {};
    const id = saveReviewReport(root, html, {
      generatedAt: generatedAtIso,
      status: String(out.review.status ?? "success"),
      filesReviewed: Number(summary.filesReviewed ?? 0),
      comments: Array.isArray(out.review.comments) ? out.review.comments.length : 0,
      statusNote: String(out.statusNote ?? ""),
      scopeLabel: modeLabel,
      excludedByPolicy: Number(summary.excludedByPolicy ?? 0),
      unsupportedFiles: Number(summary.unsupportedFiles ?? 0),
      findings: out.review.comments as Array<Record<string, unknown>>,
    });
    if (!id) return null;
    const htmlPath = resolveReportFile(root, id);
    return htmlPath ? { root, htmlPath, id } : null;
  } catch (err) {
    console.warn("[review-report] generation failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
