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

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { ActionDefinition, ActionRun } from "./types";
import type { ControllerProgress } from "./codegraph-controller";
import { getCodegraphController } from "./codegraph-controller";
import { getWikiController } from "./wiki-controller";

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
  ctx.emit({ message: `[1/3] CodeGraph done`, percent: 30 });

  // Stage 2: OpenWiki document index (via controller — CLI in desktop).
  // Auto mode: existing artifacts → incremental update even on "init".
  ctx.emit({ message: `[2/3] OpenWiki document index`, percent: 32 });
  const wikiController = getWikiController();
  if (!wikiController) {
    stages.push({ stage: "wiki", ok: false, skipped: true, error: "no WikiController configured" });
  } else {
    try {
      const wikiInitialized = hasExistingWikiArtifacts(root);
      const wikiUpdate = wikiInitialized || mode === "update";
      if (wikiInitialized) {
        ctx.emit({ message: `[2/3] wiki artifacts exist — updating incrementally`, percent: 33 });
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
  ctx.emit({ message: `[2/3] wiki done`, percent: 60 });

  // Stage 3: arch-scan. Generates an interactive architecture map by
  // consuming the CodeGraph + OpenWiki indices built in stages 1-2. Runs on
  // the sessionless BackgroundLlmTask channel (specs/index-knowledge-rework
  // R2-2): no session, no index entry, nothing in the conversation view —
  // manual builds must never produce foreground conversation content. Runs on
  // BOTH modes (real-machine 2026-08-27: an update build that skipped arch
  // read as "架构图没有执行") — incrementally when arch-* artifacts exist.
  ctx.emit({ message: `[3/3] arch-scan`, percent: 62 });
  if (!ctx.runBackgroundTask) {
    stages.push({
      stage: "arch-scan",
      ok: false,
      skipped: true,
      error: "runBackgroundTask not available — use /arch-scan to run manually",
    });
  } else {
    try {
      // Existing arch-* artifacts → incremental update prompt (the skill's
      // own Edge Rules define refresh-in-place semantics).
      const archUpdate = hasExistingArchmaps(root);
      if (archUpdate) {
        ctx.emit({ message: `[3/3] arch maps exist — updating incrementally`, percent: 63 });
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
        onProgress: (message) => ctx.emit({ message: `[3/3] ${message}` }),
      });
      stages.push({ stage: "arch-scan", ok: true });
    } catch (err) {
      stages.push({ stage: "arch-scan", ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  ctx.emit({
    message: `index.buildAll (${mode}) complete; codegraph=${cgController?.hasProject(root) ?? false}`,
    percent: 100,
  });

  return { mode, stages };
};
