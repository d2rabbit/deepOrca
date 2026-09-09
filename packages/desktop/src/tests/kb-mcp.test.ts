/**
 * KB MCP smoke tests — the generic knowledge-base server (kb-mcp.ts) over an
 * InMemoryTransport client, mirroring a2ui-design-suite's wiring. Verifies the
 * six tools register, return structured JSON from real stores, and surface
 * errors as isError results (agent-facing contract, user ask 2026-09-09:
 * 知识库不能是孤岛).
 */

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildKbServer } from "../main/tools/kb-mcp";
import { WIKI_STORE_DIR } from "@deeporca/core";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const dir = roots.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeProject(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-kb-mcp-")));
  roots.push(root);

  const wikiDir = path.join(root, WIKI_STORE_DIR);
  fs.mkdirSync(path.join(wikiDir, "modules"), { recursive: true });
  fs.writeFileSync(
    path.join(wikiDir, "architecture.md"),
    ["---", "title: 架构总览", "type: overview", "---", "", "# 架构总览", "", "分层架构：daemon → core → ui。"].join(
      "\n"
    )
  );
  fs.writeFileSync(
    path.join(wikiDir, "modules", "auth.md"),
    ["---", "title: 认证模块", "type: module", "---", "", "# 认证模块", "", "认证走 JWT。"].join("\n")
  );

  const protoDir = path.join(root, ".deeporca", "prototypes");
  fs.mkdirSync(protoDir, { recursive: true });
  // 内容重量线(>256B)是有意契约:夹具必须像真实产物一样有血肉。
  const ir = {
    schema_version: 1,
    diagram_type: "architecture",
    meta: {
      title: "示例架构",
      quality_profile: "showcase",
      views: [{ id: "main", label: "主链路", focus: ["a"], note: "外部输入 → 模块 A 处理" }],
    },
    layout: { rows: 1, cols: 1, caption: "示例系统的组件视图" },
    components: [
      {
        id: "a",
        type: "module",
        label: "模块 A",
        sublabel: "核心处理单元,负责解析外部输入并产出结构化事件流",
      },
    ],
    boundaries: [{ kind: "region", label: "进程边界", wraps: ["a"] }],
    connections: [{ id: "in-a", from: "a", to: "a", label: "自循环处理" }],
  };
  fs.writeFileSync(path.join(protoDir, "arch-demo.architecture.json"), JSON.stringify(ir));
  fs.writeFileSync(path.join(protoDir, "arch-demo.architecture.html"), "<html></html>");
  return root;
}

async function clientFor(root: string): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildKbServer(root).connect(serverTransport);
  const client = new Client({ name: "kb-mcp-test", version: "1" }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

function isTextContent(item: unknown): item is { type: "text"; text: string } {
  return (
    typeof item === "object" &&
    item !== null &&
    "type" in item &&
    item.type === "text" &&
    "text" in item &&
    typeof item.text === "string"
  );
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (Array.isArray(result.content) ? result.content : [])
    .filter(isTextContent)
    .map((item) => item.text)
    .join("\n");
}

function json<T = unknown>(result: Awaited<ReturnType<Client["callTool"]>>): T {
  return JSON.parse(text(result)) as T;
}

test("kb server registers the six exploration tools", async () => {
  const client = await clientFor(makeProject());
  try {
    const tools = await client.listTools();
    for (const name of [
      "kb_overview",
      "kb_list_pages",
      "kb_read_page",
      "kb_search_pages",
      "kb_list_diagrams",
      "kb_read_diagram",
    ]) {
      assert.ok(
        tools.tools.some((tool) => tool.name === name),
        `${name} registered`
      );
    }
  } finally {
    await client.close();
  }
});

test("overview / list / read / search round-trip against real stores", async () => {
  const client = await clientFor(makeProject());
  try {
    const overview = json<{ wiki: { pageCount: number }; diagrams: { count: number } }>(
      await client.callTool({ name: "kb_overview", arguments: {} })
    );
    assert.equal(overview.wiki.pageCount, 2);
    assert.equal(overview.diagrams.count, 1);

    const pages = json<Array<{ name: string }>>(await client.callTool({ name: "kb_list_pages", arguments: {} }));
    assert.ok(pages.some((page) => page.name === "modules/auth"));

    const page = json<{ meta: { title: string }; body: string; truncated: boolean }>(
      await client.callTool({ name: "kb_read_page", arguments: { name: "modules/auth" } })
    );
    assert.equal(page.meta.title, "认证模块");
    assert.ok(page.body.includes("JWT"));

    const sliced = json<{ truncated: boolean }>(
      await client.callTool({ name: "kb_read_page", arguments: { name: "architecture", limit: 5 } })
    );
    assert.equal(sliced.truncated, true);

    const hits = json<Array<{ page: string; text: string }>>(
      await client.callTool({ name: "kb_search_pages", arguments: { query: "jwt" } })
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].page, "modules/auth");

    const diagrams = json<Array<{ name: string; title: string; htmlDelivered: boolean }>>(
      await client.callTool({ name: "kb_list_diagrams", arguments: {} })
    );
    assert.equal(diagrams.length, 1);
    assert.equal(diagrams[0].title, "示例架构");
    assert.equal(diagrams[0].htmlDelivered, true);

    const diag = json<{ title: string; components: unknown[] }>(
      await client.callTool({ name: "kb_read_diagram", arguments: { name: "arch-demo.architecture" } })
    );
    assert.equal(diag.title, "示例架构");
    assert.equal(diag.components.length, 1);
  } finally {
    await client.close();
  }
});

test("escape attempts and bad names surface as isError results", async () => {
  const client = await clientFor(makeProject());
  try {
    const escape = await client.callTool({ name: "kb_read_page", arguments: { name: "../outside" } });
    assert.equal(escape.isError, true);
    assert.ok(text(escape).includes("escapes"));

    const missing = await client.callTool({
      name: "kb_read_diagram",
      arguments: { name: "arch-missing.architecture" },
    });
    assert.equal(missing.isError, true);
    assert.ok(text(missing).includes("no such diagram"));
  } finally {
    await client.close();
  }
});

test("an empty project returns empty inventories, never errors", async () => {
  const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-kb-mcp-empty-")));
  roots.push(empty);
  const client = await clientFor(empty);
  try {
    const overview = json<{ wiki: { present: boolean }; diagrams: { present: boolean } }>(
      await client.callTool({ name: "kb_overview", arguments: {} })
    );
    assert.equal(overview.wiki.present, false);
    assert.equal(overview.diagrams.present, false);
    const pages = await client.callTool({ name: "kb_list_pages", arguments: {} });
    assert.equal(pages.isError, undefined);
  } finally {
    await client.close();
  }
});
