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
  prototypePmDesignRun,
  prototypeSpecRun,
  prototypeVerifyDefinition,
  prototypeVerifyRun,
} from "../actions";
import { hasPageList, looksLikeSpecDocument } from "../actions/prototype";
import { installMoonvizFixture, MOCK_MOONVIZ_DOC } from "./moonviz-fixture";

installMoonvizFixture();
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
    /** specs/prompt-doc-chain：stage0/原型/UI 三级子代理按序消费的队列。 */
    generatedQueue?: string[];
    mcpCalls?: McpCall[];
    subagentCalls?: SubagentCall[];
    emits?: ActionProgress[];
    /** MoonViz 引擎 fixture 覆写（verify 引擎直调检查面的各信封）。 */
    artboards?: Array<Record<string, unknown>>;
    flows?: Array<Record<string, unknown>>;
    lint?: Array<Record<string, unknown>>;
    critique?: Array<Record<string, unknown>>;
    nodes?: Array<Record<string, unknown>>;
    tapOk?: boolean;
    rejectOpSubstrings?: string[];
    resetOnNthTap?: number;
    failLadder?: boolean;
  } = {}
): ActionContext {
  installMoonvizFixture({
    artboards: options.artboards,
    flows: options.flows,
    lint: options.lint,
    critique: options.critique,
    nodes: options.nodes,
    tapOk: options.tapOk,
    rejectOpSubstrings: options.rejectOpSubstrings,
    resetOnNthTap: options.resetOnNthTap,
    failLadder: options.failLadder,
  });
  const mcpCalls = options.mcpCalls ?? [];
  const subagentCalls = options.subagentCalls ?? [];
  const emits = options.emits ?? [];
  let callIndex = 0;
  return {
    projectRoot: path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../.."),
    signal: new AbortController().signal,
    emit: (event) => {
      emits.push(event);
    },
    spawner: NULL_SPAWNER,
    runSubagent: async (call) => {
      subagentCalls.push(call);
      const queue = options.generatedQueue;
      const content = queue ? queue[Math.min(callIndex, queue.length - 1)] : (options.generated ?? "```\nok\n```");
      callIndex += 1;
      return { sessionId: "sub", content };
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
  const deepTasks = [
    "```markdown",
    "# Tasks 需求文档",
    "",
    "## 1. 背景与目标",
    "",
    "## 2. 用户与场景",
    "",
    "## 3. 功能需求",
    "",
    "| 模块 | 需求 | 优先级 | 交互要点 |",
    "| --- | --- | --- | --- |",
    "| 看板 | 任务卡片 | P0 | 拖拽 |",
    "| 列表 | 任务列表 | P1 | 筛选 |",
    "| 统计 | 完成率 | P2 | 图表 |",
    "",
    "## 4. 数据与字段",
    "",
    "| 实体 | 字段 | 类型 | 校验 | 示例 |",
    "| --- | --- | --- | --- | --- |",
    "| 任务 | 标题 | string | 非空 | 买菜 |",
    "| 任务 | 截止 | date | 未来 | 今天 |",
    "",
    "## 5. 页面清单",
    "",
    "| 页面 | 页面ID | 目的 | 关键元素 |",
    "| --- | --- | --- | --- |",
    "| 看板页 | board | 看板 | 卡片列 |",
    "",
    "### board 交互明细",
    "",
    "- 拖拽 → 状态流转",
    "- 新建 → 弹窗表单",
    "",
    "## 6. 非功能需求",
    "",
    "## 7. 验收标准",
    "",
    "- [ ] a",
    "- [ ] b",
    "- [ ] c",
    "- [ ] d",
    "- [ ] e",
    "",
    "## 8. 待确认",
    "```",
  ].join("\n");
  const result = await prototypeSpecRun({ requirement: "Task board" }, makeCtx({ generated: deepTasks, mcpCalls }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.artifactRef, PROTOTYPE_REF);
  const save = mcpCalls.find((call) => call.name.endsWith("render_spec"));
  assert.equal(save?.args.requirement, "Task board");
  assert.equal(typeof save?.args.note, "string", "initial generation must force suite persistence");
});

test("prototype.materialize reads an immutable suite version and resets verification through render_moonviz", async () => {
  const mcpCalls: McpCall[] = [];
  const result = await prototypeMaterializeRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: {
        requirement: "Task board",
        spec: "# Tasks\n\n## Page list\n- Board",
        // specs/prompt-doc-chain：自带 pm-design → 跳过 stage0（本测试钉的是
        // 版本读取/持久化语义，stage0 行为由 prompt-doc-chain.test.ts 覆盖）。
        pmDesign: "# Task board 原型提示\n\n## 页面结构\n- Board",
      },
      generated: "```moonviz\ntemplate login board 1200 800\n```",
      mcpCalls,
    })
  );
  assert.equal(result.ok, true, result.ok ? "" : (result as { error?: string }).error);
  const save = mcpCalls.find((call) => call.name.endsWith("render_moonviz"));
  assert.equal(save?.args.suiteId, PROTOTYPE_REF.suiteId);
  assert.equal(save?.args.versionId, PROTOTYPE_REF.versionId);
  // 持久化的是引擎会话回传的 canonical（携带已应用 op 的标记）。
  assert.match(String(save?.args.doc ?? ""), /op: template login board 1200 800/);
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
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { spec, moonviz: MOCK_MOONVIZ_DOC },
      // 引擎 fixture：单端文档（plain 画板 id）、零 lint/critique、零 flow——
      // PRD 单端（web）声明 + 单页覆盖 → 全绿。
      artboards: [{ id: "board" }],
      mcpCalls,
    })
  );
  assert.equal(result.ok, true);
  assert.equal(result.verification?.status, "passed");
  const save = mcpCalls.find((call) => call.name.endsWith("save_suite_result"));
  assert.equal((save?.args.verification as { status: string }).status, "passed");
});

