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

import { execFile } from "node:child_process";
import { strict as assert } from "node:assert";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getGitChangedFiles } from "../actions/review";

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
