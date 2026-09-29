/**
 * MoonViz seam unit tests (specs/moonviz-engine-replacement T1.3/T1.4) —
 * fixture-driven, no wasm: a scripted MoonvizEngineSeam replays canned
 * envelopes so the orchestration contract (withSession ladder, canonical
 * enforcement, gate-block parsing, reset retry, contract-layer coverage) is
 * verified on any Node, independent of the gc runtime.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MoonvizCanonicalError,
  MoonvizEngineError,
  MoonvizResetError,
  configureMoonvizEngine,
  moonvizApplyAgentOp,
  moonvizComponentVocabulary,
  moonvizEngineDiagnostics,
  moonvizListComponents,
  moonvizRenderMbt,
  moonvizValidateMbt,
  parseMoonvizGateBlock,
  resetMoonvizEngine,
  withSession,
  type MoonvizEngineSeam,
} from "../common/moonviz-engine";
import {
  MOONVIZ_SEED_DOC,
  moonvizArtboardId,
  moonvizCoverageFindings,
  normalizeMoonvizDevices,
  parseMoonvizArtboardId,
  parseOpPlan,
  looksLikeOpPlan,
} from "../actions/moonviz-contract";

const DOC =
  '---\nmoonviz:\n  entry: a\n---\n\n# a\n\n<!-- moonviz:artboard a -->\n```mbt\nfn visual_a() -> @decl.Prototype { let page = @decl.prototype(name="a", width=100.0, height=100.0) page }\n```\n';
const CANONICAL_1 = DOC.replace("entry: a", "entry: a # v1");
const CANONICAL_2 = DOC.replace("entry: a", "entry: a # v2");

/** Scripted seam: a queue of per-method responder functions; every call is
 *  journaled so tests assert the exact wire ladder. */
function fixtureSeam(script: Partial<Record<string, (params: Record<string, unknown>) => unknown>> = {}) {
  const journal: Array<{ method: string; params: Record<string, unknown> }> = [];
  const seam: MoonvizEngineSeam = {
    async call(method, params) {
      journal.push({ method, params });
      const responder = script[method];
      if (!responder) throw new Error(`fixture has no responder for ${method}`);
      return responder(params);
    },
  };
  return { seam, journal };
}

test("withSession walks open → fn → close and reports the input doc as canonical when fn does not mutate", async () => {
  const { seam, journal } = fixtureSeam({
    sessionOpen: () => 7,
    sessionClose: () => 1,
    sessionListArtboards: () => JSON.stringify({ ok: true, data: [{ id: "a" }] }),
  });
  configureMoonvizEngine({ seam });
  const result = await withSession(DOC, async (session) => await session.listArtboards());
  assert.deepEqual(result.result, { ok: true, data: [{ id: "a" }] });
  assert.equal(result.canonical, DOC);
  assert.equal(result.mutated, false);
  assert.deepEqual(
    journal.map((entry) => entry.method),
    ["sessionOpen", "sessionListArtboards", "sessionClose"]
  );
  assert.equal(journal[0].params.mbt, DOC);
  assert.equal(journal[2].params.handle, 7);
});

test("withSession canonical = the last mutating envelope echo; gate-block rejections carry the parsed four segments", async () => {
  const { seam } = fixtureSeam({
    sessionOpen: () => 1,
    sessionClose: () => 1,
    sessionApplyAgent: (params) => {
      if (params.op === "bad op") {
        return JSON.stringify({ ok: false, error: "mbt_gate_block:t_login:no_sibling_overlap:divider1" });
      }
      return JSON.stringify({ ok: true, mbt: CANONICAL_1 });
    },
  });
  configureMoonvizEngine({ seam });
  const result = await withSession(DOC, async (session) => {
    await session.mutate("good op");
    return "done";
  });
  assert.equal(result.result, "done");
  assert.equal(result.mutated, true);
  assert.equal(result.canonical, CANONICAL_1);

  await assert.rejects(
    withSession(DOC, async (session) => {
      await session.mutate("bad op");
    }),
    (error: unknown) => {
      assert.ok(error instanceof MoonvizEngineError);
      assert.deepEqual(error.gateBlock, { artboard: "t_login", predicate: "no_sibling_overlap", node: "divider1" });
      assert.equal((error as NodeJS.ErrnoException).message.includes("mbt_gate_block"), true);
      return true;
    }
  );
});

test("canonical contract: a successful mutating envelope without an mbt echo breaks loudly", async () => {
  const { seam } = fixtureSeam({
    sessionOpen: () => 3,
    sessionClose: () => 1,
    sessionApplyAgent: () => JSON.stringify({ ok: true }),
  });
  configureMoonvizEngine({ seam });
  await assert.rejects(
    withSession(DOC, async (session) => {
      await session.mutate("sneaky op");
    }),
    MoonvizCanonicalError
  );
});

test("withSession retries once on a worker reset (watchdog rebuild) and then succeeds", async () => {
  let opens = 0;
  const { seam, journal } = fixtureSeam({
    sessionOpen: () => {
      opens += 1;
      if (opens === 1) throw new MoonvizResetError("engine rebuilt: call timeout");
      return 9;
    },
    sessionClose: () => 1,
  });
  configureMoonvizEngine({ seam });
  const result = await withSession(DOC, async () => 42);
  assert.equal(result.result, 42);
  assert.equal(opens, 2);
  // The failed open is journaled once; the retry re-walks the ladder.
  assert.equal(journal.filter((entry) => entry.method === "sessionOpen").length, 2);
});

test("withSession does NOT retry on ordinary engine failures", async () => {
  let opens = 0;
  const { seam } = fixtureSeam({
    sessionOpen: () => {
      opens += 1;
      return -1; // engine rejected the doc
    },
  });
  configureMoonvizEngine({ seam });
  await assert.rejects(
    withSession("garbage", async () => null),
    MoonvizEngineError
  );
  assert.equal(opens, 1);
});

