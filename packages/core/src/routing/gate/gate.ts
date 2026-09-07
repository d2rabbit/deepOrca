/**
 * Complexity gate (specs/depth-lane §2.2, P0.1) — the two-stage router that
 * decides a session's lane BEFORE the main LLM loop starts.
 *
 *   L1  free deterministic heuristics (zero LLM, O(1)); a hit decides the
 *       lane outright and L2 never runs;
 *   L2  the gray zone: the four-dimension flash scoring that piggybacks on
 *       the existing skill-matching call (session-manager-skills.ts).
 *
 * Fail-open is a hard contract: no client / malformed or missing fields /
 * timeout / abort → lane "express", which is byte-equivalent to the
 * pre-feature single-loop behavior. The `lane` value is ALWAYS computed by
 * program code from T+P+C+R >= threshold — a lane self-reported by the model
 * is ignored by design (the parser never even reads it).
 */

import { TPCR_FULL_SCORES } from "./gate-prompt";

export type LaneVerdict = "express" | "deep";

/** The four dimension scores exactly as the flash call must return them. */
export type TpcrScores = {
  T: number;
  P: number;
  C: number;
  R: number;
};

/** Which path produced the verdict — observation/telemetry only, never behavior. */
export type LaneSource =
  | "l1-plan-mode"
  | "l1-image-only"
  | "l1-keyword"
  | "l1-follow-up-rate"
  | "l2-flash"
  | "fail-open";

export type ComplexityVerdict = {
  lane: LaneVerdict;
  /** Raw L2 scores; null whenever the verdict did not come from scoring (L1 / fail-open). */
  tpcr: TpcrScores | null;
  /** One-sentence judgment reason (L2) or the rule that fired (L1). */
  reason: string | null;
  source: LaneSource;
};

/** Default express verdict used on every fail-open path. */
export function expressFailOpen(reason: string): ComplexityVerdict {
  return { lane: "express", tpcr: null, reason, source: "fail-open" };
}

/**
 * Program-computed lane from the four dimension scores (design §2.2). The
 * ONLY place a "deep" verdict can originate from scoring. Boundary is >=:
 * a total of exactly `threshold` routes deep (49 → express, 50 → deep at the
 * default threshold of 50).
 */
export function computeLane(tpcr: TpcrScores, threshold: number): LaneVerdict {
  return tpcr.T + tpcr.P + tpcr.C + tpcr.R >= threshold ? "deep" : "express";
}

/**
 * Strict validation of the T/P/C/R fields off the parsed skill-matching JSON.
 * Every field must be present and EXACTLY 0 or its full score — anything else
 * (missing / wrong type / intermediate value / out-of-range) returns null so
 * the caller fails open to express. Note: a self-reported `lane` field is
 * deliberately not even looked at.
 */
export function parseTpcrScores(parsed: unknown): TpcrScores | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const dims: Array<keyof TpcrScores> = ["T", "P", "C", "R"];
  const scores = {} as TpcrScores;
  for (const dim of dims) {
    const value = record[dim];
    const full = TPCR_FULL_SCORES[dim];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return null;
    }
    if (value !== 0 && value !== full) {
      return null;
    }
    scores[dim] = value;
  }
  return scores;
}

/** Extract the one-sentence judgment reason (best-effort; malformed → null). */
export function parseVerdictReason(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const reason = (parsed as Record<string, unknown>).reason;
  return typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : null;
}

// ── L1 free heuristics ───────────────────────────────────────────────────────

/** Express-shaped keywords: direct-answer / lookup requests (design §2.2 rule 3).
 *  NOTE: no \b after the CJK anchors — JS \b is ASCII-\w based and never
 *  matches between two CJK characters. */
