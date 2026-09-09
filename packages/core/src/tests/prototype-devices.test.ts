/**
 * prototype.materialize 平台变体(user ask 2026-09-09:三端是平台化适配,不是
 * 同一程序挤宽度)。Pins:
 *   - devices ["desktop","mobile","tablet"] → 每端一次独立生成,提示词携带
 *     各端平台契约(桌面侧栏/手机底部 tab/平板分栏),
 *   - desktop 落本体(render_openui 无 device),mobile/tablet 落
 *     render_openui({device}),
 *   - 单设备缺省行为不变(只生成 desktop 本体)。
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { prototypeMaterializeRun } from "../actions/prototype";
import { NULL_SPAWNER } from "../actions/types";
import type { ActionContext, ActionProgress } from "../actions/types";

const REF = { suiteId: "dev-suite", versionId: "dev-v1", kind: "prototype" as const };

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const PROGRAM =
  '```openui\n$page = "home"\nroot = Stack([nav, homeView])\nnav = Stack([])\nhomeView = TextContent("x")\n```';

const SUITE_CONTENT = {
  requirement: "番茄钟",
  spec: "# 极简番茄钟 需求文档\n\n## 4. 页面清单\n\n| 页面 | 目的 |\n| --- | --- |\n| 首页 | 计时 |",
  openui: 'root = Text("x")',
  verification: { status: "pending", checks: [] },
};

type McpCall = { name: string; args: Record<string, unknown> };
type SubPrompt = string;

function makeCtx(options: { mcpCalls: McpCall[]; prompts: SubPrompt[] }): ActionContext {
  return {
    projectRoot: (() => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-materialize-"));
      tmpDirs.push(dir);
      return dir;
    })(),
    signal: new AbortController().signal,
    emit: (event: ActionProgress) => {
      void event;
    },
    spawner: NULL_SPAWNER,
    runSubagent: async (opts) => {
      options.prompts.push(opts.prompt ?? "");
      return { sessionId: "sub", content: PROGRAM };
    },
    executeMcpTool: async (name, args) => {
      options.mcpCalls.push({ name, args });
      if (name.endsWith("read_suite_version")) {
        return {
          ok: true,
          output: JSON.stringify({
            artifactRef: REF,
            title: "Suite",
            status: "ready",
            content: SUITE_CONTENT,
          }),
        };
      }
      return {
        ok: true,
        output: `saved\nArtifactRef: ${JSON.stringify({ ...REF, versionId: "dev-v2" })}`,
      };
    },
  } as unknown as ActionContext;
}

test("materialize devices=[desktop,mobile,tablet] 生成三次并按端分流持久化", async () => {
  const mcpCalls: McpCall[] = [];
  const prompts: SubPrompt[] = [];
  const res = await prototypeMaterializeRun(
    { suiteId: REF.suiteId, versionId: REF.versionId, devices: ["desktop", "mobile", "tablet"] },
    makeCtx({ mcpCalls, prompts })
  );
  assert.equal(res.ok, true);

  const renders = mcpCalls.filter((call) => call.name.endsWith("render_openui"));
  assert.equal(renders.length, 3, "one generation per device");
  assert.equal(renders[0]?.args.device, "desktop", "desktop 写本体(显式 device)");
  assert.equal(renders[1]?.args.device, "mobile");
  assert.equal(renders[2]?.args.device, "tablet");

  // 平台契约逐端注入:手机端提示词带底部 tab 契约,桌面端带侧栏契约
  assert.ok(prompts[0]?.includes("LEFT SIDEBAR"), "desktop prompt carries the desktop shell contract");
  assert.ok(prompts[1]?.includes("BOTTOM TAB BAR"), "mobile prompt carries the mobile shell contract");
  assert.ok(prompts[2]?.includes("SPLIT VIEW"), "tablet prompt carries the tablet shell contract");
});

test("materialize 缺省只生成 desktop 本体(行为不变)", async () => {
  const mcpCalls: McpCall[] = [];
  const prompts: SubPrompt[] = [];
  const res = await prototypeMaterializeRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({ mcpCalls, prompts })
  );
  assert.equal(res.ok, true);
  const renders = mcpCalls.filter((call) => call.name.endsWith("render_openui"));
  assert.equal(renders.length, 1);
  assert.equal(renders[0]?.args.device, "desktop");
});
