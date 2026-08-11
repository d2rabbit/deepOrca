import * as fs from "fs";
import * as path from "path";
import { getUserConfigRoot } from "./app-dirs";
import type { LlmErrorDetails } from "./llm-error";

const LOG_DIR = path.join(getUserConfigRoot(), "logs");
const ERROR_LOG_PATH = path.join(LOG_DIR, "error.log");

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Mask sensitive values (API keys, tokens) that may appear in error messages
 * or response bodies.
 *
 * Two layers:
 *  - `maskSensitiveString` runs a regex pass over a string (catches values
 *    that were inlined into a free-text error message).
 *  - `redactSensitiveKeys` walks a structured object/array and replaces the
 *    VALUE of any key whose name looks sensitive (case-insensitive), so a
 *    structured `headers: { Authorization: "Bearer ..." }` response is masked
 *    even when the regex never sees the literal.
 */
const SENSITIVE_KEY_RE =
  /^(authorization|x-api-key|api[-_]?key|apikey|secret|secret[-_]?key|access[-_]?token|refresh[-_]?token|token|bearer|password|passwd|cookie|set-cookie|api[-_]?secret|client[-_]?secret)$/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

function maskSensitive(text: string): string {
  return (
    text
      // Mask Bearer tokens in Authorization headers
      .replace(/(Authorization:\s*Bearer\s+)[^\s\r\n]+/gi, "$1***MASKED***")
      // Mask "apiKey" or "api_key" values in JSON-like strings
      .replace(/((?:api[Kk]ey|api_key|secret)\s*[:=]\s*"?)[^",}\s]+/gi, "$1***MASKED***")
  );
}

const CONTENT_TRUNCATE_PREVIEW = 100;
const MASKED = "***MASKED***";

/**
 * Truncate a content string for logging: keep a short prefix and append the
 * total length so the payload structure is preserved while content bloat is
 * avoided.
 */
function truncateContent(value: string): string {
  if (value.length <= CONTENT_TRUNCATE_PREVIEW) {
    return value;
  }
  return `${value.slice(0, CONTENT_TRUNCATE_PREVIEW)}...(total ${value.length} chars)`;
}

/**
 * Recursively walk a value and return a sanitised copy where:
 *  - any key whose name matches {@link SENSITIVE_KEY_RE} has its value
 *    replaced with {@link MASKED}, no matter how deeply nested (object or
 *    array, string or sub-object);
 *  - `content` string values are truncated to a preview;
 *  - any remaining string value also gets the free-text {@link maskSensitive}
 *    regex pass (catches JSON serialised inside a string field).
 *
 * This is applied to request, response and error cause payloads so structured
 * headers/auth/cookies cannot leak into logs.
 */
function redactSensitiveKeys(value: unknown): unknown {
  // Primitive leaf: run the string masker on strings.
  if (value === null || typeof value !== "object") {
    return typeof value === "string" ? maskSensitive(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map(redactSensitiveKeys);
  }
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(record)) {
    if (isSensitiveKey(key)) {
      // Mask the whole value regardless of type — a structured auth object is
      // just as sensitive as a bare string.
      result[key] = MASKED;
      continue;
    }
    if (key === "content" && typeof val === "string") {
      result[key] = truncateContent(maskSensitive(val));
      continue;
    }
    result[key] = redactSensitiveKeys(val);
  }
  return result;
}

/**
 * Deep-clone a request payload, truncating `content` strings and masking any
 * sensitive keys. Every non-sensitive field is kept exactly as-is so the
 * logged request mirrors the original API payload structure.
 */
function sanitizeRequestPayload(request: Record<string, unknown>): Record<string, unknown> {
  return redactSensitiveKeys(request) as Record<string, unknown>;
}

export type ApiErrorLogEntry = {
  timestamp: string;
  location: string;
  requestId: string;
  sessionId?: string;
  model?: string;
  baseURL?: string;
  error: LlmErrorDetails;
  request: Record<string, unknown>;
  response?: unknown;
};

/**
 * Write an API error log entry to the app config dir (logs/error.log).
 */
export function logApiError(entry: ApiErrorLogEntry): void {
  try {
    ensureLogDir();

    const logLine: Record<string, unknown> = {
      timestamp: entry.timestamp,
      location: entry.location,
      requestId: entry.requestId,
      sessionId: entry.sessionId,
      model: entry.model,
      baseURL: entry.baseURL,
      error: sanitizeError(entry.error),
      request: sanitizeRequestPayload(entry.request),
    };

    if (entry.response !== undefined) {
      // Response may be a structured object (provider JSON, headers map) or a
      // string. Both paths must go through the redactor — the previous code
      // ran maskSensitive only on strings and passed objects through verbatim,
      // so a response with `headers: { Authorization: ... }` leaked verbatim.
      logLine.response = redactSensitiveKeys(entry.response);
    }

    const newLine = JSON.stringify(logLine) + "\n";
    fs.appendFileSync(ERROR_LOG_PATH, newLine, "utf8");

    // Keep only the last N entries
    const MAX_ENTRIES = 20;
    const raw = fs.readFileSync(ERROR_LOG_PATH, "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length > MAX_ENTRIES) {
      fs.writeFileSync(ERROR_LOG_PATH, lines.slice(-MAX_ENTRIES).join("\n") + "\n", "utf8");
    }
  } catch {
    // Silently ignore logging failures to avoid disrupting the main flow
  }
}

function sanitizeError(error: LlmErrorDetails): LlmErrorDetails {
  return {
    ...error,
    message: maskSensitive(error.message),
    stack: error.stack ? maskSensitive(error.stack) : undefined,
    causes: error.causes?.map(sanitizeError),
  };
}
