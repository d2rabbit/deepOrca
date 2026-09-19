/**
 * Tests for the withReviewReportSurface execute wrapper — the registered-root
 * enforcement point for root-taking ACTIONS (full-domain audit 2026-09):
 * the guard used to fire only for `review.full`, leaving `index.build-all`
 * (which spawns git/wiki CLIs under input.root) runnable against ANY
 * renderer-supplied absolute path — the AGENTS.md workspace-root pinning
 * invariant violation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { ActionError, ActionRegistry, RunHandle } from "@deeporca/core";

import { withReviewReportSurface } from "../main/review-report-surface.js";

type Executed = { id: string; input: unknown };

function makeRegistry(): { registry: ActionRegistry; wrapped: ActionRegistry; executed: Executed[] } {
  const executed: Executed[] = [];
  const registry = {
    execute: <T>(_id: string, input?: unknown): RunHandle<T> => {
      executed.push({ id: _id, input });
      return {
        result: Promise.resolve({ ok: true } as unknown as T),
        onProgress: () => () => {},
        cancel: () => {},
      };
    },
  } as unknown as ActionRegistry;
  // withReviewReportSurface returns ActionRegistry | null (null for a null
  // registry) — the test registry is always non-null, so assert it once.
  const wrapped = withReviewReportSurface(registry, DEPS) as ActionRegistry;
  return { registry, wrapped, executed };
}

const DEPS = {
  getActiveRoot: () => "/registered/ws",
  isKnownRoot: (root: string) => root === "/registered/ws",
  getLocale: () => "en",
};

async function rejectionOf(promise: Promise<unknown>): Promise<ActionError | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error as ActionError;
  }
}

test("an unregistered input.root is refused for ANY root-taking action, not just review.full", async () => {
  const { executed, wrapped } = makeRegistry();
  const handle = wrapped.execute("index.build-all", { root: "/Users/x/.ssh" });
  const error = await rejectionOf(handle.result);
  assert.ok(error, "must reject");
  assert.match(error.message, /unknown workspace/);
  assert.deepEqual(executed, [], "registry.execute must never be reached");
});

test("a REGISTERED input.root passes through to the action", async () => {
  const { executed, wrapped } = makeRegistry();
  const handle = wrapped.execute("index.build-all", { root: "/registered/ws" });
  const result = (await handle.result) as { ok: boolean };
  assert.equal(result.ok, true);
  assert.deepEqual(executed, [{ id: "index.build-all", input: { root: "/registered/ws" } }]);
});

test("an action with no input.root is untouched by the guard", async () => {
  const { executed, wrapped } = makeRegistry();
  await wrapped.execute("some.other.action", { focus: "specs" }).result;
  assert.deepEqual(executed, [{ id: "some.other.action", input: { focus: "specs" } }]);
});

test("review.full still refuses an unregistered root (original guard intact)", async () => {
  const { executed, wrapped } = makeRegistry();
  const error = await rejectionOf(wrapped.execute("review.full", { root: "/unregistered/x" }).result);
  assert.ok(error, "must reject");
  assert.match(error.message, /unknown workspace/);
  assert.deepEqual(executed, []);
});
