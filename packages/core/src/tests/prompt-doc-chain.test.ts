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
  prototypeSpecRun,
  specSectionsAudit,
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
  options: {
    generatedQueue?: string[];
    mcpCalls?: McpCall[];
    subagentCalls?: RunSubagentOptions[];
    emits?: Array<{ data?: unknown }>;
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
  const emits: Array<{ data?: unknown }> = [];
  const ctx = makeCtx(
    { proto: { kind: "prototype", title: "登录 PRD", content: { spec: SPEC, requirement: "登录模块" } } },
    { generatedQueue: [PD_DOC, OPENUI], mcpCalls, subagentCalls, emits }
  );
  const result = await prototypeMaterializeRun({ suiteId: "proto", versionId: "head-1" }, ctx);
  assert.ok(result.ok, `materialize must succeed: ${result.ok ? "" : (result as { error?: string }).error}`);
  // 子代理顺序：stage0（deep-design 蒸馏）→ pm-designer（原型化）。
  assert.equal(subagentCalls.length, 2);
  assert.match(subagentCalls[0]?.prompt ?? "", /pd-design prompt document/);
  const save = mcpCalls.find((call) => call.name.endsWith("save_pd_design"));
  assert.ok(save, "stage0 persists pd-design before the device loop");
  // 交叉审查修复锚点：stage0 保存走 preserveDerived（生成失败/取消不抹既有
  // 原型）；自动路径同样发射 saved 终态码。
  assert.equal(save?.args.preserveDerived, true, "stage0 save must preserve derived artifacts");
  const codes = emits.map((event) => (event.data as { code?: string } | undefined)?.code);
  assert.deepEqual(codes, [
    "prototype.pddesign.generating",
    "prototype.pddesign.saved",
    "prototype.materialize.generating",
    "prototype.materialize.saved",
  ]);
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
  // 遵守契约（2026-09-11 强化）替换了旧的 "Cover its page list" 行——legacy
  // 路径同样要求逐页/P0/三态点名。
  assert.ok(prompt.includes("PRD compliance is non-negotiable"));
  assert.ok(prompt.includes("EVERY page in the 页面清单"));
  assert.ok(prompt.endsWith(`Return only the OpenUI Lang program in one code fence.\n\n${SPEC}`));
  // legacy 路径不注入 pd-design 主驱动区块（遵守契约文本提到 页面清单/pd-design
  // 字样属正常——没有文档区块才是 legacy 语义）。
  assert.ok(!prompt.includes("## pd-design"), "no pd-design document block on the legacy path");
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

test("design.materialize emits uidesign.saved only after render_leafer persists (cross-review fix)", async () => {
  const mcpCalls: McpCall[] = [];
  const emits: Array<{ data?: unknown }> = [];
  // 蒸馏成功但画布输出非法 → 失败路径：不得出现 uidesign.saved。
  const ctx = makeCtx(
    {
      proto: {
        kind: "prototype",
        title: "登录 PRD",
        content: { spec: SPEC, openui: "root = Column([])", pdDesign: PD_MARKDOWN, requirement: "登录模块" },
      },
    },
    { generatedQueue: [UI_DOC, '```json\n{"tag": "Broken"}\n```'], mcpCalls, emits }
  );
  const result = await designMaterializeRun(
    { prototypeSuiteId: "proto", prototypeVersionId: "head-1", designSystemId: "dark-tech", requirement: "登录模块" },
    ctx
  );
  assert.equal(result.ok, false, "canvas generation fails on the invalid document");
  const codes = emits.map((event) => (event.data as { code?: string } | undefined)?.code);
  assert.ok(codes.includes("design.uidesign.generating"), "distill stage ran");
  assert.ok(!codes.includes("design.uidesign.saved"), "saved must NOT fire when persistence never happened");
  assert.ok(!mcpCalls.some((call) => call.name.endsWith("render_leafer")));
});

test("basis switch without pdDesign clears the stale uiDesign (explicit empty-string semantics)", async () => {
  const mcpCalls: McpCall[] = [];
  // 新基底无 pdDesign + 追加到既有 UI 套件（suiteId/versionId）→ uiDesign
  // 必须以空串显式清除，旧基底的视觉意图不得残留。
  const ctx = makeCtx(
    {
      proto: {
        kind: "prototype",
        title: "新基底 PRD",
        content: { spec: SPEC, openui: "root = Column([])", requirement: "x" },
      },
    },
    { generatedQueue: [LEAFER_DOC], mcpCalls }
  );
  const result = await designMaterializeRun(
    {
      prototypeSuiteId: "proto",
      prototypeVersionId: "head-1",
      designSystemId: "dark-tech",
      suiteId: "ui-existing",
      versionId: "ui-v1",
      requirement: "x",
    },
    ctx
  );
  assert.ok(result.ok, `materialize must succeed: ${result.ok ? "" : (result as { error?: string }).error}`);
  const render = mcpCalls.find((call) => call.name.endsWith("render_leafer"));
  assert.equal(render?.args.uiDesign, "", "append without a distilled ui-design passes the explicit clear");
});

test("reference block hard-caps overflow title lines (cross-review fix)", async () => {
  const subagentCalls: RunSubagentOptions[] = [];
  const suites: Record<string, FakeSuite> = {
    big: { kind: "prototype", title: "大 PRD", content: { spec: "A".repeat(9000) } },
    medium: { kind: "prototype", title: "中 PRD", content: { spec: "B".repeat(9000) } },
    large: { kind: "prototype", title: "大二号 PRD", content: { spec: "C".repeat(9000) } },
  };
  for (let i = 0; i < 40; i += 1) {
    suites[`ref-${i}`] = { kind: "prototype", title: `参考 ${i}`, content: { spec: "D" } };
  }
  // 队列尾用深度完整文档——深度门放行，本测试钉的是参考区块溢出钳制。
  const deepDoc = `\`\`\`markdown\n${PD_DEEP}\n\`\`\``;
  const ctx = makeCtx(suites, { generatedQueue: [deepDoc], subagentCalls });
  const result = await prototypeSpecRun(
    {
      requirement: "x",
      references: [
        { suiteId: "big" },
        { suiteId: "medium" },
        { suiteId: "large" },
        ...Array.from({ length: 40 }, (_, i) => ({ suiteId: `ref-${i}` })),
      ],
    },
    ctx
  );
  assert.ok(result.ok);
  const prompt = subagentCalls[0]?.prompt ?? "";
  const overflowLines = prompt.split("\n").filter((line) => line.includes("超出总预算，仅列标题"));
  assert.equal(overflowLines.length, 20, "overflow title lines hard-capped at 20");
  assert.ok(prompt.includes("另有 20 条参考超出预算，已省略"), "remaining refs collapse into one omission line");
});

// ── PRD 深度机械门（交叉审查：历次契约强化失效根因——无机械执行）──────────────

test("specSectionsAudit: complete deep PRD passes with zero findings", async () => {
  const { specSectionsAudit } = await import("../actions");
  const deep = [
    "# 登录 PRD",
    "",
    "## 1. 背景与目标",
    "",
    "## 2. 用户与场景",
    "",
    "## 3. 功能需求",
    "",
    "| 模块 | 需求 | 优先级 | 交互要点 |",
    "| --- | --- | --- | --- |",
    "| 账号登录 | 账号密码登录 | P0 | 失败内联提示 |",
    "| 会话保持 | token 存储 | P1 | 过期回登录 |",
    "| 登出 | 清除会话 | P2 | 确认弹窗 |",
    "",
    "## 4. 数据与字段",
    "",
    "| 实体 | 字段 | 类型 | 校验 | 示例 |",
    "| --- | --- | --- | --- | --- |",
    "| 用户 | 姓名 | string | 非空 | 张三 |",
    "| 用户 | 邮箱 | string | email 格式 | a@b.c |",
    "",
    "## 5. 页面清单",
    "",
    "| 页面 | 页面ID | 目的 | 关键元素 |",
    "| --- | --- | --- | --- |",
    "| 登录页 | login | 登录 | 表单 |",
    "",
    "### login 交互明细",
    "",
    "- 提交 → 校验并跳转",
    "- 失败 → 内联错误条",
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
  ].join("\n");
  assert.deepEqual(specSectionsAudit(deep), [], "complete deep PRD has zero findings");
});

test("specSectionsAudit: thin PRD produces specific findings per missing depth", async () => {
  const { specSectionsAudit } = await import("../actions");
  const thin = "# 登录\n\n## 功能需求\n\n- 支持登录\n\n## 验收标准\n\n- [ ] 能登录";
  const findings = specSectionsAudit(thin);
  assert.ok(
    findings.some((f) => f.includes("背景与目标")),
    "missing sections flagged"
  );
  assert.ok(
    findings.some((f) => f.includes("数据与字段")),
    "missing entity table flagged"
  );
  assert.ok(
    findings.some((f) => f.includes("页面清单")),
    "missing page list flagged"
  );
  assert.ok(
    findings.some((f) => f.includes("验收标准")),
    "thin acceptance flagged"
  );
});

test("prototype.spec runs the depth-gate repair round with findings (cross-review)", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: RunSubagentOptions[] = [];
  const thin = "```markdown\n# 登录 PRD\n\n## 功能需求\n\n- 支持登录\n```";
  const deep = `\`\`\`markdown\n${PD_DEEP}\n\`\`\``;
  const ctx = makeCtx({}, { generatedQueue: [thin, deep], mcpCalls, subagentCalls });
  const result = await prototypeSpecRun({ requirement: "登录模块" }, ctx);
  assert.ok(result.ok, `spec must succeed after repair: ${result.ok ? "" : (result as { error?: string }).error}`);
  // 两轮子代理：首轮薄文档 → 深度门拦截 → 携 findings 修复。
  assert.equal(subagentCalls.length, 2);
  assert.match(subagentCalls[1]?.prompt ?? "", /FAILED the depth audit/);
  assert.match(subagentCalls[1]?.prompt ?? "", /缺少「背景与目标」节/);
  const save = mcpCalls.find((call) => call.name.endsWith("render_spec"));
  assert.match(String(save?.args.document ?? ""), /# 登录 PRD 深度完整/);
});

test("prototype.spec inlines the skeleton in the first-round prompt", async () => {
  const subagentCalls: RunSubagentOptions[] = [];
  const ctx = makeCtx(
    {},
    {
      generatedQueue: [
        "```markdown\n# X\n```",
        "```markdown\n# X 深度版\n\n## 页面清单\n\n### p 交互明细\n\n- a → b\n- c → d\n```",
      ],
      subagentCalls,
    }
  );
  await prototypeSpecRun({ requirement: "登录模块" }, ctx);
  const prompt = subagentCalls[0]?.prompt ?? "";
  assert.match(prompt, /## 骨架（逐节填充）/);
  assert.match(prompt, /逐页交互明细/);
  assert.match(prompt, /数据与字段/);
});

const PD_DEEP = [
  "# 登录 PRD 深度完整",
  "",
  "## 1. 背景与目标",
  "",
  "## 2. 用户与场景",
  "",
  "## 3. 功能需求",
  "",
  "| 模块 | 需求 | 优先级 | 交互要点 |",
  "| --- | --- | --- | --- |",
  "| 账号登录 | 登录 | P0 | 失败内联 |",
  "| 会话保持 | token | P1 | 过期回登录 |",
  "| 登出 | 清除 | P2 | 确认 |",
  "",
  "## 4. 数据与字段",
  "",
  "| 实体 | 字段 | 类型 | 校验 | 示例 |",
  "| --- | --- | --- | --- | --- |",
  "| 用户 | 姓名 | string | 非空 | 张三 |",
  "| 用户 | 邮箱 | string | email | a@b.c |",
  "",
  "## 5. 页面清单",
  "",
  "| 页面 | 页面ID | 目的 | 关键元素 |",
  "| --- | --- | --- | --- |",
  "| 登录页 | login | 登录 | 表单 |",
  "",
  "### login 交互明细",
  "",
  "- 提交 → 校验并跳转",
  "- 失败 → 内联错误条",
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
].join("\n");
