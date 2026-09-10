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
import { createDesignTheme, readDesignSuite } from "../main/tools/design-store";
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

test("render_leafer canonicalizes the document and auto-populates deterministic lint", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-leafer-canonical-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    // Pretty-printed input with key jitter — storage must be canonical and
    // carry the deterministic lint findings (WP5 自检测, zero LLM).
    const pretty = JSON.stringify(JSON.parse(DESIGN), null, 2);
    const result = await client.callTool({
      name: "render_leafer",
      arguments: { leafer: pretty, requirement: "Dashboard", designSystemId: "dark-tech" },
    });
    assert.ok(!result.isError, textOf(result));
    const ref = refOf(result);
    const suite = readDesignSuite(root, ref.suiteId);
    const content = suite?.currentVersion.content as UiSuiteContent;
    assert.equal(content.leafer, JSON.stringify(JSON.parse(DESIGN)), "stored document is canonical (compact)");
    assert.equal(content.quality?.lintFindings.length, 0, "clean document → zero findings");

    // A document with an out-of-bounds element lands WITH its finding.
    const outOfBounds = JSON.stringify({
      tag: "Leafer",
      width: 800,
      height: 600,
      children: [{ tag: "Rect", x: 900, y: 700, width: 100, height: 50, fill: "#123456" }],
    });
    const flagged = await client.callTool({
      name: "render_leafer",
      arguments: { leafer: outOfBounds, designSystemId: "dark-tech" },
    });
    assert.ok(!flagged.isError, textOf(flagged));
    const flaggedRef = refOf(flagged);
    const flaggedSuite = readDesignSuite(root, flaggedRef.suiteId);
    const flaggedContent = flaggedSuite?.currentVersion.content as UiSuiteContent;
    assert.ok(
      (flaggedContent.quality?.lintFindings ?? []).some((finding) => finding.ruleId === "out-of-bounds"),
      "deterministic lint findings persist with the version"
    );
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

test("render_openui on a leafer-headed ui suite takes over the stack (clears leafer)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-leafer-openui-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const created = await client.callTool({
      name: "render_leafer",
      arguments: { leafer: DESIGN, requirement: "Dashboard", designSystemId: "dark-tech" },
    });
    const ref = refOf(created);
    const result = await client.callTool({
      name: "render_openui",
      arguments: {
        code: 'root = Stack([TextContent("概览", "large-heavy")])',
        suiteId: ref.suiteId,
        versionId: ref.versionId,
      },
    });
    assert.ok(!result.isError, textOf(result));
    const suite = readDesignSuite(root, ref.suiteId);
    const content = suite?.currentVersion.content as UiSuiteContent;
    assert.equal(typeof content.openui, "string", "the openui program persisted");
    assert.equal(
      content.leafer,
      undefined,
      "an openui write takes over the version's stack — the stale leafer document must not survive (single-stack invariant, both directions)"
    );
  } finally {
    await client.close();
  }
});

test("update_openui on a leafer-headed ui suite clears the leafer field too", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-leafer-update-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const created = await client.callTool({
      name: "render_leafer",
      arguments: { leafer: DESIGN, requirement: "Dashboard", designSystemId: "dark-tech" },
    });
    const ref = refOf(created);
    const result = await client.callTool({
      name: "update_openui",
      arguments: {
        code: 'root = Stack([TextContent("修订后", "large-heavy")])',
        suiteId: ref.suiteId,
        versionId: ref.versionId,
      },
    });
    assert.ok(!result.isError, textOf(result));
    const suite = readDesignSuite(root, ref.suiteId);
    const content = suite?.currentVersion.content as UiSuiteContent;
    assert.equal(typeof content.openui, "string", "the updated openui program persisted");
    assert.equal(
      content.leafer,
      undefined,
      "update_openui is the legacy revision channel — it must clear the leafer field like render_openui"
    );
  } finally {
    await client.close();
  }
});

