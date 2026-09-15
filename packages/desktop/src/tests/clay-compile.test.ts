// compile-leafer-to-clay（clay-ui-runtime WP2）— 确定性编译器回归：
// 同输入字节级同输出（键序不敏感）、映射降级表、跳过/降级计数。纯函数，无 DOM。
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileLeaferToClayTree } from "../main/tools/clay/compile-leafer-to-clay";

test("solid fills map to backgrounds; root keeps canvas size", () => {
  const doc = {
    tag: "Leafer",
    width: 1440,
    height: 1024,
    fill: "#f4f5f8",
    children: [{ tag: "Rect", x: 40, y: 40, width: 200, height: 80, fill: "#3b82f6" }],
  };
  const { tree, stats } = compileLeaferToClayTree(doc);
  assert.deepEqual(tree?.background, [244, 245, 248, 255]);
  assert.equal(stats.nodes, 1);
});

test("gradient fill degrades to first stop color and counts", () => {
  const doc = {
    tag: "Leafer",
    width: 800,
    height: 600,
    children: [
      {
        tag: "Rect",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        fill: {
          type: "linear",
          stops: [
            { offset: 0, color: "#ff0000" },
            { offset: 1, color: "#0000ff" },
          ],
        },
      },
    ],
  };
  const { tree, stats } = compileLeaferToClayTree(doc);
  assert.equal(stats.degraded, 1);
  assert.deepEqual(tree?.children?.[0]?.background, [255, 0, 0, 255]);
});

test("ellipse degrades to rounded rect with half-dimension radius", () => {
  const doc = {
    tag: "Leafer",
    width: 800,
    height: 600,
    children: [{ tag: "Ellipse", x: 10, y: 10, width: 80, height: 40 }],
  };
  const { tree } = compileLeaferToClayTree(doc);
  assert.equal(tree?.children?.[0]?.radius, 20);
  assert.equal(tree?.children?.[0]?.background, undefined);
});

test("image/path/line are skipped with labels; counts recorded", () => {
  const doc = {
    tag: "Leafer",
    width: 800,
    height: 600,
    children: [
      { tag: "Image", name: "hero-img", x: 0, y: 0, width: 100, height: 100, url: "a.png" },
      { tag: "Path", name: "squiggle", x: 0, y: 0 },
      { tag: "Line", x: 0, y: 0 },
    ],
  };
  const { tree, stats } = compileLeaferToClayTree(doc);
  assert.equal(tree?.children?.length ?? 0, 0);
  assert.equal(stats.skipped.length, 3);
  assert.ok(stats.skipped[0].startsWith("Image · hero-img"));
});

test("determinism: same input twice → byte-equal output; key order irrelevant", () => {
  const doc = {
    tag: "Leafer",
    fill: "#f4f5f8",
    width: 800,
    height: 600,
    children: [{ tag: "Text", y: 20, x: 10, text: "你好", fontSize: 14 }],
  };
  const reordered = {
    height: 600,
    children: [{ fontSize: 14, text: "你好", x: 10, y: 20, tag: "Text" }],
    width: 800,
    fill: "#f4f5f8",
    tag: "Leafer",
  };
  const a = JSON.stringify(compileLeaferToClayTree(doc));
  const b = JSON.stringify(compileLeaferToClayTree(reordered));
  assert.equal(a, b, "byte-identical output regardless of input key order");
});

test("text nodes keep copy, font size and computed line height", () => {
  const doc = {
    tag: "Leafer",
    width: 800,
    height: 600,
    children: [{ tag: "Text", x: 5, y: 5, text: "你好", fontSize: 14 }],
  };
  const { tree } = compileLeaferToClayTree(doc);
  const textNode = tree?.children?.[0];
  assert.equal(textNode?.kind, "text");
  assert.equal(textNode?.text, "你好");
  assert.equal(textNode?.fontSize, 14);
  assert.equal(textNode?.lineHeight, 19.6);
});
