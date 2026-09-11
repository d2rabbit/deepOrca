/**
 * prototype.arch (技术架构模块, user ask 2026-09-08) — derives the technical
 * architecture document from an APPROVED prototype suite version. Pins:
 *   - verification must have passed BEFORE generation (验收成功之后才可生成),
 *   - the arch-writer output must carry a Mermaid diagram (标准化格式契约),
 *     otherwise it is rejected before persistence,
 *   - a valid document persists through save_suite_arch against the same
 *     version and returns the new head as the artifact ref.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { prototypeArchRun, looksLikeArchDoc } from "../actions/prototype";
import { NULL_SPAWNER } from "../actions/types";
import type { ActionContext, ActionProgress } from "../actions/types";

const REF = { suiteId: "arch-suite", versionId: "arch-v1", kind: "prototype" as const };

const tmpDirs: string[] = [];

after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// specs/design-stage-gates：架构门升级为七节 + erDiagram + 表行门槛——
// fixture 同步升级为合规文档（占位行不计数，全部为真实内容行）。
const ARCH_DOC = [
  "# 番茄钟 技术架构文档",
  "",
  "## 1. 技术选型",
  "",
  "| 层次 | 选型 | 理由 |",
  "| --- | --- | --- |",
  "| 前端 | OpenUI Lang | 原型栈 |",
  "| 状态 | 内存会话 | 轻量 |",
  "| 存储 | localStorage | 持久 |",
  "",
  "## 2. 系统架构",
  "",
  "```mermaid",
  "graph TB",
  "  subgraph 用户层",
  "    ui[计时器界面]",
  "  end",
  "```",
  "",
  "## 3. 数据模型",
  "",
  "```mermaid",
  "erDiagram",
  "  TASK ||--o{ SESSION : has",
  "```",
  "",
  "## 4. 核心流程",
  "",
  "```mermaid",
  "sequenceDiagram",
  "  U->>S: start",
  "```",
  "",
  "## 5. 模块拆分",
  "",
  "| 模块 | 职责 | 依赖 |",
  "| --- | --- | --- |",
  "| timer | 计时 | core |",
  "| stats | 统计 | timer |",
  "| store | 存储 | stats |",
  "",
  "## 6. 非功能设计",
  "",
  "| 类别 | 设计 | 度量 |",
  "| --- | --- | --- |",
  "| 性能 | 零依赖渲染 | 60fps |",
  "",
  "## 7. 风险与对策",
  "",
  "| 风险 | 影响 | 对策 |",
  "| --- | --- | --- |",
  "| 后台节流 | 计时漂移 | 时间戳校正 |",
  "| 数据丢失 | 历史清空 | 云同步 |",
].join("\n");

type McpCall = { name: string; args: Record<string, unknown> };

function makeCtx(options: { verification?: unknown; generated?: string; mcpCalls?: McpCall[] } = {}): ActionContext {
  const mcpCalls = options.mcpCalls ?? [];
  return {
    projectRoot: (() => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-action-"));
      tmpDirs.push(dir);
      return dir;
    })(),
    signal: new AbortController().signal,
    emit: (event: ActionProgress) => {
      void event;
    },
    spawner: NULL_SPAWNER,
    runSubagent: async () => ({
      sessionId: "sub",
      // Models wrap the document in a ```markdown fence; the doc itself nests
      // ```mermaid fences — the wrapper must be unwrapped, not truncated.
      content: options.generated ?? "```markdown\n" + ARCH_DOC + "\n```",
    }),
    executeMcpTool: async (name, args) => {
      mcpCalls.push({ name, args });
      if (name.endsWith("read_suite_version")) {
        return {
          ok: true,
          output: JSON.stringify({
            artifactRef: REF,
            title: "Suite",
            status: "ready",
            content: {
              requirement: "番茄钟",
              spec: "# 极简番茄钟 需求文档",
              openui: 'root = Text("x")',
              verification: options.verification,
            },
          }),
        };
      }
      return { ok: true, output: `saved\nArtifactRef: ${JSON.stringify({ ...REF, versionId: "arch-v2" })}` };
    },
  } as unknown as ActionContext;
}

test("prototype.arch: refuses to run before verification passed (验收成功之后才生成)", async () => {
  const mcpCalls: McpCall[] = [];
  const res = await prototypeArchRun({ suiteId: REF.suiteId, versionId: REF.versionId }, makeCtx({ mcpCalls }));
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /verification must pass/);
  assert.equal(mcpCalls.filter((c) => c.name.endsWith("save_suite_arch")).length, 0, "must not persist");
});

test("prototype.arch: diagram-less output is rejected before persistence (标准化格式契约)", async () => {
  const mcpCalls: McpCall[] = [];
  const res = await prototypeArchRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({
      verification: { status: "passed", checks: [], generatedAt: "2026-09-08T00:00:00.000Z" },
      generated: "```markdown\n# 架构文档\n\n正文没有图。\n```",
      mcpCalls,
    })
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /prototype\.arch/);
  assert.equal(mcpCalls.filter((c) => c.name.endsWith("save_suite_arch")).length, 0);
});

test("prototype.arch: valid document persists via save_suite_arch and returns the new head", async () => {
  const mcpCalls: McpCall[] = [];
  const res = await prototypeArchRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({
      verification: { status: "passed", checks: [], generatedAt: "2026-09-08T00:00:00.000Z" },
      mcpCalls,
    })
  );
  assert.equal(res.ok, true);
  const ref = (res as { artifactRef?: { versionId?: string } }).artifactRef;
  assert.equal(ref?.versionId, "arch-v2");
  const arch = mcpCalls.find((c) => c.name.endsWith("save_suite_arch"));
  assert.ok(arch, "save_suite_arch must be called");
  assert.equal(arch.args.versionId, REF.versionId);
  assert.match(arch.args.document as string, /```mermaid/);
});

test("looksLikeArchDoc: heading + mermaid fence required", () => {
  assert.equal(looksLikeArchDoc("# 架构\n\n正文"), false);
  assert.equal(looksLikeArchDoc("# 架构\n\n```mermaid\ngraph TB\n```\n"), true);
});

// ── extractMarkdownDocument truncation regressions (review 2026-09-09) ──────

/** Two diagrams: truncation at the SECOND one keeps the first complete, so a
 *  salvaging extractor still passes looksLikeArchDoc on the half document. */
