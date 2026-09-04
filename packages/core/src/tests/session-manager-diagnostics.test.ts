import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDiagnosticsSystemMessage, type DiagnosticsLegResult } from "../session-manager-diagnostics";

const err = (file: string, lines: string[], source: "serena" | "lsp" = "serena"): DiagnosticsLegResult => ({
  file,
  source,
  errors: lines,
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
