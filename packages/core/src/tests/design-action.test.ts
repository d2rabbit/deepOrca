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
  // 规范 PRD(WP0):目标平台行 + 页面 ID 列——verify 现在做平台一致性与逐页
  // 覆盖,无平台声明的 legacy PRD 会得到 platform-undeclared 观察项(pending)。
  const spec = [
    "# Tasks",
    "",
    "| 目标平台 | web |",
    "",
    "## Page list",
    "",
    "| Page | Page ID |",
    "| --- | --- |",
    "| Board | board |",
  ].join("\n");
  const openui =
    '$page = "board"\nroot = $page == "board" ? boardView : null\nboardView = Column([board])\nnavBtn = Button("Board", Action([@Set($page, "board")]))';
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({ prototype: { spec, openui }, mcpCalls })
  );
  assert.equal(result.ok, true);
  assert.equal(result.verification?.status, "passed");
  const save = mcpCalls.find((call) => call.name.endsWith("save_suite_result"));
  assert.equal((save?.args.verification as { status: string }).status, "passed");
});

test("prototype.verify: legacy PRD without 目标平台 yields a pending observation, not a failure", async () => {
  const mcpCalls: McpCall[] = [];
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { spec: "# Tasks\n\n## Page list\n- Board", openui: "root = Column([board])" },
      mcpCalls,
    })
  );
  assert.equal(result.ok, true);
  // platform-undeclared 是观察项 → 整体 pending(推动补 PRD),不是 failed。
  assert.equal(result.verification?.status, "pending");
  assert.ok(
    result.verification?.checks.some((check) => check.id === "auto:platform-undeclared"),
    "undeclared platform observation present"
  );
});

test("prototype.verify: PRD-declared platform missing from the program fails (WP0.4)", async () => {
  const mcpCalls: McpCall[] = [];
  const spec = "| 目标平台 | mobile |\n\n## Page list\n\n| Page | Page ID |\n| --- | --- |\n| Board | board |";
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: {
        spec,
        // 只有桌面本体,PRD 声明 mobile → platform-mobile-missing failed。
        openui:
          '$page = "board"\nroot = $page == "board" ? boardView : null\nboardView = Card([])\nbtn = Button("b", Action([@Set($page, "board")]))',
      },
      mcpCalls,
    })
  );
  assert.equal(result.verification?.status, "failed");
  assert.ok(result.verification?.checks.some((check) => check.id === "auto:platform-mobile-missing"));
});

test("prototype.verify: dangling nav target / orphan page / missing PRD page fail (WP2.2)", async () => {
  const mcpCalls: McpCall[] = [];
  const spec = [
    "| 目标平台 | web |",
    "",
    "## Page list",
    "",
    "| Page | Page ID |",
    "| --- | --- |",
    "| Home | home |",
    "| Orders | orders |",
    "| Settings | settings |",
  ].join("\n");
  const openui = [
    '$page = "home"',
    // orders 有视图但无人导航且非初始 → orphan;settings 未实现 → coverage failed;
    // @Set($page, "dashbord") 拼错 → dangling nav。
    'root = $page == "home" ? homeView : $page == "orders" ? ordersView : null',
    "homeView = Card([])",
    "ordersView = Card([])",
    'btn = Button("typo", Action([@Set($page, "dashbord")]))',
  ].join("\n");
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({ prototype: { spec, openui }, mcpCalls })
  );
  assert.equal(result.verification?.status, "failed");
  const ids = result.verification?.checks.filter((c) => c.status === "failed").map((c) => c.id) ?? [];
  assert.ok(ids.includes("auto:nav-dashbord-dangling"), "dangling nav target flagged");
  assert.ok(ids.includes("auto:page-orders-orphan"), "orphan page flagged");
  assert.ok(ids.includes("auto:coverage-settings-missing"), "missing PRD page flagged");
});

test("prototype.verify: dead buttons fail (WP2.3 core)", async () => {
  const mcpCalls: McpCall[] = [];
  const spec = "| 目标平台 | web |\n\n## Page list\n\n| Page | Page ID |\n| --- | --- |\n| Home | home |";
  const openui = [
    '$page = "home"',
    'root = $page == "home" ? homeView : null',
    "homeView = Card([])",
    'dead1 = Button("Save", Action([]))',
    'dead2 = Button("Go", "submit:login")',
    // 骨架化反例(遗留修复):文案/注释里的同形文本不得误报。
    'hint = TextContent("提示:不要写 Action([]) 占位")',
    "note = Text('see // Button(x, act) docs')",
  ].join("\n");
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({ prototype: { spec, openui }, mcpCalls })
  );
  assert.equal(result.verification?.status, "failed");
  const deadButtons = result.verification?.checks.filter((check) => check.id.startsWith("auto:dead-button-")) ?? [];
  // 恰好两个真死按钮;字符串字面量里的 Action([])/bare-string 骨架化后不再计数。
  assert.equal(
    deadButtons.length,
    2,
    `expected exactly the two real dead buttons, got ${JSON.stringify(deadButtons.map((c) => c.observation))}`
  );
});

