/**
 * Memory capture-path + lifecycle tests.
 *
 * capture.test: locks in the fix for the critical defect where the integration
 * passed `messages: []` to the L0 recorder, so capture recorded nothing and
 * recall stayed permanently empty. We verify, without any LLM dependency, that:
 *   - recordConversation persists user/assistant messages to the L0 JSONL;
 *   - extractUserAssistantMessages (via recordConversation) honours the
 *     {role, content, id?, timestamp?} shape that the core MemoryProvider now
 *     sends;
 *   - parseConfig returns a fully-populated config (no `as unknown as` cast).
 *
 * lifecycle.test: L1 oldest-first paging (no stranded records), checkpoint
 * corruption quarantine (no silent default-overwrite).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  recordConversation,
  readConversationMessagesGroupedBySessionId,
} from "../tdai/core/conversation/l0-recorder.js";
import { parseConfig } from "../tdai/config.js";
import { CheckpointManager } from "../tdai/utils/checkpoint.js";

function tmpDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-mem-test-"));
}

/**
 * Local YYYY-MM-DD, mirroring how the L0 recorder names its daily shard
 * (`formatLocalDate` in l0-recorder.ts, which is module-private).
 *
 * Must NOT use toISOString(), which is UTC: east-of-UTC machines then look for
 * yesterday's shard between local midnight and the UTC rollover — eight hours a
 * day in UTC+8. CI runs in UTC, so local date == UTC date there and this never
 * showed up.
 */
function localShardDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  const today = localShardDate();
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

// ── Phase 3: L1 oldest-first paging ─────────────────────────────────────────

test("L1 JSONL reader returns the OLDEST page when backlog > limit (no stranding)", async () => {
  // Regression: the JSONL reader used allMessages.slice(-limit) (newest), so a
  // 100-message backlog processed in pages of 50 would process msgs 51-100,
  // advance the cursor past all 100, and leave msgs 1-50 permanently behind.
  // Oldest-first (slice(0, limit)) processes 1-50 first; the next page reads
  // 51-100 via the cursor.
  const baseDir = tmpDataDir();
  const sessionKey = "sess-page";
  // Record 100 messages with strictly increasing timestamps.
  const base = Date.now();
  for (let i = 0; i < 100; i++) {
    await recordConversation({
      sessionKey,
      rawMessages: [{ role: "user", content: `msg-${i}`, timestamp: base + i }],
      baseDir,
      afterTimestamp: base + i - 1,
    });
  }

  // First page (limit 50): must be the OLDEST 50 (msg-0 .. msg-49).
  const page1 = await readConversationMessagesGroupedBySessionId(sessionKey, baseDir, undefined, undefined, 50);
  const page1Texts = (page1[0]?.messages ?? []).map((m) => m.content);
  assert.equal(page1Texts.length, 50, "first page must contain 50 messages");
  assert.equal(page1Texts[0], "msg-0", "first page must start at the oldest message");
  assert.equal(page1Texts[49], "msg-49", "first page must end at the 50th oldest");

  fs.rmSync(baseDir, { recursive: true, force: true });
});

// ── Phase 3: checkpoint corruption quarantine ────────────────────────────────

test("CheckpointManager quarantines a corrupt checkpoint instead of silently resetting", async () => {
  // Regression: a corrupt (unparseable) checkpoint was caught and replaced with
  // defaults silently; the next mutation then OVERWROTE the file with defaults,
  // destroying cursors/persona state. Now the bad file is renamed aside.
  const dataDir = tmpDataDir();
  const cp = new CheckpointManager(dataDir);
  // Write a valid checkpoint first.
  const valid = await cp.read();
  valid.total_processed = 42;
  await cp.write(valid);

  // Corrupt the file on disk.
  const cpPath = path.join(dataDir, ".metadata", "recall_checkpoint.json");
  assert.ok(fs.existsSync(cpPath), "checkpoint file must exist after write");
  fs.writeFileSync(cpPath, "{ this is not valid json", "utf8");

  // Read must return defaults (graceful), not throw.
  const recovered = await cp.read();
  assert.equal(recovered.total_processed, 0, "corrupt read falls back to defaults");

  // The corrupt file must have been quarantined (renamed to .corrupt-<ts>),
  // NOT left in place to be overwritten on the next write.
  const metaFiles = fs.readdirSync(path.join(dataDir, ".metadata"));
  const quarantined = metaFiles.find((f) => f.startsWith("recall_checkpoint.json.corrupt-"));
  assert.ok(quarantined, "corrupt checkpoint must be quarantined (renamed)");

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("CheckpointManager returns defaults silently when the file is missing (first run)", async () => {
  const dataDir = tmpDataDir();
  const cp = new CheckpointManager(dataDir);
  const recovered = await cp.read();
  assert.equal(recovered.total_processed, 0);
  // No quarantine file should be created for a simple missing-file case.
  const metaDir = path.join(dataDir, ".metadata");
  if (fs.existsSync(metaDir)) {
    const quarantined = fs.readdirSync(metaDir).find((f) => f.includes(".corrupt-"));
    assert.equal(quarantined, undefined, "missing file must not be quarantined");
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
});
