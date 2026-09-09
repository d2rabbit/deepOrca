/**
 * design.clock tool (WP2.6 / engine patch A-1) — the countdown source for
 * prototypes: wall-clock derived remaining/elapsed/clock, the pattern that
 * makes pomodoro-style timers actually run (Query refreshInterval=1 re-fetches
 * every second; no lang-core primitives needed).
 *
 * tool-provider imports the window-bound api at module load, so the DOM stub
 * installs BEFORE the dynamic import (same pattern as prototype-play-mode).
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { installDom, type DomHandle } from "./dom-harness";
import type { createDesignerToolProvider as CreateProvider } from "../renderer/openui/tool-provider";

let dom: DomHandle;
let createDesignerToolProvider: typeof CreateProvider;

before(async () => {
  dom = installDom();
  ({ createDesignerToolProvider } = await import("../renderer/openui/tool-provider"));
});

after(() => {
  dom.cleanup();
});

test("design.clock computes remaining from a wall-clock start", async () => {
  const provider = createDesignerToolProvider();
  const total = 1500;
  const startAt = Date.now() - 65_000; // 65s elapsed
  const result = (await provider["design.clock"]({ startAt, total })) as {
    remaining: number;
    elapsed: number;
    clock: string;
    finished: boolean;
  };
  assert.equal(result.elapsed, 65);
  assert.equal(result.remaining, 1435);
  assert.equal(result.clock, "23:55");
  assert.equal(result.finished, false);
});

test("design.clock clamps at zero and formats MM:SS", async () => {
  const provider = createDesignerToolProvider();
  const result = (await provider["design.clock"]({ startAt: Date.now() - 999_000, total: 5 })) as {
    remaining: number;
    clock: string;
    finished: boolean;
  };
  assert.equal(result.remaining, 0);
  assert.equal(result.clock, "0:00");
  assert.equal(result.finished, true);
});

test("design.clock rejects missing args", async () => {
  const provider = createDesignerToolProvider();
  const result = (await provider["design.clock"]({ total: 10 })) as { error: string };
  assert.match(result.error, /startAt/);
});
