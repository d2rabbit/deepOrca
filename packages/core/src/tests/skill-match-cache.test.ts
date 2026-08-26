/**
 * SkillMatchCache tests (Phase 3 / T3.2, specs/memory-remediation).
 *
 * Pure cache semantics: roundtrip, pool-signature sensitivity (a skills-list
 * change must invalidate), empty-result caching ("no match" is a valid
 * repeatable answer), FIFO eviction, and re-set refreshing recency.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SkillMatchCache } from "../common/skill-match-cache.js";

describe("SkillMatchCache", () => {
  test("roundtrips a match for the same prompt + pool", () => {
    const cache = new SkillMatchCache();
    cache.set("a,b", "build the slides please", ["bento-slides"]);
    assert.deepEqual(cache.get("a,b", "build the slides please"), ["bento-slides"]);
    assert.equal(cache.get("a,b", "different prompt"), undefined);
  });

  test("pool signature change invalidates (skills added/removed/renamed)", () => {
    const cache = new SkillMatchCache();
    const before = SkillMatchCache.poolSignature([{ name: "a" }, { name: "b" }]);
    const after = SkillMatchCache.poolSignature([{ name: "b" }, { name: "a" }, { name: "c" }]);
    assert.notEqual(before, after);
    assert.equal(SkillMatchCache.poolSignature([{ name: "b" }, { name: "a" }]), before, "order-insensitive");

    cache.set(before, "prompt", ["a"]);
    assert.equal(cache.get(after, "prompt"), undefined);
  });

  test("empty results are cached and distinguishable from a miss", () => {
    const cache = new SkillMatchCache();
    cache.set("a", "hello", []);
    const hit = cache.get("a", "hello");
    assert.notEqual(hit, undefined);
    assert.deepEqual(hit, []);
  });

  test("evicts FIFO beyond capacity; re-set refreshes recency", () => {
    const cache = new SkillMatchCache(2);
    cache.set("p", "one", ["x"]);
    cache.set("p", "two", ["x"]);
    cache.set("p", "three", ["x"]);
    assert.equal(cache.get("p", "one"), undefined, "oldest evicted");
    assert.deepEqual(cache.get("p", "two"), ["x"]);

    // Touch "two" by re-setting it — it must now outlive a newer entry.
    cache.set("p", "two", ["x", "y"]);
    cache.set("p", "four", ["x"]);
    assert.equal(cache.get("p", "three"), undefined);
    assert.deepEqual(cache.get("p", "two"), ["x", "y"]);
    assert.equal(cache.size, 2);
  });

  test("clear() drops everything", () => {
    const cache = new SkillMatchCache();
    cache.set("p", "q", ["z"]);
    cache.clear();
    assert.equal(cache.get("p", "q"), undefined);
    assert.equal(cache.size, 0);
  });
});
