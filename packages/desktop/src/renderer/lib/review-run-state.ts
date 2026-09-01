/**
 * Review-run state that SURVIVES panel unmounts (user report 2026-09-01):
 * `review.full` is a global background action — switching sidebar items or
 * workspaces remounts CodeReviewPanel and its component-local `running`
 * state reset to false, so a run that was still going (the bottom-right
 * task badge kept spinning) showed as 未审查 with no progress when the user
 * came back. The store is module-level: it lives as long as the renderer,
 * independent of any component lifecycle.
 *
 * Scope note: only PANEL-initiated runs are tracked (the panel knows the
 * root it fired for). Chat-initiated reviews aren't visible here — the
 * bottom-right task badge remains their indicator.
 */

const runningRoots = new Set<string>();

/** Last progress line + percent per root — restored on remount so the row
 *  shows its status immediately instead of waiting for the next heartbeat
 *  (CRG builds emit one only every 20s; user report 2026-09-01: the row came
 *  back BLANK after a sidebar switch and stayed blank that long). */
const progressTexts = new Map<string, string>();
const progressPercents = new Map<string, number>();

export function markReviewRunning(root: string): void {
  runningRoots.add(root);
}

/** Record one progress event. Events WITHOUT a percent (heartbeats, model
 *  chatter) keep the last known percent — the bar must never go backwards. */
export function markReviewProgress(root: string, text: string, percent?: number): void {
  progressTexts.set(root, text);
  if (percent != null && Number.isFinite(percent)) progressPercents.set(root, percent);
}

export function getReviewProgress(root: string): string {
  return progressTexts.get(root) ?? "";
}

export function getReviewPercent(root: string): number | null {
  const v = progressPercents.get(root);
  return v == null ? null : v;
}

export function markReviewSettled(root: string): void {
  runningRoots.delete(root);
  progressTexts.delete(root);
  progressPercents.delete(root);
}

export function isReviewRunning(root: string): boolean {
  return runningRoots.has(root);
}
