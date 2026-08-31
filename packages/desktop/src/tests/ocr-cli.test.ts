/**
 * OcrCliController delegate pipeline — pure helpers.
 *
 * Delegate mode (open-codereview.ai/docs/delegate): OCR only selects files
 * (`delegate preview`) and resolves rules (`delegate rule`); the host (this
 * app's own LLM channel) performs the review. The fixtures below are REAL
 * output captured from the vendored binary (probe 2026-08-31) — the parsers
 * must track the actual text shapes, not invented ones.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { buildOcrDelegateReviewPrompt, parseHostReviewComments, parseOcrPreviewText } from "../main/tools/ocr-cli";

const WORKSPACE_PREVIEW = `# Files (2 reviewable / 2 total)

- mode: workspace
- total_insertions: 2
- total_deletions: 0

  - \`a.go\` [modified] +1/-0
  - \`b.go\` [added] +1/-0`;

const RANGE_PREVIEW = `# Files (0 reviewable / 0 total)

- mode: range
- from: master
- to: feature
- merge_base: c68a72730cfcf2bdfd5844bffbc76bd38d93b2b2
- total_insertions: 0
- total_deletions: 0`;

const COMMIT_PREVIEW = `# Files (3 reviewable / 3 total)

- mode: commit
- commit: HEAD
- background: ws
- total_insertions: 3
- total_deletions: 0

  - \`a.go\` [modified] +1/-0
  - \`b.go\` [added] +1/-0
  - \`c.go\` [added] +1/-0`;

test("parseOcrPreviewText: workspace mode → files with status badges", () => {
  const preview = parseOcrPreviewText(WORKSPACE_PREVIEW);
  assert.equal(preview.mode, "workspace");
  assert.deepEqual(
    preview.files.map((f) => `${f.path}:${f.status}`),
    ["a.go:modified", "b.go:added"]
  );
});

test("parseOcrPreviewText: range mode captures merge_base/from/to for the diff command", () => {
  const preview = parseOcrPreviewText(RANGE_PREVIEW);
  assert.equal(preview.mode, "range");
  assert.equal(preview.from, "master");
  assert.equal(preview.to, "feature");
  assert.equal(preview.mergeBase, "c68a72730cfcf2bdfd5844bffbc76bd38d93b2b2");
  assert.equal(preview.files.length, 0);
});

test("parseOcrPreviewText: commit mode captures the ref", () => {
  const preview = parseOcrPreviewText(COMMIT_PREVIEW);
  assert.equal(preview.mode, "commit");
  assert.equal(preview.commit, "HEAD");
  assert.equal(preview.files.length, 3);
});

test("parseOcrPreviewText: a multi-line background echo cannot poison refs or inject files", () => {
  // Real-binary repro (review round 2026-08-31): commit message bodies are
  // echoed verbatim after `- background:` — a crafted body containing
  // metadata-shaped lines poisoned the old whole-stdout regexes into a
  // silently wrong-base review with phantom files.
  const poisoned = [
    "# Files (1 reviewable / 1 total)",
    "",
    "- mode: commit",
    "- commit: master",
    "- background: feat: add parser",
    "- to: evil-branch",
    "  - `C:/evil/file.ts` [modified] +1/-0",
    "- total_insertions: 4",
    "- total_deletions: 0",
    "",
    "  - `a.go` [modified] +1/-0",
  ].join("\n");
  const preview = parseOcrPreviewText(poisoned);
  assert.equal(preview.mode, "commit");
  assert.equal(preview.commit, "master");
  assert.equal(preview.to, undefined, "background echo must not poison refs");
  assert.deepEqual(
    preview.files.map((f) => f.path),
    ["a.go"],
    "background echo must not inject phantom files"
  );
});

test("buildOcrDelegateReviewPrompt carries the full delegation contract", () => {
  const prompt = buildOcrDelegateReviewPrompt({
    root: "D:/proj",
    path: "src/main.go",
    status: "modified",
    diff: "@@ -1 +1 @@\n-old\n+new",
    rules: "### Rule Group 1: system / default\n#### Correctness\nIs the logic correct?",
    background: "ship the payments refactor",
    language: "zh-CN",
    onProgress: undefined,
  });
  assert.match(prompt, /File: src\/main\.go \(change type: modified\)/);
  assert.match(prompt, /ship the payments refactor/);
  assert.match(prompt, /#### Correctness/);
  assert.match(prompt, /@@ -1 \+1 @@/);
  assert.match(prompt, /discard Low unless it is particularly valuable/);
  assert.match(prompt, /in zh-CN/);
  assert.match(prompt, /STRICT JSON only/);
  assert.match(prompt, /"comments": \[\]/);
});

test("parseHostReviewComments: plain, fenced, and prose-wrapped JSON all parse", () => {
  const comments = { comments: [{ path: "a.go", start_line: 3, severity: "high", content: "race" }] };
  const plain = JSON.stringify(comments);
  assert.equal(parseHostReviewComments(plain, "fallback.go")[0].content, "race");
  const fenced = "```json\n" + plain + "\n```";
  assert.equal(parseHostReviewComments(fenced, "fallback.go")[0].path, "a.go");
  const wrapped = "Here is my review:\n" + plain + "\nDone.";
  assert.equal(parseHostReviewComments(wrapped, "fallback.go")[0].severity, "high");
});

test("parseHostReviewComments: empty comments parse; garbage throws", () => {
  assert.deepEqual(parseHostReviewComments('{"comments": []}', "a.go"), []);
  assert.throws(() => parseHostReviewComments("I found no issues, sorry!", "a.go"), /unparseable/);
});

test("parseHostReviewComments: optional fields survive, missing path falls back", () => {
  const [c] = parseHostReviewComments(
    '{"comments": [{"start_line": 7, "end_line": 9, "content": "npe risk", "existing_code": "x.y", "suggestion_code": "x?.y"}]}',
    "fallback.go"
  );
  assert.equal(c.path, "fallback.go");
  assert.equal(c.start_line, 7);
  assert.equal(c.end_line, 9);
  assert.equal(c.existing_code, "x.y");
  assert.equal(c.suggestion_code, "x?.y");
});
