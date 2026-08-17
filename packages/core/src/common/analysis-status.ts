/**
 * Per-call degradation status for analysis-layer actions.
 *
 * Fail-open is the house philosophy (routers fall back to null, extractors
 * isolate their failures) — but fail-open output that does not SAY it is
 * degraded is invisible to the model, which then trusts a degraded answer as
 * a full one. This module gives analysis actions a shared vocabulary to put
 * their own degradation state INTO the result payload, so every call is
 * self-describing and the model never needs a side-channel status probe.
 *
 * Inspired by the three-state fallback chains of external LSP tool servers
 * (active → degraded → unavailable, stated in the tool output itself);
 * ported as a pattern, no dependency.
 */

/** Tri-state health of the backend an analysis action depends on. */
export type BackendStatus = "active" | "degraded" | "unavailable";

export interface BackendStatusReport {
  readonly status: BackendStatus;
  /** Which backend this describes, e.g. "codegraph", "crg", "ocr", "subagent". */
  readonly backend: string;
  /** One human sentence describing the current state. */
  readonly detail: string;
  /** How to get back to active, when known. */
  readonly remedy?: string;
}

/**
 * Render a report as the one-line, model-readable form embedded in action
 * output: `status: degraded (crg) — detail — remedy: …`.
 */
export function describeBackendStatus(report: BackendStatusReport): string {
  const head = `status: ${report.status} (${report.backend}) — ${report.detail}`;
  return report.remedy ? `${head} — remedy: ${report.remedy}` : head;
}

/**
 * Render the full per-call status block appended to an action's text output:
 * a one-line describe + a standing instruction so the model knows what the
 * states mean without loading any documentation.
 */
export function formatBackendStatusBlock(report: BackendStatusReport): string {
  return [
    describeBackendStatus(report),
    "(active: full analysis available · degraded: partial result above, treat gaps as unknown · unavailable: no analysis, do not guess)",
  ].join("\n");
}
