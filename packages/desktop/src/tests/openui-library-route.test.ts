import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLibraryMode } from "../renderer/openui/library-route";

test("legacy-only component names route to the legacy deeporcaLibrary", () => {
  assert.equal(resolveLibraryMode('root = Column([Row([Metric("x")])])'), "legacy");
  assert.equal(resolveLibraryMode('f = TextField("q", "search")'), "legacy");
});

test("shared names alone stay on the official library (default for new code)", () => {
  assert.equal(resolveLibraryMode('root = Stack([Card([TextContent("hi")])])'), "official");
  assert.equal(resolveLibraryMode('root = Stack([Button("首页", Action([@Set($page, "home")]))])'), "official");
});

test("official-exclusive names win even when legacy markers also appear", () => {
  // 2026-09-07 review: official prototypes can quote `Row(`/`Column(` inside
  // string literals — the whole program must stay on the official library.
  const officialWithQuotedRow = [
    "root = Stack([tag, table])",
    'tag = Tag("Admin", "sm", "info")',
    'table = Table([[data.Row("a"), "b"]])',
  ].join("\n");
  assert.equal(resolveLibraryMode(officialWithQuotedRow), "official");

  const codeStringCase = [
    'root = Stack([Card([CardHeader("概览"), snippet])])',
    'snippet = CodeBlock("fn demo() { let x = Column(0); }")',
  ].join("\n");
  assert.equal(resolveLibraryMode(codeStringCase), "official");

  // Legacy marker present BUT so is an official-exclusive name → official.
  assert.equal(resolveLibraryMode('t = Tag("x")\nbadge = Column([Badge("y")])'), "official");
});

test("legacy suites still route to the fallback even with look-alike substrings", () => {
  // `Column(` must not match the official-only `Col(` (word boundary).
  assert.equal(resolveLibraryMode("root = Column([Spacer(16)])"), "legacy");
});

test("a declared authoring library wins outright over the name heuristic", () => {
  // M4: suites stamped at creation never guess. A shared-name-only legacy
  // suite (the misroute case that motivated the stamp) routes legacy once
  // declared, and official-exclusive names can't drag a declared legacy
  // suite back to official.
  const sharedOnly = 'root = Stack([Card([TextContent("hi"), Button("保存", "save")])])';
  assert.equal(resolveLibraryMode(sharedOnly), "official", "unstamped → heuristic (known limitation)");
  assert.equal(resolveLibraryMode(sharedOnly, "legacy"), "legacy");
  assert.equal(resolveLibraryMode('root = Column([Metric("x")])', "official"), "official");

  // Null/undefined declared → heuristic, exactly as before the stamp existed.
  assert.equal(resolveLibraryMode('root = Column([Metric("x")])', null), "legacy");
  assert.equal(resolveLibraryMode('root = Column([Metric("x")])', undefined), "legacy");
});
