/**
 * Phase 2 orchestrator (spec §四). Builds the workspace index pipeline —
 * symbol (CodeGraph) → document (OpenWiki) → architecture (arch-scan) — in
 * sequence, emitting stage progress. Replaces the renderer's 40-line promise
 * chain + prompt hack with a first-class core action.
 *
 * Calls the same core helpers the individual actions use (no duplication).
 * arch-scan (stage 3) runs on the sessionless BackgroundLlmTask channel
 * (specs/index-knowledge-rework R2-2) on BOTH modes — every build must refresh
 * the architecture maps (incrementally when maps exist; real-machine 2026-08-27:
 * update-mode silently skipping arch read as "架构图没有执行") — and when the
 * host hasn't injected the channel, buildAll completes the two deterministic
 * stages and reports arch-scan as skipped; the legacy /arch-scan prompt path
 * still works.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import type { ActionDefinition, ActionRun } from "./types";
import type { ControllerProgress } from "./codegraph-controller";
import { getCodegraphController } from "./codegraph-controller";
import { getWikiController } from "./wiki-controller";
import { getArchRenderer } from "./archify-controller";

export interface IndexBuildInput {
  /** "init" and "update" now run the same three stages (each refreshes in
   *  place when its artifacts exist); the mode only labels the build. */
  readonly mode?: "init" | "update";
  /**
   * Workspace root to build (specs/index-knowledge-rework T3): the per-row
   * build buttons target any listed workspace, not just the active one.
   * Defaults to the action context's project root.
   */
  readonly root?: string;
  /** Optional arch perspective (e.g. "data-flow") forwarded to the arch task. */
  readonly perspective?: string;
}

export interface IndexBuildStage {
  readonly stage: "codegraph" | "wiki" | "arch-scan";
  readonly ok: boolean;
  readonly skipped?: boolean;
  readonly error?: string;
}

export interface IndexBuildOutput {
  readonly mode: string;
  readonly stages: IndexBuildStage[];
}

/**
 * Artifact-aware init/update detection (real-machine ask 2026-08-27): the
 * build action must behave like "make current" per stage — an already-built
 * stage refreshes instead of re-initializing, regardless of which button the
 * user pressed. wiki artifacts live in the canonical `<root>/deepwiki/` store
 * (the CLI's hardcoded openwiki/ dir is a run-local stage, never the read
 * surface); arch-scan persists `arch-*.{md,json}` under `.deeporca/prototypes/`.
 */
