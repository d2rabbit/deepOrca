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
import { prototypeMaterializeRun, prototypeReviseRun } from "../actions/prototype";
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
  spec: [
    "# 极简番茄钟 需求文档",
    "",
    "| 目标平台 | web |",
    "",
    "## 4. 页面清单",
    "",
    "| 页面 | 目的 |",
    "| --- | --- |",
    "| 首页 | 计时 |",
  ].join("\n"),
  openui: 'root = Text("x")',
  verification: { status: "pending", checks: [] },
};

type McpCall = { name: string; args: Record<string, unknown> };
type SubPrompt = string;

/** 可覆写 spec/变体、模拟 head 推进序列、可覆写子代理输出的 ctx 工厂。 */
function makeCtxFor(
  fixture: {
    spec?: string;
    openui?: string;
    openuiVariants?: Record<string, string>;
  },
  options: {
    mcpCalls: McpCall[];
    prompts: SubPrompt[];
    headSequence?: string[];
    generated?: string;
  }
): ActionContext {
  const content = {
    requirement: "番茄钟",
    // specs/prompt-doc-chain：自带 pd-design → 跳过 stage0（本文件钉的是
    // 逐端生成/head 线程化语义，stage0 行为由 prompt-doc-chain.test.ts 覆盖）。
    pdDesign: "# 番茄钟 原型提示\n\n## 页面结构\n- 首页",
    openui: fixture.openui ?? 'root = Text("x")',
    ...(fixture.openuiVariants ? { openuiVariants: fixture.openuiVariants } : {}),
    verification: { status: "pending", checks: [] },
  };
  let persistCount = 0;
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
      return { sessionId: "sub", content: options.generated ?? PROGRAM };
    },
    executeMcpTool: async (name, args) => {
      options.mcpCalls.push({ name, args });
      if (name.endsWith("read_suite_version")) {
        return {
          ok: true,
          output: JSON.stringify({
            artifactRef: { ...REF, versionId: args.versionId ?? REF.versionId },
            title: "Suite",
            status: "ready",
            content: { ...content, spec: fixture.spec ?? SUITE_CONTENT.spec },
          }),
        };
      }
      if (name.endsWith("validate_openui")) {
        return {
          ok: true,
          output: JSON.stringify({ valid: true, errors: [], unresolved: [], orphaned: [], statementCount: 1 }),
        };
      }
      // 模拟 append-only store:第 N 次持久化返回序列里第 N 个新 head。
      const next =
        options.headSequence && options.headSequence.length > persistCount + 1
          ? options.headSequence[persistCount + 1]
          : "dev-v2";
      persistCount += 1;
      return {
        ok: true,
        output: `saved\nArtifactRef: ${JSON.stringify({ ...REF, versionId: next })}`,
      };
    },
  } as unknown as ActionContext;
}

function makeCtx(options: { mcpCalls: McpCall[]; prompts: SubPrompt[] }): ActionContext {
  return makeCtxFor({}, options);
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

test("WP0.3: devices 缺省时按 PRD 目标平台判定——mobile-only 只生成 mobile 端", async () => {
  const mcpCalls: McpCall[] = [];
  const prompts: SubPrompt[] = [];
  // 覆写 read_suite_version 返回声明 mobile 的 PRD。
  const ctx = makeCtxFor(
    { spec: "| 目标平台 | 移动端 App |\n\n## 4. 页面清单\n\n| 页面 | 目的 |\n| --- | --- |\n| 首页 | 计时 |" },
    { mcpCalls, prompts }
  );
  const res = await prototypeMaterializeRun({ suiteId: REF.suiteId, versionId: REF.versionId }, ctx);
  assert.equal(res.ok, true);
  const renders = mcpCalls.filter((call) => call.name.endsWith("render_openui"));
  assert.equal(renders.length, 1, "mobile-only PRD generates exactly one device");
  assert.equal(renders[0]?.args.device, "mobile", "the generated device is mobile (not desktop)");
  assert.ok(prompts[0]?.includes("BOTTOM TAB BAR"), "mobile shell contract injected");
});

test("WP1.1: 多端循环 head 线程化——第二端以第一端返回的新 head 为基线", async () => {
  const mcpCalls: McpCall[] = [];
  const prompts: SubPrompt[] = [];
  // 模拟真实 store:每次 render 追加新版本,head 前移;若 action 沿用旧
  // versionId,第二端会撞 head-moved(本测试以「入参必须是最新 head」断言)。
  const ctx = makeCtxFor(
    { spec: SUITE_CONTENT.spec },
    { mcpCalls, prompts, headSequence: ["dev-v1", "dev-v2", "dev-v3"] }
  );
  const res = await prototypeMaterializeRun(
    { suiteId: REF.suiteId, versionId: REF.versionId, devices: ["desktop", "mobile", "tablet"] },
    ctx
  );
  assert.equal(res.ok, true);
  const renders = mcpCalls.filter((call) => call.name.endsWith("render_openui"));
  assert.equal(rendings_versionIds(renders, ["dev-v1", "dev-v2", "dev-v3"]), true);
});

function rendings_versionIds(renders: McpCall[], expected: string[]): boolean {
  return renders.every((render, index) => render.args.versionId === expected[index]);
}

test("WP1.2: revise(device=mobile) 以 mobile 变体为基线,并把修订写回变体槽", async () => {
  const mcpCalls: McpCall[] = [];
  const prompts: SubPrompt[] = [];
  const ctx = makeCtxFor(
    {
      spec: SUITE_CONTENT.spec,
      openui: 'root = Text("desktop-shell")',
      openuiVariants: { mobile: 'root = Text("mobile-shell")' },
    },
    { mcpCalls, prompts, generated: '```openui\nroot = Text("mobile-shell-v2")\n```' }
  );
  const res = await prototypeReviseRun(
    {
      suiteId: REF.suiteId,
      versionId: REF.versionId,
      part: "openui",
      target: "openui",
      instruction: "底部 tab 加一项",
      device: "mobile",
    },
    ctx
  );
  assert.equal(res.ok, true);
  // 子代理收到的是 mobile 变体(不是桌面本体)
  assert.ok(prompts[0]?.includes("mobile-shell"), "the subagent revises the MOBILE variant");
  assert.ok(!prompts[0]?.includes("desktop-shell"), "the desktop program must not leak into the prompt");
  // 持久化定向 mobile 变体槽
  const update = mcpCalls.find((call) => call.name.endsWith("update_openui"));
  assert.equal(update?.args.device, "mobile");
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
