import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildA2uiServer, persistSurfaces } from "../main/tools/a2ui/a2ui-mcp";
import {
  createDesignTheme,
  listDesignArtifacts,
  readDesignSuite,
  saveDesignArtifact,
} from "../main/tools/design-store";
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

// ── review-fix regressions ────────────────────────────────────────────────────

function artifactRefOf(result: Awaited<ReturnType<Client["callTool"]>>): {
  suiteId: string;
  versionId: string;
  kind: string;
} {
  const match = text(result).match(/ArtifactRef:\s*(\{[^\n]+\})/);
  assert.ok(match, "expected an ArtifactRef in the tool result");
  return JSON.parse(match[1]);
}

test("save_suite_result fails on a stale versionId instead of rolling the head back", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-suite-head-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const first = await client.callTool({
      name: "render_spec",
      arguments: { document: "# Tasks\n\n## Page list\n- Board", requirement: "Task board", note: "initial" },
    });
    const ref = artifactRefOf(first);
    const materialized = await client.callTool({
      name: "render_openui",
      arguments: { code: "root = Column([board])", suiteId: ref.suiteId, versionId: ref.versionId },
    });
    const head = artifactRefOf(materialized);
    assert.notEqual(head.versionId, ref.versionId, "the head moved to a new version");

    // Appending against the stale (non-head) version must fail loudly instead
    // of silently branching/rolling the head back.
    const stale = await client.callTool({
      name: "save_suite_result",
      arguments: { suiteId: ref.suiteId, versionId: ref.versionId, verification: { status: "passed", checks: [] } },
    });
    assert.equal(stale.isError, true);
    assert.match(text(stale), /head has moved/);
    assert.match(text(stale), /latest version/);

    // Appending against the head stays ok and creates a new version.
    const fresh = await client.callTool({
      name: "save_suite_result",
      arguments: { suiteId: ref.suiteId, versionId: head.versionId, verification: { status: "passed", checks: [] } },
    });
    assert.notEqual(fresh.isError, true);
    const saved = artifactRefOf(fresh);
    assert.notEqual(saved.versionId, head.versionId);
  } finally {
    await client.close();
  }
});

test("update_openui fails on a stale versionId instead of rolling the head back", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-update-head-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const first = await client.callTool({
      name: "render_spec",
      arguments: { document: "# Tasks\n\n## Page list\n- Board", requirement: "Task board", note: "initial" },
    });
    const v1 = artifactRefOf(first);
    const materialized = await client.callTool({
      name: "render_openui",
      arguments: { code: "root = Column([board])", suiteId: v1.suiteId, versionId: v1.versionId },
    });
    const v2 = artifactRefOf(materialized);
    assert.notEqual(v2.versionId, v1.versionId);

    // A stale versionId must fail loudly: update_openui expands the new code
    // over the given base's content, so appending against v1 would silently
    // roll the head's verification/openui fields back to v1 state.
    const stale = await client.callTool({
      name: "update_openui",
      arguments: { code: "root = Column([stale])", suiteId: v1.suiteId, versionId: v1.versionId },
    });
    assert.equal(stale.isError, true);
    assert.match(text(stale), /head has moved/);
    assert.match(text(stale), /latest version/);

    // Nothing was written: the head is still v2 with v2's content intact.
    const suite = readDesignSuite(root, v1.suiteId);
    assert.equal(suite?.currentVersionId, v2.versionId);
    const headContent = suite?.currentVersion?.content as PrototypeSuiteContent;
    assert.equal(headContent.openui, "root = Column([board])");

    // Appending against the head stays ok.
    const fresh = await client.callTool({
      name: "update_openui",
      arguments: { code: "root = Column([fresh])", suiteId: v1.suiteId, versionId: v2.versionId },
    });
    assert.notEqual(fresh.isError, true);
    assert.equal(artifactRefOf(fresh).versionId !== v2.versionId, true);
  } finally {
    await client.close();
  }
});

