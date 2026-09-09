/**
 * parseSpecDocument unit tests (WP3.6) — the structured PRD view's parser.
 * Pins: fence transparency (`##`/table rows inside code fences never split
 * sections or leak into meta), meta-table extraction with separator/header
 * filtering, section splitting, and the no-section fallback contract.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSpecDocument } from "../renderer/components/design-workspace/SpecDocumentView";

test("splits title / meta table / sections", () => {
  const doc = [
    "# 番茄钟 需求文档",
    "",
    "| 项目 | 内容 |",
    "| --- | --- |",
    "| 产品定位 | 为知识工作者解决专注问题 |",
    "| 目标平台 | mobile |",
    "",
    "## 1. 背景与目标",
    "",
    "正文。",
    "",
    "## 4. 页面清单",
    "",
    "| 页面 | 目的 |",
  ].join("\n");
  const parsed = parseSpecDocument(doc);
  assert.equal(parsed.title, "番茄钟 需求文档");
  assert.deepEqual(
    parsed.meta.map(([key]) => key),
    ["产品定位", "目标平台"],
    "meta rows extracted, header/separator rows filtered"
  );
  assert.deepEqual(
    parsed.sections.map((section) => section.title),
    ["1. 背景与目标", "4. 页面清单"]
  );
  assert.ok(parsed.sections[0]?.body.includes("正文。"));
});

test("fence-transparent: ## and table rows inside code fences stay in the section body", () => {
  const doc = [
    "# 文档",
    "",
    "## 3. 功能需求",
    "",
    "```mermaid",
    "flowchart TD",
    "## this looks like a heading but is inside a fence",
    "| and | a | table |",
    "```",
    "",
    "## 6. 验收标准",
    "",
    "- [ ] 可开始",
  ].join("\n");
  const parsed = parseSpecDocument(doc);
  assert.deepEqual(
    parsed.sections.map((section) => section.title),
    ["3. 功能需求", "6. 验收标准"],
    "fenced ## does not open a section"
  );
  // 围栏行留在所属节的 body 里,由 Streamdown 正经渲染为代码块。
  assert.ok(parsed.sections[0]?.body.includes("## this looks like a heading"));
  assert.ok(parsed.sections[0]?.body.includes("| and | a | table |"));
});

test("fence before the first heading does not leak rows into meta", () => {
  const doc = ["# 文档", "", "```md", "| 泄漏键 | 泄漏值 |", "```", "", "## 1. 背景"].join("\n");
  const parsed = parseSpecDocument(doc);
  assert.equal(parsed.meta.length, 0, "fenced table row is not a meta pair");
});

test("plain prose without ## falls back to zero sections (whole-doc rendering)", () => {
  const parsed = parseSpecDocument("# 只有标题\n\n纯正文没有小节");
  assert.equal(parsed.sections.length, 0);
});