const TWO_DIAGRAM_DOC = [
  "# 番茄钟 技术架构文档",
  "",
  "## 2. 系统架构",
  "",
  "```mermaid",
  "graph TB",
  "  ui[界面]",
  "```",
  "",
  "## 3. 数据模型",
  "",
  "```mermaid",
  "erDiagram",
  "  TASK ||--o{ SESSION : has",
  "```",
].join("\n");

const PASSED = { verification: { status: "passed", checks: [], generatedAt: "2026-09-08T00:00:00.000Z" } };

test("prototype.arch: prose before the wrapper fence must not route into the lazy extractor (导语)", async () => {
  const mcpCalls: McpCall[] = [];
  const res = await prototypeArchRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({ ...PASSED, generated: "好的，以下是技术架构文档：\n\n```markdown\n" + ARCH_DOC + "\n```", mcpCalls })
  );
  assert.equal(res.ok, true);
  const arch = mcpCalls.find((c) => c.name.endsWith("save_suite_arch"));
  assert.equal(arch?.args.document, ARCH_DOC, "full document extracted, not truncated at the first inner fence");
});

test("prototype.arch: wrapped output truncated mid-inner-fence is refused despite an even fence count", async () => {
  const mcpCalls: McpCall[] = [];
  // Outer opener + unclosed inner opener = 2 line-anchored fences (even) —
  // the old parity check salvaged the half document (diagram 1 carried it
  // through looksLikeArchDoc). The last fence must be a bare closing ```.
  const truncated = "```markdown\n" + TWO_DIAGRAM_DOC.slice(0, TWO_DIAGRAM_DOC.lastIndexOf("```"));
  const res = await prototypeArchRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({ ...PASSED, generated: truncated, mcpCalls })
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /prototype\.arch/);
  assert.equal(mcpCalls.filter((c) => c.name.endsWith("save_suite_arch")).length, 0);
});

