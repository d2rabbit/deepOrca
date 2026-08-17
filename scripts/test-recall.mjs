#!/usr/bin/env node
// test-recall.mjs — Memory vector recall accuracy test.
//
// Writes a corpus of Chinese memory entries (as L1 records) into a fresh
// sqlite-vec VectorStore using the Granite embedding model, then runs a set
// of queries and measures top-K recall hit rate. Compares vector search
// vs. FTS-only (keyword) baseline so we can see the lift from embeddings.
//
// Usage:
//   node scripts/test-recall.mjs
//   node scripts/test-recall.mjs --model-dir /path/to/granite
//   node scripts/test-recall.mjs --topk 5
//
// Requires the Granite model to be vendored (run `node scripts/vendor-granite.js` first).

import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Parse args
const args = process.argv.slice(2);
const modelDirIdx = args.indexOf("--model-dir");
const modelDir =
  modelDirIdx !== -1 && args[modelDirIdx + 1]
    ? args[modelDirIdx + 1]
    : join(repoRoot, "packages", "desktop", "vendor", "granite-embedding");
const topKIdx = args.indexOf("--topk");
const TOP_K = topKIdx !== -1 && args[topKIdx + 1] ? parseInt(args[topKIdx + 1], 10) : 5;

function log(msg) {
  console.log(`[test-recall] ${msg}`);
}

// ── Test corpus: 20 Chinese memory entries ─────────────────────────────────
// Each entry is a realistic memory fragment. Queries map to expected matches
// (by entry index) so we can score recall hit rate.
const CORPUS = [
  { id: "m01", content: "用户偏好使用 TypeScript 严格模式,所有项目都开启了 strict 和 verbatimModuleSyntax" },
  { id: "m02", content: "数据库连接池配置:PostgreSQL 最大连接数 20,超时 30 秒,使用了 pg-pool 库" },
  { id: "m03", content: "前端构建工具从 webpack 迁移到了 Vite,启动速度从 40 秒降到 2 秒" },
  { id: "m04", content: "CI/CD 流水线用 GitHub Actions,部署目标是 Vercel,每次 PR 自动预览" },
  { id: "m05", content: "用户是 Rust 爱好者,喜欢用 Cargo workspace 管理多 crate 单体仓库" },
  { id: "m06", content: "项目用 pnpm workspaces 管理单体仓库,包含 core 和 desktop 两个包" },
  { id: "m07", content: "认证方案:JWT token 过期时间 15 分钟,refresh token 7 天,用 jose 库签名" },
  { id: "m08", content: "日志收集用 Pino,输出 JSON 格式,通过 Loki + Grafana 做可视化监控" },
  { id: "m09", content: "测试框架是 Vitest,覆盖率工具用 c8,CI 里跑 npm test 自动检查" },
  { id: "m10", content: "用户喜欢深色主题,编辑器用 JetBrains Mono 字体,缩进 2 空格" },
  { id: "m11", content: "API 限流用 Redis 计数器实现,每个 IP 每分钟 100 次请求,超限返回 429" },
  { id: "m12", content: "Electron 主进程和渲染进程通过 IPC 通信,preload 脚本用 contextBridge 暴露 API" },
  { id: "m13", content: "Git 提交规范遵循 Conventional Commits,用 commitlint 做 hook 校验" },
  { id: "m14", content: "状态管理从 Redux 迁移到 Zustand,减少了 60% 的样板代码" },
  { id: "m15", content: "WebSocket 长连接用于实时消息推送,心跳间隔 30 秒,断线自动重连最多 5 次" },
  { id: "m16", content: "Docker 生产镜像用多阶段构建,基于 alpine,最终镜像大小 45MB" },
  { id: "m17", content: "国际化方案用 i18next,支持中英日三种语言,翻译文件按命名空间拆分" },
  { id: "m18", content: "用户在一家做电商 SaaS 的创业公司工作,技术栈主要是 Node.js 和 React" },
  { id: "m19", content: "密码哈希用 argon2id,参数:内存 64MB,迭代 3 次,并行度 4" },
  { id: "m20", content: "文件上传走 S3 预签名 URL,前端直传,最大 100MB,支持分片上传断点续传" },
];

