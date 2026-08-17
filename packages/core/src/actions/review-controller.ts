/**
 * ReviewController — the Seam between core's action layer and the actual code
 * review execution (OCR CLI or future alternatives).
 *
 * Core defines this Interface + the correct OCR JSON types; desktop injects
 * a concrete Adapter (`OcrCliController` that spawns the `ocr` binary with
 * correct flags). This fixes the 5 known integration bugs:
 *  1. JSON field names now match OCR's actual output (path/start_line/content/...)
 *  2. --audience agent is always passed (clean JSON on stdout)
 *  3. --background supported (quality lever)
 *  4. Legacy IPC removed (actions are the sole path)
 *  5. LLM config via --provider/--model per-run override
 */

import type { ControllerProgress } from "./codegraph-controller";

// --- OCR JSON output types (matching ocr review --format json --audience agent) ---

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
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    elapsed?: string;
  };
  comments: ReviewComment[];
  warnings?: unknown[];
  sessionId?: string;
}

export interface ReviewOptions {
  background?: string;
  from?: string;
  to?: string;
  commit?: string;
}

export interface ReviewController {
  /**
   * Run a code review. Spawns `ocr review --format json --audience agent`
   * with the appropriate mode flags. Streams progress, returns structured
   * result matching OCR's actual JSON schema.
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
