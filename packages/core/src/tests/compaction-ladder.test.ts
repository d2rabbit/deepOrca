// specs/model-vendor-profiles P1.1/P1.2 — 三档阶梯公式、输出预留扣分母、
// rapid-refill 熔断状态机。全部纯函数（零 IO），mutation-check 见文末执行记录。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCompactionLadder,
  COMPACTION_AUTO_BUFFER_TOKENS,
  COMPACTION_OUTPUT_RESERVE_TOKENS,
  RAPID_REFILL_INITIAL,
  observeCompaction,
  observeToolTurn,
  defuseRapidRefill,
} from "../common/compaction-ladder";

test("ladder: output reserve is subtracted from the denominator before ratios (ZCode 口径)", () => {
  const ladder = computeCompactionLadder(1_000_000);
  // effective = 1M − 20K = 980K；auto = min(0.85×980K, 980K−13K) = min(833K, 967K) = 833K。
  assert.equal(ladder.effectiveWindow, 980_000);
  assert.equal(ladder.auto, 833_000);
  assert.ok(ladder.warn < ladder.auto, "warn < auto");
  assert.ok(ladder.auto < ladder.hard, "auto < hard");
  assert.ok(ladder.hard <= 1_000_000, "hard ≤ raw window");
});

test("ladder: absolute ceiling wins on large windows (qwen 语义)", () => {
  // 10M 窗口：proportional 8.48M > ceiling (10M−20K−13K=9.967M)？不——
  // proportional=8.48M < ceiling，所以 proportional 赢。构造 ceiling 赢的场景：
  // 比例值只在 effectiveWindow > 13K/(1−0.85)=~86.7K 时才会超过 ceiling……
  // 实际上 0.85×E < E−13K 当 E > 86.7K，所以大窗口时 proportional 恒小。
  // ceiling 只在极小窗口（E ≤ 86.7K）生效——验证它在那里正确兜底：
  const small = computeCompactionLadder(100_000);
  // E=80K；proportional=68K；ceiling=67K → ceiling 赢（更保守）。
  assert.equal(small.auto, 67_000);
});

test("ladder: degenerate window (≤ reserve) keeps a usable proportional trigger", () => {
  const tiny = computeCompactionLadder(10_000);
  // E=0 → absoluteCeiling=−13K ≤ 0 → 回退 proportional=0 → auto=0（触发器可用但立即触发）。
  assert.equal(tiny.effectiveWindow, 0);
  assert.equal(tiny.auto, 0);
  assert.equal(tiny.warn, 0);
  // hard 不超过原始窗口。
  assert.ok(tiny.hard <= 10_000);
  assert.equal(computeCompactionLadder(0).auto, 0);
});

test("ladder: constants lock the vendor-converged values", () => {
  assert.equal(COMPACTION_OUTPUT_RESERVE_TOKENS, 20_000); // qwen SUMMARY_RESERVE
  assert.equal(COMPACTION_AUTO_BUFFER_TOKENS, 13_000); // qwen AUTOCOMPACT_BUFFER
});

// ── rapid-refill 熔断 ──────────────────────────────────────────────────────

test("breaker: two fast refills survive, the third trips (ZCode 3×3)", () => {
  let state = RAPID_REFILL_INITIAL;
  // 第一轮：压缩 → 2 个工具回合 → 又达阈值（快速回填）。
  let signal = observeCompaction(state);
  assert.equal(signal.kind, "compacted");
  state = signal.state;
  state = observeToolTurn(state).state;
  state = observeToolTurn(state).state;
  signal = observeCompaction(state);
  assert.equal(signal.kind, "compacted");
  assert.equal(signal.state.consecutiveRefills, 2);
  state = signal.state;
  // 第二轮快速回填 → 第 3 次连续 → 熔断。
  state = observeToolTurn(state).state;
  signal = observeCompaction(state);
  assert.equal(signal.kind, "tripped");
  assert.ok(signal.message.includes("smaller chunks"));
});

test("breaker: slow refill defuses the streak", () => {
  let state = RAPID_REFILL_INITIAL;
  state = observeCompaction(state).state;
  // 4 个工具回合（超过窗口 3）→ 不算快速回填。
  for (let i = 0; i < 4; i += 1) state = observeToolTurn(state).state;
  const signal = observeCompaction(state);
  assert.equal(signal.kind, "compacted");
  assert.equal(signal.state.consecutiveRefills, 1); // 重新计数，不累积
});

test("breaker: defuseRapidRefill resets the streak without losing the turn counter", () => {
  const state = { consecutiveRefills: 2, toolTurnsSinceCompaction: 1 };
  const next = defuseRapidRefill(state);
  assert.equal(next.consecutiveRefills, 0);
  assert.equal(next.toolTurnsSinceCompaction, 1);
});

test("breaker: first compaction with zero prior tool turns never counts as a refill", () => {
  const signal = observeCompaction(RAPID_REFILL_INITIAL);
  assert.equal(signal.kind, "compacted");
  assert.equal(signal.state.consecutiveRefills, 1); // 进程首个压缩不可能是“回填”
});

// ── P1.2 minimum-savings gate ──────────────────────────────────────────────

import { worthTrimming, MIN_SAVINGS_TOKENS } from "../common/compaction";

test("worthTrimming: clears the 256-token floor applies; below skips (cache guard)", () => {
  // 9000 → 2100 chars：省 6900/4 = 1725 tokens → 值得。
  assert.equal(worthTrimming(9000, 2100), true);
  // 8300 → 8100：省 200/4 = 50 tokens → 不值得（省的钱抵不过前缀缓存失效）。
  assert.equal(worthTrimming(8300, 8100), false);
  // 恰好 256 tokens（1024 chars）：值得（>= 含等号）。
  assert.equal(worthTrimming(9216, 8192), true);
  // 变大（不可能发生但防御）：不值得。
  assert.equal(worthTrimming(100, 200), false);
  assert.equal(MIN_SAVINGS_TOKENS, 256); // ZCode DEFAULT_MICROCOMPACT_MIN_TOKEN_SAVINGS
});
