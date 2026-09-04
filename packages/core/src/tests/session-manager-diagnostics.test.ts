import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDiagnosticsSystemMessage,
  summarizeLegFailure,
  type DiagnosticsLegResult,
} from "../session-manager-diagnostics";

const err = (file: string, lines: string[], source: "serena" | "lsp" = "serena"): DiagnosticsLegResult => ({
  file,
  source,
  status: "ok",
  errors: lines,
});

const unavailable = (
  file: string,
  source: "serena" | "lsp",
  reason = "bridge not connected"
): DiagnosticsLegResult => ({
  file,
  source,
  status: "unavailable",
  unavailableReason: reason,
  errors: [],
});

test("diagnostics merge: returns null when both legs are clean", () => {
  assert.equal(buildDiagnosticsSystemMessage([err("a.ts", []), err("a.ts", [], "lsp")]), null);
  assert.equal(buildDiagnosticsSystemMessage([]), null);
});

test("diagnostics merge: dedupes lines the two legs both reported", () => {
  const message = buildDiagnosticsSystemMessage([
    err("a.ts", ["L3: foo is not defined"]),
    err("a.ts", ["L3: foo is not defined", "L7: type mismatch"], "lsp"),
  ])!;
  assert.ok(message.includes("2 个错误"));
  assert.equal(message.split("L3: foo is not defined").length - 1, 1);
  assert.ok(message.includes("L7: type mismatch"));
});

test("diagnostics merge: keeps files separate and errors attributed", () => {
  const message = buildDiagnosticsSystemMessage([err("a.ts", ["L1: a error"]), err("b.py", ["L2: b error"], "lsp")])!;
  assert.ok(message.includes("2 个错误"));
  assert.ok(message.indexOf("a.ts") < message.indexOf("b.py"));
  assert.ok(message.includes("L2: b error"));
});

test("diagnostics merge: caps the message and marks truncation", () => {
  const spam = Array.from({ length: 200 }, (_, i) => `L${i}: ${"x".repeat(40)}`);
  const message = buildDiagnosticsSystemMessage([err("big.rs", spam)], 2048)!;
  assert.ok(message.length <= 2048 + 40);
  assert.ok(message.includes("已截断"));
});

// ── CMB-1 truth table (specs/cmb-adoption design §2.1) ─────────────────────

test("CMB-1: single unavailable leg with zero errors degrades loudly, not as clean", () => {
  const message = buildDiagnosticsSystemMessage([
    err("a.ts", []),
    unavailable("a.ts", "lsp", "missing typescript-language-server"),
  ])!;
  assert.notEqual(message, null);
  assert.ok(message.includes("部分诊断检查不可用"));
  assert.ok(message.includes("LSP bridge"));
  assert.ok(message.includes("missing typescript-language-server"));
  assert.ok(!message.includes("个错误")); // zero errors must not fake a "clean" either
});

test("CMB-1: both legs unavailable yields a degradation-only message naming both", () => {
  const message = buildDiagnosticsSystemMessage([
    unavailable("a.ts", "serena", "server crashed"),
    unavailable("a.ts", "lsp", "budget exhausted"),
  ])!;
  assert.ok(message.includes("Serena（server crashed）"));
  assert.ok(message.includes("LSP bridge（budget exhausted）"));
  assert.ok(!message.includes("个错误"));
});

test("CMB-1: errors mixed with an unavailable leg keep both parts", () => {
  const message = buildDiagnosticsSystemMessage([
    err("a.ts", ["L3: foo is not defined"]),
    unavailable("a.ts", "lsp", "deps-missing"),
  ])!;
  assert.ok(message.includes("部分诊断检查不可用"));
  assert.ok(message.includes("deps-missing"));
  assert.ok(message.includes("1 个错误"));
  assert.ok(message.includes("L3: foo is not defined"));
  // degradation line comes first so truncation can only eat the error body
  assert.ok(message.indexOf("部分诊断检查不可用") < message.indexOf("L3: foo is not defined"));
});

test("CMB-1: degradation line survives truncation of a huge error body", () => {
  const spam = Array.from({ length: 200 }, (_, i) => `L${i}: ${"x".repeat(40)}`);
  const message = buildDiagnosticsSystemMessage(
    [err("big.rs", spam), unavailable("big.rs", "lsp", "timeout after 5000ms")],
    2048
  )!;
  assert.ok(message.includes("部分诊断检查不可用"));
  assert.ok(message.includes("timeout after 5000ms"));
  assert.ok(message.includes("已截断"));
  assert.ok(message.indexOf("部分诊断检查不可用") < message.indexOf("已截断"));
});

test("CMB-1: identical unavailable reasons collapse across files", () => {
  const message = buildDiagnosticsSystemMessage([
    unavailable("a.ts", "lsp", "same reason"),
    unavailable("b.py", "lsp", "same reason"),
  ])!;
  assert.equal(message.split("same reason").length - 1, 1);
});

test("CMB-1: summarizeLegFailure clips long error messages to the reason budget", () => {
  const long = new Error("x".repeat(500));
  assert.ok(summarizeLegFailure(long).length <= 120);
  assert.equal(summarizeLegFailure("boom"), "boom");
});

// ── CMB-1/CMB-5 envelope wiring: the manager NEVER throws tool-level failures —
// it returns {ok:false, output}. These tests pin the two helpers that keep a
// failed leg distinguishable from a clean one (latent bug fixed: the envelope
// shape previously never parsed, so the turn-end check saw zero errors forever).

import { assertDiagnosticsEnvelopeOk, extractErrorDiagnostics } from "../session-mcp-hints";

test("CMB-1 envelope: extractErrorDiagnostics parses the manager envelope output", () => {
  const envelope = {
    ok: true,
    name: "mcp__lsp-bridge__get_diagnostics",
    output:
      '{"ok":true,"diagnostics":[{"severity":"1","message":"foo is not defined","range":{"start":{"line":3,"character":0},"end":{"line":3,"character":8}}},{"severity":"2","message":"warn","range":{"start":{"line":9}}},{"severity":"error","message":"plain error"}]}',
  };
  assert.deepEqual(extractErrorDiagnostics(envelope), [
    "L3: foo is not defined",
    "plain error", // severity "error" string form; no range → bare message
  ]);
});

test("CMB-1 envelope: raw CallToolResult shape still parses (compat path)", () => {
  const raw = { content: [{ type: "text", text: '[{"severity":"1","message":"boom","range":{"start":{"line":0}}}]' }] };
  assert.deepEqual(extractErrorDiagnostics(raw), ["L0: boom"]);
});

test("CMB-1 envelope: assertDiagnosticsEnvelopeOk throws with the embedded inner error", () => {
  const failed = {
    ok: false,
    name: "x",
    output:
      '{"ok":false,"error":"LSP_UNAVAILABLE(deps-missing): typescript dependencies not installed — run npm install"}',
  };
  assert.throws(
    () => assertDiagnosticsEnvelopeOk(failed),
    /LSP_UNAVAILABLE\(deps-missing\): typescript dependencies not installed/
  );
  // envelope-level error (manager catch path) wins when present
  assert.throws(() => assertDiagnosticsEnvelopeOk({ ok: false, name: "x", error: "call timed out" }), /call timed out/);
  // ok envelopes pass through silently
  assert.doesNotThrow(() => assertDiagnosticsEnvelopeOk({ ok: true, name: "x", output: "{}" }));
  assert.doesNotThrow(() => assertDiagnosticsEnvelopeOk(undefined));
});
