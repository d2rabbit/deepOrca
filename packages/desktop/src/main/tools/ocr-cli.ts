/**
 * OcrCliController — the desktop Adapter for ReviewController, DELEGATE MODE.
 *
 * Per the upstream delegation docs (open-codereview.ai/docs/delegate): OCR
 * handles the deterministic engineering — reviewable-file selection
 * (`ocr delegate preview`) and review-rule resolution (`ocr delegate rule`) —
 * while the HOST performs the actual review with its own LLM. Nothing here
 * needs an OCR-side LLM configuration or API key (the old `ocr review` mode
 * failed exactly there: "all N file review(s) failed — check your LLM
 * configuration"). The "host agent" is DeepOrca itself: the desktop boot
 * injects `runHostReview`, which drives the sessionless background LLM task
 * channel (same driver arch-scan uses) on the app's configured model. The
 * bundled @alibaba-group/open-code-review package stays the only OCR-side
 * dependency — no extra install.
 *
 * Pipeline (docs workflow, verbatim):
 *   1. `ocr delegate preview`  → mode/ref metadata + reviewable file list
 *   2. `ocr delegate rule <paths…>` → resolved rules grouped by content
 *   3. diffs via git, constructed from the preview metadata per mode:
 *        range     → git diff <merge_base>..<to> -- <path>
 *        commit    → git show <commit> -- <path>
 *        workspace → git diff HEAD -- <path> (added/untracked → file content)
 *   4. host LLM reviews each file (rules checklist + context exploration via
 *      the task's read tools + severity policy: Critical/High always, Medium
 *      with context, Low discarded)
 *   5. comments aggregate into the ReviewResult the action surface expects.
 *
 * Runs through spawnTracked (hardened: exit-authoritative settlement, hard
 * timeout, heartbeat) so a wedged delegate probe can never spin the UI.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  spawnTracked,
  type ReviewController,
  type ReviewResult,
  type ReviewOptions,
  type ControllerProgress,
} from "@deeporca/core";

/** Hard cap on ONE delegate probe (deterministic, no LLM). */
const OCR_PROBE_TIMEOUT_MS = 120_000;
/**
 * Hard cap on the whole runReview (per-file host reviews are the slow part);
 * override with DEEPORCA_OCR_TIMEOUT_MS. Enforced as an AbortSignal deadline:
 * firing it aborts the IN-FLIGHT host review (the background LLM task adopts
 * the signal), not just the between-file loop check — the old `ocr review`
 * spawn was hard-killed at this cap (commit 1910eb3's wedged-spinner
 * hardening), and a soft, between-files-only budget would reopen that class.
 */
const OCR_TOTAL_TIMEOUT_MS = Number(process.env.DEEPORCA_OCR_TIMEOUT_MS ?? "") || 15 * 60 * 1000;
/** Per-file diff cap — protects the reviewer context from generated-asset walls. */
const MAX_DIFF_CHARS = 80_000;

// --- Delegate request/response contracts (host ↔ controller) -----------------

/** One reviewable file as reported by `ocr delegate preview`. */
export interface OcrPreviewFile {
  path: string;
  status: string;
}

/** Parsed `ocr delegate preview` output (mode + refs + reviewable files). */
export interface OcrPreview {
  mode: "workspace" | "range" | "commit" | string;
  from?: string;
  to?: string;
  mergeBase?: string;
  commit?: string;
  files: OcrPreviewFile[];
}

/** A structured finding the host reviewer returns for one file. */
export interface OcrHostFileComment {
  path: string;
  start_line: number;
  end_line?: number;
  severity?: "critical" | "high" | "medium" | "low";
  content: string;
  existing_code?: string;
  suggestion_code?: string;
}

