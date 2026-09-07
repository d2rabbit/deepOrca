import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCorrectionPrompt,
  correctionFingerprint,
  shouldRetry,
  splitOpenuiErrors,
} from "../renderer/openui/correction";

const ERRORS = [
  { code: "unknown-component", message: "Unknown component: Gridd" },
  { code: "parse-failed", message: "Line 3 could not be parsed" },
];

test("buildCorrectionPrompt turns error codes into an actionable fix request", () => {
  const prompt = buildCorrectionPrompt(ERRORS, "root = Gridd([])");
  assert.ok(prompt);
  assert.match(prompt, /unknown-component/);
  assert.match(prompt, /parse-failed/);
  assert.match(prompt, /update_openui/);
  assert.match(prompt, /complete corrected program/);
});

test("buildCorrectionPrompt returns null when there is nothing to fix", () => {
  assert.equal(buildCorrectionPrompt([], "root = Column([])"), null);
});

test("shouldRetry allows the first feedback and blocks same code + same errors", () => {
  const code = "root = Gridd([])";
  assert.equal(shouldRetry(ERRORS, null, code), true);
  const fed = correctionFingerprint(ERRORS, code);
  assert.equal(shouldRetry(ERRORS, fed, code), false);
});

test("shouldRetry re-arms when the code changed (new prototype version)", () => {
  const fed = correctionFingerprint(ERRORS, "root = Gridd([])");
  assert.equal(shouldRetry(ERRORS, fed, "root = Grid([])"), true);
});

test("shouldRetry re-arms when the error set changed", () => {
  const fed = correctionFingerprint(ERRORS, "root = Gridd([])");
  const newErrors = [{ code: "missing-required", message: "Column requires children" }];
  assert.equal(shouldRetry(newErrors, fed, "root = Gridd([])"), true);
});

test("dead-button-action audit findings fold into warnings and ride the correction loop", () => {
  // M3: the audit finding must be non-fatal (amber fold, render continues)
  // while still feeding shouldRetry/buildCorrectionPrompt.
  const finding = {
    code: "dead-button-action",
    message: 'Button passes a plain string ("save") as its action argument',
  };
  const { fatal, warnings } = splitOpenuiErrors([finding]);
  assert.equal(fatal.length, 0);
  assert.equal(warnings.length, 1);
  assert.ok(shouldRetry([finding], null, "code-v1"), "first finding feeds back");
  const prompt = buildCorrectionPrompt([finding], "code-v1");
  assert.ok(prompt?.includes("[dead-button-action]"), "code tag reaches the agent");
  assert.ok(prompt?.includes('("save")'), "the offending literal reaches the agent");
});
