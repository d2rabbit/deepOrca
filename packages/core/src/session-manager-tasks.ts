// SessionManager layer — see session-manager-base.ts for the split rationale.
import * as crypto from "crypto";
import { buildThinkingRequestOptions } from "./common/openai-thinking";
import { getTools } from "./prompt";
import { resolveShellPath } from "./common/shell-utils";
import { MAX_SUBAGENT_DEPTH } from "./session-constants";
import { SessionManagerLifecycle } from "./session-manager-lifecycle";
import { type BackgroundLlmTaskOptions, type BackgroundLlmTaskResult, type RunSubagentOptions } from "./actions";
import { getArchifyPaths } from "./actions/archify-controller";
import { inferBashSideEffects, type AskPermissionScope } from "./common/permissions";
import { lstatSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve as resolvePath } from "node:path";
import { resolveGateRoot, type PathGrant } from "./common/path-boundary";
import { getArchifyLanguage } from "./actions/archify-controller";
import type { UserPromptContent, SkillInfo } from "./session-types";

/**
 * Path capability for the sessionless background LLM task (audit 2026-08-29
 * round 2): the executor belongs to the ACTIVE session, but builds can target
 * ANY registered workspace (KnowledgeBuild(root) → input.root) — with no
 * grant, gateWrite/gateRead fall back to the ACTIVE projectRoot and deny
 * every read/write under the target (the pre-archify design dodged this by
 * persisting via main-process save_archmap). Least privilege: reads cover the
 * whole target repo, writes ONLY its prototypes dir (the archify skill's
 * durable-artifact boundary).
 */
export function backgroundTaskPathGrant(targetRoot: string): PathGrant {
  // Canonicalize with the gate's OWN resolver (resolveGateRoot) — a caller-side
  // realpathSync produces /private-style roots while creation-time candidates
  // under a not-yet-existing parent fall back to the LEXICAL (/var-style)
  // path, and the mismatch denies the very first write (probe, macOS /tmp
  // symlink prefix, audit round 2). Roots and candidates MUST share one
  // canonicalizer; the caller ensures the prototypes dir exists so both sides
  // resolve through existing parents.
  const realTarget = resolveGateRoot(targetRoot);
  // READ roots also cover the host-injected archify toolkit (SKILL.md /
  // schemas / examples / bin, all outside every workspace): the task prompt
  // MANDATES reading them first — a target-only grant denied the model's
  // very first instructed actions (review round 6, two agents; the actual
  // root cause of the hollow 2026-08-29 arch build). Read-only, host-owned.
  const readRoots = [realTarget];
  const archify = getArchifyPaths();
  if (archify) {
    for (const dir of [archify.schemasDir, archify.examplesDir]) {
      const r = resolveGateRoot(dir);
      if (!readRoots.includes(r)) readRoots.push(r);
    }
    readRoots.push(resolveGateRoot(archify.skillDoc));
    readRoots.push(resolveGateRoot(archify.bin));
  }
  return {
    readRoots,
    writeRoots: [resolveGateRoot(join(realTarget, ".deeporca", "prototypes"))],
    allowReadOutsideRoots: false,
    allowWriteOutsideRoots: false,
  };
}

/** Ensure the background task's writable boundary exists (see the grant's
 *  canonicalization note) — creation is idempotent and the dir is the task's
 *  documented artifact destination regardless.
 *  SECURITY (review round 6): a symlinked `.deeporca/prototypes` (materialized
 *  by a malicious repo checkout) would relocate the write grant to an
 *  arbitrary destination — refuse loudly instead of granting through it. */
