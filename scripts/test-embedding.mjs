#!/usr/bin/env node
// test-embedding.mjs — CLI smoke test for @deeporca/embedding (Granite ONNX).
//
// Loads the vendored Granite model and verifies it produces sensible
// 384-dim embeddings with correct similarity ordering. Use this to sanity-
// check the model after vendoring or before wiring into memory recall.
//
// Usage:
//   node scripts/test-embedding.mjs                          # use vendored model
//   node scripts/test-embedding.mjs --model-dir /path/to/dir # custom model root
//   node scripts/test-embedding.mjs --no-assert              # print matrix, skip assertions
//
// The model root must follow the HF mirror layout:
//   <root>/ibm-granite/granite-embedding-97m-multilingual-r2/onnx/model_quantized.onnx
//
// Exit codes: 0 = pass, 1 = assertion failure / load error.

import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Parse args
const args = process.argv.slice(2);
const noAssert = args.includes("--no-assert");
const modelDirIdx = args.indexOf("--model-dir");
const modelDir =
  modelDirIdx !== -1 && args[modelDirIdx + 1]
    ? args[modelDirIdx + 1]
    : join(repoRoot, "packages", "desktop", "vendor", "granite-embedding");

// ── Helpers ────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[test-embedding] ${msg}`);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are L2-normalized, so dot product = cosine
}

function fmt(n, digits = 4) {
  return n.toFixed(digits);
}

// ── Test data: Chinese pairs where similarity ordering should hold ─────────

const TEST_PAIRS = [
  { label: "相似·数据库配置", a: "如何配置数据库连接", b: "数据库连接怎么设置" },
  { label: "相似·Git 分支", a: "怎么创建新的 git 分支", b: "如何新建一个分支" },
  { label: "相似·报错排查", a: "程序报错了怎么调试", b: "代码出 bug 怎么排查" },
  { label: "不相关·天气", a: "今天天气真好适合出去玩", b: "如何配置数据库连接" },
  { label: "不相关·烹饪", a: "红烧肉怎么做才好吃", b: "怎么创建新的 git 分支" },
];

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  log(`model dir: ${modelDir}`);
  const modelPath = join(
    modelDir,
    "ibm-granite",
    "granite-embedding-97m-multilingual-r2",
    "onnx",
    "model_quantized.onnx"
  );
  if (!existsSync(modelPath)) {
    log(`ERROR: model not found at ${modelPath}`);
    log(`Run \`node scripts/vendor-granite.js\` first, or pass --model-dir.`);
    process.exit(1);
  }

  log("loading @deeporca/embedding...");
  const { TransformersEmbeddingService } = await import("@deeporca/embedding");

  const noop = () => {};
  const svc = new TransformersEmbeddingService({
    modelDir,
    logger: { debug: noop, info: (m) => log(m), warn: noop, error: (m) => console.error(m) },
  });

  log("starting warmup (first load may take ~60s for ORT init)...");
  const t0 = Date.now();
  svc.startWarmup();

  // Wait for readiness with a generous timeout.
  // waitForReady() resolves on both success and failure; we race it against
  // a 120s delay so a hung load doesn't block forever.
  let timedOut = false;
  const timeout = delay(120000).then(() => {
    timedOut = true;
  });
  await Promise.race([svc.waitForReady(), timeout]);
  if (timedOut) {
    log("ERROR: warmup timed out after 120s");
    process.exit(1);
  }

  if (!svc.isReady()) {
    log("ERROR: model not ready after warmup");
    process.exit(1);
  }
  log(`model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s (dims=${svc.getDimensions()})`);

  // Collect all unique texts to embed
  const texts = [...new Set(TEST_PAIRS.flatMap((p) => [p.a, p.b]))];
  log(`encoding ${texts.length} texts...`);
  const t1 = Date.now();
  const embeddings = await svc.embedBatch(texts);
  log(`encoded in ${Date.now() - t1}ms`);

  // Map text → embedding for lookup
  const embMap = new Map();
  texts.forEach((t, i) => embMap.set(t, embeddings[i]));

  // Print pairwise similarity matrix for test pairs.
  //
  // NOTE: Granite's absolute cosine values are naturally high (this is a
  // property of the model, not a bug). The recall system (conversation-search)
  // uses RRF ranking + topK, NOT absolute thresholds, so we only assert on
  // *relative ordering*: similar pairs must score higher than unrelated pairs.
  console.log("");
  console.log("  相似度矩阵:");
  console.log("  ────────────────────────────────────────────────────────────");
  let failures = 0;
  for (const p of TEST_PAIRS) {
    const ea = embMap.get(p.a);
    const eb = embMap.get(p.b);
    const sim = cosineSimilarity(ea, eb);
    const isSimilar = p.label.startsWith("相似");
    const tag = isSimilar ? "✓相似" : "✗不相关";
    console.log(`  [${tag}] ${p.label}`);
    console.log(`      a: ${p.a}`);
    console.log(`      b: ${p.b}`);
    console.log(`      → cosine = ${fmt(sim)}`);
  }

  // Aggregate check: average similarity of similar vs unrelated pairs.
  const similarSims = TEST_PAIRS.filter((p) => p.label.startsWith("相似")).map((p) =>
    cosineSimilarity(embMap.get(p.a), embMap.get(p.b))
  );
  const unrelatedSims = TEST_PAIRS.filter((p) => p.label.startsWith("不相关")).map((p) =>
    cosineSimilarity(embMap.get(p.a), embMap.get(p.b))
  );
  const avgSim = similarSims.reduce((s, v) => s + v, 0) / similarSims.length;
  const avgUnrel = unrelatedSims.reduce((s, v) => s + v, 0) / unrelatedSims.length;
  const separation = avgSim - avgUnrel;

  console.log("");
  console.log(`  平均相似对余弦:   ${fmt(avgSim)}`);
  console.log(`  平均不相似对余弦: ${fmt(avgUnrel)}`);
  console.log(`  分离度 (差值):    ${fmt(separation)}`);

  if (!noAssert) {
    // Relative ordering is the only hard requirement for RRF-based recall.
    if (avgSim <= avgUnrel) {
      console.log(
        `  ⚠️  ASSERT FAIL: similar pairs must average higher than unrelated (got ${fmt(avgSim)} <= ${fmt(avgUnrel)})`
      );
      failures++;
    }
    // Separation should be meaningful (at least 0.15) for useful recall.
    if (separation < 0.15) {
      console.log(`  ⚠️  ASSERT FAIL: separation too small (${fmt(separation)} < 0.15) — recall quality may be poor`);
      failures++;
    }
    if (svc.getDimensions() !== 384) {
      console.log(`  ⚠️  ASSERT FAIL: expected dims=384, got ${svc.getDimensions()}`);
      failures++;
    }
  }

  console.log("");
  svc.close();

  if (!noAssert && failures > 0) {
    log(`FAILED with ${failures} assertion failure(s)`);
    process.exit(1);
  }
  log("PASS ✅");
  process.exit(0);
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