test("prototype.verify: mobile-only PRD with variant-only program passes (交叉审查: 桌面本位检查不得判死)", async () => {
  const mcpCalls: McpCall[] = [];
  const spec = "| 目标平台 | mobile |\n\n## Page list\n\n| Page | Page ID |\n| --- | --- |\n| Home | home |";
  // mobile-only 的正常产物:没有桌面本体,只有 mobile 变体。
  const mobileProgram = [
    '$page = "home"',
    'root = $page == "home" ? homeView : null',
    "homeView = Card([])",
    'btn = Button("h", Action([@Set($page, "home")]))',
  ].join("\n");
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({ prototype: { spec, openui: undefined, openuiVariants: { mobile: mobileProgram } }, mcpCalls })
  );
  assert.equal(result.verification?.status, "passed", "variant-only suite verifies clean");
  const failed = result.verification?.checks.filter((c) => c.status === "failed") ?? [];
  assert.equal(failed.length, 0, `no failed checks: ${JSON.stringify(failed.map((c) => c.id))}`);
});

test("prototype.verify: extra generated platform yields a pending observation (WP0.4)", async () => {
  const mcpCalls: McpCall[] = [];
  const spec = "| 目标平台 | web |\n\n## Page list\n\n| Page | Page ID |\n| --- | --- |\n| Home | home |";
  const program = [
    '$page = "home"',
    'root = $page == "home" ? homeView : null',
    "homeView = Card([])",
    'btn = Button("h", Action([@Set($page, "home")]))',
  ].join("\n");
  const tablet = program.replace("homeView", "tabletHome").replace("btn", "tBtn") + '\nsidePanel = Stack([], "row")';
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({ prototype: { spec, openui: program, openuiVariants: { tablet } }, mcpCalls })
  );
  // 多端是 pending 观察项,不是 failed——整体停在 pending 推动人工确认。
  assert.equal(result.verification?.status, "pending");
  assert.ok(result.verification?.checks.some((c) => c.id === "auto:platform-tablet-extra"));
});

test("prototype.verify: external checks with mechanical-looking prefixes survive (auto: 命名空间)", async () => {
  const mcpCalls: McpCall[] = [];
  const spec = "| 目标平台 | web |\n\n## Page list\n\n| Page | Page ID |\n| --- | --- |\n| Home | home |";
  const program = [
    '$page = "home"',
    'root = $page == "home" ? homeView : null',
    "homeView = Card([])",
    'btn = Button("h", Action([@Set($page, "home")]))',
  ].join("\n");
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: {
        spec,
        openui: program,
        verification: {
          status: "pending",
          checks: [{ id: "nav-smoke-test", label: "外部导航冒烟", status: "pending", observation: "人工检查" }],
          healingRounds: 0,
        },
      },
      mcpCalls,
    })
  );
  assert.ok(
    result.verification?.checks.some((c) => c.id === "nav-smoke-test" && c.status === "pending"),
    "外部 check(通用前缀命名)不被机械淘汰误杀"
  );
});

test("prototype.verify: 消项结算端跳过机械 id(auto: 不可被外部覆写/追加)", async () => {
  const mcpCalls: McpCall[] = [];
  const result = await prototypeVerifyRun(
    {
      suiteId: PROTOTYPE_REF.suiteId,
      versionId: PROTOTYPE_REF.versionId,
      // 模拟 renderer 消项按钮直传 auto: pending 项(修复前的行为是追加一条
      // 同 id 的 passed 副本,整体永卡 pending + 假成功 toast)。
      checks: [{ id: "auto:platform-undeclared", label: "PRD declares target platforms", passed: true }],
    },
    makeCtx({ prototype: { spec: "# Tasks\n\n## Page list\n- Board", openui: "root = Column([board])" }, mcpCalls })
  );
  assert.equal(result.ok, true);
  const pending = result.verification?.checks.filter((c) => c.id === "auto:platform-undeclared") ?? [];
  assert.equal(pending.length, 1, "机械 id 消项不追加 passed 副本");
  assert.equal(pending[0]?.status, "pending", "机械 pending 项由重算自清,不被外部覆写");
  assert.equal(result.verification?.status, "pending", "未消解的机械观察项保持整体 pending");
});