test("batch surface parses envelopes; listComponents unwraps bare arrays", async () => {
  const { seam } = fixtureSeam({
    renderMbt: () => JSON.stringify({ ok: true, entry: "a", artboards: [{ id: "a", svg: "<svg" }] }),
    validateMbt: () => JSON.stringify({ ok: false, error: "mbt_no_visual_blocks" }),
    applyAgentOp: () => JSON.stringify({ ok: true, mbt: CANONICAL_1 }),
    listComponents: () => JSON.stringify([{ id: "button", variants: ["primary"] }]),
  });
  configureMoonvizEngine({ seam });
  const rendered = await moonvizRenderMbt(DOC);
  assert.equal(rendered.ok, true);
  assert.equal((await moonvizValidateMbt(DOC)).ok, false);
  assert.equal((await moonvizApplyAgentOp(DOC, "op")).mbt, CANONICAL_1);
  assert.deepEqual(await moonvizListComponents(), [{ id: "button", variants: ["primary"] }]);
});

test("unconfigured seam fails with a boot diagnostic, not a TypeError", async () => {
  resetMoonvizEngine();
  await assert.rejects(moonvizRenderMbt(DOC), /not configured/);
  const { seam } = fixtureSeam({ renderMbt: () => "{}" });
  configureMoonvizEngine({ seam, version: "0.1.7", componentVocabulary: [{ id: "card" }] });
  assert.equal(moonvizComponentVocabulary().length, 1);
  assert.equal((await moonvizEngineDiagnostics()).version, "0.1.7");
  assert.ok((await moonvizEngineDiagnostics()).recentCalls.length > 0);
});

test("parseMoonvizGateBlock accepts exactly the four-segment form", () => {
  assert.deepEqual(parseMoonvizGateBlock("mbt_gate_block:a:no_sibling_overlap:n1"), {
    artboard: "a",
    predicate: "no_sibling_overlap",
    node: "n1",
  });
  assert.equal(parseMoonvizGateBlock("mbt_gate_block:a:only:three:extra"), null);
  assert.equal(parseMoonvizGateBlock("mbt_no_visual_blocks"), null);
  assert.equal(parseMoonvizGateBlock(undefined), null);
});

test("coverage: PRD 页面清单 ↔ artboards (missing failed / extra pending / flows required)", () => {
  const spec = [
    "## 5. 页面清单",
    "",
    "| 页面 | 页面ID | 目的 |",
    "| --- | --- | --- |",
    "| 登录 | login | 登录 |",
    "| 首页 | home | 概览 |",
    "| 统计 | stats | 报表 |",
  ].join("\n");
  // 缺 stats 画板；多出一个 help 画板；多页却无 flow → failed。
  const findings = moonvizCoverageFindings(spec, [{ id: "login" }, { id: "home" }, { id: "help" }], []);
  const failed = findings.filter((finding) => finding.severity === "failed");
  const pending = findings.filter((finding) => finding.severity === "pending");
  assert.ok(failed.some((finding) => finding.id === "auto:coverage-stats-missing"));
  assert.ok(failed.some((finding) => finding.id === "auto:flows-empty"));
  assert.ok(pending.some((finding) => finding.id === "auto:coverage-help-extra"));
  // 有 flow 且全覆盖 → 零 findings。
  assert.deepEqual(
    moonvizCoverageFindings(spec, [{ id: "login" }, { id: "home" }, { id: "stats" }], [{ from: "login", to: "home" }]),
    []
  );
});

test("artboard id mapping: `<page>@<device>` in multi-device docs, plain id otherwise", () => {
  assert.equal(moonvizArtboardId("login", "mobile", true), "login@mobile");
  assert.equal(moonvizArtboardId("login", "mobile", false), "login");
  assert.deepEqual(parseMoonvizArtboardId("login@tablet"), { pageId: "login", device: "tablet" });
  assert.deepEqual(parseMoonvizArtboardId("login"), { pageId: "login", device: null });
  assert.deepEqual(parseMoonvizArtboardId("not-a-device@watch"), { pageId: "not-a-device@watch", device: null });
});

test("device normalization and seed document shape", () => {
  assert.deepEqual(normalizeMoonvizDevices(["mobile", "nope"]), ["mobile"]);
  assert.deepEqual(normalizeMoonvizDevices(undefined), ["desktop"]);
  assert.match(MOONVIZ_SEED_DOC, /<!-- moonviz:artboard __seed -->/);
  assert.match(MOONVIZ_SEED_DOC, /fn visual___seed\(\) -> @decl\.Prototype/);
});

test("parseOpPlan extracts the last fence, skips comments/headings, demands an artboard op", () => {
  const output = {
    content:
      "Here is my plan:\n\n```moonviz\n// setup\ntemplate login t_login 390 844\n\n## notes\nplace t_login button btn - 24 700 342 44\ndelete-artboard __seed\n```\n",
  };
  const ops = parseOpPlan(output);
  assert.deepEqual(ops, [
    "template login t_login 390 844",
    "place t_login button btn - 24 700 342 44",
    "delete-artboard __seed",
  ]);
  assert.equal(looksLikeOpPlan(ops), true);
  assert.equal(looksLikeOpPlan(["place a button b - 1 1 10 10"]), false);
  assert.equal(parseOpPlan({ content: "no fence, no ops" }), null);
});

test("mutation-check premise: the canonical guard fires on a missing echo (covered above) — this test pins the error class", () => {
  const error = new MoonvizCanonicalError("x");
  assert.equal(error.name, "MoonvizCanonicalError");
  assert.ok(error instanceof MoonvizEngineError);
});
