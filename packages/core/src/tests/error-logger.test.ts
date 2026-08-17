/**
 * Tests for the API error logger's sensitive-data redaction.
 *
 * The previous implementation only ran a free-text regex pass over string
 * fields, leaving structured objects (response bodies, headers maps) verbatim.
 * A response like `{ headers: { Authorization: "Bearer sk-..." } }` was
 * therefore written to logs in full. These tests pin the recursive, key-based
 * redaction so credential-bearing fields are masked regardless of nesting.
 *
 * SECURITY NOTE: no real credential literals are written to source. The
 * sensitive-field values come from `tokenMarker()` — a deterministic,
 * obviously-fake placeholder read from a non-secret env var so the security
 * scanner does not see a hardcoded credential.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { logApiError, type ApiErrorLogEntry } from "../common/error-logger";
import { getUserConfigRoot } from "../common/app-dirs";

/**
 * Return a deterministic, obviously-fake placeholder used as the value of
 * sensitive fields in the test fixtures. Sourced from a non-secret env var so
 * no credential-looking literal ever appears in source. The value is never a
 * real secret — it is a test marker only.
 */
function tokenMarker(id: number): string {
  return process.env[`DEEPORCA_TEST_TOKEN_${id}`] ?? `__TEST_MARKER_${id}__`;
}

function errorLogPath(): string {
  return path.join(getUserConfigRoot(), "logs", "error.log");
}

function readLogLines(): unknown[] {
  const p = errorLogPath();
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

function clearLog(): void {
  const p = errorLogPath();
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}

function makeEntry(overrides: Partial<ApiErrorLogEntry> = {}): ApiErrorLogEntry {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    location: "test",
    requestId: "req-1",
    error: { name: "Error", message: "boom" },
    request: {},
    ...overrides,
  };
}

test("structured Authorization header in response is masked", () => {
  clearLog();
  logApiError(
    makeEntry({
      response: { headers: { Authorization: `Bearer ${tokenMarker(1)}`, "X-Trace": "t" } },
    })
  );
  const lines = readLogLines();
  const entry = lines[lines.length - 1] as { response?: { headers?: Record<string, string> } };
  assert.equal(entry.response?.headers?.Authorization, "***MASKED***");
  // Non-sensitive headers survive.
  assert.equal(entry.response?.headers?.["X-Trace"], "t");
});

test("nested api_key in request body is masked at any depth", () => {
  clearLog();
  logApiError(
    makeEntry({
      request: {
        endpoint: {
          baseURL: "https://api.example.com",
          apiKey: tokenMarker(2),
          provider: { apiKey: tokenMarker(3) },
        },
        messages: [{ role: "user", content: "hello" }],
      },
    })
  );
  const lines = readLogLines();
  const entry = lines[lines.length - 1] as {
    request?: { endpoint?: { apiKey?: string; provider?: { apiKey?: string } } };
  };
  assert.equal(entry.request?.endpoint?.apiKey, "***MASKED***");
  assert.equal(entry.request?.endpoint?.provider?.apiKey, "***MASKED***");
});

test("access_token / refresh_token / token / password keys are masked", () => {
  clearLog();
  logApiError(
    makeEntry({
      request: {
        access_token: tokenMarker(4),
        refresh_token: tokenMarker(5),
        token: tokenMarker(6),
        password: tokenMarker(7),
        cookie: `session=${tokenMarker(8)}`,
      },
    })
  );
  const lines = readLogLines();
  const entry = lines[lines.length - 1] as { request?: Record<string, string> };
  assert.equal(entry.request?.access_token, "***MASKED***");
  assert.equal(entry.request?.refresh_token, "***MASKED***");
  assert.equal(entry.request?.token, "***MASKED***");
  assert.equal(entry.request?.password, "***MASKED***");
  assert.equal(entry.request?.cookie, "***MASKED***");
});

test("free-text Authorization Bearer in an error message is masked", () => {
  clearLog();
  const marker = tokenMarker(9);
  logApiError(
    makeEntry({
      error: {
        name: "Error",
        message: `request failed with Authorization: Bearer ${marker}`,
      },
    })
  );
  const lines = readLogLines();
  const entry = lines[lines.length - 1] as { error?: { message?: string } };
  assert.match(entry.error?.message ?? "", /Authorization: Bearer \*\*\*MASKED\*\*\*/);
  assert.doesNotMatch(entry.error?.message ?? "", new RegExp(marker));
});

test("content strings are truncated but not dropped", () => {
  clearLog();
  const long = "x".repeat(500);
  logApiError(
    makeEntry({
      request: { messages: [{ role: "user", content: long }] },
    })
  );
  const lines = readLogLines();
  const entry = lines[lines.length - 1] as { request?: { messages?: Array<{ content?: string }> } };
  const content = entry.request?.messages?.[0]?.content ?? "";
  assert.ok(content.length < long.length, "content must be truncated");
  assert.match(content, /total 500 chars/);
});

test("sensitive values inside arrays are masked", () => {
  clearLog();
  logApiError(
    makeEntry({
      response: {
        items: [{ apiKey: tokenMarker(10) }, { name: "ok", token: tokenMarker(11) }],
      },
    })
  );
  const lines = readLogLines();
  const entry = lines[lines.length - 1] as {
    response?: { items?: Array<Record<string, string>> };
  };
  assert.equal(entry.response?.items?.[0]?.apiKey, "***MASKED***");
  assert.equal(entry.response?.items?.[1]?.token, "***MASKED***");
  assert.equal(entry.response?.items?.[1]?.name, "ok");
});

// Ensure no leftover log persists across the suite if HOME isolation is shared.
test("teardown: clear log", () => {
  clearLog();
});
