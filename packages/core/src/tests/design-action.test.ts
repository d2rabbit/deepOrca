import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import {
  designLintDefinition,
  designLintRun,
  designMaterializeDefinition,
  designMaterializeRun,
  designReviewDefinition,
  designReviewRun,
  designReviseDefinition,
  prototypeMaterializeDefinition,
  prototypeMaterializeRun,
  prototypeReviseDefinition,
  prototypeSpecDefinition,
  prototypeSpecRun,
  prototypeVerifyDefinition,
  prototypeVerifyRun,
} from "../actions";
import { NULL_SPAWNER } from "../actions/types";
import type { ActionContext, RunSubagentOptions } from "../actions/types";

const PROTOTYPE_REF = { suiteId: "proto-suite", versionId: "proto-v1", kind: "prototype" as const };
const UI_REF = { suiteId: "ui-suite", versionId: "ui-v1", kind: "ui" as const };

type McpCall = { name: string; args: Record<string, unknown> };
type SubagentCall = RunSubagentOptions;

function payload(ref: typeof PROTOTYPE_REF | typeof UI_REF, content: Record<string, unknown>): string {
  return JSON.stringify({ artifactRef: ref, title: "Suite", status: "ready", content });
}

function makeCtx(
  options: {
    prototype?: Record<string, unknown>;
    ui?: Record<string, unknown>;
    generated?: string;
    mcpCalls?: McpCall[];
    subagentCalls?: SubagentCall[];
  } = {}
): ActionContext {
  const mcpCalls = options.mcpCalls ?? [];
  const subagentCalls = options.subagentCalls ?? [];
  return {
    projectRoot: path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../.."),
    signal: new AbortController().signal,
    emit: () => {},
    spawner: NULL_SPAWNER,
    runSubagent: async (call) => {
      subagentCalls.push(call);
      return { sessionId: "sub", content: options.generated ?? "```\nok\n```" };
    },
    executeMcpTool: async (name, args) => {
      mcpCalls.push({ name, args });
      if (name.endsWith("read_suite_version")) {
        const ref = args.suiteId === UI_REF.suiteId ? UI_REF : PROTOTYPE_REF;
        const content = ref.kind === "ui" ? (options.ui ?? {}) : (options.prototype ?? {});
        return { ok: true, output: payload(ref, content) };
      }
      const ref = name.includes("design") || args.quality || args.tokens || args.components ? UI_REF : PROTOTYPE_REF;
      return { ok: true, output: `saved\nArtifactRef: ${JSON.stringify(ref)}` };
    },
  };
}

test("suite v2 action schemas expose the renderer contract", () => {
  assert.deepEqual(
    [
      prototypeSpecDefinition.id,
      prototypeMaterializeDefinition.id,
      prototypeVerifyDefinition.id,
      prototypeReviseDefinition.id,
      designMaterializeDefinition.id,
      designLintDefinition.id,
      designReviewDefinition.id,
      designReviseDefinition.id,
    ],
    [
      "prototype.spec",
      "prototype.materialize",
      "prototype.verify",
      "prototype.revise",
      "design.materialize",
      "design.lint",
      "design.review",
      "design.revise",
    ]
  );
  assert.ok("suiteId" in prototypeSpecDefinition.parameters.properties);
  assert.ok("baseVersionId" in prototypeSpecDefinition.parameters.properties);
  assert.ok("versionId" in prototypeMaterializeDefinition.parameters.properties);
  assert.ok("prototypeSuiteId" in designMaterializeDefinition.parameters.properties);
  assert.ok("designSystemId" in designMaterializeDefinition.parameters.properties);
});

test("SessionManager registers every suite v2 action", () => {
  const source = fs.readFileSync(
    path.join(path.dirname(url.fileURLToPath(import.meta.url)), "../session-manager-base.ts"),
    "utf8"
  );
  for (const symbol of [
    "prototypeVerifyDefinition",
    "prototypeReviseDefinition",
    "designLintDefinition",
    "designReviewDefinition",
    "designReviseDefinition",
  ]) {
    assert.match(source, new RegExp(`actionRegistry\\.register\\(${symbol}`));
  }
});

test("prototype.spec creates a real suite through render_spec and returns ArtifactRef", async () => {
  const mcpCalls: McpCall[] = [];
  const result = await prototypeSpecRun(
    { requirement: "Task board" },
    makeCtx({ generated: "```markdown\n# Tasks\n\n## Page list\n- Board\n```", mcpCalls })
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.artifactRef, PROTOTYPE_REF);
  const save = mcpCalls.find((call) => call.name.endsWith("render_spec"));
  assert.equal(save?.args.requirement, "Task board");
  assert.equal(typeof save?.args.note, "string", "initial generation must force suite persistence");
});