test("prototype.verify: 消项覆写随行观察项为单实例(评审 C 回路收敛)", async () => {
  const mcpCalls: McpCall[] = [];
  const result = await prototypeVerifyRun(
    {
      suiteId: PROTOTYPE_REF.suiteId,
      versionId: PROTOTYPE_REF.versionId,
      checks: [{ id: "nav-smoke-test", label: "外部导航冒烟", passed: true, observation: "人工已核" }],
    },
    makeCtx({
      prototype: {
        spec: "| 目标平台 | web |\n\n## Page list\n\n| Page | Page ID |\n| --- | --- |\n| Home | home |",
        openui:
          '$page = "home"\nroot = $page == "home" ? homeView : null\nhomeView = Card([])\nbtn = Button("h", Action([@Set($page, "home")]))',
        verification: {
          status: "pending",
          checks: [{ id: "nav-smoke-test", label: "外部导航冒烟", status: "pending", observation: "人工检查" }],
          healingRounds: 0,
        },
      },
      mcpCalls,
    })
  );
  assert.equal(result.ok, true);
  const smoke = result.verification?.checks.filter((c) => c.id === "nav-smoke-test") ?? [];
  assert.equal(smoke.length, 1, "覆写发生在原实例上,不追加副本");
  assert.equal(smoke[0]?.status, "passed");
  assert.equal(smoke[0]?.observation, "人工已核", "按 id 结算覆写 observation");
});

test("prototype.verify: renamed desktop copy as variant fails distinct (WP4.2)", async () => {
  const mcpCalls: McpCall[] = [];
  const spec = "| 目标平台 | 多端(web+mobile) |\n\n## Page list\n\n| Page | Page ID |\n| --- | --- |\n| Home | home |";
  const openui = [
    '$page = "home"',
    'root = $page == "home" ? homeView : null',
    'homeView = Table([Col("x", [])])',
    'btn = Button("h", Action([@Set($page, "home")]))',
  ].join("\n");
  // 换名副本:组件构成与桌面端一致 → Jaccard ≥ 0.92 → distinct failed。
  const renamedCopy = openui.replace(/homeView/g, "mobileHome").replace(/btn/g, "mBtn");
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({ prototype: { spec, openui, openuiVariants: { mobile: renamedCopy } }, mcpCalls })
  );
  assert.equal(result.verification?.status, "failed");
  assert.ok(result.verification?.checks.some((check) => check.id === "auto:variant-mobile-distinct"));
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
  // WP2.4:tiny-font/hardcoded-color 是 CSS 死规则已移除;lint 现在报告 DSL 上
  // 真实命中的 dead-button / dangling-nav / emoji-glyph。
  const result = await designLintRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: {
        openui: [
          '$page = "home"',
          'root = $page == "home" ? homeView : null',
          "homeView = Card([])",
          'dead = Button("Save", Action([]))',
          'nav = Button("Typo", Action([@Set($page, "dashbord")]))',
          'emoji = TextContent("通知 🔔")',
        ].join("\n"),
      },
      mcpCalls,
    })
  );
  assert.equal(result.ok, true);
  assert.ok(result.findings?.some((finding) => finding.ruleId === "dead-button"));
  assert.ok(result.findings?.some((finding) => finding.ruleId === "dangling-nav"));
  assert.ok(result.findings?.some((finding) => finding.ruleId === "emoji-glyph"));
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

  // End-to-end through the check the page-list detection feeds. CJK 无空格/
  // 带冒号标题都要过;PRD 带平台声明(web)+页面 ID 列,走完整逐页覆盖链路。
  const spec = [
    "# 任务看板",
    "",
    "| 目标平台 | web |",
    "",
    "##页面清单：",
    "",
    "| 页面 | 页面ID |",
    "| --- | --- |",
    "| 看板 | board |",
  ].join("\n");
  const openui = [
    '$page = "board"',
    'root = $page == "board" ? boardView : null',
    "boardView = Column([board])",
    'navBtn = Button("看板", Action([@Set($page, "board")]))',
  ].join("\n");
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({ prototype: { spec, openui } })
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

