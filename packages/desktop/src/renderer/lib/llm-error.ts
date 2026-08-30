/**
 * Classify background-build failures that point at MODEL TRANSPORT problems
 * (endpoint unreachable / auth / timeout) rather than pipeline bugs.
 *
 * The index stages run on BackgroundLlmTask; their failures arrive in the
 * renderer as free-text strings produced by the openai SDK and the fetch
 * layer ("Request timed out.", "404 <!DOCTYPE html>…", "Invalid API key"),
 * so detection is deliberately signature-based over those shapes. Kept tight
 * on purpose: a wiki CLI exit or a mermaid parse error must NOT pop the
 * dialog — it belongs to the build console, not the model plumbing.
 */

const LLM_ERROR_SIGNATURES: readonly string[] = [
  // openai SDK / undici connection failures
  "request timed out",
  "request failed",
  "connection error",
  "fetch failed",
  "apiconnectionerror",
  // node network error codes
  "econnrefused",
  "econnreset",
  "enotfound",
  "etimedout",
  "eai_again",
  "certificate",
  // HTTP status shapes ("HTTP 404: …", "status code 500", "401 Unauthorized")
  "http 4",
  "http 5",
  "status code 4",
  "status code 5",
  // auth / quota
  "invalid api key",
  "incorrect api key",
  "unauthorized",
  "insufficient_quota",
  "insufficient balance",
  "quota exceeded",
  "rate limit",
];

export function looksLikeLlmTransportError(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const message = raw.toLowerCase();
  if (LLM_ERROR_SIGNATURES.some((signature) => message.includes(signature))) return true;
  // openai SDK shape for non-JSON responses: the message IS "<status> <body>"
  // (e.g. "404 <!DOCTYPE html>…" from a gateway's SPA fallback page).
  return /^\s*[1-5]\d{2}\s+\S/.test(message);
}
