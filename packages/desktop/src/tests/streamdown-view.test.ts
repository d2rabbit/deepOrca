/**
 * Tests for the StreamdownView renderer — the markdown security boundary.
 *
 * Rendered markdown appears inside the privileged main window, and the
 * preload exposes file/settings/Git/MCP/prompt capabilities to that window —
 * so an XSS in rendered markdown is a path to privileged IPC. These tests pin
 * the boundary: every dangerous payload must come out inert, while legitimate
 * GFM (tables, code fences, links) must survive intact.
 *
 * The pipeline is Streamdown (remark/rehype): raw HTML is parsed by
 * rehype-raw and then filtered by the rehype-sanitize GitHub schema +
 * rehype-harden URL allowlists, rendering to React elements (no
 * dangerouslySetInnerHTML). The assertions below therefore inspect the
 * rendered DOM, not an HTML string.
 *
 * Harness: node:test has no DOM, so dom-harness installs jsdom globals BEFORE
 * @testing-library/react and the component are imported (module-load-time
 * `window` reads — same constraint as app-boot.test.ts).
 */

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, type DomHandle } from "./dom-harness";
// Type-only imports: erased at compile time (verbatimModuleSyntax) — the
// runtime imports happen in before(), after the DOM exists.
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { StreamdownView as StreamdownViewComponent } from "../renderer/components/StreamdownView";

let dom: DomHandle;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let StreamdownView: typeof StreamdownViewComponent;

before(async () => {
  dom = installDom();
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ StreamdownView } = await import("../renderer/components/StreamdownView"));
});

after(() => dom.cleanup());
afterEach(() => rtl.cleanup());

/** Render markdown through StreamdownView and return the container element. */
async function renderMd(markdown: string): Promise<HTMLElement> {
  const utils = rtl.render(ReactPkg.createElement(StreamdownView, { markdown, className: "ui-md" }));
  // Code block bodies are React.lazy inside Streamdown — flush the Suspense
  // resolution before asserting on the DOM.
  await rtl.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return utils.container;
}

// ── Dangerous payloads must come out inert ─────────────────────────────────

test("script tag is stripped entirely", async () => {
  const out = await renderMd("<script>alert(1)</script>text");
  // NOTE: assertions never pass DOM nodes to assert.equal — on failure node
  // would try to deep-format the jsdom element, which effectively hangs.
  assert.ok(!out.querySelector("script"), `script tag survived: ${out.innerHTML}`);
  assert.ok(!out.innerHTML.includes("alert"), `script content survived: ${out.innerHTML}`);
});

test("inline event handler is stripped (onclick)", async () => {
  const out = await renderMd('<a href="https://example.com" onclick="alert(1)">x</a>');
  const link = out.querySelector("a");
  assert.ok(link, `link was stripped entirely: ${out.innerHTML}`);
  assert.equal(link.getAttribute("onclick"), null, `onclick survived: ${out.innerHTML}`);
  // rehype-harden normalizes the URL (adds the trailing slash) — compare the origin.
  assert.ok(
    link.getAttribute("href")?.startsWith("https://example.com"),
    `legitimate href was stripped: ${out.innerHTML}`
  );
});

test("javascript: URL scheme is blocked in href", async () => {
  const out = await renderMd('<a href="javascript:alert(1)">x</a>');
  assert.ok(!/javascript:/i.test(out.innerHTML), `javascript: scheme survived: ${out.innerHTML}`);
});

test("entity-encoded javascript: URL is blocked", async () => {
  // Parser-differential attack: the entity resolves to "javascript:" after the
  // browser parses it, so raw-string filters miss it — the rehype pipeline
  // operates on the parsed tree and catches it.
  const out = await renderMd('<a href="&#106;avascript:alert(1)">x</a>');
  assert.ok(!/javascript:/i.test(out.innerHTML), `entity-encoded javascript: survived: ${out.innerHTML}`);
});

test("data: URL with text/html is blocked", async () => {
  const out = await renderMd('<a href="data:text/html,<script>alert(1)</script>">x</a>');
  assert.ok(!/data:text\/html/i.test(out.innerHTML), `data:text/html survived: ${out.innerHTML}`);
});