test("prototype.verify: mid-tap worker reset replays via withSession, never fabricates failed taps", async () => {
  const spec = "| 目标平台 | web |\n\n## Page list\n\n| Page | Page ID |\n| --- | --- |\n| Home | home |";
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { spec, moonviz: MOCK_MOONVIZ_DOC },
      artboards: [{ id: "home" }],
      flows: [{ from: "home", to: "home", trigger: "tap:btn" }],
      nodes: [{ id: "btn", rect: { x: 10, y: 10, w: 20, h: 20 } }],
      resetOnNthTap: 1,
    })
  );
  assert.equal(result.ok, true, result.error);
  const tap = result.verification?.checks.find((check) => check.id === "auto:tap-1");
  assert.equal(tap?.status, "passed", `real replayed tap result required: ${JSON.stringify(tap)}`);
  assert.ok(
    !result.verification?.checks.some((check) => check.id === "auto:verify-engine-unavailable"),
    "a recovered reset must not degrade to the engine-unavailable observation"
  );
});

test("prototype.verify: post-validate ladder failure keeps the validate verdict (ladderError wiring)", async () => {
  const spec = "| 目标平台 | web |\n\n## Page list\n\n| Page | Page ID |\n| --- | --- |\n| Home | home |";
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { spec, moonviz: MOCK_MOONVIZ_DOC },
      failLadder: true,
    })
  );
  assert.equal(result.ok, true, result.error);
  const valid = result.verification?.checks.find((check) => check.id === "moonviz-valid");
  assert.equal(valid?.status, "passed", "validate ran and passed — its verdict must survive the ladder failure");
  const unavailable = result.verification?.checks.find((check) => check.id === "auto:verify-engine-unavailable");
  assert.equal(unavailable?.status, "pending");
  assert.match(unavailable?.observation ?? "", /validate 已通过/, "the message must say validate passed");
});

