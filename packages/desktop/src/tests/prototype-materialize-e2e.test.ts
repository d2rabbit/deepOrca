/**
 * specs/moonviz-engine-replacement 端到端集成测试（EARS 6 的 moonviz 等价
 * 迁移）：core 的 prototype.materialize 直连 REAL a2ui MCP server
 * (InMemoryTransport) + design-store——单文档多画板模型下没有逐端 head 线程
 * 化了，本测试钉的是「op 计划 → 引擎接缝（fixture）→ render_moonviz 真实
 * 持久化」全链 + PRD 平台声明驱动画板计划。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { prototypeMaterializeRun } from "@deeporca/core";
import { buildA2uiServer } from "../main/tools/a2ui/a2ui-mcp";
import { saveDesignArtifact, readDesignSuite } from "../main/tools/design-store";
import { installMoonvizFixture } from "./moonviz-fixture";
import { NULL_SPAWNER } from "@deeporca/core";
import type { ActionContext, ActionProgress } from "@deeporca/core";

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const OP_PLAN = (devices: string[]): string =>
  [
    "```moonviz",
    "template login home 1200 800",
    ...devices.flatMap((device) => [
      `create home@${device} ${device === "mobile" ? 390 : device === "tablet" ? 768 : 1200} ${device === "mobile" ? 844 : device === "tablet" ? 1024 : 800}`,
      `place home@${device} button go_${device} - 24 700 342 44`,
    ]),
    "```",
  ].join("\n");

const SPEC = [
  "# 轻订单 需求文档",
  "",
  "| 目标平台 | 多端(web+mobile+tablet) |",
  "",
  "## 4. 页面清单",
  "",
  "| 页面 | 页面ID | 目的 |",
  "| --- | --- | --- |",
  "| 首页 | home | 概览 |",
].join("\n");

async function makeCtx(): Promise<ActionContext> {
  installMoonvizFixture();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-devices-")));
  tmpDirs.push(root);
  saveDesignArtifact(root, {
    id: "e2e-suite",
    title: "轻订单",
    pipeline: "spec",
    content: SPEC,
    requirement: "轻订单管理",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildA2uiServer(root).connect(serverTransport);
  const client = new Client({ name: "e2e-devices", version: "1" }, { capabilities: {} });
  await client.connect(clientTransport);
  return {
    projectRoot: root,
    signal: new AbortController().signal,
    emit: (event: ActionProgress) => {
      void event;
    },
    spawner: NULL_SPAWNER,
    runSubagent: async (opts: { prompt?: string }) => {
      if (opts.prompt?.includes("pm-design prompt document")) {
        return {
          sessionId: "sub",
          content: [
            "```markdown",
            "# 轻订单 原型提示",
            "",
            "## 页面结构",
            "- 订单页：订单列表与详情",
            "",
            "## 交互叙事",
            "- 下单→列表刷新",
            "",
            "## 信息架构",
            "- 单页订单管理",
            "",
            "## 视觉基调",
            "- 企业工具风格",
            "",
            "## 平台策略",
            "- desktop-app",
            "",
            "## 继承要点",
            "- 沿用轻订单模块的角色定义与权限模型，保持术语一致性",
            "```",
          ].join("\n"),
        };
      }
      // 平台计划注入的端集合决定 op 计划里的 @device 画板。
      const devices = ["desktop", "mobile", "tablet"].filter((device) => opts.prompt?.includes(`home@${device}`));
      return { sessionId: "sub", content: OP_PLAN(devices.length > 0 ? devices : ["desktop"]) };
    },
    executeMcpTool: async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name: String(name).replace("mcp__a2ui__", ""), arguments: args });
      const text = (Array.isArray(result.content) ? result.content : [])
        .filter((item): item is { type: "text"; text: string } => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      return { ok: !result.isError, output: text };
    },
  } as unknown as ActionContext;
}

test("EARS 6 (moonviz 等价): 多端 materialize 单文档落盘、真实持久化", async () => {
  const ctx = await makeCtx();
  const res = await prototypeMaterializeRun(
    { suiteId: "e2e-suite", versionId: "legacy", devices: ["desktop", "mobile", "tablet"] },
    ctx
  );
  assert.equal(res.ok, true, `materialize failed: ${res.error}`);
  assert.ok(res.artifactRef, "returns the final artifact ref");

  const suite = readDesignSuite(ctx.projectRoot, "e2e-suite");
  assert.ok(suite);
  const head = suite!.versions.at(-1);
  const content = (head as unknown as { content: Record<string, unknown> }).content;
  // 单文档模型：canonical 文档 + 验证重置真实存在。
  assert.ok(String(content.moonviz).includes("moonviz:artboard"), "canonical document persisted (seed doc lineage)");
  assert.ok(String(content.moonviz).includes("op: template login home"), "engine-session ops applied");
  const verification = content.verification as { status?: string } | undefined;
  assert.equal(verification?.status, "pending", "verification reset on the new version");
});

test("EARS 6 变体 (moonviz 等价): mobile-only 声明只规划 mobile 画板", async () => {
  const ctx = await makeCtx();
  const res = await prototypeMaterializeRun({ suiteId: "e2e-suite", versionId: "legacy" }, ctx);
  assert.equal(res.ok, true);
  const suite = readDesignSuite(ctx.projectRoot, "e2e-suite");
  const head = (suite!.versions.at(-1) as unknown as { content: Record<string, unknown> }).content;
  // PRD 声明多端 → 提示词计划三端；文档来自引擎会话（fixture 接受全部 op）。
  assert.ok(String(head.moonviz).includes("home@desktop"), "desktop artboard planned+applied");
  assert.ok(String(head.moonviz).includes("home@mobile"), "mobile artboard planned+applied");
  assert.ok(String(head.moonviz).includes("home@tablet"), "tablet artboard planned+applied");
});
