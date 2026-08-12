/**
 * Phase 2 orchestrator (spec §四). Builds the full workspace index trio —
 * symbol (CodeGraph) → document (OpenWiki) → architecture (arch-scan) — in
 * sequence, emitting stage progress. Replaces the renderer's 40-line promise
 * chain + prompt hack with a first-class core action.
 *
 * Calls the same core helpers the individual actions use (no duplication).
 * arch-scan (stage 3) is gated on a `runSubagent` injection (Phase 3 / §十
 * Subagent); when absent, buildAll completes the two deterministic stages and
 * reports arch-scan as skipped — the legacy /arch-scan prompt path still works.
 */

import type { ActionDefinition, ActionRun } from "./types";
import type { ControllerProgress } from "./codegraph-controller";
import { getCodegraphController } from "./codegraph-controller";
import { getWikiController } from "./wiki-controller";

export interface IndexBuildInput {
  /** "init" runs all three stages (incl. arch-scan when subagent is available);
   *  "update" refreshes codegraph + wiki only. */
  readonly mode?: "init" | "update";
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
  const stages: IndexBuildStage[] = [];

  // Stage 1: CodeGraph symbol index (via controller — SDK in production).
  ctx.emit({ message: `[1/3] CodeGraph symbol index`, percent: 5 });
  const cgController = getCodegraphController();
  if (!cgController) {
    stages.push({ stage: "codegraph", ok: false, skipped: true, error: "no CodegraphController configured" });
  } else {
    try {
      await cgController.reindex(ctx.projectRoot, (p: ControllerProgress) =>
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
      await fn(ctx.projectRoot, (p: ControllerProgress) =>
        ctx.emit({ message: `[2/3] ${p.message}`, percent: p.percent ? 33 + Math.floor(p.percent / 3) : undefined })
      );
      stages.push({ stage: "wiki", ok: true });
    } catch (err) {
      stages.push({ stage: "wiki", ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  ctx.emit({ message: `[2/3] wiki done`, percent: 66 });

  // Stage 3: arch-scan (init only; gated on runSubagent — Phase 3 / §十 Subagent).
  if (mode === "init") {
    ctx.emit({ message: `[3/3] arch-scan`, percent: 70 });
    if (!ctx.runSubagent) {
      // Subagent infra (§十 P2) not yet wired — skip gracefully. The legacy
      // /arch-scan prompt path remains available in the meantime.
      stages.push({
        stage: "arch-scan",
        ok: false,
        skipped: true,
        error: "runSubagent not available (§十 Subagent pending)",
      });
    } else {
      try {
        await ctx.runSubagent({ skill: "arch-scan" });
        stages.push({ stage: "arch-scan", ok: true });
      } catch (err) {
        stages.push({ stage: "arch-scan", ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  ctx.emit({
    message: `index.buildAll (${mode}) complete; codegraph=${cgController?.hasProject(ctx.projectRoot) ?? false}`,
    percent: 100,
  });

  return { mode, stages };
};
