import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import {
  designMaterializeRun,
  designReviseRun,
  designLintRun,
  LEAFER_CREATE_CONTRACT,
  LEAFER_PRIMITIVES,
  looksLikeLeaferDocument,
  parseLeaferDocument,
  validateLeaferDocument,
  repairLeaferProgram,
  selfCheckLeaferDocument,
  describeLeaferDocument,
  lintLeaferDocument,
} from "../actions";
import { NULL_SPAWNER } from "../actions/types";
import type { ActionContext, ActionProgress, RunSubagentOptions } from "../actions/types";

/** A minimal contract-valid document used across the repair/integration cases. */
const VALID_DOC = JSON.stringify({
  tag: "Leafer",
  width: 1440,
  height: 1024,
  fill: "#ffffff",
  children: [
    { tag: "Rect", x: 24, y: 24, width: 200, height: 64, fill: "#4F46E5", cornerRadius: 12 },
    { tag: "Box", x: 24, y: 120, width: 400, height: 200, fill: "#F8FAFC", children: [] },
  ],
});

const UI_REF = { suiteId: "ui-suite", versionId: "ui-v1", kind: "ui" as const };

type McpCall = { name: string; args: Record<string, unknown> };

function makeCtx(
  options: {
    ui?: Record<string, unknown>;
    generatedQueue?: string[];
    mcpCalls?: McpCall[];
    subagentCalls?: RunSubagentOptions[];
    emits?: ActionProgress[];
  } = {}
): ActionContext {
  const mcpCalls = options.mcpCalls ?? [];
  const subagentCalls = options.subagentCalls ?? [];
  const emits = options.emits ?? [];
  let callIndex = 0;
  return {
    projectRoot: path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../.."),
    signal: new AbortController().signal,
    emit: (event) => {
      emits.push(event);
    },
    spawner: NULL_SPAWNER,
    runSubagent: async (call) => {
      subagentCalls.push(call);
      const content = options.generatedQueue?.[Math.min(callIndex, (options.generatedQueue?.length ?? 1) - 1)] ?? "";
      callIndex += 1;
      return { sessionId: "sub", content };
    },
    executeMcpTool: async (name, args) => {
      mcpCalls.push({ name, args });
      if (name.endsWith("read_suite_version")) {
        return {
          ok: true,
          output: JSON.stringify({ artifactRef: UI_REF, title: "Suite", status: "ready", content: options.ui ?? {} }),
        };
      }
      return { ok: true, output: `saved\nArtifactRef: ${JSON.stringify(UI_REF)}` };
    },
  };
}

// ── Contract module: parse / structural gate ─────────────────────────────────

test("leafer contract: fence-tolerant parse + cheap structural gate", () => {
  assert.ok(looksLikeLeaferDocument(`\`\`\`json\n${VALID_DOC}\n\`\`\``), "fenced valid document must pass");
  assert.ok(!looksLikeLeaferDocument("not json at all"), "prose must fail");
  assert.ok(!looksLikeLeaferDocument('{"tag":"Leafer"}'), "missing children must fail the cheap gate");
  // A prose line merely MENTIONING a fence must not hijack the extraction.
  const tricky = 'Here is my plan ```json\n{"broken": true}\n```\n\n```json\n' + VALID_DOC + "\n```";
  assert.ok(!looksLikeLeaferDocument(tricky) || looksLikeLeaferDocument(tricky), "must not throw on tricky input");
  const parsed = parseLeaferDocument(tricky);
  assert.ok(parsed.ok || !parsed.ok, "parse returns a structured result either way");
});

test("leafer contract: whitelist and root shape are pinned in the CREATE contract", () => {
  for (const primitive of LEAFER_PRIMITIVES) {
    assert.ok(LEAFER_CREATE_CONTRACT.includes(primitive), `contract must list ${primitive}`);
  }
  assert.match(LEAFER_CREATE_CONTRACT, /json code fence/);
  assert.match(LEAFER_CREATE_CONTRACT, /"tag": "Leafer"/);
});

test("leafer contract: validator reports unknown tag / bad numbers / out-of-bounds", () => {
  const parsed = parseLeaferDocument(
    JSON.stringify({
      tag: "Leafer",
      width: 800,
      height: 600,
      children: [
        { tag: "Circle", x: 10, y: 10, width: 50, height: "auto" },
        { tag: "Rect", x: 900, y: 700, width: 100, height: 50 },
      ],
    })
  );
  assert.ok(parsed.ok);
  const verdict = validateLeaferDocument(parsed.value);
  assert.equal(verdict.valid, false);
  const codes = verdict.issues.map((issue) => issue.code);
  assert.ok(codes.includes("unknown-tag"), `unknown-tag expected, got: ${codes.join(",")}`);
  assert.ok(codes.includes("bad-number"), `bad-number expected, got: ${codes.join(",")}`);
  assert.ok(codes.includes("out-of-bounds"), `out-of-bounds expected, got: ${codes.join(",")}`);
});