test("prototype.verify: legacy PRD without 目标平台 yields a pending observation, not a failure", async () => {
  const mcpCalls: McpCall[] = [];
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { spec: "# Tasks\n\n## Page list\n- Board", moonviz: MOCK_MOONVIZ_DOC },
      artboards: [{ id: "board" }],
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
      prototype: { spec, moonviz: MOCK_MOONVIZ_DOC },
      // 多端文档只剩 @desktop 画板,PRD 声明 mobile → platform-mobile-missing failed。
      artboards: [{ id: "board@desktop" }],
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
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { spec, moonviz: MOCK_MOONVIZ_DOC },
      // settings 画板缺失 → coverage failed;多页无 flow → flows-empty failed。
      // （等价迁移注：旧 dangling-nav/orphan-page 检查在引擎 flows 模型下
      // 不可构造——flow 目标必须是存在的画板，引擎侧结构性排除。）
      artboards: [{ id: "home" }, { id: "orders" }],
      flows: [],
      mcpCalls,
    })
  );
  assert.equal(result.verification?.status, "failed");
  const ids = result.verification?.checks.filter((c) => c.status === "failed").map((c) => c.id) ?? [];
  assert.ok(ids.includes("auto:flows-empty"), "multi-page doc without flows flagged");
  assert.ok(ids.includes("auto:coverage-settings-missing"), "missing PRD page flagged");
  assert.ok(ids.includes("auto:coverage-help-extra") === false, "no phantom findings");
});

test("prototype.verify: engine lint findings become pending observations (WP2.3 等价迁移)", async () => {
  const mcpCalls: McpCall[] = [];
  const spec = "| 目标平台 | web |\n\n## Page list\n\n| Page | Page ID |\n| --- | --- |\n| Home | home |";
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { spec, moonviz: MOCK_MOONVIZ_DOC },
      artboards: [{ id: "home" }],
      // session_lint 引擎直调（对比度/触控/间距/空容器）——死按钮类结构问题
      // 在 AgentGate 随 op 内建后由 lint/critique 承担。
      lint: [
        { rule: "contrast", severity: "error", node_id: "subtitle", message: "对比度 2.9 低于 WCAG AA 4.5:1" },
        { rule: "touch_target", severity: "warning", node_id: "small_btn", message: "触控目标 24px 低于 44px" },
      ],
      mcpCalls,
    })
  );
  assert.equal(result.ok, true);
  assert.ok(result.verification?.checks.some((c) => c.id === "auto:lint-contrast"));
  assert.ok(result.verification?.checks.some((c) => c.id === "auto:lint-touch_target"));
  assert.equal(result.verification?.status, "pending", "lint findings are pending observations, not failures");
});

test("prototype.verify: mobile-only PRD with variant-only program passes (交叉审查: 桌面本位检查不得判死)", async () => {
  const mcpCalls: McpCall[] = [];
  const spec = "| 目标平台 | mobile |\n\n## Page list\n\n| Page | Page ID |\n| --- | --- |\n| Home | home |";
  // mobile-only 的正常产物:没有桌面本体,只有 mobile 变体。
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { spec, moonviz: MOCK_MOONVIZ_DOC },
      // 单端（mobile-only）文档：plain 画板 id，无桌面本体可判——放行。
      artboards: [{ id: "home" }],
      mcpCalls,
    })
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
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { spec, moonviz: MOCK_MOONVIZ_DOC },
      // 多端文档：声明端（web→desktop）在场 + 未声明的 @tablet → pending 观察。
      artboards: [{ id: "home@desktop" }, { id: "home@tablet" }],
      flows: [{ from: "home@desktop", to: "home@tablet", trigger: "tap:go" }],
      nodes: [{ id: "go", rect: { x: 10, y: 10, w: 40, h: 40 } }],
      mcpCalls,
    })
  );
  // 多端是 pending 观察项,不是 failed——整体停在 pending 推动人工确认。
  assert.equal(result.verification?.status, "pending");
  assert.ok(result.verification?.checks.some((c) => c.id === "auto:platform-tablet-extra"));
});

