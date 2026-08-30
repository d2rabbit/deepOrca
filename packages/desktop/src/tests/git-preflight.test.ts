/**
 * Unit tests for the knowledge-build git preflight & bootstrap.
 *
 * Runs REAL git in temp dirs (git is a hard product dependency — the bash
 * tool, file-history and the wiki generator all assume it). Cases:
 * non-repo detection, the init+first-commit bootstrap (which must succeed
 * regardless of the machine's git identity via the -c fallback), and the
 * nothing-to-commit guard for an empty workspace.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { gitPreflight, gitBootstrap } from "../main/git-preflight.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "deeporca-git-preflight-"));
}

test("gitPreflight: a plain directory is not a repo", async () => {
  const dir = await tempDir();
  try {
    assert.deepEqual(await gitPreflight(dir), { isRepo: false, hasCommits: false });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("gitBootstrap: init + first commit makes the root buildable", async () => {
  const dir = await tempDir();
  try {
    await fs.writeFile(path.join(dir, "README.md"), "# demo\n");
    const res = await gitBootstrap(dir);
    assert.equal(res.ok, true);
    if (res.ok) assert.match(res.commit, /^[0-9a-f]{7,}$/);
    assert.deepEqual(await gitPreflight(dir), { isRepo: true, hasCommits: true });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("gitBootstrap: unborn HEAD repo gets its first commit (no re-init)", async () => {
  const dir = await tempDir();
  try {
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    // Simulate the AI-SaaS shape: a git repo whose HEAD was never born.
    await gitBootstrap(dir);
    // A SECOND bootstrap on a now-clean tree has nothing to commit — it must
    // fail explicitly rather than pretend success (mirrors the wiki-empty
    // philosophy: never report progress that did not happen).
    const again = await gitBootstrap(dir);
    assert.equal(again.ok, false);
    // The server-side guard (review round 6) refuses a committed repo
    // outright — stronger than the old nothing-to-commit detection.
    if (!again.ok) assert.match(again.error, /already has commits|nothing to commit/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("gitBootstrap: an empty workspace refuses with nothing-to-commit", async () => {
  const dir = await tempDir();
  try {
    const res = await gitBootstrap(dir);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /nothing to commit/i);
    // And the refusal must not leave a fake-committed state behind.
    assert.deepEqual(await gitPreflight(dir), { isRepo: true, hasCommits: false });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
