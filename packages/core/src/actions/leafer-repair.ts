/**
 * Leafer self-check + repair loop — the UI-Design counterpart of
 * prototype.ts's repairOpenuiProgram (specs/leafer-ui-engine WP0.2, WP5).
 * The verdict is TWO deterministic sources merged:
 *   1. structural validation (leafer-contract.validateLeaferDocument) —
 *      the document must parse, shape-match and stay in-canvas;
 *   2. the error-severity subset of the deterministic lint
 *      (leafer-lint.lintLeaferDocument: out-of-bounds, empty-scene) —
 *      the "合理的要求" quality bar.
 * Warning/info lint findings NEVER enter the loop — a subjective-quality
 * gate would make repair oscillate (无抖动 requirement).
 *
 * Failure semantics are deliberately FAIL-CLOSED, unlike the OpenUI loop's
 * fail-open: there is no external renderer-side backstop for leafer JSON,
 * both verdict sources are fully deterministic (never unavailable), and
 * EARS 2/3 pin the contract — a document below the bar must never persist.
 * On success the text is CANONICALIZED (JSON.stringify(JSON.parse(…))) so
 * persisted/committed scene documents carry no formatting or key-order
 * jitter across generations.
 */

import type { ActionContext } from "./types";
import { extractGeneratedBody } from "./prototype";
import {
  leaferIssueCount,
  looksLikeLeaferDocument,
  parseLeaferDocument,
  validateLeaferDocument,
  formatLeaferFeedback,
  type LeaferVerdict,
} from "./leafer-contract";
import { lintLeaferDocument } from "./leafer-lint";

/** Repair rounds after the initial generation (same budget rationale as
 *  MAX_OPENUI_REPAIR_ROUNDS: near-miss fixes are usually one-statement edits). */
const MAX_LEAFER_REPAIR_ROUNDS = 2;

export type LeaferRepairResult = { ok: true; value: string } | { ok: false; error: string };

/** Canonical form of a parsed leafer document; null when unparsable. */
export function canonicalLeaferText(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Run the full deterministic self-check over one document text. Error-level
 * lint findings (out-of-bounds / empty-scene) are promoted into the verdict
 * alongside the structural issues; warnings stay out of the gate.
 */
export function selfCheckLeaferDocument(text: string): LeaferVerdict {
  const structural = verdictOf(text);
  if (!structural.valid) return structural;
  const canonical = canonicalLeaferText(text);
  if (!canonical) return structural;
  const blockers = lintLeaferDocument(canonical)
    .filter((finding) => finding.severity === "error")
    .map((finding) => ({ code: finding.ruleId, path: finding.nodePath, message: finding.message }));
  return blockers.length > 0 ? { valid: false, issues: blockers } : structural;
}

/**
 * Self-check + repair loop: validate the document, and while the gate fails
 * feed the structured findings back to the designer subagent for a limited
 * number of patch rounds. Returns the CANONICAL verified document text, or a
 * structured error carrying the final verdict.
 */
export async function repairLeaferProgram(
  ctx: ActionContext,
  opts: { text: string; contract: string; progressCode: string; basePercent: number }
): Promise<LeaferRepairResult> {
  let text = opts.text;
  let verdict: LeaferVerdict = selfCheckLeaferDocument(text);
  if (verdict.valid) {
    const canonical = canonicalLeaferText(text);
    return { ok: true, value: canonical ?? text };
  }
  // Callers guard runSubagent; without it there is no repair channel —
  // fail closed with the verdict instead of persisting an invalid document.
  if (!ctx.runSubagent) {
    return {
      ok: false,
      error: `leafer document failed the self-check gate (no repair channel): ${verdict.issues.map((issue) => issue.code).join(", ")}`,
    };
  }
  for (let round = 0; round < MAX_LEAFER_REPAIR_ROUNDS; round += 1) {
    const issues = leaferIssueCount(verdict);
    ctx.emit({
      message: `Repairing ${issues} leafer self-check issue(s) (round ${round + 1}/${MAX_LEAFER_REPAIR_ROUNDS})`,
      percent: opts.basePercent + round * 5,
      data: { code: opts.progressCode },
    });
    const generated = await ctx.runSubagent({
      skill: "deep-design",
      prompt:
        "The Leafer scene-tree JSON document below failed the deterministic self-check gate. " +
        "Fix EVERY reported issue and return the COMPLETE corrected document in one json code fence. " +
        "Change nothing beyond what the issues require. Do not call tools.\n\n" +
        `${opts.contract}\n\nSelf-check issues:\n${formatLeaferFeedback(verdict)}\n\nCurrent document:\n${text}`,
      silent: true,
    });
    const candidate = extractGeneratedBody(generated);
    if (!candidate || !looksLikeLeaferDocument(candidate)) continue; // keep the last document, spend the next round
    text = candidate;
    verdict = selfCheckLeaferDocument(text);
    if (verdict.valid) {
      const canonical = canonicalLeaferText(text);
      return { ok: true, value: canonical ?? text };
    }
  }
  return {
    ok: false,
    error:
      `leafer document failed the self-check gate after ${MAX_LEAFER_REPAIR_ROUNDS} repair round(s) — ` +
      `${leaferIssueCount(verdict)} issue(s) remain:\n${formatLeaferFeedback(verdict)}`,
  };
}

function verdictOf(text: string): LeaferVerdict {
  const parsed = parseLeaferDocument(text);
  return parsed.ok
    ? validateLeaferDocument(parsed.value)
    : { valid: false, issues: [{ code: "json-parse", path: "document", message: parsed.error }] };
}
