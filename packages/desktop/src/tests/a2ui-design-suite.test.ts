import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildA2uiServer } from "../main/tools/a2ui/a2ui-mcp";
import { listDesignArtifacts, readDesignSuite } from "../main/tools/design-store";
import type { PrototypeSuiteContent } from "../main/tools/design-store";

const roots: string[] = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

async function clientFor(root: string): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildA2uiServer(root).connect(serverTransport);
  const client = new Client({ name: "a2ui-suite-test", version: "1" }, { capabilities: {} });
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

test("design tools expose suite lineage fields and helper tools", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-suite-schema-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const tools = await client.listTools();
    for (const name of ["render_spec", "render_openui", "update_openui", "render_design", "update_design"]) {
      const tool = tools.tools.find((item) => item.name === name);
      assert.ok(tool, name);
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      for (const field of ["suiteId", "versionId", "note", "sourcePrototype", "designSystemId"]) {
        assert.ok(field in properties, `${name} missing ${field}`);
      }
    }
    assert.ok(tools.tools.some((tool) => tool.name === "read_suite_version"));
    assert.ok(tools.tools.some((tool) => tool.name === "save_suite_result"));
  } finally {
    await client.close();
  }
});

test("explicit suite writes append versions and reset stale prototype state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-suite-write-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const first = await client.callTool({
      name: "render_spec",
      arguments: {
        document: "# Tasks\n\n## Page list\n- Board",
        requirement: "Task board",
        note: "initial",
      },
    });
    const firstMatch = text(first).match(/ArtifactRef:\s*(\{[^\n]+\})/);
    assert.ok(firstMatch);
    const ref = JSON.parse(firstMatch[1]) as { suiteId: string; versionId: string; kind: string };
    assert.equal(ref.kind, "prototype");

    const materialized = await client.callTool({
      name: "render_openui",
      arguments: { code: "root = Column([board])\nboard = Card([])", suiteId: ref.suiteId, versionId: ref.versionId },
    });
    const nextMatch = text(materialized).match(/ArtifactRef:\s*(\{[^\n]+\})/);
    assert.ok(nextMatch);
    const next = JSON.parse(nextMatch[1]) as { versionId: string };
    const suite = readDesignSuite(root, ref.suiteId);
    assert.equal(suite?.versions.length, 2);
    assert.equal((suite?.currentContent as PrototypeSuiteContent).verification?.status, "pending");

    await client.callTool({
      name: "render_spec",
      arguments: {
        document: "# Tasks v2\n\n## Page list\n- Board\n- Detail",
        suiteId: ref.suiteId,
        versionId: next.versionId,
      },
    });
    const revised = readDesignSuite(root, ref.suiteId);
    assert.equal((revised?.currentContent as PrototypeSuiteContent).openui, undefined);
    assert.equal((revised?.currentContent as PrototypeSuiteContent).verification?.status, "pending");
  } finally {
    await client.close();
  }
});

test("calls without suite metadata retain legacy artifact persistence", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-legacy-write-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const result = await client.callTool({ name: "render_openui", arguments: { code: "root = Column([])" } });
    assert.doesNotMatch(text(result), /ArtifactRef:/);
    assert.equal(listDesignArtifacts(root).length, 1);
    assert.equal(listDesignArtifacts(root)[0].pipeline, "openui");
  } finally {
    await client.close();
  }
});
