/**
 * design.materialize — one-click requirement materialization for Designer.
 *
 * Takes a natural-language requirement, routes it to the best sub-domain
 * (PM-Design OpenUI prototype vs UI-Design .dd document), generates the
 * artifact via the existing MCP tools, and persists it to designs/.
 *
 * Pipeline routing (Batch 9): ctx.judgeViaLlm (flash LLM, injected by
 * SessionManager) decides PM-Design vs UI-Design; the keyword heuristic below
 * remains the fail-open fallback when the LLM is unavailable or returns
 * nothing recognizable. A user-specified pipeline always wins.
 *
 * This is a pure orchestration layer — it calls existing tools, implements
 * no rendering itself.
 */

import type { ActionDefinition, ActionRun } from "./types";

export interface DesignMaterializeInput {
  requirement: string;
  /** Optional pipeline override. "auto" lets the action decide. */
  pipeline?: "auto" | "openui" | "design";
}

export interface DesignMaterializeOutput {
  ok: boolean;
  pipeline?: string;
  reasoning?: string;
  /** null when the artifact reference can't be resolved — the DesignPanel
   *  lists designs/ as the source of truth. */
  artifactId?: string | null;
  error?: string;
}

export const designMaterializeDefinition: ActionDefinition<DesignMaterializeInput> = {
  id: "design.materialize",
  description:
    "Materialize a requirement into a design artifact (prototype or design document). " +
    "Routes to PM-Design (OpenUI prototype) for interactive UI, or UI-Design (.dd) for presentation pages. " +
    "One-click entry: requirement → generate → preview → persisted.",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      requirement: {
        type: "string",
        description: "Natural language requirement description (what to build)",
      },
      pipeline: {
        type: "string",
        enum: ["auto", "openui", "design"],
        description: "Pipeline: auto (let AI decide), openui (PM-Design prototype), design (UI-Design .dd)",
      },
    },
    required: ["requirement"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

/** Simple keyword-based routing heuristic (no LLM needed for the common case). */
function routePipeline(requirement: string): { pipeline: "openui" | "design"; reasoning: string } {
  const text = requirement.toLowerCase();

  const interactive = [
    "form",
    "login",
    "signup",
    "register",
    "kanban",
    "board",
    "dashboard",
    "wizard",
    "step",
    "navigation",
    "filter",
    "search",
    "input",
    "toggle",
    "table",
    "crud",
    "表单",
    "登录",
    "注册",
    "看板",
    "仪表盘",
    "向导",
    "导航",
    "筛选",
    "搜索",
  ];
  const presentational = [
    "landing",
    "page",
    "poster",
    "brand",
    "hero",
    "marketing",
    "portfolio",
    "落地页",
    "海报",
    "品牌",
    "营销",
    "展示",
  ];

  const iScore = interactive.filter((k) => text.includes(k)).length;
  const pScore = presentational.filter((k) => text.includes(k)).length;

  if (iScore > pScore) {
    return {
      pipeline: "openui",
      reasoning: `Interactive signals (${iScore}): forms/navigation/dashboard detected → PM-Design prototype`,
    };
  }
  if (pScore > iScore) {
    return {
      pipeline: "design",
      reasoning: `Presentation signals (${pScore}): landing/brand/hero detected → UI-Design document`,
    };
  }
  // Default: interactive prototype (safer — can show more).
  return { pipeline: "openui", reasoning: "No strong signals — defaulting to PM-Design prototype" };
}

export const designMaterializeRun: ActionRun<DesignMaterializeInput, DesignMaterializeOutput> = async (input, ctx) => {
  const requirement = input?.requirement?.trim();
  if (!requirement) {
    return { ok: false, error: "requirement is required" };
  }

  ctx.emit({ message: "🎯 分析需求…", percent: 10 });

  // Route pipeline: user override > flash LLM judgment > keyword heuristic.
  let route: { pipeline: "openui" | "design"; reasoning: string };
  if (input.pipeline && input.pipeline !== "auto") {
    route = {
      pipeline: input.pipeline as "openui" | "design",
      reasoning: `User-specified pipeline: ${input.pipeline}`,
    };
  } else {
    route = routePipeline(requirement);
    if (ctx.judgeViaLlm) {
      const choice = await ctx.judgeViaLlm(
        "Decide which design sub-domain fits this requirement:\n" +
          `- "openui" (PM-Design): interactive prototypes — forms, kanban, dashboards, wizards, multi-page navigation, anything the user clicks/types into.\n` +
          `- "design" (UI-Design): self-contained presentational documents — landing pages, posters, brand/hero/marketing pages, portfolio pieces.\n` +
          `Mixed requirements: pick by the dominant deliverable.\n\nRequirement: ${requirement}`,
        ["openui", "design"]
      );
      if (choice === "openui" || choice === "design") {
        route = { pipeline: choice, reasoning: `LLM judgment: ${choice} (heuristic said ${route.pipeline})` };
      }
    }
  }

  ctx.emit({ message: `📊 管线路由: ${route.pipeline} — ${route.reasoning}`, percent: 25 });

  // Generate via MCP tools (delegate to the a2ui server's tools).
  const promptForTool =
    route.pipeline === "openui"
      ? `Create an OpenUI Lang prototype for: ${requirement}. Use the design discipline from the taste skill. Call the render_openui tool.`
      : `Create a .dd design document for: ${requirement}. Pick the best design system. Call the render_design tool.`;

  if (!ctx.executeMcpTool) {
    return {
      ok: false,
      error: "executeMcpTool not available — the design MCP server must be connected",
    };
  }

  ctx.emit({ message: `🎨 生成 ${route.pipeline} 产物…`, percent: 50 });

  // Route through the LLM by using runSubagent if available (the agent will
  // call the tool), or return a structured "pending" for the UI to prompt.
  if (ctx.runSubagent) {
    try {
      await ctx.runSubagent({
        skill: route.pipeline === "openui" ? "pm-designer-openui" : "deep-design",
        prompt: promptForTool,
      });
      ctx.emit({ message: "✅ 完成", percent: 100 });
      // Task-tree integration (spec §八 PM-Design = first consumer): when the
      // session is bound to a task branch, the materialized design becomes a
      // step on that branch — requirement changes then read as forks, not reruns.
      try {
        const sessionId = ctx.activeSessionId?.();
        const ref = sessionId ? ctx.getSessionTaskRef?.(sessionId) : undefined;
        if (ref) {
          const svc = ctx.taskTrees?.();
          // Land on the session's BOUND branch — the tree's global active
          // branch may have been moved by another session or a manual switch.
          svc?.switchBranch(ref.treeId, ref.branch);
          svc?.appendStep(ref.treeId, {
            title: `Design materialized: ${requirement.slice(0, 80)}`,
            why: `design.materialize produced a ${route.pipeline} artifact for this branch.`,
          });
        }
      } catch {
        // Best-effort — the materialize result stands without the tree step.
      }
      return {
        ok: true,
        pipeline: route.pipeline,
        reasoning: route.reasoning,
        // runSubagent returns only the last text message — not a stable
        // artifact reference. The DesignPanel lists designs/ as the source
        // of truth instead of guessing an id here.
        artifactId: null,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // No subagent — return guidance for the caller.
  ctx.emit({ message: "⏳ 等待 Agent 执行…", percent: 80 });
  return {
    ok: true,
    pipeline: route.pipeline,
    reasoning: route.reasoning,
    artifactId: undefined,
  };
};
