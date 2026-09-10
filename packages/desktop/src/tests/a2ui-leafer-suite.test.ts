/**
 * render_leafer — the UI-Design leafer stack's suite persistence channel
 * (specs/leafer-ui-engine): creates/ui-suites with content.leafer, never
 * mixes content.openui, validates the document at the boundary, and projects
 * design.leafer.json beside the suite.
 */

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildA2uiServer } from "../main/tools/a2ui/a2ui-mcp";
import { readDesignSuite } from "../main/tools/design-store";
import type { UiSuiteContent } from "../main/tools/design-store";

const roots: string[] = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

async function clientFor(root: string): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildA2uiServer(root).connect(serverTransport);
  const client = new Client({ name: "a2ui-leafer-test", version: "1" }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

const DESIGN = JSON.stringify({
  tag: "Leafer",
  width: 1440,
  height: 1024,
  fill: "#ffffff",
  children: [{ tag: "Rect", x: 24, y: 24, width: 200, height: 64, fill: "#4F46E5" }],
});

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (Array.isArray(result.content) ? result.content : [])
    .filter((item) => typeof item === "object" && item !== null && (item as { type?: unknown }).type === "text")
    .map((item) => (item as { text: string }).text)
    .join("\n");
}

function refOf(result: Awaited<ReturnType<Client["callTool"]>>): { suiteId: string; versionId: string } {
  const metadata = (result as { metadata?: { artifactRef?: { suiteId: string; versionId: string } } }).metadata;
  assert.ok(metadata?.artifactRef, "tool result must carry an artifactRef");
  return metadata.artifactRef;
}

test("render_leafer creates a ui suite version with content.leafer and the json projection", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-leafer-create-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const result = await client.callTool({
      name: "render_leafer",
      arguments: { leafer: DESIGN, requirement: "Analytics dashboard", designSystemId: "dark-tech" },
    });
    assert.ok(!result.isError, textOf(result));
    const ref = refOf(result);
    const suite = readDesignSuite(root, ref.suiteId);
    assert.ok(suite, "suite persisted");
    assert.equal(suite.kind, "ui");
    const content = suite.currentVersion.content as UiSuiteContent;
    assert.equal(content.leafer, DESIGN);
    assert.equal(content.openui, undefined, "leafer versions never carry the legacy openui field");
    assert.equal(content.designSystemId, "dark-tech");
    const projection = path.join(root, ".deeporca", "designs", ref.suiteId, "design.leafer.json");
    assert.ok(fs.existsSync(projection), "design.leafer.json projection written");
    assert.deepEqual(JSON.parse(fs.readFileSync(projection, "utf8")), JSON.parse(DESIGN));
  } finally {
    await client.close();
  }
});

test("render_leafer appends a new head version and refuses prototype suites", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-leafer-append-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const first = await client.callTool({
      name: "render_leafer",
      arguments: { leafer: DESIGN, requirement: "Dashboard", designSystemId: "dark-tech" },
    });
    const ref = refOf(first);
    const revised = JSON.parse(DESIGN) as { children: unknown[] };
    revised.children.push({ tag: "Text", x: 10, y: 10, text: "KPI" });
    const second = await client.callTool({
      name: "render_leafer",
      arguments: { leafer: JSON.stringify(revised), suiteId: ref.suiteId, versionId: ref.versionId, note: "add KPI" },
    });
    assert.ok(!second.isError, textOf(second));
    const suite = readDesignSuite(root, ref.suiteId);
    assert.equal(suite?.versions.length, 2, "append created a new version");
    assert.equal((suite?.currentVersion.content as UiSuiteContent).leafer, JSON.stringify(revised));

    // Kind guard: a leafer document must not land in a prototype suite.
    // (note forces suite persistence — without lineage args render_spec goes
    // down the legacy artifact path and returns no artifactRef.)
    const proto = await client.callTool({
      name: "render_spec",
      arguments: { document: "# Spec\n\n## Page list\n- Board", requirement: "Board", note: "suite mode" },
    });
    const protoRef = refOf(proto);
    const rejected = await client.callTool({
      name: "render_leafer",
      arguments: { leafer: DESIGN, suiteId: protoRef.suiteId, versionId: protoRef.versionId },
    });
    assert.equal(rejected.isError, true, "prototype suite must reject leafer documents");
  } finally {
    await client.close();
  }
});

test("render_leafer validates the document at the write boundary", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-leafer-invalid-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    for (const bad of [
      "not json",
      JSON.stringify({ tag: "OpenUI", children: [] }),
      JSON.stringify({ tag: "Leafer" }),
    ]) {
      const result = await client.callTool({
        name: "render_leafer",
        arguments: { leafer: bad, designSystemId: "dark-tech" },
      });
      assert.equal(result.isError, true, `invalid document must be rejected: ${bad}`);
    }
    // Same payload budget as save_suite_result: one runaway scene blob must
    // not bloat the suite store.
    const oversized = JSON.stringify({
      tag: "Leafer",
      width: 100,
      height: 100,
      children: [{ tag: "Text", x: 0, y: 0, text: "x".repeat(513 * 1024) }],
    });
    const clamped = await client.callTool({
      name: "render_leafer",
      arguments: { leafer: oversized, designSystemId: "dark-tech" },
    });
    assert.equal(clamped.isError, true, "oversized scene document must be clamped at the boundary");
    assert.match(textOf(clamped), /too large/);
  } finally {
    await client.close();
  }
});
