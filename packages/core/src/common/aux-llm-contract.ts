/**
 * Auxiliary LLM call contract (specs/cmb-adoption CMB-4, batch D).
 *
 * MemBrain treats every auxiliary LLM call as a versioned artifact: manifest +
 * prompt template + output schema + retry budget. This module is the repo's
 * lightweight equivalent for the two auxiliary primitives
 * (`judgeViaLlm` / `completeTextViaLlm`, session-manager-base.ts):
 *
 *   - `AuxSchema<T>`: a pure-function output validator. A schema failure is a
 *     CONTENT-level failure — it shares the fail-open semantics of transport
 *     failures (final answer null, caller falls back to its deterministic
 *     path) but is retried within the content budget, because the transport
 *     was fine and the model simply violated the contract.
 *   - `AUX_CONTENT_RETRY_BUDGET`: content-level retries per call. Transient
 *     TRANSPORT errors are deliberately NOT retried here — classification and
 *     backoff for those already live in `common/llm-error.ts` (dsh P0) and the
 *     primitives' callers; adding another layer would double-retry.
 *
 * Zero dependencies by design — validators are plain functions.
 */

export type AuxSchema<T> = {
  /** Human-readable contract, used in debug logs and JSDoc. */
  readonly describe: string;
  /** Return the narrowed value, or null when the parsed output violates the contract. */
  validate(parsed: unknown): T | null;
};

/** Content-level retry budget for auxiliary LLM calls (JSDoc contract). */
export const AUX_CONTENT_RETRY_BUDGET = 2;

/** Enum-of-strings schema — the minimal contract most judgments need. */
export function auxEnumSchema<T extends string>(values: readonly T[]): AuxSchema<T> {
  const allowed = new Set<string>(values);
  return {
    describe: `one of: ${values.join(", ")}`,
    validate: (parsed) => (typeof parsed === "string" && allowed.has(parsed) ? (parsed as T) : null),
  };
}

/**
 * Validate a raw LLM string output against a schema: parse JSON, then check.
 * Returns a discriminated result so callers can distinguish content failure
 * (retryable within budget) from success.
 */
export function applyAuxSchema<T>(raw: string, schema: AuxSchema<T>): { ok: true; value: T } | { ok: false } {
  let parsed: unknown;
  try {
    // completeTextViaLlm has no JSON mode — models routinely wrap the object
    // in a markdown fence. Strip full-line fences before parsing (a partial
    // strip leaves invalid JSON and lands in the catch anyway).
    const stripped = raw.replace(/^\s*```[a-zA-Z]*\s*\n?/, "").replace(/\n?```\s*$/, "");
    parsed = JSON.parse(stripped);
  } catch {
    return { ok: false };
  }
  const value = schema.validate(parsed);
  return value === null ? { ok: false } : { ok: true, value };
}
