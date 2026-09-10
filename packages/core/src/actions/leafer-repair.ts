/**
 * Leafer repair loop — the UI-Design counterpart of prototype.ts's
 * repairOpenuiProgram (specs/leafer-ui-engine WP0.2). Feeds the deterministic
 * structural verdict (leafer-contract.validateLeaferDocument) back to the
 * deep-design subagent for a limited number of patch rounds.
 *
 * Failure semantics are deliberately FAIL-CLOSED, unlike the OpenUI loop's
 * fail-open: there is no external renderer-side backstop for leafer JSON, our
 * validator is fully deterministic (never unavailable), and EARS 2/3 pin the
 * contract — a structurally invalid document must never persist ("修复成功才
 * 持久化"). Callers surface the structured error instead of a broken artifact.
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

/** Repair rounds after the initial generation (same budget rationale as
 *  MAX_OPENUI_REPAIR_ROUNDS: near-miss fixes are usually one-statement edits). */
const MAX_LEAFER_REPAIR_ROUNDS = 2;

export type LeaferRepairResult = { ok: true; value: string } | { ok: false; error: string };

/** Validate the document text; invalid shapes get limited repair rounds with
 *  the structured findings fed back to the designer subagent. Returns the
 *  verified document text, or a structured error carrying the final verdict. */
export async function repairLeaferProgram(
  ctx: ActionContext,
  opts: { text: string; contract: string; progressCode: string; basePercent: number }
): Promise<LeaferRepairResult> {
  let text = opts.text;
  let verdict: LeaferVerdict = verdictOf(text);
  if (verdict.valid) return { ok: true, value: text };
  // Callers guard runSubagent; without it there is no repair channel —
  // fail closed with the verdict instead of persisting an invalid document.
  if (!ctx.runSubagent) {
    return {
      ok: false,
      error: `leafer document failed structural validation (no repair channel): ${verdict.issues.map((issue) => issue.code).join(", ")}`,
    };
  }
  for (let round = 0; round < MAX_LEAFER_REPAIR_ROUNDS; round += 1) {
    const issues = leaferIssueCount(verdict);
    ctx.emit({
      message: `Repairing ${issues} leafer structural issue(s) (round ${round + 1}/${MAX_LEAFER_REPAIR_ROUNDS})`,
      percent: opts.basePercent + round * 5,
      data: { code: opts.progressCode },
    });
    const generated = await ctx.runSubagent({
      skill: "deep-design",
      prompt:
        "The Leafer scene-tree JSON document below failed structural validation. " +
        "Fix EVERY reported issue and return the COMPLETE corrected document in one json code fence. " +
        "Change nothing beyond what the issues require. Do not call tools.\n\n" +
        `${opts.contract}\n\nValidation issues:\n${formatLeaferFeedback(verdict)}\n\nCurrent document:\n${text}`,
      silent: true,
    });
    const candidate = extractGeneratedBody(generated);
    if (!candidate || !looksLikeLeaferDocument(candidate)) continue; // keep the last document, spend the next round
    text = candidate;
    verdict = verdictOf(text);
    if (verdict.valid) return { ok: true, value: text };
  }
  return {
    ok: false,
    error:
      `leafer document failed structural validation after ${MAX_LEAFER_REPAIR_ROUNDS} repair round(s) — ` +
      `${leaferIssueCount(verdict)} issue(s) remain:\n${formatLeaferFeedback(verdict)}`,
  };
}

function verdictOf(text: string): LeaferVerdict {
  const parsed = parseLeaferDocument(text);
  return parsed.ok
    ? validateLeaferDocument(parsed.value)
    : { valid: false, issues: [{ code: "json-parse", path: "document", message: parsed.error }] };
}
