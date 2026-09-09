/**
 * Self-recursive OpenUI validation loop (user ask 2026-09-09) — materialize
 * must parse the generated program through the desktop validator and drive
 * bounded repair rounds on structured findings. Pins:
 *   - repair-once-then-valid: render_openui receives the REPAIRED program and
 *     the repair prompt carries the structured findings,
 *   - fail-open: an unavailable validator keeps the legacy single-shot flow,
 *   - a garbage repair round keeps the last good draft,
 *   - an exhausted budget persists best-effort and emits the leftover count.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { prototypeMaterializeRun } from "../actions/prototype";
import { NULL_SPAWNER } from "../actions/types";
import type { ActionContext, ActionProgress } from "../actions/types";

const REF = { suiteId: "repair-suite", versionId: "r-v1", kind: "prototype" as const };

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const BAD_CODE = "root = Fakebox([])";
const GOOD_CODE = [
  '$page = "home"',
  "root = Stack([homeView, ordersView])",
  'homeView = Card([TextContent("概览")])',
  'ordersView = Card([TextContent("列表")])',
].join("\n");

const fence = (code: string): string => "```\n" + code + "\n```";
const INVALID_VERDICT = JSON.stringify({
  valid: false,
  errors: [{ code: "unknown-component", component: "Fakebox", path: "", message: 'Unknown component "Fakebox"' }],
});
const VALID_VERDICT = JSON.stringify({ valid: true, errors: [], unresolved: [], orphaned: [] });

type McpCall = { name: string; args: Record<string, unknown> };

interface CtxOptions {
  /** Per validate_openui call: verdict JSON, or null → tool unavailable. */
  validationScript?: Array<string | null>;
  /** Per subagent call: returned content (initial generation, then repairs). */
  generatedScript?: string[];
  mcpCalls?: McpCall[];
  subagentCalls?: Array<{ skill: string; prompt: string }>;
  emits?: ActionProgress[];
}

function makeCtx(options: CtxOptions = {}): ActionContext {
  const mcpCalls = options.mcpCalls ?? [];
  const subagentCalls = options.subagentCalls ?? [];
  const emits = options.emits ?? [];
  let validateIdx = 0;
  let generatedIdx = 0;
  return {
    projectRoot: (() => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repair-action-"));
      tmpDirs.push(dir);
      return dir;
    })(),
    signal: new AbortController().signal,
    emit: (event: ActionProgress) => {
      emits.push(event);
    },
    spawner: NULL_SPAWNER,
    runSubagent: async (runOpts: { skill: string; prompt?: string }) => {
      subagentCalls.push({ skill: runOpts.skill, prompt: runOpts.prompt ?? "" });
      const content = options.generatedScript?.[generatedIdx] ?? "";
      generatedIdx += 1;
      return { sessionId: "sub", content };
    },
    executeMcpTool: async (name: string, args: Record<string, unknown>) => {
      mcpCalls.push({ name, args });
      if (name.endsWith("read_suite_version")) {
        return {
          ok: true,
          output: JSON.stringify({
            artifactRef: REF,
            title: "Suite",
            status: "ready",
            content: {
              requirement: "订单",
              spec: "# 订单 需求文档\n\n## 页面清单\n\n- 订单页\n",
            },
          }),
        };
      }
      if (name.endsWith("validate_openui")) {
        const verdict = options.validationScript?.[validateIdx];
        validateIdx += 1;
        if (verdict == null) return { ok: false, error: "unknown tool validate_openui" };
        return { ok: true, output: verdict };
      }
      if (name.endsWith("render_openui")) {
        return { ok: true, output: `saved\nArtifactRef: ${JSON.stringify({ ...REF, versionId: "r-v2" })}` };
      }
      return { ok: true, output: "ok" };
    },
  } as unknown as ActionContext;
}

test("materialize repairs a parser-invalid draft and persists the repaired program", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: Array<{ skill: string; prompt: string }> = [];
  const res = await prototypeMaterializeRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({
      validationScript: [INVALID_VERDICT, VALID_VERDICT],
      generatedScript: [fence(BAD_CODE), fence(GOOD_CODE)],
      mcpCalls,
      subagentCalls,
    })
  );
  assert.equal(res.ok, true);
  assert.equal(subagentCalls.length, 2, "initial generation + one repair round");
  assert.equal(subagentCalls[1].skill, "pm-designer-openui");
  // The repair prompt carries the structured findings AND the current draft.
  assert.match(subagentCalls[1].prompt, /unknown-component/);
  assert.match(subagentCalls[1].prompt, /Fakebox/);
  assert.match(subagentCalls[1].prompt, /Current program/);
  const render = mcpCalls.find((c) => c.name.endsWith("render_openui"));
  assert.ok(render, "render_openui must be called");
  assert.equal(render.args.code, GOOD_CODE, "the repaired program is what gets persisted");
});

test("materialize fails open when the validator is unavailable (legacy single-shot flow)", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: Array<{ skill: string; prompt: string }> = [];
  const res = await prototypeMaterializeRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({
      validationScript: [null],
      generatedScript: [fence(BAD_CODE)],
      mcpCalls,
      subagentCalls,
    })
  );
  assert.equal(res.ok, true);
  assert.equal(subagentCalls.length, 1, "no repair round without a validator");
  const render = mcpCalls.find((c) => c.name.endsWith("render_openui"));
  assert.equal(render?.args.code, BAD_CODE, "the original draft passes through untouched");
});

test("materialize keeps the last good draft when a repair round returns garbage", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: Array<{ skill: string; prompt: string }> = [];
  const res = await prototypeMaterializeRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({
      validationScript: [INVALID_VERDICT],
      generatedScript: [fence(BAD_CODE), "这不是代码，是解释文字"],
      mcpCalls,
      subagentCalls,
    })
  );
  assert.equal(res.ok, true);
  assert.equal(subagentCalls.length, 2);
  const render = mcpCalls.find((c) => c.name.endsWith("render_openui"));
  assert.equal(render?.args.code, BAD_CODE, "garbage repair output is discarded, not persisted");
});

test("materialize exhausts the repair budget and emits the leftover count", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: Array<{ skill: string; prompt: string }> = [];
  const emits: ActionProgress[] = [];
  const res = await prototypeMaterializeRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({
      validationScript: [INVALID_VERDICT, INVALID_VERDICT, INVALID_VERDICT],
      generatedScript: [fence(BAD_CODE), fence(BAD_CODE), fence(BAD_CODE)],
      mcpCalls,
      subagentCalls,
      emits,
    })
  );
  assert.equal(res.ok, true);
  assert.equal(subagentCalls.length, 3, "initial generation + exactly MAX_OPENUI_REPAIR_ROUNDS rounds");
  const render = mcpCalls.find((c) => c.name.endsWith("render_openui"));
  assert.equal(render?.args.code, BAD_CODE);
  const repairEmits = emits.filter(
    (e) => (e.data as { code?: string } | undefined)?.code === "prototype.materialize.repairing"
  );
  assert.ok(repairEmits.length >= 3, "repair progress events emitted");
  assert.match(repairEmits[repairEmits.length - 1].message, /remain after 2 repair round/);
});
