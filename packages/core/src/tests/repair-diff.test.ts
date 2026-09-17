// Repair-sequence diff battery (specs/repair-rule-memory P0): golden pair
// (repeated-failure parent vs repaired child), signal gate boundaries, and
// the diff's structural contracts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSequences, editPathHasSignal, extractToolSequence, type ToolCallUnit } from "../actions/repair-diff";

const u = (tool: string, argsDigest: string): ToolCallUnit => ({ tool, argsDigest });

/** Session-message shapes as they appear in transcript JSONL (parsed). */
function assistantWithCalls(calls: Array<{ name: string; arguments: string }>): unknown {
  return { role: "assistant", messageParams: { tool_calls: calls.map((c) => ({ id: "x", function: c })) } };
}

test("extractToolSequence reads assistant tool_calls in order and digests args", () => {
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "do it" },
    assistantWithCalls([
      { name: "bash", arguments: JSON.stringify({ command: "npm run build" }) },
      { name: "read", arguments: JSON.stringify({ path: "src/a.ts" }) },
    ]),
    { role: "tool", content: '{"ok":true}' },
    assistantWithCalls([{ name: "WebSearch", arguments: JSON.stringify({ query: "orcarc retry policy" }) }]),
    { role: "assistant", content: "no tools here" },
  ];
  assert.deepEqual(extractToolSequence(messages), [
    { tool: "bash", argsDigest: "npm" },
    { tool: "read", argsDigest: "a.ts" },
    { tool: "WebSearch", argsDigest: "orcarc retry policy" },
  ]);
});

test("extractToolSequence is defensive: malformed entries contribute nothing", () => {
  assert.deepEqual(
    extractToolSequence([null, 42, "x", { role: "assistant" }, { role: "assistant", messageParams: {} }]),
    []
  );
  // Unparseable arguments string → bare unit with {} digest, not a crash.
  assert.deepEqual(extractToolSequence([assistantWithCalls([{ name: "bash", arguments: "not json" }])]), [
    { tool: "bash", argsDigest: "{}" },
  ]);
});

/** Golden pair (EMG's case study shape): parent retries a doomed take, child drops it first. */
const GOLDEN_PARENT: ToolCallUnit[] = [
  u("read", "pkg.json"),
  u("bash", "cat"),
  u("grab", "foo"), // doomed action …
  u("grab", "foo"), // … repeated (failure cluster)
  u("grab", "foo"),
  u("inspect", "dir"),
  u("write", "out.md"),
];
const GOLDEN_CHILD: ToolCallUnit[] = [
  u("read", "pkg.json"),
  u("bash", "cat"),
  u("drop", "bar"), // the repair insertion
  u("grab", "foo"), // now the take succeeds
  u("inspect", "dir"),
  u("write", "out.md"),
];

test("golden pair: repeated failure collapses into ONE cluster; repair surfaces as insertion", () => {
  const path = diffSequences(GOLDEN_PARENT, GOLDEN_CHILD);
  assert.deepEqual(path.spine, [
    u("read", "pkg.json"),
    u("bash", "cat"),
    u("grab", "foo"),
    u("inspect", "dir"),
    u("write", "out.md"),
  ]);
  assert.deepEqual(path.deletedClusters, [[u("grab", "foo"), u("grab", "foo")]], "the two EXTRA grabs are one cluster");
  assert.deepEqual(path.insertions, [u("drop", "bar")]);
  assert.equal(path.parentLength, 7);
  assert.equal(path.childLength, 6);
  assert.ok(editPathHasSignal(path));
});

test("signal gate: short spine or empty deletion clusters → no signal", () => {
  // Near-identical sequences (one dropped call, spine = 3) still signal…
  const near = diffSequences(
    [u("a", "x"), u("b", "y"), u("c", "z"), u("d", "w")],
    [u("a", "x"), u("c", "z"), u("d", "w")]
  );
  assert.deepEqual(near.deletedClusters, [[u("b", "y")]]);
  assert.ok(editPathHasSignal(near));
  // …but a too-short spine never does.
  assert.equal(editPathHasSignal(near, { minSpine: 4 }), false);
  assert.equal(editPathHasSignal(diffSequences([u("a", "x")], []), { minSpine: 3 }), false);
  // Identical trajectories: zero deletion clusters → no rule (nothing was repaired).
  const identical = diffSequences(GOLDEN_CHILD, GOLDEN_CHILD);
  assert.equal(identical.deletedClusters.length, 0);
  assert.equal(editPathHasSignal(identical), false);
});

test("empty and one-sided sequences degrade to explicit shapes", () => {
  assert.deepEqual(diffSequences([], []), {
    spine: [],
    deletedClusters: [],
    insertions: [],
    parentLength: 0,
    childLength: 0,
  });
  const allDeleted = diffSequences([u("a", "1"), u("b", "2")], []);
  assert.deepEqual(allDeleted.deletedClusters, [[u("a", "1"), u("b", "2")]]);
  assert.equal(allDeleted.spine.length, 0);
  assert.equal(editPathHasSignal(allDeleted), false, "spine < 3 blocks the rule even with deletions");
});