/** Request the controller hands the host reviewer for ONE file. */
export interface OcrHostReviewRequest {
  root: string;
  path: string;
  status: string;
  diff: string;
  rules: string;
  background?: string;
  /** Reader-facing language for finding text (BCP-47, host-synced locale). */
  language: string;
  /** Run-level deadline — aborting it must abort the in-flight host review. */
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

/** The host-side reviewer — DeepOrca's own LLM channel, injected at boot. */
export type OcrHostReview = (request: OcrHostReviewRequest) => Promise<OcrHostFileComment[]>;

// --- Pure helpers (exported for tests) ---------------------------------------

/**
 * Parse `ocr delegate preview` output. Real shapes (probed 2026-08-31):
 *
 *   # Files (2 reviewable / 2 total)
 *   - mode: workspace | range | commit      ← metadata block starts here
 *   - from:/to:/merge_base:/commit: …       (refs, per mode)
 *   - background: <free text>               ← multi-line bodies are echoed
 *   - total_insertions:/total_deletions:    ← metadata block ENDS here
 *     … VERBATIM until total_deletions
 *   - `path` [status] +X/-Y                 ← file bullets, two-space indent
 *
 * Parsing is LINE-STATE based, not global-regex, for a real reason (review
 * round 2026-08-31): the `- background:` echo carries arbitrary free text
 * (commit message bodies, the -b flag) at line starts, and a crafted
 * `- to:`-shaped or bullet-shaped line poisoned the old whole-stdout regexes
 * into a silently wrong-base review. Refs are only read inside the metadata
 * block and background echo lines are skipped wholesale.
 */
export function parseOcrPreviewText(text: string): OcrPreview {
  const preview: OcrPreview = { mode: "workspace", files: [] };
  // States: "header" (before - mode:) → "meta" (refs/totals) → "files".
  // Lines after `- background:` are echoed free text and ignored until
  // `- total_insertions:`/`- total_deletions:` closes the metadata block.
  let state: "header" | "meta" | "background" | "files" = "header";
  for (const line of text.split(/\r?\n/)) {
    if (state === "header") {
      const mode = line.match(/^- mode:\s*(\S+)/);
      if (mode) {
        preview.mode = mode[1];
        state = "meta";
      }
      continue;
    }
    if (state === "background") {
      if (/^- total_(insertions|deletions):/.test(line)) state = "files";
      continue; // echoed free text — never parsed
    }
    if (state === "meta") {
      const ref = line.match(/^- (from|to|merge_base|commit):\s*(.+)$/);
      if (ref) {
        const value = ref[2].trim();
        if (ref[1] === "from") preview.from = value;
        else if (ref[1] === "to") preview.to = value;
        else if (ref[1] === "merge_base") preview.mergeBase = value;
        else preview.commit = value;
        continue;
      }
      if (/^- background:/.test(line)) {
        state = "background";
        continue;
      }
      if (/^- total_deletions:/.test(line)) {
        state = "files";
        continue;
      }
      continue;
    }
    // state === "files"
    const file = line.match(/^[ \t]+-[ \t]+`([^`]+)`[ \t]+\[([^\]]+)\]/);
    if (file) preview.files.push({ path: file[1].trim(), status: file[2].trim() });
  }
  return preview;
}

/**
 * Build the host reviewer's prompt for ONE file (docs step 4): rules checklist
 * + diff + business background + the delegation severity policy + a STRICT
 * JSON response contract. Context exploration happens through the background
 * task's read tools, not this prompt.
 */
export function buildOcrDelegateReviewPrompt(request: OcrHostReviewRequest): string {
  return [
    "You are a senior code reviewer performing ONE delegated Open Code Review (OCR) file review.",
    "",
    `Repository: ${request.root}`,
    `File: ${request.path} (change type: ${request.status})`,
    "",
    "Business background (author intent):",
    request.background?.trim() || "(none provided)",
    "",
    "Review rules (resolved via `ocr delegate rule` — apply as the checklist):",
    request.rules.trim() || "(no rules resolved)",
    "",
    "Diff for this file:",
    "```diff",
    request.diff,
    "```",
    "",
    "You may use the read tools to open this file or related code for context",
    "(context exploration), but you must NOT modify anything.",
    "",
    "Severity policy (delegation contract): report Critical and High findings",
    "always; report Medium only when the surrounding context justifies it;",
    "discard Low unless it is particularly valuable.",
    "",
    `Write every finding's reader-facing "content" in ${request.language}. Keep`,
    "code identifiers, paths and commands as-is.",
    "",
    "Respond with STRICT JSON only — no prose, no markdown fences:",
    '{"comments": [{"path": "<the File above>", "start_line": <line in the NEW file>,',
    '  "end_line": <optional>, "severity": "critical|high|medium|low",',
    '  "content": "<the finding>", "existing_code": "<offending snippet>",',
    '  "suggestion_code": "<optional suggested change>"}]}',
    'Return {"comments": []} when nothing is worth reporting.',
  ].join("\n");
}

