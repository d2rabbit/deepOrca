/**
 * Canvas commit scheduler (specs/leafer-ui-engine WP1.4 + 评审修复批) — owns
 * the debounce → serialize → commit pipeline for LeaferPreview.
 *
 * Persistence contract with `commit`: resolve `true` = persisted, `false` =
 * refused (busy gate, head-moved, IPC failure). A refused snapshot is NEVER
 * recorded as committed — the scheduler retries it while the canvas stays
 * editable, so an edit made while a design action runs can no longer be
 * silently dropped. (The pre-fix bug: `lastCommitted` was written BEFORE the
 * append settled, so a busy-refused edit was both dropped AND marked done —
 * an identical retry became a permanent no-op.)
 *
 * The retry budget is bounded and self-terminating: it resets on every fresh
 * user edit, stops on success, on `cancelRetry()` (an authoritative re-import
 * superseded the edit), when the canvas turns read-only, or after
 * MAX_COMMIT_RETRIES consecutive refused rounds.
 */

/** Consecutive refused rounds retried before giving up on one snapshot. */
const MAX_COMMIT_RETRIES = 5;

export interface LeaferCommitSchedulerOptions {
  /** Serialize the current canvas tree; null = serialization failed. */
  serialize: () => string | null;
  /** Persist one snapshot. Must resolve `true` (persisted) or `false` (refused). */
  commit: (json: string) => Promise<boolean> | boolean;
  debounceMs: number;
  /** Trailing re-commit right after a successful append settles. */
  trailingMs: number;
  /** Delay between retries of a refused snapshot. */
  retryMs: number;
  /** Refusals are retried only while the canvas can still write. */
  canRetry: () => boolean;
}

export interface LeaferCommitScheduler {
  /** Debounced commit request — every canvas edit reschedules it. */
  requestCommit(): void;
  /** An authoritative re-import landed — drop any pending retry. */
  cancelRetry(): void;
  dispose(): void;
}

export function createLeaferCommitScheduler(options: LeaferCommitSchedulerOptions): LeaferCommitScheduler {
  let debounceTimer: number | null = null;
  let retryTimer: number | null = null;
  // Commit serialization: at most ONE in-flight commit; edits arriving
  // meanwhile set `pending` and fire a trailing commit afterwards.
  let committing = false;
  let pending = false;
  let retries = 0;
  // Only a CONFIRMED persistence is recorded here — a refused snapshot must
  // stay eligible for the retry (and for a later identical re-serialization).
  let lastPersisted: string | null = null;

  const clearTimers = (): void => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const scheduleRetry = (): void => {
    if (retryTimer !== null || !options.canRetry()) return;
    retries += 1;
    if (retries > MAX_COMMIT_RETRIES) return;
    retryTimer = window.setTimeout(fireCommit, options.retryMs);
  };

  const fireCommit = (): void => {
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (committing) {
      pending = true;
      return;
    }
    const next = options.serialize();
    if (!next || next === lastPersisted) return;
    committing = true;
    void Promise.resolve(options.commit(next))
      .then((persisted) => {
        if (persisted === true) {
          lastPersisted = next;
          retries = 0;
          const trailing = pending;
          pending = false;
          if (trailing && options.canRetry()) {
            debounceTimer = window.setTimeout(fireCommit, options.trailingMs);
          }
        } else {
          // Refused: the snapshot was NOT persisted — retry it instead of
          // silently dropping the edit. A pending edit folds into the retry.
          pending = false;
          scheduleRetry();
        }
      })
      .catch(() => {
        pending = false;
        scheduleRetry();
      })
      .finally(() => {
        committing = false;
      });
  };

  return {
    requestCommit(): void {
      // A fresh user edit grants a new retry budget for its snapshot.
      retries = 0;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(fireCommit, options.debounceMs);
    },
    cancelRetry(): void {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    },
    dispose(): void {
      clearTimers();
    },
  };
}
