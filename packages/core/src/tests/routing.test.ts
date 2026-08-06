/**
 * Tests for routing: VectorIndex, SkillRouter, ToolRouter.
 *
 * These are pure-logic tests using a mock embedding service (no model
 * required). They verify cosine ranking, fail-open semantics, threshold
 * bypass, and isLoaded/pinned pass-through.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

import { VectorIndex, type VectorIndexEntry } from "../routing/vector-index";
import { SkillRouterImpl } from "../routing/skill-router";
import { ToolRouterImpl } from "../routing/tool-router";
import { runSad, jaccardSet, categoryJaccard } from "../routing/sad";
import { composePlan, ioTypeCoercion, keywordCooccurrence, detectDependencies } from "../routing/composer";
import type {
  CompositionalSkill,
  LLMDecomposer,
  PlanStep,
  RoutingConfig,
  RoutingEmbeddingService,
  RoutableSkill,
  RoutableTool,
  SubTask,
  TurnContext,
} from "../routing/types";
import { DEFAULT_ROUTING_CONFIG } from "../routing/types";

// ── Mock embedding service ─────────────────────────────────────────────────
// Maps known keywords to hand-crafted orthogonal-ish vectors so we can test
// ranking deterministically without a real model.

const DIM = 8;
const WORD_VECTORS: Record<string, Float32Array> = {
  database: new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]),
  sql: new Float32Array([0.9, 0.1, 0, 0, 0, 0, 0, 0]),
  git: new Float32Array([0, 1, 0, 0, 0, 0, 0, 0]),
  branch: new Float32Array([0, 0.9, 0.1, 0, 0, 0, 0, 0]),
  weather: new Float32Array([0, 0, 1, 0, 0, 0, 0, 0]),
  cooking: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0]),
};

function textToVector(text: string): Float32Array {
  const vec = new Float32Array(DIM);
  const words = text.toLowerCase().split(/\s+/);
  for (const w of words) {
    const v = WORD_VECTORS[w];
    if (v) {
      for (let i = 0; i < DIM; i++) vec[i] += v[i]!;
    }
  }
  // L2 normalize
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (mag > 1e-10) {
    for (let i = 0; i < DIM; i++) vec[i] /= mag;
  }
  return vec;
}

function makeMockEmbedding(ready = true): RoutingEmbeddingService {
  return {
    embed: async (text: string) => textToVector(text),
    embedBatch: async (texts: string[]) => texts.map(textToVector),
    getDimensions: () => DIM,
    isReady: () => ready,
    startWarmup: () => {},
    getProviderInfo: () => ({ provider: "mock", model: "mock-test" }),
  };
}

// ── VectorIndex tests ──────────────────────────────────────────────────────

describe("VectorIndex", () => {
  test("rebuild + query returns ranked results", async () => {
    const idx = new VectorIndex();
    idx.attach(makeMockEmbedding());
    const entries: VectorIndexEntry[] = [
      { id: "db", text: "database sql" },
      { id: "git", text: "git branch" },
      { id: "weather", text: "weather" },
    ];
    const ok = await idx.rebuild(entries);
    assert.equal(ok, true);
    assert.equal(idx.size, 3);

    const hits = await idx.query("database", 2);
    assert.equal(hits.length, 2);
    assert.equal(hits[0]!.id, "db"); // most similar
    assert.ok(hits[0]!.score >= hits[1]!.score);
  });

  test("rebuild returns false when embedding service not attached", async () => {
    const idx = new VectorIndex(); // no attach
    const ok = await idx.rebuild([{ id: "a", text: "x" }]);
    assert.equal(ok, false);
  });

  test("rebuild returns false when service not ready", async () => {
    const idx = new VectorIndex();
    idx.attach(makeMockEmbedding(false)); // not ready
    const ok = await idx.rebuild([{ id: "a", text: "x" }]);
    assert.equal(ok, false);
  });

  test("query on empty index returns []", async () => {
    const idx = new VectorIndex();
    idx.attach(makeMockEmbedding());
    const hits = await idx.query("anything", 5);
    assert.deepEqual(hits, []);
  });

  test("searchByVector is synchronous and ranks correctly", async () => {
    const idx = new VectorIndex();
    idx.attach(makeMockEmbedding());
    await idx.rebuild([
      { id: "a", text: "database" },
      { id: "b", text: "git" },
      { id: "c", text: "weather" },
    ]);
    const q = textToVector("sql");
    const hits = idx.searchByVector(q, 3);
    assert.equal(hits[0]!.id, "a"); // sql ~ database
  });

  test("disk cache: rebuild skips re-embedding on cache hit", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "routing-test-"));
    try {
      let embedCalls = 0;
      const countingEmb: RoutingEmbeddingService = {
        ...makeMockEmbedding(),
        embedBatch: async (texts: string[]) => {
          embedCalls++;
          return texts.map(textToVector);
        },
      };

      const entries = [
        { id: "a", text: "database sql" },
        { id: "b", text: "git branch" },
      ];

      // First rebuild: encodes + writes cache.
      const idx1 = new VectorIndex({ cacheDir });
      idx1.attach(countingEmb);
      await idx1.rebuild(entries, "mock-test");
      assert.equal(embedCalls, 1);

      // Second rebuild (new index, same entries): should load from cache.
      const idx2 = new VectorIndex({ cacheDir });
      idx2.attach(countingEmb);
      await idx2.rebuild(entries, "mock-test");
      assert.equal(embedCalls, 1); // no new embed calls

      // Query still works from cache.
      const hits = await idx2.query("database", 2);
      assert.equal(hits[0]!.id, "a");
    } finally {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

// ── SkillRouter tests ──────────────────────────────────────────────────────

describe("SkillRouterImpl", () => {
  const config: RoutingConfig = { ...DEFAULT_ROUTING_CONFIG, skillMinPool: 3, skillTopK: 2 };

  test("returns null when candidate pool ≤ skillMinPool", async () => {
    const router = new SkillRouterImpl(config, makeMockEmbedding());
    const result = await router.shortlist("database", [
      { name: "a", description: "x" },
      { name: "b", description: "y" },
    ]);
    assert.equal(result, null); // 2 ≤ minPool(3) → skip
  });

  test("returns shortlist for large pool", async () => {
    const router = new SkillRouterImpl(config, makeMockEmbedding());
    const candidates: RoutableSkill[] = [
      { name: "db-skill", description: "database sql query" },
      { name: "git-skill", description: "git branch version control" },
      { name: "weather-skill", description: "weather forecast" },
      { name: "cooking-skill", description: "cooking recipe" },
    ];
    const result = await router.shortlist("database sql", candidates);
    assert.ok(result);
    assert.ok(result!.length <= 2 + 0); // topK(2) + loaded(0)
    assert.ok(result!.some((s) => s.name === "db-skill"));
  });

  test("isLoaded skills always pass through (not counted in topK)", async () => {
    const router = new SkillRouterImpl(config, makeMockEmbedding());
    const candidates: RoutableSkill[] = [
      { name: "loaded-1", description: "already active", isLoaded: true },
      { name: "db-skill", description: "database sql" },
      { name: "git-skill", description: "git branch" },
      { name: "weather-skill", description: "weather" },
      { name: "cooking-skill", description: "cooking" },
    ];
    const result = await router.shortlist("database", candidates, { topK: 1 });
    assert.ok(result);
    assert.ok(result!.some((s) => s.name === "loaded-1")); // always included
  });

  test("returns null when embedding service is null (fail-open)", async () => {
    const router = new SkillRouterImpl(config, null);
    const result = await router.shortlist("x", Array(20).fill({ name: "s", description: "d" }));
    assert.equal(result, null);
  });

  test("returns null when config.enabled is false", async () => {
    const router = new SkillRouterImpl({ ...config, enabled: false }, makeMockEmbedding());
    const result = await router.shortlist("x", Array(20).fill({ name: "s", description: "d" }));
    assert.equal(result, null);
  });
});

// ── ToolRouter tests ───────────────────────────────────────────────────────

describe("ToolRouterImpl", () => {
  const config: RoutingConfig = {
    ...DEFAULT_ROUTING_CONFIG,
    mcpTokenBudget: 1, // force routing (low budget)
    pinnedServers: ["pinned-srv"],
  };

  function makeTools(): RoutableTool[] {
    return [
      { name: "mcp__db__query", description: "database sql query", serverName: "db-srv" },
      { name: "mcp__db__insert", description: "database sql insert", serverName: "db-srv" },
      { name: "mcp__git__commit", description: "git commit version", serverName: "git-srv" },
      { name: "mcp__weather__forecast", description: "weather forecast", serverName: "weather-srv" },
    ];
  }

  const ctx: TurnContext = { userMessage: "database sql query" };

  test("returns only tools from relevant servers", async () => {
    const router = new ToolRouterImpl(config, makeMockEmbedding());
    const result = await router.select(ctx, makeTools());
    assert.ok(result, "should return a routed subset");
    // db-srv should be among the relevant servers (its tools included).
    assert.ok(
      result!.some((t) => t.serverName === "db-srv"),
      "db-srv tools should be included"
    );
    assert.ok(result!.some((t) => t.name === "mcp__db__query"));
    // Result is a subset (or equal) of the input.
    assert.ok(result!.length <= makeTools().length);
  });

  test("pinned servers always included", async () => {
    const tools = [...makeTools(), { name: "mcp__pinned__x", description: "pinned tool", serverName: "pinned-srv" }];
    const router = new ToolRouterImpl(config, makeMockEmbedding());
    const result = await router.select({ userMessage: "weather" }, tools);
    assert.ok(result);
    assert.ok(result!.some((t) => t.serverName === "pinned-srv")); // pinned always in
  });

  test("returns undefined when token budget not exceeded", async () => {
    const highBudgetConfig = { ...config, mcpTokenBudget: 99999 };
    const router = new ToolRouterImpl(highBudgetConfig, makeMockEmbedding());
    const result = await router.select(ctx, makeTools());
    assert.equal(result, undefined); // fits in budget → no routing
  });

  test("returns undefined when embedding is null (fail-open)", async () => {
    const router = new ToolRouterImpl(config, null);
    const result = await router.select(ctx, makeTools());
    assert.equal(result, undefined);
  });

  test("returns undefined when config disabled", async () => {
    const router = new ToolRouterImpl({ ...config, enabled: false }, makeMockEmbedding());
    const result = await router.select(ctx, makeTools());
    assert.equal(result, undefined);
  });
});

// ── M4: SAD (Iterative Skill-Aware Decomposition) tests ────────────────────

describe("SAD (runSad)", () => {
  test("returns null when decomposer returns null", async () => {
    const decomposer: LLMDecomposer = { decompose: async () => null };
    const idx = new VectorIndex();
    idx.attach(makeMockEmbedding());
    await idx.rebuild([{ id: "a", text: "x" }]);
    const result = await runSad(decomposer, idx, "query", []);
    assert.equal(result, null);
  });

  test("vanilla decomposition pass-through for single sub-task", async () => {
    const decomposer: LLMDecomposer = {
      decompose: async () => [{ step: 1, description: "do thing" }],
    };
    const idx = new VectorIndex();
    idx.attach(makeMockEmbedding());
    await idx.rebuild([{ id: "s1", text: "do thing skill" }]);
    const result = await runSad(decomposer, idx, "query", []);
    assert.ok(result);
    assert.equal(result!.length, 1);
    assert.equal(result![0]!.description, "do thing");
  });

  test("multi sub-task triggers SAD hint feedback", async () => {
    let callCount = 0;
    let sawHints = false;
    const skills: CompositionalSkill[] = [
      { name: "db", description: "database sql query", categories: ["database"] },
      { name: "git", description: "git branch", categories: ["vcs"] },
    ];
    const decomposer: LLMDecomposer = {
      decompose: async (query, hints) => {
        callCount++;
        if (hints && hints.length > 0) sawHints = true;
        return [
          { step: 1, description: "query database" },
          { step: 2, description: "commit changes" },
        ];
      },
    };
    const idx = new VectorIndex();
    idx.attach(makeMockEmbedding());
    await idx.rebuild(skills.map((s) => ({ id: s.name, text: s.description })));
    const result = await runSad(decomposer, idx, "query data then commit", skills, {
      maxIterations: 1,
      convergenceThreshold: 0.99, // force re-decompose (never converges)
      hintCount: 5,
    });
    assert.ok(result);
    assert.equal(result!.length, 2);
    assert.ok(callCount >= 2, "decomposer should be called at least twice (vanilla + SAD)");
    assert.ok(sawHints, "second call should receive hints");
  });

  test("jaccardSet computes set overlap correctly", () => {
    assert.equal(jaccardSet(new Set(["a", "b"]), new Set(["b", "c"])), 1 / 3);
    assert.equal(jaccardSet(new Set(["a"]), new Set(["a"])), 1);
    assert.equal(jaccardSet(new Set(), new Set()), 1);
    assert.equal(jaccardSet(new Set(["a"]), new Set(["b"])), 0);
  });

  test("categoryJaccard between skills", () => {
    const a: CompositionalSkill = { name: "a", description: "x", categories: ["db", "sql"] };
    const b: CompositionalSkill = { name: "b", description: "y", categories: ["db", "nosql"] };
    assert.equal(categoryJaccard(a, b), 1 / 3); // {db} overlap, {db,sql,nosql} union
    const c: CompositionalSkill = { name: "c", description: "z", categories: [] };
    assert.equal(categoryJaccard(a, c), 0); // empty categories
  });

  test("hint set is top-H by similarity (Algorithm 1 line 5)", async () => {
    // Skills with distinct similarity profiles. The hint set must rank by
    // retrieval score and cap at hintCount, not just collect all ids.
    const skills: CompositionalSkill[] = [
      { name: "high-sim", description: "database sql", categories: ["db"] },
      { name: "mid-sim", description: "database nosql", categories: ["db"] },
      { name: "low-sim", description: "weather", categories: ["misc"] },
    ];
    let hintsReceived: CompositionalSkill[] | undefined;
    const decomposer: LLMDecomposer = {
      decompose: async (_q, hints) => {
        if (hints) hintsReceived = hints;
        return [
          { step: 1, description: "query database sql" },
          { step: 2, description: "export database nosql" },
        ];
      },
    };
    const idx = new VectorIndex();
    idx.attach(makeMockEmbedding());
    await idx.rebuild(skills.map((s) => ({ id: s.name, text: s.description })));
    await runSad(decomposer, idx, "database", skills, {
      maxIterations: 1,
      convergenceThreshold: 0.99, // force re-decompose
      hintCount: 2, // cap at 2 — should drop "low-sim" (weather)
    });
    assert.ok(hintsReceived, "decomposer should have received hints on SAD pass");
    // "low-sim" (weather) has near-zero similarity to "database" → must be excluded.
    assert.ok(
      !hintsReceived!.some((s) => s.name === "low-sim"),
      "low-similarity skill should be excluded from top-H hints"
    );
    assert.ok(hintsReceived!.length <= 2, "hints should be capped at hintCount");
  });

  test("convergence stops re-decomposition when hints stabilize", async () => {
    let callCount = 0;
    const skills: CompositionalSkill[] = [{ name: "s1", description: "database sql" }];
    const decomposer: LLMDecomposer = {
      decompose: async () => {
        callCount++;
        return [
          { step: 1, description: "query database" },
          { step: 2, description: "export data" },
        ];
      },
    };
    const idx = new VectorIndex();
    idx.attach(makeMockEmbedding());
    await idx.rebuild(skills.map((s) => ({ id: s.name, text: s.description })));
    // With maxIterations=2 and threshold=0.0: iter 0 re-decomposes (prevHints
    // is null → skip convergence check), iter 1 converges (Jaccard=1.0 ≥ 0).
    // So decomposer is called: 1 (vanilla) + 1 (iter 0 SAD) = 2 total.
    await runSad(decomposer, idx, "database", skills, {
      maxIterations: 2,
      convergenceThreshold: 0.0,
      hintCount: 5,
    });
    assert.equal(callCount, 2, "vanilla + one SAD pass before convergence");
  });
});

// ── M4: Composer tests ─────────────────────────────────────────────────────

describe("Composer (composePlan)", () => {
  test("selects highest-scoring candidate per sub-task", () => {
    const subTasks: SubTask[] = [
      { step: 1, description: "query db" },
      { step: 2, description: "export data" },
    ];
    const candidates: SkillCandidate[][] = [
      [
        { skill: { name: "db-low", description: "d" }, similarity: 0.5 },
        { skill: { name: "db-high", description: "d" }, similarity: 0.9 },
      ],
      [{ skill: { name: "export", description: "e" }, similarity: 0.8 }],
    ];
    const plan = composePlan(subTasks, candidates, { alpha: 1.0, minSelectionScore: 0 });
    assert.equal(plan.steps[0]!.skill!.name, "db-high"); // highest sim wins when alpha=1
    assert.equal(plan.steps[1]!.skill!.name, "export");
  });

  test("returns null skill when score below threshold", () => {
    const subTasks: SubTask[] = [{ step: 1, description: "x" }];
    const candidates: SkillCandidate[][] = [[{ skill: { name: "low", description: "d" }, similarity: 0.1 }]];
    const plan = composePlan(subTasks, candidates, { alpha: 1.0, minSelectionScore: 0.5 });
    assert.equal(plan.steps[0]!.skill, null); // 0.1 < 0.5
  });

  test("empty sub-tasks → empty plan", () => {
    const plan = composePlan([], []);
    assert.equal(plan.steps.length, 0);
    assert.equal(plan.dependencies.length, 0);
  });

  test("ioTypeCoercion detects output→input alignment", () => {
    const prev: CompositionalSkill = {
      name: "p",
      description: "d",
      outputTypes: ["table", "json"],
    };
    const curr: CompositionalSkill = {
      name: "c",
      description: "d",
      inputTypes: ["json", "csv"],
    };
    assert.equal(ioTypeCoercion(prev, curr), 0.5); // json matches, csv doesn't → 1/2
    const noTypes: CompositionalSkill = { name: "n", description: "d" };
    assert.equal(ioTypeCoercion(noTypes, curr), 0);
  });

  test("keywordCooccurrence overlaps descriptive tokens", () => {
    const a: CompositionalSkill = { name: "a", description: "database query tool" };
    const b: CompositionalSkill = { name: "b", description: "database export utility" };
    const score = keywordCooccurrence(a, b);
    assert.ok(score > 0, "should have some overlap on 'database'");
    const c: CompositionalSkill = { name: "c", description: "weather forecast" };
    assert.equal(keywordCooccurrence(a, c), 0);
  });

  test("detectDependencies finds I/O-based edges", () => {
    const steps: PlanStep[] = [
      {
        subTask: { step: 1, description: "fetch" },
        skill: { name: "fetch", description: "d", outputTypes: ["json"] },
        score: 0.9,
        similarity: 0.9,
        compatibility: 0,
      },
      {
        subTask: { step: 2, description: "process" },
        skill: { name: "process", description: "d", inputTypes: ["json"] },
        score: 0.8,
        similarity: 0.8,
        compatibility: 0,
      },
    ];
    const edges = detectDependencies(steps);
    assert.ok(
      edges.some(([from, to]) => from === 0 && to === 1),
      "should detect 0→1 dependency"
    );
  });

  test("compatibility influences selection when alpha < 1", () => {
    // Step 1: select skill A (high sim). Step 2: skill B shares I/O with A
    // but lower sim vs skill C with higher sim but no compatibility.
    // With alpha=0.3, compatibility-heavy B should win.
    const subTasks: SubTask[] = [
      { step: 1, description: "produce json" },
      { step: 2, description: "consume json" },
    ];
    const skillA: CompositionalSkill = {
      name: "A",
      description: "produce json",
      outputTypes: ["json"],
    };
    const skillB: CompositionalSkill = {
      name: "B",
      description: "consume json",
      inputTypes: ["json"],
      categories: ["data"],
    };
    const skillC: CompositionalSkill = {
      name: "C",
      description: "unrelated high sim",
      inputTypes: ["csv"],
    };
    const candidates: SkillCandidate[][] = [
      [{ skill: skillA, similarity: 0.9 }],
      [
        { skill: skillB, similarity: 0.4 },
        { skill: skillC, similarity: 0.95 }, // higher sim but no compat
      ],
    ];
    const plan = composePlan(subTasks, candidates, { alpha: 0.3, minSelectionScore: 0 });
    // B: 0.3*0.4 + 0.7*compat_with_A. C: 0.3*0.95 + 0.7*0 = 0.285.
    // B's compat with A = ioTypeCoercion(A,B)=1.0 (json match) → avg=1.0
    // B score = 0.12 + 0.7 = 0.82 > 0.285 → B wins
    assert.equal(plan.steps[1]!.skill!.name, "B");
  });
});
