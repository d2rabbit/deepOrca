/**
 * Phase 2 orchestrator (spec §四). Builds the workspace index pipeline —
 * symbol (CodeGraph) → document (OpenWiki) → architecture (arch-scan, init)
 * → bilingual translation (wiki.translate) — in sequence, emitting stage
 * progress. Replaces the renderer's 40-line promise chain + prompt hack with
 * a first-class core action.
 *
 * Calls the same core helpers the individual actions use (no duplication).
 * arch-scan (stage 3) runs on the sessionless BackgroundLlmTask channel
 * (specs/index-knowledge-rework R2-2); when the host hasn't injected it,
 * buildAll completes the two deterministic stages and reports arch-scan as
 * skipped — the legacy /arch-scan prompt path still works. Stage 4 runs on
 * BOTH modes (update refreshes pages too) and is ordered LAST so its
 * `*.zh.md`/`*.en.md` variant files never feed arch-scan's wiki context.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { ActionDefinition, ActionRun } from "./types";
import type { ControllerProgress } from "./codegraph-controller";
import { getCodegraphController } from "./codegraph-controller";
import { getWikiController } from "./wiki-controller";
import { wikiTranslateRun } from "./wiki-translate";

export interface IndexBuildInput {
  /** "init" runs all three stages (incl. arch-scan when subagent is available);
   *  "update" refreshes codegraph + wiki only. */
  readonly mode?: "init" | "update";
  /**
   * Workspace root to build (specs/index-knowledge-rework T3): the per-row
   * build buttons target any listed workspace, not just the active one.
   * Defaults to the action context's project root.
   */
  readonly root?: string;
}

export interface IndexBuildStage {
  readonly stage: "codegraph" | "wiki" | "arch-scan" | "wiki-translate";
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
 * stage refresHEs instead of re-initializing, regardless of which button the
 * user pressed. wiki artifacts live under `<root>/openwiki/`; arch-scan
 * persists `arch-*.{md,html,json}` under `.deeporca/prototypes/`.
 */
function hasExistingWikiArtifacts(root: string): boolean {
  if (!root) return false;
  const dir = join(root, "openwiki");
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).length > 0; // a bare empty dir is not an initialized wiki
  } catch {
    return false;
  }
}

function hasExistingArchmaps(root: string): boolean {
  if (!root) return false;
  const dir = join(root, ".deeporca", "prototypes");
  try {
    return existsSync(dir) && readdirSync(dir).some((file) => /^arch-/.test(file));
  } catch {
    return false;
  }
}

