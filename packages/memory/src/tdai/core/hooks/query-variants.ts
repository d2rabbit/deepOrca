/**
 * Deterministic query variants for multi-query recall.
 *
 * Inspired by fixed-role multi-query rewriting in agent-memory engines, but
 * LLM-free by constraint: the recall path (auto-recall hook) has no model
 * access, so every variant here is a pure string transform whose shape is
 * chosen for a retrieval leg:
 *
 *   - event variant (`stripTimeExpressions`): time-anchored questions
 *     ("what did I book last week") actively drop the time dimension so FTS
 *     matches the EVENT, not timestamp tokens. jieba/BM25 would otherwise
 *     happily match "上周"/"2025" against unrelated memory rows.
 *
 * Each variant that produces nothing (or equals the original) is dropped —
 * a failing variant falls back to the original query and never blocks the
 * main recall path.
 *
 * `fuseByRrf` fuses the per-variant ranked lists into one ranking using the
 * same Reciprocal Rank Fusion constant (k=60) as the keyword↔embedding merge
 * in auto-recall's hybrid branch.
 */

import type { L1FtsResult } from "../store/types.js";

// ── Time-expression stripping (event variant) ───────────────────────────────

/** Chinese relative-time words that anchor a query to a time, not an event. */
const ZH_TIME_WORDS = [
  "前天",
  "昨天",
  "今天",
  "明天",
  "后天",
  "上周",
  "上星期",
  "本周",
  "这周",
  "这星期",
  "下周",
  "下星期",
  "上个月",
  "上月",
  "这个月",
  "本月",
  "下个月",
  "去年",
  "今年",
  "明年",
  "刚刚",
  "刚才",
  "最近",
  "前一阵",
  "前段时间",
];

/** English relative-time phrases (matched case-insensitively, word-bounded). */
const EN_TIME_PATTERNS: RegExp[] = [
  /\byesterday\b/gi,
  /\btoday\b/gi,
  /\btomorrow\b/gi,
  /\bthe\s+other\s+day\b/gi,
  /\blast\s+week\b/gi,
  /\blast\s+month\b/gi,
  /\blast\s+year\b/gi,
  /\bthis\s+week\b/gi,
  /\bthis\s+month\b/gi,
  /\bthis\s+year\b/gi,
  /\bnext\s+week\b/gi,
  /\bnext\s+month\b/gi,
  /\bnext\s+year\b/gi,
  /\brecently\b/gi,
  /\bjust\s+now\b/gi,
];

/** Absolute dates — ISO-ish (2025-03-01 / 2025/3 / 2025.3.1) and 中文 (2025年3月1日 / 3月1日 / 5号).
 * NOTE: CJK text has no \b (Chinese chars are not ASCII word chars), so the
 * standalone `N号` pattern uses a negative lookahead for common NON-date
 * compounds (5号楼 / 2号线 / 3号座 …) instead — everything else that reads as
 * a day-of-month marker is stripped (adversarial review round 1). */
const DATE_PATTERNS: RegExp[] = [
  /\d{4}\s*[-/.]\s*\d{1,2}(\s*[-/.]\s*\d{1,2})?/g,
  /\d{4}\s*年(\s*\d{1,2}\s*月)?(\s*\d{1,2}\s*[日号])?/g,
  /\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g,
  /\d{1,2}\s*号(?!(?:楼|线|座|室|房))/g,
];

/** "3 days ago" / "两周前" style relative offsets (两/几 also count as quantities). */
const AGO_PATTERNS: RegExp[] = [
  /\b\d+\s*(day|week|month|year)s?\s+ago\b/gi,
  /(?:\d+|两|几)\s*(?:天|周|星期|个月|月|年)\s*(?:之前|以前|前)/g,
];

/**
 * Strip time expressions from a raw recall query.
 * Returns the query with all time anchors removed and whitespace collapsed;
 * may return an empty string when the query was ONLY a time expression.
 */
export function stripTimeExpressions(raw: string): string {
  let out = raw;
  for (const re of EN_TIME_PATTERNS) out = out.replaceAll(re, " ");
  for (const re of AGO_PATTERNS) out = out.replaceAll(re, " ");
  for (const re of DATE_PATTERNS) out = out.replaceAll(re, " ");
  for (const w of ZH_TIME_WORDS) out = out.replaceAll(w, " ");
  // Collapse whitespace, then drop the dangling space a strip can leave
  // before sentence punctuation ("book ?" → "book?").
  return out
    .replace(/\s+/g, " ")
    .replace(/\s+([?.!,;:，。？！；：])/g, "$1")
    .trim();
}

/**
 * Build the recall query variants for the FTS leg: the original query plus
 * the event (time-stripped) variant. Deduplicated; empty and no-op variants
 * are dropped, so the result always contains at least the original (when
 * non-empty) and never duplicates it.
 */
export function buildRecallQueryVariants(raw: string): string[] {
  const variants: string[] = [];
  const seen = new Set<string>();
  const original = raw.trim();
  if (original) {
    variants.push(original);
    seen.add(original);
  }
  const eventVariant = stripTimeExpressions(raw);
  if (eventVariant && !seen.has(eventVariant)) {
    variants.push(eventVariant);
    seen.add(eventVariant);
  }
  return variants;
}

// ── Rank fusion across variant lists ────────────────────────────────────────

/** RRF constant — same value (k=60) as the keyword↔embedding merge in auto-recall. */
export const RRF_K = 60;

/**
 * Fuse multiple ranked FTS result lists (one per query variant) into a single
 * ranking via Reciprocal Rank Fusion. A record appearing in several variant
 * lists sums its per-list RRF scores (1/(k + rank + 1)); the payload kept for
 * a record is its occurrence from the best-ranked list position.
 */
export function fuseByRrf(lists: L1FtsResult[][], k: number = RRF_K): L1FtsResult[] {
  const fused = new Map<string, { rrf: number; bestRank: number; result: L1FtsResult }>();
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const r = list[rank];
      const rrf = 1 / (k + rank + 1);
      const existing = fused.get(r.record_id);
      if (existing) {
        existing.rrf += rrf;
        if (rank < existing.bestRank) {
          existing.bestRank = rank;
          existing.result = r;
        }
      } else {
        fused.set(r.record_id, { rrf, bestRank: rank, result: r });
      }
    }
  }
  return [...fused.values()].sort((a, b) => b.rrf - a.rrf || a.bestRank - b.bestRank).map((e) => e.result);
}
