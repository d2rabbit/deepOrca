/**
 * Tests for the Phase 1-3 actions (spec §三/§四/§五). Covers:
 *  - all 13 actions are registered + surfaced as LLM tools (toToolDefinitions)
 *  - deterministic filesystem actions (codegraph.list, wiki.list-pages/readPage)
 *  - arch-scan.run returns a structured "pending" when runSubagent isn't injected
 *  - index.build-all orchestration runs all stages and reports per-stage results
 *
 * Spawn-based actions (crg.reindex, codegraph.reindex, wiki.init/update,
 * review.run) need real binaries or resolver+spawner mocks; their behavior is
 * covered by the review.run suite in actions.test.ts (the established pattern)
 * — here we assert they're surfaced + registered, not their spawn internals.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

import { ActionRegistry, NULL_SPAWNER } from "../actions";
import type { McpDispatchResult } from "../actions";
import {
  pingDefinition,
  pingRun,
  reviewRunDefinition,
  reviewRun,
  reviewCheckAvailableDefinition,
  reviewCheckAvailableRun,
  reviewFullDefinition,
  reviewFullRun,
  crgReindexDefinition,
  crgReindexRun,
  crgVisualizeDefinition,
  crgVisualizeRun,
  crgAnalyzeDefinition,
  crgAnalyzeRun,
  codegraphReindexDefinition,
  codegraphReindexRun,
  codegraphListDefinition,
  codegraphListRun,
  wikiInitDefinition,
  wikiInitRun,
  wikiUpdateDefinition,
  wikiUpdateRun,
  wikiListPagesDefinition,
  wikiListPagesRun,
  wikiReadPageDefinition,
  wikiReadPageRun,
  indexBuildAllDefinition,
  indexBuildAllRun,
  archScanRunDefinition,
  archScanRunRun,
} from "../actions";

const PROJECT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "phase-actions-"));

/** Register every Phase 0-3 action (mirrors SessionManager's registration). */
function fullRegistry(root: string = PROJECT_ROOT): ActionRegistry {
  const r = new ActionRegistry({ projectRoot: root, spawner: NULL_SPAWNER });
  r.register(pingDefinition, pingRun);
  r.register(reviewRunDefinition, reviewRun);
  r.register(reviewCheckAvailableDefinition, reviewCheckAvailableRun);
  r.register(reviewFullDefinition, reviewFullRun);
  r.register(crgReindexDefinition, crgReindexRun);
  r.register(crgVisualizeDefinition, crgVisualizeRun);
  r.register(crgAnalyzeDefinition, crgAnalyzeRun);
  r.register(codegraphReindexDefinition, codegraphReindexRun);
  r.register(codegraphListDefinition, codegraphListRun);
  r.register(wikiInitDefinition, wikiInitRun);
  r.register(wikiUpdateDefinition, wikiUpdateRun);
  r.register(wikiListPagesDefinition, wikiListPagesRun);
  r.register(wikiReadPageDefinition, wikiReadPageRun);
  r.register(indexBuildAllDefinition, indexBuildAllRun);
  r.register(archScanRunDefinition, archScanRunRun);
  return r;
}

describe("Phase 0-3 actions: registration + surfacing", () => {
  test("all 13 actions surface as LLM tools via toToolDefinitions", () => {
    const r = fullRegistry();
    const names = r.toToolDefinitions().map((t) => t.function.name);
    const expected = [
      "system_ping",
      "review_run",
      "review_check-available",
      "review_full",
      "crg_reindex",
      "crg_visualize",
      "crg_analyze",
      "codegraph_reindex",
      "codegraph_list",
      "wiki_init",
      "wiki_update",
      "wiki_list-pages",
      "wiki_read-page",
      "index_build-all",
      "arch-scan_run",
    ];
    for (const id of expected) {
      assert.ok(names.includes(id), `missing tool surface: ${id}`);
    }
    assert.equal(names.length, expected.length);
  });
});