test("iframe, object, embed tags are stripped", async () => {
  const out = await renderMd("<iframe src='https://evil'></iframe><object></object><embed>");
  assert.ok(!out.querySelector("iframe"), `iframe survived: ${out.innerHTML}`);
  assert.ok(!out.querySelector("object"), `object survived: ${out.innerHTML}`);
  assert.ok(!out.querySelector("embed"), `embed survived: ${out.innerHTML}`);
});

test("form is stripped; any surviving input is an inert disabled checkbox", async () => {
  const out = await renderMd("<form><input name='x'></form>");
  assert.ok(!out.querySelector("form"), `form survived: ${out.innerHTML}`);
  // The GitHub sanitize schema allows GFM task-list checkboxes through as
  // disabled inputs — inert by construction. What must NOT survive is an
  // interactive input or any event handler.
  const input = out.querySelector("input");
  if (input) {
    assert.equal(input.getAttribute("type"), "checkbox", `non-checkbox input survived: ${out.innerHTML}`);
    assert.ok(input.hasAttribute("disabled"), `interactive input survived: ${out.innerHTML}`);
    for (const attr of Array.from(input.attributes)) {
      assert.ok(!attr.name.startsWith("on"), `event handler ${attr.name} survived: ${out.innerHTML}`);
    }
  }
});

test("style attribute on raw HTML is stripped (prevents CSS overlay/clickjacking)", async () => {
  const out = await renderMd('<p style="position:fixed;top:0;left:0;width:100%;height:100%">overlay</p>');
  const paragraph = Array.from(out.querySelectorAll("p")).find((p) => p.textContent === "overlay");
  assert.ok(paragraph, `paragraph was stripped entirely: ${out.innerHTML}`);
  const style = paragraph.getAttribute("style") ?? "";
  assert.ok(!style.includes("position"), `style attribute survived: ${out.innerHTML}`);
});

test("style element is stripped", async () => {
  const out = await renderMd("<style>body{background:url('javascript:alert(1)')}</style>text");
  assert.ok(!out.querySelector("style"), `style element survived: ${out.innerHTML}`);
});

test("SVG payload is stripped (SVG XSS vector)", async () => {
  const out = await renderMd("<svg><script>alert(1)</script></svg>");
  assert.ok(!out.querySelector("svg"), `svg survived: ${out.innerHTML}`);
  assert.ok(!/alert/.test(out.innerHTML), `svg script content survived: ${out.innerHTML}`);
});

test("MathML payload is stripped", async () => {
  const out = await renderMd("<math><mtext><script>alert(1)</script></mtext></math>");
  assert.ok(!out.querySelector("math"), `math survived: ${out.innerHTML}`);
  assert.ok(!/alert/.test(out.innerHTML), `math script content survived: ${out.innerHTML}`);
});

test("onerror handler on img is stripped", async () => {
  const out = await renderMd('<img src="https://example.com/x.png" onerror="alert(1)">');
  assert.ok(!/onerror/i.test(out.innerHTML), `onerror survived: ${out.innerHTML}`);
});

test("anchor with safe http URL keeps href and gets safe target/rel", async () => {
  const out = await renderMd("<https://example.com>");
  const link = out.querySelector("a");
  assert.ok(link, `autolink was stripped: ${out.innerHTML}`);
  // rehype-harden normalizes the URL (adds the trailing slash).
  assert.ok(link.getAttribute("href")?.startsWith("https://example.com"), `href was stripped: ${out.innerHTML}`);
  assert.equal(link.getAttribute("target"), "_blank", `safe target missing: ${out.innerHTML}`);
  assert.ok((link.getAttribute("rel") ?? "").includes("noopener"), `safe rel missing: ${out.innerHTML}`);
});

// ── Legitimate GFM must survive ────────────────────────────────────────────

test("code fence with html inside is rendered as escaped text, not parsed", async () => {
  const out = await renderMd("```html\n<script>alert(1)</script>\n```");
  assert.ok(!out.querySelector("script"), `script inside code fence was parsed: ${out.innerHTML}`);
  assert.ok(out.textContent?.includes("<script>alert(1)</script>"), `code fence content lost: ${out.innerHTML}`);
});

test("code fence gets a working copy button and language label", async () => {
  const out = await renderMd("```bash\necho hi\n```");
  assert.ok(out.querySelector('[data-streamdown="code-block-copy-button"]'), `copy button missing: ${out.innerHTML}`);
  assert.ok(out.textContent?.includes("bash"), `language label missing: ${out.innerHTML}`);
});

