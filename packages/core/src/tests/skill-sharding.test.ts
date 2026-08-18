import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shardSkillDocument,
  renderShardedContent,
  type ShardedSkillDocument,
  type SkillShard,
} from "../routing/skill-sharding";
import { SkillShardRecaller } from "../routing/skill-shard-recaller";
import { DEFAULT_ROUTING_CONFIG, type RoutingEmbeddingService } from "../routing/types";

/** Deterministic fake embedding: keyword-count vectors over a fixed lexicon. */
const LEXICON = ["deploy", "database", "testing", "logging", "router", "cache"];
const DIMS = LEXICON.length;

function fakeEmbed(text: string): Float32Array {
  const vec = new Float32Array(DIMS);
  const lower = text.toLowerCase();
  for (const [i, word] of LEXICON.entries()) {
    let count = 0;
    let at = lower.indexOf(word);
    while (at >= 0) {
      count += 1;
      at = lower.indexOf(word, at + word.length);
    }
    vec[i] = count;
  }
  return vec;
}

function fakeService(ready = true): RoutingEmbeddingService {
  return {
    embed: (t: string) => Promise.resolve(fakeEmbed(t)),
    embedBatch: (ts: string[]) => Promise.all(ts.map((t) => fakeEmbed(t))),
    getDimensions: () => DIMS,
    isReady: () => ready,
    startWarmup: () => {},
  };
}

function bigDoc(sections: Array<[string, string]>, intro = "Intro before headings."): string {
  return `${intro}\n\n${sections.map(([h, b]) => `## ${h}\n${b}`).join("\n\n")}`;
}

test("shardSkillDocument returns null below the min-chars threshold (small skills stay full)", () => {
  const doc = shardSkillDocument("# Tiny\n\nshort skill", { minChars: 100, maxShardChars: 400 });
  assert.equal(doc, null);
});

test("shardSkillDocument splits at markdown headings and preserves the header", () => {
  const body = bigDoc([
    ["Alpha", "a".repeat(50)],
    ["Beta", "b".repeat(50)],
    ["Gamma", "c".repeat(50)],
  ]);
  const doc = shardSkillDocument(body, { minChars: 100, maxShardChars: 400 })!;
  assert.ok(doc);
  assert.equal(doc.header.includes("Intro before headings"), true);
  assert.equal(doc.shards.length, 3);
  assert.deepEqual(
    doc.shards.map((s) => s.heading),
    ["Alpha", "Beta", "Gamma"]
  );
  assert.deepEqual(
    doc.shards.map((s) => s.id),
    [1, 2, 3]
  );
  // Each shard text starts with its own heading line.
  for (const shard of doc.shards) {
    assert.ok(shard.text.startsWith(`## ${shard.heading}`));
  }
});

test("shardSkillDocument hard-splits oversized sections with (continued) headings", () => {
  const hugeBody = Array.from({ length: 30 }, (_, i) => `line-${i} ${"x".repeat(40)}`).join("\n");
  const body = bigDoc([
    ["Huge", hugeBody],
    ["Small", "y".repeat(20)],
  ]);
  const doc = shardSkillDocument(body, { minChars: 100, maxShardChars: 300 })!;
  assert.ok(doc);
  const hugeParts = doc.shards.filter((s) => s.heading.startsWith("Huge"));
  assert.ok(hugeParts.length >= 3, `expected ≥3 parts, got ${hugeParts.length}`);
  assert.ok(hugeParts.some((s) => s.heading.includes("(continued 2)")));
  for (const part of hugeParts) {
    assert.ok(part.text.trim().length > 0, "no empty parts");
  }
  // The trailing small section survives as its own shard.
  assert.ok(doc.shards.some((s) => s.heading === "Small"));
});

test("shardSkillDocument keeps a single oversized LINE intact (mid-line splits corrupt code)", () => {
  const body = bigDoc([["OneLiner", "z".repeat(1000)]]);
  const doc = shardSkillDocument(body, { minChars: 100, maxShardChars: 300 })!;
  assert.ok(doc);
  // The heading line and the long line may split at the line boundary, but the
  // 1000-char line itself must land whole in exactly ONE shard.
  const carriers = doc.shards.filter((s) => s.text.includes("z".repeat(1000)));
  assert.equal(carriers.length, 1);
  for (const shard of doc.shards) {
    assert.ok(shard.text.trim().length > 0, "no empty parts");
  }
});

test("shardSkillDocument returns null for a monolithic doc without headings", () => {
  const doc = shardSkillDocument("z".repeat(5000), { minChars: 100, maxShardChars: 400 });
  assert.equal(doc, null);
});

test("renderShardedContent includes header, full index and picked sections only", () => {
  const body = bigDoc([
    ["Alpha", "alpha-content"],
    ["Beta", "beta-content"],
    ["Gamma", "gamma-content"],
  ]);
  const doc = shardSkillDocument(body, { minChars: 1, maxShardChars: 4000 })!;
  const rendered = renderShardedContent(doc, [doc.shards[1]!]);
  assert.ok(rendered.includes("Intro before headings"));
  assert.ok(rendered.includes("## Section index"));
  assert.ok(rendered.includes("1. Alpha"));
  assert.ok(rendered.includes("3. Gamma"));
  assert.ok(rendered.includes("beta-content"));
  assert.equal(rendered.includes("alpha-content"), false);
  assert.equal(rendered.includes("gamma-content"), false);
  assert.ok(rendered.includes("2 more section(s) omitted"));
});

test("SkillShardRecaller ranks the query-matching shard first (fake embeddings)", async () => {
  const doc: ShardedSkillDocument = {
    header: "hdr",
    totalChars: 999,
    shards: [
      { id: 1, heading: "Router cache setup", text: "cache router cache" },
      { id: 2, heading: "Database deploy runbook", text: "deploy database deploy" },
      { id: 3, heading: "Testing guidelines", text: "testing" },
      { id: 4, heading: "Logging conventions", text: "logging" },
      { id: 5, heading: "Extra", text: "misc notes" },
    ],
  };
  const recaller = new SkillShardRecaller(fakeService(true));
  const picked = await recaller.recall("how to deploy the database", doc, 2);
  assert.ok(picked);
  assert.equal(picked.length, 2);
  assert.equal(picked[0]!.heading, "Database deploy runbook");
});

test("SkillShardRecaller fails open: not-ready service → null, small shard set → null", async () => {
  const doc: ShardedSkillDocument = {
    header: "",
    totalChars: 99,
    shards: [
      { id: 1, heading: "A", text: "deploy" },
      { id: 2, heading: "B", text: "database" },
    ],
  };
  const notReady = new SkillShardRecaller(fakeService(false));
  assert.equal(await notReady.recall("deploy", doc, 1), null);
  const ready = new SkillShardRecaller(fakeService(true));
  // shards.length (2) <= topK (2) → not worth routing → null.
  assert.equal(await ready.recall("deploy", doc, 2), null);
  const recaller = new SkillShardRecaller(fakeService(true));
  assert.equal(await recaller.recall("", doc, 1), null, "empty query → null");
});

test("DEFAULT_ROUTING_CONFIG carries the G3 sharding switches", () => {
  assert.equal(DEFAULT_ROUTING_CONFIG.skillSharding, true);
  assert.equal(typeof DEFAULT_ROUTING_CONFIG.shardMinChars, "number");
  assert.equal(typeof DEFAULT_ROUTING_CONFIG.shardTopK, "number");
});