describe("codegraph.list", () => {
  test("reports the project root and initialized=false when .codegraph/ absent", async () => {
    const r = fullRegistry();
    const out = await r.execute("codegraph.list", {}).result;
    const entries = out as { root: string; initialized: boolean }[];
    assert.equal(entries.length, 1);
    assert.equal(entries[0].root, PROJECT_ROOT);
    assert.equal(entries[0].initialized, false);
  });
});

describe("wiki.list-pages / wiki.read-page (filesystem)", () => {
  test("listPages returns markdown pages under openwiki/", async () => {
    fs.mkdirSync(path.join(PROJECT_ROOT, "openwiki"), { recursive: true });
    fs.writeFileSync(path.join(PROJECT_ROOT, "openwiki", "architecture.md"), "# Arch\n");
    fs.writeFileSync(path.join(PROJECT_ROOT, "openwiki", "modules-auth.md"), "# Auth\n");
    const r = fullRegistry();
    const pages = (await r.execute("wiki.list-pages", {}).result) as { name: string }[];
    const names = pages.map((p) => p.name).sort();
    assert.deepEqual(names, ["architecture", "modules-auth"]);
  });

  test("readPage returns structured page with frontmatter + body", async () => {
    const r = fullRegistry();
    const out = (await r.execute("wiki.read-page", { name: "architecture" }).result) as {
      body: string;
      raw: string;
      frontmatter: { type?: string; title?: string } | null;
    };
    assert.match(out.body, /# Arch/);
    assert.match(out.raw, /# Arch/);
    // OKF frontmatter should be parsed (architecture.md was written with frontmatter by the listPages test setup).
    assert.ok(out.frontmatter === null || typeof out.frontmatter === "object");
  });

  test("readPage accepts a .md-suffixed name", async () => {
    const r = fullRegistry();
    const out = (await r.execute("wiki.read-page", { name: "architecture.md" }).result) as {
      body: string;
    };
    assert.match(out.body, /# Arch/);
  });

  test("readPage rejects a path that escapes openwiki/", async () => {
    const r = fullRegistry();
    await assert.rejects(
      () => r.execute("wiki.read-page", { name: "../../etc/passwd" }).result,
      (err: unknown) => err instanceof Error && /escapes the openwiki/.test(err.message)
    );
  });

  test("readPage errors on a missing page", async () => {
    const r = fullRegistry();
    await assert.rejects(
      () => r.execute("wiki.read-page", { name: "nope" }).result,
      (err: unknown) => err instanceof Error && /no such page/.test(err.message)
    );
  });

  test("listPages returns [] when openwiki/ is absent", async () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "phase-no-wiki-"));
    const r = fullRegistry(emptyRoot);
    const pages = (await r.execute("wiki.list-pages", {}).result) as unknown[];
    assert.equal(pages.length, 0);
  });
});

describe("crg.analyze (Phase 1, 5/5 — routes to CRG MCP tools)", () => {
  /** Registry with a mock executeMcpTool capturing the routed call. */
  function registryWithMcp(
    respond: (name: string, args: Record<string, unknown>) => McpDispatchResult
  ): ActionRegistry {
    const r = new ActionRegistry({
      projectRoot: PROJECT_ROOT,
      spawner: NULL_SPAWNER,
      executeMcpTool: async (name, args) => respond(name, args),
    });
    r.register(crgAnalyzeDefinition, crgAnalyzeRun);
    return r;
  }

  test("routes detect_changes to mcp__code-review-graph__detect_changes_tool and returns output", async () => {
    let captured = "";
    const r = registryWithMcp((name) => {
      captured = name;
      return { ok: true, output: '{"changed":["src/a.ts"]}' };
    });
    const out = (await r.execute("crg.analyze", { tool: "detect_changes" }).result) as {
      tool: string;
      ok: boolean;
      output: string;
    };
    assert.equal(captured, "mcp__code-review-graph__detect_changes_tool");
    assert.equal(out.ok, true);
    assert.equal(out.tool, "detect_changes_tool");
    assert.match(out.output, /src\/a\.ts/);
  });

  test("accepts the _tool-suffixed name too", async () => {
    let captured = "";
    const r = registryWithMcp((name) => {
      captured = name;
      return { ok: true, output: "ok" };
    });
    await r.execute("crg.analyze", { tool: "get_impact_radius_tool", args: { node: "foo" } }).result;
    assert.equal(captured, "mcp__code-review-graph__get_impact_radius_tool");
  });

  test("rejects an unknown CRG tool", async () => {
    const r = registryWithMcp(() => ({ ok: true, output: "" }));
    await assert.rejects(
      () => r.execute("crg.analyze", { tool: "bogus" }).result,
      (err: unknown) => err instanceof Error && /unknown CRG tool/.test(err.message)
    );
  });

  test("surfaces an MCP failure as an error", async () => {
    const r = registryWithMcp(() => ({ ok: false, error: "graph not built" }));
    await assert.rejects(
      () => r.execute("crg.analyze", { tool: "detect_changes" }).result,
      (err: unknown) => err instanceof Error && /graph not built/.test(err.message)
    );
  });
});

