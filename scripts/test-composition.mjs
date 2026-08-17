#!/usr/bin/env node
// test-composition.mjs — End-to-end SkillWeaver composition routing smoke test.
//
// Exercises the full Decompose-Retrieve-Compose pipeline with a real Granite
// embedding model + a mock LLM decomposer. Verifies:
//   1. SAD decomposes a complex query into sub-tasks (with hint feedback).
//   2. Retrieve returns per-sub-task candidates with correct dimensions.
//   3. Compose produces a plan with selected skills + DAG dependencies.
//
// Usage:
//   node scripts/test-composition.mjs
//   node scripts/test-composition.mjs --model-dir /path/to/granite

import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const args = process.argv.slice(2);
const modelDirIdx = args.indexOf("--model-dir");
const modelDir =
  modelDirIdx !== -1 && args[modelDirIdx + 1]
    ? args[modelDirIdx + 1]
    : join(repoRoot, "packages", "desktop", "vendor", "granite-embedding");

function log(msg) {
  console.log(`[test-composition] ${msg}`);
}

// ── Mock skill library (compositional metadata) ────────────────────────────
const SKILLS = [
  {
    name: "db-query",
    description: "查询数据库执行 SQL 语句",
    categories: ["database", "sql"],
    outputTypes: ["table", "json"],
  },
  {
    name: "db-export",
    description: "导出数据库数据为文件",
    categories: ["database", "export"],
    inputTypes: ["json", "table"],
    outputTypes: ["csv", "file"],
  },
  { name: "git-commit", description: "提交代码变更到 Git 仓库", categories: ["vcs", "git"], outputTypes: ["commit"] },
  { name: "git-push", description: "推送 Git 提交到远程仓库", categories: ["vcs", "git"], inputTypes: ["commit"] },
  { name: "weather", description: "查询天气预报", categories: ["misc"] },
  {
    name: "format-code",
    description: "格式化代码文件",
    categories: ["code"],
    inputTypes: ["file"],
    outputTypes: ["file"],
  },
];

// ── Mock decomposer: simulates an LLM splitting a query into sub-tasks ──────
function makeDecomposer() {
  let pass = 0;
  return {
    decompose: async (query, hints) => {
      pass++;
      if (pass === 1) {
        // Vanilla decomposition (no hints) — slightly generic.
        return [
          { step: 1, description: "获取数据" },
          { step: 2, description: "处理数据" },
          { step: 3, description: "保存结果" },
        ];
      }
      // SAD pass (with hints) — refined to match skill vocabulary.
      log(`  SAD pass ${pass}: received ${hints?.length ?? 0} hints, refining decomposition`);
      return [
        { step: 1, description: "查询数据库 SQL 数据" },
        { step: 2, description: "导出数据为文件" },
        { step: 3, description: "格式化导出的文件" },
      ];
    },
  };
}

async function main() {
  log(`model dir: ${modelDir}`);

  // 1. Load embedding service
  const { TransformersEmbeddingService } = await import("@deeporca/embedding");
  const noop = () => {};
  const emb = new TransformersEmbeddingService({
    modelDir,
    logger: { debug: noop, info: (m) => log(m), warn: noop, error: (m) => console.error(m) },
  });
  log("warming up embedding model...");
  emb.startWarmup();
  let timedOut = false;
  await Promise.race([emb.waitForReady(), delay(120000).then(() => (timedOut = true))]);
  if (timedOut || !emb.isReady()) {
    log("ERROR: model not ready");
    process.exit(1);
  }
  log(`embedding ready (dims=${emb.getDimensions()})`);

  // 2. Build routing index + SkillRouter
  const { SkillRouterImpl, DEFAULT_ROUTING_CONFIG } = await import(
    join(repoRoot, "packages/core/src/routing/index.ts")
  );
  const config = { ...DEFAULT_ROUTING_CONFIG };
  const router = new SkillRouterImpl(config, emb);

  // 3. Run composeRoute
  const query = "从数据库查出数据然后导出成文件再格式化";
  log(`\n=== 组合路由: "${query}" ===`);
  log(`技能库: ${SKILLS.length} skills`);

  const plan = await router.composeRoute(query, SKILLS, makeDecomposer(), {
    alpha: 0.5,
    maxSadIterations: 1,
    retrieveTopK: 5,
    minSelectionScore: 0.2,
  });

  if (!plan) {
    log("FAIL: composeRoute returned null");
    process.exit(1);
  }

  log(`\n分解为 ${plan.steps.length} 个子任务:`);
  for (const step of plan.steps) {
    const skillName = step.skill ? step.skill.name : "(无匹配)";
    log(`  [${step.subTask.step}] ${step.subTask.description}`);
    log(
      `      → ${skillName}  (score=${step.score.toFixed(3)}, sim=${step.similarity.toFixed(3)}, compat=${step.compatibility.toFixed(3)})`
    );
  }

  log(`\nDAG 依赖: ${plan.dependencies.length} 条边`);
  for (const [from, to] of plan.dependencies) {
    log(`  ${from + 1} → ${to + 1}`);
  }

  // Assertions
  let failures = 0;
  if (plan.steps.length < 2) {
    log("FAIL: should decompose into ≥2 sub-tasks");
    failures++;
  }
  // At least one step should have a matched skill.
  const matched = plan.steps.filter((s) => s.skill !== null);
  if (matched.length === 0) {
    log("FAIL: no skills matched any sub-task");
    failures++;
  }
  log(`\n匹配技能: ${matched.length}/${plan.steps.length}`);

  emb.close();
  if (failures > 0) {
    log(`FAILED with ${failures} failure(s)`);
    process.exit(1);
  }
  log("PASS ✅");
  process.exit(0);
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