test("prototype.arch: bare markdown truncated mid-mermaid is refused (旧 extractGeneratedBody 防线不得回归)", async () => {
  const mcpCalls: McpCall[] = [];
  // extractGeneratedBody refuses opened-but-never-closed output; the bare
  // branch of the nested extractor must not quietly reopen that hole.
  const truncated = TWO_DIAGRAM_DOC.slice(0, TWO_DIAGRAM_DOC.lastIndexOf("```"));
  const res = await prototypeArchRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({ ...PASSED, generated: truncated, mcpCalls })
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /prototype\.arch/);
  assert.equal(mcpCalls.filter((c) => c.name.endsWith("save_suite_arch")).length, 0);
});

test("prototype.arch: wrapped output truncated after an inner close is refused (奇偶守卫与裸闭合判定并用)", async () => {
  const mcpCalls: McpCall[] = [];
  // Outer opener + ONE complete inner pair = 3 line-anchored fences with the
  // last fence a bare closer. The bare-closer check alone salvages the prefix
  // (heading + complete diagram → passes looksLikeArchDoc); the parity guard
  // is what refuses this window. Both checks must stay combined.
  const truncated =
    "```markdown\n" +
    [
      "# 番茄钟 技术架构文档",
      "",
      "## 2. 系统架构",
      "",
      "```mermaid",
      "graph TB",
      "  ui[界面]",
      "```",
      "",
      "## 3. 数据模型",
    ].join("\n");
  const res = await prototypeArchRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({ ...PASSED, generated: truncated, mcpCalls })
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /prototype\.arch/);
  assert.equal(mcpCalls.filter((c) => c.name.endsWith("save_suite_arch")).length, 0);
});

test("prototype.arch: an inline ``` mention after the wrapper closer must not pollute the body", async () => {
  const mcpCalls: McpCall[] = [];
  const res = await prototypeArchRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({
      ...PASSED,
      generated: "```markdown\n" + ARCH_DOC + "\n```\n\n图请用 ```mermaid 围栏。",
      mcpCalls,
    })
  );
  assert.equal(res.ok, true);
  const arch = mcpCalls.find((c) => c.name.endsWith("save_suite_arch"));
  assert.equal(arch?.args.document, ARCH_DOC, "closer search is line-anchored; the trailing note is dropped");
});

test("prototype.arch: a complete bare markdown document (no wrapper) persists in full", async () => {
  const mcpCalls: McpCall[] = [];
  // The bare branch must stay alive: heading-first output with inner mermaid
  // fences is the off-wrapper fallback shape and used to be returned whole.
  // specs/design-stage-gates：改用七节合规文档——裸形态与深度门叠加验证。
  const res = await prototypeArchRun(
    { suiteId: REF.suiteId, versionId: REF.versionId },
    makeCtx({ ...PASSED, generated: ARCH_DOC, mcpCalls })
  );
  assert.equal(res.ok, true);
  const arch = mcpCalls.find((c) => c.name.endsWith("save_suite_arch"));
  assert.equal(arch?.args.document, ARCH_DOC, "bare documents are returned whole, never re-extracted");
});

test("looksLikeArchDoc: an inline ```mermaid mention is not a diagram", () => {
  assert.equal(looksLikeArchDoc("# 架构\n\n图表一律 ```mermaid 围栏，不用 ASCII 伪图。"), false);
});