test("prototype.verify: external checks with mechanical-looking prefixes survive (auto: 命名空间)", async () => {
  const mcpCalls: McpCall[] = [];
  const spec = "| 目标平台 | web |\n\n## Page list\n\n| Page | Page ID |\n| --- | --- |\n| Home | home |";
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: {
        spec,
        moonviz: MOCK_MOONVIZ_DOC,
        artboards: [{ id: "home" }],
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
    makeCtx({
      prototype: { spec: "# Tasks\n\n## Page list\n- Board", moonviz: MOCK_MOONVIZ_DOC },
      artboards: [{ id: "board" }],
      mcpCalls,
    })
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
        moonviz: MOCK_MOONVIZ_DOC,
        artboards: [{ id: "home" }],
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

// WP4.2 等价迁移注：换名副本检测（componentJaccard）随 openuiVariants 变体
// 结构消亡——MoonViz 单文档多画板模型下"变体"是同文档的结构性画板，平台
// 契约由 materialize 提示词注入、coverage/platform 检查承担完整性。
//

test("design.materialize injects the selected bundled system and source prototype", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: SubagentCall[] = [];
  const leaferDoc = JSON.stringify({
    tag: "Leafer",
    width: 1440,
    height: 1024,
    fill: "#ffffff",
    children: [{ tag: "Frame", x: 0, y: 0, width: 1440, height: 1024, fill: "#111318", children: [] }],
  });
  const result = await designMaterializeRun(
    {
      prototypeSuiteId: PROTOTYPE_REF.suiteId,
      prototypeVersionId: PROTOTYPE_REF.versionId,
      designSystemId: "terminal-mono",
    },
    makeCtx({
      prototype: { requirement: "Task board", moonviz: MOCK_MOONVIZ_DOC },
      generated: `\`\`\`json\n${leaferDoc}\n\`\`\``,
      mcpCalls,
      subagentCalls,
    })
  );
  assert.equal(result.ok, true);
  assert.match(subagentCalls[0].prompt ?? "", /Design System: Terminal Mono/);
  const save = mcpCalls.find((call) => call.name.endsWith("render_leafer"));
  assert.deepEqual(save?.args.sourcePrototype, {
    suiteId: PROTOTYPE_REF.suiteId,
    versionId: PROTOTYPE_REF.versionId,
  });
  assert.equal(save?.args.designSystemId, "terminal-mono");
});

test("design.lint on an openui-era version without leafer fails with a clear error", async () => {
  const mcpCalls: McpCall[] = [];
  // MoonViz 接管原型栈后 UI 套件是 leafer-only：存量 openui 字段版本不再
  // 可 lint（作废语义），错误指向缺失的 leafer 设计而非静默通过。
  const result = await designLintRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: { openui: 'root = Screen("ui")\nhero = Card(data-sem="hero")' },
      mcpCalls,
    })
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /leafer design/);
});

test("design.review validates single-round JSON and quality revise only clears review", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: SubagentCall[] = [];
  const ctx = makeCtx({
    ui: {
      leafer: `{"tag":"Leafer","width":1440,"height":1024,"fill":"#ffffff","children":[{"tag":"Frame","name":"ui","x":0,"y":0,"width":1440,"height":1024,"fill":"#111318","children":[]}]}`,
      quality: {},
    },
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
  const result = await prototypeVerifyRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({ prototype: { spec, moonviz: MOCK_MOONVIZ_DOC }, artboards: [{ id: "board" }] })
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
        moonviz: MOCK_MOONVIZ_DOC,
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
  const leaferDoc = JSON.stringify({
    tag: "Leafer",
    width: 1440,
    height: 1024,
    fill: "#ffffff",
    children: [{ tag: "Frame", name: "board", x: 0, y: 0, width: 1440, height: 1024, fill: "#111318" }],
  });
  const result = await designMaterializeRun(
    input,
    makeCtx({
      prototype: { requirement: "需要一个月度经营看板", moonviz: MOCK_MOONVIZ_DOC },
      generated: `\`\`\`json\n${leaferDoc}\n\`\`\``,
      mcpCalls,
      subagentCalls,
    })
  );
  assert.equal(result.ok, true);
  assert.ok(
    subagentCalls[0].prompt?.includes("需要一个月度经营看板"),
    "the requirement from the suite must reach the subagent prompt"
  );
  const save = mcpCalls.find((call) => call.name.endsWith("render_leafer"));
  assert.equal(save?.args.requirement, "需要一个月度经营看板");
  assert.equal(input.requirement, undefined, "the caller's input object must not be mutated");
});

test("design.review rejects empty evidence with a reason and accepts concrete evidence", async () => {
  const empty = await designReviewRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: {
        leafer: `{"tag":"Leafer","width":1440,"height":1024,"fill":"#ffffff","children":[{"tag":"Frame","name":"ui","x":0,"y":0,"width":1440,"height":1024,"fill":"#111318","children":[]}]}`,
      },
      generated: '```json\n{"status":"passed","composite":0.8,"evidence":{}}\n```',
    })
  );
  assert.equal(empty.ok, false, "empty evidence must not promote the suite to verified");
  assert.match(empty.error ?? "", /evidence/i);

  const concrete = await designReviewRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: {
        leafer: `{"tag":"Leafer","width":1440,"height":1024,"fill":"#ffffff","children":[{"tag":"Frame","name":"ui","x":0,"y":0,"width":1440,"height":1024,"fill":"#111318","children":[]}]}`,
      },
      generated: '```json\n{"status":"passed","composite":0.8,"evidence":{"section":"hero"}}\n```',
    })
  );
  assert.equal(concrete.ok, true);
  assert.equal(concrete.review?.status, "passed");
});

