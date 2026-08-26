/**
 * Unit tests for the build-error second-stage translation helper.
 *
 * Main-process build stages embed localized fix hints as machine-readable
 * `[hint:...]` tokens (main has no i18n runtime; the LLM may be exactly what
 * broke, so translation happens at display time in the renderer). These tests
 * pin the token grammar: parse, model param, strip from verbatim text, clip
 * budget, and passthrough for unmarked errors.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { splitBuildError, formatBuildError } from "../renderer/lib/build-error.js";
import type { Translate } from "../renderer/i18n/index.js";

const t: Translate = (key, params) => {
  const dict: Record<string, string> = {
    "buildHint.wikiNetwork": "NET_HINT",
    "buildHint.modelUsed": `MODEL(${params?.model ?? "?"})`,
    "buildHint.wikiTimeout": "TIMEOUT_HINT",
  };
  return dict[key] ?? key;
};

test("splitBuildError: extracts the wiki-network hint with model", () => {
  const { text, hints } = splitBuildError("openwiki exited 1: terminated [hint:wiki-network model=deepseek-chat]");
  assert.equal(text, "openwiki exited 1: terminated");
  assert.deepEqual(hints, [{ kind: "wiki-network", model: "deepseek-chat" }]);
});

test("splitBuildError: hint without model param carries no model", () => {
  const { hints } = splitBuildError("boom [hint:wiki-network]");
  assert.deepEqual(hints, [{ kind: "wiki-network" }]);
});

test("splitBuildError: unknown hint kinds stay in the text (no silent drop)", () => {
  const { text, hints } = splitBuildError("boom [hint:something-else]");
  assert.equal(hints.length, 0);
  assert.match(text, /\[hint:something-else\]/);
});

test("formatBuildError: appends the translated hint after the verbatim text", () => {
  const out = formatBuildError("openwiki exited 1: terminated [hint:wiki-network model=deepseek-chat]", t);
  assert.equal(out, "openwiki exited 1: terminated — NET_HINT MODEL(deepseek-chat)");
});

test("formatBuildError: clip budget applies to the raw text only", () => {
  const raw = `${"x".repeat(100)} [hint:wiki-timeout]`;
  const out = formatBuildError(raw, t, 20);
  assert.equal(out, `${"x".repeat(20)}… — TIMEOUT_HINT`);
});

test("formatBuildError: unmarked errors pass through, clipped when limited", () => {
  assert.equal(formatBuildError("plain failure", t), "plain failure");
  assert.equal(formatBuildError("plain failure", t, 5), "plain…");
});

test("formatBuildError: timeout hint from the wiki-cli timeout path", () => {
  const out = formatBuildError("wiki --init 超时（120s） [hint:wiki-timeout]", t);
  assert.equal(out, "wiki --init 超时（120s） — TIMEOUT_HINT");
});
