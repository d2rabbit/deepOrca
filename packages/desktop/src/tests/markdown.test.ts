/**
 * Tests for the markdown sanitizer.
 *
 * Rendered markdown is injected via `dangerouslySetInnerHTML`, and the preload
 * exposes file/settings/Git/MCP/prompt capabilities to whatever page runs in
 * the privileged window — so an XSS in rendered markdown is a path to
 * privileged IPC. These tests are the security boundary: each payload here
 * must come out inert, while legitimate GFM (tables, code fences, links) must
 * survive intact.
 *
 * DOMPurify operates on the real DOM. In node:test we use jsdom (already a
 * devDependency for app-boot.test.ts) to provide `window`/`document`, then
 * point DOMPurify at it before exercising `renderMarkdown`.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

let dom: JSDOM;
// Hold the original global window/document so we can restore them after the
// suite (jsdom must not leak into other test files in the same run).
let originalWindow: unknown;
let originalDocument: unknown;

before(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
  });
  // DOMPurify reads `window` lazily on first sanitize in a non-browser env.
  // Give it a real DOM via jsdom.
  const g = globalThis as { window?: unknown; document?: unknown };
  originalWindow = g.window;
  originalDocument = g.document;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  // Some DOMPurify code paths reference these sub-properties off window.
  (dom.window as unknown as { Node?: unknown }).Node = dom.window.Node;
});

after(() => {
  // Restore — don't leak jsdom into other test files in the same run.
  const g = globalThis as { window?: unknown; document?: unknown };
  g.window = originalWindow;
  g.document = originalDocument;
});

// Imported after the jsdom `before` setup is registered. The module itself
// captures DOMPurify at import time, so we import it inside the test body
// (node:test runs `before` before test callbacks but module imports are
// hoisted — to keep this self-contained we dynamic-import after wiring window).
async function render(text: string): Promise<string> {
  const { renderMarkdown } = await import("../renderer/markdown.js");
  return renderMarkdown(text);
}

// ── Dangerous payloads must come out inert ─────────────────────────────────

test("script tag is stripped entirely", async () => {
  const out = await render("<script>alert(1)</script>text");
  assert.ok(!out.toLowerCase().includes("<script"), `script tag survived: ${out}`);
  assert.ok(!out.toLowerCase().includes("alert"), `script content survived: ${out}`);
});

test("inline event handler is stripped (onclick)", async () => {
  const out = await render('<a href="https://example.com" onclick="alert(1)">x</a>');
  assert.ok(!/onclick/i.test(out), `onclick survived: ${out}`);
  assert.ok(out.includes("https://example.com"), `legitimate href was stripped: ${out}`);
});

test("javascript: URL scheme is blocked in href", async () => {
  const out = await render('<a href="javascript:alert(1)">x</a>');
  assert.ok(!/javascript:/i.test(out), `javascript: scheme survived: ${out}`);
});

test("entity-encoded javascript: URL is blocked", async () => {
  // Parser-differential attack: the HTML entity resolves to "javascript:" after
  // the browser parses it, but a regex sanitizer checking the raw string would
  // miss it. DOMPurify parses with the real DOM and catches it.
  const out = await render('<a href="&#106;avascript:alert(1)">x</a>');
  assert.ok(!/javascript:/i.test(out), `entity-encoded javascript: survived: ${out}`);
});

test("data: URL with text/html is blocked", async () => {
  const out = await render('<a href="data:text/html,<script>alert(1)</script>">x</a>');
  assert.ok(!/data:text\/html/i.test(out), `data:text/html survived: ${out}`);
});

test("iframe, object, embed tags are stripped", async () => {
  const out = await render("<iframe src='https://evil'></iframe><object></object><embed>");
  assert.ok(!/<iframe/i.test(out), `iframe survived: ${out}`);
  assert.ok(!/<object/i.test(out), `object survived: ${out}`);
  assert.ok(!/<embed/i.test(out), `embed survived: ${out}`);
});

test("form and input elements are stripped", async () => {
  const out = await render("<form><input name='x'></form>");
  assert.ok(!/<form/i.test(out), `form survived: ${out}`);
  assert.ok(!/<input/i.test(out), `input survived: ${out}`);
});

test("style attribute is stripped (prevents CSS overlay/clickjacking)", async () => {
  const out = await render('<p style="position:fixed;top:0;left:0;width:100%;height:100%">overlay</p>');
  assert.ok(!/style=/i.test(out), `style attribute survived: ${out}`);
});

test("style element is stripped", async () => {
  const out = await render("<style>body{background:url('javascript:alert(1)')}</style>text");
  assert.ok(!/<style/i.test(out), `style element survived: ${out}`);
});

test("SVG payload is stripped (SVG XSS vector)", async () => {
  const out = await render("<svg><script>alert(1)</script></svg>");
  assert.ok(!/<svg/i.test(out), `svg survived: ${out}`);
  assert.ok(!/alert/.test(out), `svg script content survived: ${out}`);
});

test("MathML payload is stripped", async () => {
  const out = await render("<math><mtext><script>alert(1)</script></mtext></math>");
  assert.ok(!/<math/i.test(out), `math survived: ${out}`);
  assert.ok(!/alert/.test(out), `math script content survived: ${out}`);
});

test("onerror handler on img is stripped", async () => {
  const out = await render('<img src=x onerror="alert(1)">');
  assert.ok(!/onerror/i.test(out), `onerror survived: ${out}`);
});

test("anchor with safe http URL keeps href and gets safe target/rel", async () => {
  const out = await render("<https://example.com>");
  // Markdown autolink produces an <a href="https://example.com">.
  assert.ok(out.includes('href="https://example.com"'), `href was stripped: ${out}`);
  assert.ok(/target="_blank"/.test(out), `safe target missing: ${out}`);
  assert.ok(/rel="noopener noreferrer"/.test(out), `safe rel missing: ${out}`);
});

// ── Legitimate GFM must survive ────────────────────────────────────────────

test("code fence with html inside is rendered as escaped text, not parsed", async () => {
  const out = await render("```html\n<script>alert(1)</script>\n```");
  // The code fence content must be escaped text inside <code>, not a live script.
  assert.ok(!/<script>alert/i.test(out), `script inside code fence was parsed: ${out}`);
  assert.ok(out.includes("&lt;script&gt;"), `code fence content was not escaped: ${out}`);
});

test("GFM table survives sanitization", async () => {
  const out = await render("| a | b |\n| --- | --- |\n| 1 | 2 |");
  assert.ok(/<table>/i.test(out), `table was stripped: ${out}`);
  assert.ok(/<td>1<\/td>/i.test(out), `table cell content was stripped: ${out}`);
});

test("blockquote, list, heading survive", async () => {
  const out = await render("# Title\n\n- item\n\n> quote");
  assert.ok(/<h1/.test(out), `h1 stripped: ${out}`);
  assert.ok(/<ul>/i.test(out), `ul stripped: ${out}`);
  assert.ok(/<li>item<\/li>/i.test(out), `li stripped: ${out}`);
  assert.ok(/<blockquote>/i.test(out), `blockquote stripped: ${out}`);
});

test("inline code and emphasis survive", async () => {
  const out = await render("This is `code` and **bold** and *italic*.");
  assert.ok(/<code>code<\/code>/.test(out), `inline code stripped: ${out}`);
  assert.ok(/<strong>bold<\/strong>/.test(out), `strong stripped: ${out}`);
  assert.ok(/<em>italic<\/em>/.test(out), `em stripped: ${out}`);
});

test("mailto link is allowed", async () => {
  const out = await render("<mailto:user@example.com>");
  assert.ok(/mailto:user@example.com/.test(out), `mailto link stripped: ${out}`);
});

test("relative hash link is allowed", async () => {
  const out = await render("[section](#section)");
  assert.ok(/href="#section"/.test(out), `hash link stripped: ${out}`);
});

test("cached re-render returns the same sanitized result", async () => {
  const payload = "<script>alert(1)</script>**safe**";
  const first = await render(payload);
  const second = await render(payload);
  assert.equal(first, second);
  assert.ok(!/<script/i.test(first), `script survived in cached render: ${first}`);
});

test("empty input returns empty string", async () => {
  assert.equal(await render(""), "");
});

// ── Frontmatter (openwiki pages) ────────────────────────────────────────────

test("leading YAML frontmatter is stripped, not rendered as body junk", async () => {
  const out = await render("---\ntype: architecture\ntitle: T\n---\n\n# Real Title\n\nBody");
  assert.ok(!out.includes("type: architecture"), `frontmatter leaked into body: ${out}`);
  assert.ok(/<h1[^>]*>Real Title/.test(out), `real title missing: ${out}`);
});

test("unclosed frontmatter-like opener is left alone", async () => {
  // `---` without a closing line is a thematic break / setext context, not
  // frontmatter — must pass through untouched.
  const out = await render("---\nplain text");
  assert.ok(out.includes("plain text"), `content lost: ${out}`);
});

test("frontmatter with CRLF line endings is stripped", async () => {
  const out = await render("---\r\ntype: architecture\r\n---\r\n\r\n# Title\r\n\r\nBody");
  assert.ok(!out.includes("type: architecture"), `CRLF frontmatter leaked: ${out}`);
  assert.ok(/<h1[^>]*>Title/.test(out), `title missing after CRLF strip: ${out}`);
});
