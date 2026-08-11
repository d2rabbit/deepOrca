/**
 * Phase 1 CRG actions (spec §三). Sink the code-review-graph build/visualize
 * lifecycle into core actions so the agent (and IPC) can trigger them directly,
 * not just the desktop Risk/Architecture tabs.
 *
 * These wrap the existing core helpers in `common/crg.ts` (which already own the
 * uv-resolved spawn). No new spawn logic — the action is a thin adapter that
 * translates the helper's callback output into ActionProgress and structured
 * results. Gated on uv being resolvable (resolveUvBinary), matching the legacy
 * Risk-tab availability check.
 */

import type { ActionDefinition, ActionRun } from "./types";
import {
  CRG_MCP_SERVER_NAME,
  hasCrgProject,
  resolveUvBinary,
  runCrgResetWithOutput,
  runCrgVisualize,
} from "../common/crg";

/** The 10 CRG analysis-layer MCP tools. (common/crg.ts exposes these as a
 *  comma-joined string for the `--tools` flag; here we need the array for
 *  validation + description.) Keep in sync with CRG_ANALYSIS_TOOLS upstream. */
const CRG_ANALYSIS_TOOL_LIST = [
  "detect_changes_tool",
  "get_impact_radius_tool",
  "get_review_context_tool",
  "get_hub_nodes_tool",
  "get_bridge_nodes_tool",
  "get_surprising_connections_tool",
  "get_knowledge_gaps_tool",
  "get_architecture_overview_tool",
  "list_communities_tool",
  "get_suggested_questions_tool",
];

export interface CrgReindexOutput {
  readonly exitCode: number;
  readonly ok: boolean;
}

export const crgReindexDefinition: ActionDefinition = {
  id: "crg.reindex",
  description:
    "Build (or rebuild) the code-review-graph (CRG) for the current project — the analysis-layer knowledge graph powering risk/impact/architecture queries. Streams build progress. Requires uv (Python) on the host or vendored. Run before asking CRG analysis questions.",
  category: "review",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  sideEffects: ["spawn-subprocess", "write-in-cwd"],
};

export const crgReindexRun: ActionRun<unknown, CrgReindexOutput> = async (_input, ctx) => {
  if (!resolveUvBinary()) {
    throw new Error("crg.reindex: uv is not available (install uv or vendor it) — CRG is a Python tool run via uv");
  }
  ctx.emit({ message: "building code-review-graph", percent: 5 });
  const exitCode = await runCrgResetWithOutput(ctx.projectRoot, (chunk, stream) => {
    ctx.emit({ message: `crg ${stream}: ${chunk.slice(0, 120)}`, percent: undefined });
  });
  if (exitCode !== 0) {
    throw new Error(`crg.reindex: code-review-graph build exited ${exitCode}`);
  }
  ctx.emit({ message: "code-review-graph built", percent: 100 });
  return { exitCode, ok: exitCode === 0 };
};

export const crgVisualizeDefinition: ActionDefinition = {
  id: "crg.visualize",
  description:
    "Render the code-review-graph as a self-contained interactive D3.js HTML page (force-directed graph with communities, hub/bridge nodes). Returns the HTML string. Requires the graph to be built first (crg.reindex).",
  category: "review",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  sideEffects: ["spawn-subprocess", "read-in-cwd"],
};

export interface CrgVisualizeOutput {
  readonly html: string;
  readonly hasGraph: boolean;
}

export const crgVisualizeRun: ActionRun<unknown, CrgVisualizeOutput> = async (_input, ctx) => {
  if (!hasCrgProject(ctx.projectRoot)) {
    throw new Error("crg.visualize: no .code-review-graph/ — run crg.reindex first");
  }
  const html = await runCrgVisualize(ctx.projectRoot);
  if (!html) {
    throw new Error("crg.visualize: code-review-graph visualize produced no output");
  }
  return { html, hasGraph: true };
};

// --- crg.analyze: route to the 10 CRG analysis MCP tools (Phase 1, 5/5) -------
//
// The CRG MCP server (auto-registered when .code-review-graph/ exists) exposes
// these analysis tools: detect_changes, get_impact_radius, get_review_context,
// get_hub_nodes, get_bridge_nodes, get_surprising_connections, get_knowledge_gaps,
// get_architecture_overview, list_communities, get_suggested_questions. This
// action is a thin router: it takes {tool, args} and dispatches via the injected
// ctx.executeMcpTool, collapsing the 10 MCP tools into one action entry point so
// the Risk/Architecture tabs (and the agent) can call analyses uniformly.

/** Sanitize a server/tool name segment the way the MCP manager does (preserve
 *  [a-zA-Z0-9_-], replace the rest with _). Mirrors sanitizeApiToolNamePart. */
function sanitizeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export interface CrgAnalyzeInput {
  /** One of the CRG analysis tools (CRG_ANALYSIS_TOOLS), without the _tool suffix
   *  or with it — both accepted. e.g. "detect_changes" or "detect_changes_tool". */
  readonly tool: string;
  readonly args?: Record<string, unknown>;
}

export interface CrgAnalyzeOutput {
  readonly tool: string;
  readonly ok: boolean;
  readonly output?: string;
  readonly error?: string;
}

export const crgAnalyzeDefinition: ActionDefinition<CrgAnalyzeInput> = {
  id: "crg.analyze",
  description: `Run a code-review-graph (CRG) analysis tool. tool must be one of: ${CRG_ANALYSIS_TOOL_LIST.join(
    ", "
  )}. Routes to the CRG MCP server (requires .code-review-graph/ built via crg.reindex). Use for risk/impact/architecture/community analysis — e.g. detect_changes, get_impact_radius, get_hub_nodes.`,
  category: "review",
  parameters: {
    type: "object",
    properties: {
      tool: { type: "string", description: "CRG analysis tool name (e.g. 'detect_changes_tool')." },
      args: { type: "object", description: "Tool-specific arguments.", additionalProperties: true },
    },
    required: ["tool"],
    additionalProperties: false,
  },
};

export const crgAnalyzeRun: ActionRun<CrgAnalyzeInput, CrgAnalyzeOutput> = async (input, ctx) => {
  if (!ctx.executeMcpTool) {
    throw new Error("crg.analyze: MCP dispatch not available (no mcpManager wired into the registry)");
  }
  // Normalize the tool name: accept with or without the "_tool" suffix.
  const wanted = input.tool.replace(/_tool$/, "");
  const matched = CRG_ANALYSIS_TOOL_LIST.find((t) => t.replace(/_tool$/, "") === wanted);
  if (!matched) {
    throw new Error(`crg.analyze: unknown CRG tool "${input.tool}". Valid: ${CRG_ANALYSIS_TOOL_LIST.join(", ")}`);
  }
  const namespaced = `mcp__${sanitizeSegment(CRG_MCP_SERVER_NAME)}__${sanitizeSegment(matched)}`;
  ctx.emit({ message: `crg.analyze: ${matched}`, percent: 10 });
  const result = await ctx.executeMcpTool(namespaced, input.args ?? {});
  if (!result.ok) {
    throw new Error(`crg.analyze: ${matched} failed — ${result.error ?? "unknown MCP error"}`);
  }
  ctx.emit({ message: `crg.analyze: ${matched} done`, percent: 100 });
  return { tool: matched, ok: true, output: result.output };
};
