/**
 * design.materialize — the UI-DESIGN module's entry (design-module split,
 * real-machine feedback: one auto-routed "一句话→原型" flow was wrong for
 * both disciplines). UI/UX design takes a requirement (a single sentence is
 * fine) and/or an existing PROTOTYPE artifact as the interaction basis, and
 * produces a .dd design document via the deep-design skill / render_design.
 * Prototype generation now lives in the prototype.* module
 * (spec → prototype, see actions/prototype.ts).
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
import { readArtifactFile } from "./prototype";

export interface DesignMaterializeInput {
  /** The design requirement — a single sentence is fine (deep-design expands). */
  requirement?: string;
  /**
   * Optional prototype artifact id (pipeline "openui"): the UI/UX design must
   * cover the prototype's pages/flows — the prototype is the interaction
   * basis, the .dd elevates it to visual design.
   */
  prototypeArtifactId?: string;
}

export interface DesignMaterializeOutput {
  ok: boolean;
  pipeline?: string;
  /** null when the artifact reference can't be resolved — the panels list
   * designs/ as the source of truth (auto-refreshed via design-store events). */
  artifactId?: string | null;
  error?: string;
}

export const designMaterializeDefinition: ActionDefinition<DesignMaterializeInput> = {
  id: "design.materialize",
  description:
    "UI-design module entry: materialize a requirement (one sentence is fine) and/or an existing prototype " +
    "into a UI/UX design document (.dd) via the deep-design skill. When a prototype artifact is given, the " +
    "design covers its pages and flows. Prototype generation is a separate module (prototype.spec → " +
    "prototype.materialize).",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      requirement: {
        type: "string",
        description: "Design requirement in natural language (a single sentence is fine)",
      },
      prototypeArtifactId: {
        type: "string",
        description: "Optional prototype artifact id — design the UI/UX on top of that prototype",
      },
    },
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const designMaterializeRun: ActionRun<DesignMaterializeInput, DesignMaterializeOutput> = async (input, ctx) => {
  const requirement = input?.requirement?.trim();
  const prototypeId = input?.prototypeArtifactId?.trim();
  if (!requirement && !prototypeId) {
    return { ok: false, error: "requirement or prototypeArtifactId is required" };
  }
  if (!ctx.runSubagent) {
    return { ok: false, error: "runSubagent not available — the design subagent channel must be wired" };
  }

  let prototypeContent: string | null = null;
  if (prototypeId) {
    ctx.emit({ message: "📄 读取原型…", percent: 20 });
    prototypeContent = readArtifactFile(ctx.projectRoot, prototypeId, "prototype.openui.txt");
    if (!prototypeContent) {
      return { ok: false, error: `prototype artifact not found for id "${prototypeId}"` };
    }
  }

  ctx.emit({ message: "🎨 正在生成 UI/UX 设计稿…", percent: 50 });

  const promptParts: string[] = [];
  if (requirement) {
    promptParts.push(`Create a .dd design document for: ${requirement}. Pick the best design system.`);
  } else {
    promptParts.push("Create a .dd design document elevating the prototype below into a polished UI/UX design.");
  }
  if (prototypeContent) {
    promptParts.push(
      "The prototype's pages and flows are the interaction basis — the design must cover them all:\n\n" +
        "--- 原型 (OpenUI Lang) ---\n" +
        prototypeContent +
        "\n--- 原型结束 ---"
    );
  }
  promptParts.push("Call the render_design tool with the complete .dd document.");

  try {
    await ctx.runSubagent({
      skill: "deep-design",
      prompt: promptParts.join("\n\n"),
      silent: true,
    });
    ctx.emit({ message: "✅ UI 设计稿已生成", percent: 100 });
    // Task-tree integration: when the session is bound to a task branch, the
    // materialized design becomes a step on that branch — requirement changes
    // then read as forks, not reruns.
    try {
      const sessionId = ctx.activeSessionId?.();
      const ref = sessionId ? ctx.getSessionTaskRef?.(sessionId) : undefined;
      if (ref) {
        const svc = ctx.taskTrees?.();
        // Land on the session's BOUND branch — the tree's global active
        // branch may have been moved by another session or a manual switch.
        svc?.switchBranch(ref.treeId, ref.branch);
        svc?.appendStep(ref.treeId, {
          title: `UI design materialized: ${(requirement ?? prototypeId ?? "").slice(0, 80)}`,
          why: "design.materialize produced a design artifact for this branch.",
        });
      }
    } catch {
      // Best-effort — the materialize result stands without the tree step.
    }
    return {
      ok: true,
      pipeline: "design",
      // runSubagent returns only the last text message — not a stable artifact
      // reference. The panels list designs/ as the source of truth (refreshed
      // via design-store change events) instead of guessing an id here.
      artifactId: null,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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

  const { code, stdout, stderr, spawnError } = await runDembrandtCli(
    ctx,
    [target.url, "--json-only", "--save-output"],
    outputDir
  );

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
    "3. Include a `## Provenance` block in DESIGN.md: source URL, extraction date, tool (dembrandt, pinned vendored version),",
    '   and the note "extracted tokens are for internal design reference only — do not replicate copyrighted visual assets".',
    "4. The deep-design skill's Step 0 reads `.deeporca/DESIGN.md` as the token source for subsequent generation.",
    truncated
      ? `5. tokensJson was truncated — read the full extraction from the files under ${outputDir}.`
      : `5. Full CLI artifacts were also saved under ${outputDir}.`,
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
