/**
 * Index job history store (main tools/jobs-store.ts) — the 索引与知识 domain's
 * record source for the task hub. Pins: round-trip save/list, newest-first,
 * id-shape validation (path-traversal guard), prune cap, and garbage skips.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listIndexJobs, saveIndexJobRecord } from "../main/tools/jobs-store";

const record = (startedAt: string, mode: "init" | "update" = "update") => ({
  root: "",
  mode,
  status: "done" as const,
  startedAt,
  endedAt: startedAt,
  stages: [{ id: "codegraph", status: "done" }],
});

test("jobs-store: save + list round-trip, newest first, id shape enforced", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "jobshub-"));
  try {
    const a = saveIndexJobRecord(root, record("2026-09-01T09:00:00.000Z"))!;
    const b = saveIndexJobRecord(root, record("2026-09-01T10:00:00.000Z"))!;
    assert.match(a.id, /^job-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}$/);
    const list = listIndexJobs(root);
    assert.deepEqual(
      list.map((r) => r.id),
      [b.id, a.id],
      "newest job first"
    );
    // A foreign JSON file in the dir is skipped, not fatal.
    await fsp.writeFile(path.join(root, ".deeporca", "jobs", "evil.json"), JSON.stringify({ id: "../../x" }));
    assert.equal(listIndexJobs(root).length, 2, "invalid id shape skipped");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("jobs-store: prune keeps the newest 20", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "jobshub2-"));
  try {
    const base = new Date("2026-09-01T00:00:00.000Z").getTime();
    for (let i = 0; i < 23; i++) {
      saveIndexJobRecord(root, record(new Date(base + i * 60_000).toISOString()));
    }
    assert.equal(listIndexJobs(root).length, 20);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