// Leafer 场景 JSON 的 lint 规则由 leafer-design.test.ts 覆盖；openui-era lint 随栈移除。

test("truncated or fence-less op-plan output fails the action instead of persisting garbage", async () => {
  const mcpCalls: McpCall[] = [];
  const truncated = await prototypeMaterializeRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { requirement: "Task board", spec: "# Tasks\n\n## Page list\n- Board" },
      // Missing closing fence: the subagent output was cut off mid-plan —
      // the plan extractor refuses the half-captured body.
      generated: "Here is the plan:\n```moonviz\ntemplate login board 1200 800\nplace login button b",
      mcpCalls,
    })
  );
  assert.equal(truncated.ok, false);
  assert.match(String(truncated.error ?? ""), /regenerate/i);
  assert.equal(
    mcpCalls.some((call) => call.name.endsWith("render_moonviz")),
    false
  );
});

test("fence-less prose op-plan output fails the structural gate", async () => {
  const result = await prototypeMaterializeRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { requirement: "Task board", spec: "# Tasks\n\n## Page list\n- Board" },
      // No fence and no engine-op verb anywhere: prose garbage.
      generated: "Here is the plan: place some buttons around and make it look nice",
    })
  );
  assert.equal(result.ok, false);
  assert.match(String(result.error ?? ""), /regenerate/i);
});

test("structural gates: op-plan verb filter / looksLikeSpecDocument", () => {
  // parseOpPlan 只收引擎动词行——散文里碰巧带 `place` 一词的句子不是 op。
  const { parseOpPlan } = await_import_contract();
  assert.deepEqual(parseOpPlan({ content: "```moonviz\nplace home button b - 1 1 10 10\n```" }), [
    "place home button b - 1 1 10 10",
  ]);
  assert.equal(parseOpPlan({ content: "we place components in ```moonviz fences``` later" }), null);
  assert.equal(looksLikeSpecDocument("# Tasks\n\n## Page list\n- Board"), true);
  assert.equal(looksLikeSpecDocument("plain prose without any heading"), false);
});

// The actions barrel re-exports the contract helpers; dynamic import keeps the
// test-file import list identical to the pre-migration surface.
import * as contractModule from "../actions/moonviz-contract";
function await_import_contract(): typeof contractModule {
  return contractModule;
}

