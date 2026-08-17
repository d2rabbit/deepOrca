import * as fs from "fs";
import * as path from "path";
import { getUserConfigRoot } from "./app-dirs";
import { redactSensitiveKeys } from "./error-logger";

const DEBUG_LOG_FILE = "debug.log";
/**
 * Security: the debug log mirrors full LLM requests (messages, tool results,
 * error stacks) — the most sensitive file the app writes after settings.
 * Restrictive permissions + a hard size cap keep a long debug session from
 * becoming an unbounded plaintext transcript on a shared machine.
 * (Directory needs the execute bit to be traversable — 0700, not 0600.)
 */
const DEBUG_LOG_DIR_MODE = 0o700;
const DEBUG_LOG_FILE_MODE = 0o600;
const MAX_DEBUG_LOG_BYTES = 20 * 1024 * 1024;

export type OpenAIChatCompletionDebugEntry = {
  timestamp: string;
  location: string;
  requestId?: string;
  sessionId?: string;
  model?: string;
  baseURL?: string;
  durationMs?: number;
  params?: Record<string, unknown>;
  request: Record<string, unknown>;
  response?: unknown;
  responseChunks?: unknown[];
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
};

export function logOpenAIChatCompletionDebug(entry: OpenAIChatCompletionDebugEntry): void {
  try {
    const logPath = getDebugLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: DEBUG_LOG_DIR_MODE });
    // Same redaction pipeline as the API error log: sensitive keys masked at
    // any depth, `content` strings truncated, free-text regex pass — SDK error
    // messages/stacks frequently embed `Authorization: Bearer sk-…` verbatim.
    const line = `${JSON.stringify(redactSensitiveKeys(toSerializable(entry)))}\n`;
    const size = safeStatSize(logPath);
    if (size >= 0 && size + line.length > MAX_DEBUG_LOG_BYTES) {
      // Cap reached: rotate by truncating (keep newest writes flowing) rather
      // than silently dropping diagnostics or growing without bound.
      fs.writeFileSync(logPath, line, { encoding: "utf8", mode: DEBUG_LOG_FILE_MODE });
      return;
    }
    fs.appendFileSync(logPath, line, { encoding: "utf8", mode: DEBUG_LOG_FILE_MODE });
  } catch {
    // Debug logging must never affect CLI behavior.
  }
}

export function getDebugLogPath(): string {
  return path.join(getUserConfigRoot(), "logs", DEBUG_LOG_FILE);
}

export function normalizeDebugError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    name: "UnknownError",
    message: String(error),
  };
}

function safeStatSize(logPath: string): number {
  try {
    return fs.statSync(logPath).size;
  } catch {
    return -1;
  }
}

function toSerializable(value: unknown): unknown {
  const seen = new WeakSet<object>();

  function walk(current: unknown): unknown {
    if (typeof current === "bigint") {
      return current.toString();
    }
    if (current instanceof Error) {
      return normalizeDebugError(current);
    }
    if (!current || typeof current !== "object") {
      return current;
    }
    if (seen.has(current)) {
      return "[Circular]";
    }
    seen.add(current);
    if (Array.isArray(current)) {
      return current.map(walk);
    }
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(current)) {
      result[key] = walk(val);
    }
    return result;
  }

  return walk(value);
}
