/**
 * Phase 3 arch-scan action (spec §四/§五). The architecture-level scanner.
 *
 * Unlike the other index actions, arch-scan is NOT a deterministic spawn — it
 * is an LLM skill that reads code and emits an A2UI Surface. So its `run`
 * triggers a SUBAGENT (§十 runSubagent, P2) to execute the skill in isolation.
 * This is the first defineAction + Subagent + A2UI convergence point.
 *
 * Until §十 Subagent lands, `ctx.runSubagent` is undefined: the action then
 * returns a structured "pending" result (does not throw) so callers can detect
 * the dependency cleanly. Once the host injects runSubagent, the action executes
 * the skill and returns its result. See specs/define-action/design.md §五.
 */

import type { ActionDefinition, ActionRun } from "./types";

export interface ArchScanInput {
  /** Optional focus perspective (e.g. "data-flow", "dependency-map"). Omit = all. */
  readonly perspective?: string;
}

export interface ArchScanOutput {
  readonly ok: boolean;
  readonly pending?: boolean;
  readonly reason?: string;
  readonly result?: unknown;
}

export const archScanRunDefinition: ActionDefinition<ArchScanInput> = {
  id: "arch-scan.run",
  description:
    "Scan the codebase architecture and generate an interactive architecture map (perspective-driven: overall/data-flow/dependency/...). Returns an A2UI Surface rendered in-app. This is a non-deterministic, agent-driven action (it spawns a subagent that reads code and reasons about structure). Complements CodeGraph (symbol-level) and OpenWiki (document-level) as the architecture-level index.",
  category: "index",
  parameters: {
    type: "object",
    properties: {
      perspective: {
        type: "string",
        description: "Optional focus perspective (e.g. 'data-flow'). Omit for full scan.",
      },
    },
    additionalProperties: false,
  },
  sideEffects: ["spawn-subprocess"],
};

export const archScanRunRun: ActionRun<ArchScanInput, ArchScanOutput> = async (input, ctx) => {
  if (!ctx.runSubagent) {
    return {
      ok: false,
      pending: true,
      reason:
        "arch-scan.run requires the Subagent runtime, which is not available. The skill can still be triggered manually via /arch-scan.",
    };
  }
  ctx.emit({ message: `arch-scan${input?.perspective ? ` (${input.perspective})` : ""} started`, percent: 10 });
  const result = await ctx.runSubagent({
    skill: "arch-scan",
    input: input?.perspective ? { perspective: input.perspective } : undefined,
  });
  ctx.emit({ message: "arch-scan complete", percent: 100 });
  return { ok: true, result };
};
