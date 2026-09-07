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
  prototypeReviseRun,
  prototypeSpecDefinition,
  prototypeSpecRun,
  prototypeVerifyDefinition,
  prototypeVerifyRun,
} from "../actions";
import { hasPageList, looksLikeOpenuiProgram, looksLikeSpecDocument } from "../actions/prototype";
import { NULL_SPAWNER } from "../actions/types";
import type { ActionContext, ActionProgress, RunSubagentOptions } from "../actions/types";

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
    emits?: ActionProgress[];
  } = {}
): ActionContext {
  const mcpCalls = options.mcpCalls ?? [];
  const subagentCalls = options.subagentCalls ?? [];
  const emits = options.emits ?? [];
  return {
    projectRoot: path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../.."),
    signal: new AbortController().signal,
    emit: (event) => {
      emits.push(event);
    },
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

// ── review-fix regressions ────────────────────────────────────────────────────

test("page-list detection accepts CJK headings so Chinese specs verify", async () => {
  assert.equal(hasPageList("## 页面清单\n- 首页"), true);
  assert.equal(hasPageList("### 页面清单：\n- 首页"), true);
  assert.equal(hasPageList("## Page list\n- Board"), true);
  assert.equal(hasPageList("## 页面\n- 首页"), false);

  // End-to-end through the check the page-list detection feeds.
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({ prototype: { spec: "# 任务看板\n\n## 页面清单\n- 看板\n- 详情", openui: "root = Column([board])" } })
  );
  assert.equal(result.ok, true);
  assert.equal(result.verification?.status, "passed");
});

test("prototype.revise verification appends a pending observation and preserves prior checks", async () => {
  const mcpCalls: McpCall[] = [];
  const result = await prototypeReviseRun(
    {
      suiteId: PROTOTYPE_REF.suiteId,
      versionId: PROTOTYPE_REF.versionId,
      part: "verification",
      target: "board renders",
      instruction: "re-check after the spacing fix",
    },
    makeCtx({
      prototype: {
        openui: "root = Column([board])",
        verification: { status: "passed", checks: [{ id: "c1", label: "Renders", status: "passed" }] },
      },
      mcpCalls,
    })
  );
  assert.equal(result.ok, true);
  const save = mcpCalls.find((call) => call.name.endsWith("save_suite_result"));
  const verification = save?.args.verification as {
    status: string;
    checks: Array<{ id: string; label: string; status: string }>;
  };
  assert.equal(verification.status, "pending");
  assert.equal(verification.checks.length, 2, "prior checks must survive the revision");
  assert.deepEqual(verification.checks[0], { id: "c1", label: "Renders", status: "passed" });
  assert.equal(verification.checks[1].label, "board renders");
  assert.equal(verification.checks[1].status, "pending");
});

test("design.materialize: the suite's stored requirement reaches the prompt without mutating the input", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: SubagentCall[] = [];
  const input = {
    prototypeSuiteId: PROTOTYPE_REF.suiteId,
    prototypeVersionId: PROTOTYPE_REF.versionId,
    designSystemId: "terminal-mono",
  };
  const result = await designMaterializeRun(
    input,
    makeCtx({
      prototype: { requirement: "需要一个月度经营看板", openui: "root = Column([board])" },
      generated: "```openui\nroot = Screen()\nboard = Card([])\n```",
      mcpCalls,
      subagentCalls,
    })
  );
  assert.equal(result.ok, true);
  assert.ok(
    subagentCalls[0].prompt?.includes("需要一个月度经营看板"),
    "the requirement from the suite must reach the subagent prompt"
  );
  const save = mcpCalls.find((call) => call.name.endsWith("render_openui"));
  assert.equal(save?.args.requirement, "需要一个月度经营看板");
  assert.equal(input.requirement, undefined, "the caller's input object must not be mutated");
});

test("design.review rejects empty evidence with a reason and accepts concrete evidence", async () => {
  const empty = await designReviewRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: { openui: 'root = Screen("ui")' },
      generated: '```json\n{"status":"passed","composite":0.8,"evidence":{}}\n```',
    })
  );
  assert.equal(empty.ok, false, "empty evidence must not promote the suite to verified");
  assert.match(empty.error ?? "", /evidence/i);

  const concrete = await designReviewRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: { openui: 'root = Screen("ui")' },
      generated: '```json\n{"status":"passed","composite":0.8,"evidence":{"section":"hero"}}\n```',
    })
  );
  assert.equal(concrete.ok, true);
  assert.equal(concrete.review?.status, "passed");
});

