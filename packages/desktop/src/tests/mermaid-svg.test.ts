/**
 * SVG post-processing round-trips (decorateMermaidSvg).
 *
 * The regressing case (real-machine 2026-08-29 "整体架构还是这么小"): mermaid in
 * htmlLabels mode emits the HTML void form `<br>` inside foreignObject label
 * HTML. XML parsing rejected it, the parse-failure guards of both passes
 * no-oped, and the arch-card fit then measured the CSS-collapsed 300px
 * replaced-element default as "natural" size — a 1800px-wide chart rendered
 * as ~540px mush. The pipeline now self-closes void tags before parsing.
 */

import { strict as assert } from "node:assert";
import test, { after } from "node:test";
import { installDom } from "./dom-harness";

const dom = installDom();
// The harness installs window/document but not the XML pair these passes use
// as bare globals in the renderer bundle.
const g = globalThis as unknown as Record<string, unknown>;
const win = g.window as unknown as Window & typeof globalThis;
g.DOMParser = win.DOMParser;
g.XMLSerializer = win.XMLSerializer;

// Imported AFTER installDom (dom-harness ordering rule).
const { decorateMermaidSvg } = await import("../renderer/mermaid.js");

/** Mermaid-shaped flowchart svg: responsive attrs + foreignObject label HTML
 *  carrying the HTML void `<br>` — the exact shape that used to break parsing. */
const SVG_WITH_VOID_BR =
  '<svg id="t1" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width: 600px;" viewBox="0 0 600 400" role="graphics-document document">' +
  '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><span class="edgeLabel"><p>同一进程<br>两种模式</p></span></div></foreignObject>' +
  '<g class="node default" id="n1"><rect class="basic label-container"></rect></g>' +
  "</svg>";

test("decorateMermaidSvg survives a <br> label (XML round-trip keeps void tags closed)", () => {
  const out = decorateMermaidSvg(SVG_WITH_VOID_BR);
  assert.notEqual(out, SVG_WITH_VOID_BR, "the decorate pass must actually run");
  assert.match(out, /同一进程<br\s*\/>两种模式/, "label content survives with the void tag closed");
  assert.doesNotMatch(out, /<br>/, "…never left in HTML void form");
});

test("decorateMermaidSvg keeps already self-closed tags intact", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 300 150">' +
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">a<br/>b</div></foreignObject></svg>';
  const out = decorateMermaidSvg(svg);
  assert.match(out, /a<br\s*\/>b/);
  assert.doesNotMatch(out, /<br\s*\/\/>/);
});

test("decorateMermaidSvg still fail-opens on hopeless input", () => {
  const garbage = "<svg><g><unclosed>text";
  assert.equal(decorateMermaidSvg(garbage), garbage);
});

test("decorateMermaidSvg decorates nodes on a <br>-carrying svg", () => {
  // Pre-fix, the parse failure made decorate return the svg UNDECORATED —
  // charts with line-broken labels silently lost their hue paint.
  const out = decorateMermaidSvg(SVG_WITH_VOID_BR);
  assert.notEqual(out, SVG_WITH_VOID_BR, "the decorate pass must actually run");
  assert.match(out, /class="node default do-node/, "g.node must gain the do-node hue class");
  assert.match(out, /同一进程<br\s*\/>两种模式/, "label content survives the round-trip");
});

after(() => {
  dom.cleanup();
  delete g.DOMParser;
  delete g.XMLSerializer;
});
