/**
 * clay-preview-html — clay-ui-runtime WP3：把编译后的 Clay 树 + vendored clay.wasm
 * 组装成自包含 `preview.html`（base64 内嵌 wasm，file:// 双击即渲染，零网络）。
 *
 * 页面结构：顶部横幅（跳过/降级计数，>0 时显示）· 缩放条（50/75/100%）·
 * stage（bind 协议布局产出的绝对定位 DOM，文本可选中/复制）·
 * wasm 实例化失败 → 本地化错误卡片（引导回 index.html）。
 *
 * 跳过/降级统计来自 WP2 编译器；banner 为静态注入（不含模板插值——本文件的
 * JS 模板体刻意避免反引号与 ${}，防止外层模板字面量二次解析）。
 */

import { compileLeaferToClayTree } from "./compile-leafer-to-clay";

export interface ClayPreviewBuildResult {
  html: string;
  skipped: string[];
  degraded: number;
  nodes: number;
}

export interface ClayPreviewBuildOptions {
  title: string;
  /** 已解析的 Leafer 场景文档（content.leafer 的 JSON.parse 结果）。 */
  doc: unknown;
  /** vendored clay.wasm 的 base64（main 进程读取 vendor/clay/clay.wasm）。 */
  wasmBase64: string;
  canvasWidth: number;
  canvasHeight: number;
  fonts?: string[];
}

const DEFAULT_FONTS = ['"Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", sans-serif'];