test("update_openui accepts a legacy design artifact via the pipeline-derived kind", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-legacy-kind-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    // Legacy (pre-v2) artifact: meta carries `pipeline`, no schemaVersion/kind.
    const legacy = saveDesignArtifact(root, {
      title: "Legacy dash",
      pipeline: "design",
      content: "---\nname: legacy-dash\n---",
    });
    assert.ok(legacy);

    // The probe must derive "ui" from the pipeline (a v2-only probe returned
    // null and defaulted to "prototype", rejecting the append with a kind
    // mismatch).
    const updated = await client.callTool({
      name: "update_openui",
      arguments: { code: 'root = Screen("legacy")', suiteId: legacy.id },
    });
    assert.notEqual(updated.isError, true);
    const ref = artifactRefOf(updated);
    assert.equal(ref.kind, "ui");
    const suite = readDesignSuite(root, legacy.id);
    assert.equal(suite?.kind, "ui");
  } finally {
    await client.close();
  }
});

test("a2ui suite creations stamp authoringLibrary=official; appends keep it", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-legacy-kind-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    // Create path (render_openui with a note but no suiteId → suite mode
    // create): the post-switch official prompt authored this code; the
    // renderer must never guess.
    const rendered = await client.callTool({
      name: "render_openui",
      arguments: { code: 'root = Stack([Button("Go", Action([@Set($p, "home")]))])', note: "initial" },
    });
    const created = artifactRefOf(rendered);
    assert.equal(readDesignSuite(root, created.suiteId)?.authoringLibrary, "official");

    // Append path carries the stamp forward verbatim.
    const updated = await client.callTool({
      name: "update_openui",
      arguments: { code: 'root = Stack([Button("Back", Action([@Set($p, "root")]))])', suiteId: created.suiteId },
    });
    assert.notEqual(updated.isError, true);
    assert.equal(readDesignSuite(root, created.suiteId)?.authoringLibrary, "official");
  } finally {
    await client.close();
  }
});

test("render_openui appends to an existing ui suite without designSystemId (kind from the suite)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-suite-kind-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const first = await client.callTool({
      name: "render_openui",
      arguments: { code: "root = Column([a])", designSystemId: "dark-tech" },
    });
    const ref = artifactRefOf(first);
    assert.equal(ref.kind, "ui");

    const second = await client.callTool({
      name: "render_openui",
      arguments: { code: "root = Column([a, b])", suiteId: ref.suiteId, versionId: ref.versionId },
    });
    const next = artifactRefOf(second);
    assert.equal(next.kind, "ui", "the append must keep the suite's kind");
    const suite = readDesignSuite(root, ref.suiteId);
    assert.equal(suite?.kind, "ui");
    assert.equal(suite?.versions.length, 2);
  } finally {
    await client.close();
  }
});

test("render_surface rejects traversal surfaceIds; nothing is written outside the prototypes dir", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-surface-id-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const components = [
      { id: "root", component: "Column", children: ["t"] },
      { id: "t", component: "Text", text: "hi" },
    ];
    const evil = await client.callTool({
      name: "render_surface",
      arguments: { surfaceId: "../../evil", components, dataModel: {} },
    });
    assert.equal(evil.isError, true, "traversal surfaceId must be rejected");
    assert.match(text(evil), /safe identifier/, "rejected by the surfaceId guard, not schema validation");

    const good = await client.callTool({
      name: "render_surface",
      arguments: { surfaceId: "good-one", components, dataModel: {} },
    });
    assert.notEqual(good.isError, true);

    persistSurfaces(root);
    const dir = path.join(root, ".deeporca", "prototypes");
    assert.deepEqual(fs.readdirSync(dir).sort(), ["good-one.json"]);
    assert.equal(fs.existsSync(path.join(root, "evil.json")), false);
    assert.equal(fs.existsSync(path.join(root, ".deeporca", "evil.json")), false);
  } finally {
    await client.close();
  }
});

