/**
 * Finding ↔ risk-graph node binding (review-bind.ts) — the bidirectional
 * locate contract (design spec §4.3): line-range overlap first, nearest
 * preceding node as fallback, unbound when the file has no candidate, and
 * path matching in the graph's POSIX identity regardless of the spelling
 * the caller hands in.
 *
 * Platform-adaptive fixtures (review round 2026-09-01): the root is derived
 * from the real tmpdir (POSIX-slashed) instead of a literal "/repo" — on
 * win32 `path.resolve` prefixes the drive letter, so a literal POSIX root
 * never matches its own resolved paths. Pure string seams, no fs.
 */

import { strict as assert } from "node:assert";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { bindFindingsToNodes, toGraphPath, type BindableNode } from "../main/tools/review-bind";

/** Real-shape root in the graph's POSIX identity — `path.resolve(ROOT, rel)`
 *  resolves natively per platform, then re-normalizes back onto ROOT. */
const ROOT = toGraphPath(path.resolve(os.tmpdir(), "review-bind-fixture"));
const f = (rel: string): string => `${ROOT}/${rel}`;

function node(qn: string, filePath: string, lineStart: number, lineEnd: number): BindableNode {
  return { qualifiedName: qn, name: qn.split("#").pop() ?? qn, filePath, lineStart, lineEnd };
}

test("line-range overlap binds a finding inside a node's definition", () => {
  const nodes = [node("src/auth.ts#login", f("src/auth.ts"), 12, 30)];
  const got = bindFindingsToNodes([{ path: "src/auth.ts", startLine: 15 }], nodes, ROOT);
  assert.equal(got.length, 1);
  assert.equal(got[0].qn, "src/auth.ts#login");
  assert.equal(got[0].index, 0);
});

test("interval boundaries are inclusive on both ends", () => {
  const nodes = [node("a.ts#f", f("a.ts"), 10, 20)];
  const atStart = bindFindingsToNodes([{ path: "a.ts", startLine: 10 }], nodes, ROOT);
  const atEnd = bindFindingsToNodes([{ path: "a.ts", startLine: 20 }], nodes, ROOT);
  assert.equal(atStart.length, 1, "startLine == lineStart binds");
  assert.equal(atEnd.length, 1, "startLine == lineEnd binds");
});

test("gap finding (header comment above a function) falls back to the nearest preceding node", () => {
  const nodes = [node("a.ts#first", f("a.ts"), 10, 20), node("a.ts#second", f("a.ts"), 30, 40)];
  const got = bindFindingsToNodes([{ path: "a.ts", startLine: 25 }], nodes, ROOT);
  assert.equal(got.length, 1);
  assert.equal(got[0].qn, "a.ts#first", "no overlap → previous node");
});

test("before every node in the file → unbound", () => {
  const nodes = [node("a.ts#f", f("a.ts"), 10, 20)];
  assert.deepEqual(bindFindingsToNodes([{ path: "a.ts", startLine: 2 }], nodes, ROOT), []);
});

test("unknown file or empty node set → unbound", () => {
  assert.deepEqual(
    bindFindingsToNodes([{ path: "other.ts", startLine: 5 }], [node("a.ts#f", f("a.ts"), 1, 9)], ROOT),
    []
  );
  assert.deepEqual(bindFindingsToNodes([{ path: "a.ts", startLine: 5 }], [], ROOT), []);
  assert.deepEqual(bindFindingsToNodes([], [node("a.ts#f", f("a.ts"), 1, 9)]), []);
});

test("path matching ignores trailing separator/spelling differences (POSIX identity)", () => {
  // The graph stores forward-slash absolute paths (#774); comments may carry
  // native or repo-relative spellings. All three must bind to the same node.
  const graphFile = f("src/auth.ts");
  const nodes = [node("src/auth.ts#login", graphFile, 12, 30)];
  const posixAbs = f("src/auth.ts");
  const nativeAbs = path.resolve(ROOT, "src/auth.ts"); // native separators on win32
  const got = bindFindingsToNodes(
    [
      { path: "src/auth.ts", startLine: 15 },
      { path: posixAbs, startLine: 16 },
      { path: nativeAbs, startLine: 17 },
    ],
    nodes,
    ROOT
  );
  assert.equal(got.length, 3);
  assert.ok(got.every((b) => b.qn === "src/auth.ts#login"));
});

test("indices stay stable across unbound findings", () => {
  const nodes = [node("a.ts#f", f("a.ts"), 10, 20)];
  const got = bindFindingsToNodes(
    [
      { path: "miss.ts", startLine: 1 },
      { path: "a.ts", startLine: 12 },
      { path: "a.ts", startLine: 3 },
    ],
    nodes,
    ROOT
  );
  assert.equal(got.length, 1);
  assert.equal(got[0].index, 1, "bound finding keeps its position in the findings array");
});

test("malformed findings are skipped WITHOUT shifting later indices", () => {
  // Review round 2026-09-01: the caller binds the FULL findings array — the
  // contract is `index` == position in that array — so a startLine=0 / bad
  // path entry must vanish but not renumber its successors.
  const nodes = [node("a.ts#f", f("a.ts"), 10, 20)];
  const got = bindFindingsToNodes(
    [
      { path: "a.ts", startLine: 0 },
      { path: "", startLine: 12 },
      { path: "a.ts", startLine: Number.NaN },
      { path: "a.ts", startLine: 12 },
    ],
    nodes,
    ROOT
  );
  assert.equal(got.length, 1);
  assert.equal(got[0].index, 3);
});

test("toGraphPath normalizes native separators only", () => {
  assert.equal(toGraphPath("C:\\repo\\src\\a.ts"), "C:/repo/src/a.ts");
  assert.equal(toGraphPath("/repo/src/a.ts"), "/repo/src/a.ts");
  assert.equal(toGraphPath("src/a.ts"), "src/a.ts");
});
