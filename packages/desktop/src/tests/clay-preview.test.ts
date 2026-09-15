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

// ── 2026-09-15 bug-hunt 回归 ─────────────────────────────────────────────────

test("canvas dimensions come from options, not a hardcoded 1280x800", () => {
  const built = buildClayPreviewHtml({
    title: "移动端样张",
    doc: { tag: "Leafer", width: 375, height: 812 },
    wasmBase64: "QUJD",
    canvasWidth: 375,
    canvasHeight: 812,
  });
  assert.ok(built.html.includes('const CANVAS = {"width":375,"height":812}'));
});

test("user text with $-patterns and </script> payloads embeds safely", () => {
  const built = buildClayPreviewHtml({
    title: "注入样张",
    doc: {
      tag: "Leafer",
      width: 400,
      height: 300,
      children: [{ tag: "Text", x: 1, y: 1, text: "价格 $$99 与 $& 以及 </script><b>pwn" }],
    },
    wasmBase64: "QUJD",
    canvasWidth: 400,
    canvasHeight: 300,
  });
  assert.ok(built.html.includes("价格 $$99 与 $&"), "$$ / $& must survive String.replace");
  assert.ok(!built.html.includes("</script><b>"), "raw script-closer must not appear");
  assert.ok(built.html.includes("\\u003c/script>"), "payload escaped inside the embedded JSON");
});

test("GLUE init orders bind_begin before walk (Clay resets the arena on BeginLayout)", () => {
  // 结构性 tripwire（源码定位断言）：假红时先在浏览器复核 preview 再改测试。
  const built = buildClayPreviewHtml({
    title: "t",
    doc: { tag: "Leafer", width: 10, height: 10 },
    wasmBase64: "QUJD",
    canvasWidth: 10,
    canvasHeight: 10,
  });
  const initStart = built.html.indexOf("function init()");
  const beginPos = built.html.indexOf("instance.exports.bind_begin", initStart);
  const walkPos = built.html.indexOf("walk(TREE);", initStart);
  assert.ok(initStart !== -1 && beginPos !== -1 && walkPos !== -1);
  assert.ok(beginPos < walkPos, "walk must build the tree AFTER bind_begin resets ephemeral memory");
});

test("GLUE defines wrapCJK (width-bound text must not ReferenceError)", () => {
  // 结构性 tripwire：同时锁定定义与调用点，防"函数在但调用被删"的静默通过。
  const built = buildClayPreviewHtml({
    title: "t",
    doc: { tag: "Leafer", width: 10, height: 10, children: [{ tag: "Text", x: 1, y: 1, width: 80, text: "你好" }] },
    wasmBase64: "QUJD",
    canvasWidth: 10,
    canvasHeight: 10,
  });
  assert.ok(built.html.includes("function wrapCJK(text, width, fontSize, font)"), "wrapCJK must exist in the glue");
  assert.ok(built.html.includes("body = wrapCJK("), "and width-bound text must call it");
});