test("save_suite_result clamps oversized or over-deep payloads", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-suite-clamp-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const first = await client.callTool({
      name: "render_openui",
      arguments: { code: "root = Column([])", designSystemId: "dark-tech" },
    });
    const ref = artifactRefOf(first);
    assert.equal(ref.kind, "ui");

    const oversized = await client.callTool({
      name: "save_suite_result",
      arguments: { suiteId: ref.suiteId, versionId: ref.versionId, quality: { blob: "x".repeat(600 * 1024) } },
    });
    assert.equal(oversized.isError, true);
    assert.match(text(oversized), /too large/);

    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 15; i += 1) deep = { nested: deep };
    const overDeep = await client.callTool({
      name: "save_suite_result",
      arguments: { suiteId: ref.suiteId, versionId: ref.versionId, quality: deep },
    });
    assert.equal(overDeep.isError, true);
    assert.match(text(overDeep), /depth/);

    const normal = await client.callTool({
      name: "save_suite_result",
      arguments: {
        suiteId: ref.suiteId,
        versionId: ref.versionId,
        quality: { lintFindings: [], runtimeChecks: [] },
      },
    });
    assert.notEqual(normal.isError, true, "a normal payload still saves");
  } finally {
    await client.close();
  }
});

test("legacy update against a suite-normalized artifact fails loudly instead of silently dropping", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-lineage-normalized-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    await client.callTool({ name: "render_openui", arguments: { code: "root = Column([])" } });
    const artifact = listDesignArtifacts(root)[0];
    // Containment guard (mirror of the production isSafeDesignId policy): the
    // store-issued id must resolve INSIDE the designs root before this test
    // touches any file under it.
    const designsRoot = path.resolve(root, ".deeporca", "designs");
    const dir = path.resolve(designsRoot, artifact.id);
    assert.ok(dir.startsWith(designsRoot + path.sep), "store-issued artifact id must stay inside the designs root");
    // Simulate legacy → v2 normalization: the artifact meta becomes suite-shaped
    // (schemaVersion 2, no `pipeline`), the exact mixed-lineage trap.
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({
        schemaVersion: 2,
        id: artifact.id,
        title: artifact.title,
        kind: "ui",
        status: "ready",
        currentVersionId: "v1",
        versions: [],
      }),
      "utf8"
    );
    const contentFile = fs.readdirSync(dir).find((name) => name !== "meta.json")!;
    const before = fs.readFileSync(path.join(dir, contentFile), "utf8");

    const updated = await client.callTool({ name: "update_openui", arguments: { code: "root = Column([b])" } });
    assert.equal(updated.isError, true, "the dropped revision must surface as a tool error");
    assert.match(text(updated), /normalized into a v2 design suite/);
    assert.match(text(updated), /suiteId/);

    const after = fs.readFileSync(path.join(dir, contentFile), "utf8");
    assert.equal(after, before, "the normalized store must not be touched by the legacy path");
  } finally {
    await client.close();
  }
});

