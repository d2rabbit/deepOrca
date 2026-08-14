import { test } from "node:test";
import assert from "node:assert/strict";
import { designMaterializeRun } from "../actions/design";
import type { ActionContext } from "../actions/types";

function makeCtx(overrides?: Partial<ActionContext>): ActionContext {
  return {
    projectRoot: "/tmp/design-action-test",
    signal: new AbortController().signal,
    emit: () => {},
    ...(overrides as Partial<ActionContext> | undefined),
  };
}

test("materialize falls back to the keyword heuristic when no LLM judge is injected", async () => {
  const ctx = makeCtx({
    runSubagent: async () => "subagent text",
    executeMcpTool: (async () => ({ ok: true })) as ActionContext["executeMcpTool"],
  });
  const result = await designMaterializeRun({ requirement: "做一个带表单和筛选的登录看板" }, ctx);
  assert.equal(result.ok, true);
  assert.equal(result.pipeline, "openui");

  const result2 = await designMaterializeRun({ requirement: "设计一个品牌落地页 landing page" }, ctx);
  assert.equal(result2.pipeline, "design");
});

test("materialize lets the LLM judgment override the heuristic (fail-open both ways)", async () => {
  // Heuristic says presentational (品牌/落地页/营销 — no interactive words),
  // LLM judges interactive (the landing page embeds a signup form).
  let captured: { prompt: string; choices: readonly string[] } | null = null;
  const ctx = makeCtx({
    judgeViaLlm: async (prompt, choices) => {
      captured = { prompt, choices };
      return "openui";
    },
    runSubagent: async () => null,
    executeMcpTool: (async () => ({ ok: true })) as ActionContext["executeMcpTool"],
  });
  const result = await designMaterializeRun({ requirement: "品牌落地页营销页" }, ctx);
  assert.equal(result.pipeline, "openui");
  assert.equal(result.reasoning, "LLM judgment: openui (heuristic said design)");
  assert.ok(captured, "judgeViaLlm should have been consulted");
  assert.deepEqual(captured!.choices, ["openui", "design"]);
});

test("materialize ignores a null/invalid LLM judgment (fail-open)", async () => {
  const ctx = makeCtx({
    judgeViaLlm: async () => null,
    runSubagent: async () => null,
    executeMcpTool: (async () => ({ ok: true })) as ActionContext["executeMcpTool"],
  });
  // No keyword signals — heuristic default is the interactive prototype.
  const result = await designMaterializeRun({ requirement: "一个关于咖啡的东西" }, ctx);
  assert.equal(result.pipeline, "openui");
  assert.match(result.reasoning ?? "", /defaulting/i);
});

test("materialize returns a null artifactId instead of guessing from subagent text", async () => {
  const ctx = makeCtx({
    runSubagent: async () => "The prototype is ready, enjoy!",
    executeMcpTool: (async () => ({ ok: true })) as ActionContext["executeMcpTool"],
  });
  const result = await designMaterializeRun({ requirement: "kanban board" }, ctx);
  assert.equal(result.ok, true);
  assert.equal(result.artifactId, null);
});

test("user-specified pipeline always wins (no LLM consultation)", async () => {
  let consulted = false;
  const ctx = makeCtx({
    judgeViaLlm: async () => {
      consulted = true;
      return "design";
    },
    runSubagent: async () => null,
    executeMcpTool: (async () => ({ ok: true })) as ActionContext["executeMcpTool"],
  });
  const result = await designMaterializeRun({ requirement: "kanban board", pipeline: "openui" }, ctx);
  assert.equal(result.pipeline, "openui");
  assert.equal(consulted, false);
});
