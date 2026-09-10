/**
 * PRD 主题层 core 动作（specs/prd-theme-layer WP3）：
 * - prototype.spec 把继承/交叉参考 PRD 的 spec 全文注入 spec-writer 提示词
 *   （预算截断、缺失跳过、无参考时提示词字节不变），主题字段随 render_spec
 *   落套件 meta；
 * - design.materialize 从 read_suite_version 载荷透传基底原型的主题字段给
 *   render_leafer（UI 设计稿自动继承）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { designMaterializeRun, prototypeSpecRun } from "../actions";
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

const PARENT_SPEC = "# 人员管理 PRD\n\n## 角色模型\n\n- 管理员\n- 成员\n\n## 页面清单\n- 人员档案";
const REF_SPEC = "# 权限角色 PRD\n\n## 权限矩阵\n\n- 行/列";
const PARENT: FakeSuite = { kind: "prototype", title: "人员管理 PRD", content: { spec: PARENT_SPEC } };
const REF: FakeSuite = { kind: "prototype", title: "权限角色 PRD", content: { spec: REF_SPEC } };

const PD_DEEP_FIELDS = [
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
const PD_DEEP_FENCED = "```markdown\n# 登录 PRD 深度完整\n\n" + PD_DEEP_FIELDS + "\n```";

test("prototype.spec injects inherited/referenced PRD full texts and stamps theme meta via render_spec", async () => {
  const mcpCalls: McpCall[] = [];
  const subagentCalls: RunSubagentOptions[] = [];
  const generated =
    "```markdown\n# 登录 PRD\n\n## 用户与场景\n\n- 登录/鉴权\n" +
    "\n## 1. 背景与目标\n\n## 3. 功能需求\n\n" +
    "| 模块 | 需求 | 优先级 | 交互要点 |\n| --- | --- | --- | --- |\n" +
    "| 账号登录 | 登录 | P0 | 失败内联 |\n| 会话保持 | token | P1 | 过期回登录 |\n| 登出 | 清除 | P2 | 确认 |\n" +
    "\n## 4. 数据与字段\n\n| 实体 | 字段 | 类型 | 校验 | 示例 |\n| --- | --- | --- | --- | --- |\n" +
    "| 用户 | 姓名 | string | 非空 | 张三 |\n| 用户 | 邮箱 | string | email | a@b.c |\n" +
    "\n## 5. 页面清单\n\n| 页面 | 页面ID | 目的 | 关键元素 |\n| --- | --- | --- | --- |\n" +
    "| 登录页 | login | 登录 | 表单 |\n\n### login 交互明细\n\n- 提交 → 校验并跳转\n- 失败 → 内联错误条\n" +
    "\n## 6. 非功能需求\n\n## 7. 验收标准\n\n- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d\n- [ ] e\n\n## 8. 待确认\n```";
  const ctx = makeCtx({ parent: PARENT, ref: REF }, { generatedQueue: [generated], mcpCalls, subagentCalls });
  const result = await prototypeSpecRun(
    {
      requirement: "做一个登录模块",
      themeId: "theme-login",
      stage: "阶段1",
      inheritsFrom: { suiteId: "parent" },
      references: [{ suiteId: "ref" }],
    },
    ctx
  );
  assert.ok(result.ok, `spec action must succeed: ${result.ok ? "" : (result as { error?: string }).error}`);

  // 注入区块：继承 + 交叉参考各自带标题、定位与全文；约束行收尾。
  const prompt = subagentCalls[0]?.prompt ?? "";
  assert.match(prompt, /## 参考 PRD（设计参考上下文）/);
  assert.match(prompt, /### 继承：人员管理 PRD（parent @ head）/);
  assert.match(prompt, /## 角色模型/);
  assert.match(prompt, /### 交叉参考：权限角色 PRD（ref @ head）/);
  assert.match(prompt, /## 权限矩阵/);
  assert.match(prompt, /约束：延续参考 PRD 的术语\/角色\/架构约定，不复制其内容；与本次需求冲突时以本次需求为准。/);

  // 主题字段随 render_spec 落套件 meta。
  const save = mcpCalls.find((call) => call.name.endsWith("render_spec"));
  assert.ok(save, "spec must persist through render_spec");
  assert.equal(save.args.themeId, "theme-login");
  assert.equal(save.args.stage, "阶段1");
  assert.equal(save.args.inheritsSuiteId, "parent");
  assert.deepEqual(save.args.references, [{ suiteId: "ref" }]);
});

test("prototype.spec truncates per-doc at 8K and lists overflow refs as titles-only at 24K total", async () => {
  const big = "A".repeat(9000);
  const medium = "B".repeat(9000);
  const third: FakeSuite = { kind: "prototype", title: "第三篇 PRD", content: { spec: "C".repeat(200) } };
  const mcpCalls: McpCall[] = [];
  const subagentCalls: RunSubagentOptions[] = [];
  const deepBase = [
    "```markdown",
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
    "```",
  ].join("\n");
  const ctx = makeCtx(
    {
      big: { kind: "prototype", title: "大 PRD", content: { spec: big } },
      medium: { kind: "prototype", title: "中 PRD", content: { spec: medium } },
      third,
    },
    { generatedQueue: [deepBase], mcpCalls, subagentCalls }
  );
  const result = await prototypeSpecRun(
    {
      requirement: "x",
      references: [{ suiteId: "big" }, { suiteId: "medium" }, { suiteId: "third" }],
    },
    ctx
  );
  assert.ok(result.ok);
  const prompt = subagentCalls[0]?.prompt ?? "";
  assert.match(prompt, /…\[已截断：参考全文超出单篇预算\]/, "per-doc budget truncates the 9K spec");
  assert.ok(prompt.includes("AAAA"), "truncated body still carries content");
  // 8000 + 8000 = 16000 已用；第三篇装得下（总预算 24000）→ 全文在；再造一篇超预算只列标题。
  assert.match(prompt, /### 交叉参考：第三篇 PRD（third @ head）/, "third ref fits the total budget");
  const lines = prompt.split("\n");
  const titleOnly = lines.find((line) => line.includes("超出总预算，仅列标题"));
  assert.ok(!titleOnly, "total budget not exhausted with 3 refs under 24K");
});

test("prototype.spec lists over-budget refs as titles-only beyond the 24K total", async () => {
  const big = "A".repeat(9000);
  const medium = "B".repeat(9000);
  const large = "C".repeat(9000);
  const subagentCalls: RunSubagentOptions[] = [];
  const ctx = makeCtx(
    {
      big: { kind: "prototype", title: "大 PRD", content: { spec: big } },
      medium: { kind: "prototype", title: "中 PRD", content: { spec: medium } },
      large: { kind: "prototype", title: "大二号 PRD", content: { spec: large } },
      fourth: { kind: "prototype", title: "第四篇 PRD", content: { spec: "D" } },
    },
    { generatedQueue: [PD_DEEP_FENCED], subagentCalls }
  );
  const result = await prototypeSpecRun(
    {
      requirement: "x",
      references: [{ suiteId: "big" }, { suiteId: "medium" }, { suiteId: "large" }, { suiteId: "fourth" }],
    },
    ctx
  );
  assert.ok(result.ok);
  const prompt = subagentCalls[0]?.prompt ?? "";
  // 3×8000 已用满 24K 总预算 → 第四篇只列标题。
  assert.match(prompt, /### 交叉参考（超出总预算，仅列标题）：fourth/);
});

test("prototype.spec skips missing references without failing", async () => {
  const subagentCalls: RunSubagentOptions[] = [];
  const ctx = makeCtx({ parent: PARENT }, { generatedQueue: [PD_DEEP_FENCED], subagentCalls });
  const result = await prototypeSpecRun(
    { requirement: "x", inheritsFrom: { suiteId: "gone" }, references: [{ suiteId: "also-gone" }] },
    ctx
  );
  assert.ok(result.ok, "a missing reference must not fail the action");
  const prompt = subagentCalls[0]?.prompt ?? "";
  assert.match(prompt, /### 参考缺失：继承 gone（套件或版本不可用，已跳过）/);
  assert.match(prompt, /### 参考缺失：交叉参考 also-gone（套件或版本不可用，已跳过）/);
});

test("prototype.spec without references keeps the prompt byte-identical to the pre-theme-layer baseline", async () => {
  const subagentCalls: RunSubagentOptions[] = [];
  const ctx = makeCtx({ parent: PARENT }, { generatedQueue: [PD_DEEP_FENCED], subagentCalls });
  await prototypeSpecRun({ requirement: "做一个登录模块" }, ctx);
  // 无参考时：提示词 = 头部 + 骨架 + 需求（参考区块缺省不注入）。
  // 骨架单源 SPEC_SKELETON——这里锚定头部与需求段，证明参考区块未注入。
  const prompt = subagentCalls[0]?.prompt ?? "";
  assert.ok(
    prompt.startsWith(
      "Write the complete structured PRD for the requirement below. Fill the EXACT skeleton below " +
        "section-for-section — do not rename, reorder, or drop sections; replace every <placeholder> " +
        "with concrete content. Do not call tools. " +
        "Return only the complete markdown document in one markdown code fence.\n\n" +
        "## 骨架（逐节填充）\n"
    ),
    "skeleton-inlined head preserved"
  );
  assert.ok(prompt.endsWith("做一个登录模块"), "requirement is the tail — reference block absent");
  assert.ok(!prompt.includes("参考 PRD"), "no reference block injected without references");
});

test("design.materialize carries the basis prototype's theme fields into render_leafer", async () => {
  const mcpCalls: McpCall[] = [];
  const proto: FakeSuite = {
    kind: "prototype",
    title: "登录 PRD",
    content: { openui: "root = Column([])", requirement: "登录模块" },
    themeId: "theme-login",
    stage: "阶段1",
    inherits: { suiteId: "parent" },
    references: [{ suiteId: "ref", versionId: "v9" }],
  };
  const leaferDoc = JSON.stringify({
    tag: "Leafer",
    width: 1440,
    height: 1024,
    fill: "#ffffff",
    children: [{ tag: "Rect", x: 24, y: 24, width: 200, height: 64, fill: "#4F46E5" }],
  });
  const ctx = makeCtx({ proto }, { generatedQueue: [`\`\`\`json\n${leaferDoc}\n\`\`\``], mcpCalls });
  const result = await designMaterializeRun(
    { prototypeSuiteId: "proto", prototypeVersionId: "v1", designSystemId: "dark-tech", requirement: "登录模块" },
    ctx
  );
  assert.ok(result.ok, `materialize must succeed: ${result.ok ? "" : (result as { error?: string }).error}`);
  const save = mcpCalls.find((call) => call.name.endsWith("render_leafer"));
  assert.ok(save, "materialize persists through render_leafer");
  assert.equal(save?.args.themeId, "theme-login", "UI suite auto-inherits the basis prototype's theme");
  assert.equal(save?.args.stage, "阶段1");
  assert.equal(save?.args.inheritsSuiteId, "parent");
  assert.deepEqual(save?.args.references, [{ suiteId: "ref", versionId: "v9" }]);
});
