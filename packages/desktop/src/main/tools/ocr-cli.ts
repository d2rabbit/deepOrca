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
/**
 * Hardcoded review exclusion (user rule 2026-08-31): every file/folder whose
 * name starts with a dot is out of review scope — .git, .deeporca, .codegraph,
 * .code-review-graph, .env & friends are tooling/secret territory, never
 * review targets. This matters more than it looks: EVERYTHING the toolchain
 * generates (arch maps, wiki, graph DBs, prototypes, review reports) is
 * parked under dot-directories of the target repo, so a leak here makes the
 * review "review its own output". Passed to `ocr delegate preview --exclude`
 * (gitignore-style; a bare `.*` matches at any depth) — and ENFORCED a second
 * time host-side by `filterDotPaths` below, because the OCR-side exclude
 * semantics are opaque to us (a build once listed .deeporca files — user
 * screenshot 2026-08-31). A configurable rule schema is TBD — this constant
 * is THE policy until that design lands; swap it there, single place.
 */
const OCR_DEFAULT_EXCLUDES = ".*";

/**
 * Host-side enforcement of the dot-path exclusion: drop every path with ANY
 * dot segment (dot-file or under a dot-directory). Defense in depth against
 * the OCR-side `--exclude` drifting — the review must never select generated
 * content regardless of what the preview reports. Exported for tests.
 */
export function filterDotPaths<T extends { path: string }>(files: T[]): T[] {
  return files.filter((f) => {
    const segments = f.path.split(/[\\/]/);
    return !segments.some((segment) => segment.startsWith("."));
  });
}

// --- Delegate request/response contracts (host ↔ controller) -----------------

/** The git scope a file's diff is computed against. */
export type DiffScope = {
  mode: "workspace" | "commit" | "range" | "all";
  commit?: string;
  from?: string;
  to?: string;
};

/** One reviewable file as reported by `ocr delegate preview`. */
export interface OcrPreviewFile {
  path: string;
  status: string;
  /** Set when the file's diff source differs from the preview-level scope
   *  (full-scope runs merge two probes: root..HEAD + the root commit). */
  diffScope?: DiffScope;
}

/** One change OCR itself excluded (strikethrough bullet in the output). */
export interface OcrExcludedEntry {
  path: string;
  status: string;
  reason: string;
}

