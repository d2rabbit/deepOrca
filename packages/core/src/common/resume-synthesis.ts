/**
 * Resume-time synthesis of pending tool-call outcomes (dsh P1-1).
 *
 * When a run ends unexpectedly — user interrupt or process crash — the session
 * may be left with a trailing assistant message whose tool calls never produced
 * results. The legacy behavior replayed (re-executed) those calls on resume,
 * which is a correctness hazard: a bash write or network call may have run
 * before the process died, so re-running it doubles the side effect. The new
 * default persists synthesized placeholders instead and teaches the model to
 * retry only idempotent operations.
 *
 * Designed continuation points are NOT synthesized: "paused" sessions (user
 * asked to pause at a checkpoint, batch never dispatched) and
 * "waiting_for_user"/"ask_permission" sessions (permission reply resumes the
 * batch with the approved plan) keep replaying exactly as before.
 */

export type PendingToolCallResumeMode = "replay" | "synthesize";

export const PENDING_TOOL_RESUME_MODE_DEFAULT: PendingToolCallResumeMode = "synthesize";

/**
 * Synthesis applies only to sessions whose previous run ended unexpectedly:
 * - "interrupted": user stop / abort. Interrupts only land at loop checkpoints,
 *   all of which sit before the pending batch is dispatched, so a zero-result
 *   trailing batch is provably not started.
 * - "processing": a stale mid-activation status — by the time resumeSession
 *   runs there is no live controller for the session, meaning the process died
 *   mid-flight; the outcome of any in-flight call is unknown (conservative).
 */
export function shouldSynthesizePendingToolCalls(status: string | undefined, mode: PendingToolCallResumeMode): boolean {
  if (mode !== "synthesize" || !status) {
    return false;
  }
  return status === "interrupted" || status === "processing";
}

export type PendingToolSynthesisKind = "not-started" | "outcome-unknown";

/** Marker prefixes surfaced to the model (and greppable in stored sessions). */
export const TOOL_NOT_STARTED_MARKER = "TOOL_NOT_STARTED";
export const TOOL_OUTCOME_UNKNOWN_MARKER = "TOOL_OUTCOME_UNKNOWN";

export function buildPendingToolSynthesisContent(kind: PendingToolSynthesisKind, toolName: string | null): string {
  const marker = kind === "not-started" ? TOOL_NOT_STARTED_MARKER : TOOL_OUTCOME_UNKNOWN_MARKER;
  const label = toolName ? `${marker}: ${toolName}` : marker;
  const lead =
    kind === "not-started"
      ? "The previous run ended before this tool call was dispatched. It was NOT re-executed."
      : "The previous run may have ended while this tool call was in flight, so its outcome is UNKNOWN. It was NOT re-executed.";
  return [
    label,
    lead,
    "If the operation is read-only or idempotent you may retry it now; otherwise verify the affected state (or ask the user) before retrying.",
  ].join("\n");
}

export function buildPendingToolResumeSystemNote(count: number): string {
  return [
    `<resume-note>${count} pending tool call(s) from the previous run were not re-executed.`,
    "Their results above are synthesized placeholders. Retry only read-only or idempotent operations; for anything else, check the current state first.",
    "</resume-note>",
  ].join(" ");
}
