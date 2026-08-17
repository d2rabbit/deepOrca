/**
 * bucket-sample tests — coverage-preserving sampling for long diagnostic
 * listings (bucket by key, top-N buckets × M samples, honest omit counts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketSample, renderBucketSample } from "../common/bucket-sample";

interface Item {
  code: string;
  msg: string;
}
const item = (code: string, n: number): Item => ({ code, msg: `${code}-${n}` });

/** 3 error codes × 200 each = 600 items — the 500-errors regression shape. */
function bigList(): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < 200; i++) out.push(item("TS2322", i));
  for (let i = 0; i < 200; i++) out.push(item("TS2345", i));
  for (let i = 0; i < 200; i++) out.push(item("ESLint8457", i));
  return out;
}

test("coverage over prefix: 600 items → 3 buckets × 5 samples + counts", () => {
  const result = bucketSample(bigList(), (i) => i.code);
  assert.equal(result.total, 600);
  assert.equal(result.buckets.length, 3);
  assert.equal(result.omittedBuckets, 0);
  for (const bucket of result.buckets) {
    assert.equal(bucket.total, 200);
    assert.equal(bucket.items.length, 5);
    assert.equal(bucket.omitted, 195);
    // first items in input order, not arbitrary
    assert.equal(bucket.items[0].msg, `${bucket.key}-0`);
  }
});

test("buckets ranked by count descending, ties by first appearance", () => {
  const items = [item("small", 0), item("big", 0), item("big", 1), item("big", 2), item("mid", 0), item("mid", 1)];
  const result = bucketSample(items, (i) => i.code);
  assert.deepEqual(
    result.buckets.map((b) => b.key),
    ["big", "mid", "small"]
  );
});

test("maxBuckets drops whole buckets and reports the count", () => {
  const items: Item[] = [];
  const keys = ["a", "b", "c", "d", "e", "f", "g"];
  keys.forEach((k, idx) => {
    for (let i = 0; i < idx + 1; i++) items.push(item(k, i));
  });
  const result = bucketSample(items, (i) => i.code, { maxBuckets: 5, perBucket: 2 });
  assert.equal(result.buckets.length, 5);
  assert.equal(result.omittedBuckets, 2);
  // largest buckets survive
  assert.deepEqual(
    result.buckets.map((b) => b.key),
    ["g", "f", "e", "d", "c"]
  );
});

test("empty input", () => {
  const result = bucketSample([], () => "x");
  assert.equal(result.total, 0);
  assert.equal(result.buckets.length, 0);
  assert.equal(result.omittedBuckets, 0);
});

test("render: lines carry per-type omit counts and dropped-bucket trailer", () => {
  const result = bucketSample(bigList(), (i) => i.code, { maxBuckets: 2, perBucket: 1 });
  const lines = renderBucketSample(result, (i) => i.msg);
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith("TS2322 (200): TS2322-0 · …and 199 more of this type"));
  assert.equal(lines[2], "…and 1 more types omitted");
});