/** Extract the first BALANCED `{…}` segment (string-aware) — prose-wrapped
 *  JSON keeps trailing text after the closing brace, so slice-to-end breaks. */
function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse the host reviewer's final text into comments. Tolerant of markdown
 * fences and surrounding prose; throws with a short excerpt when nothing
 * parseable is found (the caller degrades that file to a warning).
 */
export function parseHostReviewComments(content: string, fallbackPath: string): OcrHostFileComment[] {
  const stripped = content
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const candidates: string[] = [stripped];
  const balanced = extractBalancedJsonObject(stripped);
  if (balanced) candidates.push(balanced);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { comments?: unknown };
      if (!Array.isArray(parsed.comments)) continue;
      return parsed.comments
        .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
        .map((c) => ({
          path: String(c.path ?? fallbackPath),
          start_line: Number(c.start_line ?? c.line ?? 0),
          ...(c.end_line != null ? { end_line: Number(c.end_line) } : {}),
          ...(typeof c.severity === "string" ? { severity: c.severity as OcrHostFileComment["severity"] } : {}),
          content: String(c.content ?? c.message ?? ""),
          ...(c.existing_code != null ? { existing_code: String(c.existing_code) } : {}),
          ...(c.suggestion_code != null ? { suggestion_code: String(c.suggestion_code) } : {}),
        }))
        .filter((c) => c.content.length > 0);
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`host review returned unparseable output: ${content.slice(0, 200)}`);
}

// --- Controller ----------------------------------------------------------------

export class OcrCliController implements ReviewController {
  constructor(
    private opts: {
      /** The host reviewer — DeepOrca's own LLM channel (desktop boot injects
       *  it via the sessionless background task; see main/index.ts wiring). */
      runHostReview: OcrHostReview;
      /** Reader-facing language for findings (host-synced app locale). */
      language?: () => string;
    }
  ) {}

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

  /** One deterministic delegate probe (preview / rule). JSON-free, text out. */
  private async delegate(
    resolved: { command: string; prefixArgs: string[]; env?: Record<string, string> },
    args: string[],
    root: string,
    label: string
  ): Promise<string> {
    const result = await spawnTracked({
      label,
      command: resolved.command,
      args: [...resolved.prefixArgs, ...args],
      cwd: root,
      env: resolved.env,
      timeoutMs: OCR_PROBE_TIMEOUT_MS,
      heartbeatMs: 20_000,
    });
    if (!result.forcedOk && result.code !== 0) {
      throw new Error(
        `${label} exited ${result.code}${result.signal ?? ""}${result.stderr ? `: ${result.stderr.slice(0, 300)}` : ""}`
      );
    }
    return result.stdout ?? "";
  }

