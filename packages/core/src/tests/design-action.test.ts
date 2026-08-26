/**
 * Design-module split action tests (real-machine feedback: the auto-routed
 * "一句话→原型" flow was retired):
 *   - design.materialize is the UI-DESIGN entry: requirement (a single
 *     sentence is fine) and/or a prototype artifact as the interaction basis;
 *     no routing, no judgeViaLlm.
 *   - prototype.spec / prototype.materialize are the prototype module's two
 *     explicit steps (需求 → 需求文档 → 原型图), run silent (no session residue).
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { designMaterializeRun } from "../actions/design";
import { prototypeSpecRun, prototypeMaterializeRun } from "../actions/prototype";
import type { ActionContext, ActionRunOptions } from "../actions/types";

type SubagentCall = { skill: string; prompt: string; silent?: boolean };

function makeCtx(overrides?: {
  projectRoot?: string;
  calls?: SubagentCall[];
  runSubagent?: ActionContext["runSubagent"];
}): ActionContext {
  const calls = overrides?.calls ?? [];
  const defaultSubagent = async (opts: ActionRunOptions) => {
    calls.push({ skill: opts.skill, prompt: opts.prompt, silent: opts.silent });
    return { sessionId: "sub-1", content: "ok" };
  };
  // Spread LAST so an explicit runSubagent: undefined removes the channel.
  return {
    projectRoot: overrides?.projectRoot ?? "/tmp/design-action-test",
    signal: new AbortController().signal,
    emit: () => {},
    runSubagent: defaultSubagent,
    ...(overrides as { runSubagent?: ActionContext["runSubagent"] } | undefined),
  };
}

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-design-split-"));
});

// ── design.materialize (UI-design module) ────────────────────────────────────

test("requirement-only run goes straight to deep-design, silent, no routing", async () => {
  const calls: SubagentCall[] = [];
  const ctx = makeCtx({ calls, projectRoot: tmpRoot });
  const result = await designMaterializeRun({ requirement: "品牌落地页" }, ctx);
  assert.equal(result.ok, true);
  assert.equal(result.pipeline, "design");
  assert.equal(result.artifactId, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].skill, "deep-design");
  assert.equal(calls[0].silent, true, "panel runs must leave no session residue");
  assert.ok(calls[0].prompt.includes("品牌落地页"));
  assert.ok(calls[0].prompt.includes("render_design"));
});

test("prototype basis: the design prompt embeds the prototype program", async () => {
  const dir = path.join(tmpRoot, ".deeporca", "designs", "proto-1");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "prototype.openui.txt"), "root = Column([loginForm])");
  const calls: SubagentCall[] = [];
  const ctx = makeCtx({ calls, projectRoot: tmpRoot });

  const result = await designMaterializeRun({ requirement: "电商后台", prototypeArtifactId: "proto-1" }, ctx);
  assert.equal(result.ok, true);
  assert.ok(calls[0].prompt.includes("root = Column([loginForm])"), "prototype program must reach the designer");
  assert.ok(calls[0].prompt.includes("电商后台"));

  // Prototype-only run (no requirement) is valid: elevate the prototype.
  const result2 = await designMaterializeRun({ prototypeArtifactId: "proto-1" }, makeCtx({ projectRoot: tmpRoot }));
  assert.equal(result2.ok, true);
});

test("missing prototype artifact fails with a clear error", async () => {
  const ctx = makeCtx({ projectRoot: tmpRoot });
  const result = await designMaterializeRun({ prototypeArtifactId: "nope-404" }, ctx);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /prototype artifact not found/);
});

test("empty input and missing subagent channel are rejected", async () => {
  assert.equal((await designMaterializeRun({}, makeCtx({ projectRoot: tmpRoot }))).ok, false);
  assert.equal(
    (await designMaterializeRun({ requirement: "x" }, makeCtx({ projectRoot: tmpRoot, runSubagent: undefined }))).ok,
    false
  );
});

// ── prototype.spec (step 1: requirement → requirements document) ─────────────

test("spec step: routes to the spec-writer skill with the requirement, silent", async () => {
  const calls: SubagentCall[] = [];
  const ctx = makeCtx({ calls, projectRoot: tmpRoot });
  const result = await prototypeSpecRun({ requirement: "一个任务看板" }, ctx);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].skill, "spec-writer");
  assert.equal(calls[0].silent, true);
  assert.ok(calls[0].prompt.includes("一个任务看板"));
  assert.ok(calls[0].prompt.includes("render_spec"));
});

test("spec step rejects empty requirement / missing channel / subagent failure", async () => {
  assert.equal((await prototypeSpecRun({ requirement: "  " }, makeCtx())).ok, false);
  assert.equal((await prototypeSpecRun({}, makeCtx())).ok, false);
  const noChannel = makeCtx({ runSubagent: undefined });
  assert.equal((await prototypeSpecRun({ requirement: "x" }, noChannel)).ok, false);
  const failing = makeCtx({
    runSubagent: (async () => {
      throw new Error("skill boom");
    }) as ActionContext["runSubagent"],
  });
  const result = await prototypeSpecRun({ requirement: "x" }, failing);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /skill boom/);
});

// ── prototype.materialize (step 2: requirements document → prototype) ────────

test("prototype step: embeds the spec document and designs strictly from it", async () => {
  const dir = path.join(tmpRoot, ".deeporca", "designs", "spec-1");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "spec.md"), "# 任务看板 需求文档\n\n## 4. 页面清单\n- 看板视图\n");
  const calls: SubagentCall[] = [];
  const ctx = makeCtx({ calls, projectRoot: tmpRoot });

  const result = await prototypeMaterializeRun({ specArtifactId: "spec-1" }, ctx);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].skill, "pm-designer-openui");
  assert.equal(calls[0].silent, true);
  assert.ok(calls[0].prompt.includes("页面清单"), "spec document must reach the designer");
  assert.ok(calls[0].prompt.includes("render_openui"));
});

test("prototype step fails clearly without a spec artifact", async () => {
  const ctx = makeCtx({ projectRoot: tmpRoot });
  assert.equal((await prototypeMaterializeRun({}, ctx)).ok, false);
  const result = await prototypeMaterializeRun({ specArtifactId: "missing" }, ctx);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /requirements document not found/);
});

test("unsafe spec ids are rejected before any filesystem access", async () => {
  const ctx = makeCtx({ projectRoot: tmpRoot });
  const result = await prototypeMaterializeRun({ specArtifactId: "../../etc" }, ctx);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /requirements document not found/);
});