test("progress emits carry stable machine codes for the renderer i18n seam", async () => {
  const codesOf = (emits: ActionProgress[]): Array<string | undefined> =>
    emits.map((event) => (event.data as { code?: string } | undefined)?.code);

  const specEmits: ActionProgress[] = [];
  const spec = await prototypeSpecRun(
    { requirement: "Task board" },
    makeCtx({
      generated:
        "```markdown\n# Tasks 需求文档\n\n## 1. 背景与目标\n\n## 2. 用户与场景\n\n## 3. 功能需求\n\n" +
        "| 模块 | 需求 | 优先级 | 交互要点 |\n| --- | --- | --- | --- |\n| 看板 | 卡片 | P0 | 拖拽 |\n" +
        "| 列表 | 列表 | P1 | 筛选 |\n| 统计 | 完成率 | P2 | 图表 |\n" +
        "\n## 4. 数据与字段\n\n| 实体 | 字段 | 类型 | 校验 | 示例 |\n| --- | --- | --- | --- | --- |\n" +
        "| 任务 | 标题 | string | 非空 | 买菜 |\n| 任务 | 截止 | date | 未来 | 今天 |\n" +
        "\n## 5. 页面清单\n\n| 页面 | 页面ID | 目的 | 关键元素 |\n| --- | --- | --- | --- |\n" +
        "| 看板页 | board | 看板 | 卡片列 |\n\n### board 交互明细\n\n- 拖拽 → 状态流转\n- 新建 → 弹窗表单\n" +
        "\n## 6. 非功能需求\n\n## 7. 验收标准\n\n- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d\n- [ ] e\n\n## 8. 待确认\n```",
      emits: specEmits,
    })
  );
  assert.equal(spec.ok, true);
  assert.deepEqual(codesOf(specEmits), ["prototype.spec.generating", "prototype.spec.saved"]);

  const pdEmits: ActionProgress[] = [];
  const pd = await prototypePmDesignRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: { requirement: "Task board", spec: "# Tasks\n\n## Page list\n- Board" },
      generated:
        "```markdown\n# Task board 原型提示\n\n" +
        "## 页面结构\n- 看板主页面：任务卡片列与筛选器\n" +
        "## 交互叙事\n- 拖拽卡片更新状态，失败回弹\n" +
        "## 信息架构\n- 看板列表两级结构\n" +
        "## 视觉基调\n- 企业内部工具风格\n" +
        "## 平台策略\n- desktop-app\n" +
        "## 继承要点\n- 沿用既有角色与术语\n" +
        "```",
      emits: pdEmits,
    })
  );
  assert.equal(pd.ok, true);
  assert.deepEqual(codesOf(pdEmits), ["prototype.pmdesign.generating", "prototype.pmdesign.saved"]);

  const materializeEmits: ActionProgress[] = [];
  const materialize = await prototypeMaterializeRun(
    { suiteId: PROTOTYPE_REF.suiteId, versionId: PROTOTYPE_REF.versionId },
    makeCtx({
      prototype: {
        requirement: "Task board",
        spec: "# Tasks\n\n## Page list\n- Board",
        pmDesign: "# Task board 原型提示\n\n## 页面结构\n- Board",
      },
      generated: "```moonviz\ntemplate login board 1200 800\n```",
      emits: materializeEmits,
    })
  );
  assert.equal(materialize.ok, true);
  assert.deepEqual(codesOf(materializeEmits), ["prototype.materialize.generating", "prototype.materialize.saved"]);

  const designEmits: ActionProgress[] = [];
  const designLeaferDoc = JSON.stringify({
    tag: "Leafer",
    width: 1440,
    height: 1024,
    fill: "#ffffff",
    children: [{ tag: "Frame", name: "board", x: 0, y: 0, width: 1440, height: 1024, fill: "#111318" }],
  });
  const design = await designMaterializeRun(
    {
      prototypeSuiteId: PROTOTYPE_REF.suiteId,
      prototypeVersionId: PROTOTYPE_REF.versionId,
      designSystemId: "terminal-mono",
    },
    makeCtx({
      prototype: {
        requirement: "Task board",
        moonviz: MOCK_MOONVIZ_DOC,
        // specs/prompt-doc-chain：带 pm-design → ui-design 强化 stage 先行。
        pmDesign: "# Task board 原型提示\n\n## 页面结构\n- Board",
      },
      generatedQueue: [
        "```markdown\n# Task board 视觉稿提示\n\n## 画布构图\n- Board 帧\n\n## tokens 映射\n- accent\n\n## 视觉层级\n- 标题>卡片\n\n## 状态呈现\n- 空态/加载/错误\n```",
        `\`\`\`json\n${designLeaferDoc}\n\`\`\``,
      ],
      emits: designEmits,
    })
  );
  assert.equal(design.ok, true);
  // 交叉审查修复后的发射序：uidesign.saved 移到 render_leafer 成功后——
  // 与 materialize.generating（画布生成开始）交错为正确叙事。
  assert.deepEqual(codesOf(designEmits), [
    "design.uidesign.generating",
    "design.materialize.generating",
    "design.uidesign.saved",
    "design.materialize.saved",
  ]);
});

