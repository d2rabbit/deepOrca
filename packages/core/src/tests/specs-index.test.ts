// specs read model (specs/spec-graph-adoption P0+P4) — frontmatter parsing,
// SpecIndex revalidation, link-integrity validation, and the three
// independent mechanical drift gates. Pure fs fixtures, no mocks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureDesignChainRegistration, getSpecGraph, listSpecs, resetSpecIndexCache, validateSpecs } from "../specs";

async function makeRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "deeporca-specs-"));
}

async function write(root: string, rel: string, content: string): Promise<string> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  return abs;
}

const chainNodes = () => ({
  pd: `---\nid: suite-a\ntype: product-design\nstatus: active\n---\n\n# Suite A 产品设计\n`,
  arch: `---\nid: suite-a#architecture\ntype: architecture\nstatus: active\nparent: suite-a\n---\n\n# Suite A 技术架构\n`,
});

test("missing domain dir yields an empty graph without error", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  const graph = await getSpecGraph(root);
  assert.equal(graph.nodes.length, 0);
  assert.deepEqual(await validateSpecs(root), []);
});

test("design chain parses, links, and drift gate A stays ok while fresh", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  const { pd, arch } = chainNodes();
  await write(root, ".deeporca/specs/suite-a/product-design.md", pd);
  await write(root, ".deeporca/specs/suite-a/architecture.md", arch);
  const { nodes } = await getSpecGraph(root);
  assert.equal(nodes.length, 2);
  const archNode = nodes.find((n) => n.id === "suite-a#architecture");
  assert.ok(archNode);
  assert.equal(archNode.parent, "suite-a");
  assert.equal(archNode.title, "Suite A 技术架构");
  const chain = archNode.drift.find((d) => d.gate === "chain");
  assert.ok(chain && chain.state !== "stale");
});

test("gate A flags a stale architecture behind its product design", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  const { pd, arch } = chainNodes();
  const archPath = await write(root, ".deeporca/specs/suite-a/architecture.md", arch);
  const pdPath = await write(root, ".deeporca/specs/suite-a/product-design.md", pd);
  // Architecture edited BEFORE the product design → chain lags.
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(archPath, old, old);
  const { nodes } = await getSpecGraph(root);
  const archNode = nodes.find((n) => n.id === "suite-a#architecture");
  const chain = archNode?.drift.find((d) => d.gate === "chain");
  assert.equal(chain?.state, "stale");
  assert.ok(pdPath);
});

test("independent architecture is legal (info, not error); dangling parent is an error", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  await write(
    root,
    ".deeporca/specs/standalone/architecture.md",
    `---\nid: standalone\ntype: architecture\nstatus: draft\n---\n\n# 独立架构\n`
  );
  await write(
    root,
    ".deeporca/specs/broken/architecture.md",
    `---\nid: broken\ntype: architecture\nparent: ghost\nstatus: draft\n---\n\n# 悬空\n`
  );
  const issues = await validateSpecs(root);
  const independent = issues.find((i) => i.code === "independent-architecture");
  assert.ok(independent && independent.severity === "info");
  const dangling = issues.find((i) => i.code === "dangling-link");
  assert.ok(dangling && dangling.severity === "error");
});

test("loose and malformed files degrade to info, never nodes or throws", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  await write(root, ".deeporca/specs/notes/scratch.md", "# 纯散文\n无 frontmatter");
  await write(root, ".deeporca/specs/notes/broken.md", "---\nid: x\n/type: oops\n");
  const graph = await getSpecGraph(root);
  assert.equal(graph.nodes.length, 0);
  const issues = await validateSpecs(root);
  const loose = issues.filter((i) => i.code === "loose-file");
  assert.equal(loose.length, 2);
  assert.ok(loose.every((i) => i.severity === "info"));
});