const GLUE = [
  "const WASM_B64 = __WASM_B64__;",
  "const TREE = __TREE_JSON__;",
  "const FONTS = __FONTS_JSON__;",
  "const CANVAS = __CANVAS_JSON__;",
  "let memoryDataView, scratchBase, instance, textBase, textBump = 0;",
  "const encoder = new TextEncoder();",
  "function bind_decl_reset() { instance.exports.bind_decl_reset(); }",
  "function bind_set_background(r, g, b, a) { instance.exports.bind_set_background(r, g, b, a); }",
  "function bind_set_corner_radius(tl, tr, bl, br) { instance.exports.bind_set_corner_radius(tl, tr, bl, br); }",
  "function bind_set_border(r, g, b, a, l, rr, t, bt) { instance.exports.bind_set_border(r, g, b, a, l, rr, t, bt); }",
  "function bind_set_layout(dir, pl, pr, pt, pb, gap, wt, wv, ht, hv, ax, ay) { instance.exports.bind_set_layout(dir, pl, pr, pt, pb, gap, wt, wv, ht, hv, ax, ay); }",
  "function bind_set_floating(x, y) { instance.exports.bind_set_floating(x, y); }",
  "function bind_open() { instance.exports.bind_open(); }",
  "function bind_close() { instance.exports.bind_close(); }",
  "function bind_text(ptr, len, fontSize, fontId, lineHeight, r, g, b, a, wrap) { instance.exports.bind_text(ptr, len, fontSize, fontId, lineHeight, r, g, b, a, wrap); }",
  "function bind_begin(w, h) { instance.exports.bind_begin(w, h); }",
  "function bind_end() { return instance.exports.bind_end(); }",
  "function readString(address, length) {",
  "  const bytes = new Uint8Array(memoryDataView.buffer.slice(address, address + length));",
  "  return new TextDecoder('utf-8').decode(bytes);",
  "}",
  "function readRgba(base) {",
  "  const r = Math.round(memoryDataView.getFloat32(base, true));",
  "  const g = Math.round(memoryDataView.getFloat32(base + 4, true));",
  "  const b = Math.round(memoryDataView.getFloat32(base + 8, true));",
  "  const a = memoryDataView.getFloat32(base + 12, true) / 255;",
  "  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';",
  "}",
  "const imports = { clay: {",
  "  measureTextFunction: function (outAddress, textAddress, configAddress) {",
  "    const length = memoryDataView.getUint32(textAddress, true);",
  "    const pointer = memoryDataView.getUint32(textAddress + 4, true);",
  "    const text = readString(pointer, length);",
  "    const fontId = memoryDataView.getUint16(configAddress + 20, true);",
  "    const fontSize = memoryDataView.getUint16(configAddress + 22, true);",
  "    const ctx = document.createElement('canvas').getContext('2d');",
  "    ctx.font = fontSize + 'px ' + FONTS[fontId];",
  "    const m = ctx.measureText(text);",
  "    const h = (m.fontBoundingBoxAscent || m.actualBoundingBoxAscent) + (m.fontBoundingBoxDescent || m.actualBoundingBoxDescent);",
  "    memoryDataView.setFloat32(outAddress, m.width, true);",
  "    memoryDataView.setFloat32(outAddress + 4, h || fontSize, true);",
  "  },",
  "  queryScrollOffsetFunction: function () { return [0, 0]; },",
  "} };",
  "function init() {",
  "  const bytes = Uint8Array.from(atob(WASM_B64), function (c) { return c.charCodeAt(0); });",
  "  const module = new WebAssembly.Module(bytes);",
  "  instance = new WebAssembly.Instance(module, imports);",
  "  memoryDataView = new DataView(new Uint8Array(instance.exports.memory.buffer).buffer);",
  "  scratchBase = instance.exports.__heap_base.value;",
  "  const minMemory = instance.exports.Clay_MinMemorySize();",
  "  textBase = scratchBase + 4096 + minMemory + 4096;",
  "  instance.exports.bind_init(scratchBase, CANVAS.width, CANVAS.height);",
  "  instance.exports.bind_begin(CANVAS.width, CANVAS.height);",
  "  walk(TREE);",
  "  instance.exports.bind_end();",
  "  renderCommands();",
  "}",
  "let GRAPHEME_SEG = null;",
  "function seg(s) {",
  "  if (typeof Intl !== 'undefined' && Intl.Segmenter) {",
  "    if (!GRAPHEME_SEG) GRAPHEME_SEG = new Intl.Segmenter('zh', { granularity: 'grapheme' });",
  "    return Array.from(GRAPHEME_SEG.segment(s), function (x) { return x.segment; });",
  "  }",
  "  return Array.from(s);",
  "}",
  "function wrapCJK(text, width, fontSize, font) {",
  "  const ctx = document.createElement('canvas').getContext('2d');",
  "  ctx.font = fontSize + 'px ' + font;",
  "  const fits = function (s) { return ctx.measureText(s).width <= width; };",
  // 行首禁则（收口类标点悬挂在上一行尾，不得起一行）· 行尾禁则（开口类标点随下一行走，不收行）
  "  const NO_LINE_START = /[。，、；：？！…—～·）》〉」』】〕＂％‰℃\"')}\\],.;:?!]/;",
  "  const NO_LINE_END = /[（《〈「『【〔“‘([{]/;",
  "  let out = '', line = '';",
  "  const chars = seg(text);",
  "  let i = 0;",
  "  while (i < chars.length) {",
  "    const ch = chars[i];",
  "    i += 1;",
  "    if (ch === '\\n') { out += line.replace(/[ \\t]+$/, '') + '\\n'; line = ''; continue; }",
  // 空白：上得了当前行就上，上不了视为断点处的折叠空格丢弃——不产生独占空格行、
  // 不撑肥行尾（Clay 断行时同样自剥行尾空格）
  "    if (/\\s/.test(ch)) {",
  "      if (line.length === 0 || fits(line + ch)) line += ch;",
  "      continue;",
  "    }",
  "    let unit = ch;",
  "    if (/[A-Za-z0-9]/.test(ch)) {",
  "      while (i < chars.length && /[A-Za-z0-9._'-]/.test(chars[i])) { unit += chars[i]; i += 1; }",
  "    }",
  "    if (line.length > 0 && !fits(line + unit) && !NO_LINE_START.test(unit.charAt(0))) {",
  "      let carry = '';",
  "      while (line.length > 0 && NO_LINE_END.test(Array.from(line).pop())) {",
  "        carry = Array.from(line).pop() + carry;",
  "        line = line.slice(0, line.length - carry.length);",
  "      }",
  "      const flushed = line.replace(/[ \\t]+$/, '');",
  "      if (flushed.length > 0) out += flushed + '\\n';",
  "      line = carry;",
  "    }",
  // 超宽词硬拆：单字素宽度各量一次、单趟累加切分（整体 O(n) 次度量，不随输入
  // 平方增长），按字素边界切（不劈代理对/ZWJ 序列/组合符），拆点避让行首禁则；
  // 单个字素放不下也整发——对齐 Clay「Only word on the line is too large, just
  // render it anyway」。逐字累加是预览近似（忽略 kerning），Clay 随后真实度量重排。
  "    let cps = seg(unit);",
  "    if (cps.length > 1) {",
  "      const gw = cps.map(function (g) { return ctx.measureText(g).width; });",
  "      let acc = 0, start = 0;",
  "      for (let k = 0; k < cps.length; k++) {",
  "        if (k > start && acc + gw[k] > width) {",
  "          let cut = k;",
  "          while (cut > start + 1 && NO_LINE_START.test(cps[cut])) cut -= 1;",
  "          out += cps.slice(start, cut).join('') + '\\n';",
  "          start = cut;",
  "          acc = 0;",
  "          for (let j = start; j < k; j++) acc += gw[j];",
  "          k -= 1;",
  "          continue;",
  "        }",
  "        acc += gw[k];",
  "      }",
  "      unit = cps.slice(start).join('');",
  "    }",
  "    line += unit;",
  "  }",
  "  return out + line;",
  "}",
  "function walk(n) {",
  "  bind_decl_reset();",
  "  if (n.background) bind_set_background(n.background[0], n.background[1], n.background[2], n.background[3]);",
  "  if (n.radius != null) bind_set_corner_radius(n.radius, n.radius, n.radius, n.radius);",
  "  if (n.border) bind_set_border(n.border.color[0], n.border.color[1], n.border.color[2], n.border.color[3], n.border.width, n.border.width, n.border.width, n.border.width);",
  "  const absolute = typeof n.x === 'number' && typeof n.y === 'number';",
  // 绝对定位且未声明宽/高的 Text 是契约的 auto-size 形态：该轴不得钉成
  // FIXED(0)（折叠不可见）；显式声明的宽/高仍走 FIXED，非 text 绝对节点不变。
  "  const autoText = absolute && n.kind === 'text';",
  "  const widthFixed = typeof n.width === 'number' || (!autoText && absolute);",
  "  const heightFixed = typeof n.height === 'number' || (!autoText && absolute);",
  "  const dir = n.layout && n.layout.direction === 'x' ? 0 : 1;",
  "  const pad = n.layout && n.layout.padding ? n.layout.padding : [0, 0, 0, 0];",
  "  const gap = n.layout && n.layout.gap ? n.layout.gap : 0;",
  "  bind_set_layout(dir, pad[0], pad[1], pad[2], pad[3], gap,",
  "    widthFixed ? 2 : 0, widthFixed ? (n.width || 0) : 0,",
  "    heightFixed ? 2 : (n.layout ? 1 : 0), heightFixed ? (n.height || 0) : (n.layout ? 0 : 0),",
  "    0, 0);",
  "  if (absolute) bind_set_floating(n.x, n.y);",
  "  bind_open();",
  "  if (n.kind === 'text') {",
  "    let body = n.text || '';",
  "    const fontSize = n.fontSize || 14;",
  "    if (n.width && !n.layout) body = wrapCJK(body, n.width, fontSize, FONTS[0]);",
  "    const encoded = encoder.encode(body);",
  "    if (textBump + encoded.length > 1048576) throw new Error('preview 文本区超出 1MB 上限');",
  "    const pointer = textBase + textBump;",
  "    new Uint8Array(memoryDataView.buffer).set(encoded, pointer);",
  "    textBump += encoded.length;",
  "    const c = n.color || [30, 33, 41, 255];",
  "    bind_text(pointer, encoded.length, fontSize, 0, n.lineHeight || Math.round(fontSize * 1.4), c[0], c[1], c[2], c[3], n.width ? 1 : 0);",
  "  }",
  "  (n.children || []).forEach(walk);",
  "  bind_close();",
  "}",
  "function renderCommands() {",
  "  const stage = document.getElementById('stage');",
  "  stage.style.width = CANVAS.width + 'px';",
  "  stage.style.height = CANVAS.height + 'px';",
  "  const capacity = memoryDataView.getUint32(scratchBase, true);",
  "  const length = memoryDataView.getUint32(scratchBase + 4, true);",
  "  let offset = memoryDataView.getUint32(scratchBase + 8, true);",
  "  for (let i = 0; i < length; i++, offset += 72) {",
  "    const type = memoryDataView.getUint8(offset + 70);",
  "    if (type === 0) continue;",
  "    const el = document.createElement('div');",
  "    el.style.left = memoryDataView.getFloat32(offset, true) + 'px';",
  "    el.style.top = memoryDataView.getFloat32(offset + 4, true) + 'px';",
  "    el.style.width = memoryDataView.getFloat32(offset + 8, true) + 'px';",
  "    el.style.height = memoryDataView.getFloat32(offset + 12, true) + 'px';",
  "    const rd = offset + 16;",
  "    if (type === 1) {",
  "      el.style.background = readRgba(rd);",
  "      const radius = memoryDataView.getFloat32(rd + 16, true);",
  "      if (radius > 0) el.style.borderRadius = radius + 'px';",
  "    } else if (type === 3) {",
  "      const len = memoryDataView.getUint32(rd, true);",
  "      const ptr = memoryDataView.getUint32(rd + 4, true);",
  "      el.style.color = readRgba(rd + 12);",
  "      el.style.font = memoryDataView.getUint16(rd + 30, true) + 'px ' + FONTS[memoryDataView.getUint16(rd + 28, true)];",
  "      el.style.lineHeight = memoryDataView.getUint16(rd + 34, true) + 'px';",
  "      el.style.whiteSpace = 'pre';",
  "      el.textContent = readString(ptr, len);",
  "    } else if (type === 2) {",
  "      el.style.boxShadow = 'inset 0 0 0 1px ' + readRgba(rd);",
  "    } else if (type === 5) {",
  "      el.style.overflow = 'hidden';",
  "    }",
  "    stage.appendChild(el);",
  "  }",
  "  const info = document.getElementById('info');",
  "  if (info) info.textContent = length + ' commands · ' + CANVAS.width + 'x' + CANVAS.height;",
  "}",
  "function setZoom(scale) {",
  "  const stage = document.getElementById('stage');",
  "  if (stage) stage.style.transform = 'scale(' + scale + ')';",
  "  document.querySelectorAll('.zoomBtn').forEach(function (b) {",
  "    b.classList.toggle('active', b.getAttribute('data-z') === String(scale));",
  "  });",
  "}",
  "window.addEventListener('DOMContentLoaded', function () {",
  "  document.querySelectorAll('.zoomBtn').forEach(function (b) {",
  "    b.addEventListener('click', function () { setZoom(Number(b.getAttribute('data-z'))); });",
  "  });",
  "  try {",
  "    init();",
  "  } catch (e) {",
  "    const err = document.getElementById('err');",
  "    const msg = document.getElementById('errMsg');",
  "    if (msg) msg.textContent = 'clay.wasm 渲染失败: ' + (e && e.message ? e.message : e) + ' —— 请改用包内 index.html（leafer 交互画布）。';",
  "    if (err) err.style.display = 'grid';",
  "  }",
  "});",
].join("\n");

