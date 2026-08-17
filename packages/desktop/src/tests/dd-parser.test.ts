import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDdFile } from "../renderer/dd/parser";
import { compileDdToHtml } from "../renderer/dd/compiler";

const SAMPLE_DD = `---
name: Test Landing
system: dark-tech
style: glassmorphism
version: "1.0"
tokens:
  bg: "#0a0a0a"
  surface: "#1a1a1a"
  accent: "#3b82f6"
  text: "#f5f5f5"
  muted: "#888888"
sections:
  - id: hero
    type: hero
  - id: features
    type: features
---

<!-- dd:section hero -->
<section data-dd-id="hero">
  <h1>Hello World</h1>
  <a href="#" class="btn btn-primary">Click Me</a>
</section>
<!-- /dd:section -->

<!-- dd:section features -->
<section data-dd-id="features">
  <div class="card">Feature 1</div>
</section>
<!-- /dd:section -->`;

test("parseDdFile extracts YAML front-matter metadata", () => {
  const doc = parseDdFile(SAMPLE_DD);
  assert.equal(doc.hasFrontMatter, true);
  assert.equal(doc.meta.name, "Test Landing");
  assert.equal(doc.meta.system, "dark-tech");
  assert.equal(doc.meta.style, "glassmorphism");
  assert.equal(doc.meta.version, "1.0");
});

test("parseDdFile extracts design tokens", () => {
  const doc = parseDdFile(SAMPLE_DD);
  assert.equal(doc.meta.tokens.bg, "#0a0a0a");
  assert.equal(doc.meta.tokens.surface, "#1a1a1a");
  assert.equal(doc.meta.tokens.accent, "#3b82f6");
  assert.equal(doc.meta.tokens.text, "#f5f5f5");
  assert.equal(doc.meta.tokens.muted, "#888888");
});

test("parseDdFile extracts section manifest", () => {
  const doc = parseDdFile(SAMPLE_DD);
  assert.equal(doc.meta.sections.length, 2);
  assert.equal(doc.meta.sections[0].id, "hero");
  assert.equal(doc.meta.sections[0].type, "hero");
  assert.equal(doc.meta.sections[1].id, "features");
  assert.equal(doc.meta.sections[1].type, "features");
});

test("parseDdFile extracts HTML sections with markers", () => {
  const doc = parseDdFile(SAMPLE_DD);
  assert.equal(doc.sections.length, 2);
  assert.equal(doc.sections[0].id, "hero");
  assert.ok(doc.sections[0].html.includes("Hello World"));
  assert.ok(doc.sections[0].html.includes("btn-primary"));
  assert.equal(doc.sections[1].id, "features");
  assert.ok(doc.sections[1].html.includes("Feature 1"));
});

test("parseDdFile body has section markers stripped", () => {
  const doc = parseDdFile(SAMPLE_DD);
  assert.ok(!doc.body.includes("dd:section"));
  assert.ok(doc.body.includes("<section"));
  assert.ok(doc.body.includes("Hello World"));
});

test("parseDdFile handles missing front-matter gracefully", () => {
  const htmlOnly = "<div>No front-matter here</div>";
  const doc = parseDdFile(htmlOnly);
  assert.equal(doc.hasFrontMatter, false);
  assert.equal(doc.meta.name, "");
  assert.equal(doc.sections.length, 0);
  assert.ok(doc.body.includes("No front-matter"));
});

test("compileDdToHtml produces valid HTML document", () => {
  const doc = parseDdFile(SAMPLE_DD);
  const html = compileDdToHtml(doc, undefined);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("<html"));
  assert.ok(html.includes("<head>"));
  assert.ok(html.includes("<body>"));
  assert.ok(html.includes("Hello World"));
});

test("compileDdToHtml injects design tokens as CSS root variables", () => {
  const doc = parseDdFile(SAMPLE_DD);
  const html = compileDdToHtml(doc, undefined);
  assert.ok(html.includes("--bg: #0a0a0a"));
  assert.ok(html.includes("--surface: #1a1a1a"));
  assert.ok(html.includes("--accent: #3b82f6"));
});

test("compileDdToHtml inlines Tailwind script when provided", () => {
  const doc = parseDdFile(SAMPLE_DD);
  const html = compileDdToHtml(doc, "console.log('tailwind');");
  assert.ok(html.includes("<script>console.log('tailwind');</script>"));
});

