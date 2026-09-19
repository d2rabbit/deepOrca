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

test("sequences beyond MAX_SEQUENCE_UNITS are tail-trimmed: memory bounded, stats truthful", async () => {
  const { MAX_SEQUENCE_UNITS } = await import("../actions/repair-diff");
  // A match placed BEYOND the cut (early parent history) must not reach the
  // spine; matches inside the recent tail still align. This pins both the
  // memory ceiling (table never exceeds MAX²) and the degradation semantics.
  const filler = (count: number, tag: string): ToolCallUnit[] =>
    Array.from({ length: count }, (_, index) => ({ tool: `t${index % 7}`, argsDigest: `${tag}${index}` }));
  const beyondCut = { tool: "ancient", argsDigest: "only-in-early-parent" };
  // beyondCut sits at the HEAD of the parent trajectory — outside the
  // last-MAX_SEQUENCE_UNITS window the cap keeps.
  const parent = [beyondCut, ...filler(MAX_SEQUENCE_UNITS + 200, "p")];
  // Child contains ONLY the beyond-cut unit → the only possible match lies
  // outside the trimmed window → empty spine, and the unit reports as deleted.
  const childOnlyAncient = [beyondCut];
  const diff = diffSequences(parent, childOnlyAncient);
  assert.equal(diff.spine.length, 0, "early-history match must be outside the trimmed tail");
  assert.equal(diff.parentLength, MAX_SEQUENCE_UNITS + 201, "parentLength reports the ORIGINAL trajectory");
  assert.equal(diff.childLength, 1);
  // A tail match still works at over-cap length: same trailing units align.
  const tailMatch = { tool: "tail", argsDigest: "recent" };
  const parent2 = [...filler(MAX_SEQUENCE_UNITS + 50, "q"), tailMatch];
  const child2 = [tailMatch];
  const diff2 = diffSequences(parent2, child2);
  assert.deepEqual(diff2.spine, [tailMatch], "tail-of-trajectory matches survive the cap");
  assert.equal(diff2.parentLength, MAX_SEQUENCE_UNITS + 51);
});

test("over-cap diff result equals an explicit tail-trim diff (equivalence)", async () => {
  const { MAX_SEQUENCE_UNITS } = await import("../actions/repair-diff");
  const unit = (i: number, tag: string): ToolCallUnit => ({ tool: `t${i % 5}`, argsDigest: `${tag}-${i}` });
  const parent = Array.from({ length: MAX_SEQUENCE_UNITS + 300 }, (_, i) => unit(i, "p"));
  const child = Array.from({ length: MAX_SEQUENCE_UNITS + 10 }, (_, i) => unit(i, "c"));
  const direct = diffSequences(parent, child);
  const manual = diffSequences(
    parent.slice(parent.length - MAX_SEQUENCE_UNITS),
    child.slice(child.length - MAX_SEQUENCE_UNITS)
  );
  assert.deepEqual(direct.spine, manual.spine);
  assert.deepEqual(direct.deletedClusters, manual.deletedClusters);
  assert.deepEqual(direct.insertions, manual.insertions);
  // Lengths stay TRUTHFUL about the originals (not the trimmed views).
  assert.equal(direct.parentLength, MAX_SEQUENCE_UNITS + 300);
  assert.equal(direct.childLength, MAX_SEQUENCE_UNITS + 10);
});