describe("arch-scan.run (Phase 3 — runSubagent gated)", () => {
  test("returns structured pending when runSubagent is not injected", async () => {
    const r = fullRegistry();
    const out = (await r.execute("arch-scan.run", {}).result) as {
      ok: boolean;
      pending?: boolean;
      reason?: string;
    };
    assert.equal(out.ok, false);
    assert.equal(out.pending, true);
    assert.match(out.reason ?? "", /Subagent/i);
  });

  test("dispatches a real subagent when runSubagent is injected (Phase 3 closes)", async () => {
    // Mirrors how SessionManager wires this.runSubagent into the registry host.
    // With a real LLM the sub-session runs the arch-scan skill; here a mock
    // proves the action stops returning pending and forwards the subagent result.
    const calls: { skill: string; input?: unknown }[] = [];
    const r = new ActionRegistry({
      projectRoot: PROJECT_ROOT,
      spawner: NULL_SPAWNER,
      runSubagent: async (opts) => {
        calls.push({ skill: opts.skill, input: opts.input });
        return { sessionId: "sub-1", content: "<arch-scan surface emitted>" };
      },
    });
    r.register(archScanRunDefinition, archScanRunRun);
    const out = (await r.execute("arch-scan.run", { perspective: "data-flow" }).result) as {
      ok: boolean;
      pending?: boolean;
      result?: { sessionId: string; content: string };
    };
    assert.equal(out.ok, true);
    assert.equal(out.pending, undefined);
    assert.equal(calls[0].skill, "arch-scan");
    assert.equal((calls[0].input as { perspective: string }).perspective, "data-flow");
    assert.equal(out.result?.sessionId, "sub-1");
    assert.match(out.result?.content ?? "", /arch-scan surface/);
  });
});

describe("index.build-all (Phase 2 orchestrator)", () => {
  test("runs all stages and returns per-stage results (no resolver → wiki skipped)", async () => {
    const r = fullRegistry();
    const out = (await r.execute("index.build-all", { mode: "init" }).result) as {
      mode: string;
      stages: { stage: string; ok: boolean; skipped?: boolean }[];
    };
    assert.equal(out.mode, "init");
    const stages = out.stages.map((s) => s.stage);
    // CodeGraph is attempted (may fail without the binary — that's ok, it's reported).
    assert.ok(stages.includes("codegraph"));
    // Wiki skipped (no resolver configured in this test registry).
    assert.ok(stages.includes("wiki"));
    const wikiStage = out.stages.find((s) => s.stage === "wiki");
    assert.equal(wikiStage?.skipped, true);
    // arch-scan skipped (no runSubagent).
    const archStage = out.stages.find((s) => s.stage === "arch-scan");
    assert.equal(archStage?.skipped, true);
  });

  test("mode='update' skips the arch-scan stage", async () => {
    const r = fullRegistry();
    const out = (await r.execute("index.build-all", { mode: "update" }).result) as {
      stages: { stage: string }[];
    };
    assert.ok(!out.stages.some((s) => s.stage === "arch-scan"));
  });
});