test("render_leafer inherits theme meta fields from the basis prototype (specs/prd-theme-layer)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-leafer-theme-"));
  roots.push(root);
  // 主题必须真实存在（persist fail-closed 校验 themeId 归属）。
  const theme = createDesignTheme(root, { title: "登录" });
  assert.ok(theme);
  const client = await clientFor(root);
  try {
    const created = await client.callTool({
      name: "render_leafer",
      arguments: {
        leafer: DESIGN,
        requirement: "Dashboard",
        designSystemId: "dark-tech",
        themeId: theme.id,
        stage: "阶段1",
        inheritsSuiteId: "proto-parent",
        references: [{ suiteId: "proto-parent", versionId: "v9" }],
      },
    });
    assert.ok(!created.isError, textOf(created));
    const ref = refOf(created);
    const suite = readDesignSuite(root, ref.suiteId);
    assert.equal(suite?.themeId, theme.id, "UI suite auto-inherits the basis prototype's theme");
    assert.equal(suite?.stage, "阶段1");
    assert.deepEqual(suite?.inherits, { suiteId: "proto-parent" });
    assert.deepEqual(suite?.references, [{ suiteId: "proto-parent", versionId: "v9" }]);
  } finally {
    await client.close();
  }
});

test("render_leafer persists uiDesign and projects ui-design.md (specs/prompt-doc-chain)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-leafer-uidesign-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const created = await client.callTool({
      name: "render_leafer",
      arguments: {
        leafer: DESIGN,
        requirement: "Dashboard",
        designSystemId: "dark-tech",
        uiDesign: "# 登录视觉稿提示\n\n## 画布构图\n- 登录帧居中卡片",
      },
    });
    assert.ok(!created.isError, textOf(created));
    const ref = refOf(created);
    const suite = readDesignSuite(root, ref.suiteId);
    const content = suite?.currentVersion.content as UiSuiteContent;
    assert.match(content.uiDesign ?? "", /# 登录视觉稿提示/);
    assert.ok(
      fs.existsSync(path.join(root, ".deeporca", "designs", ref.suiteId, "ui-design.md")),
      "ui-design.md projection written"
    );
  } finally {
    await client.close();
  }
});

test("render_leafer cross-review hardening: uiDesign clamp, explicit clear, strict lineage (specs/prompt-doc-chain)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-leafer-uidesign-hard-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    // uiDesign 超限钳制。
    const oversized = await client.callTool({
      name: "render_leafer",
      arguments: {
        leafer: DESIGN,
        designSystemId: "dark-tech",
        uiDesign: `# x\n\n## a\n${"y".repeat(513 * 1024)}`,
      },
    });
    assert.equal(oversized.isError, true, "oversized uiDesign must be clamped");
    assert.match(textOf(oversized), /too large|too deep/);

    // 空串 = 显式清除：追加时旧 uiDesign 不残留。
    const first = await client.callTool({
      name: "render_leafer",
      arguments: {
        leafer: DESIGN,
        designSystemId: "dark-tech",
        uiDesign: "# 视觉稿提示\n\n## 画布构图\n- 居中卡片",
      },
    });
    const ref = refOf(first);
    const revised = JSON.parse(DESIGN) as { children: unknown[] };
    revised.children.push({ tag: "Text", x: 10, y: 10, text: "KPI" });
    const second = await client.callTool({
      name: "render_leafer",
      arguments: {
        leafer: JSON.stringify(revised),
        suiteId: ref.suiteId,
        versionId: ref.versionId,
        uiDesign: "",
      },
    });
    assert.ok(!second.isError, textOf(second));
    const suite = readDesignSuite(root, ref.suiteId);
    assert.equal(
      (suite?.currentVersion.content as UiSuiteContent).uiDesign,
      undefined,
      "empty-string uiDesign explicitly clears the stale visual intent"
    );

    // 严格 lineage：仅 note 不再隐含套件意图。
    const orphan = await client.callTool({
      name: "render_leafer",
      arguments: { leafer: DESIGN, note: "no lineage" },
    });
    assert.equal(orphan.isError, true, "note-only call must not mint an orphan UI suite");
  } finally {
    await client.close();
  }
});