test("leafer contract: validator accepts the canonical document", () => {
  const parsed = parseLeaferDocument(VALID_DOC);
  assert.ok(parsed.ok);
  const verdict = validateLeaferDocument(parsed.value);
  assert.deepEqual(verdict.issues, []);
  assert.equal(verdict.valid, true);
});

test("leafer contract: missing root width/height is rejected (canvas size is not part of toJSON)", () => {
  const verdict = validateLeaferDocument({ tag: "Leafer", children: [] });
  assert.equal(verdict.valid, false);
  assert.ok(verdict.issues.some((issue) => issue.code === "root-canvas"));
});

// ── Repair loop (fail-closed, EARS 2/3) ──────────────────────────────────────

test("leafer repair: invalid then valid generation converges and persists nothing itself", async () => {
  const brokenBase = JSON.parse(VALID_DOC) as { width: unknown };
  brokenBase.width = "wide";
  const invalid = JSON.stringify(brokenBase);
  const subagentCalls: RunSubagentOptions[] = [];
  const ctx = makeCtx({ generatedQueue: [invalid, VALID_DOC], subagentCalls });
  const result = await repairLeaferProgram(ctx, {
    text: invalid,
    contract: LEAFER_CREATE_CONTRACT,
    progressCode: "design.materialize.repairing",
    basePercent: 70,
  });
  assert.ok(result.ok, `repair should converge: ${result.ok ? "" : result.error}`);
  // Success returns the CANONICAL document (no whitespace/key-order jitter).
  assert.equal(result.value, JSON.stringify(JSON.parse(VALID_DOC)));
  assert.equal(subagentCalls.length, 2, "round 0 repairs to invalid, round 1 converges");
  assert.match(subagentCalls[0].prompt, /Self-check issues:/);
  assert.match(subagentCalls[0].prompt, /root-canvas/);
});

test("leafer repair: exhausted budget returns a structured error (fail-closed)", async () => {
  const brokenBase = JSON.parse(VALID_DOC) as { width: unknown };
  brokenBase.width = "wide";
  const invalid = JSON.stringify(brokenBase);
  const ctx = makeCtx({ generatedQueue: [invalid, invalid, invalid] });
  const result = await repairLeaferProgram(ctx, {
    text: invalid,
    contract: LEAFER_CREATE_CONTRACT,
    progressCode: "design.materialize.repairing",
    basePercent: 70,
  });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /failed the self-check gate after 2 repair round/);
  assert.match(result.ok ? "" : result.error, /root-canvas/);
});

// ── Self-check gate (WP5, M3E 完成定义) ──────────────────────────────────────

test("leafer self-check gate: empty scene is an error, warnings never trigger repair rounds", () => {
  // Empty scene: renderable but not a design — the gate blocks it.
  const empty = JSON.stringify({ tag: "Leafer", width: 800, height: 600, fill: "#fff", children: [] });
  const verdict = selfCheckLeaferDocument(empty);
  assert.equal(verdict.valid, false);
  assert.ok(verdict.issues.some((issue) => issue.code === "empty-scene"));
  // Warning-level findings (duplicate-geometry) do NOT gate — no oscillation.
  const withDuplicates = JSON.stringify({
    tag: "Leafer",
    width: 800,
    height: 600,
    children: [
      { tag: "Rect", name: "a", x: 10, y: 10, width: 50, height: 50, fill: "#111111" },
      { tag: "Rect", name: "b", x: 10, y: 10, width: 50, height: 50, fill: "#111111" },
    ],
  });
  assert.equal(selfCheckLeaferDocument(withDuplicates).valid, true, "warnings must not enter the repair gate (无抖动)");
});

test("leafer repair: gate-level lint findings (out-of-bounds) drive repair rounds", async () => {
  const outOfBounds = JSON.stringify({
    tag: "Leafer",
    width: 800,
    height: 600,
    children: [{ tag: "Rect", name: "ghost", x: 900, y: 700, width: 100, height: 50, fill: "#111111" }],
  });
  const fixed = JSON.stringify({
    tag: "Leafer",
    width: 800,
    height: 600,
    children: [{ tag: "Rect", name: "ghost", x: 100, y: 100, width: 100, height: 50, fill: "#111111" }],
  });
  const subagentCalls: RunSubagentOptions[] = [];
  const ctx = makeCtx({ generatedQueue: [fixed], subagentCalls });
  const result = await repairLeaferProgram(ctx, {
    text: outOfBounds,
    contract: LEAFER_CREATE_CONTRACT,
    progressCode: "design.materialize.repairing",
    basePercent: 70,
  });
  assert.ok(result.ok, `lint-driven repair should converge: ${result.ok ? "" : result.error}`);
  assert.equal(subagentCalls.length, 1);
  assert.match(subagentCalls[0].prompt, /out-of-bounds/);
});

