/**
 * render_openui / update_openui 平台变体分流(user ask 2026-09-09:三端是
 * 平台化适配,不是同一程序挤宽度)。Pins: desktop(缺省)写本体 openui;
 * mobile/tablet 写 openuiVariants[device];spec 重写时三端变体随本体一起失效。
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildA2uiServer } from "../main/tools/a2ui/a2ui-mcp";
import { saveDesignArtifact, readDesignSuite } from "../main/tools/design-store";

const tmpDirs: string[] = [];
let root: string;
let client: Client;

const PROGRAM = 'root = Stack([TextContent("x")])';

before(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-device-variant-")));
  tmpDirs.push(root);
  // 一个 prototype suite(带 spec 的 v1 head),render_openui 走 suite 追加。
  saveDesignArtifact(root, {
    id: "proto-suite",
    title: "轻订单管理",
    pipeline: "spec",
    content: "spec-v1",
    requirement: "订单管理",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildA2uiServer(root).connect(serverTransport);
  client = new Client({ name: "device-variant-test", version: "1" }, { capabilities: {} });
  await client.connect(clientTransport);
});

after(async () => {
  await client.close();
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function contentOf(suite: ReturnType<typeof readDesignSuite>): Record<string, unknown> {
  const version = suite?.versions.at(-1);
  return ((version as unknown as { content?: Record<string, unknown> })?.content ?? {}) as Record<string, unknown>;
}

async function renderWithDevice(device?: string): Promise<void> {
  const result = await client.callTool({
    name: "render_openui",
    arguments: {
      code: PROGRAM,
      suiteId: "proto-suite",
      versionId: readDesignSuite(root, "proto-suite")?.currentVersionId,
      ...(device ? { device } : {}),
    },
  });
  assert.equal(result.isError, undefined, "render must not error");
}

test("desktop 写本体,mobile/tablet 写平台变体,spec 重写三端一起失效", async () => {
  await renderWithDevice(); // 缺省 = desktop 本体
  let content = contentOf(readDesignSuite(root, "proto-suite"));
  assert.equal(content.openui, PROGRAM, "desktop 写本体 openui");
  assert.equal(content.openuiVariants, undefined, "desktop 不产生变体");

  await renderWithDevice("mobile");
  content = contentOf(readDesignSuite(root, "proto-suite"));
  assert.equal((content.openuiVariants as Record<string, string> | undefined)?.mobile, PROGRAM, "mobile 落变体");
  assert.equal(content.openui, PROGRAM, "本体保持桌面版不动");

  await renderWithDevice("tablet");
  content = contentOf(readDesignSuite(root, "proto-suite"));
  assert.equal((content.openuiVariants as Record<string, string> | undefined)?.tablet, PROGRAM, "tablet 落变体");
});
