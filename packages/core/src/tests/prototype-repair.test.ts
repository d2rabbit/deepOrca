/**
 * Gate 推进式回灌（specs/moonviz-engine-replacement；旧栈的 OpenUI parser
 * 修复环的引擎侧等价物）。Pins:
 *   - repair-once-then-apply: render_moonviz receives the CORRECTED plan's
 *     canonical and the repair prompt carries the gate findings + current plan,
 *   - garbage repair round → fail-closed（旧栈"保留最后好稿"在会话模型下
 *     不成立：被拒 op 从未入档，无可保留的中间态——动作带诊断失败）,
 *   - exhausted budget → 动作失败附诊断，绝不静默降级（§0.3 门语义）。
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { prototypeMaterializeRun } from "../actions/prototype";
import { NULL_SPAWNER } from "../actions/types";
import type { ActionContext, ActionProgress } from "../actions/types";
import { installMoonvizFixture } from "./moonviz-fixture";

const REF = { suiteId: "repair-suite", versionId: "r-v1", kind: "prototype" as const };

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const BAD_PLAN = "```moonviz\nplace login REJECT_ME oob - 99999 99999 200 48\ntemplate login home 1200 800\n```";
const GOOD_PLAN = "```moonviz\ntemplate login home 1200 800\n```";

type McpCall = { name: string; args: Record<string, unknown> };

interface CtxOptions {
  /** Per subagent call: returned content (initial generation, then repairs). */
  generatedScript?: string[];
  mcpCalls?: McpCall[];
  subagentCalls?: Array<{ skill: string; prompt: string }>;
  emits?: ActionProgress[];
}

function makeCtx(options: CtxOptions = {}, fixture: Parameters<typeof installMoonvizFixture>[0] = {}): ActionContext {
  const mcpCalls = options.mcpCalls ?? [];
  const subagentCalls = options.subagentCalls ?? [];
  const emits = options.emits ?? [];
  let generatedIdx = 0;
  installMoonvizFixture({ rejectOpSubstrings: ["REJECT_ME"], ...fixture });
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
              spec: "# 订单 需求文档\n\n## 页面清单\n\n| 页面 | 页面ID |\n| --- | --- |\n| 订单 | orders |\n",
              // specs/prompt-doc-chain：自带 pm-design → 跳过 stage0（本文件
              // 钉的是 Gate 回灌语义，stage0 行为由 prompt-doc-chain.test.ts 覆盖）。
              pmDesign: "# 订单 原型提示\n\n## 页面结构\n- 订单页",
            },
          }),
        };
      }
      if (name.endsWith("render_moonviz") || name.endsWith("update_moonviz")) {
        return { ok: true, output: `saved\nArtifactRef: ${JSON.stringify({ ...REF, versionId: "r-v2" })}` };
      }
      return { ok: true, output: "ok" };
    },
  } as unknown as ActionContext;
}

test("materialize repairs a gate-rejected op plan and persists the corrected canonical", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: Array<{ skill: string; prompt: string }> = [];
  const res = await prototypeMaterializeRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({ generatedScript: [BAD_PLAN, GOOD_PLAN], mcpCalls, subagentCalls })
  );
  assert.equal(res.ok, true, res.ok ? "" : (res as { error?: string }).error);
  assert.equal(subagentCalls.length, 2, "initial generation + one gate repair round");
  assert.equal(subagentCalls[1].skill, "pm-designer-moonviz");
  // The repair prompt carries the gate findings AND the current plan.
  assert.match(subagentCalls[1].prompt, /REJECTED/);
  assert.match(subagentCalls[1].prompt, /mbt_gate_block:login:no_sibling_overlap:oob/);
  assert.match(subagentCalls[1].prompt, /Current op plan/);
  const render = mcpCalls.find((c) => c.name.endsWith("render_moonviz"));
  assert.ok(render, "render_moonviz must be called");
  // 被拒 op 从未入档：canonical 只携带修正计划的 op 标记。
  const doc = String(render?.args.doc ?? "");
  assert.ok(doc.includes("op: template login home 1200 800"), "corrected plan applied");
  assert.ok(!doc.includes("REJECT_ME"), "the rejected op never entered the document");
});

test("materialize fails closed when a gate repair round returns garbage", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: Array<{ skill: string; prompt: string }> = [];
  const res = await prototypeMaterializeRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({ generatedScript: [BAD_PLAN, "这不是计划，是解释文字"], mcpCalls, subagentCalls })
  );
  assert.equal(res.ok, false, "garbage repair output fails the action (nothing was applied to keep)");
  assert.match(String(res.error ?? ""), /unusable op plan/);
  assert.equal(
    mcpCalls.some((call) => call.name.endsWith("render_moonviz")),
    false,
    "nothing persists from a failed plan"
  );
});

test("materialize exhausts the gate budget and fails with diagnostics (不静默降级)", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: Array<{ skill: string; prompt: string }> = [];
  const emits: ActionProgress[] = [];
  const res = await prototypeMaterializeRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({ generatedScript: [BAD_PLAN, BAD_PLAN, BAD_PLAN], mcpCalls, subagentCalls, emits })
  );
  assert.equal(res.ok, false);
  assert.match(String(res.error ?? ""), /after 2 repair round\(s\)/);
  assert.equal(
    mcpCalls.some((call) => call.name.endsWith("render_moonviz")),
    false
  );
  const repairEmits = emits.filter(
    (e) => (e.data as { code?: string } | undefined)?.code === "prototype.materialize.repairing"
  );
  assert.equal(repairEmits.length, 2, "exactly MAX_MOONVIZ_GATE_ROUNDS repair rounds emitted");
});

test("materialize succeeds in one shot when no op is rejected (no repair round)", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: Array<{ skill: string; prompt: string }> = [];
  const res = await prototypeMaterializeRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({ generatedScript: [GOOD_PLAN], mcpCalls, subagentCalls })
  );
  assert.equal(res.ok, true);
  assert.equal(subagentCalls.length, 1, "no repair round on a clean plan");
  const render = mcpCalls.find((c) => c.name.endsWith("render_moonviz"));
  assert.ok(String(render?.args.doc ?? "").includes("op: template login home 1200 800"));
});