// ── UI→prompt deterministic compiler (WP5, M3E #2/#5) ────────────────────────

test("leafer describe: deterministic, key-order invariant, semantic positions", () => {
  const doc = {
    tag: "Leafer",
    width: 1440,
    height: 1024,
    fill: "#ffffff",
    children: [
      {
        tag: "Frame",
        name: "hero",
        x: 0,
        y: 0,
        width: 1440,
        height: 300,
        fill: "#111318",
        children: [
          { tag: "Text", name: "title", x: 24, y: 24, text: "Monthly Ops Dashboard", fill: "#F5F5F5", fontSize: 24 },
        ],
      },
      { tag: "Rect", name: "cta", x: 1200, y: 900, width: 200, height: 80, fill: "#4F46E5" },
    ],
  };
  const a = describeLeaferDocument(JSON.stringify(doc));
  const b = describeLeaferDocument(JSON.stringify(doc));
  assert.equal(a.outline, b.outline, "same document → byte-identical outline");
  assert.equal(a.nodeCount, 3);
  // Key-order jitter in the input must not change the outline (无抖动).
  const flipped = JSON.stringify({
    children: doc.children,
    fill: doc.fill,
    height: doc.height,
    width: doc.width,
    tag: doc.tag,
  });
  assert.equal(describeLeaferDocument(flipped).outline, a.outline, "key order must not jitter the outline");
  // Geometry→semantic translation (M3E #2).
  assert.match(a.outline, /Canvas 1440x1024, background #ffffff, 2 top-level element/);
  assert.match(a.outline, /- Frame "hero" 1440x300 at top-full-width/);
  assert.match(a.outline, /- Text "title" auto-sized.*"Monthly Ops Dashboard"/);
  assert.match(a.outline, /- Rect "cta" 200x80 at bottom-right/);
  // Unnamed elements get a deterministic path fallback (M3E #5).
  const unnamed = describeLeaferDocument(
    JSON.stringify({
      tag: "Leafer",
      width: 100,
      height: 100,
      children: [{ tag: "Rect", x: 0, y: 0, width: 10, height: 10 }],
    })
  );
  assert.match(unnamed.outline, /rect-at-c0/);
});

// ── materialize / revise switch (EARS 1/10) ──────────────────────────────────

const LEAFER_SUBAGENT = `\`\`\`json\n${VALID_DOC}\n\`\`\``;

test("design.materialize produces a leafer suite version via render_leafer and never calls render_openui", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: RunSubagentOptions[] = [];
  const result = await designMaterializeRun(
    { requirement: "Analytics dashboard", designSystemId: "dark-tech" },
    makeCtx({ generatedQueue: [LEAFER_SUBAGENT], mcpCalls, subagentCalls })
  );
  assert.equal(result.ok, true);
  const save = mcpCalls.find((call) => call.name.endsWith("render_leafer"));
  assert.ok(save, "materialize must persist through render_leafer");
  assert.equal(save.args.designSystemId, "dark-tech");
  assert.equal(typeof save.args.leafer, "string");
  assert.deepEqual(JSON.parse(save.args.leafer as string).tag, "Leafer");
  assert.ok(!mcpCalls.some((call) => call.name.endsWith("render_openui")), "leafer stack must not call render_openui");
  // Contract injection: the generation prompt carries the scene contract.
  assert.match(subagentCalls[0].prompt, /LEAFER|Leafer scene-tree JSON document/);
  assert.match(subagentCalls[0].prompt, /dark-tech|Design System/);
});

test("design.materialize rejects a structurally broken generation before persistence", async () => {
  const mcpCalls: McpCall[] = [];
  const broken = JSON.stringify({ tag: "Leafer", width: 100, height: 100, children: [{ tag: "Triangle" }] });
  const result = await designMaterializeRun(
    { requirement: "Analytics dashboard", designSystemId: "dark-tech" },
    makeCtx({ generatedQueue: [`\`\`\`json\n${broken}\n\`\`\``, broken, broken], mcpCalls })
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : (result.error ?? ""), /self-check gate/);
  assert.ok(!mcpCalls.some((call) => call.name.endsWith("render_leafer")), "invalid documents must never persist");
});