test("tasks convention derives <dir>#tasks and its parent rule is enforced", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  await write(root, ".deeporca/specs/suite-a/product-design.md", chainNodes().pd);
  await write(root, ".deeporca/specs/suite-a/tasks.md", `---\ntype: tasks\nparent: suite-a\n---\n\n# 任务\n`);
  const { nodes } = await getSpecGraph(root);
  assert.ok(nodes.some((n) => n.id === "suite-a#tasks"));
  const issues = await validateSpecs(root);
  assert.ok(!issues.some((i) => i.code === "tasks-parent"));
});

test("gate B: missing implementation artifact → unimplemented; newer one → ahead", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  const archPath = await write(
    root,
    ".deeporca/specs/suite-b/architecture.md",
    `---\nid: suite-b#architecture\ntype: architecture\nparent: suite-b\nartifacts:\n  - src/feature.ts\n  - src/gone.ts\n---\n\n# B\n`
  );
  const implPath = await write(root, "src/feature.ts", "export {};\n");
  // Case 1: gone.ts missing → unimplemented.
  {
    const { nodes } = await getSpecGraph(root);
    const gateB = nodes[0].drift.find((d) => d.gate === "implementation");
    assert.equal(gateB?.state, "unimplemented");
  }
  // Case 2: both exist, implementation newer than the node → ahead.
  await write(root, "src/gone.ts", "export {};\n");
  const future = new Date(Date.now() + 60_000);
  await fs.utimes(implPath, future, future);
  await fs.utimes(archPath, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  {
    const { nodes } = await getSpecGraph(root);
    const gateB = nodes[0].drift.find((d) => d.gate === "implementation");
    assert.equal(gateB?.state, "ahead");
  }
});

test("gate C: newer prototypes snapshot → stale; missing snapshot → unknown", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  const archPath = await write(
    root,
    ".deeporca/specs/suite-c/architecture.md",
    `---\nid: suite-c#architecture\ntype: architecture\nparent: suite-c\nartifacts:\n  - .deeporca/prototypes/arch-scan.json\n---\n\n# C\n`
  );
  await fs.utimes(archPath, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  // Case 1: snapshot missing → unknown.
  {
    const { nodes } = await getSpecGraph(root);
    const gateC = nodes[0].drift.find((d) => d.gate === "knowledge");
    assert.equal(gateC?.state, "unknown");
  }
  // Case 2: snapshot newer than the node → stale (advisory only).
  const snap = await write(root, ".deeporca/prototypes/arch-scan.json", "{}\n");
  await fs.utimes(snap, new Date(), new Date());
  {
    const { nodes } = await getSpecGraph(root);
    const gateC = nodes[0].drift.find((d) => d.gate === "knowledge");
    assert.equal(gateC?.state, "stale");
  }
});

test("duplicate ids across files surface as errors", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  const body = `---\nid: clash\ntype: design\nstatus: draft\n---\n\n# x\n`;
  await write(root, ".deeporca/specs/one/design.md", body);
  await write(root, ".deeporca/specs/two/design.md", body);
  const issues = await validateSpecs(root);
  assert.ok(issues.some((i) => i.code === "duplicate-id" && i.severity === "error"));
});

test("listSpecs shares the index and the same freshness", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  await write(root, ".deeporca/specs/solo/design.md", chainNodes().pd);
  const first = await listSpecs(root);
  assert.equal(first.length, 1);
  await write(root, ".deeporca/specs/solo/extra.md", `---\nid: solo-extra\ntype: design\nstatus: draft\n---\n\n# e\n`);
  const second = await listSpecs(root);
  assert.equal(second.length, 2); // external edit is current on the next read
});

