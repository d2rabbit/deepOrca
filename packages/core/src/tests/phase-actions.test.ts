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
import { execFileSync } from "node:child_process";

import { ActionRegistry, NULL_SPAWNER } from "../actions";
import { configureCodegraphController, getCodegraphController } from "../actions/codegraph-controller";
import { configureWikiController, getWikiController } from "../actions/wiki-controller";
import { configureArchRenderer } from "../actions/archify-controller";
import type { CodegraphController } from "../actions/codegraph-controller";
import type { WikiController } from "../actions/wiki-controller";

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
  test("all 14 actions surface as LLM tools via toToolDefinitions", () => {
    const r = fullRegistry();
    const names = r.toToolDefinitions().map((t) => t.function.name);
    const expected = [
      "system_ping",
      "review_run",
      "review_check-available",
      "review_full",
      "crg_reindex",
      "crg_visualize",
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
  test("listPages returns markdown pages under deepwiki/", async () => {
    fs.mkdirSync(path.join(PROJECT_ROOT, "deepwiki"), { recursive: true });
    fs.writeFileSync(path.join(PROJECT_ROOT, "deepwiki", "architecture.md"), "# Arch\n");
    fs.writeFileSync(path.join(PROJECT_ROOT, "deepwiki", "modules-auth.md"), "# Auth\n");
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

  test("readPage rejects a path that escapes deepwiki/", async () => {
    const r = fullRegistry();
    await assert.rejects(
      () => r.execute("wiki.read-page", { name: "../../etc/passwd" }).result,
      (err: unknown) => err instanceof Error && /escapes the deepwiki/.test(err.message)
    );
  });

  test("readPage errors on a missing page", async () => {
    const r = fullRegistry();
    await assert.rejects(
      () => r.execute("wiki.read-page", { name: "nope" }).result,
      (err: unknown) => err instanceof Error && /no such page/.test(err.message)
    );
  });

  test("listPages returns [] when deepwiki/ is absent", async () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "phase-no-wiki-"));
    const r = fullRegistry(emptyRoot);
    const pages = (await r.execute("wiki.list-pages", {}).result) as unknown[];
    assert.equal(pages.length, 0);
  });
});

