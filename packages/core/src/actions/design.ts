/**
 * design.materialize — one-click requirement materialization for Designer.
 *
 * Takes a natural-language requirement, routes it to the best sub-domain
 * (PM-Design OpenUI prototype vs UI-Design .dd document), generates the
 * artifact via the existing MCP tools, and persists it to designs/.
 *
 * Pipeline routing (Batch 9): ctx.judgeViaLlm (flash LLM, injected by
 * SessionManager) decides PM-Design vs UI-Design; the keyword heuristic below
 * remains the fail-open fallback when the LLM is unavailable or returns
 * nothing recognizable. A user-specified pipeline always wins.
 *
 * This is a pure orchestration layer — it calls existing tools, implements
 * no rendering itself.
 *
 * design.extract / design.drift (E1b/E1c) — dembrandt brand ingestion: the
 * CLI extracts a website's design system into tokens, and the drift gate
 * scores a live extraction against a committed baseline. Deterministic, no
 * LLM. See docs/research/2026-08-17-external-repos-prestudy.md §1 and
 * common/dembrandt.ts for the offline-first vendored install + browser
 * provisioning rationale.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ActionContext, ActionDefinition, ActionRun } from "./types";
import { validateDembrandtTargetUrl } from "../common/dembrandt";
import { runDembrandtProcess } from "../common/dembrandt-runner";

export interface DesignMaterializeInput {
  requirement: string;
  /** Optional pipeline override. "auto" lets the action decide. */
  pipeline?: "auto" | "openui" | "design";
}

export interface DesignMaterializeOutput {
  ok: boolean;
  pipeline?: string;
  reasoning?: string;
  /** null when the artifact reference can't be resolved — the DesignPanel
   *  lists designs/ as the source of truth. */
  artifactId?: string | null;
  error?: string;
}

