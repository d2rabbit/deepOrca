/**
 * ReviewController — the Seam between core's action layer and the actual code
 * review execution (desktop's OcrCliController).
 *
 * Core defines this Interface + the result types; desktop injects the concrete
 * Adapter. Since 2026-08-31 the adapter runs Open Code Review in DELEGATION
 * mode (open-codereview.ai/docs/delegate): OCR only performs the deterministic
 * engineering — `ocr delegate preview` (reviewable-file selection) and
 * `ocr delegate rule` (rules) — while the review itself is performed per file
 * by the HOST (DeepOrca's own model via the sessionless background LLM task).
 * No OCR-side LLM configuration or API key exists or is needed.
 *
 * Historical note: the first adapter generation spawned
 * `ocr review --format json --audience agent` (OCR drove its own LLM) and its
 * header tracked "5 known integration bugs" (field names, --audience agent,
 * --background, legacy IPC removal, per-run --provider/--model overrides).
 * Delegation mode retires that entire class: bugs 1-4 dissolved with the old
 * invocation, bug 5 (LLM config) became unnecessary by design.
 */

import type { ControllerProgress } from "./codegraph-controller";

// --- OCR review result types (shared by the delegate pipeline and consumers) ---

export interface ReviewComment {
  path: string;
  startLine: number;
  endLine?: number;
  content: string;
  existingCode?: string;
  suggestionCode?: string;
  thinking?: string;
}

export interface ReviewResult {
  status: "success" | "completed_with_warnings" | "completed_with_errors" | "skipped";
  llm?: { provider?: string; model: string };
  summary?: {
    filesReviewed?: number;
    comments?: number;
    /** Changes the OCR pipeline dropped by policy (generated dot-paths). */
    excludedByPolicy?: number;
    /** Changes OCR cannot review (unsupported file type, e.g. docs). */
    unsupportedFiles?: number;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    elapsed?: string;
  };
  comments: ReviewComment[];
  /** Set when the controller re-scoped a workspace run (e.g. HEAD fallback). */
  effectiveScope?: { mode: "workspace" | "commit"; commit?: string };
  warnings?: unknown[];
  sessionId?: string;
}

export interface ReviewOptions {
  background?: string;
  from?: string;
  to?: string;
  commit?: string;
  /** Whole-repository scope: every tracked file is a review target. */
  all?: boolean;
}

export interface ReviewController {
  /**
   * Run a code review via the delegation pipeline: `ocr delegate preview` +
   * `ocr delegate rule` (deterministic, OCR side), then per-file diffs and
   * host-model review (adapter side). Streams progress, returns a structured
   * result in the ReviewResult shape below.
   */
  runReview(root: string, opts: ReviewOptions, onProgress?: (p: ControllerProgress) => void): Promise<ReviewResult>;

  /** True when the OCR binary is bundled and available. */
  isAvailable(): boolean;
}

let controller: ReviewController | null = null;

/** Inject the Review controller (called once at desktop boot). */
export function configureReviewController(c: ReviewController | null): void {
  controller = c;
}

/** The configured controller, or null when the host hasn't injected one. */
export function getReviewController(): ReviewController | null {
  return controller;
}