const L1_EXPRESS_KEYWORDS: RegExp[] = [
  /解释|翻译|什么是|如何安装|怎么安装/,
  /\b(explain|translate|what is|what's|how to install|how do i install)\b/i,
];

/** Deep-shaped keyword signals: deliberation / tradeoff / staged plans. */
const L1_DEEP_KEYWORDS: RegExp[] = [
  /方案|权衡|风险|策略|要不要|如果.{0,12}则|先.{0,10}然后.{0,10}再/,
  /\b(tradeoff|trade-off|pros and cons|risk|strategy|roadmap|should we)\b/i,
];

/**
 * Historical follow-up rate at or above which L1 routes deep outright.
 * Only meaningful for sessions WITH history — v1 decides the lane at session
 * creation (first prompt), so the live path never supplies a rate; the rule
 * stays in the table because the reply-side upgrade (design §7 item 2) will
 * consume it later.
 */
export const L1_FOLLOW_UP_RATE_THRESHOLD = 0.4;

export type L1GateInput = {
  /** True when the user explicitly requested Plan Mode (highest-priority deep signal). */
  planMode?: boolean;
  /** The prompt's text (absent/empty for image-only turns). */
  text?: string;
  /** Present and non-empty when the turn carries images. */
  imageUrls?: string[];
  /** Historical express follow-up rate in [0, 1] (reply-side only; v1 never passes it). */
  followUpRate?: number;
};

export type L1GateResult = {
  lane: LaneVerdict;
  source: Extract<LaneSource, "l1-plan-mode" | "l1-image-only" | "l1-keyword" | "l1-follow-up-rate">;
  reason: string;
};

/**
 * The L1 rule table, in priority order (design §2.2):
 *   1. planMode → deep (the user explicitly asked for planning);
 *   2. no text / image-only first frame → express;
 *   3. keyword quick rules (express beats deep when both match — cheap-first);
 *   4. historical follow-up rate >= L1_FOLLOW_UP_RATE_THRESHOLD → deep;
 *   5. no hit → null (the caller proceeds to L2).
 */
export function evaluateL1Rules(input: L1GateInput): L1GateResult | null {
  if (input.planMode) {
    return { lane: "deep", source: "l1-plan-mode", reason: "plan mode requested" };
  }
  const hasText = typeof input.text === "string" && input.text.trim().length > 0;
  if (!hasText) {
    return { lane: "express", source: "l1-image-only", reason: "no text (image-only prompt)" };
  }
  // Cheap-first: an express keyword wins even when a deep keyword also appears —
  // the failure direction of the gate is "simple task taxed into the deep lane".
  for (const pattern of L1_EXPRESS_KEYWORDS) {
    if (pattern.test(input.text!)) {
      return { lane: "express", source: "l1-keyword", reason: `express keyword ${pattern.source}` };
    }
  }
  for (const pattern of L1_DEEP_KEYWORDS) {
    if (pattern.test(input.text!)) {
      return { lane: "deep", source: "l1-keyword", reason: `deep keyword ${pattern.source}` };
    }
  }
  if (typeof input.followUpRate === "number" && input.followUpRate >= L1_FOLLOW_UP_RATE_THRESHOLD) {
    return { lane: "deep", source: "l1-follow-up-rate", reason: `follow-up rate ${input.followUpRate.toFixed(2)}` };
  }
  return null;
}

// ── Telemetry aggregation (P0.7) ─────────────────────────────────────────────

export type LaneTelemetrySummary = {
  expressCount: number;
  deepCount: number;
  /** express share of judged sessions; 0 when nothing was judged yet. */
  expressShare: number;
  /** Average locally-counted tokens per main-loop request — the express/baseline cost line (null = no data). */
  avgChatRequestTokens: number | null;
  /** Average locally-counted tokens per staged depth-lane request (null = no data). */
  avgDepthLaneRequestTokens: number | null;
};

/**
 * Read-only lane-distribution + cost aggregation for the P0 observation
 * window: lane counts come from the sessions index (`SessionEntry.lane`),
 * per-request token costs from the usage ledger (source "auxiliary" carries
 * the gate's flash scoring; "depth-lane" carries the staged flow). Pure —
 * callers pass whatever slices they hold; nothing is read from disk here.
 *
 * TODO(specs/depth-lane P2.3): 追问率/负反馈率遥测口径（embedding 余弦 +
 * 6 语言正则）不在本期——此处先落 lane 分布与成本基线。
 */
export function summarizeLaneTelemetry(
  lanes: Array<Pick<ComplexityVerdict, "lane"> | { lane?: LaneVerdict } | undefined>,
  usageBySource: Partial<Record<"auxiliary" | "depth-lane" | "chat", Array<{ prompt: number; completion: number }>>>
): LaneTelemetrySummary {
  let expressCount = 0;
  let deepCount = 0;
  for (const entry of lanes) {
    const lane = entry?.lane;
    if (lane === "express") expressCount += 1;
    else if (lane === "deep") deepCount += 1;
  }
  const judged = expressCount + deepCount;
  const avgOf = (records?: Array<{ prompt: number; completion: number }>): number | null => {
    if (!records || records.length === 0) return null;
    const total = records.reduce((sum, record) => sum + record.prompt + record.completion, 0);
    return Math.round(total / records.length);
  };
  return {
    expressCount,
    deepCount,
    expressShare: judged > 0 ? expressCount / judged : 0,
    avgChatRequestTokens: avgOf(usageBySource.chat),
    avgDepthLaneRequestTokens: avgOf(usageBySource["depth-lane"]),
  };
}