/** Parsed `ocr delegate preview` output (mode + refs + reviewable files). */
export interface OcrPreview {
  mode: "workspace" | "range" | "commit" | string;
  from?: string;
  to?: string;
  mergeBase?: string;
  commit?: string;
  files: OcrPreviewFile[];
  /** Strikethrough bullets — changes OCR skipped (unsupported type, user rules). */
  excluded: OcrExcludedEntry[];
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
 * `slice(0, max)` that never cuts a UTF-16 surrogate pair in half. Every
 * user-facing truncation in this file goes through it: a lone high surrogate
 * at a cut boundary turns into U+FFFD downstream (and an invalid escape once
 * the excerpt is JSON-encoded into an error message).
 */
export function safeSlice(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  const high = text.charCodeAt(max - 1);
  const low = text.charCodeAt(max);
  return text.slice(0, high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff ? max - 1 : max);
}

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
 *
 * Format drift fails LOUDLY (leftover round 2026-08-31): if the metadata
 * block never closes (or never opens), or the `# Files (N reviewable …)`
 * header count disagrees with the parsed bullets, this throws instead of
 * returning a plausible-looking empty preview — a drifted shape returning
 * `{mode:"workspace", files:[]}` read as "no reviewable changes", a silent
 * success that reviewed nothing.
 */
export function parseOcrPreviewText(text: string): OcrPreview {
  const preview: OcrPreview = { mode: "workspace", files: [], excluded: [] };
  // States: "header" (before - mode:) → "meta" (refs/totals) → "files".
  // Lines after `- background:` are echoed free text and ignored until
  // `- total_insertions:`/`- total_deletions:` closes the metadata block.
  let state: "header" | "meta" | "background" | "files" = "header";
  let reviewableCount: number | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (state === "header") {
      const mode = line.match(/^- mode:\s*(\S+)/);
      if (mode) {
        preview.mode = mode[1];
        state = "meta";
        continue;
      }
      const header = line.match(/^#\s*Files\s*\((\d+)\s+reviewable/i);
      if (header) reviewableCount = Number(header[1]);
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
    // Strikethrough bullets (`~~- ...~~`) are changes OCR itself skipped —
    // unsupported extensions (docs) or user rules. They are surfaced, not
    // reviewed: a "0 findings" run over a diff that is ONLY generated junk
    // must be explainable to the user (why nothing was reviewed).
    const skipped = line.match(/^~{2}[ \t]*-[ \t]+`([^`]+)`[ \t]+\[([^\]]+)\]/);
    if (skipped) {
      preview.excluded.push({
        path: skipped[1].trim(),
        status: skipped[2].trim(),
        reason: line.match(/\(excluded: ([^)]+)\)/)?.[1]?.trim() ?? "",
      });
      continue;
    }
    const file = line.match(/^[ \t]+-[ \t]+`([^`]+)`[ \t]+\[([^\]]+)\]/);
    if (file) preview.files.push({ path: file[1].trim(), status: file[2].trim() });
  }
  if (state !== "files") {
    throw new Error(
      `ocr delegate preview: unrecognizable output format (no file list — output drift?): ${safeSlice(text, 200)}`
    );
  }
  if (reviewableCount !== null && reviewableCount !== preview.files.length) {
    throw new Error(
      `ocr delegate preview: file list incomplete (header says ${reviewableCount} reviewable, parsed ${preview.files.length} — output drift?): ${safeSlice(text, 200)}`
    );
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

/** Extract BALANCED `{…}` segments (string-aware), one per candidate opening
 *  brace, outermost-first. Two failure modes of the old first-`{`-only
 *  heuristic (leftover round 2026-08-31): prose-wrapped JSON keeps trailing
 *  text after the closing brace, so slice-to-end breaks — and when the prose
 *  itself contains a `{` (a code snippet, an emoji brace), the FIRST `{` is
 *  not the JSON's, the extraction misses, and the whole review degrades to
 *  "unparseable output". Every `{` is therefore tried until one parses.
 *  After a balanced segment, scanning resumes past its end (nested objects
 *  are already covered by the outer one); a hard cap bounds the degenerate
 *  `{"{"{"…` case. */
export function balancedJsonObjects(text: string): string[] {
  const out: string[] = [];
  let searchFrom = 0;
  while (out.length < 50) {
    const start = text.indexOf("{", searchFrom);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
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
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end >= 0) {
      out.push(text.slice(start, end + 1));
      searchFrom = end + 1;
    } else {
      searchFrom = start + 1;
    }
  }
  return out;
}

/**
 * Parse the host reviewer's final text into comments. Tolerant of markdown
 * fences and surrounding prose; tries the whole text first, then every
 * balanced `{…}` segment (see balancedJsonObjects); throws with a short
 * excerpt when nothing parseable is found (the caller degrades that file to
 * a warning).
 */
export function parseHostReviewComments(content: string, fallbackPath: string): OcrHostFileComment[] {
  const stripped = content
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const candidates: string[] = [stripped, ...balancedJsonObjects(stripped)];
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
  throw new Error(`host review returned unparseable output: ${safeSlice(content, 200)}`);
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
        `${label} exited ${result.code}${result.signal ?? ""}${result.stderr ? `: ${safeSlice(result.stderr, 300)}` : ""}`
      );
    }
    return result.stdout ?? "";
  }

  /** Docs step 3 — construct the per-file git command from the resolved
   *  diff scope (per-file in full-scope runs, preview-level otherwise).
   *  The file rides as a `:(literal)` pathspec: git pathspecs are globs by
   *  default, so a reviewed file like `a[1].txt` or `b?c.md` would match
   *  nothing, the diff would come back empty, and — worst case in workspace
   *  mode — the empty diff would be silently "reviewed" as a clean file
   *  (leftover round 2026-08-31). */
  private async diffFor(root: string, scope: DiffScope, file: string): Promise<string> {
    const run = (args: string[]): Promise<string> =>
      new Promise((resolve, reject) => {
        execFile(
          "git",
          args,
          { cwd: root, maxBuffer: 32 * 1024 * 1024, timeout: 60_000, windowsHide: true },
          (err, stdout) => (err ? reject(err) : resolve(stdout.toString()))
        );
      });

    let diff = "";
    if (scope.mode === "range") {
      const range = `${scope.from ?? "HEAD"}...${scope.to ?? "HEAD"}`;
      diff = await run(["diff", "--no-ext-diff", range, "--", `:(literal)${file}`]);
    } else if (scope.mode === "commit") {
      diff = await run(["show", "--no-ext-diff", scope.commit ?? "HEAD", "--", `:(literal)${file}`]);
    } else {
      diff = await run(["diff", "--no-ext-diff", "HEAD", "--", `:(literal)${file}`]);
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
        `${safeSlice(diff, MAX_DIFF_CHARS)}\n… [diff truncated at ${MAX_DIFF_CHARS} chars — ` +
        `open the file with the read tool to inspect the rest]`;
    }
    return diff;
  }

  /**
   * One deterministic preview probe + host-side enforcement + exclusion
   * accounting. `preview.files` is returned already filtered to reviewable
   * (non-dot-path) files.
   */
  private async probePreview(
    resolved: { command: string; prefixArgs: string[]; env?: Record<string, string> },
    previewArgs: string[],
    root: string,
    tag?: DiffScope
  ): Promise<{
    preview: OcrPreview;
    excludedByPolicy: number;
    unsupportedFiles: number;
  }> {
    const preview = parseOcrPreviewText(await this.delegate(resolved, previewArgs, root, "ocr delegate preview"));
    // Host-side enforcement (see filterDotPaths) — the preview's --exclude is
    // best-effort; generated content never becomes a review target even if
    // the OCR side drifts.
    const parsedAll = preview.files.length;
    preview.files = filterDotPaths(preview.files);
    if (tag) for (const f of preview.files) f.diffScope = tag;
    const excludedByPolicy = parsedAll - preview.files.length + preview.excluded.length;
    const unsupportedFiles = preview.excluded.filter((e) => e.reason.includes("unsupported")).length;
    return { preview, excludedByPolicy, unsupportedFiles };
  }

  /** First commit of the default branch (the initial import) — the base for
   *  the full-scope union. null when the repo has no commits. */
  private firstRootCommit(root: string): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(
        "git",
        ["rev-list", "--max-parents=0", "--first-parent", "HEAD"],
        { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          if (err) return resolve(null);
          const first = stdout.toString().trim().split("\n")[0] ?? "";
          resolve(first || null);
        }
      );
    });
  }

  /** True when the repo has at least one commit (prerequisite for the HEAD
   *  fallback — a fresh init has nothing to fall back to). */
  private hasHeadCommit(root: string): Promise<boolean> {
    return new Promise((resolve) => {
      execFile("git", ["rev-parse", "--verify", "--quiet", "HEAD"], { cwd: root, windowsHide: true }, (err) =>
        resolve(!err)
      );
    });
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

    // Whole-repository scope ("全域审查"): OCR ranges require a merge-base,
    // and an empty-tree/orphan base has none with HEAD — so the full scope is
    // the UNION of two probes that both validate:
    //   pass A  root..HEAD      → every change after the initial import
    //   pass B  --commit root   → the initial import itself
    // A file present in both keeps the pass-A (newer) version. diffScope is
    // stamped per file so diffFor diffs it against the right base.
    let probe: { preview: OcrPreview; excludedByPolicy: number; unsupportedFiles: number } | null = null;
    let effectiveScope: { mode: "workspace" | "commit"; commit?: string } = { mode: "workspace" };
    const FALLBACK_NOTE = "工作区无可审查代码变更 — 已自动改为审查最新提交（HEAD）";
    let fellBack = false;

    if (opts.all) {
      const rootCommit = await this.firstRootCommit(root);
      if (!rootCommit) {
        throw new Error("ocr delegate: 全域审查需要至少一个提交（当前仓库为空）");
      }
      const headArgs = ["delegate", "preview", "--from", rootCommit, "--to", "HEAD"];
      const rootArgs = ["delegate", "preview", "--commit", rootCommit];
      if (opts.background) {
        headArgs.push("--background", opts.background);
        rootArgs.push("--background", opts.background);
      }
      headArgs.push("--exclude", OCR_DEFAULT_EXCLUDES);
      rootArgs.push("--exclude", OCR_DEFAULT_EXCLUDES);
      onProgress?.({ message: "ocr delegate preview (root..HEAD)", percent: 8 });
      const passA = await this.probePreview(resolved, headArgs, root, { mode: "range", from: rootCommit, to: "HEAD" });
      onProgress?.({ message: "ocr delegate preview (root commit)", percent: 10 });
      const passB = await this.probePreview(resolved, rootArgs, root, { mode: "commit", commit: rootCommit });
      const seen = new Set(passA.preview.files.map((f) => f.path));
      const merged = [...passA.preview.files, ...passB.preview.files.filter((f) => !seen.has(f.path))];
      const mergedPreview: OcrPreview = {
        mode: "range",
        from: rootCommit,
        to: "HEAD",
        files: merged,
        excluded: [...passA.preview.excluded, ...passB.preview.excluded],
      };
      probe = {
        preview: mergedPreview,
        excludedByPolicy: passA.excludedByPolicy + passB.excludedByPolicy,
        unsupportedFiles: passA.unsupportedFiles + passB.unsupportedFiles,
      };
      effectiveScope = { mode: "workspace" }; // all-scope runs never HEAD-fallback
    } else {
      const previewArgs = ["delegate", "preview"];
      if (opts.from && opts.to) previewArgs.push("--from", opts.from, "--to", opts.to);
      else if (opts.commit) previewArgs.push("--commit", opts.commit);
      if (opts.background) previewArgs.push("--background", opts.background);
      previewArgs.push("--exclude", OCR_DEFAULT_EXCLUDES);

      probe = await this.probePreview(resolved, previewArgs, root);

      // HEAD fallback (user ask 2026-08-31): a clean workspace — or one whose
      // only changes are generated junk — must not dead-end the review. When
      // the WORKSPACE scope has nothing reviewable and the repo has commits,
      // automatically re-scope to the latest commit instead.
      if (
        probe.preview.files.length === 0 &&
        !opts.commit &&
        !opts.from &&
        !opts.to &&
        (await this.hasHeadCommit(root))
      ) {
        onProgress?.({
          message: "工作区无可审查代码变更 — 自动改为审查最新提交（HEAD）",
          percent: 12,
        });
        const headArgs = ["delegate", "preview", "--commit", "HEAD"];
        if (opts.background) headArgs.push("--background", opts.background);
        headArgs.push("--exclude", OCR_DEFAULT_EXCLUDES);
        probe = await this.probePreview(resolved, headArgs, root);
        effectiveScope = { mode: "commit", commit: "HEAD" };
        fellBack = true;
      }
    }

    const preview = probe.preview;
    const excludedByPolicy = probe.excludedByPolicy;
    const unsupportedFiles = probe.unsupportedFiles;

    if (preview.files.length === 0) {
      const note =
        excludedByPolicy > 0 || unsupportedFiles > 0
          ? `all ${excludedByPolicy + unsupportedFiles} change(s) excluded by policy ` +
            `(${excludedByPolicy} generated/dot-path, ${unsupportedFiles} unsupported type) — nothing reviewable`
          : "ocr delegate: no reviewable changes";
      onProgress?.({ message: `ocr delegate: ${note}`, percent: 100 });
      return {
        status: "success",
        comments: [],
        summary: { filesReviewed: 0, comments: 0, excludedByPolicy, unsupportedFiles },
        effectiveScope,
        warnings: [FALLBACK_NOTE, ...(excludedByPolicy > 0 || unsupportedFiles > 0 ? [note] : [])],
      };
    }

    if (opts.all && preview.files.length > 20) {
      onProgress?.({
        message: `全域审查 ${preview.files.length} 个文件 — 依次审查，总预算 ${OCR_TOTAL_TIMEOUT_MS / 60000} 分钟（可用 DEEPORCA_OCR_TIMEOUT_MS 调整）`,
      });
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
        diff = await this.diffFor(root, file.diffScope ?? { mode: "workspace" }, file.path);
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
      summary: {
        filesReviewed: reviewed,
        comments: comments.length,
        excludedByPolicy,
        unsupportedFiles,
      },
      comments,
      effectiveScope,
      warnings: fellBack || warnings.length > 0 ? [...(fellBack ? [FALLBACK_NOTE] : []), ...warnings] : undefined,
    };
  }
}
