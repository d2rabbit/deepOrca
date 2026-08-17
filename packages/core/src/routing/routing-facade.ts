/**
 * RoutingFacade — session-scoped routing decision point (plan M1, R3).
 *
 * Owns the "decide once per session, freeze, invalidate explicitly"
 * lifecycle. Previously each activation-loop iteration re-routed tools
 * against the latest assistant message: the tool list changed every turn,
 * which invalidated DeepSeek's prefix cache and could drop tools mid-task.
 * The facade makes that impossible by construction — a session's tool route
 * is computed once and then served byte-identical until invalidate().
 *
 * Depth: callers learn one method and get freezing + G2 selection +
 * telemetry + (via the returned server names) lazy-connect hints. Fail-open:
 * without a tool router or on any error the full tool list is returned —
 * routing is a pure win, never a breakage.
 */

import type { RoutableTool, ToolRouter, TurnContext } from "./types";
import { timedRoutingEvent } from "./telemetry";

export interface ToolRouteRequest {
  sessionId: string;
  context: TurnContext;
  tools: RoutableTool[];
}

export interface ToolRouteDecision {
  /** The tools to inject — a subset, or all of `tools` when routing declined. */
  selected: RoutableTool[];
  /** Server names the decision depends on (lazy-connect hint, R3/M4). */
  serverNames: string[];
  /** True when this call reused the session's frozen decision. */
  frozen: boolean;
}

export class RoutingFacade {
  private readonly toolRouter: ToolRouter | null;
  private readonly frozen = new Map<string, RoutableTool[]>();

  constructor(deps: { toolRouter: ToolRouter | null }) {
    this.toolRouter = deps.toolRouter;
  }

  /** Decide (or reuse) a session's tool route. Never throws. */
  async decideToolRoute(request: ToolRouteRequest): Promise<ToolRouteDecision> {
    const cached = this.frozen.get(request.sessionId);
    if (cached) {
      return { selected: cached, serverNames: collectServerNames(cached), frozen: true };
    }

    let selected: RoutableTool[] = request.tools;
    if (this.toolRouter) {
      selected = await timedRoutingEvent(
        "G2",
        () => this.toolRouter!.select(request.context, request.tools),
        (result) => (result ? "hit" : "skip"),
        { sessionId: request.sessionId, counts: { tools: request.tools.length } }
      ).then((result) => result ?? request.tools);
    }

    this.frozen.set(request.sessionId, selected);
    return { selected, serverNames: collectServerNames(selected), frozen: false };
  }

  /** Drop one session's frozen route (session deleted). */
  invalidate(sessionId: string): void {
    this.frozen.delete(sessionId);
  }

  /** Drop every frozen route (tool inventory changed, manager disposed). */
  invalidateAll(): void {
    this.frozen.clear();
  }

  /** Number of sessions with a frozen route (diagnostics/tests). */
  get frozenCount(): number {
    return this.frozen.size;
  }
}

function collectServerNames(tools: RoutableTool[]): string[] {
  const names = new Set<string>();
  for (const tool of tools) {
    if (tool.serverName) names.add(tool.serverName);
  }
  return [...names];
}
