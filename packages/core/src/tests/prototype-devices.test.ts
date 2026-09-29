/**
 * prototype.materialize 平台计划（specs/moonviz-engine-replacement：三端 =
 * 单文档三画板，替代旧的每端一程序 + openuiVariants 结构）。Pins:
 *   - devices ["desktop","mobile","tablet"] → ONE generation whose prompt
 *     carries all three platform contracts + the `<page>@<device>` artboard
 *     plan, and ONE render_moonviz persistence,
 *   - devices 缺省按 PRD 目标平台判定（mobile-only PRD 只规划 mobile 画板），
 *   - 单设备缺省行为：plain 画板 id（无 @ 后缀）。
 * 断言等价迁移（P2 出口复核表）：旧 WP1.1 逐端 head 线程化随单文档模型消亡
 * （单次持久化无可线程化）；旧 WP1.2 设备定向修订随变体槽消亡（revise 以
 * 当前 canonical 为基线，见本文件末尾）。
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { prototypeMaterializeRun, prototypeReviseRun } from "../actions/prototype";
import { NULL_SPAWNER } from "../actions/types";
import type { ActionContext, ActionProgress } from "../actions/types";
import { installMoonvizFixture, MOCK_MOONVIZ_DOC } from "./moonviz-fixture";

installMoonvizFixture();

const REF = { suiteId: "dev-suite", versionId: "dev-v1", kind: "prototype" as const };

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const OP_PLAN = "```moonviz\ntemplate login home 1200 800\nplace home button go_btn - 24 700 342 44\n```";

/** 可覆写 spec、可捕获提示词/持久化调用的 ctx 工厂。 */
function makeCtxFor(
  fixture: { spec?: string },
  options: {
    mcpCalls: Array<{ name: string; args: Record<string, unknown> }>;
    prompts: string[];
    generated?: string;
  }
): ActionContext {
  const content = {
    requirement: "番茄钟",
    // specs/prompt-doc-chain：自带 pm-design → 跳过 stage0（本文件钉的是
    // 平台计划语义，stage0 行为由 prompt-doc-chain.test.ts 覆盖）。
    pmDesign: "# 番茄钟 原型提示\n\n## 页面结构\n- 首页",
    moonviz: MOCK_MOONVIZ_DOC,
    verification: { status: "pending", checks: [] },
  };
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
      return { sessionId: "sub", content: options.generated ?? OP_PLAN };
    },
    executeMcpTool: async (name, args) => {
      options.mcpCalls.push({ name, args });
      if (name.endsWith("read_suite_version")) {
        return {
          ok: true,
          output: JSON.stringify({
            artifactRef: { ...REF, versionId: String(args.versionId ?? REF.versionId) },
            title: "Suite",
            status: "ready",
            content: { ...content, spec: fixture.spec ?? SUITE_CONTENT_SPEC },
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

const SUITE_CONTENT_SPEC = [
  "# 极简番茄钟 需求文档",
  "",
  "| 目标平台 | web |",
  "",
  "## 4. 页面清单",
  "",
  "| 页面 | 页面ID | 目的 |",
  "| --- | --- | --- |",
  "| 首页 | home | 计时 |",
].join("\n");

test("materialize devices=[desktop,mobile,tablet] → 单文档三画板计划 + 单次持久化", async () => {
  const mcpCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const prompts: string[] = [];
  const res = await prototypeMaterializeRun(
    { suiteId: REF.suiteId, versionId: REF.versionId, devices: ["desktop", "mobile", "tablet"] },
    makeCtxFor({}, { mcpCalls, prompts })
  );
  assert.equal(res.ok, true, res.ok ? "" : (res as { error?: string }).error);

  // 单文档模型：一次生成、一次持久化（render_moonviz 无 device 分流）。
  const renders = mcpCalls.filter((call) => call.name.endsWith("render_moonviz"));
  assert.equal(renders.length, 1, "one generation, one canonical document");

  // 平台契约全部注入同一提示词：桌面侧栏 / 手机底部 tab / 平板分栏。
  assert.ok(prompts[0]?.includes("LEFT SIDEBAR"), "desktop shell contract in the plan prompt");
  assert.ok(prompts[0]?.includes("BOTTOM TAB BAR"), "mobile shell contract in the plan prompt");
  assert.ok(prompts[0]?.includes("SPLIT VIEW"), "tablet shell contract in the plan prompt");
  // 画板计划逐页逐端展开（<page>@<device> 契约 id）。
  assert.ok(prompts[0]?.includes("`home@desktop`"), "desktop artboard id planned");
  assert.ok(prompts[0]?.includes("`home@mobile`"), "mobile artboard id planned");
  assert.ok(prompts[0]?.includes("`home@tablet`"), "tablet artboard id planned");
});

test("WP0.3: devices 缺省时按 PRD 目标平台判定——mobile-only 只规划 mobile 画板", async () => {
  const mcpCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const prompts: string[] = [];
  const ctx = makeCtxFor(
    {
      spec: "| 目标平台 | 移动端 App |\n\n## 4. 页面清单\n\n| 页面 | 页面ID | 目的 |\n| --- | --- | --- |\n| 首页 | home | 计时 |",
    },
    { mcpCalls, prompts }
  );
  const res = await prototypeMaterializeRun({ suiteId: REF.suiteId, versionId: REF.versionId }, ctx);
  assert.equal(res.ok, true);
  assert.ok(prompts[0]?.includes("BOTTOM TAB BAR"), "mobile shell contract injected");
  // 单设备计划用 plain 画板 id（无 @ 后缀）；桌面端完全不进计划。
  assert.ok(prompts[0]?.includes("`home` (mobile"), "the mobile artboard is planned with a plain id");
  assert.ok(!prompts[0]?.includes("@desktop"), "desktop is NOT planned for a mobile-only PRD");
});

test("materialize 缺省只规划单一（desktop）端——plain 画板 id 无 @ 后缀", async () => {
  const mcpCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const prompts: string[] = [];
  const res = await prototypeMaterializeRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtxFor({}, { mcpCalls, prompts })
  );
  assert.equal(res.ok, true);
  assert.ok(prompts[0]?.includes("LEFT SIDEBAR"), "desktop contract injected");
  assert.ok(!prompts[0]?.includes("`home@desktop`"), "single-device plan uses plain page ids");
  const renders = mcpCalls.filter((call) => call.name.endsWith("render_moonviz"));
  assert.equal(renders.length, 1);
});

test("revise(part=moonviz) 以当前 canonical 为基线，并把增量 op 计划的产物写回 update_moonviz", async () => {
  const mcpCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const prompts: string[] = [];
  const ctx = makeCtxFor({}, { mcpCalls, prompts, generated: '```moonviz\nupdate home title text="新标题"\n```' });
  const res = await prototypeReviseRun(
    {
      suiteId: REF.suiteId,
      versionId: REF.versionId,
      part: "moonviz",
      target: "home",
      instruction: "标题改掉",
    },
    ctx
  );
  assert.equal(res.ok, true, res.ok ? "" : (res as { error?: string }).error);
  // 子代理收到的是当前 canonical 文档（不是空白重生成）。
  assert.ok(prompts[0]?.includes("moonviz:artboard"), "the subagent revises the CURRENT canonical doc");
  assert.ok(prompts[0]?.includes("Current document"), "revision prompt carries the doc as the baseline");
  // 持久化走 update_moonviz。
  assert.ok(
    mcpCalls.some((call) => call.name.endsWith("update_moonviz")),
    "revision persists via update_moonviz"
  );
});