test("re-review M1: nested/array evidence shapes pass the review evidence gate", async () => {
  const arrayShaped = await designReviewRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: {
        leafer: `{"tag":"Leafer","width":1440,"height":1024,"fill":"#ffffff","children":[{"tag":"Frame","name":"ui","x":0,"y":0,"width":1440,"height":1024,"fill":"#111318","children":[]}]}`,
      },
      generated: '```json\n{"status":"passed","composite":0.8,"evidence":{"findings":["#submit","#nav"]}}\n```',
    })
  );
  assert.equal(arrayShaped.ok, true, "array-valued evidence is concrete, not empty");

  const nestedShaped = await designReviewRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: {
        leafer: `{"tag":"Leafer","width":1440,"height":1024,"fill":"#ffffff","children":[{"tag":"Frame","name":"ui","x":0,"y":0,"width":1440,"height":1024,"fill":"#111318","children":[]}]}`,
      },
      generated: '```json\n{"status":"failed","composite":0.3,"evidence":{"contrast":{"ratio":3.2}}}\n```',
    })
  );
  assert.equal(nestedShaped.ok, true, "nested numeric evidence is concrete");

  const hollowShaped = await designReviewRun(
    { suiteId: UI_REF.suiteId, versionId: UI_REF.versionId },
    makeCtx({
      ui: {
        leafer: `{"tag":"Leafer","width":1440,"height":1024,"fill":"#ffffff","children":[{"tag":"Frame","name":"ui","x":0,"y":0,"width":1440,"height":1024,"fill":"#111318","children":[]}]}`,
      },
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
      // 尾部追加深度节（过深度门）；中行围栏陷阱保留在前半——抽取语义不变。
      generated:
        "Wrap it in a ```openui fence later. # Tasks\n\n## Page list\n- Board\n\n" +
        "## 1. 背景与目标\n\n## 2. 用户与场景\n\n## 3. 功能需求\n\n" +
        "| 模块 | 需求 | 优先级 | 交互要点 |\n| --- | --- | --- | --- |\n" +
        "| 看板 | 卡片 | P0 | 拖拽 |\n| 列表 | 列表 | P1 | 筛选 |\n| 统计 | 完成率 | P2 | 图表 |\n" +
        "\n## 4. 数据与字段\n\n| 实体 | 字段 | 类型 | 校验 | 示例 |\n| --- | --- | --- | --- | --- |\n" +
        "| 任务 | 标题 | string | 非空 | 买菜 |\n| 任务 | 截止 | date | 未来 | 今天 |\n" +
        "\n## 5. 页面清单\n\n| 页面 | 页面ID | 目的 | 关键元素 |\n| --- | --- | --- | --- |\n" +
        "| 看板页 | board | 看板 | 卡片列 |\n\n### board 交互明细\n\n- 拖拽 → 状态流转\n- 新建 → 弹窗表单\n" +
        "\n## 6. 非功能需求\n\n## 7. 验收标准\n\n- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d\n- [ ] e\n\n## 8. 待确认",
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
      generated:
        "I will use a ```markdown\nfragment``` and continue.\n\n# Tasks\n\n## Page list\n- Board\n\n" +
        "## 1. 背景与目标\n\n## 2. 用户与场景\n\n## 3. 功能需求\n\n" +
        "| 模块 | 需求 | 优先级 | 交互要点 |\n| --- | --- | --- | --- |\n" +
        "| 看板 | 卡片 | P0 | 拖拽 |\n| 列表 | 列表 | P1 | 筛选 |\n| 统计 | 完成率 | P2 | 图表 |\n" +
        "\n## 4. 数据与字段\n\n| 实体 | 字段 | 类型 | 校验 | 示例 |\n| --- | --- | --- | --- | --- |\n" +
        "| 任务 | 标题 | string | 非空 | 买菜 |\n| 任务 | 截止 | date | 未来 | 今天 |\n" +
        "\n## 5. 页面清单\n\n| 页面 | 页面ID | 目的 | 关键元素 |\n| --- | --- | --- | --- |\n" +
        "| 看板页 | board | 看板 | 卡片列 |\n\n### board 交互明细\n\n- 拖拽 → 状态流转\n- 新建 → 弹窗表单\n" +
        "\n## 6. 非功能需求\n\n## 7. 验收标准\n\n- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d\n- [ ] e\n\n## 8. 待确认",
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
      prototype: { requirement: "Task board", moonviz: MOCK_MOONVIZ_DOC },
      generated: "Here is the design: buttons everywhere and no root binding at all",
    })
  );
  assert.equal(result.ok, false);
  assert.match(String(result.error ?? ""), /regenerate/i);
  assert.equal(
    mcpCalls.some((call) => call.name.endsWith("render_leafer")),
    false
  );
});
