/**
 * Spec → Marp slides (main tools/spec-slides.ts) — specs/artifact-landing B.
 * Pins:
 *   - plain specs get deeporca front-matter (headingDivider: 2) + a title page,
 *   - documents with their own `marp: true` front-matter pass through byte-for-byte,
 *   - a `## ` inside a fenced code block does NOT split a slide (marpit token
 *     stream is fence-opaque — the reason no hand-rolled splitter exists),
 *   - rendered output is script-free (sandbox/CSP consumers), theme bakes per
 *     appearance, exported document carries the CSP meta.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSlidesHtml,
  buildSlidesMarkdown,
  countRemoteImages,
  hasMarpFrontMatter,
  renderSpecSlides,
  sanitizeSlidesHtml,
} from "../main/tools/spec-slides";

const SPEC = `# 登录模块重设计

产出可演示的登录界面与验收口径。

## 登录页

- 账号密码输入
- 记住我开关

## 验证码页

滑块验证，失败三次后冷却。
`;

test("spec-slides: plain spec → deeporca front-matter + title page", () => {
  const { passthrough, markdown } = buildSlidesMarkdown(SPEC, "登录重设计");
  assert.equal(passthrough, false);
  assert.match(markdown, /^---\nmarp: true\n/);
  assert.match(markdown, /theme: deeporca/);
  assert.match(markdown, /headingDivider: 2/);
  assert.match(markdown, /# 登录重设计/);
  // first paragraph becomes the title-page brief
  assert.match(markdown, /产出可演示的登录界面与验收口径。/);
  // the original spec survives verbatim after the synthesized header
  assert.ok(markdown.endsWith(SPEC));
});

test("spec-slides: existing marp front-matter passes through byte-for-byte", () => {
  const native = `---
marp: true
theme: gaia
paginate: true
---

# 原生 marp

---
自己的分页自己管。
`;
  const out = buildSlidesMarkdown(native, "title");
  assert.equal(out.passthrough, true);
  assert.equal(out.markdown, native);
  assert.equal(hasMarpFrontMatter(native), true);
  assert.equal(hasMarpFrontMatter(SPEC), false);
});

test("spec-slides: render splits at # and ## headings; code-fence ## does NOT split; no scripts", async () => {
  // Empirical marpit behavior (pinned): headingDivider: 2 splits at levels 1–2,
  // and a `## ` inside a fenced code block never splits (fence token is opaque).
  const base = await renderSpecSlides(SPEC, { title: "登录重设计" });
  // title page | # 登录模块重设计 | ## 登录页 | ## 验证码页
  assert.equal(base.pages, 4);

  const withFence = await renderSpecSlides(`${SPEC}\`\`\`bash\n## 这只是注释，不是标题\n\`\`\`\n`, {
    title: "登录重设计",
  });
  assert.equal(withFence.pages, base.pages);
  assert.ok(withFence.html.includes("这只是注释"));
  assert.ok(!withFence.html.includes("<script"));
  assert.ok(withFence.css.length > 0);
  assert.equal(withFence.remoteImages, 0);
});

test("spec-slides: remote images counted, theme bakes per appearance, export doc carries CSP", async () => {
  const withImages = await renderSpecSlides(
    `${SPEC}\n![logo](https://example.com/logo.png)\n<img src="https://cdn.example.com/x.png" />`,
    {
      title: "t",
    }
  );
  assert.equal(withImages.remoteImages, 2);
  const dark = await renderSpecSlides(SPEC, { title: "t", appearance: "dark" });
  const light = await renderSpecSlides(SPEC, { title: "t" });
  assert.notEqual(dark.css, light.css);
  assert.ok(dark.css.includes("#16181d"));
  assert.ok(light.css.includes("#fbfbfd"));

  const doc = buildSlidesHtml(withImages.html, withImages.css, "登录 <重设计>");
  assert.ok(doc.startsWith("<!doctype html>"));
  assert.ok(doc.includes('Content-Security-Policy" content="default-src'));
  assert.ok(doc.includes("登录 &lt;重设计&gt;"));
});

test("spec-slides: a planted meta refresh never reaches the deck as a live tag (user ask 2026-09-09)", async () => {
  // marp-core's sanitizer escapes disallowed raw HTML; the render chokepoint's
  // own strip is the second line (it must survive marp-core upgrades — the
  // invariant is navigation-proof output, not a particular sanitizer version).
  const withRefresh = await renderSpecSlides(
    `${SPEC}\n\n<meta http-equiv="refresh" content="0;url=https://evil.example">\n`,
    { title: "t" }
  );
  assert.ok(!/<meta[\s>]/i.test(withRefresh.html), "no live <meta> tag survives the render");
  assert.ok(withRefresh.html.includes("&lt;meta"), "the planted tag degrades to display text");

  // The chokepoint strip itself, however the tag is spelled.
  assert.equal(sanitizeSlidesHtml('<section><META HTTP-EQUIV="Refresh" CONTENT="5"></section>'), "<section></section>");
  assert.equal(
    sanitizeSlidesHtml("<section><meta http-equiv='refresh' content='0;url=x'></section>"),
    "<section></section>"
  );
  // Non-refresh metas are none of this layer's business.
  assert.equal(sanitizeSlidesHtml('<meta charset="utf-8">'), '<meta charset="utf-8">');

  // form-action does not fall back to default-src — pinned explicitly.
  const doc = buildSlidesHtml(withRefresh.html, withRefresh.css, "t");
  assert.ok(doc.includes("form-action 'none'"));
});
