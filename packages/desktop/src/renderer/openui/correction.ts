/**
 * Correction loop for OpenUI render errors (plan Batch 8, M5).
 *
 * The SDK's onError hands back structured error codes (unknown-component,
 * missing-required, parse-failed, …). Instead of only showing a local error
 * panel, organize them into a feedback message the agent can act on and send
 * it back through the normal prompt channel — once per prototype version,
 * never twice for the same code+errors (prevents an LLM↔renderer loop).
 */

export type RendererErrorLike = {
  code?: string;
  message?: string;
};

/** Build the feedback prompt for the agent; null when not worth feeding back. */
export function buildCorrectionPrompt(errors: RendererErrorLike[], code: string): string | null {
  if (errors.length === 0) return null;
  const lines = errors.slice(0, 5).map((e) => {
    const codeTag = e.code ? `[${e.code}] ` : "";
    return `- ${codeTag}${e.message ?? "unknown error"}`;
  });
  const more = errors.length > 5 ? `\n(and ${errors.length - 5} more)` : "";
  return (
    `The OpenUI Lang prototype you last sent failed to render with these errors:\n` +
    `${lines.join("\n")}${more}\n\n` +
    `Fix the errors and call update_openui again with the complete corrected program ` +
    `(full replacement — resend the whole program, not just the fixed lines).`
  );
}

/**
 * Whether a correction may be fed back: at most once per prototype code, and
 * only when the error set changed since the last feedback (same code + same
 * errors means the previous fix attempt failed — surface to the user instead
 * of looping).
 */
export function shouldRetry(
  errors: RendererErrorLike[],
  lastFed: { code: string; errorCodes: string } | null,
  currentCode: string
): boolean {
  if (errors.length === 0) return false;
  const errorCodes = errors
    .map((e) => e.code ?? "unknown")
    .sort()
    .join(",");
  if (!lastFed) return true;
  return lastFed.code !== currentCode || lastFed.errorCodes !== errorCodes;
}

/** Stable fingerprint of the fed-back state, for shouldRetry's next round. */
export function correctionFingerprint(errors: RendererErrorLike[], code: string): { code: string; errorCodes: string } {
  return {
    code,
    errorCodes: errors
      .map((e) => e.code ?? "unknown")
      .sort()
      .join(","),
  };
}