export const indexBuildAllDefinition: ActionDefinition<IndexBuildInput> = {
  id: "index.build-all",
  description:
    "Build (or update) the full workspace index — CodeGraph symbols → OpenWiki docs → (on init) arch-scan architecture diagram — in one sequenced call. mode='init' (default) builds everything; 'update' refreshes symbol+doc indices only. Streams per-stage progress. This is the unified index entry point.",
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
  ctx.emit({ message: `[1/4] CodeGraph symbol index`, percent: 5 });
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
        // reindex stays available for the rare deliberate rebuild.
        ctx.emit({ message: `[1/4] CodeGraph index exists — syncing`, percent: 5 });
        await cgController.sync(root);
        stages.push({ stage: "codegraph", ok: true });
      } else {
        await cgController.reindex(root, (p: ControllerProgress) =>
          ctx.emit({ message: `[1/4] ${p.message}`, percent: p.percent ? Math.floor(p.percent / 4) : undefined })
        );
        stages.push({ stage: "codegraph", ok: true });
      }
    } catch (err) {
      stages.push({ stage: "codegraph", ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  ctx.emit({ message: `[1/4] CodeGraph done`, percent: 25 });

  // Stage 2: OpenWiki document index (via controller — CLI in desktop).
  // Auto mode: existing artifacts → incremental update even on "init".
  ctx.emit({ message: `[2/4] OpenWiki document index`, percent: 28 });
  const wikiController = getWikiController();
  if (!wikiController) {
    stages.push({ stage: "wiki", ok: false, skipped: true, error: "no WikiController configured" });
  } else {
    try {
      const wikiInitialized = hasExistingWikiArtifacts(root);
      const wikiUpdate = wikiInitialized || mode === "update";
      if (wikiInitialized) {
        ctx.emit({ message: `[2/4] 已有 wiki — 增量更新`, percent: 29 });
      }
      const fn = wikiUpdate ? wikiController.update.bind(wikiController) : wikiController.init.bind(wikiController);
      await fn(root, (p: ControllerProgress) =>
        ctx.emit({ message: `[2/4] ${p.message}`, percent: p.percent ? 25 + Math.floor(p.percent / 4) : undefined })
      );
      stages.push({ stage: "wiki", ok: true });
    } catch (err) {
      stages.push({ stage: "wiki", ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  ctx.emit({ message: `[2/4] wiki done`, percent: 50 });

  // Stage 3: arch-scan (init only). Generates an interactive architecture map
  // by consuming the CodeGraph + OpenWiki indices built in stages 1-2. Runs on
  // the sessionless BackgroundLlmTask channel (specs/index-knowledge-rework
  // R2-2): no session, no index entry, nothing in the conversation view —
  // manual builds must never produce foreground conversation content.
  let archOk = true;
  if (mode === "init") {
    ctx.emit({ message: `[3/4] arch-scan`, percent: 52 });
    if (!ctx.runBackgroundTask) {
      archOk = false;
      stages.push({
        stage: "arch-scan",
        ok: false,
        skipped: true,
        error: "runBackgroundTask not available — use /arch-scan to run manually",
      });
    } else {
      try {
        // Auto mode: existing arch-* artifacts → incremental update prompt
        // (the skill's own Edge Rules define refresh-in-place semantics).
        const archUpdate = hasExistingArchmaps(root);
        if (archUpdate) {
          ctx.emit({ message: `[3/4] 已有架构图产物 — 增量更新`, percent: 53 });
        }
        await ctx.runBackgroundTask({
          skill: "arch-scan",
          root,
          ...(archUpdate
            ? {
                prompt:
                  `Incremental UPDATE run: this workspace already has architecture maps under ` +
                  `.deeporca/prototypes/ (arch-*.{md,html,json}). Refresh them in place — re-read only the ` +
                  `modules whose code changed since the last scan, update the affected diagrams via save_archmap ` +
                  `(keep the same names), add new perspectives only if genuinely needed, and leave untouched ` +
                  `diagrams alone. Do not delete existing artifacts. Output the same completion report format.`,
              }
            : {}),
          // Cancelling the build action aborts the background LLM loop at its
          // next iteration boundary (otherwise an 80-iteration scan would run
          // to completion after the user cancelled).
          signal: ctx.signal,
          onProgress: (message) => ctx.emit({ message: `[3/4] ${message}` }),
        });
        stages.push({ stage: "arch-scan", ok: true });
      } catch (err) {
        archOk = false;
        stages.push({ stage: "arch-scan", ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // Stage 4: bilingual translation (backend agent). Runs on BOTH modes —
  // update builds refresh pages too, and the mtime skip means only changed
  // pages cost a completion. Still runs when arch-scan was skipped/unavailable
  // (independent stage), but a FAILED arch-scan skips translation to keep the
  // classic "stop at first broken stage" UX for init builds.
  // Stage prefix differs by mode: init orders it [4/4] (after arch-scan),
  // update orders it [3/4] (last stage) — matching the job's stage array.
  const tPrefix = mode === "init" ? "[4/4]" : "[3/4]";
  const wikiOk = stages.find((s) => s.stage === "wiki")?.ok ?? false;
  if (!wikiOk || (mode === "init" && !archOk)) {
    stages.push({ stage: "wiki-translate", ok: false, skipped: true, error: "wiki stage did not complete" });
  } else {
    ctx.emit({ message: `${tPrefix} wiki 翻译 · bilingual translation`, percent: 80 });
    try {
      await wikiTranslateRun(
        { root },
        {
          ...ctx,
          emit: (e) => ctx.emit({ ...e, message: `${tPrefix} ${e.message}` }),
        }
      );
      stages.push({ stage: "wiki-translate", ok: true });
    } catch (err) {
      stages.push({ stage: "wiki-translate", ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  ctx.emit({
    message: `index.buildAll (${mode}) complete; codegraph=${cgController?.hasProject(root) ?? false}`,
    percent: 100,
  });

  return { mode, stages };
};
