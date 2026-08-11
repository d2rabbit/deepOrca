/**
 * `review.run` — the first Phase-1 action (spec §三). Sinks the ocr (Open Code
 * Review) spawn logic out of desktop main into core, so ocr gains an MCP/LLM
 * surface for the first time: registering it makes `review_run` an agent tool
 * (toToolDefinitions) and dispatchable via ToolExecutor, in addition to the
 * existing IPC `review:run` path.
 *
 * Layering: core owns the action + the resolver seam; desktop injects the real
 * resolver at boot (it owns the `@alibaba-group/open-code-review` npm dep and
 * the Electron-bundled-Node resolution). Tests inject a mock. This mirrors the
 * Spawner host-injection pattern — core stays electron- and npm-dep-free.
 */

import type { ActionDefinition, ActionRun } from "./types";

/** Resolved ocr launch spec — the host (desktop) provides this. */
export interface OcrCommand {
  readonly command: string;
  readonly prefixArgs: readonly string[];
  readonly env?: Record<string, string>;
}

/** Resolver the desktop host injects (returns null when ocr isn't bundled). */
export type OcrResolver = () => OcrCommand | null;

let ocrResolver: OcrResolver | null = null;

/**
 * Inject the ocr command resolver. Called once at desktop boot. The resolver
 * resolves `@alibaba-group/open-code-review/bin/ocr.js` and returns the Node
 * runner + ELECTRON_RUN_AS_NODE/OCR_NO_UPDATE env. Pass null to clear.
 */
export function configureOcrResolver(resolver: OcrResolver | null): void {
  ocrResolver = resolver;
}

/** The configured resolver, or null if the host hasn't injected one. */
export function getOcrResolver(): OcrResolver | null {
  return ocrResolver;
}

export interface ReviewInput {
  /** Reserved for future scope selection (from/to/commit). Phase 1 is fixed:
   * uncommitted workspace changes vs HEAD, matching the legacy ReviewRun path. */
  readonly scope?: string;
}

export interface ReviewComment {
  readonly file: string;
  readonly line: number;
  readonly severity: "critical" | "warning" | "info" | string;
  readonly message: string;
  readonly suggestion?: string;
}

export interface ReviewOutput {
  readonly comments: ReviewComment[];
  readonly summary?: unknown;
  /** Captured stderr (empty on a clean run) — aids debugging from the LLM/UI. */
  readonly stderr?: string;
}

export const reviewRunDefinition: ActionDefinition<ReviewInput> = {
  id: "review.run",
  description:
    "Run AI code review (Open Code Review / ocr) on uncommitted workspace changes vs HEAD. Returns structured {comments, summary} with file/line/severity/message/suggestion per finding. Use when the user asks to review code, audit changes, or check quality before commit/PR.",
  category: "review",
  parameters: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        description: "Reserved — Phase 1 always reviews uncommitted workspace changes vs HEAD.",
      },
    },
    additionalProperties: false,
  },
  sideEffects: ["spawn-subprocess", "read-in-cwd"],
};

/**
 * Spawn ocr, stream stdout as progress, parse the JSON result. Throws on a
 * missing resolver (ACTION_FAILED via the registry), non-zero exit, or bad JSON
 * — the registry wraps these into ActionError so callers get structured codes.
 */
export const reviewCheckAvailableDefinition: ActionDefinition = {
  id: "review.check-available",
  description:
    "Check whether AI code review (Open Code Review / ocr) is bundled and available. Returns {available}. Use before review.run to confirm the tool is present.",
  category: "review",
  parameters: { type: "object", properties: {}, additionalProperties: false },
};

export interface ReviewAvailability {
  readonly available: boolean;
}

/** Probes the injected ocr resolver — no subprocess spawn (the bundled package
 * counts as available even if a --version probe would fail, matching legacy). */
export const reviewCheckAvailableRun: ActionRun<unknown, ReviewAvailability> = async () => {
  const resolver = getOcrResolver();
  if (!resolver) return { available: false };
  return { available: resolver() !== null };
};

export const reviewRun: ActionRun<ReviewInput, ReviewOutput> = async (_input, ctx) => collectOcrReview(ctx);

/**
 * Shared ocr-review collector — factored so both {@link reviewRun} and the
 * {@link reviewFullRun} composite reuse one spawn path. Spawns ocr, streams
 * stdout, parses the JSON {comments, summary}. Throws ACTION_FAILED (via the
 * registry) on resolver missing / non-zero exit / bad JSON.
 */
async function collectOcrReview(ctx: import("./types").ActionContext): Promise<ReviewOutput> {
  const resolver = getOcrResolver();
  if (!resolver) {
    throw new Error("review: no ocr resolver configured (host must call configureOcrResolver at boot)");
  }
  const resolved = resolver();
  if (!resolved) {
    throw new Error("review: Open Code Review is not bundled with this build");
  }
  ctx.emit({ message: "starting ocr review", percent: 10 });
  const proc = ctx.spawner.spawn(resolved.command, [...resolved.prefixArgs, "review", "--format", "json"], {
    cwd: ctx.projectRoot,
    env: resolved.env,
  });

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  // Drain both streams concurrently so the process isn't blocked on a full pipe.
  const drainStdout = (async () => {
    for await (const line of proc.stdout) {
      stdoutLines.push(line);
      ctx.emit({ message: `ocr: ${line.slice(0, 120)}`, percent: undefined });
    }
  })();
  const drainStderr = (async () => {
    for await (const line of proc.stderr) stderrLines.push(line);
  })();
  const { code } = await proc.exited;
  await Promise.all([drainStdout, drainStderr]);

  const stderr = stderrLines.join("");
  if (code !== 0) {
    throw new Error(`ocr exited ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`);
  }
  ctx.emit({ message: "ocr complete, parsing result", percent: 90 });

  const stdout = stdoutLines.join("");
  let parsed: { comments?: ReviewComment[]; summary?: unknown };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`ocr returned non-JSON output (${stdout.length} chars): ${stdout.slice(0, 200)}`);
  }
  return {
    comments: Array.isArray(parsed.comments) ? parsed.comments : [],
    summary: parsed.summary,
    stderr: stderr || undefined,
  };
}

// --- review.full: module-level composite (Phase 4 — panel one-click) ---------
//
// The Code Review module's single composite action. Runs ocr (semantic review)
// AND, when the CRG risk graph is built, enriches with structural risk (changed
// nodes + impact radius) via the CRG MCP server. Returns a unified report the
// CodeReviewPanel renders as one result. This is the panel's "一键代码审查"
// button — the granular review.run / crg.analyze remain as agent tools.

export interface ReviewFullOutput {
  readonly review: ReviewOutput;
  /** Structural risk from CRG (absent when no graph or MCP unavailable). */
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
    "Full code review of uncommitted changes — the Code Review module's one-click composite. Runs ocr AI semantic review AND, when the CRG risk graph is built, enriches each finding with structural impact (changed nodes + blast radius). Returns a unified {review, risk} report. Use for the panel's 一键代码审查 button; agents may prefer the granular review.run / crg.analyze tools.",
  category: "review",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  sideEffects: ["spawn-subprocess", "read-in-cwd"],
};

export const reviewFullRun: ActionRun<unknown, ReviewFullOutput> = async (_input, ctx) => {
  // 1. ocr semantic review (reuses the review.run spawn path).
  const review = await collectOcrReview(ctx);

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
    // CRG enrich failure is non-fatal — the ocr review still stands.
    return {
      review,
      risk: { graphBuilt: false, reason: err instanceof Error ? err.message : String(err) },
    };
  }
};
