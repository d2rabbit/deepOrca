// specs/model-vendor-profiles P2.5 — read→edit 失败自愈：行号前缀剥离
// （全前缀形状才剥/只一次/二次失败重抛）+ Unicode 排版归一。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  healEditStrings,
  isLineNumberPrefixedBlock,
  normalizeForEditMatch,
  stripLineNumberPrefixes,
} from "../common/edit-selfheal";

const FILE = ["function hello() {", "  return 42;", "}", ""].join("\n");

test("line-number block: every non-empty line must be prefix-shaped", () => {
  assert.equal(isLineNumberPrefixedBlock("1: function hello() {\n2:   return 42;"), true);
  assert.equal(isLineNumberPrefixedBlock("1→ function hello() {"), true);
  assert.equal(isLineNumberPrefixedBlock("  12 | return x;"), true);
  // 混合（一行是正文）→ 不是前缀块（MiniMax「全前缀形状才剥离」）。
  assert.equal(isLineNumberPrefixedBlock("1: function hello() {\nplain text line"), false);
  assert.equal(isLineNumberPrefixedBlock(""), false);
});

test("strip: removes one prefix per line", () => {
  assert.equal(stripLineNumberPrefixes("1: a\n2: b"), "a\nb");
  assert.equal(stripLineNumberPrefixes("  42→ x"), "x");
});

test("unicode normalize: smart quotes / dashes / special spaces / full-width → ASCII", () => {
  assert.equal(normalizeForEditMatch("“hello”"), '"hello"');
  assert.equal(normalizeForEditMatch("it’s"), "it's");
  assert.equal(normalizeForEditMatch("a—b"), "a-b");
  assert.equal(normalizeForEditMatch("a　b"), "a b"); // 全角空格
  assert.equal(normalizeForEditMatch("x\u00A0y"), "x y"); // NBSP
});

test("heal: line-number copy recovers (strip-line-numbers)", () => {
  const result = healEditStrings(
    "1: function hello() {\n2:   return 42;",
    "1: function hello() {\n2:   return 43;",
    FILE
  );
  assert.equal(result.healed, true);
  if (result.healed) {
    assert.equal(result.strategy, "strip-line-numbers");
    assert.ok(FILE.includes(result.oldString));
    assert.ok(result.newString.includes("return 43;"));
  }
});

test("heal: smart-quote copy recovers (unicode-normalize)", () => {
  const file = 'const msg = "it’s alive";\n';
  // 模型输出智能引号版本（与文件的直引号不匹配）。
  const result = healEditStrings('const msg = "it’s alive";\n', 'const msg = "done";\n', file);
  // 注意：此处 oldString 与 file 相同形状（都含智能引号）→ includes 命中 →
  // 不需要修复。构造真正的失败场景：文件是 ASCII，oldString 是智能引号。
  const file2 = 'const msg = "it\'s alive";\n';
  const result2 = healEditStrings('const msg = "it’s alive";\n', 'const msg = "done";\n', file2);
  assert.equal(result.healed, false); // 已能命中 → 不修
  assert.equal(result2.healed, true);
  if (result2.healed) {
    assert.equal(result2.strategy, "unicode-normalize");
    assert.ok(file2.includes(result2.oldString));
  }
});

test("heal: unfixable input returns healed:false (caller rethrows original)", () => {
  const result = healEditStrings("totally absent text", "x", FILE);
  assert.equal(result.healed, false);
});

test("heal: mixed block (partial prefixes) is never stripped", () => {
  const result = healEditStrings("1: function hello() {\nplain line not in file", "x", FILE);
  assert.equal(result.healed, false);
});
