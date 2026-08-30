/**
 * Phase 3 arch-scan action (spec §四/§五). The architecture-level scanner.
 *
 * Unlike the other index actions, arch-scan is NOT a deterministic spawn — it
 * is an LLM skill that reads code and authors archify typed-IR artifacts
 * (`.deeporca/prototypes/arch-<slug>.<type>.json`), which the host then
 * renders through archify's validated delivery pipeline (schema + layout +
 * render gates, atomic self-contained HTML). The hand-rolled Mermaid document
 * approach was retired 2026-08-29 (user decision: 采用 archify). So its `run`
 * triggers a SUBAGENT (§十 runSubagent, P2) to execute the skill in isolation.
 *
 * Until §十 Subagent lands, `ctx.runSubagent` is undefined: the action then
 * returns a structured "pending" result (does not throw) so callers can detect
 * the dependency cleanly. Once the host injects runSubagent, the action executes
 * the skill and returns its result. See specs/define-action/design.md §五.
 */

import type { ActionDefinition, ActionRun } from "./types";
import type { BackendStatus } from "../common/analysis-status";
import { getArchRenderer } from "./archify-controller";

export interface ArchScanInput {
  /** Optional focus perspective (e.g. "data-flow", "dependency-map"). Omit = all. */
  readonly perspective?: string;
}

export interface ArchScanOutput {
  readonly ok: boolean;
  /** Per-call degradation state — "unavailable" while the Subagent runtime is missing. */
  readonly status?: BackendStatus;
  readonly pending?: boolean;
  readonly reason?: string;
  readonly result?: unknown;
}

export const archScanRunDefinition: ActionDefinition<ArchScanInput> = {
  id: "arch-scan.run",
  description:
    "Scan the codebase architecture and generate architecture maps (perspective-driven: overall/data-flow/dependency/...). Authors archify typed-IR artifacts (.deeporca/prototypes/arch-*.<type>.json); the host renders them through archify's validated delivery pipeline into self-contained interactive HTML shown in the Knowledge panel. This is a non-deterministic, agent-driven action (it spawns a subagent that reads code and reasons about structure). Complements CodeGraph (symbol-level) and OpenWiki (document-level) as the architecture-level index.",
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
  // Prefer the sessionless background channel (R2-2): an LLM-invoked arch
  // scan must not spawn a foreground sub-session either. runSubagent remains
  // as the fallback for hosts that only inject the older seam.
  if (!ctx.runBackgroundTask && !ctx.runSubagent) {
    return {
      ok: false,
      status: "unavailable",
      pending: true,
      reason:
        "arch-scan.run requires the background-task runtime, which is not available. The skill can still be triggered manually via /arch-scan.",
    };
  }
  ctx.emit({ message: `arch-scan${input?.perspective ? ` (${input.perspective})` : ""} started`, percent: 10 });
  const result = ctx.runBackgroundTask
    ? await ctx.runBackgroundTask({
        skill: "arch-scan",
        input: input?.perspective ? { perspective: input.perspective } : undefined,
      })
    : await ctx.runSubagent!({
        skill: "arch-scan",
        input: input?.perspective ? { perspective: input.perspective } : undefined,
      });
  // Same deterministic deliver gate as index.build-all's arch stage: the
  // background task only AUTHORS typed-IR files; rendering + validation is
  // the host's archify pipeline. A standalone arch-scan.run must not leave
  // unrendered artifacts behind (漏换 audit 2026-08-29).
  const renderer = getArchRenderer();
  if (renderer) {
    const delivered = await renderer(ctx.projectRoot);
    ctx.emit({ message: `架构图渲染门禁 — ${delivered} 张已渲染 / render gate — ${delivered} artifact(s)` });
  }
  ctx.emit({ message: "arch-scan complete", percent: 100 });
  return { ok: true, status: "active", result };
};
