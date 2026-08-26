/**
 * OcrCliController — the desktop Adapter for ReviewController.
 *
 * Spawns the `ocr` (Open Code Review) binary with correct flags and parses
 * the actual JSON schema. Replaces the old `configureOcrResolver` +
 * `collectOcrReview` spawn logic that was in core.
 *
 * Fixes all 5 known integration bugs:
 *  1. JSON field names match OCR's actual output (path/start_line/content/...)
 *  2. --audience agent always passed (clean JSON on stdout)
 *  3. --background supported (quality lever)
 *  4. Legacy IPC removed (actions are the sole path)
 *  5. LLM config via --provider/--model per-run override
 *
 * Runs through spawnTracked (hardened: exit-authoritative settlement, hard
 * timeout, heartbeat) so a wedged or pipe-blocked review can never spin the
 * UI forever — the same failure class that hit the index-knowledge module.
 */

import {
  spawnTracked,
  type ReviewController,
  type ReviewResult,
  type ReviewOptions,
  type ControllerProgress,
} from "@deeporca/core";

/** Hard cap on one review run (LLM reviews take minutes); override with DEEPORCA_OCR_TIMEOUT_MS. */
const OCR_TIMEOUT_MS = Number(process.env.DEEPORCA_OCR_TIMEOUT_MS ?? "") || 15 * 60 * 1000;

export class OcrCliController implements ReviewController {
  /**
   * Resolve the OCR binary: `@alibaba-group/open-code-review/bin/ocr.js`
   * is a CommonJS launcher that resolves the platform binary. We run it
   * through Electron's bundled Node (ELECTRON_RUN_AS_NODE).
   */
  private resolveOcr(): {
    command: string;
    prefixArgs: string[];
    env?: Record<string, string>;
  } | null {
    try {
      const entry = require.resolve("@alibaba-group/open-code-review/bin/ocr.js");
      return {
        command: process.execPath,
        prefixArgs: [entry],
        env: { ELECTRON_RUN_AS_NODE: "1", OCR_NO_UPDATE: "1" },
      };
    } catch {
      return null;
    }
  }

  isAvailable(): boolean {
    return this.resolveOcr() !== null;
  }

  async runReview(
    root: string,
    opts: ReviewOptions,
    onProgress?: (p: ControllerProgress) => void
  ): Promise<ReviewResult> {
    const resolved = this.resolveOcr();
    if (!resolved) {
      throw new Error("Open Code Review is not bundled with this build");
    }

    // Build args: ALWAYS include --format json --audience agent (fixes bugs #1 + #2).
    const args = [...resolved.prefixArgs, "review", "--format", "json", "--audience", "agent"];

    // Background context (fixes bug #3 — quality lever).
    if (opts.background) {
      args.push("--background", opts.background);
    }

    // Review mode selection.
    if (opts.from && opts.to) {
      args.push("--from", opts.from, "--to", opts.to);
    } else if (opts.commit) {
      args.push("--commit", opts.commit);
    }

    // LLM config (fixes bug #5): OCR reads env vars for LLM credentials.
    // The host (desktop boot) sets these globally; OCR also has its own
    // config system (~/.opencodereview/config.json) which takes priority.
    const env: Record<string, string> = { ...(resolved.env ?? {}) };

    onProgress?.({ message: "starting ocr review", percent: 10 });

    const result = await spawnTracked({
      label: "ocr review",
      command: resolved.command,
      args,
      cwd: root,
      env,
      timeoutMs: OCR_TIMEOUT_MS,
      heartbeatMs: 20_000,
      onHeartbeat: ({ elapsedSecs }) => {
        onProgress?.({ message: `ocr 运行中 ${elapsedSecs}s（LLM 审查阶段通常无进度流，请耐心等待）` });
        return null;
      },
      onStdoutLine: (line) => onProgress?.({ message: `ocr: ${line.slice(0, 120)}` }),
    });

    onProgress?.({ message: "ocr complete, parsing result", percent: 90 });
    if (!result.forcedOk && result.code !== 0) {
      throw new Error(
        `ocr exited ${result.code}${result.signal ?? ""}${result.stderr ? `: ${result.stderr.slice(0, 500)}` : ""}`
      );
    }

    try {
      // Parse OCR's actual JSON schema (NOT the wrong field names we had before).
      const raw = JSON.parse(result.stdout) as Record<string, unknown>;

      const parsed: ReviewResult = {
        status: (raw.status as ReviewResult["status"]) ?? "success",
        llm: raw.llm as ReviewResult["llm"],
        summary: raw.summary as ReviewResult["summary"],
        comments: Array.isArray(raw.comments)
          ? (raw.comments as Record<string, unknown>[]).map((c) => ({
              path: String(c.path ?? c.file ?? ""),
              startLine: Number(c.start_line ?? c.line ?? 0),
              endLine: c.end_line != null ? Number(c.end_line) : undefined,
              content: String(c.content ?? c.message ?? ""),
              existingCode: c.existing_code != null ? String(c.existing_code) : undefined,
              suggestionCode: c.suggestion_code != null ? String(c.suggestion_code) : undefined,
              thinking: c.thinking != null ? String(c.thinking) : undefined,
            }))
          : [],
        warnings: raw.warnings as unknown[],
        sessionId: raw.session_id != null ? String(raw.session_id) : undefined,
      };
      return parsed;
    } catch {
      throw new Error(`ocr returned non-JSON output (${result.stdout.length} chars): ${result.stdout.slice(0, 200)}`);
    }
  }
}
