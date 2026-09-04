/**
 * CMB-7 (specs/cmb-adoption batch B): render-time relative-time resolution +
 * event/known-at time separation.
 *
 * Truth tables pin:
 *   - Chinese and English relative phrases resolve to absolute windows
 *     anchored at the record's learned-at timestamp;
 *   - unanchored (no timestamp) known phrases stay verbatim + （源未锚定）;
 *   - phrases outside the vocabulary are left untouched (no invention);
 *   - formatMemoryLine: activity range rows unchanged; point-only rows now
 *     label the timestamp as 记录于 (known-at), not 活动时间 (event time).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRelativeTimes } from "../tdai/core/hooks/relative-time.js";
import { formatMemoryLine } from "../tdai/core/hooks/auto-recall.js";

// 2026-09-04 is a Friday → its ISO week is Mon 2026-08-31 ~ Sun 2026-09-06.
const ANCHOR = "2026-09-04T10:00:00.000Z";

test("CMB-7: Chinese relative phrases resolve to absolute windows", () => {
  assert.equal(resolveRelativeTimes("用户今天加班了", ANCHOR), "用户今天（→ 2026-09-04）加班了");
  assert.equal(resolveRelativeTimes("用户昨天去了医院", ANCHOR), "用户昨天（→ 2026-09-03）去了医院");
  assert.equal(resolveRelativeTimes("用户前天提交了代码", ANCHOR), "用户前天（→ 2026-09-02）提交了代码");
  assert.equal(resolveRelativeTimes("用户上周去爬山了", ANCHOR), "用户上周（→ 2026-08-24 ~ 2026-08-30）去爬山了");
  assert.equal(resolveRelativeTimes("用户上上周离职了", ANCHOR), "用户上上周（→ 2026-08-17 ~ 2026-08-23）离职了");
  assert.equal(resolveRelativeTimes("用户上个月去了东京", ANCHOR), "用户上个月（→ 2026-08-01 ~ 2026-08-31）去了东京");
  assert.equal(resolveRelativeTimes("用户最近在学 Rust", ANCHOR), "用户最近（→ 2026-08-29 ~ 2026-09-04）在学 Rust");
});

test("CMB-7: English relative phrases resolve too (case-insensitive)", () => {
  assert.equal(resolveRelativeTimes("deployed yesterday", ANCHOR), "deployed yesterday（→ 2026-09-03）");
  assert.equal(
    resolveRelativeTimes("Met the team last week", ANCHOR),
    "Met the team last week（→ 2026-08-24 ~ 2026-08-30）"
  );
});

test("CMB-7: no anchor → verbatim + 源未锚定 marker, single trailing mark", () => {
  assert.equal(resolveRelativeTimes("用户上周和昨天都生病了"), "用户上周和昨天都生病了（源未锚定）");
  assert.equal(resolveRelativeTimes("普通内容没有相对词"), "普通内容没有相对词");
});

test("CMB-7: unknown relative phrasing stays untouched (no invention)", () => {
  assert.equal(resolveRelativeTimes("用户前阵子换了工作", ANCHOR), "用户前阵子换了工作");
  assert.equal(resolveRelativeTimes("a while back it broke", ANCHOR), "a while back it broke");
});

test("CMB-7: re-resolution is idempotent (annotations not duplicated)", () => {
  const once = resolveRelativeTimes("用户上周去爬山了", ANCHOR);
  assert.equal(resolveRelativeTimes(once, ANCHOR), once);
});

test("CMB-7: formatMemoryLine separates event time from known-at time", () => {
  // activity range present → event-time rendering unchanged
  assert.equal(
    formatMemoryLine({
      type: "episodic",
      content: "去日本旅行",
      activity_start_time: "2026-05-01",
      activity_end_time: "2026-05-10",
    }),
    "- [episodic] 去日本旅行 (活动时间: 2026-05-01 ~ 2026-05-10)"
  );
  // point-only → KNOWN-AT label, not event time (the old label conflated them)
  assert.equal(
    formatMemoryLine({ type: "instruction", content: "要求用中文回答", timestamp: "2026-09-01T08:00:00.000Z" }),
    "- [instruction] 要求用中文回答 (记录于 2026-09-01)"
  );
  // relative phrase inside content resolves against the same timestamp
  assert.equal(
    formatMemoryLine({ type: "episodic", content: "用户上周发布了版本", timestamp: "2026-09-04T10:00:00.000Z" }),
    "- [episodic] 用户上周（→ 2026-08-24 ~ 2026-08-30）发布了版本 (记录于 2026-09-04)"
  );
  // all empty → no time suffix
  assert.equal(formatMemoryLine({ type: "persona", content: "用户叫王小明" }), "- [persona] 用户叫王小明");
});