function hasExistingWikiArtifacts(root: string): boolean {
  if (!root) return false;
  const dir = join(root, "deepwiki");
  try {
    // A REAL wiki has substantial pages (3KB+ healthy; probe 2026-08-28). A
    // failed init leaves only a bare index.md skeleton (frontmatter + heading,
    // < 100 bytes) and a completion marker — and a hollow run may scatter
    // frontmatter-only stubs. Content weight decides (512B line, same as
    // wiki-cli's post-run guard): anything thinner is NOT an initialized wiki,
    // so the next build regenerates instead of "updating" garbage (real-
    // machine 2026-08-28: update exited 0 in 14s over a 37-byte index.md).
    const stack = [dir];
    while (stack.length > 0) {
      const d = stack.pop()!;
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, ent.name);
        if (ent.isDirectory()) stack.push(p);
        else if (ent.isFile() && ent.name.endsWith(".md")) {
          const substantial = statSync(p).size > 512;
          if (ent.name === "index.md") {
            if (substantial) return true; // substantial landing page
          } else if (substantial) {
            return true; // at least one real topic page
          }
          // Thin files don't count — keep scanning for a substantial one.
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** True when the repo has NO uncommitted changes AND the newest substantial
 *  artifact was generated AFTER the last commit — the maps already describe
 *  exactly this state, so an incremental LLM run has nothing to contribute.
 *  CHEAP GATE (real-machine 2026-08-30, two consecutive incidents): the
 *  model reliably misbehaves on no-change incremental runs — it "helpfully"
 *  rewrites the artifact and degrades it (bash one-liner, then a write-tool
 *  overwrite; both rolled back by the checkpoint, but the run is wasted and
 *  the behavior never stops). The structural answer mirrors wiki's fastPath:
 *  when nothing changed, the model is not invited at all. */
function archNoChangeFastPath(root: string): boolean {
  try {
    const raw = execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"], {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    const generated = ["openwiki/", "deepwiki/", ".deeporca/", ".codegraph/", ".github/workflows/openwiki-update.yml"];
    const codeDirty = raw
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter((p) => p.length > 0 && !generated.some((g) => p === g || p.startsWith(g)));
    if (codeDirty.length > 0) return false;
    const headTs =
      parseInt(
        execFileSync("git", ["-C", root, "log", "-1", "--format=%ct"], {
          stdio: ["ignore", "pipe", "ignore"],
        })
          .toString()
          .trim(),
        10
      ) * 1000;
    if (!Number.isFinite(headTs) || headTs <= 0) return false;
    const dir = join(root, ".deeporca", "prototypes");
    let newest = 0;
    let allDelivered = true;
    for (const f of readdirSync(dir)) {
      if (!/^arch-.+\.(architecture|workflow|sequence|dataflow|lifecycle)\.json$/.test(f)) continue;
      try {
        const st = statSync(join(dir, f));
        if (st.size > 256) newest = Math.max(newest, st.mtimeMs);
        // A map whose deliver FAILED has no rendered HTML sibling — taking the
        // fast path then would skip the LLM repair loop and re-fail the same
        // deliver forever (real-machine 2026-08-31: repository-evidence map
        // dead-locked every build). Maps must be DELIVERED, not just fresh.
        if (!existsSync(join(dir, f).replace(/\.json$/, ".html"))) allDelivered = false;
      } catch {
        // raced — skip
      }
    }
    return newest > headTs && allDelivered;
  } catch {
    return false;
  }
}

function hasExistingArchmaps(root: string): boolean {
  if (!root) return false;
  const dir = join(root, ".deeporca", "prototypes");
  try {
    if (!existsSync(dir)) return false;
    // Archify era (2026-08-29: 摒弃自有 mermaid 方案): a real map is a typed-IR
    // `arch-*.<type>.json` (>256B — a hollow leftover must not route the next
    // build into incremental mode nor count as an output; same content-weight
    // discipline as the wiki skeleton guard).
    for (const file of readdirSync(dir)) {
      if (!/^arch-.+\.(architecture|workflow|sequence|dataflow|lifecycle)\.json$/.test(file)) continue;
      try {
        if (statSync(join(dir, file)).size > 256) return true;
      } catch {
        // raced away — keep scanning
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Human summary of a CodeGraph SyncResult ("+2 −1 · 34 checked · 1.2s"). */
function formatSyncSummary(r: {
  filesChecked: number;
  filesAdded: number;
  filesModified: number;
  filesRemoved: number;
  durationMs: number;
}): string {
  const secs = r.durationMs >= 1000 ? `${(r.durationMs / 1000).toFixed(1)}s` : `${r.durationMs}ms`;
  const changed = r.filesAdded + r.filesModified + r.filesRemoved;
  return changed > 0
    ? `sync: +${r.filesAdded} ~${r.filesModified} −${r.filesRemoved} · ${r.filesChecked} checked · ${secs}`
    : `sync: no changes · ${r.filesChecked} checked · ${secs}`;
}

export const indexBuildAllDefinition: ActionDefinition<IndexBuildInput> = {
  id: "index.build-all",
  description:
    "Build (or update) the full workspace index — CodeGraph symbols → OpenWiki docs → arch-scan architecture diagram — in one sequenced call. Every stage refreshes in place when its artifacts already exist (mode only labels the run). Streams per-stage progress. This is the unified index entry point.",
  category: "index",
  parameters: {
    type: "object",
    properties: { mode: { type: "string", enum: ["init", "update"], description: "'init' (default) or 'update'." } },
    additionalProperties: false,
  },
  sideEffects: ["spawn-subprocess", "write-in-cwd", "network"],
};

export const indexBuildAllRun: ActionRun<IndexBuildInput, IndexBuildOutput> = async (input, ctx) => {
  const mode = input?.mode === "update" ? "update" : "init";
  const root = input?.root || ctx.projectRoot;
  const stages: IndexBuildStage[] = [];

  // Stage 1: CodeGraph symbol index (via controller — SDK in production).
  ctx.emit({ message: `[1/3] CodeGraph symbol index`, percent: 5 });
  const cgController = getCodegraphController();
  if (!cgController) {
    stages.push({ stage: "codegraph", ok: false, skipped: true, error: "no CodegraphController configured" });
  } else {
    try {
      if (cgController.hasProject(root)) {
        // Already-initialized workspace → incremental SYNC, not a re-init:
        // CodeGraph.init throws "already initialized" on an indexed project
        // (real-machine 2026-08-27) which used to fail the whole stage, and a
        // full rebuild would redo work the index already holds. The build
        // action's job is currency, not from-scratch purity — /codegraph
        // reindex stays available for the rare deliberate rebuild. The sync
        // streams scanning/resolving progress and a change-count summary so
        // the button build shows the same flow a from-scratch build does.
        ctx.emit({ message: `[1/3] CodeGraph index exists — syncing`, percent: 5 });
        const syncResult = await cgController.sync(root, (p: ControllerProgress) =>
          ctx.emit({
            message: `[1/3] ${p.message}`,
            percent: p.percent !== undefined ? 5 + Math.floor(p.percent / 5) : undefined,
          })
        );
        if (syncResult) {
          ctx.emit({ message: `[1/3] CodeGraph ${formatSyncSummary(syncResult)}`, percent: 25 });
        }
        stages.push({ stage: "codegraph", ok: true });
      } else {
        await cgController.reindex(root, (p: ControllerProgress) =>
          ctx.emit({ message: `[1/3] ${p.message}`, percent: p.percent ? Math.floor(p.percent / 4) : undefined })
        );
        stages.push({ stage: "codegraph", ok: true });
      }
    } catch (err) {
      stages.push({ stage: "codegraph", ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  // "done" only when the stage actually passed — a failed stage logging
  // Terminal verdicts are EMITTED in a parseable form ("stage failed" /
  // "stage skipped") — build-job-manager's record() parses them so a failed
  // stage is never implicitly promoted to a green "done" by the next stage's
  // header line, and a skipped stage never logs a green "done" (red-team
  // B-1/B-2/B-3, 2026-08-30).
  const stageVerdict = (stage: IndexBuildStage["stage"]): "failed" | "skipped" | "done" => {
    const s = stages.find((x) => x.stage === stage);
    if (!s) return "done";
    if (s.skipped) return "skipped";
    if (s.ok === false) return "failed";
    return "done";
  };
  const stageFailed = (stage: IndexBuildStage["stage"]): boolean => stageVerdict(stage) === "failed";
  ctx.emit({
    message:
      stageVerdict("codegraph") === "failed"
        ? `[1/3] CodeGraph stage failed`
        : stageVerdict("codegraph") === "skipped"
          ? `[1/3] CodeGraph stage skipped`
          : `[1/3] CodeGraph done`,
    percent: 30,
  });

  // Spec (index-knowledge-rework design B1): 任一段失败即停 — later stages
  // are marked skipped instead of running on the previous stage's wreckage
  // (arch-scan consumes wiki+codegraph evidence; running it after a wiki
  // failure burns LLM tokens over incomplete evidence). An UNAVAILABLE stage
  // (skipped: no controller injected) does NOT stop the chain — only a real
  // failure does.

  // Stage 2: OpenWiki document index (via controller — CLI in desktop).
  // Auto mode: existing artifacts → incremental update even on "init".
  ctx.emit({ message: `[2/3] OpenWiki document index`, percent: 32 });
  const wikiController = getWikiController();
  if (stageFailed("codegraph")) {
    stages.push({ stage: "wiki", ok: false, skipped: true, error: "skipped — codegraph stage failed" });
  } else if (!wikiController) {
    stages.push({ stage: "wiki", ok: false, skipped: true, error: "no WikiController configured" });
  } else {
    try {
      const wikiInitialized = hasExistingWikiArtifacts(root);
      // Update ONLY when a real wiki exists (substantial pages). mode:"update"
      // alone must not force it: a hollow openwiki/ — a failed init's
      // skeleton, or a marker whose gitHead field captured git's ERROR TEXT
      // from a pre-bootstrap no-commit run ("HEAD\nfatal: ambiguous
      // argument…") — gives update nothing to diff against. It no-ops in
      // seconds, produces zero pages, and trips the empty-wiki guard
      // (real-machine 2026-08-29: 7s run, [hint:wiki-empty], right after the
      // git bootstrap the marker predates). "Make current" semantics:
      // regenerate instead.
      const wikiUpdate = wikiInitialized;
      if (wikiInitialized) {
        ctx.emit({ message: `[2/3] wiki artifacts exist — updating incrementally`, percent: 33 });
      } else if (mode === "update") {
        ctx.emit({ message: `[2/3] no substantive wiki yet — running full init`, percent: 33 });
      }
      const fn = wikiUpdate ? wikiController.update.bind(wikiController) : wikiController.init.bind(wikiController);
      await fn(root, (p: ControllerProgress) =>
        ctx.emit({ message: `[2/3] ${p.message}`, percent: p.percent ? 30 + Math.floor(p.percent / 4) : undefined })
      );
      stages.push({ stage: "wiki", ok: true });
    } catch (err) {
      stages.push({ stage: "wiki", ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  ctx.emit({
    message:
      stageVerdict("wiki") === "failed"
        ? `[2/3] wiki stage failed`
        : stageVerdict("wiki") === "skipped"
          ? `[2/3] wiki stage skipped`
          : `[2/3] wiki done`,
    percent: 60,
  });

  // Stage 3: arch-scan (archify-driven). The background LLM task authors
  // typed-IR artifacts (arch-<slug>.<type>.json) consuming the CodeGraph +
  // OpenWiki indices built in stages 1-2; the HOST then runs archify's
  // deterministic deliver gate (schema + layout + render checks, atomic HTML
  // commit). Sessionless channel (specs/index-knowledge-rework R2-2): no
  // session, no index entry, nothing in the conversation view. Runs on BOTH
  // modes (real-machine 2026-08-27: an update build that skipped arch read
  // as "架构图没有执行") — incrementally when arch-* artifacts exist.
  // Verdict-aware header (same contract as stages 1/2): a skipped stage must
  // not log a bare "[3/3] arch-scan" that reads as "running".
  ctx.emit({
    message: stageFailed("wiki") || stageFailed("codegraph") ? `[3/3] arch-scan stage skipped` : `[3/3] arch-scan`,
    percent: 62,
  });
  if (stageFailed("codegraph") || stageFailed("wiki")) {
    stages.push({
      stage: "arch-scan",
      ok: false,
      skipped: true,
      error: "skipped — an earlier stage failed",
    });
  } else if (!ctx.runBackgroundTask) {
    stages.push({
      stage: "arch-scan",
      ok: false,
      skipped: true,
      error: "runBackgroundTask not available — use /arch-scan to run manually",
    });
  } else {
    try {
      // Existing arch-* artifacts → incremental update prompt (refresh the
      // affected typed-IR files in place, same names/types).
      const archUpdate = hasExistingArchmaps(root);
      // No-change fastPath (2026-08-30): clean tree + maps newer than the
      // last commit → skip the LLM entirely; run only the deliver gate.
      if (archUpdate && archNoChangeFastPath(root)) {
        ctx.emit({
          message:
            `[3/3] 代码无变更且现有架构图晚于最近提交 — 跳过 LLM 增量扫描 / ` +
            `no changes since the maps were generated — LLM scan skipped`,
          percent: 70,
        });
        const skipRenderer = getArchRenderer();
        if (skipRenderer) await skipRenderer(root);
        stages.push({ stage: "arch-scan", ok: true });
        ctx.emit({
          message: `index.buildAll (${mode}) complete; codegraph=${cgController?.hasProject(root) ?? false}`,
          percent: 100,
        });
        return { mode, stages };
      }
      // CHECKPOINT (real-machine 2026-08-29: an incremental "no changes" run
      // used an ungated bash one-liner with an undefined variable — it wrote
      // "undefined.json" and CLOBBERED the complete artifact; prompt rules
      // are advisory and bash bypasses the write grant, so detection alone
      // left the user's map destroyed). Snapshot every substantial artifact
      // before the LLM runs; the post-run check restores any that were lost
      // or degraded — the wiki store's last-known-good invariant, applied to
      // arch maps.
      const checkpoint = new Map<string, string>();
      if (archUpdate) {
        try {
          const dir = join(root, ".deeporca", "prototypes");
          for (const f of readdirSync(dir)) {
            if (!/^arch-.+\.(architecture|workflow|sequence|dataflow|lifecycle)\.json$/.test(f)) continue;
            const full = join(dir, f);
            try {
              if (statSync(full).size > 256) checkpoint.set(f, readFileSync(full, "utf-8"));
            } catch {
              // raced — skip
            }
          }
        } catch {
          // unreadable — empty checkpoint (fresh-run semantics)
        }
      }
      if (archUpdate) {
        ctx.emit({ message: `[3/3] arch maps exist — updating incrementally`, percent: 63 });
      }
      // The custom incremental PROMPT used to bypass the prompt builder — so
      // it carried neither the target root nor the archify toolkit paths the
      // skill contract reads from the user message (review round 4). The
      // builder now renders the incremental variant itself; input carries the
      // flag and root.
      const taskResult = await ctx.runBackgroundTask({
        skill: "arch-scan",
        root,
        input: {
          ...(input?.perspective ? { perspective: input.perspective } : {}),
          ...(archUpdate ? { incremental: true } : {}),
        },
        // Cancelling the build action aborts the background LLM loop at its
        // next iteration boundary (otherwise an 80-iteration scan would run
        // to completion after the user cancelled).
        signal: ctx.signal,
        onProgress: (message) => ctx.emit({ message: `[3/3] ${message}` }),
      });
      // Deterministic deliver gate (host-injected archify CLI): validate +
      // render every pending typed-IR artifact. A failed deliver throws with
      // archify's structured diagnostics — that IS the post-run verification;
      // a resolved LLM task proves nothing by itself (audit 2026-08-28's
      // hollow-run lesson, now enforced by archify's own contract).
      const renderer = getArchRenderer();
      if (renderer) {
        const delivered = await renderer(root);
        // "Nothing to render" is TWO different situations: all-current maps
        // (receipts verified, 0 re-renders — fine) vs an empty dir after the
        // model claimed success (a failure). They must not share one message
        // (real-machine 2026-08-30 GVGL: the all-current wording masked the
        // hollow case).
        ctx.emit({
          message:
            delivered > 0
              ? `[3/3] 架构图渲染门禁通过 — ${delivered} 张已渲染并校验 / render gate passed — ${delivered} artifact(s) validated`
              : hasExistingArchmaps(root)
                ? `[3/3] 架构图均为当前版本（回执校验通过，无需重渲染）/ all maps current — receipts verified`
                : `[3/3] 架构图无待渲染产物（未产出类型化 IR）/ nothing to render — no typed-IR artifact authored`,
        });
      } else {
        ctx.emit({
          message: `[3/3] 渲染器未配置，跳过确定性门禁 / renderer not configured — deterministic gate skipped`,
        });
      }
      // ROLLBACK: any checkpointed artifact that is now missing or hollow
      // gets restored — UNLESS this run legitimately produced a fresh map
      // (the stage can then still fail on its own merits). Bash in the
      // ROLLBACK — per-artifact (blue-team F2, 2026-08-30: the old check was
      // all-or-nothing, so a run destroying ONE of several maps silently kept
      // the loss). Any checkpointed map that is now missing or degraded to a
      // hollow leftover is restored from its last-known-good bytes. Bash in
      // the background task is ungated by design; this makes destruction of
      // the last-known-good maps impossible regardless of what the model does.
      if (checkpoint.size > 0) {
        let restored = 0;
        try {
          const dir = join(root, ".deeporca", "prototypes");
          for (const [name, content] of checkpoint) {
            const full = join(dir, name);
            let degraded = true;
            try {
              degraded = statSync(full).size <= 256;
            } catch {
              degraded = true; // gone
            }
            if (!degraded) continue;
            mkdirSync(dir, { recursive: true });
            writeFileSync(full, content, "utf-8");
            restored++;
          }
        } catch {
          // best-effort restore
        }
        if (restored > 0) {
          ctx.emit({
            message:
              `[3/3] arch-scan 破坏了既有产物，已从检查点恢复 ${restored} 个文件 / ` +
              `restored ${restored} artifact(s) from checkpoint (rogue write rolled back)`,
          });
        }
      }
      if (!hasExistingArchmaps(root)) {
        // Diagnostics ride the error (real-machine 2026-08-29: the stage said
        // "try another model" while the real cause hid in the discarded task
        // report): the model's final answer excerpt + tool-denial count, and
        // (2026-08-30) the on-disk prototypes listing WITH sizes (a ≤256B file
        // is invisible to the gate — the size is the decoding) + the task's
        // LAST validate_archifact call — a green validate pointing at a path
        // the gate cannot see is exactly the mismatch this pair decodes.
        const denialNote = taskResult.toolDenials ? ` · ${taskResult.toolDenials} tool call(s) were DENIED` : "";
        const report = (taskResult.content ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
        let dirNote = "(dir absent)";
        try {
          const dir = join(root, ".deeporca", "prototypes");
          const listing = readdirSync(dir).map((f) => {
            try {
              return `${f} (${statSync(join(dir, f)).size}B)`;
            } catch {
              return f;
            }
          });
          dirNote = listing.length > 0 ? listing.join(", ") : "(empty)";
        } catch {
          // unreadable — keep the placeholder
        }
        const validateNote = taskResult.lastValidate
          ? ` · last validate_archifact: ${taskResult.lastValidate.path} → ${taskResult.lastValidate.ok ? "PASSED" : "failed"}`
          : "";
        stages.push({
          stage: "arch-scan",
          ok: false,
          error:
            "arch-scan finished without any substantive architecture maps — the model may not " +
            "have authored a typed-IR artifact (files ≤256B are invisible to the gate); try another model" +
            `${denialNote}` +
            ` · prototypes/: [${dirNote}]${validateNote}` +
            (report ? ` · model said: "${report}"` : ""),
        });
      } else {
        stages.push({ stage: "arch-scan", ok: true });
      }
    } catch (err) {
      stages.push({ stage: "arch-scan", ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Terminal line matches reality (real-machine 2026-08-30: a wiki 402
  // failure logged "complete" one line before FAILED — misleading).
  const failedStages = stages.filter((x) => x.ok === false && x.skipped !== true).map((x) => x.stage);
  ctx.emit({
    message:
      failedStages.length > 0
        ? `index.buildAll (${mode}) finished with failures: ${failedStages.join(", ")}; codegraph=${cgController?.hasProject(root) ?? false}`
        : `index.buildAll (${mode}) complete; codegraph=${cgController?.hasProject(root) ?? false}`,
    percent: 100,
  });

  return { mode, stages };
};
