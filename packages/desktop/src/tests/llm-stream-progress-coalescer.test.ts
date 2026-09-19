/**
 * Tests for the LLM stream-progress IPC coalescer (full-domain audit round-2):
 * per-delta token snapshots crossed main→renderer once per DELTA — hundreds
 * of serialized IPC messages per second during fast streams — while the
 * payload is an idempotent snapshot and the renderer already coalesces its
 * own setState at 250ms. These tests pin the message-volume contract with an
 * injected clock (no real-timer flakiness).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LLM_STREAM_PROGRESS_WINDOW_MS,
  LlmStreamProgressCoalescer,
} from "../main/llm-stream-progress-coalescer.js";
import type { LlmStreamProgress } from "@deeporca/core";

function update(requestId: string, estimatedTokens: number): LlmStreamProgress {
  return {
    requestId,
    sessionId: "s1",
    startedAt: "2026-09-20T00:00:00.000Z",
    estimatedTokens,
    formattedTokens: String(estimatedTokens),
    phase: "update",
  };
}

function terminal(requestId: string, phase: "start" | "end"): LlmStreamProgress {
  return { ...update(requestId, 0), phase };
}

test("a burst of deltas within one window forwards exactly ONE update", () => {
  let clock = 1_000;
  const coalescer = new LlmStreamProgressCoalescer(45, () => clock);
  let forwarded = 0;
  for (let i = 1; i <= 100; i += 1) {
    if (coalescer.accept(update("r1", i))) forwarded += 1;
  }
  assert.equal(forwarded, 1, "100 same-instant deltas must collapse to 1 IPC");
  // The forwarded snapshot is the FIRST of the window — and the LAST update
  // before "end" is superseded by the terminal event anyway (renderer clears
  // on end), so no data the UI displays is lost.
  clock += 46;
  assert.equal(coalescer.accept(update("r1", 101)), true, "next window forwards");
});

test("a simulated fast stream keeps IPC bounded: 1000 deltas over 10 windows → ≤ 11 forwards", () => {
  let clock = 0;
  const windowMs = 45;
  const coalescer = new LlmStreamProgressCoalescer(windowMs, () => clock);
  let forwarded = 0;
  // 1000 deltas, 100 per window (delta every 0.45ms of window time).
  for (let delta = 0; delta < 1000; delta += 1) {
    clock = Math.floor(delta / 100) * windowMs + (delta % 100) * 0.45;
    if (coalescer.accept(update("r1", delta))) forwarded += 1;
  }
  assert.ok(forwarded <= 11, `forwarded=${forwarded} must be ≤ windows+1`);
  assert.ok(forwarded >= 10, `forwarded=${forwarded} should track windows`);
});

test("start and end always pass through immediately, even inside a window", () => {
  const clock = 1_000;
  const coalescer = new LlmStreamProgressCoalescer(45, () => clock);
  assert.equal(coalescer.accept(update("r1", 5)), true, "first update forwards");
  assert.equal(coalescer.accept(update("r1", 6)), false, "second update in window suppressed");
  assert.equal(coalescer.accept(terminal("r1", "start")), true, "start is never suppressed");
  assert.equal(coalescer.accept(terminal("r1", "end")), true, "end is never suppressed");
});

test("end forgets the request — a reused id starts unthrottled", () => {
  const clock = 1_000;
  const coalescer = new LlmStreamProgressCoalescer(45, () => clock);
  coalescer.accept(update("r1", 5));
  assert.equal(coalescer.accept(update("r1", 6)), false);
  coalescer.accept(terminal("r1", "end"));
  assert.equal(coalescer.accept(update("r1", 7)), true, "post-end update forwards immediately");
});

test("request ids throttle independently", () => {
  const clock = 1_000;
  const coalescer = new LlmStreamProgressCoalescer(45, () => clock);
  assert.equal(coalescer.accept(update("r1", 1)), true);
  assert.equal(coalescer.accept(update("r2", 1)), true, "different request, own window");
  assert.equal(coalescer.accept(update("r1", 2)), false);
  assert.equal(coalescer.accept(update("r2", 2)), false);
});

test("clear() resets all state (bridge root switch)", () => {
  const clock = 1_000;
  const coalescer = new LlmStreamProgressCoalescer(45, () => clock);
  coalescer.accept(update("r1", 5));
  coalescer.clear();
  assert.equal(coalescer.accept(update("r1", 6)), true, "after clear the window restarts");
});

test("default window is the documented 45ms", () => {
  assert.equal(DEFAULT_LLM_STREAM_PROGRESS_WINDOW_MS, 45);
});
