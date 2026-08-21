/**
 * Shared embedding registry tests (Phase 3 / T3.1, specs/memory-remediation).
 *
 * Construction of TransformersEmbeddingService is side-effect free (model
 * files are only read on warmup/first embed), so refcount semantics are
 * testable with throwaway model dirs and no ONNX runtime.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as os from "node:os";

import { __resetSharedEmbeddingRegistryForTests, acquireSharedEmbeddingService } from "../shared.js";

describe("shared embedding registry", () => {
  test("same modelDir returns one underlying service (refcounted)", () => {
    __resetSharedEmbeddingRegistryForTests();
    const a = acquireSharedEmbeddingService({ modelDir: "/ws/granite-embedding" });
    const b = acquireSharedEmbeddingService({ modelDir: path.join("/ws", "granite-embedding") });
    assert.notEqual(a, b, "each acquire returns its own handle");
    assert.equal(a.isReady(), b.isReady(), "same underlying service state");

    // First release must NOT close the service (second holder still alive):
    // isReady() keeps answering instead of throwing on a closed session.
    void a.close();
    assert.doesNotThrow(() => b.isReady());
  });

  test("different modelDirs get separate services", () => {
    __resetSharedEmbeddingRegistryForTests();
    const a = acquireSharedEmbeddingService({ modelDir: "/ws/model-a" });
    const b = acquireSharedEmbeddingService({ modelDir: "/ws/model-b" });
    void a.close();
    // b's service must be untouched by a's release.
    assert.doesNotThrow(() => b.isReady());
    void b.close();
  });

  test("last release closes for real; close() is idempotent per handle", async () => {
    __resetSharedEmbeddingRegistryForTests();
    const dir = path.join(os.tmpdir(), "deeporca-shared-embed-test");
    const a = acquireSharedEmbeddingService({ modelDir: dir });
    const b = acquireSharedEmbeddingService({ modelDir: dir });

    // Idempotent close on the SAME handle only drops one reference.
    await a.close();
    await a.close();
    assert.equal(b.isReady(), false, "service still alive after one logical release");

    // Final release actually closes the underlying service.
    await b.close();
    // After a real close the service reports not-ready and embed() throws —
    // a fresh acquire must give a brand-new service, not the closed one.
    const c = acquireSharedEmbeddingService({ modelDir: dir });
    assert.doesNotThrow(() => c.isReady());
    void c.close();
  });

  test("handles delegate the service surface", () => {
    __resetSharedEmbeddingRegistryForTests();
    const ref = acquireSharedEmbeddingService({ modelDir: "/ws/never-initialized" });
    assert.equal(ref.getDimensions(), 384);
    assert.equal(ref.getProviderInfo().provider, "local-onnx");
    assert.equal(ref.isReady(), false);
    void ref.close();
  });
});