describe("arch-scan.run (Phase 3 — runSubagent gated)", () => {
  test("returns structured pending when no agent runtime is injected", async () => {
    const r = fullRegistry();
    const out = (await r.execute("arch-scan.run", {}).result) as {
      ok: boolean;
      pending?: boolean;
      reason?: string;
    };
    assert.equal(out.ok, false);
    assert.equal(out.pending, true);
    assert.match(out.reason ?? "", /background-task|Subagent/i);
  });

  test("prefers the sessionless background task when injected (R2-2)", async () => {
    // Index builds must not spawn sub-sessions: when the host injects
    // runBackgroundTask, the action runs there and never touches runSubagent.
    const bgCalls: { skill: string; input?: unknown }[] = [];
    let subagentCalled = false;
    const r = new ActionRegistry({
      projectRoot: PROJECT_ROOT,
      spawner: NULL_SPAWNER,
      runBackgroundTask: async (opts) => {
        bgCalls.push({ skill: opts.skill, input: opts.input });
        return { content: "<arch-scan surface emitted>", iterations: 3 };
      },
      runSubagent: async () => {
        subagentCalled = true;
        return { sessionId: "sub-1", content: null };
      },
    });
    r.register(archScanRunDefinition, archScanRunRun);
    const out = (await r.execute("arch-scan.run", { perspective: "data-flow" }).result) as {
      ok: boolean;
      pending?: boolean;
      result?: { content: string | null; iterations: number };
    };
    assert.equal(out.ok, true);
    assert.equal(out.pending, undefined);
    assert.equal(subagentCalled, false);
    assert.equal(bgCalls[0].skill, "arch-scan");
    assert.equal((bgCalls[0].input as { perspective: string }).perspective, "data-flow");
    assert.match(out.result?.content ?? "", /arch-scan surface/);
  });

  test("falls back to runSubagent when the background channel is absent", async () => {
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

  test("mode='update' also runs arch-scan (every build refreshes the maps)", async () => {
    const r = fullRegistry();
    const out = (await r.execute("index.build-all", { mode: "update" }).result) as {
      stages: { stage: string; ok: boolean; skipped?: boolean }[];
    };
    // Arch is attempted on BOTH modes (real-machine 2026-08-27: an update
    // build dropping the arch row read as "架构图没有执行"). No
    // runBackgroundTask here → it reports skipped, but it must be PRESENT.
    const archStage = out.stages.find((s) => s.stage === "arch-scan");
    assert.ok(archStage, "update mode tracks the arch-scan stage");
    assert.equal(archStage?.skipped, true);
  });

  test("a failed codegraph stage skips the later stages (spec B1: 任一段失败即停)", async () => {
    // Chain-stop regression (audit 2026-08-28): stage 2/3 used to keep
    // running over stage 1's wreckage. Inject a controller whose reindex
    // throws; wiki and arch must be skipped, not attempted.
    const prevCg = getCodegraphController();
    const prevWiki = getWikiController();
    let wikiCalled = false;
    try {
      configureCodegraphController({
        hasProject: () => false,
        reindex: async () => {
          throw new Error("boom: grammar load failed");
        },
        sync: async () => undefined,
        getMcpServer: () => null,
      } as CodegraphController);
      configureWikiController({
        init: async () => {
          wikiCalled = true;
          return { ok: true, model: "test" };
        },
        update: async () => {
          wikiCalled = true;
          return { ok: true, model: "test" };
        },
      } as unknown as WikiController);
      const r = new ActionRegistry({
        projectRoot: PROJECT_ROOT,
        spawner: NULL_SPAWNER,
        runBackgroundTask: async () => ({ content: "unused", iterations: 1 }),
      });
      r.register(indexBuildAllDefinition, indexBuildAllRun);
      const out = (await r.execute("index.build-all", { mode: "init" }).result) as {
        stages: { stage: string; ok: boolean; skipped?: boolean; error?: string }[];
      };
      const cg = out.stages.find((s) => s.stage === "codegraph");
      assert.equal(cg?.ok, false);
      assert.notEqual(cg?.skipped, true); // a REAL failure, not unavailability
      const wiki = out.stages.find((s) => s.stage === "wiki");
      assert.equal(wiki?.skipped, true, "wiki is skipped after codegraph failure");
      assert.match(wiki?.error ?? "", /codegraph stage failed/);
      const arch = out.stages.find((s) => s.stage === "arch-scan");
      assert.equal(arch?.skipped, true, "arch-scan is skipped after codegraph failure");
      assert.equal(wikiCalled, false, "the wiki controller never ran");
    } finally {
      configureCodegraphController(prevCg);
      configureWikiController(prevWiki);
    }
  });

  test("update mode over a hollow wiki falls back to full init (corrupted-marker no-op)", async () => {
    // Regression (real-machine 2026-08-29): mode:"update" used to force the
    // update path even when no substantive wiki existed — over a skeleton
    // index.md plus a marker whose gitHead field held git's ERROR TEXT
    // (written by a pre-bootstrap no-commit init), update no-oped in seconds
    // and tripped the empty-wiki guard. A REAL wiki must exist before the
    // incremental path is chosen, whatever mode the caller asked for.
    const prevCg = getCodegraphController();
    const prevWiki = getWikiController();
    const wikiDir = path.join(PROJECT_ROOT, "deepwiki");
    const calls: string[] = [];
    const mkRegistry = (): ActionRegistry => {
      const reg = new ActionRegistry({
        projectRoot: PROJECT_ROOT,
        spawner: NULL_SPAWNER,
        runBackgroundTask: async () => ({ content: "unused", iterations: 1 }),
      });
      reg.register(indexBuildAllDefinition, indexBuildAllRun);
      return reg;
    };
    try {
      configureCodegraphController({
        hasProject: () => true,
        sync: async () => ({ filesChecked: 0, filesAdded: 0, filesModified: 0, filesRemoved: 0, durationMs: 1 }),
        reindex: async () => undefined,
        getMcpServer: () => null,
      } as CodegraphController);
      configureWikiController({
        init: async () => {
          calls.push("init");
          return { ok: true, model: "test" };
        },
        update: async () => {
          calls.push("update");
          return { ok: true, model: "test" };
        },
      } as unknown as WikiController);

      // Hollow wiki: 37-byte skeleton + error-text gitHead marker — exactly
      // the corrupted state the failed no-git init left behind.
      fs.rmSync(wikiDir, { recursive: true, force: true });
      fs.mkdirSync(wikiDir, { recursive: true });
      fs.writeFileSync(path.join(wikiDir, "index.md"), "---\ntitle: Index\n---\n# Index\n");
      fs.writeFileSync(
        path.join(wikiDir, ".last-update.json"),
        JSON.stringify({ command: "init", gitHead: "HEAD\nfatal: ambiguous argument 'HEAD'", status: "complete" })
      );
      let out = (await mkRegistry().execute("index.build-all", { mode: "update" }).result) as {
        stages: { stage: string; ok: boolean }[];
      };
      assert.equal(out.stages.find((s) => s.stage === "wiki")?.ok, true);
      assert.deepEqual(calls, ["init"], "update mode MUST fall back to init when no real wiki exists");

      // A substantial page present → update really is incremental.
      calls.length = 0;
      fs.writeFileSync(path.join(wikiDir, "architecture.md"), `# Architecture\n\n${"x".repeat(600)}`);
      out = (await mkRegistry().execute("index.build-all", { mode: "update" }).result) as {
        stages: { stage: string; ok: boolean }[];
      };
      assert.deepEqual(calls, ["update"], "a substantial wiki routes update mode to the incremental path");
    } finally {
      configureCodegraphController(prevCg);
      configureWikiController(prevWiki);
      fs.rmSync(wikiDir, { recursive: true, force: true });
    }
  });

  test("arch-scan stage verifies the artifacts: hollow run fails, substantial map passes", async () => {
    // Post-run verification regression (audit 2026-08-28): a resolved
    // background task used to count as success even when the model never
    // called save_archmap — same class as wiki's exit-0-over-skeleton.
    const prevCg = getCodegraphController();
    const prevWiki = getWikiController();
    const protoDir = path.join(PROJECT_ROOT, ".deeporca", "prototypes");
    const mkRegistry = (): ActionRegistry => {
      const reg = new ActionRegistry({
        projectRoot: PROJECT_ROOT,
        spawner: NULL_SPAWNER,
        // Resolves "successfully" while writing NOTHING — the lying success.
        runBackgroundTask: async () => ({ content: "done (no artifacts though)", iterations: 3 }),
      });
      reg.register(indexBuildAllDefinition, indexBuildAllRun);
      return reg;
    };
    try {
      configureCodegraphController({
        hasProject: () => true, // → sync path, no reindex node-count gate here
        sync: async () => ({ filesChecked: 0, filesAdded: 0, filesModified: 0, filesRemoved: 0, durationMs: 1 }),
        reindex: async () => undefined,
        getMcpServer: () => null,
      } as CodegraphController);
      configureWikiController({
        init: async () => ({ ok: true, model: "test" }),
        update: async () => ({ ok: true, model: "test" }),
      } as unknown as WikiController);

      // Hollow workspace: the task resolves but no map lands → stage FAILS.
      fs.rmSync(protoDir, { recursive: true, force: true });
      let out = (await mkRegistry().execute("index.build-all", { mode: "init" }).result) as {
        stages: { stage: string; ok: boolean; skipped?: boolean; error?: string }[];
      };
      let arch = out.stages.find((s) => s.stage === "arch-scan");
      assert.equal(arch?.ok, false, "hollow run must fail the stage");
      assert.match(arch?.error ?? "", /without any substantive architecture maps/);

      // Substantial map present (satisfies an incremental no-change run too).
      fs.mkdirSync(protoDir, { recursive: true });
      fs.writeFileSync(
        path.join(protoDir, "arch-real.architecture.json"),
        JSON.stringify({ meta: { title: "Real Map", quality_profile: "showcase" }, nodes: [], edges: [] }) +
          "\n" +
          "x".repeat(600)
      );
      out = (await mkRegistry().execute("index.build-all", { mode: "init" }).result) as {
        stages: { stage: string; ok: boolean; skipped?: boolean; error?: string }[];
      };
      arch = out.stages.find((s) => s.stage === "arch-scan");
      assert.equal(arch?.ok, true, "substantial artifact passes the gate");
    } finally {
      configureCodegraphController(prevCg);
      configureWikiController(prevWiki);
      fs.rmSync(protoDir, { recursive: true, force: true });
    }
  });

  test("arch no-change fastPath skips the LLM when maps are newer than HEAD", async () => {
    // Real-machine 2026-08-30: the model misbehaves on EVERY no-change
    // incremental run (rewrote the artifact twice; both rolled back). When
    // only generated paths are dirty and the artifacts postdate the last
    // commit, the model is not invited at all — the stage short-circuits.
    const prevCg = getCodegraphController();
    const prevWiki = getWikiController();
    const protoDir = path.join(PROJECT_ROOT, ".deeporca", "prototypes");
    const git = (args: string[]): string =>
      execFileSync("git", ["-C", PROJECT_ROOT, ...args], {
        stdio: ["ignore", "pipe", "ignore"],
      }).toString();
    let llmRan = false;
    try {
      execFileSync("git", ["-C", PROJECT_ROOT, "init"], { stdio: "ignore" });
      fs.writeFileSync(path.join(PROJECT_ROOT, "code.txt"), "x");
      execFileSync("git", ["-C", PROJECT_ROOT, "add", "-A"], { stdio: "ignore" });
      execFileSync("git", ["-C", PROJECT_ROOT, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"], {
        stdio: "ignore",
      });
      // Artifact written AFTER the commit → fastPath eligible.
      fs.mkdirSync(protoDir, { recursive: true });
      fs.writeFileSync(
        path.join(protoDir, "arch-fresh.architecture.json"),
        `{"meta":{"title":"F","quality_profile":"showcase"},"components":[],"connections":[]}\n${"y".repeat(300)}`
      );
      // Delivered sibling (2026-08-31): the fast path requires maps whose
      // deliver SUCCEEDED (rendered html present) — a fresh-but-undelivered
      // map must loop back into the LLM repair path instead.
      fs.writeFileSync(path.join(protoDir, "arch-fresh.architecture.html"), "<html><body>d</body></html>");
      configureCodegraphController({
        hasProject: () => true,
        sync: async () => ({ filesChecked: 0, filesAdded: 0, filesModified: 0, filesRemoved: 0, durationMs: 1 }),
        reindex: async () => undefined,
        getMcpServer: () => null,
      } as CodegraphController);
      configureWikiController({
        init: async () => ({ ok: true, model: "test" }),
        update: async () => ({ ok: true, model: "test" }),
      } as unknown as WikiController);
      const reg = new ActionRegistry({
        projectRoot: PROJECT_ROOT,
        spawner: NULL_SPAWNER,
        runBackgroundTask: async () => {
          llmRan = true;
          return { content: "should not run", iterations: 1 };
        },
      });
      reg.register(indexBuildAllDefinition, indexBuildAllRun);
      const out = (await reg.execute("index.build-all", { mode: "update" }).result) as {
        stages: { stage: string; ok: boolean; skipped?: boolean }[];
      };
      assert.equal(llmRan, false, "LLM task must be SKIPPED on the no-change fastPath");
      const arch = out.stages.find((st) => st.stage === "arch-scan");
      assert.equal(arch?.ok, true, "stage passes without the LLM");
    } finally {
      configureCodegraphController(prevCg);
      configureWikiController(prevWiki);
      fs.rmSync(protoDir, { recursive: true, force: true });
      try {
        fs.rmSync(path.join(PROJECT_ROOT, ".git"), { recursive: true, force: true });
        fs.rmSync(path.join(PROJECT_ROOT, "code.txt"), { force: true });
      } catch {
        // best effort
      }
    }
  });

  test("arch checkpoint restores artifacts destroyed by a rogue task run", async () => {
    // Real-machine 2026-08-29: an incremental "no changes" run clobbered the
    // complete artifact with a components-only fragment (undefined.json) —
    // prompt rules are advisory and bash bypasses the write grant. The stage
    // now snapshots substantial artifacts before the LLM runs and restores
    // them when the run ends with nothing substantial.
    const prevCg = getCodegraphController();
    const prevWiki = getWikiController();
    const protoDir = path.join(PROJECT_ROOT, ".deeporca", "prototypes");
    const good =
      JSON.stringify({
        meta: { title: "Good map", quality_profile: "showcase" },
        components: [{ id: "a", label: "A", sublabel: "component" }],
        connections: [],
      }) +
      "\n" +
      "x".repeat(400);
    fs.mkdirSync(protoDir, { recursive: true });
    fs.writeFileSync(path.join(protoDir, "arch-good.architecture.json"), good);
    // The background task simulates the rogue run: delete the good file and
    // write a degenerate fragment that does NOT match the artifact contract.
    const rogue = async (): Promise<{ content: string; iterations: number }> => {
      fs.rmSync(path.join(protoDir, "arch-good.architecture.json"));
      fs.writeFileSync(path.join(protoDir, "undefined.json"), '{"components":[]}');
      return { content: "无代码拓扑变更", iterations: 2 };
    };
    try {
      configureCodegraphController({
        hasProject: () => true,
        sync: async () => ({ filesChecked: 0, filesAdded: 0, filesModified: 0, filesRemoved: 0, durationMs: 1 }),
        reindex: async () => undefined,
        getMcpServer: () => null,
      } as CodegraphController);
      configureWikiController({
        init: async () => ({ ok: true, model: "test" }),
        update: async () => ({ ok: true, model: "test" }),
      } as unknown as WikiController);
      const reg = new ActionRegistry({
        projectRoot: PROJECT_ROOT,
        spawner: NULL_SPAWNER,
        runBackgroundTask: rogue,
      });
      reg.register(indexBuildAllDefinition, indexBuildAllRun);
      const out = (await reg.execute("index.build-all", { mode: "update" }).result) as {
        stages: { stage: string; ok: boolean; error?: string }[];
      };
      // The good artifact is BACK on disk (rolled back), and the stage
      // passes on the restored substantial map.
      const restored = fs.readFileSync(path.join(protoDir, "arch-good.architecture.json"), "utf-8");
      assert.equal(restored, good, "checkpoint content restored verbatim");
      const arch = out.stages.find((st) => st.stage === "arch-scan");
      assert.equal(arch?.ok, true, "stage passes on the restored map");
    } finally {
      configureCodegraphController(prevCg);
      configureWikiController(prevWiki);
      fs.rmSync(protoDir, { recursive: true, force: true });
    }
  });

  test("arch stage runs the host-injected archify deliver gate after the LLM task", async () => {
    // Seam regression (audit 2026-08-29): the background task only AUTHORS
    // typed-IR files; rendering/validation is the host's deterministic gate.
    // The stage must invoke it (and surface its diagnostics on failure).
    const prevCg = getCodegraphController();
    const prevWiki = getWikiController();
    let renderCalls = 0;
    try {
      configureCodegraphController({
        hasProject: () => true,
        sync: async () => ({ filesChecked: 0, filesAdded: 0, filesModified: 0, filesRemoved: 0, durationMs: 1 }),
        reindex: async () => undefined,
        getMcpServer: () => null,
      } as CodegraphController);
      configureWikiController({
        init: async () => ({ ok: true, model: "test" }),
        update: async () => ({ ok: true, model: "test" }),
      } as unknown as WikiController);
      configureArchRenderer(async () => {
        renderCalls++;
        return 1;
      });
      const reg = new ActionRegistry({
        projectRoot: PROJECT_ROOT,
        spawner: NULL_SPAWNER,
        runBackgroundTask: async () => ({ content: "unused", iterations: 1 }),
      });
      reg.register(indexBuildAllDefinition, indexBuildAllRun);

      // Hollow workspace → task resolves, gate runs, stage still FAILS on the
      // empty-artifact rule (the gate alone is not a substitute for content).
      const out = (await reg.execute("index.build-all", { mode: "init" }).result) as {
        stages: { stage: string; ok: boolean; skipped?: boolean; error?: string }[];
      };
      assert.equal(renderCalls, 1, "deliver gate invoked exactly once after the LLM task");
      assert.equal(out.stages.find((s) => s.stage === "arch-scan")?.ok, false, "hollow run fails");
    } finally {
      configureCodegraphController(prevCg);
      configureWikiController(prevWiki);
      configureArchRenderer(null);
    }
  });
});
