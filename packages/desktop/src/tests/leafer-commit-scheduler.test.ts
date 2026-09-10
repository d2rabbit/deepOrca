/**
 * LeaferPreview commit scheduler (specs/leafer-ui-engine WP1.4 + 评审修复批)
 * — the canvas edit → persist pipeline as a pure state machine: debounce
 * collapse, commit-confirmed-only dedup, refused-snapshot retry, in-flight
 * trailing commit, bounded self-terminating retry budget.
 *
 * Regression anchor (评审): the pre-fix fireCommit recorded `lastCommitted`
 * BEFORE the append settled, so an edit made while a design action ran was
 * silently dropped AND marked done — an identical retry became a permanent
 * no-op. The refused-snapshot test below fails under that behavior.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { installDom, type DomHandle } from "./dom-harness";

import {
  createLeaferCommitScheduler,
  type LeaferCommitSchedulerOptions,
} from "../renderer/components/design-workspace/leafer-commit-scheduler";

let dom: DomHandle;

before(() => {
  // The scheduler targets the renderer, so it schedules through `window` —
  // provide the jsdom global for plain-Node test execution.
  dom = installDom();
});

after(() => {
  dom.cleanup();
});

const DEBOUNCE_MS = 10;
const TRAILING_MS = 10;
const RETRY_MS = 15;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type Harness = { options: LeaferCommitSchedulerOptions; calls: string[]; verdicts: boolean[] };

function harness(serialize: () => string | null, canRetry: () => boolean = () => true): Harness {
  const calls: string[] = [];
  const verdicts: boolean[] = [];
  return {
    calls,
    verdicts,
    options: {
      serialize,
      commit: (json) => {
        calls.push(json);
        return verdicts.shift() ?? false;
      },
      debounceMs: DEBOUNCE_MS,
      trailingMs: TRAILING_MS,
      retryMs: RETRY_MS,
      canRetry,
    },
  };
}

test("debounced edits collapse into one commit with the latest serialization", async () => {
  const h = harness(() => '{"v":1}');
  const scheduler = createLeaferCommitScheduler(h.options);
  h.verdicts.push(true);
  scheduler.requestCommit();
  scheduler.requestCommit();
  scheduler.requestCommit();
  await sleep(60);
  assert.equal(h.calls.length, 1, "rapid requests must debounce into a single commit");
  scheduler.dispose();
});

test("a refused snapshot is retried until persisted — never dropped and never marked committed early", async () => {
  // The regression: serialize is CONSTANT, so under the pre-fix behavior the
  // first refusal pre-registered the snapshot and the retry became a no-op
  // (calls.length would stay 1).
  const SNAPSHOT = '{"v":1,"edit":"during-action"}';
  const h = harness(() => SNAPSHOT);
  const scheduler = createLeaferCommitScheduler(h.options);
  h.verdicts.push(false, false, true); // refuse twice, then persist
  scheduler.requestCommit();
  await sleep(70);
  assert.ok(h.calls.length >= 2, `the refused snapshot must be retried, not silently dropped (got ${h.calls.length})`);
  assert.ok(
    h.calls.every((call) => call === SNAPSHOT),
    "every retry re-persists the same refused snapshot"
  );
  // Success settles the schedule — no more retries afterwards.
  const settled = h.calls.length;
  await sleep(50);
  assert.equal(h.calls.length, settled, "no retries once the snapshot persisted");
  scheduler.dispose();
});

test("a persisted snapshot is deduplicated — an unchanged tree does not re-commit", async () => {
  const h = harness(() => '{"v":1}');
  const scheduler = createLeaferCommitScheduler(h.options);
  h.verdicts.push(true);
  scheduler.requestCommit();
  await sleep(50);
  assert.equal(h.calls.length, 1);
  scheduler.requestCommit(); // no edit happened — serialization unchanged
  await sleep(50);
  assert.equal(h.calls.length, 1, "identical serialization after success must be skipped");
  scheduler.dispose();
});

test("edits during an in-flight commit hold a trailing re-commit", async () => {
  // The tree keeps changing: version N serializes as {"v":N}, so the trailing
  // re-commit after the in-flight append settles carries NEW content.
  let version = 0;
  const calls: string[] = [];
  const resolvers: Array<(value: boolean) => void> = [];
  const scheduler = createLeaferCommitScheduler({
    serialize: () => `{"v":${version}}`,
    commit: (json) => {
      calls.push(json);
      return new Promise<boolean>((resolve) => resolvers.push(resolve));
    },
    debounceMs: DEBOUNCE_MS,
    trailingMs: TRAILING_MS,
    retryMs: RETRY_MS,
    canRetry: () => true,
  });
  scheduler.requestCommit();
  await sleep(40); // first commit in flight ({"v":0})
  assert.equal(calls.length, 1);
  scheduler.requestCommit(); // edit lands while the append is running
  version = 1; // …and the tree actually changed underneath it
  resolvers[0]?.(true);
  await sleep(60); // trailing re-commit fires right after the append settles
  assert.equal(calls.length, 2, "the pending edit must trailing-commit after the in-flight one settles");
  assert.equal(calls[1], '{"v":1}', "the trailing commit serializes the CURRENT tree, not the stale one");
  scheduler.dispose();
});

test("cancelRetry stops a pending retry (authoritative re-import supersedes the edit)", async () => {
  const h = harness(() => '{"v":1}');
  const scheduler = createLeaferCommitScheduler(h.options);
  scheduler.requestCommit();
  await sleep(40); // first refusal recorded, retry scheduled
  assert.ok(h.calls.length >= 1);
  scheduler.cancelRetry();
  const settled = h.calls.length;
  await sleep(60);
  assert.equal(h.calls.length, settled, "cancelRetry must stop the pending retry");
  scheduler.dispose();
});

test("the retry budget is bounded and self-terminating", async () => {
  const h = harness(() => '{"v":1}');
  const scheduler = createLeaferCommitScheduler(h.options);
  scheduler.requestCommit(); // everything refuses forever
  await sleep(160);
  assert.equal(h.calls.length, 6, `initial commit + 5 bounded retries, then give up (got ${h.calls.length})`);
  scheduler.dispose();
});

test("retries stop once the canvas is no longer editable", async () => {
  let editable = true;
  const h = harness(
    () => '{"v":1}',
    () => editable
  );
  const scheduler = createLeaferCommitScheduler(h.options);
  scheduler.requestCommit();
  await sleep(50); // first refusal recorded; at most one already-scheduled retry may fire
  editable = false;
  await sleep(RETRY_MS * 2 + 40); // let any already-scheduled retry fire out
  const settled = h.calls.length;
  await sleep(70);
  assert.equal(h.calls.length, settled, "a read-only canvas must not keep retrying");
  assert.ok(h.calls.length >= 1, "the initial commit attempt happened before the flip");
  scheduler.dispose();
});