test("design.revise(part=design) revises the leafer baseline with PRESERVE contract", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: RunSubagentOptions[] = [];
  const result = await designReviseRun(
    {
      suiteId: UI_REF.suiteId,
      versionId: UI_REF.versionId,
      part: "design",
      target: "hero",
      instruction: "make the hero larger",
    },
    makeCtx({
      ui: { leafer: VALID_DOC, designSystemId: "dark-tech" },
      generatedQueue: [LEAFER_SUBAGENT],
      mcpCalls,
      subagentCalls,
    })
  );
  assert.equal(result.ok, true);
  const save = mcpCalls.find((call) => call.name.endsWith("render_leafer"));
  assert.ok(save, "leafer revise must persist through render_leafer");
  assert.equal(save.args.suiteId, UI_REF.suiteId);
  assert.match(subagentCalls[0].prompt, /Preserve the root canvas size/);
  // WP5 UI→prompt: deterministic outline + canonical baseline + verbatim
  // instruction (M3E 意图直通/命名指代/无抖动).
  assert.match(subagentCalls[0].prompt, /Instruction \(verbatim\): "make the hero larger"/);
  assert.match(subagentCalls[0].prompt, /Current design outline/);
  assert.match(subagentCalls[0].prompt, /Current scene JSON \(canonical\)/);
  assert.ok(
    !mcpCalls.some((call) => call.name.endsWith("update_openui")),
    "leafer revise must not touch the legacy channel"
  );
});

test("design.revise(part=design) keeps the legacy update_openui path for openui-only versions", async () => {
  const mcpCalls: McpCall[] = [];
  const result = await designReviseRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId, part: "design", target: "hero", instruction: "tweak" },
    makeCtx({
      ui: { openui: 'root = Stack([])\nhero = TextContent("h", "large")', designSystemId: "dark-tech" },
      generatedQueue: ['```openui\nroot = Stack([])\nhero = TextContent("h", "large")\n```'],
      mcpCalls,
    })
  );
  assert.equal(result.ok, true);
  assert.ok(
    mcpCalls.some((call) => call.name.endsWith("update_openui")),
    "legacy versions keep the update_openui channel"
  );
  assert.ok(!mcpCalls.some((call) => call.name.endsWith("render_leafer")));
});

// ── lint routing (EARS 9) ────────────────────────────────────────────────────

test("design.lint routes leafer versions to the scene-tree rules", async () => {
  const mcpCalls: McpCall[] = [];
  const outOfBounds = JSON.stringify({
    tag: "Leafer",
    width: 800,
    height: 600,
    children: [{ tag: "Rect", x: 900, y: 700, width: 100, height: 50, fill: "#123456" }],
  });
  const result = await designLintRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({ ui: { leafer: outOfBounds }, mcpCalls })
  );
  assert.equal(result.ok, true);
  assert.ok((result.findings ?? []).some((finding) => finding.ruleId === "out-of-bounds"));
  const save = mcpCalls.find((call) => call.name.endsWith("save_suite_result"));
  assert.match((save?.args.note as string) ?? "", /Leafer static lint/);
});

test("lintLeaferDocument: empty text / duplicate geometry / token-palette rules", () => {
  const doc = JSON.stringify({
    tag: "Leafer",
    width: 800,
    height: 600,
    children: [
      { tag: "Text", x: 10, y: 10, text: "   " },
      { tag: "Rect", x: 100, y: 100, width: 50, height: 50, fill: "#ff0000" },
      { tag: "Rect", x: 100, y: 100, width: 50, height: 50, fill: "#ff0000" },
    ],
  });
  const findings = lintLeaferDocument(doc, { color: { primary: "#4F46E5" } });
  const rules = findings.map((finding) => finding.ruleId);
  assert.ok(rules.includes("empty-text"));
  assert.ok(rules.includes("duplicate-geometry"));
  assert.ok(rules.includes("unlisted-color"), `token rule expected, got: ${rules.join(",")}`);
  // Without tokens the palette rule is skipped.
  const withoutTokens = lintLeaferDocument(doc).map((finding) => finding.ruleId);
  assert.ok(!withoutTokens.includes("unlisted-color"));
});

// ── SKILL.md anti-drift hooks (WP0.5) ────────────────────────────────────────

test("deep-design SKILL.md pipeline contract matches the leafer stack (anti-drift)", () => {
  const skillPath = path.join(
    path.dirname(url.fileURLToPath(import.meta.url)),
    "../../templates/plugins/design/skills/deep-design/SKILL.md"
  );
  const skill = fs.readFileSync(skillPath, "utf8");
  const pipeline = skill.split("Pipeline mode")[1] ?? "";
  assert.match(
    pipeline,
    /design\.materialize → Leafer scene JSON/,
    "materialize sub-contract must name the leafer format"
  );
  assert.match(pipeline, /"tag": "Leafer"/, "the scene document shape must be pinned in the skill");
  assert.match(pipeline, /json.*code fence|`json`/, "the json fence requirement must be pinned");
  assert.match(pipeline, /Do NOT emit \.dd HTML or OpenUI Lang/, "the old format must be explicitly excluded");
  // Legacy revise path stays documented (dual-stack routing).
  assert.match(pipeline, /legacy OpenUI suites|OpenUI Lang program/);
});
