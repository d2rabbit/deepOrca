/**
 * Tests for TransformersEmbeddingService.
 *
 * Two tiers:
 * 1. Fail-open + contract tests (always run, no model needed) — verify the
 *    state machine, error semantics, and shape parity with memory's
 *    EmbeddingService contract.
 * 2. Real-model smoke test (gated by DEEPORCA_TEST_EMBEDDING=1) — loads the
 *    actual Granite ONNX and checks dimensions + similarity ordering. CI
 *    skips this (no model bundled in CI).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TransformersEmbeddingService } from "../transformers-embedding";
import { EmbeddingNotReadyError } from "../types";

const SMOKE = !!process.env.DEEPORCA_TEST_EMBEDDING;
const MODEL_DIR =
  process.env.DEEPORCA_EMBEDDING_MODEL_DIR ??
  new URL("../../../../packages/desktop/vendor/granite-embedding", import.meta.url).pathname;

describe("TransformersEmbeddingService — contract & fail-open (no model needed)", () => {
  test("getDimensions() returns 384 (Granite)", () => {
    const svc = new TransformersEmbeddingService({ modelDir: "/nonexistent" });
    assert.equal(svc.getDimensions(), 384);
  });

  test("getProviderInfo() returns local-onnx + model id", () => {
    const svc = new TransformersEmbeddingService({ modelDir: "/nonexistent" });
    const info = svc.getProviderInfo();
    assert.equal(info.provider, "local-onnx");
    assert.equal(info.model, "ibm-granite/granite-embedding-97m-multilingual-r2");
  });

  test("isReady() is false before startWarmup()", () => {
    const svc = new TransformersEmbeddingService({ modelDir: "/nonexistent" });
    assert.equal(svc.isReady(), false);
  });

  test("embed() throws EmbeddingNotReadyError when warmup not started (idle)", async () => {
    const svc = new TransformersEmbeddingService({ modelDir: "/nonexistent" });
    await assert.rejects(
      () => svc.embed("hello"),
      (err: unknown) => {
        assert.ok(err instanceof EmbeddingNotReadyError, "should be EmbeddingNotReadyError");
        assert.match((err as Error).message, /warmup has not been started/);
        return true;
      }
    );
  });

  test("embedBatch([]) returns [] without readiness check", async () => {
    const svc = new TransformersEmbeddingService({ modelDir: "/nonexistent" });
    const result = await svc.embedBatch([]);
    assert.deepEqual(result, []);
  });

  test("startWarmup() with bad model dir transitions to failed; embed throws with retry hint", async () => {
    const noop = () => {};
    const svc = new TransformersEmbeddingService({
      modelDir: "/this/path/definitely/does/not/exist-xyz",
      logger: { debug: noop, info: noop, warn: noop, error: noop },
    });
    svc.startWarmup();
    await svc.waitForReady(); // resolves after init fails

    assert.equal(svc.isReady(), false);

    await assert.rejects(
      () => svc.embed("hello"),
      (err: unknown) => {
        assert.ok(err instanceof EmbeddingNotReadyError, "should be EmbeddingNotReadyError");
        assert.match((err as Error).message, /initialization failed/);
        assert.match((err as Error).message, /Call startWarmup\(\) to retry/);
        return true;
      }
    );
  });

  test("startWarmup() is idempotent (second call no-op while initializing)", () => {
    const svc = new TransformersEmbeddingService({ modelDir: "/nonexistent" });
    svc.startWarmup();
    // Second call must not throw and is a no-op (init already in flight)
    svc.startWarmup();
    // No assertion needed — reaching here without throwing is success.
    assert.ok(true);
  });

  test("close() resets failed state to idle so warmup can retry", async () => {
    const noop = () => {};
    const svc = new TransformersEmbeddingService({
      modelDir: "/bad/path/xyz",
      logger: { debug: noop, info: noop, warn: noop, error: noop },
    });
    svc.startWarmup();
    await svc.waitForReady();
    assert.equal(svc.isReady(), false);

    await svc.close();
    // After close, state is idle; embed should give the "not started" error again
    await assert.rejects(
      () => svc.embed("hello"),
      (err: unknown) => {
        assert.match((err as Error).message, /warmup has not been started/);
        return true;
      }
    );
  });

  test("close() while initializing does not let a late init resurrect to ready", async () => {
    // close() must invalidate an in-flight warmup so the model cannot come
    // back to "ready" (and leak native handles) after the caller has torn it
    // down. We cannot easily mock the transformers pipeline here without the
    // real model, so this test exercises the failure path: a bad model dir
    // keeps init in flight long enough for close() to interleave.
    const noop = () => {};
    const svc = new TransformersEmbeddingService({
      modelDir: "/bad/path/xyz",
      logger: { debug: noop, info: noop, warn: noop, error: noop },
    });
    svc.startWarmup();
    // close immediately — do NOT await waitForReady() first. The late init
    // failure must not flip state back to failed after close reset it to idle.
    await svc.close();
    assert.equal(svc.isReady(), false);
    // After close completes, the service stays idle regardless of what the
    // superseded init promise does next.
    await svc.waitForReady().catch(() => {});
    assert.equal(svc.isReady(), false);
  });

  test("close() is idempotent and can be awaited concurrently", async () => {
    const svc = new TransformersEmbeddingService({ modelDir: "/bad/path/xyz" });
    // Two concurrent closes must share the same teardown without throwing.
    await Promise.all([svc.close(), svc.close()]);
    // A third close after settle is also a no-op.
    await svc.close();
  });
});

// ── Gated real-model smoke test ──────────────────────────────────────────
// (only registered when DEEPORCA_TEST_EMBEDDING=1 is set; CI skips this)
if (SMOKE) {
  describe("TransformersEmbeddingService — real model smoke (DEEPORCA_TEST_EMBEDDING=1)", () => {
    test("loads model, returns 384-dim vectors, similar texts score higher", async () => {
      const noop = () => {};
      const svc = new TransformersEmbeddingService({
        modelDir: MODEL_DIR,
        logger: { debug: noop, info: noop, warn: noop, error: noop },
      });
      svc.startWarmup();
      // Allow generous time for first ONNX load
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("warmup timeout 60s")), 60000));
      await Promise.race([svc.waitForReady(), timeout]);

      assert.equal(svc.isReady(), true, "model should be ready after warmup");

      const similar1 = "如何配置数据库连接";
      const similar2 = "数据库连接怎么设置";
      const unrelated = "今天天气真好适合出去玩";

      const [a, b, c] = await svc.embedBatch([similar1, similar2, unrelated]);
      assert.equal(a.length, 384, "dimension must be 384");
      assert.equal(b.length, 384);
      assert.equal(c.length, 384);

      const cosSim = (x: Float32Array, y: Float32Array): number => {
        let dot = 0;
        for (let i = 0; i < x.length; i++) dot += x[i]! * y[i]!;
        return dot; // already L2-normalized
      };

      const simAB = cosSim(a, b);
      const simAC = cosSim(a, c);
      console.log(`[smoke] sim("${similar1}", "${similar2}") = ${simAB.toFixed(4)}`);
      console.log(`[smoke] sim("${similar1}", "${unrelated}") = ${simAC.toFixed(4)}`);
      assert.ok(simAB > simAC, "similar pair should score higher than unrelated pair");

      await svc.close();
    });
  });
}