test("GLUE wrapCJK behavior executed with a deterministic measure stub", () => {
  // 从产物里提取真实的 seg + wrapCJK（function 声明提升，同源求值即可），
  // 注入确定性度量桩（CJK/emoji 20px · ASCII 10px · 其他 8px）执行行为断言
  // ——这是 GLUE 唯一会被真正执行的测试面：断行、禁则、字素完整性、O(n) 度量。
  const built = buildClayPreviewHtml({
    title: "t",
    doc: { tag: "Leafer", width: 10, height: 10 },
    wasmBase64: "QUJD",
    canvasWidth: 10,
    canvasHeight: 10,
  });
  const html = built.html;
  const src = html.slice(html.indexOf("let GRAPHEME_SEG"), html.indexOf("function walk")).trim();
  let calls = 0;
  const w = (s: string) =>
    [...s].reduce((n, ch) => n + (/[\u4e00-\u9fff]/.test(ch) ? 20 : /[A-Za-z0-9]/.test(ch) ? 10 : 8), 0);
  const doc = {
    createElement: () => ({
      getContext: () => ({
        font: "",
        measureText: (s: string) => {
          calls += 1;
          return { width: w(s) };
        },
      }),
    }),
  };
  const { wrapCJK } = new Function("document", `${src}; return { wrapCJK };`)(doc) as {
    wrapCJK: (text: string, width: number, fontSize: number, font: string) => string;
  };
  const linesOf = (s: string) => s.split("\n");
  const reasm = (o: string, t: string) => o.replace(/\n/g, "") === t.replace(/\n/g, "");

  // CJK 逐字断行，行不超宽，往返无损
  const cjk = wrapCJK("一二三四五六七八九十", 60, 14, "f");
  assert.ok(reasm(cjk, "一二三四五六七八九十") && linesOf(cjk).every((l) => w(l) <= 60), JSON.stringify(cjk));
  // ASCII 词原子 + 断点处空格裁剪
  assert.equal(wrapCJK("hello world", 100, 14, "f"), "hello\nworld");
  // 行首禁则：句号悬挂上一行尾，不起行
  const period = wrapCJK("一二三。四", 60, 14, "f");
  assert.ok(!linesOf(period).some((l) => l.startsWith("。")) && reasm(period, "一二三。四"), JSON.stringify(period));
  // 行尾禁则：开口括号随下一行下移，不收行
  const paren = wrapCJK("一（二三", 40, 14, "f");
  assert.ok(!linesOf(paren).some((l) => l.endsWith("（")) && reasm(paren, "一（二三"), JSON.stringify(paren));
  // 字素完整性：ZWJ 家庭 emoji 与组合符 é 都不拆散
  assert.equal(wrapCJK("👨‍👩‍👧", 30, 14, "f"), "👨‍👩‍👧");
  assert.deepEqual(linesOf(wrapCJK("café", 10, 14, "f")), ["c", "a", "f", "é"]);
  // 空白治理：前导空格无幽灵空行；显式空行保留；断点空格折叠
  assert.ok(linesOf(wrapCJK("   中文", 40, 14, "f")).every((l) => l.trim() !== ""));
  assert.equal(wrapCJK("一\n\n二", 40, 14, "f"), "一\n\n二");
  assert.equal(wrapCJK("ab          cd", 30, 14, "f"), "ab\ncd");
  // 边界：width=0 终止；单字素超宽照发
  assert.equal(wrapCJK("一二三", 0, 14, "f"), "一\n二\n三");
  assert.equal(wrapCJK("一", 5, 14, "f"), "一");
  // 硬拆 O(n)：20k 字符单次度量各一次（防退回 O(n²) 前缀重测）
  calls = 0;
  const big = wrapCJK("a".repeat(20000), 30, 14, "f");
  assert.ok(calls < 25000, `hard split must measure each grapheme once, saw ${calls}`);
  assert.equal(big.replace(/\n/g, "").length, 20000);
});

test("placeholder literals in user text cannot hijack the glue (single-pass embed)", () => {
  // 链式首现替换时代，TREE 先嵌入后，树内 __FONTS_JSON__/__CANVAS_JSON__ 副本
  // 会被后续 replace 命中，把 fonts/canvas JSON 拼进字符串中间 → SyntaxError。
  const built = buildClayPreviewHtml({
    title: "t",
    doc: {
      tag: "Leafer",
      width: 10,
      height: 10,
      children: [{ tag: "Text", x: 1, y: 1, text: "evil __FONTS_JSON__ and __CANVAS_JSON__ end" }],
    },
    wasmBase64: "QUJD",
    canvasWidth: 10,
    canvasHeight: 10,
  });
  const start = built.html.indexOf("<script>") + "<script>".length;
  const end = built.html.lastIndexOf("</script>");
  const glue = built.html.slice(start, end);
  assert.doesNotThrow(() => {
    new Function(glue);
  }, "the generated script must compile even with placeholder literals in the text");
  assert.ok(glue.includes("const FONTS = ["), "the REAL fonts placeholder got replaced");
  assert.ok(glue.includes('const CANVAS = {"width":10'), "the REAL canvas placeholder got replaced");
});

test("absolute auto-size Text escapes FIXED(0) pinning (contract auto-size form)", () => {
  // 结构性 tripwire（源码定位断言）：假红时先在浏览器复核 preview 再改测试。
  // 绝对定位但未声明宽/高的 Text 是 leafer 契约的 auto-size 形态，该轴走 FIT；
  // 显式声明的宽/高仍走 FIXED（按轴判定，不整节点豁免）。
  const built = buildClayPreviewHtml({
    title: "t",
    doc: { tag: "Leafer", width: 10, height: 10, children: [{ tag: "Text", x: 5, y: 5, text: "自适应文本" }] },
    wasmBase64: "QUJD",
    canvasWidth: 10,
    canvasHeight: 10,
  });
  assert.ok(
    built.html.includes("const widthFixed = typeof n.width === 'number' || (!autoText && absolute);"),
    "per-axis: explicit width stays FIXED, width-less absolute text sizes to content"
  );
  assert.ok(
    built.html.includes("const heightFixed = typeof n.height === 'number' || (!autoText && absolute);"),
    "per-axis height guard mirrors width"
  );
  assert.ok(built.html.includes("const autoText = absolute && n.kind === 'text';"));
});
