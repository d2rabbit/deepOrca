/**
 * Complexity-gate prompt fragment (specs/depth-lane §2.2, P0.1/P0.2).
 *
 * This text is appended to the tail of the EXISTING skill-matching system
 * prompt (templates/auxiliary/skill-matching.md.ejs renders it through the
 * `complexityDirective` slot) so one flash call returns two verdicts:
 * skillNames/multiIntent AND the four-dimension complexity scores.
 *
 * Contract red lines baked into the wording:
 *   - each dimension is binary (0 or its full score) — no intermediate values;
 *   - the model must NOT report a lane of its own — `lane` is computed by
 *     program code from T+P+C+R >= threshold (gate.ts), never trusted from
 *     the response (anti-self-contradiction rule, design §2.2);
 *   - every field the gate reads is strictly validated (parseTpcrScores);
 *     anything malformed fails open to the express lane.
 *
 * Keep this string byte-stable per build — it is part of the auxiliary call's
 * prompt and the disabled/enabled distinction is what preserves the
 * byte-level regression baseline for `complexityGate.enabled: false`.
 */

/** Full score per dimension (design §2.2: 各维 0 或满分，无中间值). */
export const TPCR_FULL_SCORES = { T: 25, P: 30, C: 25, R: 20 } as const;

/** The L2 scoring directive appended to the skill-matching system prompt tail. */
export const COMPLEXITY_SCORING_DIRECTIVE = [
  "Additionally, judge the TASK COMPLEXITY of the user's request on four dimensions. Each dimension is binary: output its FULL score when the criterion is met, otherwise 0 — never an intermediate value.",
  "",
  "- T (time horizon, 25): the outcome depends on consequences spanning more than ~7 days, or on predicting future states/events.",
  "- P (player conflict, 30): two or more independent-willed stakeholders with conflicting interests are involved (negotiation, pricing, competing teams), and their reactions matter.",
  "- C (causal chain, 25): reaching the answer needs a causal chain of 3+ steps, or branching reasoning of the form A→B, C→D where downstream branches depend on upstream outcomes.",
  "- R (irreversible risk, 20): the cost of being wrong is high (money, safety, reputation, deletions), or the user explicitly names risk/strategy/tradeoff concerns.",
  "",
  'Extend the JSON response with these extra fields: "T": 0|25, "P": 0|30, "C": 0|25, "R": 0|20, "reason": "<one-sentence justification>".',
  "Do NOT add a lane/verdict/recommendation field — the routing decision is computed from your four scores, not chosen by you.",
  "When in doubt on any dimension, score it 0: simple requests must stay cheap.",
].join("\n");

/**
 * The inline fail-open twin of the directive (mirrors the skill-matching
 * template's inline fallback pattern): used when the .ejs template is
 * unreadable so a packaging gap never changes gate behavior.
 */
export const COMPLEXITY_SCORING_DIRECTIVE_FALLBACK = COMPLEXITY_SCORING_DIRECTIVE;
