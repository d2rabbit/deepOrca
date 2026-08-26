/**
 * Phase 4 tests (specs/memory-remediation):
 *
 * 1. T4.1 — MemoryManager's agent-callable retrieval tools: definition shape
 *    and executeTool dispatch through a real (SQLite-backed, LLM-free) init.
 * 2. T4.3 — lineage entries travel under their real "system" role: persisted
 *    to L0 (searchable) but dropped from the L1 extraction input.
 * 3. T4.2 — the retention cleaner prunes expired shards, keeps fresh ones.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { MemoryManager } from "../memory-manager.js";
import {
  recordConversation,
  readConversationMessagesGroupedBySessionId,
} from "../tdai/core/conversation/l0-recorder.js";
import { filterL1VisibleMessages } from "../tdai/utils/pipeline-factory.js";
import { LocalMemoryCleaner } from "../tdai/utils/memory-cleaner.js";

function tmpDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-mem-phase4-"));
}

// ── T4.1: retrieval tools ────────────────────────────────────────────────────

test("getToolDefinitions exposes both retrieval tools in OpenAI shape", () => {
  const mgr = new MemoryManager({
    baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "k",
    model: "m",
    dataDir: tmpDataDir(),
  });
  const defs = mgr.getToolDefinitions();
  assert.deepEqual(
    defs.map((d) => d.function.name),
    ["tdai_memory_search", "tdai_conversation_search"]
  );
  for (const def of defs) {
    assert.equal(def.type, "function");
    assert.ok(def.function.description.length > 20);
    assert.equal(def.function.parameters.type, "object");
    assert.deepEqual(def.function.parameters.required, ["query"]);
  }
});

test("executeTool dispatches against an initialized pipeline (LLM-free)", async () => {
  const dir = tmpDataDir();
  const mgr = new MemoryManager({ baseUrl: "http://127.0.0.1:1/v1", apiKey: "k", model: "m", dataDir: dir });
  await mgr.init();
  try {
    const memory = await mgr.executeTool("tdai_memory_search", { query: "nonexistent thing" });
    assert.equal(typeof memory, "string");
    const conversation = await mgr.executeTool("tdai_conversation_search", { query: "nonexistent thing" });
    assert.equal(typeof conversation, "string");

    await assert.rejects(mgr.executeTool("tdai_nope", { query: "x" }), /Unknown memory tool/);
    await assert.rejects(mgr.executeTool("tdai_memory_search", { query: "" }), /non-empty string 'query'/);
    await assert.rejects(mgr.executeTool("tdai_memory_search", { query: 42 }), /non-empty string 'query'/);
  } finally {
    await mgr.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── T4.3: system-role lineage ────────────────────────────────────────────────

test("lineage entries persist to L0 as system and are excluded from L1 input", async () => {
  const dir = tmpDataDir();
  const sessionKey = "sess-lineage";
  const ts = Date.now();
  try {
    const recorded = await recordConversation({
      sessionKey,
      baseDir: dir,
      rawMessages: [
        { role: "user", content: "finish the release", id: "u1", timestamp: ts },
        { role: "assistant", content: "Done, v1 is out.", id: "a1", timestamp: ts + 1 },
        {
          role: "system",
          content: "<task-lineage>merge: feature-x → dev</task-lineage>",
          id: "s1",
          timestamp: ts + 2,
        },
      ],
    });
    assert.equal(recorded.length, 3, "system entry must be recorded alongside dialogue");

    const lines = fs
      .readFileSync(path.join(dir, "conversations", `${localShardDate()}.jsonl`), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { role: string; content: string });
    const roles = lines.map((l) => l.role).sort();
    assert.deepEqual(roles, ["assistant", "system", "user"], "L0 keeps the real roles");
    assert.ok(lines.some((l) => l.role === "system" && l.content.includes("<task-lineage>")));

    // L0 stays searchable (reader returns the system entry)…
    const groups = await readConversationMessagesGroupedBySessionId(sessionKey, dir, undefined, undefined, 10);
    const allRoles = groups.flatMap((g) => g.messages.map((m) => m.role));
    assert.ok(allRoles.includes("system"), "L0 reader surfaces system entries for conversation search");

    // …but the L1 extraction input filters them out.
    const visible = filterL1VisibleMessages(groups.flatMap((g) => g.messages));
    assert.deepEqual([...new Set(visible.map((m) => m.role).sort())], ["assistant", "user"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function localShardDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── T4.2: retention cleaner ──────────────────────────────────────────────────

test("retention cleaner honors per-layer retention (L0 30 / L1 90)", async () => {
  const dir = tmpDataDir();
  const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 3600 * 1000);
  const fortyDaysAgoShard = `${fortyDaysAgo.getFullYear()}-${String(fortyDaysAgo.getMonth() + 1).padStart(2, "0")}-${String(
    fortyDaysAgo.getDate()
  ).padStart(2, "0")}.jsonl`;
  const mkShard = (rel: "conversations" | "records", name: string) => {
    fs.mkdirSync(path.join(dir, rel), { recursive: true });
    fs.writeFileSync(path.join(dir, rel, name), "{}\n");
  };
  // L0: ancient (deleted) + 40-day-old (older than 30 → deleted) + today (kept).
  mkShard("conversations", "2020-01-01.jsonl");
  mkShard("conversations", fortyDaysAgoShard);
  mkShard("conversations", `${localShardDate()}.jsonl`);
  // L1: ancient (deleted) + 40-day-old (younger than the 90-day L1 retention → KEPT) + today.
  mkShard("records", "2020-01-01.jsonl");
  mkShard("records", fortyDaysAgoShard);
  mkShard("records", `${localShardDate()}.jsonl`);
  // Non-shard files must never be touched.
  mkShard("conversations", "notes.md");

  const cleaner = new LocalMemoryCleaner({
    baseDir: dir,
    l0RetentionDays: 30,
    l1RetentionDays: 90,
    cleanTime: "03:30",
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
  await cleaner.runOnce();
  cleaner.destroy();

  assert.deepEqual(
    fs.readdirSync(path.join(dir, "conversations")).sort(),
    [`${localShardDate()}.jsonl`, "notes.md"],
    "L0: expired + 40-day shards deleted, fresh + non-shard kept"
  );
  assert.deepEqual(
    fs.readdirSync(path.join(dir, "records")).sort(),
    [fortyDaysAgoShard, `${localShardDate()}.jsonl`].sort(),
    "L1: 40-day shard survives the longer 90-day retention"
  );
});
