/**
 * Finding ↔ risk-graph node binding (review-bind.ts) — the bidirectional
 * locate contract (design spec §4.3): line-range overlap first, nearest
 * preceding node as fallback, unbound when the file has no candidate, and
 * path matching in the graph's POSIX identity regardless of the spelling
 * the caller hands in.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { bindFindingsToNodes, toGraphPath, type BindableNode } from "../main/tools/review-bind";

function node(qn: string, filePath: string, lineStart: number, lineEnd: number): BindableNode {
  return { qualifiedName: qn, name: qn.split("#").pop() ?? qn, filePath, lineStart, lineEnd };
}

test("line-range overlap binds a finding inside a node's definition", () => {
  const nodes = [node("src/auth.ts#login", "/repo/src/auth.ts", 12, 30)];
  const got = bindFindingsToNodes([{ path: "src/auth.ts", startLine: 15 }], nodes, "/repo");
  assert.equal(got.length, 1);
  assert.equal(got[0].qn, "src/auth.ts#login");
  assert.equal(got[0].index, 0);
});

test("interval boundaries are inclusive on both ends", () => {
  const nodes = [node("a.ts#f", "/repo/a.ts", 10, 20)];
  const atStart = bindFindingsToNodes([{ path: "a.ts", startLine: 10 }], nodes, "/repo");
  const atEnd = bindFindingsToNodes([{ path: "a.ts", startLine: 20 }], nodes, "/repo");
  assert.equal(atStart.length, 1, "startLine == lineStart binds");
  assert.equal(atEnd.length, 1, "startLine == lineEnd binds");
});

test("gap finding (header comment above a function) falls back to the nearest preceding node", () => {
  const nodes = [node("a.ts#first", "/repo/a.ts", 10, 20), node("a.ts#second", "/repo/a.ts", 30, 40)];
  const got = bindFindingsToNodes([{ path: "a.ts", startLine: 25 }], nodes, "/repo");
  assert.equal(got.length, 1);
  assert.equal(got[0].qn, "a.ts#first", "no overlap → previous node");
});

test("before every node in the file → unbound", () => {
  const nodes = [node("a.ts#f", "/repo/a.ts", 10, 20)];
  assert.deepEqual(bindFindingsToNodes([{ path: "a.ts", startLine: 2 }], nodes, "/repo"), []);
});

test("unknown file or empty node set → unbound", () => {
  assert.deepEqual(
    bindFindingsToNodes([{ path: "other.ts", startLine: 5 }], [node("a.ts#f", "/repo/a.ts", 1, 9)], "/repo"),
    []
  );
  assert.deepEqual(bindFindingsToNodes([{ path: "a.ts", startLine: 5 }], [], "/repo"), []);
  assert.deepEqual(bindFindingsToNodes([], [node("a.ts#f", "/repo/a.ts", 1, 9)]), []);
});

test("path matching ignores trailing separator/spelling differences (POSIX identity)", () => {
  // The graph stores forward-slash absolute paths (#774); comments may carry
  // native or repo-relative spellings. All three must bind to the same node.
  const graphFile = "/repo/src/auth.ts";
  const nodes = [node("src/auth.ts#login", graphFile, 12, 30)];
  const posixAbs = "/repo/src/auth.ts";
  const got = bindFindingsToNodes(
    [
      { path: "src/auth.ts", startLine: 15 },
      { path: posixAbs, startLine: 16 },
    ],
    nodes,
    "/repo"
  );
  assert.equal(got.length, 2);
  assert.ok(got.every((b) => b.qn === "src/auth.ts#login"));
});

test("indices stay stable across unbound findings", () => {
  const nodes = [node("a.ts#f", "/repo/a.ts", 10, 20)];
  const got = bindFindingsToNodes(
    [
      { path: "miss.ts", startLine: 1 },
      { path: "a.ts", startLine: 12 },
      { path: "a.ts", startLine: 3 },
    ],
    nodes,
    "/repo"
  );
  assert.equal(got.length, 1);
  assert.equal(got[0].index, 1, "bound finding keeps its position in the findings array");
});

test("toGraphPath normalizes native separators only", () => {
  assert.equal(toGraphPath("C:\\repo\\src\\a.ts"), "C:/repo/src/a.ts");
  assert.equal(toGraphPath("/repo/src/a.ts"), "/repo/src/a.ts");
  assert.equal(toGraphPath("src/a.ts"), "src/a.ts");
});
