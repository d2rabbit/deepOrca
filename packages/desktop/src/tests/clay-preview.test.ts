// buildClayPreviewHtml（clay-ui-runtime WP3）— 自包含 preview.html 生成回归：
// 树/wasm/横幅齐全；跳过计数进入横幅；标题转义。纯字符串构建，无 DOM。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClayPreviewHtml } from "../main/tools/clay/clay-preview-html";
import { compileLeaferToClayTree } from "../main/tools/clay/compile-leafer-to-clay";

const DOC = {
  tag: "Leafer",
  width: 1280,
  height: 800,
  fill: "#f4f5f8",
  children: [{ tag: "Text", x: 10, y: 10, text: "深度编排器样张", fontSize: 16 }],
};

test("preview.html embeds wasm base64, compiled tree and canvas size", () => {
  const built = buildClayPreviewHtml({
    title: "样张",
    doc: DOC,
    wasmBase64: "QUJD",
    canvasWidth: 1280,
    canvasHeight: 800,
  });
  assert.ok(built.html.includes('"width":1280'), "tree embeds canvas width");
  assert.ok(built.html.includes("QUJD"), "wasm base64 embedded");
  assert.ok(built.html.includes("深度编排器样张"), "text copy embedded");
  assert.ok(built.html.includes("bind_decl_reset"), "bind protocol glue present");
  assert.equal(built.skipped.length, 0);
  assert.equal(built.degraded, 0);
});

test("skip/degrade stats surface as a visible banner", () => {
  const docWithSkip = {
    tag: "Leafer",
    width: 800,
    height: 600,
    children: [
      { tag: "Image", name: "hero-img", x: 0, y: 0, width: 100, height: 100 },
      { tag: "Ellipse", x: 0, y: 0, width: 60, height: 60 },
    ],
  };
  const built = buildClayPreviewHtml({
    title: "降级样例",
    doc: docWithSkip,
    wasmBase64: "QUJD",
    canvasWidth: 800,
    canvasHeight: 600,
  });
  assert.match(built.html, /1 个图元被跳过/);
  assert.match(built.html, /1 处样式近似降级/);
  assert.ok(built.html.includes("hero-img"));
  assert.ok(built.degraded >= 1);
});

test("title is html-escaped", () => {
  const built = buildClayPreviewHtml({
    title: "<script>alert(1)</script>",
    doc: { tag: "Leafer", width: 800, height: 600 },
    wasmBase64: "QUJD",
    canvasWidth: 800,
    canvasHeight: 600,
  });
  assert.ok(!built.html.includes("<script>alert(1)</script>"));
  assert.ok(built.html.includes("&lt;script&gt;"));
});
