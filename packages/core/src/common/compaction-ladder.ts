/**
 * Compaction policy ladder (specs/model-vendor-profiles P1.1/P1.2 — the
 * three-tier threshold + output-reserve-from-denominator + rapid-refill
 * circuit breaker).
 *
 * Zero-dependency (pure functions + exported constants) so both the session
 * manager (main process) and tests consume it directly.
 *
 * Convergence evidence (round-2 vendor research):
 * - qwen `computeThresholds`: auto = min(0.85×W, (W−SUMMARY_RESERVE)−BUFFER)
 * - deepseek: floor(min(W×0.8, W−O−65536)) — output reserve subtracted from
 *   the denominator BEFORE any ratio is applied
 * - ZCode: rapid-refill circuit breaker (3 tool-turns back at threshold ×3
 *   consecutive compactions → stop + tell the model to read in smaller
 *   chunks); outputReserve deducted because "provider 的 context window 是
 *   input+output 共享窗口"
 * - C32 (user 2026-09-22): the new generation is uniformly 1M — without the
 *   reserve subtraction the pre-flight trigger would sit near ~900K, paying
 *   an order of magnitude more input cost per turn before compaction.
 */

/** Ladder ratios as fractions of the effective (reserve-deducted) window. */
export const COMPACTION_WARN_RATIO = 0.75;
export const COMPACTION_AUTO_RATIO = 0.85;
export const COMPACTION_HARD_RATIO = 0.95;

/**
 * Tokens reserved for the summarization side-query's own OUTPUT (qwen
 * SUMMARY_RESERVE=20_000 / deepseek headroom 65_536 eras). Subtracted from
 * the window denominator before any ratio is applied (ZCode: "否则请求预算
 * 和压缩窗口按两套常量计算").
 */
export const COMPACTION_OUTPUT_RESERVE_TOKENS = 20_000;

/**
 * Extra buffer between auto and hard (qwen AUTOCOMPACT_BUFFER=13_000):
 * headroom for the compaction round-trip plus a few user turns.
 */
export const COMPACTION_AUTO_BUFFER_TOKENS = 13_000;

/** Rapid-refill breaker (ZCode turn-loop-state): tool-turns watched after a compaction. */
export const RAPID_REFILL_TOOL_TURN_WINDOW = 3;
/** Rapid-refill breaker: consecutive compactions that each refilled within the window. */
export const RAPID_REFILL_MAX_CONSECUTIVE = 3;

export type CompactionLadder = {
  /** UI heads-up tier (progress meter color, no action). */
  warn: number;
  /** Pre-flight auto-compaction trigger (today's PRE_COMPACT_RATIO semantics, reserve-deducted). */
  auto: number;
  /** Last-ditch tier — force compaction even mid-turn (recovery path floor). */
  hard: number;
  /** The reserve-deducted denominator the ratios were applied to. */
  effectiveWindow: number;
};

/**
 * Compute the three-tier ladder for one model's context window.
 *
 * effective = window − outputReserve; auto = min(autoRatio×effective,
 * effective − autoBuffer) — the absolute term is a CEILING (qwen): compact
 * before the prompt leaves too little room for the summary side-query's own
 * output. Degenerate small windows (effective ≤ 0) fall back to the raw
 * proportional value so the trigger stays usable.
 */
export function computeCompactionLadder(windowTokens: number): CompactionLadder {
  const window = Number.isFinite(windowTokens) && windowTokens > 0 ? windowTokens : 0;
  const effectiveWindow = Math.max(0, window - COMPACTION_OUTPUT_RESERVE_TOKENS);
  const proportional = COMPACTION_AUTO_RATIO * effectiveWindow;
  const absoluteCeiling = effectiveWindow - COMPACTION_AUTO_BUFFER_TOKENS;
  const auto = absoluteCeiling > 0 ? Math.min(proportional, absoluteCeiling) : proportional;
  const warn = Math.max(0, Math.floor(auto * (COMPACTION_WARN_RATIO / COMPACTION_AUTO_RATIO)));
  const hardEdge = effectiveWindow * COMPACTION_HARD_RATIO;
  const hard = Math.min(window, Math.max(hardEdge, auto + 1));
  return { warn: Math.floor(warn), auto: Math.floor(auto), hard: Math.floor(hard), effectiveWindow };
}

// ── Rapid-refill circuit breaker ────────────────────────────────────────────

export type RapidRefillState = {
  /** Compactions in the current consecutive-refill streak. */
  consecutiveRefills: number;
  /** Tool-turn counter since the last compaction (reset per compaction). */
  toolTurnsSinceCompaction: number;
};

export const RAPID_REFILL_INITIAL: RapidRefillState = {
  consecutiveRefills: 0,
  toolTurnsSinceCompaction: 0,
};

export type RapidRefillSignal =
  | { kind: "none" }
  | { kind: "compacted"; state: RapidRefillState }
  | { kind: "tool-turn"; state: RapidRefillState }
  | { kind: "tripped"; state: RapidRefillState; message: string };

export const RAPID_REFILL_TRIP_MESSAGE =
  "A file or tool output may be too large for automatic compaction to keep up. " +
  "Read it in smaller chunks (offset/limit), or start a new session.";

/**
 * Advance the breaker: call `observeCompaction` when a compaction applies and
 * `observeToolTurn` once per turn that executed at least one tool call. A
 * refill is "rapid" when the threshold is reached again within
 * RAPID_REFILL_TOOL_TURN_WINDOW tool turns of the previous compaction.
 * Tripping is terminal for the streak (caller surfaces the message and stops
 * auto-compacting this session — ZCode semantics: deterministic doom-loop,
 * one clean failure beats two more doomed round-trips).
 */
export function observeCompaction(state: RapidRefillState): RapidRefillSignal {
  const refilledFast =
    state.toolTurnsSinceCompaction > 0 && state.toolTurnsSinceCompaction <= RAPID_REFILL_TOOL_TURN_WINDOW;
  const consecutiveRefills = refilledFast ? state.consecutiveRefills + 1 : 1;
  const next: RapidRefillState = { consecutiveRefills, toolTurnsSinceCompaction: 0 };
  if (next.consecutiveRefills >= RAPID_REFILL_MAX_CONSECUTIVE) {
    return { kind: "tripped", state: next, message: RAPID_REFILL_TRIP_MESSAGE };
  }
  return { kind: "compacted", state: next };
}

export function observeToolTurn(state: RapidRefillState): RapidRefillSignal {
  return {
    kind: "tool-turn",
    state: { ...state, toolTurnsSinceCompaction: state.toolTurnsSinceCompaction + 1 },
  };
}

/** A slow refill (many turns after the compaction) defuses the streak. */
export function defuseRapidRefill(state: RapidRefillState): RapidRefillState {
  return { consecutiveRefills: 0, toolTurnsSinceCompaction: state.toolTurnsSinceCompaction };
}
