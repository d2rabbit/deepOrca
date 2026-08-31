/**
 * Review HTML report generator (review-report.ts pure surface).
 *
 * The report is the delegated review's reading surface (user ask 2026-08-31:
 * render into a dedicated window, not the sidebar). Everything model-authored
 * (content/path/snippets) MUST be HTML-escaped — these tests pin that.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { buildReviewReportHtml } from "../main/tools/review-report";

const baseInput = {
  root: "D:/proj",
  projectName: "proj",
  status: "success",
  statusNote: "semantic review (ocr) + structural enrichment (CRG risk graph)",
  generatedAtIso: "2026-08-31T08:00:00.000Z",
  language: "zh-CN",
  modeLabel: "未提交的工作区变更（vs HEAD）",
  summary: { filesReviewed: 2, comments: 2 },
  comments: [
    {
      path: "src/main.go",
      startLine: 3,
      content: "[HIGH] race on shared map",
      existing_code: "m[k]=v",
      suggestion_code: "mu.Lock(); m[k]=v",
      crgRisk: "HIGH (12 callers)",
    },
    { path: "src/main.go", startLine: 9, content: "[MEDIUM] no timeout on ctx", crgRisk: "MEDIUM (3 callers)" },
    { path: "src/util.go", startLine: 1, content: "naming" },
  ],
};

test("escapes model-authored HTML in content, paths, and snippets", () => {
  const html = buildReviewReportHtml({
    ...baseInput,
    comments: [
      {
        path: "<script>alert(1)</script>",
        startLine: 1,
        content: "<img src=x onerror=alert(2)> injection",
        existing_code: "<b>bold</b>",
      },
    ],
  });
  assert.equal(html.includes("<script>alert(1)"), false);
  assert.equal(html.includes("<img src=x"), false);
  assert.equal(html.includes("<b>bold</b>"), false);
  assert.equal(html.includes("&lt;script&gt;"), true);
});

test("severity prefixes become chips and are stripped from the body", () => {
  const html = buildReviewReportHtml(baseInput);
  assert.equal(html.includes("sev-high"), true);
  assert.equal(html.includes("sev-medium"), true);
  assert.equal(html.includes("[HIGH] race"), false, "prefix consumed by the chip");
  assert.equal(html.includes("race on shared map"), true);
});

test("findings group by file with CRG risk annotations", () => {
  const html = buildReviewReportHtml(baseInput);
  assert.equal(html.includes("src/main.go"), true);
  assert.equal(html.includes("src/util.go"), true);
  assert.equal(html.includes("CRG 风险"), true);
  assert.equal(html.includes("HIGH (12 callers)"), true);
});

test("empty comments render the empty state; zh labels follow the locale", () => {
  const html = buildReviewReportHtml({ ...baseInput, comments: [] });
  assert.equal(html.includes("未发现需要报告的问题"), true);
  const en = buildReviewReportHtml({ ...baseInput, language: "en", comments: [] });
  assert.equal(en.includes("No findings worth reporting."), true);
});

test("summary cards and meta line render", () => {
  const html = buildReviewReportHtml(baseInput);
  assert.match(html, /<div class="num">2<\/div>/);
  assert.match(html, /未提交的工作区变更（vs HEAD）/);
  // Generated time is locale-formatted — the raw ISO string never reaches the page.
  assert.match(html, /生成时间/);
  assert.equal(html.includes("2026-08-31T08:00:00.000Z"), false);
});

test("excluded changes surface as a card + explanation when everything was filtered", () => {
  const html = buildReviewReportHtml({
    ...baseInput,
    comments: [],
    summary: { filesReviewed: 0, comments: 0, excludedByPolicy: 6, unsupportedFiles: 3 },
  });
  assert.match(html, /class="card excluded"/);
  assert.match(html, /策略排除/);
  assert.match(html, /以上变更全部按策略排除/);
  const en = buildReviewReportHtml({
    ...baseInput,
    language: "en",
    comments: [],
    summary: { filesReviewed: 0, comments: 0, excludedByPolicy: 6, unsupportedFiles: 3 },
  });
  assert.match(en, /Every change was excluded by policy/);
});