test("prototype.materialize reads an immutable suite version and resets verification through render_openui", async () => {
  const mcpCalls: McpCall[] = [];
  const result = await prototypeMaterializeRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { requirement: "Task board", spec: "# Tasks\n\n## Page list\n- Board" },
      generated: "```openui\nroot = Column([board])\nboard = Card([])\n```",
      mcpCalls,
    })
  );
  assert.equal(result.ok, true);
  const save = mcpCalls.find((call) => call.name.endsWith("render_openui"));
  assert.equal(save?.args.suiteId, PROTOTYPE_REF.suiteId);
  assert.equal(save?.args.versionId, PROTOTYPE_REF.versionId);
});

test("prototype.verify runs deterministic structure checks and persists verification", async () => {
  const mcpCalls: McpCall[] = [];
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { spec: "# Tasks\n\n## Page list\n- Board", openui: "root = Column([board])" },
      mcpCalls,
    })
  );
  assert.equal(result.ok, true);
  assert.equal(result.verification?.status, "passed");
  const save = mcpCalls.find((call) => call.name.endsWith("save_suite_result"));
  assert.equal((save?.args.verification as { status: string }).status, "passed");
});

test("design.materialize injects the selected bundled system and source prototype", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: SubagentCall[] = [];
  const result = await designMaterializeRun(
    {
      prototypeSuiteId: PROTOTYPE_REF.suiteId,
      prototypeVersionId: PROTOTYPE_REF.versionId,
      designSystemId: "terminal-mono",
    },
    makeCtx({
      prototype: { requirement: "Task board", openui: "root = Column([board])" },
      generated: "```openui\nroot = Screen()\nboard = Card([])\n```",
      mcpCalls,
      subagentCalls,
    })
  );
  assert.equal(result.ok, true);
  assert.match(subagentCalls[0].prompt ?? "", /Design System: Terminal Mono/);
  const save = mcpCalls.find((call) => call.name.endsWith("render_openui"));
  assert.deepEqual(save?.args.sourcePrototype, {
    suiteId: PROTOTYPE_REF.suiteId,
    versionId: PROTOTYPE_REF.versionId,
  });
  assert.equal(save?.args.designSystemId, "terminal-mono");
});

test("design.lint persists static OpenUI findings without runtime claims", async () => {
  const mcpCalls: McpCall[] = [];
  const result = await designLintRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: {
        openui:
          'root = Screen("bad")\nhero = Card(style="background: #1c6fe0", data-sem="hero")\nhint = Text(style="font-size: 10px")',
      },
      mcpCalls,
    })
  );
  assert.equal(result.ok, true);
  assert.ok(result.findings?.some((finding) => finding.ruleId === "hardcoded-color"));
  assert.ok(result.findings?.some((finding) => finding.ruleId === "tiny-font"));
  const save = mcpCalls.find((call) => call.name.endsWith("save_suite_result"));
  assert.ok(Array.isArray((save?.args.quality as { lintFindings: unknown[] }).lintFindings));
});

test("design.review validates single-round JSON and quality revise only clears review", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: SubagentCall[] = [];
  const ctx = makeCtx({
    ui: { openui: 'root = Screen("ui")\nhero = Card(data-sem="hero")', quality: {} },
    generated: '```json\n{"status":"passed","composite":0.8,"evidence":{"section":"hero"}}\n```',
    mcpCalls,
    subagentCalls,
  });
  const reviewed = await designReviewRun({ suiteId: UI_REF.suiteId, versionId: UI_REF.versionId }, ctx);
  assert.equal(reviewed.review?.rounds, 1);
  const before = subagentCalls.length;
  const revised = await designReviseDefinition;
  void revised;
  const qualityResult = await (
    await import("../actions/design")
  ).designReviseRun(
    {
      suiteId: UI_REF.suiteId,
      versionId: UI_REF.versionId,
      part: "quality",
      target: "review",
      instruction: "re-run later",
    },
    ctx
  );
  assert.equal(qualityResult.ok, true);
  assert.equal(subagentCalls.length, before, "quality revision must not let the LLM manufacture a pass");
  assert.equal(mcpCalls.at(-1)?.args.clearReview, true);
});
