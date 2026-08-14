import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLlmError, describeLlmError, getLlmErrorDetails } from "../common/llm-error";

test("describeLlmError shows provider business errors with trace metadata", () => {
  const error = Object.assign(new Error("402 Insufficient Balance"), {
    status: 402,
    error: {
      message: "Insufficient Balance",
    },
    code: "invalid_request_error",
    type: "unknown_error",
    headers: new Headers({
      "x-request-id": "request-123",
      "x-ds-trace-id": "trace-456",
    }),
  });

  assert.equal(
    describeLlmError(error),
    "HTTP 402: Insufficient Balance [code: invalid_request_error, type: unknown_error, request ID: request-123, trace ID: trace-456]"
  );
});

test("describeLlmError unwraps underlying network causes", () => {
  const cause = new Error("getaddrinfo ENOTFOUND api.deepseek.com");
  const error = Object.assign(new Error("Connection error."), { cause });

  assert.equal(describeLlmError(error), "Connection error: getaddrinfo ENOTFOUND api.deepseek.com");
});

test("LLM error details stop at circular causes and redact credentials", () => {
  const first = Object.assign(new Error("Connection error."), { cause: undefined as unknown });
  const second = new Error("fetch failed: https://example.test?api_key=sk-secret-value");
  (first as Error & { cause: unknown }).cause = second;
  (second as Error & { cause: unknown }).cause = first;

  const details = getLlmErrorDetails(first);
  assert.equal(details.causes?.[0]?.message, "fetch failed: https://example.test?api_key=***MASKED***");
  assert.equal(details.causes?.[0]?.causes?.[0]?.message, "Connection error.");
  assert.equal(details.causes?.[0]?.causes?.[0]?.causes, undefined);
});

test("classifyLlmError maps provider errors to recovery categories", () => {
  const contextOverflow = Object.assign(
    new Error("This model's maximum context length is 65536 tokens. However, you requested 131072 tokens."),
    { status: 400, code: "invalid_request_error" }
  );
  assert.equal(classifyLlmError(contextOverflow), "CONTEXT_WINDOW_EXCEEDED");

  const providerOverflow = Object.assign(new Error("Invalid request"), {
    status: 400,
    error: { message: "Input length exceeds context limit, please reduce input" },
  });
  assert.equal(classifyLlmError(providerOverflow), "CONTEXT_WINDOW_EXCEEDED");

  assert.equal(classifyLlmError(Object.assign(new Error("401 Authentication Fails"), { status: 401 })), "AUTH");
  assert.equal(classifyLlmError(Object.assign(new Error("402 Payment Required"), { status: 402 })), "QUOTA");
  assert.equal(classifyLlmError(Object.assign(new Error("Rate limit reached"), { status: 429 })), "RATE_LIMIT");
  assert.equal(classifyLlmError(Object.assign(new Error("Internal error"), { status: 500 })), "SERVER");
  assert.equal(classifyLlmError(new Error("Request timed out.")), "TIMEOUT");
  assert.equal(
    classifyLlmError(Object.assign(new Error("Connection error."), { cause: new Error("read ECONNRESET") })),
    "TRANSIENT"
  );
  assert.equal(classifyLlmError(new Error("something odd happened")), "UNKNOWN");
});

test("classifyLlmError recognizes the stream idle watchdog sentinel name", () => {
  const idle = Object.assign(new Error("LLM stream idle timeout: no data received for 300000ms"), {
    name: "LlmStreamIdleTimeoutError",
  });
  assert.equal(classifyLlmError(idle), "TIMEOUT");
});
