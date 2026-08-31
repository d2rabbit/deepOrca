/**
 * Arch-scan background task prompt (buildArchScanTaskPrompt, pure).
 *
 * Review round 4's critical finding: the prompt used to name the ACTIVE
 * session root while the path grant scopes read/write to the BUILD root —
 * cross-workspace builds got every tool call denied. These tests pin the
 * contract: the prompt's target line MUST match the grant's root, the archify
 * toolkit paths must always accompany the task (fresh AND incremental — the
 * old custom incremental prompt bypassed them), and the incremental variant
 * carries refresh-in-place instructions.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildArchScanTaskPrompt,
  backgroundTaskRuntimeContext,
  detectArchRepositoryHint,
} from "../session-manager-tasks";
import { configureArchifyLanguage } from "../actions/archify-controller";

test("target line matches the root the path grant will scope to", () => {
  const root = "/builds/workspace-b";
  const prompt = buildArchScanTaskPrompt(root);
  assert.match(prompt, new RegExp(`Target repository root: ${root.replace(/\//g, "\\/")}`));
  assert.doesNotMatch(prompt, /session/i, "no session-root language that could mislead");
  assert.match(prompt, /\.deeporca\/prototypes\/arch-<slug>\.<type>\.json/);
});

test("archify toolkit paths are embedded when the seam is configured", () => {
  // The seam is process-global (host-injected at boot); in the test env it is
  // unset, which pins the NOT-CONFIGURED contract line instead.
  const prompt = buildArchScanTaskPrompt("/r");
  assert.match(prompt, /Archify toolkit:/);
  assert.match(prompt, /NOT CONFIGURED|skillDoc:/);
});

test("incremental variant carries refresh-in-place instructions", () => {
  const prompt = buildArchScanTaskPrompt("/r", { incremental: true });
  assert.match(prompt, /Incremental UPDATE run/);
  assert.match(prompt, /Do not delete existing artifacts/);
  assert.match(prompt, /Target repository root: \/r/, "incremental runs also name the target");
});

test("perspective defaults to overall", () => {
  assert.match(buildArchScanTaskPrompt("/r"), /Perspective: overall/);
  assert.match(buildArchScanTaskPrompt("/r", { perspective: "data-flow" }), /Perspective: data-flow/);
});

test("background runtime context is slim, target-rooted, and path-explicit (gateway censor class)", () => {
  const ctx = backgroundTaskRuntimeContext("/builds/ws-b");
  assert.match(ctx, /target root: \/builds\/ws-b/);
  assert.match(ctx, /ABSOLUTE paths/);
  // The FULL getStableRuntimeContext (~8KB incl. the OS command dictionary)
  // deterministically tripped StepFun's content filter on the first call
  // (live probe 2026-08-29); the slim block must stay small.
  assert.ok(ctx.length < 1200, `slim ctx drifted to ${ctx.length}B — re-check the censor class`);
});

test("showcase quality bar rides along on fresh and incremental runs (2026-08-30)", () => {
  for (const opts of [undefined, { incremental: true }]) {
    const prompt = buildArchScanTaskPrompt("/r", opts);
    assert.match(prompt, /Showcase quality bar/);
    assert.match(prompt, /meta\.views/);
    assert.match(prompt, /completeness of SEMANTICS/);
  }
});

test("language directive follows the host-synced locale (user ask 2026-08-29)", () => {
  configureArchifyLanguage("zh-CN");
  try {
    const zh = buildArchScanTaskPrompt("/r");
    assert.match(zh, /write ALL reader-facing text[^\n]*in zh-CN/);
    assert.match(zh, /Keep exact code identifiers/);
  } finally {
    configureArchifyLanguage(undefined);
  }
  const none = buildArchScanTaskPrompt("/r");
  assert.doesNotMatch(none, /in zh-CN/);
  assert.match(none, /dominant documentation language/);
});

test("repository contract: a proven github origin unlocks sources[] with exact metadata", () => {
  const sha = "a".repeat(40);
  const prompt = buildArchScanTaskPrompt("/r", { repository: { url: "https://github.com/o/r", revision: sha } });
  assert.match(prompt, /You MAY author component sources arrays/);
  assert.match(prompt, /EXACTLY \{"url": "https:\/\/github\.com\/o\/r", "revision": "a{40}"\}/);
  assert.match(prompt, /Author no sources → omit meta\.repository/);
});

test("repository contract: a non-github origin FORBIDS the sources surface (gitee/private/local)", () => {
  // Real-machine 2026-08-31 (excel-jvm, gitee origin): the model authored
  // component sources[] with no meta.repository and the deliver gate failed
  // the whole stage — archify requires a pinned public github.com URL, which
  // such repositories can never satisfy. The prompt must forbid the surface
  // outright AND demand cleanup of sources left by earlier runs.
  const prompt = buildArchScanTaskPrompt("/r");
  assert.match(prompt, /Do NOT author\s*component sources arrays/);
  assert.match(prompt, /do NOT set meta\.repository/);
  assert.match(prompt, /pinned public\s*github\.com URL/);
  assert.match(prompt, /REMOVE any sources arrays left by earlier runs/);
});

test("detectArchRepositoryHint: github origin normalizes to https hint; anything else is null", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arch-repo-hint-"));
  const git = (args: string[]): string =>
    execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
  try {
    git(["init"]);
    git(["remote", "add", "origin", "git@github.com:Owner/Repo.git"]);
    fs.writeFileSync(path.join(root, "f.txt"), "x");
    git(["add", "-A"]);
    git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"]);
    const hint = detectArchRepositoryHint(root);
    assert.ok(hint, "a github ssh origin produces a hint");
    assert.equal(hint.url, "https://github.com/Owner/Repo");
    assert.match(hint.revision, /^[0-9a-f]{40}$/);

    git(["remote", "set-url", "origin", "https://gitee.com/o/r.git"]);
    assert.equal(detectArchRepositoryHint(root), null, "non-github origin must yield null (surface forbidden)");

    git(["remote", "remove", "origin"]);
    assert.equal(detectArchRepositoryHint(root), null, "no origin must yield null");
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
