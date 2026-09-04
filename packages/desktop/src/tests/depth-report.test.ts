/**
 * depth-report parser truth tables (specs/depth-lane 渲染优化): the six-section
 * S5 block lifts into the card structure; plan-mode proposals and partial
 * (still-streaming) blocks must NOT trigger the card.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDepthReport, stripDepthReport, depthReportTaskPrompt } from "../renderer/lib/depth-report";

const REPORT = `<proposed_plan>
# 深度决策报告（deep-lane）

## 结论（先读这里）
Adopt a tiered, capability-based animation timeline API.

## 置信度
75%

## 分歧点
- 是否引入进程外沙箱
- 版本承诺的粒度

## 关键假设
1. 插件数量在数十量级
2. 性能开销可忽略

## 风险与红线
- 不可逆：公开 API 一旦发布无法收回，需用户拍板
- 常见的兼容性风险

## 可执行下一步
1. 写能力清单草案
2. 做一个插件样例验证边界
3. 评审会议拍板
</proposed_plan>`;

test("parses the six sections with confidence, irreversible split and numbered steps", () => {
  const r = extractDepthReport(REPORT)!;
  assert.ok(r);
  assert.match(r.conclusion, /tiered, capability-based/);
  assert.equal(r.confidencePct, 75);
  assert.equal(r.confidenceText, "75%");
  assert.equal(r.converged, true);
  assert.equal(r.divergences.length, 2);
  assert.equal(r.assumptions.length, 2);
  assert.equal(r.irreversible.length, 1);
  assert.match(r.irreversible[0]!, /需用户拍板/);
  assert.equal(r.risks.length, 1);
  assert.equal(r.nextSteps.length, 3);
  assert.match(r.nextSteps[2]!, /评审会议/);
});

test("plan-mode proposals and partial blocks never trigger the card", () => {
  assert.equal(extractDepthReport("<proposed_plan>\n# 实施方案\n- 步骤一\n</proposed_plan>"), null);
  assert.equal(extractDepthReport("<proposed_plan>\n# 深度决策报告（deep-lane）\n## 结论\n仍在流式输出…"), null);
  assert.equal(extractDepthReport("普通消息，无块"), null);
  assert.equal(extractDepthReport(null), null);
});

test("unconverged banner flips the flag", () => {
  const r = extractDepthReport(REPORT.replace("## 置信度", "> ⚠️ 未收敛：分歧仍超过阈值\n\n## 置信度"))!;
  assert.equal(r.converged, false);
});

test("strip removes the block and keeps surrounding prose; task prompt carries steps", () => {
  const content = `前言一句。\n${REPORT}\n后记一句。`;
  const stripped = stripDepthReport(content);
  assert.match(stripped, /前言一句。/);
  assert.match(stripped, /后记一句。/);
  assert.ok(!stripped.includes("proposed_plan"));
  const prompt = depthReportTaskPrompt(extractDepthReport(REPORT)!);
  assert.match(prompt, /深度决策报告执行：/);
  assert.match(prompt, /1\. 写能力清单草案/);
  assert.match(prompt, /3\. 评审会议拍板/);
});