  /** Docs step 3 — construct the per-file git command from the preview metadata. */
  private async diffFor(root: string, preview: OcrPreview, file: string): Promise<string> {
    const run = (args: string[]): Promise<string> =>
      new Promise((resolve, reject) => {
        execFile("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024, timeout: 60_000 }, (err, stdout) =>
          err ? reject(err) : resolve(stdout.toString())
        );
      });

    let diff = "";
    if (preview.mode === "range") {
      const range = preview.mergeBase
        ? `${preview.mergeBase}..${preview.to ?? preview.from ?? "HEAD"}`
        : `${preview.from ?? "HEAD"}..${preview.to ?? "HEAD"}`;
      diff = await run(["diff", "--no-ext-diff", range, "--", file]);
    } else if (preview.mode === "commit") {
      diff = await run(["show", "--no-ext-diff", preview.commit ?? "HEAD", "--", file]);
    } else {
      diff = await run(["diff", "--no-ext-diff", "HEAD", "--", file]);
      // Workspace-added/untracked files have no HEAD diff — the docs' fallback
      // is reading the file content directly.
      if (!diff.trim()) {
        try {
          const content = fs.readFileSync(path.join(root, file), "utf-8");
          diff = `--- new file: ${file} (untracked; full content) ---\n${content}`;
        } catch {
          return "";
        }
      }
    }
    if (diff.length > MAX_DIFF_CHARS) {
      diff =
        `${diff.slice(0, MAX_DIFF_CHARS)}\n… [diff truncated at ${MAX_DIFF_CHARS} chars — ` +
        `open the file with the read tool to inspect the rest]`;
    }
    return diff;
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

    // Step 1 — reviewable files (OCR side, deterministic).
    onProgress?.({ message: "ocr delegate preview", percent: 10 });
    const previewArgs = ["delegate", "preview"];
    if (opts.from && opts.to) previewArgs.push("--from", opts.from, "--to", opts.to);
    else if (opts.commit) previewArgs.push("--commit", opts.commit);
    if (opts.background) previewArgs.push("--background", opts.background);
    const preview = parseOcrPreviewText(await this.delegate(resolved, previewArgs, root, "ocr delegate preview"));

    if (preview.files.length === 0) {
      onProgress?.({ message: "ocr delegate: no reviewable changes", percent: 100 });
      return { status: "success", comments: [], summary: { filesReviewed: 0, comments: 0 } };
    }

    // Step 2 — resolved review rules (OCR side, deterministic). Non-fatal:
    // a rule resolution failure must not kill the review; the model still
    // reviews with its own judgment.
    onProgress?.({ message: `ocr delegate rule (${preview.files.length} files)`, percent: 20 });
    let rules = "";
    try {
      rules = await this.delegate(
        resolved,
        ["delegate", "rule", ...preview.files.map((f) => f.path)],
        root,
        "ocr delegate rule"
      );
    } catch (err) {
      onProgress?.({
        message: `ocr delegate rule failed (continuing without rules): ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }

    // Steps 3-5 — per-file diff + host LLM review, sequential to stay
    // gateway-friendly; progress streams per file. The run-level deadline is
    // an AbortSignal: firing it interrupts the IN-FLIGHT host review (the
    // background task adopts it), restoring the old single-spawn guarantee
    // that DEEPORCA_OCR_TIMEOUT_MS is a hard cap, not advisory.
    const deadline = AbortSignal.timeout(OCR_TOTAL_TIMEOUT_MS);
    const warnings: unknown[] = [];
    const comments: ReviewResult["comments"] = [];
    let failed = 0;
    let reviewed = 0;

    for (const [index, file] of preview.files.entries()) {
      if (deadline.aborted) {
        warnings.push(
          `review stopped early — total budget ${OCR_TOTAL_TIMEOUT_MS}ms reached (${index}/${preview.files.length} files attempted)`
        );
        break;
      }
      const percent = 25 + Math.round((65 * index) / preview.files.length);
      onProgress?.({ message: `[${index + 1}/${preview.files.length}] reviewing ${file.path}`, percent });

      let diff = "";
      try {
        diff = await this.diffFor(root, preview, file.path);
      } catch (err) {
        failed++;
        warnings.push(`${file.path}: diff failed — ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      try {
        const fileComments = await this.opts.runHostReview({
          root,
          path: file.path,
          status: file.status,
          diff,
          rules,
          background: opts.background,
          language: this.opts.language?.() ?? "en",
          signal: deadline,
          onProgress: (message) => onProgress?.({ message }),
        });
        reviewed++;
        for (const c of fileComments) {
          // Severity rides the content prefix — the review surface renders
          // `content` verbatim and the delegation contract makes severity
          // part of what the reader must see.
          const prefixed = c.severity ? `[${c.severity.toUpperCase()}] ${c.content}` : c.content;
          comments.push({
            path: c.path,
            startLine: c.start_line,
            ...(c.end_line != null ? { endLine: c.end_line } : {}),
            content: prefixed,
            ...(c.existing_code != null ? { existingCode: c.existing_code } : {}),
            ...(c.suggestion_code != null ? { suggestionCode: c.suggestion_code } : {}),
          });
        }
      } catch (err) {
        failed++;
        warnings.push(`${file.path}: host review failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (deadline.aborted) {
      // Budget expiry must not read as a model-configuration problem — the
      // message below is only for the every-file-failed case.
      warnings.unshift(`total budget ${OCR_TOTAL_TIMEOUT_MS}ms reached — remaining files were not reviewed`);
    } else if (failed > 0 && failed === preview.files.length) {
      throw new Error(
        `ocr delegate review failed for all ${preview.files.length} file(s) — ` +
          `check the app's model configuration (settings → model)`
      );
    }

    onProgress?.({
      message: `ocr delegate complete — ${comments.length} finding(s) across ${reviewed} file(s)`,
      percent: 100,
    });
    return {
      status: failed > 0 ? "completed_with_errors" : warnings.length > 0 ? "completed_with_warnings" : "success",
      summary: { filesReviewed: reviewed, comments: comments.length },
      comments,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}
