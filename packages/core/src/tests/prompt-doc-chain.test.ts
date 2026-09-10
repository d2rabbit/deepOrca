/**
 * 提示词文档链（specs/prompt-doc-chain）：
 * - prototype.pddesign（手动重算）与 materialize stage0（自动）共享同一条
 *   pd-design 蒸馏路径；无 pd-design 时原型提示词与既有行为字节一致；
 * - design.materialize 的 ui-design 强化 stage（有 pdDesign 才跑）+
 *   render_leafer.uiDesign 透传；revise 注入（存在才注入）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  designMaterializeRun,
  designReviseRun,
  LEAFER_CREATE_CONTRACT,
  prototypeMaterializeRun,
  prototypePdDesignRun,
} from "../actions";
import { NULL_SPAWNER } from "../actions/types";
import type { ActionContext, RunSubagentOptions } from "../actions/types";

type McpCall = { name: string; args: Record<string, unknown> };

interface FakeSuite {
  kind: "prototype" | "ui";
  title: string;
  content: Record<string, unknown>;
  themeId?: string;
  stage?: string;
  inherits?: { suiteId: string; versionId?: string };
  references?: Array<{ suiteId: string; versionId?: string }>;
}

function makeCtx(
  suites: Record<string, FakeSuite>,
  options: { generatedQueue?: string[]; mcpCalls?: McpCall[]; subagentCalls?: RunSubagentOptions[] } = {}
): ActionContext {
  const mcpCalls = options.mcpCalls ?? [];
  const subagentCalls = options.subagentCalls ?? [];
  let callIndex = 0;
  return {
    projectRoot: process.cwd(),
    signal: new AbortController().signal,
    emit: () => {},
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
            ...(suite.themeId ? { themeId: suite.themeId } : {}),
            ...(suite.stage ? { stage: suite.stage } : {}),
            ...(suite.inherits ? { inherits: suite.inherits } : {}),
            ...(suite.references ? { references: suite.references } : {}),
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

const SPEC = "# 登录 PRD\n\n## 页面清单\n- 登录页\n\n## 功能需求\n- P0 账号密码登录";
const PD_DOC =
  "```markdown\n# 登录原型设计提示\n\n## 页面结构\n- 登录页：账号密码表单，出错内联提示\n\n## 交互叙事\n- 提交→校验→跳转首页\n```";
const OPENUI = "```\nroot = Column([])\n```";
const PD_MARKDOWN = "# 登录原型设计提示\n\n## 页面结构\n- 登录页\n\n## 交互叙事\n- 提交→校验";
const UI_DOC = "```markdown\n# 登录视觉稿提示\n\n## 画布构图\n- 登录帧居中卡片\n\n## tokens 映射\n- 主色→accent\n```";
const UI_MARKDOWN = "# 登录视觉稿提示\n\n## 画布构图\n- 登录帧居中卡片\n\n## tokens 映射\n- 主色→accent";
const LEAFER_DOC = JSON.stringify({
  tag: "Leafer",
  width: 1440,
  height: 1024,
  fill: "#ffffff",
  children: [{ tag: "Rect", x: 24, y: 24, width: 200, height: 64, fill: "#4F46E5" }],
});

test("prototype.pddesign distills pd-design (with reference context) and persists via save_pd_design", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: RunSubagentOptions[] = [];
  const ctx = makeCtx(
    {
      proto: {
        kind: "prototype",
        title: "登录 PRD",
        content: { spec: SPEC },
        inherits: { suiteId: "parent" },
        references: [{ suiteId: "ref" }],
      },
      parent: {
        kind: "prototype",
        title: "人员管理 PRD",
        content: { spec: "# 人员管理 PRD\n\n## 角色模型\n- 管理员" },
      },
      ref: { kind: "prototype", title: "权限 PRD", content: { spec: "# 权限 PRD\n\n## 矩阵\n- 行/列" } },
    },
    { generatedQueue: [PD_DOC], mcpCalls, subagentCalls }
  );
  const result = await prototypePdDesignRun({ suiteId: "proto" }, ctx);
  assert.ok(result.ok, `pddesign must succeed: ${result.ok ? "" : (result as { error?: string }).error}`);
  const prompt = subagentCalls[0]?.prompt ?? "";
  assert.match(prompt, /pd-design prompt document/);
  assert.match(prompt, /## 需求文档（契约源）[\s\S]*# 登录 PRD/);
  // 主题层的继承/交叉参考上下文继续注入（specs/prd-theme-layer 复用）。
  assert.match(prompt, /### 继承：人员管理 PRD（parent @ head）/);
  assert.match(prompt, /### 交叉参考：权限 PRD（ref @ head）/);
  const save = mcpCalls.find((call) => call.name.endsWith("save_pd_design"));
  assert.ok(save, "pd-design persists through save_pd_design");
  assert.match(String(save?.args.document), /# 登录原型设计提示/);
});

test("prototype.pddesign rejects structure-less output without persisting", async () => {
  const mcpCalls: McpCall[] = [];
  const ctx = makeCtx(
    { proto: { kind: "prototype", title: "登录 PRD", content: { spec: SPEC } } },
    { generatedQueue: ["plain prose without any heading"], mcpCalls }
  );
  const result = await prototypePdDesignRun({ suiteId: "proto" }, ctx);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : (result as { error?: string }).error, /pd-design document/);
  assert.ok(!mcpCalls.some((call) => call.name.endsWith("save_pd_design")), "nothing persisted on gate failure");
});

test("materialize stage0 auto-distills when pdDesign is absent and threads the new head", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: RunSubagentOptions[] = [];
  const ctx = makeCtx(
    { proto: { kind: "prototype", title: "登录 PRD", content: { spec: SPEC, requirement: "登录模块" } } },
    { generatedQueue: [PD_DOC, OPENUI], mcpCalls, subagentCalls }
  );
  const result = await prototypeMaterializeRun({ suiteId: "proto", versionId: "head-1" }, ctx);
  assert.ok(result.ok, `materialize must succeed: ${result.ok ? "" : (result as { error?: string }).error}`);
  // 子代理顺序：stage0（deep-design 蒸馏）→ pm-designer（原型化）。
  assert.equal(subagentCalls.length, 2);
  assert.match(subagentCalls[0]?.prompt ?? "", /pd-design prompt document/);
  const save = mcpCalls.find((call) => call.name.endsWith("save_pd_design"));
  assert.ok(save, "stage0 persists pd-design before the device loop");
  const render = mcpCalls.find((call) => call.name.endsWith("render_openui"));
  assert.equal(render?.args.versionId, "v-new", "the device loop threads the NEW head (save_pd_design moved it)");
  // 原型提示词以 pd-design 为主驱动。
  assert.match(subagentCalls[1]?.prompt ?? "", /## pd-design（设计意图——主驱动）/);
  assert.match(subagentCalls[1]?.prompt ?? "", /## 需求文档（范围契约源）[\s\S]*# 登录 PRD/);
});

test("materialize skips stage0 when pdDesign already exists (manual recompute stays authoritative)", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: RunSubagentOptions[] = [];
  const ctx = makeCtx(
    {
      proto: {
        kind: "prototype",
        title: "登录 PRD",
        content: { spec: SPEC, pdDesign: PD_MARKDOWN },
      },
    },
    { generatedQueue: [OPENUI], mcpCalls, subagentCalls }
  );
  const result = await prototypeMaterializeRun({ suiteId: "proto", versionId: "head-1" }, ctx);
  assert.ok(result.ok);
  assert.equal(subagentCalls.length, 1, "no pd-design stage — straight to the prototype generator");
  assert.ok(!mcpCalls.some((call) => call.name.endsWith("save_pd_design")));
  assert.match(subagentCalls[0]?.prompt ?? "", /## pd-design（设计意图——主驱动）[\s\S]*# 登录原型设计提示/);
});

test("materialize keeps the legacy artifact prompt byte-structure (suite-less path skips stage0)", async () => {
  // suite 路径无 pdDesign 时必然自动蒸馏（stage0）；字节兼容面只剩 legacy
  // artifact 路径（无 suite/版本链，无处落 pd-design）。
  const fs = await import("node:fs");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "prompt-doc-legacy-"));
  const legacyId = "legacy-spec";
  fs.mkdirSync(nodePath.join(root, ".deeporca", "designs", legacyId), { recursive: true });
  fs.writeFileSync(nodePath.join(root, ".deeporca", "designs", legacyId, "spec.md"), SPEC, "utf8");
  const subagentCalls: RunSubagentOptions[] = [];
  const ctx = makeCtx({}, { generatedQueue: [OPENUI], subagentCalls });
  ctx.projectRoot = root;
  const result = await prototypeMaterializeRun({ specArtifactId: legacyId }, ctx);
  assert.ok(result.ok, `legacy materialize must succeed: ${result.ok ? "" : (result as { error?: string }).error}`);
  const prompt = subagentCalls[0]?.prompt ?? "";
  assert.ok(
    prompt.startsWith("Create the complete OpenUI Lang prototype for the requirements document below. "),
    "legacy head preserved byte-for-byte"
  );
  assert.ok(prompt.includes("Cover its page list and flows strictly without inventing scope. "));
  assert.ok(prompt.endsWith(`Return only the OpenUI Lang program in one code fence.\n\n${SPEC}`));
  assert.ok(!prompt.includes("pd-design"), "no prompt-doc markers on the legacy path");
});

test("design.materialize runs the ui-design stage and passes uiDesign through render_leafer", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: RunSubagentOptions[] = [];
  const ctx = makeCtx(
    {
      proto: {
        kind: "prototype",
        title: "登录 PRD",
        content: { spec: SPEC, openui: "root = Column([])", pdDesign: PD_MARKDOWN, requirement: "登录模块" },
      },
    },
    { generatedQueue: [UI_DOC, LEAFER_DOC], mcpCalls, subagentCalls }
  );
  const result = await designMaterializeRun(
    { prototypeSuiteId: "proto", prototypeVersionId: "head-1", designSystemId: "dark-tech", requirement: "登录模块" },
    ctx
  );
  assert.ok(result.ok, `materialize must succeed: ${result.ok ? "" : (result as { error?: string }).error}`);
  // 子代理顺序：ui-design 强化 → leafer 生成。
  assert.equal(subagentCalls.length, 2);
  assert.match(subagentCalls[0]?.prompt ?? "", /ui-design prompt document/);
  assert.match(subagentCalls[0]?.prompt ?? "", /## pd-design（交互意图，翻译源）[\s\S]*# 登录原型设计提示/);
  const render = mcpCalls.find((call) => call.name.endsWith("render_leafer"));
  assert.ok(render, "UI persists through render_leafer");
  assert.equal(render?.args.uiDesign, UI_MARKDOWN, "ui-design.md rides into the UI version content");
  assert.match(subagentCalls[1]?.prompt ?? "", /## ui-design（视觉意图——主驱动）[\s\S]*# 登录视觉稿提示/);
});

test("design.materialize keeps the legacy prompt and no uiDesign without pdDesign (zero regression)", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: RunSubagentOptions[] = [];
  const protoContent = "root = Column([login])";
  const ctx = makeCtx(
    {
      proto: {
        kind: "prototype",
        title: "登录 PRD",
        content: { spec: SPEC, openui: protoContent, requirement: "登录模块" },
      },
    },
    { generatedQueue: [LEAFER_DOC], mcpCalls, subagentCalls }
  );
  const result = await designMaterializeRun(
    { prototypeSuiteId: "proto", prototypeVersionId: "head-1", designSystemId: "dark-tech", requirement: "登录模块" },
    ctx
  );
  assert.ok(result.ok);
  assert.equal(subagentCalls.length, 1, "no ui-design stage on the legacy path");
  const prompt = subagentCalls[0]?.prompt ?? "";
  assert.ok(
    prompt.startsWith("Create a complete Leafer scene-tree JSON document for this requirement: 登录模块\n\n"),
    "legacy head preserved"
  );
  assert.ok(prompt.includes(LEAFER_CREATE_CONTRACT));
  assert.ok(
    prompt.includes(
      "Cover every page and flow in this OpenUI prototype as separate canvas frames (one Frame per page, " +
        "labeled with a Text node), preserving its information architecture and Action wiring as visual " +
        `annotations:\n\n${protoContent}`
    ),
    "legacy prototype-annotation body preserved"
  );
  assert.ok(
    prompt.endsWith(
      "Do not call tools. Return only the complete Leafer scene-tree JSON document in one json code fence."
    )
  );
  assert.ok(!prompt.includes("pd-design") && !prompt.includes("ui-design"), "no prompt-doc markers");
  const render = mcpCalls.find((call) => call.name.endsWith("render_leafer"));
  assert.equal(render?.args.uiDesign, undefined);
});

test("design.revise injects the ui-design context only when it exists", async () => {
  const uiSuite = {
    kind: "ui" as const,
    title: "Orders UI",
    content: {
      leafer: JSON.stringify({
        tag: "Leafer",
        width: 1440,
        height: 1024,
        fill: "#ffffff",
        children: [{ tag: "Rect", x: 24, y: 24, width: 200, height: 64, fill: "#4F46E5" }],
      }),
      uiDesign: UI_MARKDOWN,
    },
  };
  const subagentCalls: RunSubagentOptions[] = [];
  const ctx = makeCtx(
    { ui: uiSuite },
    { generatedQueue: [`\`\`\`json\n${uiSuite.content.leafer}\n\`\`\``], subagentCalls }
  );
  const result = await designReviseRun(
    { suiteId: "ui", versionId: "head-1", part: "design", target: "hero", instruction: "make it larger" },
    ctx
  );
  assert.ok(result.ok, `revise must succeed: ${result.ok ? "" : (result as { error?: string }).error}`);
  assert.match(
    subagentCalls[0]?.prompt ?? "",
    /Current ui-design visual intent \(from the prototype — keep it honored\)/
  );

  // 无 uiDesign → 注入块消失（字节回退到既有提示词）。
  const plain: FakeSuite = { ...uiSuite, content: { leafer: uiSuite.content.leafer } };
  const subagentCalls2: RunSubagentOptions[] = [];
  const ctx2 = makeCtx(
    { ui: plain },
    { generatedQueue: [`\`\`\`json\n${plain.content.leafer}\n\`\`\``], subagentCalls: subagentCalls2 }
  );
  const result2 = await designReviseRun(
    { suiteId: "ui", versionId: "head-1", part: "design", target: "hero", instruction: "make it larger" },
    ctx2
  );
  assert.ok(result2.ok);
  assert.ok(!(subagentCalls2[0]?.prompt ?? "").includes("ui-design visual intent"));
});
