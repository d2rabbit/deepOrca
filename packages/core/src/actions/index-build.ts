/**
 * Phase 2 orchestrator (spec §四). Builds the full workspace index trio —
 * symbol (CodeGraph) → document (OpenWiki) → architecture (arch-scan) — in
 * sequence, emitting stage progress. Replaces the renderer's 40-line promise
 * chain + prompt hack with a first-class core action.
 *
 * Calls the same core helpers the individual actions use (no duplication).
 * arch-scan (stage 3) runs on the sessionless BackgroundLlmTask channel
 * (specs/index-knowledge-rework R2-2); when the host hasn't injected it,
 * buildAll completes the two deterministic stages and reports arch-scan as
 * skipped — the legacy /arch-scan prompt path still works.
 */

import type { ActionDefinition, ActionRun } from "./types";
import type { ControllerProgress } from "./codegraph-controller";
import { getCodegraphController } from "./codegraph-controller";
import { getWikiController } from "./wiki-controller";

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
  readonly stage: "codegraph" | "wiki" | "arch-scan";
  readonly ok: boolean;
  readonly skipped?: boolean;
  readonly error?: string;
}

export interface IndexBuildOutput {
  readonly mode: string;
  readonly stages: IndexBuildStage[];
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
  ctx.emit({ message: `[1/3] CodeGraph symbol index`, percent: 5 });
  const cgController = getCodegraphController();
  if (!cgController) {
    stages.push({ stage: "codegraph", ok: false, skipped: true, error: "no CodegraphController configured" });
  } else {
    try {
      await cgController.reindex(root, (p: ControllerProgress) =>
        ctx.emit({ message: `[1/3] ${p.message}`, percent: p.percent ? Math.floor(p.percent / 3) : undefined })
      );
      stages.push({ stage: "codegraph", ok: true });
    } catch (err) {
      stages.push({ stage: "codegraph", ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  ctx.emit({ message: `[1/3] CodeGraph done`, percent: 33 });

  // Stage 2: OpenWiki document index (via controller — CLI in desktop).
  ctx.emit({ message: `[2/3] OpenWiki document index`, percent: 38 });
  const wikiController = getWikiController();
  if (!wikiController) {
    stages.push({ stage: "wiki", ok: false, skipped: true, error: "no WikiController configured" });
  } else {
    try {
      const fn =
        mode === "init" ? wikiController.init.bind(wikiController) : wikiController.update.bind(wikiController);
      await fn(root, (p: ControllerProgress) =>
        ctx.emit({ message: `[2/3] ${p.message}`, percent: p.percent ? 33 + Math.floor(p.percent / 3) : undefined })
      );
      stages.push({ stage: "wiki", ok: true });
    } catch (err) {
      stages.push({ stage: "wiki", ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  ctx.emit({ message: `[2/3] wiki done`, percent: 66 });

  // Stage 3: arch-scan (init only). Generates an interactive architecture map
  // by consuming the CodeGraph + OpenWiki indices built in stages 1-2. Runs on
  // the sessionless BackgroundLlmTask channel (specs/index-knowledge-rework
  // R2-2): no session, no index entry, nothing in the conversation view —
  // manual builds must never produce foreground conversation content.
  if (mode === "init") {
    ctx.emit({ message: `[3/3] arch-scan`, percent: 70 });
    if (!ctx.runBackgroundTask) {
      stages.push({
        stage: "arch-scan",
        ok: false,
        skipped: true,
        error: "runBackgroundTask not available — use /arch-scan to run manually",
      });
    } else {
      try {
        await ctx.runBackgroundTask({
          skill: "arch-scan",
          root,
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
  }
  ctx.emit({
    message: `index.buildAll (${mode}) complete; codegraph=${cgController?.hasProject(root) ?? false}`,
    percent: 100,
  });

  return { mode, stages };
};
