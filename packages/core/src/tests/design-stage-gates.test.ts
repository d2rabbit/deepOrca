/**
 * specs/design-stage-gates：垂直 agent 稳定性分层的机械验证。
 *
 * OCR（alibaba/open-code-review）源码调研的三条借鉴逐条落地：
 * - 确定性优先（RE_LOCATION 三级解析）：归一化/占位感知行计数先于 LLM 修复轮；
 * - 增强 fail-open（plan-failure 分层）：stage0 蒸馏 / ui-design 强化失败降级
 *   基线路径，绝不阻塞主管线；
 * - 落盘验证 fail-closed（行号越界校验）：arch 七节门 / Leafer 缺页门不达标
 *   拒绝落盘；瞬态错误单次重试（OCR 模板预算内重试）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  archSectionsAudit,
  callSubagentStable,
  countTableDataRows,
  designMaterializeRun,
  leaferCanvasFindings,
  normalizeGeneratedMarkdown,
  openuiInteractivityFindings,
  prototypeArchRun,
  prototypeMaterializeRun,
  runDesignStage,
  subagentContentOf,
} from "../actions";
import { NULL_SPAWNER } from "../actions/types";
import type { ActionContext, RunSubagentOptions } from "../actions/types";

type McpCall = { name: string; args: Record<string, unknown> };

interface FakeSuite {
  kind: "prototype" | "ui";
  title: string;
  content: Record<string, unknown>;
}

function makeCtx(
  suites: Record<string, FakeSuite>,
  options: {
    generatedQueue?: string[];
    mcpCalls?: McpCall[];
    subagentCalls?: RunSubagentOptions[];
    emits?: Array<{ data?: unknown; message?: string }>;
  } = {}
): ActionContext {
  const mcpCalls = options.mcpCalls ?? [];
  const subagentCalls = options.subagentCalls ?? [];
  let callIndex = 0;
  return {
    projectRoot: process.cwd(),
    signal: new AbortController().signal,
    emit: (event) => {
      options.emits?.push(event);
    },
    spawner: NULL_SPAWNER,
    runSubagent: async (call) => {
      subagentCalls.push(call);
      const content = options.generatedQueue?.[Math.min(callIndex, (options.generatedQueue?.length ?? 1) - 1)] ?? "";
      callIndex += 1;
      return { sessionId: "sub", content };
    },
    executeMcpTool: async (name, args) => {
      mcpCalls.push({ name, args });
      if (name.endsWith("read_suite_version")) {
        const suiteId = String((args as { suiteId?: unknown }).suiteId ?? "");
        const requested = (args as { versionId?: unknown }).versionId;
        const suite = suites[suiteId];
        if (!suite) return { ok: false, error: `suite "${suiteId}" not found` };
        return {
          ok: true,
          output: JSON.stringify({
            artifactRef: { suiteId, versionId: typeof requested === "string" ? requested : "head-1", kind: suite.kind },
            title: suite.title,
            status: "ready",
            content: suite.content,
          }),
        };
      }
      return {
        ok: true,
        output: `saved\nArtifactRef: ${JSON.stringify({ suiteId: "new-suite", versionId: "v-new", kind: "prototype" })}`,
      };
    },
  };
}

// ── S1 确定性归一化 + 占位感知行计数 ─────────────────────────────────────────

test("normalizeGeneratedMarkdown dedents indented GFM table rows and leaves the rest alone", () => {
  const normalized = normalizeGeneratedMarkdown(
    [
      "# 文档",
      "",
      "  | 实体 | 字段 |", // 缩进表格行 → 去缩进
      "  | --- | --- |",
      "  | 用户 | 姓名 |",
      "- 普通列表项 | 不动", // 有 | 但不是表格行（不以 | 开头）→ 不动
      "正文不动",
    ].join("\n")
  );
  const lines = normalized.split("\n");
  assert.equal(lines[2], "| 实体 | 字段 |");
  assert.equal(lines[4], "| 用户 | 姓名 |");
  assert.equal(lines[5], "- 普通列表项 | 不动");
});

test("countTableDataRows: separator/placeholder rows skipped, headers and real rows counted", () => {
  const section = [
    "| 实体 | 字段 | 类型 |", // 表头计 1
    "| --- | --- | --- |", // 分隔行不计
    "| <实体A> | <字段1> | <类型> |", // 纯占位行不计（骨架抄写）
    "| 用户 | 姓名 | string |", // 真实行计 1
    "  | 用户 | 年龄 | number |", // 缩进行（归一化后）计 1
    "| [TODO: 实体] | [TODO: 字段] | [TODO: 类型] |", // 全 TODO 占位不计
    "| 用户 | <占位但混有实格> | string |", // 混合行=真实内容计 1
  ].join("\n");
  assert.equal(countTableDataRows(section), 4);
  assert.equal(countTableDataRows(null), 0);
  assert.equal(countTableDataRows(""), 0);
});

test("subagentContentOf unwraps {content}, plain strings, and nulls empties", () => {
  assert.equal(subagentContentOf({ content: "hello" }), "hello");
  assert.equal(subagentContentOf("hello"), "hello");
  assert.equal(subagentContentOf({ content: "  " }), null);
  assert.equal(subagentContentOf({}), null);
  assert.equal(subagentContentOf(null), null);
});

// ── S3 架构文档门 ────────────────────────────────────────────────────────────

const ARCH_OK = [
  "# 技术架构",
  "",
  "## 1. 技术选型",
  "| 领域 | 选型 | 理由 |",
  "| --- | --- | --- |",
  "| 前端 | React | 生态 |",
  "| 状态 | Zustand | 轻 |",
  "| 后端 | Node | 同构 |",
  "",
  "## 2. 系统架构",
  "```mermaid",
  "graph TD",
  "  A --> B",
  "```",
  "",
  "## 3. 数据模型",
  "```mermaid",
  "erDiagram",
  "  USER ||--o{ ORDER : places",
  "```",
  "",
  "## 4. 核心流程",
  "```mermaid",
  "sequenceDiagram",
  "  U->>S: login",
  "```",
  "",
  "## 5. 模块拆分",
  "| 模块 | 职责 |",
  "| --- | --- |",
  "| auth | 认证 |",
  "| user | 用户 |",
  "| order | 订单 |",
  "",
  "## 6. 非功能设计",
  "- 性能：P95 < 500ms",
  "",
  "## 7. 风险与对策",
  "| 风险 | 对策 |",
  "| --- | --- |",
  "| 并发 | 限流 |",
  "| 数据丢失 | 备份 |",
].join("\n");

test("archSectionsAudit accepts the complete seven-section document", () => {
  assert.deepEqual(archSectionsAudit(ARCH_OK), []);
});

test("archSectionsAudit flags missing erDiagram, thin tables, and missing sections", () => {
  const thin = ARCH_OK.replace("erDiagram\n  USER ||--o{ ORDER : places", "graph TD\n  A --> B") // 干掉 erDiagram
    .replace("| 前端 | React | 生态 |\n| 状态 | Zustand | 轻 |\n| 后端 | Node | 同构 |", "| 前端 | React | 生态 |")
    .replace("## 7. 风险与对策", "## 7. 其它");
  const findings = archSectionsAudit(thin);
  assert.ok(findings.some((f) => f.includes("erDiagram")));
  assert.ok(findings.some((f) => f.includes("技术选型表仅")));
  assert.ok(findings.some((f) => f.includes("风险")));
});

test("prototype.arch inlines the skeleton, repairs once, and fails closed on a thin document", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: RunSubagentOptions[] = [];
  const ctx = makeCtx(
    { proto: { kind: "prototype", title: "P", content: { spec: "# PRD", verification: { status: "passed" } } } },
    { generatedQueue: ["```markdown\n# 架构\n只有一段\n```"], mcpCalls, subagentCalls }
  );
  const result = await prototypeArchRun({ suiteId: "proto", versionId: "head-1" }, ctx);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : (result as { error?: string }).error, /prototype\.arch/);
  assert.ok(subagentCalls[0]?.prompt?.includes("## 骨架（逐节填充）"), "skeleton inlined in round-0 prompt");
  assert.ok((subagentCalls[1]?.prompt ?? "").includes("深度审计 findings"), "repair round carries findings");
  assert.ok(!mcpCalls.some((call) => call.name.endsWith("save_suite_arch")), "thin doc never persists");
});

test("prototype.arch persists the compliant document after the gate", async () => {
  const mcpCalls: McpCall[] = [];
  const wrapped = "```markdown\n" + ARCH_OK + "\n```";
  const ctx = makeCtx(
    { proto: { kind: "prototype", title: "P", content: { spec: "# PRD", verification: { status: "passed" } } } },
    { generatedQueue: [wrapped], mcpCalls }
  );
  const result = await prototypeArchRun({ suiteId: "proto", versionId: "head-1" }, ctx);
  assert.equal(result.ok, true, `arch must pass: ${result.ok ? "" : (result as { error?: string }).error}`);
  assert.ok(mcpCalls.some((call) => call.name.endsWith("save_suite_arch")));
});

test("prototype.arch refuses to run before verification passed", async () => {
  const ctx = makeCtx(
    { proto: { kind: "prototype", title: "P", content: { spec: "# PRD", verification: { status: "failed" } } } },
    {}
  );
  const result = await prototypeArchRun({ suiteId: "proto", versionId: "head-1" }, ctx);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : (result as { error?: string }).error, /verification/);
});

// ── S2 stage0 / ui-design fail-open 降级 ────────────────────────────────────

const SPEC_FOR_DEGRADE = "# 登录 PRD\n\n## 页面清单\n- 登录页\n\n## 功能需求\n- P0 账号密码登录";
const OPENUI_OK = '```\nroot = Column([Button(Action([@Set($page, "home")], "go")]) )\n```';

test("materialize stage0 distill failure degrades to spec-driven generation (fail-open)", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: RunSubagentOptions[] = [];
  const emits: Array<{ data?: unknown }> = [];
  // 队列：蒸馏产物（无结构 → 审计失败）→ 修复轮（仍无结构）→ 原型生成。
  const ctx = makeCtx(
    { proto: { kind: "prototype", title: "P", content: { spec: SPEC_FOR_DEGRADE, requirement: "登录" } } },
    { generatedQueue: ["plain prose", "plain prose again", OPENUI_OK], mcpCalls, subagentCalls, emits }
  );
  const result = await prototypeMaterializeRun({ suiteId: "proto", versionId: "head-1" }, ctx);
  assert.equal(
    result.ok,
    true,
    `materialize must survive distill failure: ${result.ok ? "" : (result as { error?: string }).error}`
  );
  const genPrompt = subagentCalls[2]?.prompt ?? "";
  assert.ok(
    genPrompt.startsWith("Create the complete OpenUI Lang prototype for the requirements document below. "),
    "spec-driven legacy prompt"
  );
  assert.ok(!genPrompt.includes("## pm-design"), "no pm-design block on the degraded path");
  assert.ok(
    emits.some((event) => (event.data as { code?: string } | undefined)?.code === "prototype.materialize.degraded"),
    "degrade event emitted"
  );
  assert.ok(
    !mcpCalls.some((call) => call.name.endsWith("save_pm_design")),
    "nothing persisted from the failed distill"
  );
});

const PD_BASIS =
  "# 登录原型设计提示\n\n## 页面结构\n- 登录页\n\n## 交互叙事\n- 提交→校验\n\n## 信息架构\n- 单页\n\n## 视觉基调\n- 简洁\n\n## 平台策略\n- web\n\n## 继承要点\n- 无";
const UI_THIN = "```markdown\n# 视觉稿\n\n## 画布构图\n- 一句话\n```"; // 缺三节 → 审计失败
const LEAFER_PLAIN = JSON.stringify({
  tag: "Leafer",
  width: 1440,
  height: 1024,
  fill: "#ffffff",
  children: [{ tag: "Rect", x: 24, y: 24, width: 200, height: 64, fill: "#4F46E5" }],
});

test("design.materialize degrades ui-design after failed repair and still renders the canvas", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: RunSubagentOptions[] = [];
  const emits: Array<{ data?: unknown }> = [];
  // 队列：ui 轮0（薄）→ ui 修复轮（仍薄）→ 画布生成。
  const ctx = makeCtx(
    {
      proto: {
        kind: "prototype",
        title: "P",
        content: { spec: SPEC_FOR_DEGRADE, openui: "root = Column([])", pmDesign: PD_BASIS, requirement: "登录" },
      },
    },
    { generatedQueue: [UI_THIN, UI_THIN, "```json\n" + LEAFER_PLAIN + "\n```"], mcpCalls, subagentCalls, emits }
  );
  const result = await designMaterializeRun(
    { prototypeSuiteId: "proto", prototypeVersionId: "head-1", designSystemId: "dark-tech" },
    ctx
  );
  assert.equal(
    result.ok,
    true,
    `canvas must survive ui-design failure: ${result.ok ? "" : (result as { error?: string }).error}`
  );
  assert.ok(
    emits.some((event) => (event.data as { code?: string } | undefined)?.code === "design.uidesign.degraded"),
    "ui-design degrade event emitted"
  );
  const render = mcpCalls.find((call) => call.name.endsWith("render_leafer"));
  assert.ok(render, "canvas persists through render_leafer");
  assert.equal(render?.args.uiDesign, undefined, "degraded suite-less run omits uiDesign entirely");
  const canvasPrompt = subagentCalls[2]?.prompt ?? "";
  assert.ok(
    !canvasPrompt.includes("## ui-design（视觉意图——主驱动）"),
    "canvas prompt is prototype/requirement driven"
  );
});

// ── S4 OpenUI 交互密度门 ─────────────────────────────────────────────────────

test("openuiInteractivityFindings flags shells and unreachable pages", () => {
  const spec = [
    "# PRD",
    "## 5. 页面清单",
    "| 页面 | 页面ID |",
    "| --- | --- |",
    "| 登录 | login |",
    "| 首页 | home |",
  ].join("\n");
  const shell = '$page = "login"\nroot = Column([])';
  const shellFindings = openuiInteractivityFindings(spec, shell);
  assert.ok(shellFindings.some((f) => f.includes("组件调用")));
  assert.ok(shellFindings.some((f) => f.includes("Action 交互")));
  assert.ok(shellFindings.some((f) => f.includes("home") && f.includes("不可达")));
  const rich = [
    '$page = "login"',
    'root = $page == "login" ? Column([Text("a"), Text("b"), Card([]), Button(Action([@Set($page, "home")], "go"))]) : null',
    'homeView = Column([Text("c"), Text("d"), Card([]), Table([]), Input([]), Button(Action([@Set($page, "login")], "back"))])',
  ].join("\n");
  assert.deepEqual(openuiInteractivityFindings(spec, rich), []);
});

// ── S5 Leafer 画布深度门 ─────────────────────────────────────────────────────

function frameCanvas(frames: number): string {
  const children = Array.from({ length: frames }, (_, index) => ({
    tag: "Frame",
    name: `page-${index}`,
    x: 24,
    y: 24 + index * 300,
    width: 640,
    height: 280,
    children: [
      { tag: "Text", x: 8, y: 8, width: 200, height: 24, fill: "#111111", text: `页面${index}` },
      { tag: "Rect", x: 8, y: 48, width: 320, height: 120, fill: "#4F46E5" },
    ],
  }));
  return JSON.stringify({ tag: "Leafer", width: 1440, height: 1024, fill: "#ffffff", children });
}

test("leaferCanvasFindings: missing frames are hard, low density is soft", () => {
  const short = leaferCanvasFindings(frameCanvas(1), 2);
  assert.ok(short.findings.some((f) => f.includes("少于原型页面数")));
  assert.deepEqual(leaferCanvasFindings(frameCanvas(2), 2).findings, []);
  // 密度不足只进软提示（每 Frame ≥8 节点建议；本例每 Frame 3 节点）。
  assert.ok(leaferCanvasFindings(frameCanvas(2), 2).softNotes.some((n) => n.includes("密度")));
  // 未知页面数（requirement-only）不启用硬门。
  assert.deepEqual(leaferCanvasFindings(frameCanvas(0), undefined).findings, []);
  assert.ok(leaferCanvasFindings("{broken json", 1).findings.some((f) => f.includes("无法解析")));
});

test("design.materialize fails closed when canvas frames stay below prototype pages", async () => {
  const mcpCalls: McpCall[] = [];
  const oneFrame = "```json\n" + frameCanvas(1) + "\n```";
  const protoProgram = [
    '$page = "login"',
    'root = $page == "login" ? Column([]) : $page == "home" ? Column([]) : null',
  ].join("\n");
  const ctx = makeCtx(
    {
      proto: {
        kind: "prototype",
        title: "P",
        content: { spec: SPEC_FOR_DEGRADE, openui: protoProgram, requirement: "登录" },
      },
    },
    { generatedQueue: [oneFrame, oneFrame], mcpCalls }
  );
  const result = await designMaterializeRun(
    { prototypeSuiteId: "proto", prototypeVersionId: "head-1", designSystemId: "dark-tech" },
    ctx
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : (result as { error?: string }).error, /depth gate/);
  assert.ok(!mcpCalls.some((call) => call.name.endsWith("render_leafer")), "short canvas never persists");
});

// ── S6 子代理瞬态重试 ───────────────────────────────────────────────────────

function stableCtx(behavior: Array<() => Promise<unknown>>): {
  ctx: { runSubagent: (opts: RunSubagentOptions) => Promise<unknown>; emit?: () => void };
  calls: number;
} {
  let index = 0;
  let calls = 0;
  return {
    calls: 0,
    ctx: {
      runSubagent: async () => {
        calls += 1;
        const step = behavior[Math.min(index, behavior.length - 1)];
        index += 1;
        return step();
      },
    },
    get calls() {
      return calls;
    },
  } as { ctx: { runSubagent: (opts: RunSubagentOptions) => Promise<unknown> }; calls: number };
}

test("callSubagentStable retries transient errors once and succeeds", async () => {
  const harness = stableCtx([
    () => Promise.reject(Object.assign(new Error("rate limit exceeded"), { status: 429 })),
    () => Promise.resolve({ content: "ok" }),
  ]);
  const content = await callSubagentStable(harness.ctx, { skill: "s" }, "stage");
  assert.equal(content, "ok");
  assert.equal(harness.calls, 2);
});

test("callSubagentStable retries empty content once", async () => {
  const harness = stableCtx([() => Promise.resolve({ content: null }), () => Promise.resolve({ content: "ok" })]);
  const content = await callSubagentStable(harness.ctx, { skill: "s" }, "stage");
  assert.equal(content, "ok");
  assert.equal(harness.calls, 2);
});

test("callSubagentStable fails fast on non-transient errors and exhausted retries", async () => {
  const auth = stableCtx([() => Promise.reject(Object.assign(new Error("invalid api key"), { status: 401 }))]);
  await assert.rejects(() => callSubagentStable(auth.ctx, { skill: "s" }, "stage"), /invalid api key/);
  assert.equal(auth.calls, 1);
  const alwaysTransient = stableCtx([
    () => Promise.reject(Object.assign(new Error("server exploded"), { status: 500 })),
  ]);
  await assert.rejects(() => callSubagentStable(alwaysTransient.ctx, { skill: "s" }, "stage"), /server exploded/);
  assert.equal(alwaysTransient.calls, 2);
});

test("runDesignStage surfaces findings in the fail-closed error", async () => {
  const calls: string[] = [];
  const ctx = {
    runSubagent: async (opts: RunSubagentOptions) => {
      calls.push(opts.prompt);
      return { sessionId: "s", content: "```markdown\n# doc\n```" };
    },
    signal: new AbortController().signal,
    emit: () => {},
  };
  const result = await runDesignStage(ctx, {
    stage: "unit-test",
    skill: "s",
    buildPrompt: (findings) => (findings ? `repair:${findings.join(",")}` : "fresh"),
    extract: (generated) => (generated && generated.includes("# doc") ? generated : null),
    audit: () => ["缺一", "缺二"],
    maxRepairs: 1,
  });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /缺一; 缺二/);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /^repair:/);
});
