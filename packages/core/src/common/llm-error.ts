const MAX_MESSAGE_LENGTH = 500;
const MAX_CAUSE_DEPTH = 5;

type ErrorRecord = Record<string, unknown>;

export type LlmErrorDetails = {
  name: string;
  message: string;
  stack?: string;
  status?: number;
  code?: string;
  type?: string;
  param?: string;
  requestId?: string;
  traceId?: string;
  causes?: LlmErrorDetails[];
};

/**
 * Produce a concise, credential-safe explanation from OpenAI-compatible API
 * errors and their underlying network causes.
 */
export function describeLlmError(error: unknown): string {
  const details = getLlmErrorDetails(error);
  const parts: string[] = [];

  if (details.status !== undefined) {
    const message = getProviderMessage(error) ?? details.message;
    parts.push(`HTTP ${details.status}: ${message}`);
    if (details.code) {
      parts.push(`code: ${details.code}`);
    }
    if (details.type) {
      parts.push(`type: ${details.type}`);
    }
    if (details.param) {
      parts.push(`param: ${details.param}`);
    }
    if (details.requestId) {
      parts.push(`request ID: ${details.requestId}`);
    }
    if (details.traceId) {
      parts.push(`trace ID: ${details.traceId}`);
    }
    return formatErrorParts(parts);
  }

  const causeMessage = findUsefulCauseMessage(details.causes ?? []);
  if (causeMessage && isGenericConnectionMessage(details.message)) {
    return `Connection error: ${causeMessage}`;
  }
  if (causeMessage && causeMessage !== details.message) {
    return `${details.message} (cause: ${causeMessage})`;
  }
  return details.message;
}

/**
 * Coarse-grained error categories used to decide recovery behavior (retry vs
 * compact-and-retry vs fail fast). Mirrors dsh's normalized error codes,
 * calibrated against DeepSeek/OpenAI-compatible error texts.
 */
export type LlmErrorCategory =
  | "AUTH"
  | "QUOTA"
  | "RATE_LIMIT"
  | "CONTEXT_WINDOW_EXCEEDED"
  | "SERVER"
  | "TRANSIENT"
  | "TIMEOUT"
  | "UNKNOWN";

const AUTH_PATTERNS = [
  /invalid[^.]{0,20}api[_ -]?key/i,
  /incorrect api[_ -]?key/i,
  /api key not valid/i,
  /authentication/i,
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
];

const QUOTA_PATTERNS = [
  /insufficient balance/i,
  /insufficient quota/i,
  /exceeded your current quota/i,
  /quota exceeded/i,
  /\bin arrears\b/i,
  /billing/i,
  /balance is not enough/i,
];

const RATE_LIMIT_PATTERNS = [/rate[ _-]?limit/i, /too many requests/i, /requests per (?:minute|second|day)/i];

const CONTEXT_WINDOW_PATTERNS = [
  /maximum context length/i,
  /context[ _-]?length/i,
  /context[ _-]?window/i,
  /context limit/i,
  /exceeds? (?:the )?context/i,
  /too many (?:input )?tokens/i,
  /prompt is too long/i,
  /reduce the length of the (?:messages|prompt|input)/i,
  /input tokens? .{0,40}exceed/i,
];

const TIMEOUT_PATTERNS = [/\btimed?[ _-]?out\b/i, /\betimedout\b/i, /\beconnaborted\b/i, /deadline exceeded/i];

const TRANSIENT_PATTERNS = [
  /\beconnreset\b/i,
  /\beconnrefused\b/i,
  /\benotfound\b/i,
  /\beai_again\b/i,
  /\bepipe\b/i,
  /socket hang up/i,
  /fetch failed/i,
  /network error/i,
  /connection (?:error|reset|refused|closed)/i,
];

/** Sentinel name used by the session stream idle watchdog (session.ts). */
export const LLM_STREAM_IDLE_TIMEOUT_ERROR_NAME = "LlmStreamIdleTimeoutError";

