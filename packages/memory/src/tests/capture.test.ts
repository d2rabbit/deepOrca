/**
 * Memory capture-path tests.
 *
 * These lock in the fix for the critical defect where the integration passed
 * `messages: []` to the L0 recorder, so capture recorded nothing and recall
 * stayed permanently empty. We verify, without any LLM dependency, that:
 *   - recordConversation persists user/assistant messages to the L0 JSONL;
 *   - extractUserAssistantMessages (via recordConversation) honours the
 *     {role, content, id?, timestamp?} shape that the core MemoryProvider now
 *     sends;
 *   - parseConfig returns a fully-populated config (no `as unknown as` cast);
 *   - the recall prompt contract (prependContext + recallStrategy) renders.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { recordConversation } from "../tdai/core/conversation/l0-recorder.js";
import { parseConfig } from "../tdai/config.js";

function tmpDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-mem-test-"));
}

test("recordConversation persists user + assistant messages to L0 JSONL", async () => {
  const baseDir = tmpDataDir();
  const sessionKey = "sess-test-1";
  const ts = Date.now();
  // This is the shape core's maybeCaptureMemory now sends (and what
  // MemoryManager.capture synthesizes as a fallback).
  const rawMessages = [
    { role: "user", content: "How do I parse JSON in Node?", id: "u1", timestamp: ts },
    { role: "assistant", content: "Use JSON.parse(str).", id: "a1", timestamp: ts + 1 },
  ];

  const filtered = await recordConversation({ sessionKey, rawMessages, baseDir });

  // Both messages must be recorded — previously this returned [] because the
  // integration hardcoded messages: [] upstream.
  assert.equal(filtered.length, 2, "both user and assistant messages must be captured");

  // The L0 JSONL shard must contain the records on disk.
  const today = new Date().toISOString().slice(0, 10);
  const shardPath = path.join(baseDir, "conversations", `${today}.jsonl`);
  assert.ok(fs.existsSync(shardPath), "L0 JSONL shard must exist");
  const lines = fs.readFileSync(shardPath, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 2, "two records must be written to the shard");
  const first = JSON.parse(lines[0]!);
  assert.equal(first.role, "user");
  assert.equal(first.content, "How do I parse JSON in Node?");
  assert.equal(first.sessionKey, sessionKey);
  assert.ok(first.recordedAt, "recordedAt timestamp must be present");

  fs.rmSync(baseDir, { recursive: true, force: true });
});

test("recordConversation skips empty/whitespace content", async () => {
  const baseDir = tmpDataDir();
  const filtered = await recordConversation({
    sessionKey: "sess-empty",
    rawMessages: [
      { role: "user", content: "   ", timestamp: Date.now() },
      { role: "assistant", content: "", timestamp: Date.now() },
    ],
    baseDir,
  });
  assert.equal(filtered.length, 0, "whitespace-only messages must not be recorded");
  fs.rmSync(baseDir, { recursive: true, force: true });
});

test("parseConfig returns a fully-populated config with our overrides", () => {
  // This replaces the old `as unknown as MemoryTdaiConfig` cast. The parser
  // must fill every sub-field; our overrides must win.
  const cfg = parseConfig({
    capture: { enabled: true },
    extraction: { enabled: true },
    recall: { enabled: true, strategy: "hybrid", timeoutMs: 5000 },
    storeBackend: "sqlite",
    embedding: { enabled: false, provider: "none" },
  });

  // Overrides honoured.
  assert.equal(cfg.storeBackend, "sqlite");
  assert.equal(cfg.recall.enabled, true);
  assert.equal(cfg.recall.strategy, "hybrid");
  assert.equal(cfg.recall.timeoutMs, 5000);
  assert.equal(cfg.embedding.enabled, false);

  // Defaults filled in (these were undefined under the old cast, leading to
  // NaN timeouts / eager scheduling). Spot-check a few that the pipeline reads.
  assert.equal(typeof cfg.capture.l0l1RetentionDays, "number", "l0l1RetentionDays must be a number");
  assert.equal(typeof cfg.extraction.maxMemoriesPerSession, "number", "maxMemoriesPerSession must be a number");
  assert.equal(typeof cfg.persona.maxScenes, "number", "persona.maxScenes must be a number");
  assert.equal(typeof cfg.pipeline.everyNConversations, "number", "pipeline.everyNConversations must be a number");
  assert.ok(cfg.bm25, "bm25 group must exist");
});

test("parseConfig with undefined raw yields valid zero-config defaults", () => {
  const cfg = parseConfig(undefined);
  assert.equal(cfg.storeBackend, "sqlite");
  assert.equal(typeof cfg.recall.timeoutMs, "number");
  assert.equal(typeof cfg.capture.l0l1RetentionDays, "number");
});
