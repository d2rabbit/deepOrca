/**
 * RoutingTelemetry — structured observability for the routing pipeline.
 *
 * Every routing stage (G1 recall, G2 tool gating, G3 compositional routing,
 * SAD decomposition, embedding lifecycle) reports hit / fallback / skip with
 * latency and counts. Routing is fail-open by design — it fails SILENTLY by
 * design too, which is exactly how the "routing never actually ran" bug
 * stayed invisible for months. These events make silent degradation visible
 * on the same host logger the embedding loader already uses
 * (configureRoutingLogger wires both sinks).
 */

export type RoutingStage = "embedding" | "G1" | "G2" | "G3" | "SAD" | "server";
export type RoutingOutcome = "hit" | "fallback" | "skip";

export interface RoutingEvent {
  stage: RoutingStage;
  outcome: RoutingOutcome;
  latencyMs?: number;
  counts?: Record<string, number>;
  sessionId?: string;
  detail?: string;
}

type RoutingEventSink = (event: RoutingEvent) => void;

let sink: RoutingEventSink | null = null;

/** Host injection point (called by configureRoutingLogger — one wire, two sinks). */
export function setRoutingEventSink(next: RoutingEventSink | null): void {
  sink = next;
}

/** Emit a routing event. Never throws — observability must not break routing. */
export function logRoutingEvent(event: RoutingEvent): void {
  try {
    sink?.(event);
  } catch {
    // A broken sink must never propagate into the routing path.
  }
}

/** Time a routing stage and report the outcome in one expression. */
export async function timedRoutingEvent<T>(
  stage: RoutingStage,
  run: () => Promise<T> | T,
  classify: (result: T) => RoutingOutcome,
  extra?: Omit<RoutingEvent, "stage" | "outcome" | "latencyMs">
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    logRoutingEvent({
      stage,
      outcome: classify(result),
      latencyMs: Date.now() - startedAt,
      ...extra,
    });
    return result;
  } catch (error) {
    logRoutingEvent({
      stage,
      outcome: "fallback",
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
      ...extra,
    });
    throw error;
  }
}
