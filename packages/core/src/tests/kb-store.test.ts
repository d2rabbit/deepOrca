/**
 * kb-store unit tests — the pure read surface over the generated knowledge
 * base (deepwiki pages + archify architecture maps) that the kb MCP server
 * (desktop kb-mcp.ts) exposes to agent sessions. Fixtures are real temp-dir
 * stores: OKF frontmatter pages in modules/ subdirs, typed-IR artifacts with
 * delivered HTML siblings, hollow leftovers, and escape attempts.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  kbOverview,
  listWikiPages,
  readWikiPage,
  searchWikiPages,
  listArchDiagrams,
  readArchDiagram,
} from "../common/kb-store";
import { WIKI_STORE_DIR } from "../common/generated-dirs";

let root: string;

before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-kb-store-")));

  // Wiki store: top-level page + modules/ subdir page + a skeleton-sized page.
  const wikiDir = path.join(root, WIKI_STORE_DIR);
  fs.mkdirSync(path.join(wikiDir, "modules"), { recursive: true });
  fs.writeFileSync(
    path.join(wikiDir, "architecture.md"),
    [
      "---",
      "title: 架构总览",
      "type: overview",
      "tags: [arch, core]",
      "---",
      "",
      "# 架构总览",
      "",
      "系统分为三层。",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(wikiDir, "modules", "auth.md"),
    ["---", "title: 认证模块", "type: module", "---", "", "# 认证模块", "", "认证走 JWT 与刷新令牌。"].join("\n")
  );
  fs.writeFileSync(path.join(wikiDir, "stub.md"), "# x");
  // 仪表盘守卫的对照物:失败 init 的骨架 index.md(≤512B)+ 双语阶段遗留变体页,
  // 都不得作为页面被列举(kb-store 头注声明的探针 parity)。
  fs.writeFileSync(path.join(wikiDir, "index.md"), "# index");
  fs.writeFileSync(
    path.join(wikiDir, "architecture.zh.md"),
    ["---", "title: 架构总览(旧双语变体)", "---", "", "legacy"].join("\n")
  );

  // Architecture maps: one delivered architecture IR + a hollow leftover.
  const protoDir = path.join(root, ".deeporca", "prototypes");
  fs.mkdirSync(protoDir, { recursive: true });
  const ir = {
    schema_version: 1,
    diagram_type: "architecture",
    meta: {
      title: "示例系统架构",
      views: [{ id: "main", label: "主链路", focus: ["a", "b"], note: "a → b" }],
    },
    layout: { rows: 2 },
    components: [
      { id: "a", type: "module", label: "模块 A" },
      { id: "b", type: "module", label: "模块 B" },
    ],
    boundaries: [{ kind: "region", label: "边界", wraps: ["a"] }],
    connections: [{ id: "a-to-b", from: "a", to: "b", label: "调用" }],
  };
  fs.writeFileSync(path.join(protoDir, "arch-demo.architecture.json"), JSON.stringify(ir));
  fs.writeFileSync(path.join(protoDir, "arch-demo.architecture.html"), "<html>delivered</html>");
  fs.writeFileSync(path.join(protoDir, "arch-hollow.workflow.json"), "{}");
  // Non-arch file must be ignored.
  fs.writeFileSync(path.join(protoDir, "notes.md"), "not a diagram");
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("listWikiPages walks subdirectories and parses OKF frontmatter", () => {
  const pages = listWikiPages(root);
  const names = pages.map((p) => p.name);
  assert.ok(names.includes("architecture"), "top-level page listed");
  assert.ok(names.includes("modules/auth"), "subdir page listed with store-relative name");
  assert.ok(!names.includes("index"), "skeleton index.md (≤512B) not counted as a page");
  assert.ok(!names.includes("architecture.zh"), "legacy bilingual variant not counted as a page");
  const auth = pages.find((p) => p.name === "modules/auth")!;
  assert.equal(auth.title, "认证模块");
  assert.equal(auth.type, "module");
  assert.ok(auth.sizeBytes > 0);
});

test("readWikiPage strips frontmatter, pages long bodies, and rejects escapes", () => {
  const page = readWikiPage(root, "modules/auth");
  assert.equal(page.meta.title, "认证模块");
  assert.ok(page.body.includes("JWT"));
  assert.ok(!page.body.includes("title:"));
  assert.equal(page.truncated, false);

  const sliced = readWikiPage(root, "architecture", { offset: 0, limit: 5 });
  assert.equal(sliced.truncated, true);
  assert.equal(sliced.body.length, 5);

  assert.throws(() => readWikiPage(root, "../outside"), /escapes/);
  assert.throws(() => readWikiPage(root, "no-such-page"), /no such page/);
});

test("searchWikiPages finds hits across pages with line numbers", () => {
  const hits = searchWikiPages(root, "jwt");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].page, "modules/auth");
  assert.ok(hits[0].line > 0);
  assert.ok(hits[0].text.includes("JWT"));

  assert.deepEqual(searchWikiPages(root, "   "), [], "blank query → no hits");
  assert.deepEqual(searchWikiPages(root, "不存在的关键词xyz"), []);
});

test("listArchDiagrams lists typed-IR artifacts, skips hollow leftovers and non-arch files", () => {
  const diagrams = listArchDiagrams(root);
  assert.equal(diagrams.length, 1);
  const diag = diagrams[0];
  assert.equal(diag.name, "arch-demo.architecture");
  assert.equal(diag.type, "architecture");
  assert.equal(diag.title, "示例系统架构");
  assert.equal(diag.components, 2);
  assert.equal(diag.connections, 1);
  assert.equal(diag.htmlDelivered, true);
});

test("readArchDiagram returns knowledge-dense IR fields and rejects escapes", () => {
  const diag = readArchDiagram(root, "arch-demo.architecture");
  assert.equal(diag.title, "示例系统架构");
  assert.deepEqual(diag.views, [{ id: "main", label: "主链路", focus: ["a", "b"], note: "a → b" }]);
  assert.equal((diag.components as unknown[]).length, 2);
  assert.equal((diag.connections as unknown[]).length, 1);
  assert.equal("layout" in diag, false, "pixel layout is render detail, excluded");

  assert.throws(() => readArchDiagram(root, "../evil"), /escapes/);
  // 空心残留(≤256B)与 list 同规:不收录、不可读。
  assert.throws(() => readArchDiagram(root, "arch-hollow.workflow"), /hollow leftover/);
  assert.throws(() => readArchDiagram(root, "not-a-diagram"), /archify typed-IR/);
});

test("kbOverview aggregates both sources", () => {
  const overview = kbOverview(root);
  assert.equal(overview.wiki.present, true);
  assert.ok(overview.wiki.pageCount >= 2);
  assert.ok(overview.wiki.pages.some((p) => p.name === "architecture"));
  assert.equal(overview.diagrams.present, true);
  assert.equal(overview.diagrams.count, 1);
  assert.equal(overview.diagrams.items[0].name, "arch-demo.architecture");
});

test("kbOverview on an empty project resolves to empty, not an error", () => {
  const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-kb-empty-")));
  try {
    const overview = kbOverview(empty);
    assert.equal(overview.wiki.present, false);
    assert.equal(overview.wiki.pageCount, 0);
    assert.equal(overview.diagrams.present, false);
    assert.deepEqual(listWikiPages(empty), []);
    assert.deepEqual(listArchDiagrams(empty), []);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
