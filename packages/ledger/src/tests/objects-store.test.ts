import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_QUOTA_BYTES, ObjectStore, ObjectStoreError, chunkIdOf } from "../index.js";

function newStore(quotaBytes?: number): { store: ObjectStore; root: string } {
  const root = mkdtempSync(join(tmpdir(), "ledger-store-"));
  return { store: new ObjectStore(root, quotaBytes === undefined ? {} : { quotaBytes }), root };
}

test("store: put/get/delete round-trip and receive-path verification", () => {
  const { store } = newStore();
  const bytes = new TextEncoder().encode("chunk payload");
  const id = store.putChunk(bytes);
  assert.equal(id, chunkIdOf(bytes));
  assert.equal(store.has(id), true);
  assert.deepEqual(store.getChunk(id), bytes);

  // Receive-path gate: bytes that do not hash to the advertised id are refused.
  assert.throws(() => store.putChunkVerified(chunkIdOf(new TextEncoder().encode("other")), bytes), ObjectStoreError);
  // Malformed ids are refused.
  assert.throws(() => store.getChunk("not-a-chunk-id"), ObjectStoreError);
  assert.throws(() => store.getChunk("b:zzzz"), ObjectStoreError);

  assert.equal(store.getChunk("b:000000000000000000000000"), undefined);
  store.deleteChunk(id);
  assert.equal(store.has(id), false);
});

test("store: usage accounting and LRU eviction under quota", async () => {
  const { store } = newStore();
  const a = new TextEncoder().encode("a".repeat(1000));
  const b = new TextEncoder().encode("b".repeat(1000));
  const idA = store.putChunk(a);
  const idB = store.putChunk(b);
  assert.equal(store.usageBytes(), 2000);
  assert.equal(DEFAULT_QUOTA_BYTES > 0, true);

  // Read A so B becomes the LRU entry (atime has ms granularity — space the
  // operations out so the ordering cannot tie).
  assert.deepEqual(store.getChunk(idA), a);
  await new Promise((resolve) => setTimeout(resolve, 10));
  // …then shrink the quota so exactly one chunk must go.
  const tight = new ObjectStore(join(mkdtempSync(join(tmpdir(), "ledger-store-")), "root"), { quotaBytes: 1500 });
  tight.putChunk(a);
  tight.putChunk(b);
  await new Promise((resolve) => setTimeout(resolve, 10));
  tight.getChunk(idA);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const evicted = tight.enforceQuota();
  assert.deepEqual(evicted, [idB]);
  assert.equal(tight.has(idA), true);
  assert.equal(tight.has(idB), false);
  assert.ok(tight.usageBytes() <= 1500);

  // Quota already satisfied → no-op.
  assert.deepEqual(store.enforceQuota(), []);
  assert.equal(store.has(idA), true);
  assert.equal(store.has(idB), true);
});