test("registration writer upserts pointer anchors with a visible chain", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  await ensureDesignChainRegistration(root, { suiteId: "我的 套件A!", versionId: "v3" });
  const { nodes } = await getSpecGraph(root);
  assert.deepEqual(nodes.map((n) => n.id).sort(), ["我的-套件A", "我的-套件A#architecture"]);
  const arch = nodes.find((n) => n.id === "我的-套件A#architecture");
  assert.equal(arch?.parent, "我的-套件A");
  // Anchors carry NO artifacts (suite docs are content fields, not files —
  // a fake path here would false-fire drift gate B).
  assert.deepEqual(arch?.artifacts, []);
  // Idempotent re-registration keeps content (and mtime) stable.
  const before = await fs.readFile(path.join(root, ".deeporca/specs/我的-套件A/architecture.md"), "utf8");
  await ensureDesignChainRegistration(root, { suiteId: "我的 套件A", versionId: "v3" });
  const after = await fs.readFile(path.join(root, ".deeporca/specs/我的-套件A/architecture.md"), "utf8");
  assert.equal(before, after);
  // Bodies are pointer stubs, never document copies.
  assert.ok(!after.includes("# 技术架构文档"));
});

test("registration writer never clobbers a hand-mangled anchor (no-clobber guard)", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  const first = await ensureDesignChainRegistration(root, { suiteId: "套件B", versionId: "v1" });
  assert.equal(first.status, "written");
  const file = path.join(root, ".deeporca/specs/套件B/architecture.md");
  // Hand edit that breaks frontmatter parsing (a line without ":") while the
  // body still carries the anchor marker — the 2026-09 swarm review
  // data-loss seam: a full overwrite would silently destroy the human edits.
  const mangled = "this line has no colon\n> 本节点是 spec 图的**登记锚点**，已被手工接管。\n";
  await fs.writeFile(file, mangled, "utf8");
  // The skip is REPORTED (status), not silent — the caller surfaces it.
  const skipped = await ensureDesignChainRegistration(root, { suiteId: "套件B", versionId: "v1" });
  assert.equal(skipped.status, "skipped-unparseable-anchor");
  assert.equal(skipped.file, file);
  await ensureDesignChainRegistration(root, { suiteId: "套件B", versionId: "v2" });
  assert.equal(await fs.readFile(file, "utf8"), mangled);
  // Idempotent re-registration of an intact anchor reports unchanged.
  await ensureDesignChainRegistration(root, { suiteId: "套件C", versionId: "v1" });
  const unchanged = await ensureDesignChainRegistration(root, { suiteId: "套件C", versionId: "v1" });
  assert.equal(unchanged.status, "unchanged");
});

test("registration result aggregates mixed outcomes with an accurate file", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  // PRD written fresh, arch already intact for the same version → the
  // aggregate must report "written" naming the PRD file (iter-2D review:
  // it used to always name architecture.md).
  await ensureDesignChainRegistration(root, { suiteId: "套件D", versionId: "v1" });
  const prdFile = path.join(root, ".deeporca/specs/套件D/product-design.md");
  const archFile = path.join(root, ".deeporca/specs/套件D/architecture.md");
  // Delete the PRD anchor (external edit), keep arch → re-registration writes
  // only the PRD; the aggregate must point at it.
  await fs.rm(prdFile);
  const mixed = await ensureDesignChainRegistration(root, { suiteId: "套件D", versionId: "v1" });
  assert.equal(mixed.status, "written");
  assert.equal(mixed.file, prdFile);
  // PRD mangled (unparseable + marker), arch written for a NEW version →
  // the skip outranks the write and names the PRD file.
  await fs.writeFile(prdFile, "no colon here\n> 登记锚点 hand-owned\n", "utf8");
  const skipOutranks = await ensureDesignChainRegistration(root, { suiteId: "套件D", versionId: "v2" });
  assert.equal(skipOutranks.status, "skipped-unparseable-anchor");
  assert.equal(skipOutranks.file, prdFile);
  const archAfter = await fs.readFile(archFile, "utf8");
  assert.ok(archAfter.includes("version: v2"), `arch should have moved to v2: ${archAfter.slice(0, 120)}`);
});