export function classifyLlmError(error: unknown): LlmErrorCategory {
  const details = getLlmErrorDetails(error);
  if (details.name === LLM_STREAM_IDLE_TIMEOUT_ERROR_NAME) {
    return "TIMEOUT";
  }

  const text = [details.message, getProviderMessage(error) ?? "", details.code ?? "", details.type ?? ""].join("\n");

  if (details.status === 401 || details.status === 403) return "AUTH";
  if (details.status === 402) return "QUOTA";
  if (details.status === 429) return "RATE_LIMIT";
  if (matchesAny(text, AUTH_PATTERNS)) return "AUTH";
  if (matchesAny(text, QUOTA_PATTERNS)) return "QUOTA";
  if (matchesAny(text, RATE_LIMIT_PATTERNS)) return "RATE_LIMIT";
  if (matchesAny(text, CONTEXT_WINDOW_PATTERNS)) return "CONTEXT_WINDOW_EXCEEDED";
  if (matchesAny(text, TIMEOUT_PATTERNS)) return "TIMEOUT";
  if (details.status !== undefined && details.status >= 500) return "SERVER";
  if (matchesAny(text, TRANSIENT_PATTERNS)) return "TRANSIENT";
  return "UNKNOWN";
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Extract serializable diagnostics for local logs without retaining the
 * original error object, which can contain circular references.
 */
export function getLlmErrorDetails(error: unknown): LlmErrorDetails {
  return getErrorDetails(error, 0, new Set<object>());
}

function getErrorDetails(error: unknown, depth: number, seen: Set<object>): LlmErrorDetails {
  const record = isRecord(error) ? error : null;
  const name = safeText(record?.name) ?? (error instanceof Error ? error.name : "UnknownError");
  const message = safeText(record?.message) ?? safeText(error) ?? "Unknown error";
  const details: LlmErrorDetails = { name, message };

  const status = record?.status;
  if (typeof status === "number" && Number.isFinite(status)) {
    details.status = status;
  }
  for (const key of ["code", "type", "param"] as const) {
    const value = safeText(record?.[key]);
    if (value) {
      details[key] = value;
    }
  }
  const requestId = safeText(record?.requestID) ?? getHeader(record?.headers, "x-request-id");
  if (requestId) {
    details.requestId = requestId;
  }
  const traceId = getHeader(record?.headers, "x-ds-trace-id");
  if (traceId) {
    details.traceId = traceId;
  }
  const stack = safeText(record?.stack, MAX_MESSAGE_LENGTH * 4);
  if (stack) {
    details.stack = stack;
  }

  if (record && depth < MAX_CAUSE_DEPTH && !seen.has(record)) {
    seen.add(record);
    if (record.cause !== undefined) {
      details.causes = [getErrorDetails(record.cause, depth + 1, seen)];
    }
  }
  return details;
}

function getProviderMessage(error: unknown): string | undefined {
  if (!isRecord(error) || !isRecord(error.error)) {
    return undefined;
  }
  return safeText(error.error.message);
}

function getHeader(headers: unknown, name: string): string | undefined {
  if (headers && typeof (headers as { get?: unknown }).get === "function") {
    return safeText((headers as { get(name: string): unknown }).get(name));
  }
  if (isRecord(headers)) {
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
    return entry ? safeText(entry[1]) : undefined;
  }
  return undefined;
}

function findUsefulCauseMessage(causes: LlmErrorDetails[]): string | undefined {
  for (const cause of causes) {
    if (!isGenericConnectionMessage(cause.message)) {
      return cause.message;
    }
    const nested = findUsefulCauseMessage(cause.causes ?? []);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function isGenericConnectionMessage(message: string): boolean {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    normalized === "connection error" ||
    normalized === "connection error." ||
    normalized === "fetch failed" ||
    normalized === "request timed out." ||
    normalized === "request timed out"
  );
}

function formatErrorParts(parts: string[]): string {
  const [first, ...metadata] = parts;
  return metadata.length > 0 ? `${first} [${metadata.join(", ")}]` : (first ?? "Unknown error");
}

function safeText(value: unknown, maxLength = MAX_MESSAGE_LENGTH): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const normalized = maskSensitive(String(value)).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function isRecord(value: unknown): value is ErrorRecord {
  return Boolean(value) && typeof value === "object";
}

function maskSensitive(text: string): string {
  return text
    .replace(/(Authorization\s*[:=]\s*(?:Bearer\s+)?)[^\s,;]+/gi, "$1***MASKED***")
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token)=)[^&\s]+/gi, "$1***MASKED***")
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|secret)["']?\s*[:=]\s*["']?)[^",}\s]+/gi, "$1***MASKED***")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "***MASKED***");
}
