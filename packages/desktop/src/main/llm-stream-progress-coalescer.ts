/**
 * LLM stream-progress IPC coalescer (full-domain audit round-2).
 *
 * `onLlmStreamProgress` fires once per streamed content/reasoning delta —
 * fast streams produced hundreds of main→renderer IPC messages per second,
 * each a fully-serialized event whose payload is an IDEMPOTENT TOKEN SNAPSHOT
 * (`estimatedTokens`/`formattedTokens`, never content). The renderer already
 * coalesces its own setState at 250ms (App.tsx), but the IPC traffic and the
 * per-event renderer callback still paid full price.
 *
 * Drop-only time window per `requestId`: at most one "update" crosses the
 * bridge per window. No trailing flush is needed — more deltas keep arriving
 * (so the display stays fresh within ~2 windows), and every request ends with
 * a terminal event that passes through immediately (the renderer clears the
 * indicator on "end", it does not display the final count). "start"/"end"
 * always pass through and reset the request's state.
 */

import type { LlmStreamProgress } from "@deeporca/core";

/** 45ms → ≤ ~22 forwarded updates/sec/request; renderer refreshes at 250ms. */
export const DEFAULT_LLM_STREAM_PROGRESS_WINDOW_MS = 45;

export class LlmStreamProgressCoalescer {
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly lastForwardedAt = new Map<string, number>();

  constructor(windowMs: number = DEFAULT_LLM_STREAM_PROGRESS_WINDOW_MS, now: () => number = () => Date.now()) {
    this.windowMs = windowMs;
    this.now = now;
  }

  /**
   * Decide whether an event crosses the bridge. Non-"update" phases always
   * do; "end" additionally forgets the request (a future request reusing the
   * id starts unthrottled).
   */
  accept(event: LlmStreamProgress): boolean {
    if (event.phase !== "update") {
      if (event.phase === "end") {
        this.lastForwardedAt.delete(event.requestId);
      }
      return true;
    }
    const at = this.now();
    const last = this.lastForwardedAt.get(event.requestId);
    if (last !== undefined && at - last < this.windowMs) {
      return false;
    }
    this.lastForwardedAt.set(event.requestId, at);
    return true;
  }

  /** Drop all per-request state (bridge root switch / teardown). */
  clear(): void {
    this.lastForwardedAt.clear();
  }
}