test("design.lint hex + nodePath rules: real colors flagged, issue refs and invalid hex are not", async () => {
  const mcpCalls: McpCall[] = [];
  const result = await designLintRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: {
        openui: [
          'a = Card(style="color:#aabbcc")',
          'b = Text(text="issue #123 fixed")',
          'c = Card(style="color: #abcde")',
          'd = Card(style="color:#112233", aria-valid="true", id="hero")',
        ].join("\n"),
      },
      mcpCalls,
    })
  );
  assert.equal(result.ok, true);
  const colors = result.findings?.filter((finding) => finding.ruleId === "hardcoded-color") ?? [];
  assert.equal(colors.length, 2, "only the two style-context hex colors are flagged");
  assert.match(colors[0]!.message, /Line 1/, "color:#aabbcc flagged");
  assert.match(colors[1]!.message, /Line 4/, "#112233 in style context flagged");
  assert.equal(colors[1]!.nodePath, "hero", 'whitespace-anchored id="hero" still resolves');
  assert.ok(
    result.findings?.every((finding) => finding.nodePath !== "true"),
    'aria-valid="true" must never become a nodePath'
  );
});

test("truncated or fence-less OpenUI output fails the action instead of persisting garbage", async () => {
  const mcpCalls: McpCall[] = [];
  const truncated = await prototypeMaterializeRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { requirement: "Task board", spec: "# Tasks\n\n## Page list\n- Board" },
      // Missing closing fence: the subagent output was cut off mid-program —
      // previously the WHOLE message (incl. the prose line) persisted as a
      // "ready" version.
      generated: "Here is the program:\n```openui\nroot = Column([board\nboard = Card([])",
      mcpCalls,
    })
  );
  assert.equal(truncated.ok, false);
  assert.match(String(truncated.error ?? ""), /regenerate/i);
  assert.equal(
    mcpCalls.some((call) => call.name.endsWith("render_openui")),
    false
  );
});

test("fence-less prose OpenUI output fails the structural gate", async () => {
  const result = await prototypeMaterializeRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { requirement: "Task board", spec: "# Tasks\n\n## Page list\n- Board" },
      // No fence at all and no line-initial `root =` binding: prose garbage.
      generated: "Here is the program: board = Card([]) with no root declaration",
    })
  );
  assert.equal(result.ok, false);
  assert.match(String(result.error ?? ""), /regenerate/i);
});

test("structural gates: looksLikeOpenuiProgram / looksLikeSpecDocument", () => {
  assert.equal(looksLikeOpenuiProgram("root = Column([a])\na = Card([])"), true);
  assert.equal(looksLikeOpenuiProgram("Here is the program: board = Card([])"), false);
  assert.equal(looksLikeSpecDocument("# Tasks\n\n## Page list\n- Board"), true);
  assert.equal(looksLikeSpecDocument("plain prose without any heading"), false);
});

test("progress emits carry stable machine codes for the renderer i18n seam", async () => {
  const codesOf = (emits: ActionProgress[]): Array<string | undefined> =>
    emits.map((event) => (event.data as { code?: string } | undefined)?.code);

  const specEmits: ActionProgress[] = [];
  const spec = await prototypeSpecRun(
    { requirement: "Task board" },
    makeCtx({ generated: "```markdown\n# Tasks\n\n## Page list\n- Board\n```", emits: specEmits })
  );
  assert.equal(spec.ok, true);
  assert.deepEqual(codesOf(specEmits), ["prototype.spec.generating", "prototype.spec.saved"]);

  const materializeEmits: ActionProgress[] = [];
  const materialize = await prototypeMaterializeRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { requirement: "Task board", spec: "# Tasks\n\n## Page list\n- Board" },
      generated: "```openui\nroot = Column([board])\nboard = Card([])\n```",
      emits: materializeEmits,
    })
  );
  assert.equal(materialize.ok, true);
  assert.deepEqual(codesOf(materializeEmits), ["prototype.materialize.generating", "prototype.materialize.saved"]);

  const designEmits: ActionProgress[] = [];
  const design = await designMaterializeRun(
    {
      prototypeSuiteId: PROTOTYPE_REF.suiteId,
      prototypeVersionId: PROTOTYPE_REF.versionId,
      designSystemId: "terminal-mono",
    },
    makeCtx({
      prototype: { requirement: "Task board", openui: "root = Column([board])" },
      generated: "```openui\nroot = Screen()\nboard = Card([])\n```",
      emits: designEmits,
    })
  );
  assert.equal(design.ok, true);
  assert.deepEqual(codesOf(designEmits), ["design.materialize.generating", "design.materialize.saved"]);
});
