/**
 * Unit tests for the LLM-transport error classifier that drives the
 * model-fault popup (real-machine 2026-08-27): background build failures
 * whose text smells like endpoint/network/auth trouble must be flagged;
 * pipeline-internal failures (wiki CLI exit, mermaid render) must not.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeLlmTransportError } from "../renderer/lib/llm-error";

test("flags real-world transport failure shapes", () => {
  // The exact arch-scan timeout reported on real machine.
  assert.equal(looksLikeLlmTransportError("Request timed out."), true);
  // The gateway HTML-404 shape from the misconfigured baseURL era.
  assert.equal(looksLikeLlmTransportError('404 <!DOCTYPE html><html lang="en">'), true);
  assert.equal(looksLikeLlmTransportError("HTTP 401: Invalid API key"), true);
  assert.equal(looksLikeLlmTransportError("fetch failed: ECONNRESET"), true);
});

test("does not flag pipeline-internal failures", () => {
  assert.equal(looksLikeLlmTransportError(null), false);
  assert.equal(looksLikeLlmTransportError(""), false);
  assert.equal(looksLikeLlmTransportError("openwiki exited 1: ENOENT scandir skills"), false);
  assert.equal(looksLikeLlmTransportError("mermaid parse error at line 3"), false);
  assert.equal(looksLikeLlmTransportError("CodeGraph already initialized in D:\\proj"), false);
});
