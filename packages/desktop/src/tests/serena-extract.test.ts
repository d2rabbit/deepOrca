/**
 * Serena extraction tests (specs/index-knowledge-rework R3-6): targeted
 * per-tool view extraction from serena's semi-structured output, and the
 * conversation scanner that feeds the floating panel.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSerenaView, scanSerenaEvents, serenaShortTool } from "../renderer/lib/serena-extract";
import type { SessionMessage } from "@deeporca/core";

function toolMessage(id: string, name: string, output: string): SessionMessage {
  return {
    id,
    sessionId: "s1",
    role: "tool",
    content: JSON.stringify({ ok: true, name, output }),
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString(),
  };
}

test("find_symbol output → symbols view with file/line/body blocks", () => {
  const output = [
    "===== [1/2] findRootNodes (function) =====",
    "<file>src/session.ts</file>",
    "<line>510</line>",
    "<body>",
    "export function findRootNodes() {",
    "  return roots;",
    "}",
    "</body>",
    "===== [2/2] getBridge (function) =====",
    "<file>src/main/index.ts</file>",
    "<line>200</line>",
    "<body>",
    "function getBridge() { return bridge; }",
    "</body>",
  ].join("\n");
  const view = extractSerenaView("find_symbol", output);
  assert.equal(view.kind, "symbols");
  if (view.kind !== "symbols") return;
  assert.equal(view.symbols.length, 2);
  assert.equal(view.symbols[0]?.filePath, "src/session.ts");
  assert.equal(view.symbols[0]?.line, 510);
  assert.ok(view.symbols[0]?.body?.includes("findRootNodes"));
});

test("find_referencing_symbols output → references view (tagged + plain fallback)", () => {
  const tagged = ["<file>a.ts</file><line>10</line>", "<file>b.ts</file><line>99</line>"].join("\n");
  const view = extractSerenaView("find_referencing_symbols", tagged);
  assert.equal(view.kind, "references");
  if (view.kind === "references") {
    assert.equal(view.references.length, 2);
    assert.equal(view.references[1]?.line, 99);
  }
  const plain = extractSerenaView("get_references_overview", "src/x.ts:5\nsrc/y.ts:12\nsrc/y.ts:40");
  assert.equal(plain.kind, "references");
  if (plain.kind === "references") assert.equal(plain.references.length, 3);
});

test("get_symbols_overview output → overview view grouped by file", () => {
  const output = [
    "packages/core/src/session.ts",
    "  createSession (function) : 900",
    "  replySession (function) : 980",
    "packages/core/src/prompt.ts",
    "  buildPrompt (function) : 12",
  ].join("\n");
  const view = extractSerenaView("get_symbols_overview", output);
  assert.equal(view.kind, "overview");
  if (view.kind !== "overview") return;
  assert.equal(view.files.length, 2);
  assert.ok(view.files[0]?.symbols.some((s) => s.name === "createSession"));
});

test("search_for_pattern output → matches view with path:line heads", () => {
  const output = ["src/a.ts:42", "  const x = findRootNodes();", "", "src/b.ts:7", "  await findRootNodes();"].join(
    "\n"
  );
  const view = extractSerenaView("search_for_pattern", output);
  assert.equal(view.kind, "matches");
  if (view.kind === "matches") {
    assert.equal(view.matches.length, 2);
    assert.ok(view.matches[0]?.snippet.includes("findRootNodes"));
  }
});

test("unknown tools fall back to raw view; unknown tools never throw", () => {
  const view = extractSerenaView("create_file", "wrote 100 lines");
  assert.equal(view.kind, "raw");
});

test("scanSerenaEvents picks only serena tool results, newest last", () => {
  const messages = [
    toolMessage("m1", "bash", "ls"),
    toolMessage("m2", "mcp__serena__find_symbol", "<file>x.ts</file><line>1</line><body>ok</body>"),
    toolMessage("m3", "mcp__codegraph__codegraph_search", "{}"),
    toolMessage("m4", "mcp__serena__get_symbols_overview", "x.ts\n  foo (function) : 1"),
  ];
  const events = scanSerenaEvents(messages);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.tool, "find_symbol");
  assert.equal(events[1]?.tool, "get_symbols_overview");
  assert.equal(serenaShortTool("mcp__serena__find_symbol"), "find_symbol");
});