test("CRLF-authored spec files parse as nodes, not loose prose", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  // Windows editors emit CRLF (the repo is developed cross-platform); the
  // frontmatter close-fence check used to reject \r\n and silently degraded
  // the whole file to loose prose (full-domain audit 2026-09).
  await write(
    root,
    ".deeporca/specs/win/suite.md",
    "---\r\nid: win\r\ntype: design\r\nstatus: active\r\n---\r\n\r\n# Win Suite\r\n"
  );
  const { nodes, loose } = { nodes: (await getSpecGraph(root)).nodes, loose: [] };
  assert.ok(
    nodes.some((n) => n.id === "win"),
    `node missing: ${JSON.stringify(nodes)}`
  );
  const issues = await validateSpecs(root);
  assert.ok(
    !issues.some((issue) => issue.path.includes("win/suite") && issue.code === "loose-file"),
    `wrongly loose: ${JSON.stringify(issues)}`
  );
});

test("mid-path traversal in artifacts is flagged and never stat-ed (escapesRoot hardening)", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  await write(
    root,
    ".deeporca/specs/suite-c/design.md",
    `---\nid: suite-c\ntype: design\nstatus: active\nartifacts:\n  - a/../../outside.md\n---\n\n# C\n`
  );
  const issues = await validateSpecs(root);
  // The prefix-only check used to let `a/../../x` through (full-domain audit
  // 2026-09) — gate B/C then stat-ed outside the registered root.
  const escape = issues.find((issue) => issue.code === "artifact-escapes-root");
  assert.ok(escape, `escapes-root missing: ${JSON.stringify(issues)}`);
  assert.equal(escape.data?.artifact, "a/../../outside.md");
});

test("a parentless tasks node gets the <dir>#tasks info hint (not silence)", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  await write(root, ".deeporca/specs/solo/tasks.md", `---\nid: solo#tasks\ntype: tasks\nstatus: active\n---\n\n# t\n`);
  const issues = await validateSpecs(root);
  const hint = issues.find((issue) => issue.code === "tasks-parent");
  // Iter-2 review: the no-parent arm was dead behind `node.parent &&` — the
  // exact mistake the convention exists for showed no structure hint at all.
  assert.ok(hint, `issues: ${JSON.stringify(issues)}`);
  assert.equal(hint.severity, "info");
  assert.equal(hint.data, undefined);
});

test("revalidation reparses content changed between reads (cache pin)", async () => {
  resetSpecIndexCache();
  const root = await makeRoot();
  const { pd, arch } = chainNodes();
  const archPath = await write(root, ".deeporca/specs/suite-a/architecture.md", arch);
  const pdPath = await write(root, ".deeporca/specs/suite-a/product-design.md", pd);
  const chainStateOf = async (): Promise<string | undefined> => {
    const { nodes } = await getSpecGraph(root);
    return nodes.find((n) => n.id === "suite-a#architecture")?.drift.find((d) => d.gate === "chain")?.state;
  };
  // Deterministic clocks: raw write order crosses millisecond boundaries
  // flakily, so pin the baseline explicitly (architecture newer → gate A ok).
  const base = Date.now();
  await fs.utimes(pdPath, new Date(base - 60_000), new Date(base - 60_000));
  await fs.utimes(archPath, new Date(base), new Date(base));
  // Fresh chain: gate A present and not stale.
  assert.ok((await chainStateOf()) !== "stale");
  // External edit between reads: drop the parent link entirely — the changed
  // bytes must be re-parsed (stale parse reuse would keep gate A alive).
  await fs.writeFile(
    archPath,
    `---\nid: suite-a#architecture\ntype: architecture\nstatus: active\n---\n\n# Suite A 技术架构\n`,
    "utf8"
  );
  assert.equal(await chainStateOf(), undefined);
  // And restored bytes bring the chain gate back.
  await fs.writeFile(archPath, arch, "utf8");
  assert.ok((await chainStateOf()) !== "stale");
});