test("compileDdToHtml omits Tailwind when not provided", () => {
  const doc = parseDdFile(SAMPLE_DD);
  const html = compileDdToHtml(doc, undefined);
  assert.ok(!html.includes("<script>"));
});

test("compileDdToHtml escapes HTML in title", () => {
  const doc = parseDdFile(SAMPLE_DD);
  doc.meta.name = '<script>alert("xss")</script>';
  const html = compileDdToHtml(doc, undefined);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>alert"));
});

test("compileDdToHtml includes seed CSS classes", () => {
  const doc = parseDdFile(SAMPLE_DD);
  const html = compileDdToHtml(doc, undefined);
  assert.ok(html.includes(".btn-primary"));
  assert.ok(html.includes(".card"));
  assert.ok(html.includes(".container"));
  assert.ok(html.includes(".eyebrow"));
});

// ── Security: sanitizeDdBody strips XSS vectors ──────────────────────────────

test("sanitizeDdBody strips <script> blocks from body", () => {
  const doc = parseDdFile('<section><script>alert("xss")</script><h1>ok</h1></section>');
  const html = compileDdToHtml(doc, undefined);
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!/alert\("xss"\)/.test(html));
  // Legit content survives.
  assert.ok(html.includes("ok"));
});

test("compileDdToHtml sanitizes <script> injected via .dd body", () => {
  const malicious = "---\nname: t\n---\n\n<section><script>fetch('//evil')</script><p>hi</p></section>";
  const doc = parseDdFile(malicious);
  const html = compileDdToHtml(doc, undefined);
  assert.ok(!html.includes("fetch('//evil')"));
  // The body <script> must not survive — only the Tailwind <script> tag may
  // appear, and only when a tailwindScript is passed.
  assert.ok(!/<script>alert|<script>fetch/.test(html));
});

test("sanitizeDdBody strips inline event handlers", () => {
  const doc = parseDdFile('<section><img src=x onerror="alert(1)"><a href="#" onclick="steal()">link</a></section>');
  const html = compileDdToHtml(doc, undefined);
  assert.ok(!/onerror/i.test(html));
  assert.ok(!/onclick/i.test(html));
  assert.ok(html.includes("link"));
});

test("sanitizeDdBody neutralizes javascript: URLs", () => {
  const doc = parseDdFile('<section><a href="javascript:alert(1)">x</a><a href="/ok">y</a></section>');
  const html = compileDdToHtml(doc, undefined);
  assert.ok(!/javascript:alert/i.test(html));
  assert.ok(html.includes('href="/ok"'));
});

test("sanitizeDdBody strips form/input elements", () => {
  const doc = parseDdFile(
    "<section><form action='//evil'><input name='pw' type='password'></form><p>content</p></section>"
  );
  const html = compileDdToHtml(doc, undefined);
  assert.ok(!/<form/i.test(html));
  assert.ok(!/<input/i.test(html));
  assert.ok(html.includes("content"));
});

test("sanitizeDdBody strips iframe/object/embed", () => {
  const doc = parseDdFile(
    "<section><iframe src='//evil'></iframe><object data='//x'></object><embed src='//y'></section>"
  );
  const html = compileDdToHtml(doc, undefined);
  assert.ok(!/<iframe/i.test(html));
  assert.ok(!/<object/i.test(html));
  assert.ok(!/<embed/i.test(html));
});

test("tokensToCss drops values capable of CSS injection", () => {
  const doc = parseDdFile("<section>x</section>");
  doc.meta.tokens = { bg: "red;} *{background:url(//evil)} .x{", accent: "#3b82f6" };
  const html = compileDdToHtml(doc, undefined);
  // Malicious bg token is rejected entirely; only the safe accent survives.
  assert.ok(!html.includes("//evil"));
  assert.ok(!html.includes("--bg:"));
  assert.ok(html.includes("--accent: #3b82f6"));
});

test("parser accepts hyphenated token keys (e.g. font-display)", () => {
  const dd = "---\nname: t\ntokens:\n  font-display: Inter\n  font-body: system-ui\n---\n\n<section>x</section>";
  const doc = parseDdFile(dd);
  assert.equal(doc.meta.tokens["font-display"], "Inter");
  assert.equal(doc.meta.tokens["font-body"], "system-ui");
  const html = compileDdToHtml(doc, undefined);
  assert.ok(html.includes("--font-display: Inter"));
});
