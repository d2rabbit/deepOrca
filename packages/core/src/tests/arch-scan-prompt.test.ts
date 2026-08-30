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
import { buildArchScanTaskPrompt, backgroundTaskRuntimeContext } from "../session-manager-tasks";
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