export const designMaterializeDefinition: ActionDefinition<DesignMaterializeInput> = {
  id: "design.materialize",
  description:
    "Materialize a requirement into a design artifact (prototype or design document). " +
    "Routes to PM-Design (OpenUI prototype) for interactive UI, or UI-Design (.dd) for presentation pages. " +
    "One-click entry: requirement → generate → preview → persisted.",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      requirement: {
        type: "string",
        description: "Natural language requirement description (what to build)",
      },
      pipeline: {
        type: "string",
        enum: ["auto", "openui", "design"],
        description: "Pipeline: auto (let AI decide), openui (PM-Design prototype), design (UI-Design .dd)",
      },
    },
    required: ["requirement"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

/** Simple keyword-based routing heuristic (no LLM needed for the common case). */
function routePipeline(requirement: string): { pipeline: "openui" | "design"; reasoning: string } {
  const text = requirement.toLowerCase();

  const interactive = [
    "form",
    "login",
    "signup",
    "register",
    "kanban",
    "board",
    "dashboard",
    "wizard",
    "step",
    "navigation",
    "filter",
    "search",
    "input",
    "toggle",
    "table",
    "crud",
    "表单",
    "登录",
    "注册",
    "看板",
    "仪表盘",
    "向导",
    "导航",
    "筛选",
    "搜索",
  ];
  const presentational = [
    "landing",
    "page",
    "poster",
    "brand",
    "hero",
    "marketing",
    "portfolio",
    "落地页",
    "海报",
    "品牌",
    "营销",
    "展示",
  ];

  const iScore = interactive.filter((k) => text.includes(k)).length;
  const pScore = presentational.filter((k) => text.includes(k)).length;

  if (iScore > pScore) {
    return {
      pipeline: "openui",
      reasoning: `Interactive signals (${iScore}): forms/navigation/dashboard detected → PM-Design prototype`,
    };
  }
  if (pScore > iScore) {
    return {
      pipeline: "design",
      reasoning: `Presentation signals (${pScore}): landing/brand/hero detected → UI-Design document`,
    };
  }
  // Default: interactive prototype (safer — can show more).
  return { pipeline: "openui", reasoning: "No strong signals — defaulting to PM-Design prototype" };
}

export const designMaterializeRun: ActionRun<DesignMaterializeInput, DesignMaterializeOutput> = async (input, ctx) => {
  const requirement = input?.requirement?.trim();
  if (!requirement) {
    return { ok: false, error: "requirement is required" };
  }

  ctx.emit({ message: "🎯 分析需求…", percent: 10 });

  // Route pipeline: user override > flash LLM judgment > keyword heuristic.
  let route: { pipeline: "openui" | "design"; reasoning: string };
  if (input.pipeline && input.pipeline !== "auto") {
    route = {
      pipeline: input.pipeline as "openui" | "design",
      reasoning: `User-specified pipeline: ${input.pipeline}`,
    };
  } else {
    route = routePipeline(requirement);
    if (ctx.judgeViaLlm) {
      const choice = await ctx.judgeViaLlm(
        "Decide which design sub-domain fits this requirement:\n" +
          `- "openui" (PM-Design): interactive prototypes — forms, kanban, dashboards, wizards, multi-page navigation, anything the user clicks/types into.\n` +
          `- "design" (UI-Design): self-contained presentational documents — landing pages, posters, brand/hero/marketing pages, portfolio pieces.\n` +
          `Mixed requirements: pick by the dominant deliverable.\n\nRequirement: ${requirement}`,
        ["openui", "design"]
      );
      if (choice === "openui" || choice === "design") {
        route = { pipeline: choice, reasoning: `LLM judgment: ${choice} (heuristic said ${route.pipeline})` };
      }
    }
  }

  ctx.emit({ message: `📊 管线路由: ${route.pipeline} — ${route.reasoning}`, percent: 25 });

  // Generate via MCP tools (delegate to the a2ui server's tools).
  const promptForTool =
    route.pipeline === "openui"
      ? `Create an OpenUI Lang prototype for: ${requirement}. Use the design discipline from the taste skill. Call the render_openui tool.`
      : `Create a .dd design document for: ${requirement}. Pick the best design system. Call the render_design tool.`;

  if (!ctx.executeMcpTool) {
    return {
      ok: false,
      error: "executeMcpTool not available — the design MCP server must be connected",
    };
  }

  ctx.emit({ message: `🎨 生成 ${route.pipeline} 产物…`, percent: 50 });

  // Route through the LLM by using runSubagent if available (the agent will
  // call the tool), or return a structured "pending" for the UI to prompt.
  if (ctx.runSubagent) {
    try {
      await ctx.runSubagent({
        skill: route.pipeline === "openui" ? "pm-designer-openui" : "deep-design",
        prompt: promptForTool,
      });
      ctx.emit({ message: "✅ 完成", percent: 100 });
      // Task-tree integration (spec §八 PM-Design = first consumer): when the
      // session is bound to a task branch, the materialized design becomes a
      // step on that branch — requirement changes then read as forks, not reruns.
      try {
        const sessionId = ctx.activeSessionId?.();
        const ref = sessionId ? ctx.getSessionTaskRef?.(sessionId) : undefined;
        if (ref) {
          const svc = ctx.taskTrees?.();
          // Land on the session's BOUND branch — the tree's global active
          // branch may have been moved by another session or a manual switch.
          svc?.switchBranch(ref.treeId, ref.branch);
          svc?.appendStep(ref.treeId, {
            title: `Design materialized: ${requirement.slice(0, 80)}`,
            why: `design.materialize produced a ${route.pipeline} artifact for this branch.`,
          });
        }
      } catch {
        // Best-effort — the materialize result stands without the tree step.
      }
      return {
        ok: true,
        pipeline: route.pipeline,
        reasoning: route.reasoning,
        // runSubagent returns only the last text message — not a stable
        // artifact reference. The DesignPanel lists designs/ as the source
        // of truth instead of guessing an id here.
        artifactId: null,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // No subagent — return guidance for the caller.
  ctx.emit({ message: "⏳ 等待 Agent 执行…", percent: 80 });
  return {
    ok: true,
    pipeline: route.pipeline,
    reasoning: route.reasoning,
    artifactId: undefined,
  };
};

// ── design.extract / design.drift — dembrandt brand ingestion (E1b/E1c) ──────

/**
 * Run the dembrandt CLI (vendored install only — offline; there is no runtime
 * npx fallback) via the host-injected Spawner. The spawn itself lives in
 * common/dembrandt.ts (runDembrandtProcess); this wrapper only adapts the
 * action's URL inputs: every URL reaching the CLI is pre-validated here
 * (http/https, public host — SSRF guard) before it is allowed into argv.
 *
 * With no spawner configured (NULL_SPAWNER) the stdout iteration rejects and
 * the registry surfaces it as a structured ACTION_FAILED ("NULL_SPAWNER: …")
 * instead of a silent no-op.
 */
async function runDembrandtCli(
  ctx: ActionContext,
  cliArgs: readonly string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string; spawnError?: string }> {
  return runDembrandtProcess(ctx, cliArgs, cwd);
}

/** Best-effort minimal JSON parse — the action never depends on the payload shape. */
function tryParseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Keep only the tail of a stderr blob for error messages (it carries the actual cause). */
function stderrTail(stderr: string, max = 800): string {
  const trimmed = stderr.trim();
  return trimmed.length > max ? `…${trimmed.slice(-max)}` : trimmed;
}

const DEMBRANDT_TOKENS_CHAR_CAP = 24_000;

export interface DesignExtractInput {
  /** Website to extract the brand/design system from (http/https URL — the CLI renders it). */
  url: string;
  /** Optional workspace root for the temp output dir (defaults to ctx.projectRoot). */
  projectRoot?: string;
}

export interface DesignExtractOutput {
  ok: boolean;
  url?: string;
  /** Temp dir the CLI's artifacts landed in (spawner cwd — kept for the agent to read via the gated read tool). */
  outputDir?: string;
  /** The CLI's `--json-only` payload — the design tokens (DTCG-shaped, schema-versioned upstream). */
  tokensJson?: string;
  /** Deterministic next-step instruction for the agent (see the comment in designExtractRun). */
  instruction?: string;
  error?: string;
}

export const designExtractDefinition: ActionDefinition<DesignExtractInput> = {
  id: "design.extract",
  description:
    "Extract a website's brand/design system into structured design tokens (colors with semantic roles, " +
    "typography scale, spacing, radius, shadows, motion, logo, contrast audit) via the pinned dembrandt CLI. " +
    "Returns the token JSON plus an instruction to persist the brand contract to .deeporca/DESIGN.md — " +
    "the input side of the design pipeline (deep-design Step 0 / bento / OpenUI generation constraints).",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Website URL to extract the design system from (e.g. 'https://example.com')",
      },
      projectRoot: {
        type: "string",
        description: "Optional workspace root for the temp output dir (defaults to the current project)",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  // Honest declaration: the CLI fetches the URL over the network (and renders
  // it with a Playwright-driven browser, provisioned offline — see
  // common/dembrandt.ts). The CLI's own file writes
  // (extraction artifacts) go through the spawner cwd — a temp dir under
  // .deeporca/ in the session workspace, host-gated at the spawner layer —
  // and the durable .deeporca/DESIGN.md write is deliberately NOT done here
  // (see designExtractRun).
  sideEffects: ["network"],
};

export const designExtractRun: ActionRun<DesignExtractInput, DesignExtractOutput> = async (input, ctx) => {
  const url = input?.url?.trim();
  if (!url) {
    return { ok: false, error: "url is required" };
  }
  // SSRF guard: the CLI fetches and renders this URL — only public http/https
  // targets are allowed to reach argv (validate before anything is spawned).
  const target = validateDembrandtTargetUrl(url);
  if (!target.ok) {
    return { ok: false, error: target.error };
  }

  ctx.emit({ message: `🎨 Extracting brand tokens from ${target.url}…`, percent: 20 });

  // Temp workspace for the CLI's artifacts. Upstream has no `--output <dir>`
  // flag — `--save-output` writes `output/<domain>/` relative to the process
  // cwd — so the temp dir is passed as the SPAWN CWD instead (same effect,
  // only documented flags used). Created under .deeporca/ (the product's own
  // config dir) so nothing is scattered in the user's project root.
  const root = input?.projectRoot?.trim() || ctx.projectRoot;
  const outputDir = path.join(root, ".deeporca", "tmp", "dembrandt", `${Date.now()}-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(outputDir, { recursive: true });

  ctx.emit({ message: "🌐 Rendering page and extracting tokens…", percent: 50 });

  const { code, stdout, stderr, spawnError } = await runDembrandtCli(ctx, [target.url, "--json-only", "--save-output"], outputDir);

  if (spawnError) {
    return { ok: false, url: target.url, error: spawnError };
  }

  if (code !== 0) {
    // Exit 1 here is a hard failure (drift's "exit 1 on drift" semantics only
    // apply to --compare). Surface the stderr tail; the common first-run cause
    // is a missing browser engine. DeepOrca uses the Electron built-in Chromium
    // via CDP (no download ever); a browser error here means the provider
    // window failed to start, which surfaces in the stderr tail.
    return {
      ok: false,
      url: target.url,
      error: `dembrandt exited with code ${code}: ${stderrTail(stderr) || "no stderr output"}.`,
    };
  }

  // Minimal parse — never over-parse the schema-versioned payload: the tool
  // result text carries the tokens; `domain` is the only field used here.
  const payload = tryParseJson(stdout);
  const meta = payload?.meta as Record<string, unknown> | undefined;
  let domain: string | undefined;
  if (typeof payload?.domain === "string") {
    domain = payload.domain;
  } else if (meta && typeof meta.domain === "string") {
    domain = meta.domain;
  }

  const truncated = stdout.length > DEMBRANDT_TOKENS_CHAR_CAP;
  const tokensJson = truncated ? `${stdout.slice(0, DEMBRANDT_TOKENS_CHAR_CAP)}\n…[truncated]` : stdout;

  ctx.emit({ message: "✅ Tokens extracted", percent: 90 });

  // PERSISTENCE CONTRACT (deliberate, sandbox-correct): this action does NOT
  // write .deeporca/DESIGN.md itself. The write is agent-mediated — the
  // instruction below tells the agent to use the built-in `write` tool, which
  // goes through the write tool's own PathGate/permission gating (and
  // file-history tracking). A direct fs write here would bypass that gate;
  // routing through the agent keeps one privileged writer for project files.
  const instruction = [
    "Persist this brand contract:",
    "1. Distill tokensJson into a brand section (colors with semantic roles, typography scale, spacing/radius/shadows, motion).",
    "2. Use the built-in `write` tool to create or update `.deeporca/DESIGN.md` at the project root with that section",
    "   (the write is permission-gated — that is intentional; this action never writes project files itself).",
    "3. The deep-design skill's Step 0 reads `.deeporca/DESIGN.md` as the token source for subsequent generation.",
    truncated
      ? `4. tokensJson was truncated — read the full extraction from the files under ${outputDir}.`
      : `4. Full CLI artifacts were also saved under ${outputDir}.`,
  ].join("\n");

  return { ok: true, url: target.url, domain, outputDir, tokensJson, instruction };
};

export interface DesignDriftInput {
  /** Baseline extraction JSON — a file path (typically committed) or URL. */
  baseline: string;
  /** Current design to extract live and compare — a URL (or local file path). */
  current: string;
}

export interface DesignDriftOutput {
  ok: boolean;
  /** True when the drift gate tripped (exit 1): the current design deviates from the baseline. */
  driftDetected?: boolean;
  /** 0–100 drift score from the CLI (0 = pixel-faithful). */
  score?: number;
  summary?: string;
  /** The CLI's `--json-only` drift payload (score/status/summary/changes[]). */
  driftJson?: string;
  error?: string;
}

export const designDriftDefinition: ActionDefinition<DesignDriftInput> = {
  id: "design.drift",
  description:
    "Brand-drift gate: extract a site's live design tokens and compare them against a baseline extraction " +
    "(dembrandt --compare). Returns a deterministic 0–100 drift score with per-token findings — no LLM involved. " +
    "Use after regenerating pages to verify the design did not deviate from the brand baseline.",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      baseline: {
        type: "string",
        description: "Baseline extraction JSON — file path (e.g. '.deeporca/design-baseline.json') or URL",
      },
      current: {
        type: "string",
        description: "Current design to extract and compare — site URL (or local file path)",
      },
    },
    required: ["baseline", "current"],
    additionalProperties: false,
  },
  // Static declaration covering both input modes: the CLI fetches/renders the
  // `current` target over the network (network) and reads the baseline JSON
  // from the workspace (read-in-cwd). sideEffects is a static schema field,
  // so both scopes are declared rather than switched per invocation.
  sideEffects: ["network", "read-in-cwd"],
};

export const designDriftRun: ActionRun<DesignDriftInput, DesignDriftOutput> = async (input, ctx) => {
  const baseline = input?.baseline?.trim();
  const current = input?.current?.trim();
  if (!baseline || !current) {
    return { ok: false, error: "baseline and current are required" };
  }
  // SSRF guard: `current` is fetched/rendered by the CLI, and `baseline` may
  // itself be a URL — validate any URL-shaped input before it reaches argv.
  const currentTarget = validateDembrandtTargetUrl(current);
  if (!currentTarget.ok) {
    return { ok: false, error: `current: ${currentTarget.error}` };
  }
  let baselineArg = baseline;
  if (/^https?:\/\//i.test(baseline)) {
    const baselineTarget = validateDembrandtTargetUrl(baseline);
    if (!baselineTarget.ok) {
      return { ok: false, error: `baseline: ${baselineTarget.error}` };
    }
    baselineArg = baselineTarget.url;
  }

  ctx.emit({ message: "📐 Comparing current design against baseline…", percent: 40 });

  // Upstream drift syntax: `dembrandt <target> --compare <baseline.json>
  // --json-only` — there is no `drift` subcommand; --compare IS the drift
  // gate (README + docs/ci.md). Exit codes: 0 = pass, 1 = drift detected
  // (a SUCCESSFUL comparison, not an error), 2 = extraction failure,
  // 67 = navigation timeout.
  const { code, stdout, stderr, spawnError } = await runDembrandtCli(
    ctx,
    [currentTarget.url, "--compare", baselineArg, "--json-only"],
    ctx.projectRoot
  );

  if (spawnError) {
    return { ok: false, error: spawnError };
  }

  if (code !== 0 && code !== 1) {
    return {
      ok: false,
      error: `dembrandt drift gate failed with exit code ${code}: ${stderrTail(stderr) || "no stderr output"}.`,
    };
  }

  const driftDetected = code === 1;

  // Minimal parse: only score/summary are lifted out; the full payload
  // (per-token changes[]) rides along as driftJson.
  const payload = tryParseJson(stdout);
  const candidate: unknown = payload?.drift ?? payload;
  const drift = typeof candidate === "object" && candidate !== null ? (candidate as Record<string, unknown>) : null;
  const rawScore = drift && typeof drift.score === "number" ? drift.score : undefined;
  const summary = drift && typeof drift.summary === "string" ? drift.summary : undefined;

  ctx.emit({
    message: driftDetected ? `⚠️ Drift detected (score ${rawScore ?? "?"})` : "✅ Within baseline",
    percent: 100,
  });

  return {
    ok: true,
    driftDetected,
    score: rawScore,
    summary,
    driftJson: stdout.trim() || undefined,
  };
};
