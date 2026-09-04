/**
 * Lane feedback-rate telemetry (specs/depth-lane P2.3) + threshold auto-tune
 * (P2.4). First real-data calibration run: 2026-09-04, workspaces GVGL +
 * deepcode-cli (retro L1-proxy mode — see `retroProxied`).
 *
 * Two rates feed the threshold decision:
 *   - expressFollowUpRate: share of express-lane sessions whose answer was
 *     followed within the 10-minute window by a NEW user message that is
 *     semantically related to it (the "答得不够，用户在追" signal). Semantic
 *     relatedness ships as a deterministic bigram-overlap first pass; the
 *     production embedding-cosine form plugs in via `similarity` (calibration
 *     of the exact cosine cut needs real volumes — the hook is the seam).
 *   - deepNegativeFeedbackRate: share of deep-lane sessions whose report was
 *     followed by a user message matching the 6-language "太啰嗦" vocabulary
 *     (zh / zh-tw / zh-hk share the CJK forms; en / ja / ko covered below).
 *
 * Sessions created BEFORE the gate was enabled carry no `lane` — the caller
 * may classify them with the deterministic L1 rules as a documented PROXY
 * (`retroProxied` counts them; L1 returns null on the gray zone, which maps
 * to express, the same side fail-open lands on).
 */

export type LaneRateSession = {
  /** Live-stamped lane; absent → caller's retro classification (L1 proxy). */
  lane?: "express" | "deep";
  /** Chronological user messages (text + timestamp) of the session. */
  userMessages: ReadonlyArray<{ text: string; ts?: string }>;
};

export type LaneRatesReport = {
  expressSessions: number;
  deepSessions: number;
  /** Sessions lane-classified by the L1 proxy (pre-enable history). */
  retroProxied: number;
  /** null when there are no express sessions yet (rate undefined, not zero). */
  expressFollowUpRate: number | null;
  /** null when there are no deep sessions yet. */
  deepNegativeFeedbackRate: number | null;
  samples: { followUps: number; negatives: number };
};

/** 6-language conservative "too verbose" vocabulary (P2.3 口径, regex 保守采样). */
export const NEGATIVE_FEEDBACK_RE =
  /太长|太長|太啰嗦|啰嗦|废话|直接点|简洁点|精简一点|说重点|太复杂|看不懂你在写什么|too long|too verbose|be brief|get to the point|more concise|less verbose|長すぎ|簡潔に|要点だけ|간결하게|너무 길어|핵심만/i;

const FOLLOW_UP_WINDOW_MS = 10 * 60 * 1000;

/** Deterministic first-pass relatedness: CJK-bigram + word Jaccard overlap. */
function bigrams(text: string): Set<string> {
  const clean = text.toLowerCase().replace(/\s+/g, " ").trim();
  const grams = new Set<string>();
  const cjk = clean.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g);
  if (cjk) {
    for (let i = 0; i + 1 < cjk.length; i += 1) grams.add(cjk[i]! + cjk[i + 1]!);
  }
  for (const word of clean.split(/[^\p{L}\p{N}]+/u)) {
    if (word.length >= 3) grams.add(word);
  }
  return grams;
}

export function relatedness(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit += 1;
  return hit / Math.min(ga.size, gb.size);
}

const RELATED_BAR = 0.2;

export type SimilarityFn = (answerContext: string, nextMessage: string) => number;

/**
 * Compute the two rates. Pure: takes session arrays, returns the report.
 * `similarity` overrides the deterministic bigram pass (embedding-cosine seam).
 */
