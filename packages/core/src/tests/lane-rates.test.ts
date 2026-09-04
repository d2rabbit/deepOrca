/**
 * specs/depth-lane P2.3/P2.4: lane feedback-rate telemetry + autoTune formula.
 * Real-data calibration numbers live in the spec/tasks write-back (GVGL +
 * deepcode-cli retro run, 2026-09-04); these tests pin the ORACLE behavior.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { autoTuneThreshold, computeLaneRates, NEGATIVE_FEEDBACK_RE, relatedness } from "../routing/gate/lane-rates";

const T0 = "2026-09-03T13:50:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();

test("P2.3: express follow-up counted when a related message lands inside the window", () => {
  const report = computeLaneRates([
    {
      lane: "express",
      userMessages: [
        { text: "帮我把 README 的安装步骤改成三步以内", ts: T0 },
        { text: "README 安装步骤 改成三步 你改了标题那段吗", ts: at(3) }, // within 10min, related
      ],
    },
  ]);
  assert.equal(report.expressFollowUpRate, 1);
  assert.equal(report.samples.followUps, 1);
});

test("P2.3: outside the window or unrelated → not a follow-up; one per session max", () => {
  const outside = computeLaneRates([
    {
      lane: "express",
      userMessages: [
        { text: "把安装步骤改成三步", ts: T0 },
        { text: "安装步骤改成三步 了吗", ts: at(45) }, // related but 45min later
      ],
    },
  ]);
  assert.equal(outside.expressFollowUpRate, 0);

  const unrelated = computeLaneRates([
    {
      lane: "express",
      userMessages: [
        { text: "把安装步骤改成三步", ts: T0 },
        { text: "顺便看看 SwiftUI 的动画性能问题定位思路", ts: at(2) }, // unrelated topic
      ],
    },
  ]);
  assert.equal(unrelated.expressFollowUpRate, 0);
});

test("P2.3: deep negative feedback matches the 6-language vocabulary, once per session", () => {
  for (const phrase of [
    "太啰嗦了",
    "直接点，别绕",
    "too verbose",
    "簡潔にして",
    "間違ってるけど太長",
    "간결하게 해줘",
  ]) {
    assert.match(phrase, NEGATIVE_FEEDBACK_RE, phrase);
  }
  assert.doesNotMatch("很好，继续", NEGATIVE_FEEDBACK_RE);
  const report = computeLaneRates([
    {
      lane: "deep",
      userMessages: [
        { text: "评估跨平台方案", ts: T0 },
        { text: "太啰嗦了，说重点", ts: at(2) },
        { text: "还是太长", ts: at(3) }, // second negative — session counted once
      ],
    },
  ]);
  assert.equal(report.deepNegativeFeedbackRate, 1);
  assert.equal(report.samples.negatives, 1);
});

test("P2.3: undefined lanes count as retro-proxied express; null rates when a lane has no sessions", () => {
  const report = computeLaneRates([{ lane: undefined, userMessages: [{ text: "hi", ts: T0 }] }]);
  assert.equal(report.expressSessions, 1);
  assert.equal(report.retroProxied, 1);
  assert.equal(report.deepNegativeFeedbackRate, null); // no deep sessions → undefined, not 0
  const empty = computeLaneRates([]);
  assert.equal(empty.expressFollowUpRate, null);
});

test("P2.3: similarity seam overrides the deterministic pass", () => {
  const report = computeLaneRates(
    [
      {
        lane: "express",
        userMessages: [
          { text: "完全无关甲", ts: T0 },
          { text: "完全无关乙", ts: at(1) },
        ],
      },
    ],
    { similarity: () => 0.9 } // embedding says related, bigrams say not
  );
  assert.equal(report.expressFollowUpRate, 1);
});

test("P2.4: autoTune formula, ±step clamp, [30,70] clamp, null = no signal", () => {
  // follow-up pushes threshold UP (express under-serving → route more deep)
  assert.equal(autoTuneThreshold(50, 0.8, 0).next, 50.4);
  // negative pushes DOWN
  assert.equal(autoTuneThreshold(50, 0, 0.6).next, 49.7);
  // step clamp: huge rates move at most ±5
  assert.equal(autoTuneThreshold(50, 1, 0).change, 0.5); // 1*0.5 = +0.5 — under step
  assert.equal(autoTuneThreshold(50, 20, 0).change, 5); // clamped to +5
  assert.equal(autoTuneThreshold(50, 0, 20).change, -5);
  // hard clamp [30,70]
  assert.equal(autoTuneThreshold(69, 20, 0).next, 70);
  assert.equal(autoTuneThreshold(31, 0, 20).next, 30);
  // null rates → no movement
  assert.equal(autoTuneThreshold(50, null, null).next, 50);
});

test("P2.4: formula string carries the full audit line", () => {
  const out = autoTuneThreshold(50, 0.8, 0.2);
  assert.match(out.formula, /50 \+ 0\.80\*0\.5 − 0\.20\*0\.5 → 50\.3/);
  assert.equal(out.next, 50.3);
});