test("GFM table survives sanitization", async () => {
  const out = await renderMd("| a | b |\n| --- | --- |\n| 1 | 2 |");
  assert.ok(out.querySelector("table"), `table was stripped: ${out.innerHTML}`);
  const cell = Array.from(out.querySelectorAll("td")).find((td) => td.textContent === "1");
  assert.ok(cell, `table cell content was stripped: ${out.innerHTML}`);
});

test("blockquote, list, heading survive", async () => {
  const out = await renderMd("# Title\n\n- item\n\n> quote");
  assert.ok(out.querySelector("h1"), `h1 stripped: ${out.innerHTML}`);
  assert.ok(out.querySelector("ul"), `ul stripped: ${out.innerHTML}`);
  const item = Array.from(out.querySelectorAll("li")).find((li) => li.textContent === "item");
  assert.ok(item, `li stripped: ${out.innerHTML}`);
  assert.ok(out.querySelector("blockquote"), `blockquote stripped: ${out.innerHTML}`);
});

test("inline code and emphasis survive", async () => {
  const out = await renderMd("This is `code` and **bold** and *italic*.");
  const code = Array.from(out.querySelectorAll("code")).find((c) => c.textContent === "code");
  assert.ok(code, `inline code stripped: ${out.innerHTML}`);
  const bold = out.querySelector('strong, [data-streamdown="strong"]');
  assert.ok(bold && bold.textContent === "bold", `strong stripped: ${out.innerHTML}`);
  const italic = Array.from(out.querySelectorAll("em")).find((e) => e.textContent === "italic");
  assert.ok(italic, `em stripped: ${out.innerHTML}`);
});

test("mailto link is allowed", async () => {
  const out = await renderMd("<mailto:user@example.com>");
  assert.ok(/mailto:user@example.com/.test(out.innerHTML), `mailto link stripped: ${out.innerHTML}`);
});

test("relative hash link is allowed", async () => {
  const out = await renderMd("[section](#section)");
  const link = out.querySelector("a");
  assert.equal(link?.getAttribute("href"), "#section", `hash link stripped: ${out.innerHTML}`);
});

test("single newlines become line breaks (old marked breaks:true parity)", async () => {
  const out = await renderMd("line one\nline two");
  assert.ok(out.querySelector("br"), `hard break missing: ${out.innerHTML}`);
});

test("empty input renders an empty container", async () => {
  const out = await renderMd("");
  assert.equal(out.textContent, "");
});

// ── JSON pretty-printing (ported from the marked walkTokens hook) ──────────

test("fenced json block is pretty-printed", async () => {
  const out = await renderMd('```json\n{"a":1,"b":[2,3]}\n```');
  const code = out.querySelector("pre code");
  assert.ok(code, `code block missing: ${out.innerHTML}`);
  assert.ok(code.textContent?.includes('"a": 1'), `json was not pretty-printed: ${code.textContent}`);
});

test("malformed json fence is left untouched", async () => {
  const out = await renderMd("```json\n{not json}\n```");
  assert.ok(out.textContent?.includes("{not json}"), `malformed json lost: ${out.innerHTML}`);
});

// ── Frontmatter (openwiki pages) ────────────────────────────────────────────

test("leading YAML frontmatter is stripped, not rendered as body junk", async () => {
  const out = await renderMd("---\ntype: architecture\ntitle: T\n---\n\n# Real Title\n\nBody");
  assert.ok(!out.innerHTML.includes("type: architecture"), `frontmatter leaked into body: ${out.innerHTML}`);
  const heading = out.querySelector("h1");
  assert.equal(heading?.textContent, "Real Title", `real title missing: ${out.innerHTML}`);
});

test("unclosed frontmatter-like opener is left alone", async () => {
  // `---` without a closing line is a thematic break / setext context, not
  // frontmatter — must pass through untouched.
  const out = await renderMd("---\nplain text");
  assert.ok(out.textContent?.includes("plain text"), `content lost: ${out.innerHTML}`);
});

test("frontmatter with CRLF line endings is stripped", async () => {
  const out = await renderMd("---\r\ntype: architecture\r\n---\r\n\r\n# Title\r\n\r\nBody");
  assert.ok(!out.innerHTML.includes("type: architecture"), `CRLF frontmatter leaked: ${out.innerHTML}`);
  const heading = out.querySelector("h1");
  assert.equal(heading?.textContent, "Title", `title missing after CRLF strip: ${out.innerHTML}`);
});