test("save_suite_arch enforces the verification gate and the arch contract at the write boundary", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-suite-arch-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const first = await client.callTool({
      name: "render_spec",
      arguments: { document: "# Tasks\n\n## Page list\n- Board", requirement: "Task board", note: "initial" },
    });
    const ref = artifactRefOf(first);
    const ARCH = "# 架构\n\n```mermaid\ngraph TB\n  a[界面]\n```";

    // The tool is model-reachable directly — the prototype.arch action's
    // verification gate must hold here too, not only in the action layer.
    const locked = await client.callTool({
      name: "save_suite_arch",
      arguments: { suiteId: ref.suiteId, versionId: ref.versionId, document: ARCH },
    });
    assert.equal(locked.isError, true);
    assert.match(text(locked), /verification must pass/);

    // Verify the suite, then the standardized-format contract still applies.
    await client.callTool({
      name: "save_suite_result",
      arguments: { suiteId: ref.suiteId, versionId: ref.versionId, verification: { status: "passed", checks: [] } },
    });
    const head = readDesignSuite(root, ref.suiteId)?.currentVersionId ?? "";
    assert.notEqual(head, ref.versionId, "verification append moved the head");
    const diagramLess = await client.callTool({
      name: "save_suite_arch",
      arguments: { suiteId: ref.suiteId, versionId: head, document: "# 架构\n\n正文没有图。" },
    });
    assert.equal(diagramLess.isError, true);
    assert.match(text(diagramLess), /mermaid/);

    // A valid document against the head persists and must not downgrade the
    // already-passed verification to "ready".
    const saved = await client.callTool({
      name: "save_suite_arch",
      arguments: { suiteId: ref.suiteId, versionId: head, document: ARCH },
    });
    assert.notEqual(saved.isError, true);
    const headContent = readDesignSuite(root, ref.suiteId)?.currentVersion?.content as PrototypeSuiteContent;
    assert.equal(headContent.verification?.status, "passed");
    assert.match(headContent.arch ?? "", /```mermaid/);
  } finally {
    await client.close();
  }
});

test("validate_openui returns a structured local verdict and rejects empty code", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-validate-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const VALID = [
      '$page = "home"',
      'root = Stack([nav, $page == "home" ? homeView : ordersView])',
      'homeView = Card([TextContent("概览")])',
      'ordersView = Card([TextContent("列表")])',
      'nav = Stack([Button("首页", Action([@Set($page, "home")]))], "row")',
    ].join("\n");
    const ok = await client.callTool({ name: "validate_openui", arguments: { code: VALID } });
    assert.notEqual(ok.isError, true);
    const verdict = JSON.parse(text(ok)) as { valid: boolean; unresolved: string[] };
    assert.equal(verdict.valid, true);

    const broken = await client.callTool({ name: "validate_openui", arguments: { code: "root = Fakebox([])" } });
    assert.notEqual(broken.isError, true);
    const bad = JSON.parse(text(broken)) as { valid: boolean; errors: Array<{ code: string }> };
    assert.equal(bad.valid, false);
    assert.equal(bad.errors[0].code, "unknown-component");

    const empty = await client.callTool({ name: "validate_openui", arguments: { code: "   " } });
    assert.equal(empty.isError, true);
  } finally {
    await client.close();
  }
});

test("render_spec stamps theme meta fields (specs/prd-theme-layer) and read_suite_version echoes them", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-suite-theme-"));
  roots.push(root);
  // 主题必须真实存在（persistSuiteTheme fail-closed 校验 themeId 归属）。
  const theme = createDesignTheme(root, { title: "登录" });
  assert.ok(theme);
  const client = await clientFor(root);
  try {
    const parent = await client.callTool({
      name: "render_spec",
      // note 强制套件持久化（主题/关系只存在于套件 meta，legacy artifact 无处安放）。
      arguments: { document: "# 人员管理\n\n## Page list\n- Staff", requirement: "人员管理", note: "suite mode" },
    });
    const parentRef = JSON.parse(text(parent).match(/ArtifactRef:\s*(\{[^\n]+\})/)![1]) as {
      suiteId: string;
      versionId: string;
    };
    const themed = await client.callTool({
      name: "render_spec",
      arguments: {
        document: "# 登录\n\n## Page list\n- Login",
        requirement: "登录模块",
        themeId: theme.id,
        stage: "阶段1",
        inheritsSuiteId: parentRef.suiteId,
        references: [{ suiteId: parentRef.suiteId, versionId: parentRef.versionId }, { suiteId: "gone" }],
      },
    });
    const themedRef = JSON.parse(text(themed).match(/ArtifactRef:\s*(\{[^\n]+\})/)![1]) as {
      suiteId: string;
      versionId: string;
    };
    const suite = readDesignSuite(root, themedRef.suiteId);
    assert.equal(suite?.themeId, theme.id, "themeId stamped on suite meta");
    assert.equal(suite?.stage, "阶段1");
    assert.deepEqual(suite?.inherits, { suiteId: parentRef.suiteId });
    assert.deepEqual(suite?.references, [
      { suiteId: parentRef.suiteId, versionId: parentRef.versionId },
      { suiteId: "gone" },
    ]);

    // 主题字段进 read_suite_version 载荷（design.materialize 透传的数据源），
    // 且版本内容不受影响。
    const version = (await client.callTool({
      name: "read_suite_version",
      arguments: { suiteId: themedRef.suiteId },
    })) as { structuredContent?: Record<string, unknown> };
    const payload = version.structuredContent as Record<string, unknown>;
    assert.equal(payload.themeId, theme.id);
    assert.equal(payload.stage, "阶段1");
    assert.deepEqual(payload.references, suite?.references);
    const content = payload.content as PrototypeSuiteContent;
    assert.equal(content.spec, "# 登录\n\n## Page list\n- Login");
  } finally {
    await client.close();
  }
});

test("render_spec append with theme args overwrites the suite's theme meta without a new version", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-suite-theme-append-"));
  roots.push(root);
  const themeA = createDesignTheme(root, { title: "阶段一主题" });
  const themeB = createDesignTheme(root, { title: "阶段二主题" });
  assert.ok(themeA && themeB);
  const client = await clientFor(root);
  try {
    const first = await client.callTool({
      name: "render_spec",
      arguments: { document: "# 登录\n\n## Page list\n- Login", themeId: themeA.id, stage: "阶段1" },
    });
    const ref = JSON.parse(text(first).match(/ArtifactRef:\s*(\{[^\n]+\})/)![1]) as {
      suiteId: string;
      versionId: string;
    };
    const second = await client.callTool({
      name: "render_spec",
      arguments: {
        document: "# 登录 v2\n\n## Page list\n- Login\n- MFA",
        suiteId: ref.suiteId,
        versionId: ref.versionId,
        themeId: themeB.id,
        stage: "阶段2",
      },
    });
    assert.ok(!second.isError, text(second));
    const suite = readDesignSuite(root, ref.suiteId);
    assert.equal(suite?.themeId, themeB.id, "append with theme args re-stamps the meta");
    assert.equal(suite?.stage, "阶段2");
    assert.equal(suite?.versions.length, 2, "theme re-stamp must not add versions by itself");
  } finally {
    await client.close();
  }
});

test("save_pm_design persists the prompt doc, resets derived artifacts, and projects pm-design.md", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-suite-pmdesign-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const spec = await client.callTool({
      name: "render_spec",
      arguments: { document: "# 登录 PRD\n\n## Page list\n- Login", requirement: "登录模块", note: "suite mode" },
    });
    const ref = JSON.parse(text(spec).match(/ArtifactRef:\s*(\{[^\n]+\})/)![1]) as {
      suiteId: string;
      versionId: string;
    };
    const pd = await client.callTool({
      name: "save_pm_design",
      arguments: {
        document: "# 登录原型设计提示\n\n## 页面结构\n- 登录页\n\n## 交互叙事\n- 提交→校验",
        suiteId: ref.suiteId,
        versionId: ref.versionId,
      },
    });
    assert.ok(!pd.isError, text(pd));
    const suite = readDesignSuite(root, ref.suiteId);
    const content = suite?.currentContent as PrototypeSuiteContent;
    assert.match(content.pmDesign ?? "", /# 登录原型设计提示/);
    // 派生物失效（与 render_spec 同规）。
    assert.equal(content.openui, undefined);
    assert.equal(content.verification?.status, "pending");
    assert.equal(content.arch, undefined);
    // 投影文件。
    assert.ok(
      fs.existsSync(path.join(root, ".deeporca", "designs", ref.suiteId, "pm-design.md")),
      "pm-design.md projection written"
    );

    // render_spec 重写 PRD → pmDesign 派生链失效（save_pm_design 已前移
    // head——按 head 追加，不沿用旧 versionId）。
    const revised = await client.callTool({
      name: "render_spec",
      arguments: { document: "# 登录 PRD v2\n\n## Page list\n- Login\n- MFA", suiteId: ref.suiteId },
    });
    assert.ok(!revised.isError, text(revised));
    const afterSpec = readDesignSuite(root, ref.suiteId);
    assert.equal(
      (afterSpec?.currentContent as PrototypeSuiteContent).pmDesign,
      undefined,
      "spec rewrite invalidates pmDesign"
    );
  } finally {
    await client.close();
  }
});

test("save_pm_design cross-review hardening: preserveDerived keeps derived artifacts; clamps and strict lineage (specs/prompt-doc-chain)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-suite-pmdesign-hard-"));
  roots.push(root);
  const client = await clientFor(root);
  try {
    const spec = await client.callTool({
      name: "render_spec",
      arguments: { document: "# 登录 PRD\n\n## Page list\n- Login", requirement: "登录模块", note: "suite mode" },
    });
    const specRef = JSON.parse(text(spec).match(/ArtifactRef:\s*(\{[^\n]+\})/)![1]) as {
      suiteId: string;
      versionId: string;
    };
    // 先落一个 openui 派生物（render_spec 会重置它，所以走 render_openui 追加）。
    const openui = await client.callTool({
      name: "render_openui",
      arguments: { code: "root = Stack([login])", suiteId: specRef.suiteId, versionId: specRef.versionId },
    });
    const ref = JSON.parse(text(openui).match(/ArtifactRef:\s*(\{[^\n]+\})/)![1]) as {
      suiteId: string;
      versionId: string;
    };
    const preserved = await client.callTool({
      name: "save_pm_design",
      arguments: {
        document: "# 登录原型设计提示\n\n## 页面结构\n- 登录页",
        preserveDerived: true,
        suiteId: ref.suiteId,
        versionId: ref.versionId,
      },
    });
    assert.ok(!preserved.isError, text(preserved));
    const firstSuite = readDesignSuite(root, ref.suiteId);
    let content = firstSuite?.currentContent as PrototypeSuiteContent;
    assert.match(content.pmDesign ?? "", /# 登录原型设计提示/);
    assert.ok(content.openui, "preserveDerived keeps the derived openui on the head version");

    const reset = await client.callTool({
      name: "save_pm_design",
      arguments: { document: "# 登录原型设计提示 v2\n\n## 页面结构\n- 登录页", suiteId: ref.suiteId },
    });
    assert.ok(!reset.isError, text(reset));
    const resetSuite = readDesignSuite(root, ref.suiteId);
    assert.ok(resetSuite);
    content = resetSuite.currentContent as PrototypeSuiteContent;
    assert.equal(content.openui, undefined, "manual recompute (default) resets derived artifacts");

    // 载荷钳制：超限文档拒绝。
    const oversized = await client.callTool({
      name: "save_pm_design",
      arguments: { document: `# x\n\n## a\n${"y".repeat(513 * 1024)}`, suiteId: ref.suiteId },
    });
    assert.equal(oversized.isError, true, "oversized pm-design document must be clamped");
    assert.match(text(oversized), /too large|too deep/);

    // 严格 lineage：仅 note 不再隐含套件意图（孤儿套件防护）。
    const orphan = await client.callTool({
      name: "save_pm_design",
      arguments: { document: "# 孤儿\n\n## a\n- b", note: "no lineage" },
    });
    assert.equal(orphan.isError, true, "note-only call must not mint an orphan suite");
  } finally {
    await client.close();
  }
});