test("design.lint DSL rules: dead buttons and dangling navs flagged, live programs are clean", async () => {
  const mcpCalls: McpCall[] = [];
  const result = await designLintRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: {
        openui: [
          '$page = "home"',
          'root = $page == "home" ? homeView : null',
          "homeView = Card([])",
          'dead1 = Button("Save", Action([]))',
          "dead2 = Button(\"Go\", 'submit:login')",
          'nav = Button("Typo", Action([@Set($page, "dashbord")]))',
        ].join("\n"),
      },
      mcpCalls,
    })
  );
  assert.equal(result.ok, true);
  const dead = result.findings?.filter((finding) => finding.ruleId === "dead-button") ?? [];
  assert.equal(dead.length, 2, "Action([]) and bare-string actions both flagged");
  const nav = result.findings?.filter((finding) => finding.ruleId === "dangling-nav") ?? [];
  assert.equal(nav.length, 1, "navigation to an undeclared page flagged");
  assert.match(nav[0]!.message, /dashbord/);
});

test("design.lint: a live program yields zero findings", async () => {
  const mcpCalls: McpCall[] = [];
  const result = await designLintRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: {
        openui: [
          '$page = "home"',
          'root = $page == "home" ? homeView : null',
          "homeView = Card([])",
          'nav = Button("Home", Action([@Set($page, "home")]))',
        ].join("\n"),
      },
      mcpCalls,
    })
  );
  assert.equal(result.ok, true);
  assert.equal(result.findings?.length ?? 0, 0);
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

test("re-review M1: nested/array evidence shapes pass the review evidence gate", async () => {
  const arrayShaped = await designReviewRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: { openui: 'root = Screen("ui")' },
      generated: '```json\n{"status":"passed","composite":0.8,"evidence":{"findings":["#submit","#nav"]}}\n```',
    })
  );
  assert.equal(arrayShaped.ok, true, "array-valued evidence is concrete, not empty");

  const nestedShaped = await designReviewRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: { openui: 'root = Screen("ui")' },
      generated: '```json\n{"status":"failed","composite":0.3,"evidence":{"contrast":{"ratio":3.2}}}\n```',
    })
  );
  assert.equal(nestedShaped.ok, true, "nested numeric evidence is concrete");

  const hollowShaped = await designReviewRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: { openui: 'root = Screen("ui")' },
      generated: '```json\n{"status":"passed","composite":0.9,"evidence":{"a":"","b":[]}}\n```',
    })
  );
  assert.equal(hollowShaped.ok, false, "all-empty leaves are still rejected");
});

test("re-review L1: prose mentioning triple backticks mid-line does not trip the truncation refusal", async () => {
  const mcpCalls: McpCall[] = [];
  // No real fence anywhere — the mention is mid-sentence, so the body must be
  // extracted verbatim (the unanchored regex used to null it out).
  const result = await prototypeSpecRun(
    { requirement: "Task board" },
    makeCtx({
      mcpCalls,
      generated: "Wrap it in a ```openui fence later. # Tasks\n\n## Page list\n- Board",
    })
  );
  assert.equal(result.ok, true);
  const save = mcpCalls.find((call) => call.name.endsWith("render_spec"));
  assert.match(String(save?.args.document ?? ""), /# Tasks/);
});

test("re-review M6: a mid-line fence mention does not hijack body extraction ahead of the real fence", async () => {
  const mcpCalls: McpCall[] = [];
  // The ```markdown mention sits mid-line with a tag+newline right after it,
  // so the unanchored extraction regex used to capture "fragment" as the
  // whole body; only a line-initial fence may open the extraction now.
  // (Every fence stays mid-line so the truncation refusal is not in play.)
  const result = await prototypeSpecRun(
    { requirement: "Task board" },
    makeCtx({
      mcpCalls,
      generated: "I will use a ```markdown\nfragment``` and continue.\n\n# Tasks\n\n## Page list\n- Board",
    })
  );
  assert.equal(result.ok, true);
  const save = mcpCalls.find((call) => call.name.endsWith("render_spec"));
  const document = String(save?.args.document ?? "");
  assert.match(document, /# Tasks/, "the real prose body must be extracted");
  assert.doesNotMatch(document, /^fragment$/, "the mention's inline fragment must not become the body");
});

test("re-review L2: design.materialize rejects structurally invalid OpenUI before persisting", async () => {
  const mcpCalls: McpCall[] = [];
  const result = await designMaterializeRun(
    {
      prototypeSuiteId: PROTOTYPE_REF.suiteId,
      prototypeVersionId: PROTOTYPE_REF.versionId,
      designSystemId: "terminal-mono",
    },
    makeCtx({
      mcpCalls,
      prototype: { requirement: "Task board", openui: "root = Column([board])" },
      generated: "Here is the design: buttons everywhere and no root binding at all",
    })
  );
  assert.equal(result.ok, false);
  assert.match(String(result.error ?? ""), /regenerate/i);
  assert.equal(
    mcpCalls.some((call) => call.name.endsWith("render_openui")),
    false
  );
});