export function buildClayPreviewHtml(options: ClayPreviewBuildOptions): ClayPreviewBuildResult {
  const fonts = options.fonts ?? DEFAULT_FONTS;
  const { tree, stats } = compileLeaferToClayTree(options.doc);

  const bannerBits: string[] = [];
  if (stats.skipped.length > 0)
    bannerBits.push(stats.skipped.length + " 个图元被跳过（" + stats.skipped.join("、") + "）");
  if (stats.degraded > 0) bannerBits.push(stats.degraded + " 处样式近似降级");
  const banner =
    bannerBits.length > 0
      ? '<div class="banner">⚠ ' + escapeHtml(bannerBits.join(" · ")) + " —— 完整效果以 index.html 画布为准</div>"
      : "";

  // 内嵌 JSON 统一走 < 转义（防 </script> 提前终止脚本块）+ 函数式替换
  //（防用户文本里的 $& / $` / $' / $$ 被 String.replace 当替换模式展开）。
  // 单趟全局替换：链式首现替换会被用户文本里的占位符字面量劫持（TREE 先入，
  // 后续 replace 命中树内副本 → 产物 SyntaxError）；replace 不重扫插入值，
  // 单趟天然免疫。banner 走 HTML 模板插值（已 escapeHtml），GLUE 内无占位符。
  const embed = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c");
  const payload: Record<string, unknown> = {
    __TREE_JSON__: tree ?? { kind: "box", children: [] },
    __FONTS_JSON__: fonts,
    __CANVAS_JSON__: { width: options.canvasWidth, height: options.canvasHeight },
    __WASM_B64__: options.wasmBase64,
  };
  const glue = GLUE.replace(/__(?:TREE_JSON|FONTS_JSON|CANVAS_JSON|WASM_B64)__/g, (k) => embed(payload[k]));

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(options.title)} — Clay 预览</title>
<style>
  body { margin: 0; background: #eef0f4; font-family: "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", sans-serif; }
  #bar { padding: 10px 14px; display: flex; gap: 8px; align-items: center; background: #fff; border-bottom: 1px solid #dfe3ea; }
  #bar .title { font-size: 13px; font-weight: 700; color: #101623; margin-right: 8px; }
  .zoomBtn { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid #c9cfda; background: #fff; cursor: pointer; }
  .zoomBtn.active { background: #101623; color: #fff; border-color: #101623; }
  #bar .info { margin-left: auto; font-family: Consolas, monospace; font-size: 11px; color: #6b7280; }
  #viewport { overflow: auto; }
  #stage { position: relative; transform-origin: 0 0; background: #f4f5f8; }
  #stage > * { position: absolute; box-sizing: border-box; }
  .banner { position: fixed; left: 0; right: 0; top: 0; z-index: 20; background: #fff7e6; color: #8a5a00; border-bottom: 1px solid #ecd9b0; padding: 6px 14px; font-size: 12px; }
  #err { position: fixed; inset: 0; display: none; place-items: center; background: #fff; z-index: 30; }
  #err .card { max-width: 480px; border: 1px solid #e5b8b8; background: #fdf3f3; color: #8c2f2f; padding: 20px 24px; border-radius: 12px; font-size: 14px; }
</style>
</head>
<body>
<div id="bar">
  <span class="title">${escapeHtml(options.title)}</span>
  <button class="zoomBtn" data-z="0.5">50%</button>
  <button class="zoomBtn" data-z="0.75">75%</button>
  <button class="zoomBtn active" data-z="1">100%</button>
  <span class="info" id="info"></span>
</div>
${banner}
<div id="viewport"><div id="stage"></div></div>
<div id="err"><div class="card" id="errMsg">clay.wasm 实例化失败——请改用包内 index.html（leafer 交互画布）。</div></div>
<script>
${glue}
</script>
</body>
</html>`;

  return { html, skipped: stats.skipped, degraded: stats.degraded, nodes: stats.nodes };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
