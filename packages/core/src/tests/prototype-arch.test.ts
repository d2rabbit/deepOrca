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

const ARCH_DOC = [
  "# 番茄钟 技术架构文档",
  "",
  "## 1. 技术选型",
  "",
  "| 层次 | 选型 |",
  "| --- | --- |",
  "| 前端 | OpenUI Lang |",
  "",
  "## 2. 系统架构",
  "",
  "```mermaid",
  "graph TB",
  "  subgraph 用户层",
  "    ui[计时器界面]",
  "  end",
  "```",
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
  assert.match(res.error ?? "", /diagram-less/);
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