export function computeLaneRates(
  sessions: ReadonlyArray<LaneRateSession>,
  opts?: { followUpWindowMs?: number; similarity?: SimilarityFn }
): LaneRatesReport {
  const windowMs = opts?.followUpWindowMs ?? FOLLOW_UP_WINDOW_MS;
  const similarity = opts?.similarity ?? ((a, b) => relatedness(a, b));

  let express = 0;
  let deep = 0;
  let proxied = 0;
  let followUps = 0;
  let negatives = 0;

  for (const session of sessions) {
    if (session.lane === "deep") deep += 1;
    else {
      express += 1;
      if (session.lane === undefined) proxied += 1;
    }
    const msgs = session.userMessages;
    for (let i = 1; i < msgs.length; i += 1) {
      const prev = msgs[i - 1]!;
      const next = msgs[i]!;
      const prevTs = prev.ts ? Date.parse(prev.ts) : NaN;
      const nextTs = next.ts ? Date.parse(next.ts) : NaN;
      const withinWindow =
        Number.isFinite(prevTs) && Number.isFinite(nextTs) && nextTs - prevTs >= 0 && nextTs - prevTs <= windowMs;
      if (!withinWindow || !next.text) continue;
      const score = similarity(prev.text, next.text);
      if (session.lane === "deep") {
        if (NEGATIVE_FEEDBACK_RE.test(next.text)) {
          negatives += 1;
          break; // one negative counts a session once
        }
      } else if (score >= RELATED_BAR) {
        followUps += 1;
        break; // one follow-up counts a session once
      }
    }
  }

  return {
    expressSessions: express,
    deepSessions: deep,
    retroProxied: proxied,
    expressFollowUpRate: express > 0 ? followUps / express : null,
    deepNegativeFeedbackRate: deep > 0 ? negatives / deep : null,
    samples: { followUps, negatives },
  };
}

// ── Session collector (host-facing; used by the desktop laneRates IPC) ──────

/**
 * Collect LaneRateSessions from a project's own storage (read-only): index
 * entries + transcripts, L1-proxy lane for pre-gate sessions (undefined lane
 * → deterministic L1 on the first prompt; L1 null maps to express, the same
 * side fail-open lands on).
 */
export function collectLaneRateSessions(input: {
  readIndex(): Array<{ id: string; isSilentSubagent?: boolean; lane?: "express" | "deep" }>;
  readTranscript(
    sessionId: string
  ): Array<{ role?: string; content?: unknown; createTime?: string; meta?: { userPrompt?: { text?: string } } | null }>;
  evaluateL1?: (text: string) => { lane: "express" | "deep" } | null;
}): LaneRateSession[] {
  const out: LaneRateSession[] = [];
  for (const entry of input.readIndex()) {
    if (entry.isSilentSubagent) continue;
    const userMessages: Array<{ text: string; ts?: string }> = [];
    for (const m of input.readTranscript(entry.id)) {
      if (m.role !== "user") continue;
      const text = m.meta?.userPrompt?.text ?? (typeof m.content === "string" ? m.content : "");
      if (text && text.trim()) userMessages.push({ text, ts: m.createTime });
    }
    if (userMessages.length === 0) continue;
    const l1 = input.evaluateL1?.(userMessages[0]!.text);
    const lane: "express" | "deep" = entry.lane ?? (l1 ? l1.lane : "express");
    out.push({ lane, userMessages });
  }
  return out;
}

/**
 * P2.4 autoTune: 新阈值 = 旧阈值 + 追问率*0.5 − 负反馈率*0.5, ±step clamp
 * (default 5) and hard-clamped to [30, 70]. null rates act as 0 (no signal →
 * no move). Pure function — persistence and the audit-log entry are the
 * caller's job (each change must leave an audit trail per spec).
 */
export function autoTuneThreshold(
  current: number,
  followUpRate: number | null,
  negativeRate: number | null,
  opts?: { step?: number; min?: number; max?: number }
): { next: number; change: number; formula: string } {
  const step = opts?.step ?? 5;
  const min = opts?.min ?? 30;
  const max = opts?.max ?? 70;
  const raw = current + (followUpRate ?? 0) * 0.5 - (negativeRate ?? 0) * 0.5;
  const target = Math.min(current + step, Math.max(current - step, raw));
  const next = Math.round(Math.min(max, Math.max(min, target)) * 100) / 100;
  const change = Math.round((next - current) * 100) / 100;
  return {
    next,
    change,
    formula: `${current} + ${(followUpRate ?? 0).toFixed(2)}*0.5 − ${(negativeRate ?? 0).toFixed(2)}*0.5 → ${next} (step ±${step}, clamp [${min}, ${max}])`,
  };
}
