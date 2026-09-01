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
import {
  CHURN_HOTSPOT_MIN,
  detectStaleFiles,
  getChurnCounts,
  getGitChangedFiles,
  getGitChangedRanges,
  parseUnifiedHunks,
  toDetectionSet,
  toRepoPosix,
} from "../actions/review";
import { configureCrgGraphQuery, createCrgGraphQuery } from "../actions/crg-query";
import { createHash } from "node:crypto";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

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
  // generated directories". Root is platform-real (Windows-authored fixtures
  // like "D:/repo" break POSIX runners, where a drive literal is a bare
  // relative segment).
  const root = path.join(os.tmpdir(), "crg-detect-dots");
  const dotFiles = Array.from({ length: 900 }, (_, i) => `.deeporca/deepwiki/gen-${String(i).padStart(4, "0")}.md`);
  const real = ["src/a.ts", "src/b.ts", "docs/c.md", ".env"];
  const set = toDetectionSet(root, [...dotFiles, ...real]);
  const rels = set.map((f) => path.relative(root, f).split(path.sep).join("/"));
  assert.deepEqual(rels, ["src/a.ts", "src/b.ts", "docs/c.md"], "real source survives; dot-paths drop first");
});

test("toDetectionSet: caps AFTER filtering, dedupes empties, keeps absolute input", () => {
  const root = path.join(os.tmpdir(), "crg-detect-mixed");
  const absNative = path.join(root, "src", "a.ts"); // path.resolve styling (backslashes on Windows)
  const absPosix = absNative.split(path.sep).join("/"); // forward-slash spelling (valid absolute on both OSes)
  const mixed = ["", "  ", "src/a.ts", absPosix, ".env"];
  const set = toDetectionSet(root, mixed);
  const rels = set.map((f) => path.relative(root, f).split(path.sep).join("/"));
  assert.equal(new Set(set).size, set.length, "no accidental duplicates from absolute+relative twins");
  assert.ok(rels.includes("src/a.ts"), "both spellings resolve to the same file and survive");
  assert.ok(rels.includes(absNative) === false, "absolute spelling renders as a repo-relative path");
  assert.ok(!rels.includes(".env"), "dot-file dropped");

  const many = Array.from({ length: 850 }, (_, i) => `src/f${i}.ts`);
  assert.equal(toDetectionSet(root, many).length, 800, "cap applies to the FILTERED set");
});

test("parseUnifiedHunks extracts NEW-side intervals from --unified=0 output", () => {
  // Mining item ①: the line-precise detection feed. Multi-hunk files,
  // pure-deletion hunks (no new lines → skipped), brand-new files, and
  // deleted files (b//dev/null → skipped) all covered.
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 111..222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,0 +1,3 @@",
    "+x",
    "+y",
    "+z",
    "@@ -9 +10,0 @@",
    "-deleted",
    "diff --git a/src/new.ts b/src/new.ts",
    "new file mode 100644",
    "index 000..333",
    "--- /dev/null",
    "+++ b/src/new.ts",
    "@@ -0,0 +1,2 @@",
    "+a",
    "+b",
    "diff --git a/src/gone.ts b/src/gone.ts",
    "deleted file mode 100644",
    "--- a/src/gone.ts",
    "+++ /dev/null",
    "@@ -1,3 +0,0 @@",
    "-g",
  ].join("\n");
  assert.deepEqual(parseUnifiedHunks(diff), {
    "src/a.ts": [[1, 3]],
    "src/new.ts": [[1, 2]],
  });
  assert.deepEqual(parseUnifiedHunks(""), {});
});

test("getGitChangedRanges reads real line intervals for workspace changes", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "review-ranges-"));
  try {
    await git(root, "init", "-q");
    await git(root, "config", "user.email", "test@example.com");
    await git(root, "config", "user.name", "test");
    await fsp.writeFile(path.join(root, "f.ts"), "1\n2\n3\n4\n5\n");
    await git(root, "add", "-A");
    await git(root, "commit", "-qm", "init");
    // Edit line 3 and line 5 independently.
    await fsp.writeFile(path.join(root, "f.ts"), "1\n2\nX\n4\nY\n");
    const ranges = getGitChangedRanges(root);
    assert.deepEqual(
      ranges["f.ts"],
      [
        [3, 3],
        [5, 5],
      ],
      "two disjoint single-line hunks"
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("detectStaleFiles flags files whose content drifted from the graph's hash", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "review-stale-"));
  try {
    const file = path.join(root, "f.ts");
    await fsp.writeFile(file, "v1");
    const dir = path.join(root, ".deeporca", "crg");
    await fsp.mkdir(dir, { recursive: true });
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dir, "graph.db"));
    db.exec(`CREATE TABLE nodes (kind TEXT, file_path TEXT, file_hash TEXT)`);
    db.prepare(`INSERT INTO nodes VALUES ('File', ?, '${sha256("v1")}')`).run(file.replace(/\\/g, "/"));
    db.close();

    configureCrgGraphQuery(createCrgGraphQuery());
    try {
      assert.deepEqual(detectStaleFiles(root, ["f.ts"]), [], "identical content → fresh");
      await fsp.writeFile(file, "v2");
      assert.deepEqual(detectStaleFiles(root, ["f.ts"]), ["f.ts"], "drifted content → stale");
      await fsp.rm(file);
      assert.deepEqual(detectStaleFiles(root, ["f.ts"]), [], "raced-away file → skipped, not stale");
      // No File-node coverage for the probe → stay silent.
      const other = path.join(root, "other.ts");
      await fsp.writeFile(other, "x");
      assert.deepEqual(detectStaleFiles(root, ["other.ts"]), [], "unindexed file is not a scream");
    } finally {
      configureCrgGraphQuery(null);
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("getChurnCounts counts commits per file over the window (numstat -z parsing)", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "review-churn-"));
  try {
    await git(root, "init", "-q");
    await git(root, "config", "user.email", "test@example.com");
    await git(root, "config", "user.name", "test");
    const hot = path.join(root, "hot.ts");
    await fsp.writeFile(hot, "v0");
    await git(root, "add", "-A");
    await git(root, "commit", "-qm", "c0");
    for (let i = 1; i <= 4; i++) {
      await fsp.writeFile(hot, `v${i}`);
      await fsp.writeFile(path.join(root, "other.ts"), `o${i}`);
      await git(root, "add", "-A");
      await git(root, "commit", "-qm", `c${i}`);
    }
    const counts = getChurnCounts(root);
    // hot.ts: init (c0) + 4 edits = 5 — numstat includes the initial add,
    // same as upstream compute_file_churn; other.ts exists only from c1.
    assert.equal(counts["hot.ts"], 5, "commits touching hot.ts counted");
    assert.equal(counts["other.ts"], 4);
    assert.equal(toRepoPosix(root, hot), "hot.ts");
    // A repo with no commits (or a broken git) degrades to {} — never throws.
    const emptyRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "review-churn-empty-"));
    try {
      await git(emptyRoot, "init", "-q");
      assert.deepEqual(getChurnCounts(emptyRoot), {}, "no commits → empty counts");
    } finally {
      await fsp.rm(emptyRoot, { recursive: true, force: true });
    }
    assert.equal(CHURN_HOTSPOT_MIN, 3);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