export function ensureBackgroundTaskArtifactDir(targetRoot: string): string {
  const deeporca = join(targetRoot, ".deeporca");
  const dir = join(deeporca, "prototypes");
  for (const p of [deeporca, dir]) {
    try {
      const st = lstatSync(p);
      if (st.isSymbolicLink()) {
        throw new Error(`refusing to run the arch task: ${p} is a symlink (possible write-grant redirection)`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue; // not created yet
      throw err;
    }
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * User prompt for the archify-driven arch-scan background task (pure —
 * extracted for testing). Contract invariants:
 *  - the TARGET ROOT line must match the path grant (opts.root || projectRoot)
 *    or every read/write the model attempts is denied fail-closed;
 *  - the ARCHIFY TOOLKIT paths always accompany the task (the skill contract
 *    reads them from the user message), on BOTH fresh and incremental runs —
 *    an incremental prompt without them used to bypass the contract entirely.
 */
export function buildArchScanTaskPrompt(
  targetRoot: string,
  opts?: { perspective?: string; incremental?: boolean }
): string {
  // Archify toolkit paths come from the host-injected seam (desktop knows
  // the vendored location; core must not derive vendor paths itself).
  const archify = getArchifyPaths();
  const toolkit = archify
    ? `Archify toolkit (host-injected):\n` +
      `- skillDoc: ${archify.skillDoc}\n- schemasDir: ${archify.schemasDir}\n` +
      `- examplesDir: ${archify.examplesDir}\n- bin: ${archify.bin}`
    : "Archify toolkit: NOT CONFIGURED — report this failure, do not improvise.";
  const lines = [
    `Target repository root: ${targetRoot}`,
    `Perspective: ${opts?.perspective ?? "overall"} (map to an archify diagram type per the skill contract).`,
    // Language directive (real-machine 2026-08-29: maps came out English for
    // a Chinese-locale user — the prompt carried no language, so the model
    // defaulted to the prompt's own English). Archify SKILL.md: "match every
    // reader-facing authored string to the language of the user's request" —
    // the app locale IS that request's language.
    getArchifyLanguage()
      ? `Language: write ALL reader-facing text (title, node labels, sublabels, edge labels, boundary labels) in ${getArchifyLanguage()}. Keep exact code identifiers, product names and API paths as-is.`
      : "Language: use the repository's dominant documentation language for reader-facing text.",
    toolkit,
  ];
  if (opts?.incremental) {
    lines.push(
      "",
      "Incremental UPDATE run: the target repository already has archify typed-IR maps",
      "under .deeporca/prototypes/ (arch-*.<type>.json). Refresh them in place — re-read",
      "only the modules whose code changed since the last scan, update the affected IR",
      "files (keep the same names/types), add new perspectives only if genuinely needed,",
      "and leave untouched IR files alone. Do not delete existing artifacts, do not",
      "rename them, and do not REWRITE a file you are not changing — a partial rewrite",
      "DESTROYS the map (a real run wrote a components-only fragment over a complete",
      "artifact, 2026-08-29). If nothing material changed, write NOTHING and say so."
    );
  }
  lines.push(
    "",
    "Showcase quality bar (2026-08-30 user ask: 更完善、更有美感的架构图): use the",
    "full typed surface where the evidence supports it. For architecture maps:",
    "accurate semantic component types, a sublabel + runtime tag on every",
    "component, region/security boundaries for real ownership and trust edges,",
    "1-3 evidence-backed conclusion cards, 2-5 curated meta.views chapters (they",
    "power the story rail in the delivered HTML), grid layout. Other diagram",
    "types: use their own placement/ownership fields (workflow lane+col,",
    "dataflow stage+row, sequence participant order) — the beauty bar is the",
    "same, the fields differ. Keep `visual_preset`/`subtitle`/`animation`",
    "omitted and never author a boundary, card line, or view the code does not",
    "support — completeness of SEMANTICS is the beauty bar, not styling.",
    "",
    "Author the archify typed-IR architecture map(s) for the target repository now,",
    "following the arch-scan skill instructions: explore the repo for evidence, write",
    "`.deeporca/prototypes/arch-<slug>.<type>.json` under the target root, and validate",
    "with the validate_archifact tool (preferred — it runs the official gate",
    "host-side; bare `node <bin> validate` is the fallback). The host runs the",
    "deterministic deliver gate after you finish — your IR file is the deliverable,",
    "not prose. Mutate files ONLY with the write tool — bash mutating commands",
    "(redirects, rm/mv/cp, node -e, …) are BLOCKED by the host before execution."
  );
  return lines.join("\n");
}

/** Count the skill's durable artifacts under the target root. `sinceMs`
 *  restricts to artifacts authored AFTER it (this-run output); undefined
 *  counts any substantial one. Drives the text-only-turn nudge AND the
 *  incremental no-change note. Same >256B content-weight line as the stage
 *  gate and archify-cli — a hollow leftover counts for neither. */
function countArtifacts(targetRoot: string, skill: string, sinceMs?: number): number {
  if (skill !== "arch-scan") return 1;
  let count = 0;
  try {
    const dir = join(targetRoot, ".deeporca", "prototypes");
    for (const f of readdirSync(dir)) {
      if (!/^arch-.+\.(architecture|workflow|sequence|dataflow|lifecycle)\.json$/.test(f)) continue;
      try {
        const st = statSync(join(dir, f));
        if (st.size <= 256) continue;
        if (sinceMs === undefined || st.mtimeMs >= sinceMs) count++;
      } catch {
        // raced away — keep scanning
      }
    }
  } catch {
    // absent dir — nothing landed
  }
  return count;
}

/** Slim runtime context for sessionless background tasks — target-rooted,
 *  absolute-path-explicit, and small enough to stay clear of gateway
 *  content-filter prompt classes (see the loop's system-message note). */
export function backgroundTaskRuntimeContext(targetRoot: string): string {
  return [
    "# Runtime",
    `- target root: ${targetRoot}`,
    `- os: ${process.platform} ${process.arch} · shell ${resolveShellPath()} · node ${process.version}`,
    "- Relative bash paths resolve against the ACTIVE session root, NOT the target — always use ABSOLUTE paths rooted at the target root.",
  ].join("\n");
}

/** Bash scopes that mean "this command MUTATES something" — the background
 *  task's bash must stay read/validate only (user directive 2026-08-30:
 *  bash 写入修改必须严格限制; real incident: a node -e one-liner with an
 *  undefined variable destroyed a complete artifact). */
const BASH_MUTATION_SCOPES: ReadonlySet<string> = new Set([
  "write-in-cwd",
  "write-out-cwd",
  "delete-in-cwd",
  "delete-out-cwd",
  "mutate-git-log",
]);

/**
 * Screen a bash command for the background task. Returns a denial reason
 * when the command mutates anything, null when it may run. The ONE
 * mutation-flagged invocation the skill contract needs — `node <archify-bin>
 * validate …` (any `node <file>` is flagged because script bodies are
 * opaque to static analysis) — is allowlisted in its bare form: node + the
 * vendored bin + validate, with NO shell chaining (no ; | & ` $( ) that
 * could smuggle a second command past the screen).
 */
export function screenBackgroundBash(command: string): string | null {
  const mutating = inferBashSideEffects(command).filter((sc: AskPermissionScope) => BASH_MUTATION_SCOPES.has(sc));
  if (mutating.length === 0) return null;
  const bin = getArchifyPaths()?.bin;
  if (bin) {
    const escaped = bin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Read-only archify subcommands the skill instructs the model to run:
    // validate (the repair loop) + brands/guide (lookups). Everything else
    // that classifies as mutating stays denied (red-team F1 2026-08-30: the
    // brands lookup was denied every time, silently killing brand marks).
    const bareAllowlisted =
      new RegExp(`^\\s*node\\s+"?${escaped}"?\\s+(validate|brands|guide)\\b[\\s\\S]*$`).test(command) &&
      !/[;|&`]|\$\(/.test(command);
    if (bareAllowlisted) return null;
  }
  return (
    "bash mutations are DISABLED in this task (detected: " +
    mutating.join(", ") +
    "). Use the write tool for every file change — its read-before-write guard " +
    "is the safety net a shell one-liner doesn't have."
  );
}

/**
 * Rewrite the generic tool descriptions for the background task's context
 * (user directive 2026-08-30: 引导模型走 tools/MCP，不是一味拦截): models weigh
 * tool descriptions heavily — say WHAT each tool is FOR here, not just what
 * is forbidden.
 *   - bash  → framed as READ-ONLY exploration, mutations pointed elsewhere;
 *   - write → framed as the PRIMARY artifact-authoring channel.
 */
function steerToolDescription(
  t: { type: string; function: { name: string; description?: string; parameters?: unknown } },
  targetRoot: string
): typeof t {
  if (t.function.name === "bash" || t.function.name === "Bash") {
    return {
      ...t,
      function: {
        ...t.function,
        description:
          "READ-ONLY exploration in this task: ls, cat, rg, find, git log/show, jq, node --version. " +
          "Mutating commands (redirects > >>, rm, mv, cp, touch, sed -i, node -e/-c, git commit) are BLOCKED by the host. " +
          "To author or update artifacts use the write tool; to validate use validate_archifact; " +
          "read-only `node <archify-bin> brands/guide` lookups are also allowed.",
      },
    };
  }
  if (t.function.name === "write" || t.function.name === "Write") {
    return {
      ...t,
      function: {
        ...t.function,
        description:
          `PRIMARY artifact tool: author and update the archify typed-IR maps ` +
          `(${targetRoot}/.deeporca/prototypes/arch-<slug>.<type>.json) here. The JSON document ` +
          `goes in the content parameter. Read the existing file first, then write the full updated document.`,
      },
    };
  }
  return t;
}

/** Host-side archify validate for the validate_archifact tool: spawns
 *  `node <bin> validate <type> <path> --quality showcase --json` and returns
 *  the receipt (or an error object). The artifact MUST sit at
 *  `<targetRoot>/.deeporca/prototypes/arch-*.<type>.json` — the exact name +
 *  location the post-task deliver gate reads. A looser check (any path under
 *  the target root) used to let a validate go green on a file the gate would
 *  never list, so the model reported success over an invisible artifact
 *  (real-machine 2026-08-30 GVGL: green validate → "nothing to render" →
 *  undecodable build failure; same contract or no green). */
async function runArchifyValidate(targetRoot: string, artifactPath: string): Promise<string> {
  const archify = getArchifyPaths();
  if (!archify) return JSON.stringify({ ok: false, error: "archify toolkit not configured" });
  // Resolve BEFORE containment (red-team 2026-08-30): a raw-string startsWith
  // let absolute paths carry ".." segments that escaped the prototypes dir
  // while passing the prefix check.
  const resolved = resolvePath(artifactPath.startsWith("/") ? artifactPath : join(targetRoot, artifactPath));
  const grantDir = join(targetRoot, ".deeporca", "prototypes") + "/";
  if (!resolved.startsWith(grantDir)) {
    return JSON.stringify({
      ok: false,
      error:
        `artifact must live at ${join(targetRoot, ".deeporca", "prototypes")}arch-*.<type>.json — ` +
        `the post-task deliver gate reads ONLY that directory; got ${resolved}`,
    });
  }
  const m = basename(resolved).match(/^arch-.+\.(architecture|workflow|sequence|dataflow|lifecycle)\.json$/);
  if (!m) return JSON.stringify({ ok: false, error: "not a typed artifact (arch-*.<type>.json)" });
  const { execFile } = await import("node:child_process");
  return new Promise<string>((resolve) => {
    execFile(
      "node",
      [archify.bin, "validate", m[1], resolved, "--quality", "showcase", "--json"],
      { timeout: 90_000, cwd: targetRoot },
      (err, stdout) => {
        if (err && !stdout) {
          resolve(JSON.stringify({ ok: false, error: err.message }));
          return;
        }
        // Receipt is the last JSON object on stdout.
        const starts = [...stdout.matchAll(/\n?\s*\{/g)].map((x) => x.index ?? 0);
        for (let i = starts.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(stdout.slice(starts[i]).trim());
            if (parsed && typeof parsed === "object") {
              resolve(JSON.stringify(parsed));
              return;
            }
          } catch {
            // try earlier opener
          }
        }
        resolve(stdout.trim() || JSON.stringify({ ok: false, error: "empty validate output" }));
      }
    );
  });
}

export abstract class SessionManagerTasks extends SessionManagerLifecycle {
  /**
   * Build the user prompt for a subagent invocation (pure — extracted for
   * testing). arch-scan gets a domain-specific prompt; others reference the
   * skill name. The matched skill is force-loaded via UserPromptContent.skills
   * regardless, so this prompt is a fallback trigger, not the only loader.
   */
  protected buildSubagentPrompt(skill: string, input?: Record<string, unknown>, prompt?: string): string {
    if (prompt) return prompt;
    if (skill === "arch-scan") {
      const typed = input as { perspective?: string; root?: string; incremental?: boolean } | undefined;
      // TARGET comes from input.root (threaded by runBackgroundLlmTask from
      // opts.root) — NOT this.projectRoot: cross-workspace builds run on the
      // active session's executor while the path grant scopes read/write to
      // the BUILD root; a prompt naming the active root gets every tool call
      // denied (review round 4, three agents independently).
      return buildArchScanTaskPrompt(typed?.root ?? this.projectRoot, {
        perspective: typed?.perspective,
        incremental: typed?.incremental === true,
      });
    }
    return `Execute the ${skill} skill for this project.`;
  }

  /**
   * Sessionless background LLM task (specs/index-knowledge-rework R2-2,
   * design B-1). Runs a skill-driven LLM tool-call loop WITHOUT any session:
   * no sessions-index entry, no message JSONL, no active-session switch, no
   * onAssistantMessage, no stream progress — nothing reaches the conversation
   * view. index.build-all's arch-scan stage runs here so a manual index build
   * can never leak a "Scan the codebase…" session into the sidebar or hijack
   * the main tab.
   *
   * Tool surface is deliberately narrow: built-in read/bash/write + the
   * codegraph / serena MCP servers — everything the arch-scan skill consumes,
   * nothing user-facing (no edit, no AskUserQuestion/UpdatePlan). `write` is
   * path-grant-scoped to the target's prototypes dir only.
   *
   * Permissions — deliberate design decision (2026-08-23, user-confirmed,
   * design-r2.md §三 R3-4; tool face re-scoped 2026-08-29): this loop does
   * NOT run the session permission gate. Issuing the build instruction IS
   * the blanket pre-approval for this narrow tool surface — the user already
   * explicitly asked for the build, so its internal analysis steps must not interrupt with
   * permission prompts. The blast radius stays bounded by the narrow tool
   * surface above, and the artifacts it produces (archify typed-IR files)
   * display exclusively in the Index & Knowledge module, never the
   * conversation view. Confinement is per-tool: read/write are
   * path-grant-scoped; bash remains ungated BY DESIGN (the 2026-08-23
   * decision) — the grant is integrity scoping, not a sandbox.
   */
  async runBackgroundLlmTask(opts: BackgroundLlmTaskOptions): Promise<BackgroundLlmTaskResult> {
    const { client, model, baseURL, temperature, thinkingEnabled, reasoningEffort, debugLogEnabled } =
      this.createOpenAIClient();
    if (!client) {
      throw new Error("API key not found");
    }
    const targetRoot = opts.root || this.projectRoot;
    ensureBackgroundTaskArtifactDir(targetRoot);
    // Task-start timestamp: "authored THIS run" = artifact mtime after this
    // (the wiki side uses the same technique).
    const taskStartedAtMs = Date.now();
    const taskId = `bg-${crypto.randomUUID()}`;
    const controller = new AbortController();
    // Adopt the owning action's cancellation signal (index.build-all forwards
    // ctx.signal): aborting it stops this loop at the next iteration boundary
    // instead of letting an 80-iteration scan run to completion.
    const adoptExternalAbort = () => controller.abort(opts.signal?.reason);
    if (opts.signal?.aborted) {
      controller.abort(opts.signal.reason);
    } else {
      opts.signal?.addEventListener("abort", adoptExternalAbort, { once: true });
    }
    this.backgroundTaskIds.add(taskId);
    try {
      // Force-load the skill document as the task's instruction set.
      let skillPrompt: string | null = null;
      try {
        const skills = await this.listSkills();
        const skill = skills.find((s) => s.name === opts.skill);
        if (skill) {
          skillPrompt = await this.buildSkillPrompt(skill, opts.prompt);
        }
      } catch {
        // Skill scan failure is non-fatal — the task prompt still stands alone.
      }

      const messages: Array<Record<string, unknown>> = [
        {
          role: "system",
          content:
            "You are a non-interactive background analysis task inside DeepOrca. " +
            "Work autonomously to completion: never ask the user questions, never wait for input — " +
            "make reasonable assumptions and finish the task described below. " +
            "Your only lasting output is the tool-side artifacts you produce (e.g. the archify typed-IR map files under .deeporca/prototypes/); " +
            "your final text is a brief completion report to the orchestrator, not to a human.",
        },
        // Runtime context: a SLIM, target-rooted block — NOT the full
        // getStableRuntimeContext (real-machine 2026-08-29, live probe: the
        // full 8KB context incl. the OS command dictionary pushed the whole
        // request into StepFun's content-filter class — deterministic 451
        // censorship_blocked on the FIRST call, both transports; the slim
        // variant passed 3/3. The arch task needs the environment facts, not
        // the command dictionary).
        { role: "system", content: backgroundTaskRuntimeContext(targetRoot) },
      ];
      if (skillPrompt) {
        messages.push({ role: "system", content: skillPrompt });
      }
      messages.push({
        role: "user",
        content: opts.prompt ?? this.buildSubagentPrompt(opts.skill, { ...opts.input, root: targetRoot }, undefined),
      });

      // Narrow tool surface: read/bash/write built-ins + codegraph/serena MCP.
      // "write" joined for archify typed-IR artifacts (2026-08-29) and is
      // path-grant-scoped to the target's prototypes dir (see the grant below);
      // a2ui LEFT the surface with save_archmap's retirement — nothing in the
      // archify skill consumes A2UI surfaces anymore.
      const ALLOWED_BUILTIN = new Set(["read", "bash", "write"]);
      const ALLOWED_MCP = /^mcp__(codegraph|serena)__/;
      const tools = getTools(this.getPromptToolOptions(), this.mcpToolDefinitions)
        .filter((t) => ALLOWED_BUILTIN.has(t.function.name) || ALLOWED_MCP.test(t.function.name))
        .map((t) => steerToolDescription(t, targetRoot));
      // First-class validate tool (user directive 2026-08-30: 引导走 tools，
      // 不是一直拦截): the validate loop was the ONE thing bash was legitimately
      // used for — give it a real tool so the model never needs bash for it.
      const archify = getArchifyPaths();
      if (archify) {
        tools.push({
          type: "function",
          function: {
            name: "validate_archifact",
            description:
              "Validate an archify typed-IR artifact (arch-<slug>.<type>.json) against the schema and showcase quality gates. " +
              "Returns structured diagnostics: fix ONLY the diagnosed subjects using their supportedFixes, then re-validate. " +
              "Prefer this over running bash commands.",
            parameters: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description:
                    "Absolute path to the artifact json (e.g. <targetRoot>/.deeporca/prototypes/arch-x.architecture.json).",
                },
              },
              required: ["path"],
              additionalProperties: false,
            },
          },
        });
      }

      const maxIterations = 80;
      let finalContent: string | null = null;
      let iterations = 0;
      let nudges = 0;
      let toolDenials = 0;
      // arch-scan diagnostics (2026-08-30): the LAST validate_archifact call,
      // surfaced in the result so a green-validate-but-empty-gate outcome is
      // decodable from the build log alone.
      let lastValidate: { path: string; ok: boolean } | undefined = undefined;
      // Gateway content-filter (451 censorship_blocked) is stochastic for
      // agent-prompt classes (live probe 2026-08-29): same request passes and
      // fails across minutes. Retry a couple of times before giving up.
      let censorRetries = 0;
      for (let i = 0; i < maxIterations; i++) {
        this.throwIfAborted(controller.signal);
        iterations = i + 1;
        let response;
        for (;;) {
          try {
            response = await this.createChatCompletionStream(
              client,
              {
                model,
                ...(temperature !== undefined ? { temperature } : {}),
                messages,
                tools,
                ...buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort, model),
              },
              { signal: controller.signal },
              taskId,
              {
                enabled: debugLogEnabled,
                location: "SessionManager.runBackgroundLlmTask",
                baseURL,
                params: { iteration: i, task: opts.skill },
              }
            );
            break;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const censored = /\b451\b|censorship_blocked|content you provided/i.test(msg);
            if (censored && censorRetries < 2) {
              censorRetries++;
              opts.onProgress?.(
                `${opts.skill}: 网关内容审查拦截（451），重试 ${censorRetries}/2 / gateway content filter — retrying`
              );
              await new Promise((r) => setTimeout(r, 800 * censorRetries));
              continue;
            }
            if (censored) {
              throw new Error(
                `background task '${opts.skill}' blocked by the gateway content filter after retries ` +
                  `— switch the model/endpoint for index builds [hint:model-censored model=${model}]`
              );
            }
            throw err;
          }
        }

        const message = response.choices?.[0]?.message;
        const content = typeof message?.content === "string" ? message.content : "";
        const toolCalls = this.normalizeLlmToolCalls(
          (message as { tool_calls?: unknown[] } | undefined)?.tool_calls ?? null
        );
        messages.push({
          role: "assistant",
          content,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        });
        if (!toolCalls) {
          // Text-only turn ≠ task completion for ARTIFACT-PRODUCING tasks
          // (real-machine 2026-08-29: step-3.7-flash narrated its plan and
          // the loop ended with zero IR files; the stage then failed hollow).
          // Nudge up to twice: weaker models often act on the second ask.
          // Prose-only completion stays valid for non-artifact tasks.
          const artifactTask = opts.skill === "arch-scan";
          const artifactYet = countArtifacts(targetRoot, opts.skill) > 0;
          if (artifactTask && !artifactYet && nudges < 2) {
            nudges++;
            opts.onProgress?.(`${opts.skill}: text-only answer without artifacts — nudging (${nudges}/2)`);
            // Claim-aware correction (real-machine 2026-08-29: the model's
            // report said "Created architecture diagram artifact at …" while
            // disk was EMPTY — a hallucinated completion. Confront the claim
            // with the verified disk state and hand it the exact path shape.
            const claimsCreated = /creat|wrote|saved|生成|创建|保存/i.test(content);
            messages.push({
              role: "user",
              content: claimsCreated
                ? `Your report claims an artifact was created, but the filesystem shows NO file under ` +
                  `${targetRoot}/.deeporca/prototypes/ matching arch-*.<type>.json — the creation you ` +
                  `described never happened. Create it NOW with the write tool (absolute path, e.g. ` +
                  `${targetRoot}/.deeporca/prototypes/arch-overview.architecture.json), following the ` +
                  `archify SKILL.md contract. A prose claim of creation does not complete this task.`
                : "A prose answer does not complete this task. Your deliverable is the artifact " +
                  "file(s) on disk. Continue NOW with tool calls: explore what you still need, then " +
                  `write the artifact file(s) under ${targetRoot}/.deeporca/prototypes/ exactly as the ` +
                  "skill contract specifies. Do not answer with text only.",
            });
            continue;
          }
          finalContent = content;
          break;
        }
        // Bash mutation screen (user directive 2026-08-30): bash in this
        // loop is read/validate only — mutating commands are DENIED before
        // execution with a pointer to the write tool, instead of relying on
        // prompt compliance (the undefined.json incident bypassed it via a
        // node one-liner).
        const screened: typeof toolCalls = [];
        const deniedResults: Array<{
          toolCallId: string;
          content: string;
          result: { ok: false; name: string; error: string };
        }> = [];
        for (const call of toolCalls) {
          const fn = (call as { function?: { name?: string; arguments?: string } }).function;
          const name = fn?.name ?? "";
          if (name === "validate_archifact") {
            // First-class validate (host-spawned; replaces the bare-bash
            // allowlist as the model's natural path).
            const id = (call as { id?: string }).id ?? `val-${screened.length}`;
            let artPath = "";
            try {
              artPath = String((JSON.parse(fn?.arguments ?? "{}") as { path?: unknown }).path ?? "");
            } catch {
              artPath = "";
            }
            const receipt = await runArchifyValidate(targetRoot, artPath);
            try {
              lastValidate = { path: artPath, ok: (JSON.parse(receipt) as { ok?: unknown }).ok === true };
            } catch {
              lastValidate = { path: artPath, ok: false };
            }
            deniedResults.push({
              toolCallId: id,
              content: receipt,
              result: { ok: false as const, name: "validate_archifact", error: receipt },
            });
            continue;
          }
          if (name === "bash" || name === "Bash") {
            let cmd = "";
            try {
              cmd = String((JSON.parse(fn?.arguments ?? "{}") as { command?: unknown }).command ?? "");
            } catch {
              cmd = "";
            }
            const denial = screenBackgroundBash(cmd);
            if (denial) {
              const id = (call as { id?: string }).id ?? `denied-${screened.length}`;
              deniedResults.push({
                toolCallId: id,
                content: JSON.stringify({ ok: false, name: "bash", error: denial }),
                result: { ok: false as const, name: "bash", error: denial },
              });
              toolDenials++;
              opts.onProgress?.(`${opts.skill}: bash 变更命令被拦截 / bash mutation denied`);
              continue;
            }
          }
          screened.push(call);
        }
        const executions =
          screened.length > 0
            ? await this.toolExecutor.executeToolCalls(
                taskId,
                screened,
                { shouldStop: () => controller.signal.aborted },
                { pathGrant: backgroundTaskPathGrant(targetRoot) }
              )
            : [];
        executions.push(...deniedResults);
        let denied = 0;
        const toolTrace: string[] = [];
        for (let e = 0; e < executions.length; e++) {
          const exec = executions[e];
          messages.push({ role: "tool", tool_call_id: exec.toolCallId, content: exec.content });
          const failed = /"ok":\s*false|"error":/i.test(exec.content);
          if (/PERMISSION_DENIED/.test(exec.content)) denied++;
          // Per-call trace (real-machine 2026-08-29: the model's final report
          // CLAIMED an artifact existed while disk was empty — with no
          // tool trace the discrepancy was undiagnosable from the logs).
          const call = toolCalls[e] as { function?: { name?: string } } | undefined;
          // Neutralize raw MCP ids for UI progress copy (spec naming red
          // line — "mcp__codegraph__symbol_search" leaks engine names).
          const raw = call?.function?.name ?? "?";
          const short = raw.startsWith("mcp__") ? raw.split("__").slice(1).join("·") : raw;
          toolTrace.push(`${short}${failed ? "✗" : ""}`);
        }
        toolDenials += denied;
        opts.onProgress?.(
          `${opts.skill}: ${i + 1} step${i === 0 ? "" : "s"} · ${toolTrace.join(" ")}${
            denied > 0 ? ` · ${denied} DENIED` : ""
          }`
        );
      }
      // Budget exhaustion must not read as success (audit 2026-08-28 — the
      // same class as wiki's exit-0-over-skeleton): reaching the ceiling with
      // tool calls still pending means the loop never produced a final answer,
      // usually a tool-error loop. Callers (index.build-all stage 3) report
      // this as a failed stage instead of a green checkmark over nothing.
      if (finalContent === null) {
        throw new Error(
          `background task '${opts.skill}' hit the ${maxIterations}-iteration ceiling without a final answer — ` +
            `likely a tool-error loop; check the model's tool compatibility`
        );
      }
      // Incremental transparency (review round 6): a no-change incremental
      // run legitimately writes nothing — but it must SAY so, not pass
      // silently green over a prose-only hollow turn.
      const incremental = opts.input?.incremental === true || /Incremental UPDATE run/.test(opts.prompt ?? "");
      if (opts.skill === "arch-scan" && incremental && countArtifacts(targetRoot, opts.skill, taskStartedAtMs) === 0) {
        opts.onProgress?.(
          `${opts.skill}: 增量运行零新产物（无变更或未产出，已按现状完成）/ incremental run authored no new artifacts`
        );
      }
      return { content: finalContent, iterations, toolDenials, lastValidate };
    } finally {
      this.backgroundTaskIds.delete(taskId);
      opts.signal?.removeEventListener("abort", adoptExternalAbort);
      // A2UI flush REMOVED (real-machine root cause 2026-08-31): persistSurfaces
      // UNLINKS every "arch-"-prefixed .json in prototypes/ as "stale" before
      // writing back only the A2UI surfaces it tracks in memory. The archify
      // task writes its typed-IR with the WRITE TOOL — invisible to that Map —
      // so a freshly authored + validated map was deleted right after the task
      // ended, and the deliver gate then reported "nothing to render". The
      // archify era produces artifacts as files, not A2UI surfaces: there is
      // genuinely nothing to flush here.
    }
  }

  /**
   * Minimal Subagent runtime (roadmap §十 P2, spec §五). Runs an isolated
   * sub-session that force-loads the named skill and activates the LLM loop to
   * completion. The parent's active session is saved and restored so the UI
   * returns to it. The sub-session currently appears in the sidebar (marked by
   * its skill prompt) — UI isolation is a follow-up; this is the experimental
   * first step the roadmap describes ("先做桌面内受控实验").
   *
   * Re-entrancy: the engine is subagent-friendly — activateSession is keyed by
   * sessionId over Map<sessionId> state, so nested invocations don't collide.
   * Recursion is capped at MAX_SUBAGENT_DEPTH (deep review 2026-08-15, B6): a
   * mutually-recursive skill pair would otherwise nest unbounded LLM loops.
   */
  async runSubagent(opts: RunSubagentOptions): Promise<{ sessionId: string; content: string | null }> {
    if (this.subagentDepth >= MAX_SUBAGENT_DEPTH) {
      throw new Error(`Subagent recursion depth exceeded (>${MAX_SUBAGENT_DEPTH}) — mutually-recursive skills?`);
    }
    const previousActive = this.activeSessionId;
    // Silent mode: while set, newly created sub-sessions are flagged
    // isSilentSubagent (hidden from the list; renderer drops their streamed
    // messages). Cleared in finally so a thrown skill never leaves it on.
    const previousSilent = this.silentSubagentActive;
    if (opts.silent) {
      this.silentSubagentActive = true;
    }
    this.subagentDepth += 1;
    // Force-load the named skill (don't rely on auto-match alone).
    let skillInfo: SkillInfo | undefined;
    try {
      const skills = await this.listSkills();
      skillInfo = skills.find((s) => s.name === opts.skill);
    } catch {
      // Skill scan failure is non-fatal — the prompt still triggers auto-match.
    }
    const userPrompt: UserPromptContent = {
      text: this.buildSubagentPrompt(opts.skill, opts.input as Record<string, unknown> | undefined, opts.prompt),
      skills: skillInfo ? [{ ...skillInfo, isLoaded: false }] : undefined,
    };
    try {
      // createSession sets the sub-session active and runs its LLM loop to
      // completion (it calls activateSession internally).
      const subSessionId = await this.createSession(userPrompt);
      const msgs = this.listSessionMessages(subSessionId);
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
      const content = typeof lastAssistant?.content === "string" ? lastAssistant.content : null;
      if (opts.silent) {
        // Zero-residue guarantee (specs/index-knowledge-rework R2): delete the
        // sub-session entirely — index entry, message JSONL, in-memory state.
        // Silent runs are pipeline internals; persisting them only pollutes
        // the disk index and eats the MAX_SESSION_ENTRIES eviction pool.
        // BUT flush any artifacts the subagent produced first (A2UI surfaces
        // for arch-scan live in an in-memory Map that only persists on
        // manager dispose — deleting the session without flushing would lose
        // the architecture map the build was supposed to produce).
        try {
          this.currentA2uiLifecycle?.persistSurfaces(this.projectRoot);
        } catch {
          // best-effort flush
        }
        try {
          this.deleteSession(subSessionId);
        } catch {
          // best-effort — entry stays hidden via isSilentSubagent either way
        }
      }
      return { sessionId: subSessionId, content };
    } finally {
      // Restore the parent as the active session so the UI returns to it.
      this.activeSessionId = previousActive;
      this.silentSubagentActive = previousSilent;
      this.subagentDepth = Math.max(0, this.subagentDepth - 1);
    }
  }
}
