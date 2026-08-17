/**
 * Before-tool-execution gate (dsh P1-4, minimal slice).
 *
 * A small synchronous listener registry wrapped around the permission check at
 * the activation-loop's execution point. The permission check is the FIRST
 * built-in listener; future listeners (loop guards, declared tool timeouts,
 * host hooks) can veto or escalate without touching the loop itself.
 *
 * Scope guardrails:
 * - Runs at the EXECUTION layer, strictly after routing — it never influences
 *   which tools/skills the router selected, only whether the already-selected
 *   calls may run (the router stays the single authority for selection).
 * - Synchronous and cheap: listeners must not do I/O; anything slower belongs
 *   in the permission flow itself, not here.
 *
 * Verdict precedence across deciding listeners: deny > ask > allow. The first
 * decision at the winning level wins. The payload (the permission plan) of the
 * winning decision is used by the loop; when the winner carries no payload
 * (e.g. a pure veto listener), the payload of the first decisive listener that
 * had one is used — in practice always the built-in permission listener, so
 * the loop never loses the permission plan.
 */

export type ToolExecutionVerdict = "allow" | "ask" | "deny";

export type ToolExecutionGateDecision<P> = {
  verdict: ToolExecutionVerdict;
  /** The permission plan (or future equivalent) the loop should consume. */
  payload?: P;
  /** Identifies the deciding listener (for audit/debug surfaces). */
  source: string;
};

export type ToolExecutionGateContext = {
  sessionId: string;
  toolCalls: unknown[];
};

export type ToolExecutionGateListener<P> = (context: ToolExecutionGateContext) => ToolExecutionGateDecision<P> | null;

const VERDICT_PRECEDENCE: Record<ToolExecutionVerdict, number> = { deny: 2, ask: 1, allow: 0 };

export class ToolExecutionGate<P> {
  private readonly listeners: Array<{ name: string; listener: ToolExecutionGateListener<P> }> = [];

  /**
   * Register a listener. Listeners run in registration order; the built-in
   * permission listener is expected to be registered first. Returns an
   * unregister function.
   */
  register(name: string, listener: ToolExecutionGateListener<P>): () => void {
    const entry = { name, listener };
    this.listeners.push(entry);
    let unregistered = false;
    return () => {
      if (unregistered) {
        return;
      }
      unregistered = true;
      const index = this.listeners.indexOf(entry);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Run all listeners and resolve the winning decision (deny > ask > allow;
   * first at the winning level). Returns null when every listener abstained.
   */
  decide(context: ToolExecutionGateContext): ToolExecutionGateDecision<P> | null {
    let winner: ToolExecutionGateDecision<P> | null = null;
    let fallbackPayload: { payload: P } | null = null;
    for (const { listener } of this.listeners) {
      const decision = listener(context);
      if (!decision) {
        continue;
      }
      if (fallbackPayload === null && decision.payload !== undefined) {
        fallbackPayload = { payload: decision.payload };
      }
      if (winner === null || VERDICT_PRECEDENCE[decision.verdict] > VERDICT_PRECEDENCE[winner.verdict]) {
        winner = decision;
      }
    }
    if (winner === null) {
      return null;
    }
    if (winner.payload === undefined && fallbackPayload !== null) {
      return { ...winner, payload: fallbackPayload.payload };
    }
    return winner;
  }
}
