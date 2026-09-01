/**
 * Whole-workspace token accounting (main tools/tokens-summary.ts) — the
 * "whatever the operation is, if it touched an LLM it gets counted" rule.
 * Pins: sums usage across ALL index entries INCLUDING silent-subagent
 * sessions, per-model tallies, cache-read separation, and zero-safe reads on
 * a missing index.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildTokenSummary, projectSessionsIndexPath } from "../main/tools/tokens-summary";

async function makeIndex(root: string, entries: unknown[]): Promise<string> {
  // mirror getProjectCode: path separators → dashes (simple POSIX root here)
  const code = root.replace(/\//g, "-");
  const dir = path.join(root, "projects", code);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, "sessions-index.json");
  await fsp.writeFile(file, JSON.stringify({ version: 1, entries }), "utf-8");
  return file;
}

const usage = {
  prompt_tokens: 100,
  completion_tokens: 40,
  total_tokens: 140,
  prompt_cache_hit_tokens: 60,
  total_reqs: 2,
};

test("tokens-summary: aggregates ALL sessions incl. silent subagents, per model", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "toksum-"));
  try {
    const file = await makeIndex(root, [
      { usage, usagePerModel: { "deepseek-chat": { ...usage } }, updateTime: "2026-09-01T10:00:00.000Z" },
      {
        isSilentSubagent: true,
        usage,
        usagePerModel: { "deepseek-reasoner": { ...usage, total_reqs: 1 } },
        updateTime: "2026-09-01T11:00:00.000Z",
      },
    ]);
    const s = buildTokenSummary("/r", file);
    assert.equal(s.sessions, 2);
    assert.equal(s.silentSessions, 1);
    assert.equal(s.totalTokens, 280);
    // requests = sum of entry-level total_reqs (2 + 2)
    assert.equal(s.requests, 4);
    assert.equal(s.lastAt, "2026-09-01T11:00:00.000Z");
    assert.equal(s.perModel["deepseek-chat"].total, 140);
    // per-model tallies pass the persisted counters straight through
    assert.equal(s.perModel["deepseek-chat"].reqs, 2);
    assert.equal(s.perModel["deepseek-reasoner"].reqs, 1);
    assert.equal(s.perModel["deepseek-chat"].cacheRead, 60);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("tokens-summary: missing index → zero summary (no throw)", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "toksum2-"));
  try {
    const s = buildTokenSummary("/r", path.join(root, "projects", "none", "sessions-index.json"));
    assert.equal(s.sessions, 0);
    assert.equal(s.totalTokens, 0);
    assert.equal(s.lastAt, null);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("tokens-summary: index path mirrors core persistence layout", () => {
  const p = projectSessionsIndexPath("/home/u/.deeporca", "/work/repo");
  assert.match(p, /projects[\\/]-work-repo[\\/]sessions-index\.json$/);
});
