/**
 * L1 extraction output-validator tests (deterministic, zero-LLM) + prompt
 * hard-rule presence.
 *
 * Locks in:
 *   - sanitizeSourceMessageIds: unknown references reset, known kept;
 *   - isDroppableContent: empty / >500 chars / punctuation-only dropped;
 *   - findFabricatedDates: notation-insensitive source match, fabricated
 *     full-precision dates detected;
 *   - EXTRACT_MEMORIES_SYSTEM_PROMPT carries the time-fidelity and atomicity
 *     hard rules.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeSourceMessageIds, isDroppableContent, findFabricatedDates } from "../tdai/core/record/l1-extractor.js";
import { EXTRACT_MEMORIES_SYSTEM_PROMPT } from "../tdai/core/prompts/l1-extraction.js";

test("sanitizeSourceMessageIds: keeps known ids, resets hallucinated ones", () => {
  const known = new Set(["m1", "m2", "m3"]);
  assert.deepEqual(sanitizeSourceMessageIds(["m1", "m2"], known), ["m1", "m2"]);
  assert.deepEqual(sanitizeSourceMessageIds(["m1", "ghost-9", "m3", "ghost-1"], known), ["m1", "m3"]);
  assert.deepEqual(sanitizeSourceMessageIds([], known), []);
  // all-hallucinated → empty lineage, not a throw
  assert.deepEqual(sanitizeSourceMessageIds(["x", "y"], known), []);
});

test("isDroppableContent: empty, oversized, and letter-less blobs drop", () => {
  assert.equal(isDroppableContent("用户喜欢简洁的回答"), false);
  assert.equal(isDroppableContent(""), true);
  assert.equal(isDroppableContent("   "), true);
  assert.equal(isDroppableContent("！！！？？。"), true); // no letter/digit
  assert.equal(isDroppableContent("x".repeat(501)), true); // non-atomic blob
  assert.equal(isDroppableContent("x".repeat(500)), false);
});

test("findFabricatedDates: notation-insensitive — CN source satisfies ISO content date", () => {
  const sources = ["我们 2025年3月1日 开了 kickoff 会"];
  assert.deepEqual(findFabricatedDates("用户在 2025-03-01 参加了 kickoff 会", sources), []);
});

test("findFabricatedDates: precision the source never had is flagged", () => {
  const sources = ["三月的预算会开过了"]; // no full date anywhere
  assert.deepEqual(findFabricatedDates("用户在 2025-03-01 参加了预算会", sources), ["2025-03-01"]);
});

test("findFabricatedDates: month-precision source does NOT satisfy a full date", () => {
  const sources = ["2025-03 的预算会"]; // ISO month only, no day
  assert.deepEqual(findFabricatedDates("用户在 2025-03-01 参加了预算会", sources), ["2025-03-01"]);
});

test("findFabricatedDates: multiple fabricated dates, deduped literals", () => {
  const sources = ["无关内容"];
  const found = findFabricatedDates("2024-01-02 与 2024-01-02 和 2023-05-06", sources);
  assert.deepEqual(found, ["2024-01-02", "2023-05-06"]);
});

test("system prompt carries the time-fidelity and atomicity hard rules", () => {
  assert.ok(EXTRACT_MEMORIES_SYSTEM_PROMPT.includes("时间保真"));
  assert.ok(EXTRACT_MEMORIES_SYSTEM_PROMPT.includes("不得补成"));
  assert.ok(EXTRACT_MEMORIES_SYSTEM_PROMPT.includes("timestamp 属于源数据"));
  assert.ok(EXTRACT_MEMORIES_SYSTEM_PROMPT.includes("不要虚构"));
  assert.ok(EXTRACT_MEMORIES_SYSTEM_PROMPT.includes("原子但有叙事"));
  assert.ok(EXTRACT_MEMORIES_SYSTEM_PROMPT.includes("必须拆成多条"));
});