// ── Queries: each maps to expected corpus entry IDs (ground truth) ──────────
const QUERIES = [
  { q: "数据库连接怎么配的", expect: ["m02"] },
  { q: "前端构建速度慢怎么办", expect: ["m03"] },
  { q: "token 过期和刷新机制", expect: ["m07"] },
  { q: "怎么限制接口调用频率", expect: ["m11"] },
  { q: "Electron 进程间通信", expect: ["m12"] },
  { q: "提交信息的格式规范", expect: ["m13"] },
  { q: "状态管理库选型", expect: ["m14"] },
  { q: "实时消息推送怎么实现的", expect: ["m15"] },
  { q: "容器镜像怎么优化体积", expect: ["m16"] },
  { q: "多语言翻译怎么做", expect: ["m17"] },
  // Harder: semantic, not lexical
  { q: "登录认证安全方案", expect: ["m07", "m19"] },
  { q: "代码仓库的包管理方式", expect: ["m05", "m06"] },
];

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  log(`model dir: ${modelDir}`);
  log(`top-K: ${TOP_K}`);

  // 1. Load embedding service
  log("loading @deeporca/embedding...");
  const { TransformersEmbeddingService } = await import("@deeporca/embedding");
  const noop = () => {};
  const embSvc = new TransformersEmbeddingService({
    modelDir,
    logger: { debug: noop, info: (m) => log(m), warn: noop, error: (m) => console.error(m) },
  });

  log("warming up embedding model...");
  embSvc.startWarmup();
  let timedOut = false;
  await Promise.race([embSvc.waitForReady(), delay(120000).then(() => (timedOut = true))]);
  if (timedOut || !embSvc.isReady()) {
    log("ERROR: embedding model not ready");
    process.exit(1);
  }
  log(`embedding ready (dims=${embSvc.getDimensions()})`);

  // 2. Create a temp VectorStore
  const { VectorStore } = await import(join(repoRoot, "packages/memory/src/tdai/core/store/sqlite.ts"));
  const tmpDir = mkdtempSync(join(tmpdir(), "deeporca-recall-"));
  const dbPath = join(tmpDir, "test.db");
  log(`temp db: ${dbPath}`);

  const logger = {
    debug: noop,
    info: noop,
    warn: (m) => console.warn(`[store] ${m}`),
    error: (m) => console.error(`[store] ${m}`),
  };
  const store = new VectorStore(dbPath, embSvc.getDimensions(), logger);
  const initResult = await store.init(embSvc.getProviderInfo());
  log(`store init: needsReindex=${initResult.needsReindex}, degraded=${store.isDegraded()}`);

  if (store.isDegraded()) {
    log("ERROR: store in degraded mode (sqlite-vec failed to load)");
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  // 3. Embed + upsert corpus
  log(`embedding ${CORPUS.length} corpus entries...`);
  const t0 = Date.now();
  const embeddings = await embSvc.embedBatch(CORPUS.map((e) => e.content));
  log(`embedded in ${Date.now() - t0}ms`);

  const nowIso = new Date().toISOString();
  for (let i = 0; i < CORPUS.length; i++) {
    const entry = CORPUS[i];
    store.upsertL1(
      {
        id: entry.id,
        content: entry.content,
        type: "instruction",
        priority: 50,
        scene_name: "test",
        sessionKey: "test-session",
        sessionId: "test",
        source_message_ids: [],
        timestamps: [nowIso],
        createdAt: nowIso,
        updatedAt: nowIso,
        metadata: {},
      },
      embeddings[i]
    );
  }
  log(`upserted ${CORPUS.length} entries`);

  // 4. Run queries — vector search
  log("\n=== 向量召回 (Granite embedding) ===");
  let vectorHits = 0;
  let vectorTotal = 0;
  for (const { q, expect } of QUERIES) {
    const queryEmb = await embSvc.embedQuery(q);
    const results = store.searchL1Vector(queryEmb, TOP_K);
    const resultIds = results.map((r) => r.record_id);
    const hit = expect.some((id) => resultIds.includes(id));
    if (hit) vectorHits++;
    vectorTotal++;
    const tag = hit ? "✓" : "✗";
    const scores = results.map((r) => `${r.record_id}(${r.score.toFixed(3)})`).join(" ");
    console.log(`  ${tag} [${q}]`);
    console.log(`      期望: ${expect.join(",")} | 召回: ${scores || "(空)"}`);
  }
  const vectorRate = ((vectorHits / vectorTotal) * 100).toFixed(1);

  // 5. Run queries — FTS baseline
  log("\n=== 关键词召回 (FTS5 baseline) ===");
  let ftsHits = 0;
  let ftsTotal = 0;
  for (const { q, expect } of QUERIES) {
    const results = store.searchL1Fts(q, TOP_K);
    const resultIds = results.map((r) => r.record_id);
    const hit = expect.some((id) => resultIds.includes(id));
    if (hit) ftsHits++;
    ftsTotal++;
    const tag = hit ? "✓" : "✗";
    const scores = results.map((r) => `${r.record_id}(${r.score?.toFixed(3) ?? "?"})`).join(" ");
    console.log(`  ${tag} [${q}]`);
    console.log(`      期望: ${expect.join(",")} | 召回: ${scores || "(空)"}`);
  }
  const ftsRate = ((ftsHits / ftsTotal) * 100).toFixed(1);

  // 6. Summary
  console.log("");
  console.log("  ──────────────────────────────────────────────");
  console.log(`  向量召回命中率:  ${vectorHits}/${vectorTotal} = ${vectorRate}%`);
  console.log(`  关键词召回命中率: ${ftsHits}/${ftsTotal} = ${ftsRate}%`);
  console.log(`  向量提升:        ${(((vectorHits - ftsHits) / Math.max(ftsTotal, 1)) * 100).toFixed(1)}个百分点`);
  console.log("  ──────────────────────────────────────────────");

  // Cleanup
  embSvc.close();
  rmSync(tmpDir, { recursive: true, force: true });

  const pass = parseFloat(vectorRate) >= 70;
  log(pass ? `PASS ✅ (向量召回 ≥ 70%)` : `WARN: 向量召回 ${vectorRate}% < 70%`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
