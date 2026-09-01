/**
 * review.getGitChangedFiles — the CRG change-detection file feed.
 *
 * Regression guard for the 2026-08-31 user screenshot round:
 *  - the old `require("node:child_process")` inside this ESM package threw a
 *    ReferenceError on EVERY call, the catch returned [], and review.full
 *    permanently degraded to "CRG graph present but produced no structural
 *    data" — structural enrichment never ran once;
 *  - everything the toolchain generates (arch maps, wiki, graph DBs, review
 *    reports) is parked under dot-directories of the target repo, so the
 *    dot-segment filter must keep them out of the changed-file list or the
 *    review ends up "reviewing its own output".
 */

import { execFile, execFileSync } from "node:child_process";
import { strict as assert } from "node:assert";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getGitChangedFiles, toDetectionSet } from "../actions/review";

function git(root: string, ...args: string[]): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile("git", ["-C", root, ...args], { windowsHide: true }, (err) => (err ? reject(err) : resolve()))
  );
}

test("getGitChangedFiles: real repo — dot-dirs are excluded, real changes survive", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "review-files-"));
  try {
    await git(root, "init", "-q");
    await git(root, "config", "user.email", "test@example.com");
    await git(root, "config", "user.name", "test");
    await fsp.writeFile(path.join(root, "keep.ts"), "export {};\n");
    await fsp.mkdir(path.join(root, ".deeporca", "prototypes"), { recursive: true });
    await fsp.mkdir(path.join(root, ".code-review-graph"), { recursive: true });
    await fsp.writeFile(path.join(root, ".deeporca", "prototypes", "arch-x.json"), "{}\n");
    await fsp.writeFile(path.join(root, ".code-review-graph", "graph.db"), "x");
    await git(root, "add", "-A");
    await git(root, "commit", "-qm", "init");

    // Workspace changes: one real file + one generated artifact + one dot-file.
    await fsp.writeFile(path.join(root, "keep.ts"), "export const x = 1;\n");
    await fsp.writeFile(path.join(root, ".deeporca", "prototypes", "arch-y.json"), "{}\n");
    await fsp.writeFile(path.join(root, ".env.local"), "SECRET=1\n");

    const files = getGitChangedFiles(root);
    const rels = files.map((f) => path.relative(root, f).split(path.sep).join("/"));
    assert.ok(rels.includes("keep.ts"), "the real change must be listed");
    assert.ok(!rels.some((r) => r.startsWith(".deeporca/")), "generated artifacts must be excluded");
    assert.ok(!rels.some((r) => r.startsWith(".code-review-graph/")), "graph db must be excluded");
    assert.ok(!rels.includes(".env.local"), "dot-files must be excluded");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("commit mode lists the ROOT commit's files (diff-tree --root, not X^)", async () => {
  // Review round 2026-09-01: the old `git diff X^ X` fails outright for the
  // initial commit (no parent), the catch swallowed it, and the root commit's
  // files were never structurally enriched.
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "review-rootcommit-"));
  try {
    await git(root, "init", "-q");
    await git(root, "config", "user.email", "test@example.com");
    await git(root, "config", "user.name", "test");
    await fsp.writeFile(path.join(root, "first.ts"), "export {};\n");
    await fsp.mkdir(path.join(root, ".deeporca"), { recursive: true });
    await fsp.writeFile(path.join(root, ".deeporca", "x.json"), "{}\n");
    await git(root, "add", "-A");
    await git(root, "commit", "-qm", "root");
    const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    const files = getGitChangedFiles(root, { mode: "commit", commit: head });
    const rels = files.map((f) => path.relative(root, f).split(path.sep).join("/"));
    assert.ok(rels.includes("first.ts"), "the root commit's real file must be listed");
    assert.ok(!rels.includes(".deeporca/x.json"), "dot-path generation is still excluded");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("toDetectionSet: dot-paths cannot starve real source out of the capped set", () => {
  // Review round 2026-09-01: the cap used to run BEFORE the dot filter, and
  // `git ls-files` emits byte order — where `.` sorts before every letter.
  // A repo whose generated dot-tree fills the first 800 entries ended with an
  // EMPTY effective set while the status text claimed "no changes outside
  // generated directories".
  const dotFiles = Array.from({ length: 900 }, (_, i) => `.deeporca/deepwiki/gen-${String(i).padStart(4, "0")}.md`);
  const real = ["src/a.ts", "src/b.ts", "docs/c.md", ".env"];
  const set = toDetectionSet("D:/repo", [...dotFiles, ...real]);
  const rels = set.map((f) => f.replace(/\\/g, "/").replace("D:/repo/", ""));
  assert.deepEqual(rels, ["src/a.ts", "src/b.ts", "docs/c.md"], "real source survives; dot-paths drop first");
});

test("toDetectionSet: caps AFTER filtering, dedupes empties, keeps absolute input", () => {
  const mixed = ["", "  ", "src/a.ts", "D:/repo/src/a.ts", ".env"];
  const set = toDetectionSet("D:/repo", mixed);
  const rels = set.map((f) => f.replace(/\\/g, "/").replace("D:/repo/", ""));
  assert.equal(new Set(set).size, set.length, "no accidental duplicates from absolute+relative twins");
  assert.ok(rels.includes("src/a.ts"), "both spellings resolve to the same file and survive");
  assert.ok(!rels.includes(".env"), "dot-file dropped");

  const many = Array.from({ length: 850 }, (_, i) => `src/f${i}.ts`);
  assert.equal(toDetectionSet("D:/repo", many).length, 800, "cap applies to the FILTERED set");
});
