/**
 * OcrCliController delegate pipeline — pure helpers.
 *
 * Delegate mode (open-codereview.ai/docs/delegate): OCR only selects files
 * (`delegate preview`) and resolves rules (`delegate rule`); the host (this
 * app's own LLM channel) performs the review. The fixtures below are REAL
 * output captured from the vendored binary (probe 2026-08-31) — the parsers
 * must track the actual text shapes, not invented ones.
 */

import { execFile } from "node:child_process";
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  OcrCliController,
  balancedJsonObjects,
  buildOcrDelegateReviewPrompt,
  filterDotPaths,
  parseHostReviewComments,
  parseOcrPreviewText,
  safeSlice,
} from "../main/tools/ocr-cli";

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

test("parseOcrPreviewText: strikethrough exclusions are surfaced with reasons", () => {
  // REAL GVGL output (probe 2026-08-31): OCR marks skipped changes with
  // ~~strikethrough~~ bullets + an exclusion reason. Dot-path junk that OCR
  // itself still lists as "reviewable" is dropped later by filterDotPaths —
  // both paths must be visible so a 0-file run is EXPLAINABLE.
  const raw = [
    "# Files (6 reviewable / 9 total)",
    "",
    "- mode: workspace",
    "- total_insertions: 14345",
    "- total_deletions: 0",
    "",
    "~~- `.gitignore` [modified] +9/-0 (excluded: user_exclude)~~",
    "  - `.deeporca/prototypes/arch-gvgl.architecture.html` [added] +13852/-0",
    "  - `.deeporca/prototypes/arch-gvgl.architecture.html.receipt.json` [added] +1/-0",
    "  - `.deeporca/prototypes/arch-gvgl.architecture.json` [added] +221/-0",
    "  - `.deeporca/prototypes/undefined.json` [added] +72/-0",
    "  - `.serena/.gitignore` [added] +2/-0",
    "  - `.serena/project.yml` [added] +169/-0",
    "~~- `AGENTS.md` [added] +12/-0 (excluded: unsupported_ext)~~",
    "~~- `CLAUDE.md` [added] +7/-0 (excluded: unsupported_ext)~~",
  ].join("\n");
  const preview = parseOcrPreviewText(raw);
  assert.equal(preview.files.length, 6, "unstruck bullets parse as reviewable");
  assert.equal(preview.excluded.length, 3, "strikethrough bullets parse as excluded");
  assert.deepEqual(
    preview.excluded.map((e) => e.reason),
    ["user_exclude", "unsupported_ext", "unsupported_ext"]
  );
  const kept = filterDotPaths(preview.files);
  assert.equal(kept.length, 0, "dot-path junk is dropped host-side");
  assert.equal(preview.excluded.filter((e) => e.reason.includes("unsupported")).length, 2);
});

test("parseOcrPreviewText: format drift throws instead of reading as 'no reviewable changes'", () => {
  // Leftover round 2026-08-31 — the old parser returned a plausible
  // `{mode:"workspace", files:[]}` for any drifted shape, which runReview
  // reported as a clean success that reviewed nothing. Empty/short output,
  // an unclosed metadata block, and a header/bullet count disagreement must
  // all fail loudly.
  assert.throws(() => parseOcrPreviewText(""), /unrecognizable output format/);
  assert.throws(() => parseOcrPreviewText("ocr: something went wrong"), /unrecognizable output format/);
  assert.throws(
    () => parseOcrPreviewText("# Files (1 reviewable / 1 total)\n\n- mode: workspace\n- total_insertions: 1"),
    /unrecognizable output format/,
    "metadata block without the total_deletions terminator"
  );
  assert.throws(
    () =>
      parseOcrPreviewText(
        [
          "# Files (2 reviewable / 2 total)",
          "",
          "- mode: workspace",
          "- total_insertions: 2",
          "- total_deletions: 0",
          "",
          "  - `a.go` [modified] +1/-0",
        ].join("\n")
      ),
    /file list incomplete/,
    "header count disagreeing with the parsed bullets"
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

test("parseHostReviewComments: a `{` in the prose does not blind the JSON extraction", () => {
  // Leftover round 2026-08-31 — extraction started at the FIRST `{`, so prose
  // like "the map literal {…} is built here" swallowed the real JSON object
  // and the whole file degraded to "unparseable output". Every opening brace
  // is now a candidate until one parses.
  const wrapped =
    'Note: the map literal {k: v} is built below.\n{"comments": [{"path": "a.go", "start_line": 2, "content": "off-by-one"}]}';
  const comments = parseHostReviewComments(wrapped, "fallback.go");
  assert.equal(comments.length, 1);
  assert.equal(comments[0].content, "off-by-one");
  assert.deepEqual(balancedJsonObjects('{"a":1} tail {"b":2}'), ['{"a":1}', '{"b":2}']);
  assert.deepEqual(balancedJsonObjects("no braces at all"), []);
});

test("safeSlice: never cuts a surrogate pair at the truncation boundary", () => {
  // 😀 is one code point over two UTF-16 code units; slicing at 4 would leave
  // a lone high surrogate in the excerpt (U+FFFD once JSON-encoded).
  const s = "abc😀def";
  assert.equal(safeSlice(s, 4), "abc");
  assert.equal(safeSlice(s, 5), "abc😀");
  assert.equal(safeSlice(s, 100), s);
  assert.equal(safeSlice(s, 0), "");
});

test("diffFor: glob-magic filenames ride :(literal) pathspecs so git diffs the actual file", async () => {
  // Leftover round 2026-08-31 — git pathspecs are globs, so a reviewed file
  // literally named `a[1].txt` matched nothing and workspace mode silently
  // "reviewed" an empty diff. Verified against a real throwaway repo.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocr-glob-"));
  const git = (...args: string[]) =>
    new Promise<void>((resolve, reject) =>
      execFile("git", ["-C", root, ...args], { windowsHide: true }, (err) => (err ? reject(err) : resolve()))
    );
  try {
    await git("init", "-q");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "test");
    const file = "a[1].txt";
    await fs.writeFile(path.join(root, file), "one\n");
    await git("add", "--", `:(literal)${file}`);
    await git("commit", "-qm", "init");
    await fs.writeFile(path.join(root, file), "one\ntwo\n");

    const controller = new OcrCliController({ runHostReview: async () => [] });
    const diff = await (
      controller as unknown as {
        diffFor(root: string, scope: { mode: "workspace" }, file: string): Promise<string>;
      }
    ).diffFor(root, { mode: "workspace" }, file);
    assert.match(diff, /\+two/, "the diff must be for the literal file, not a glob miss");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("filterDotPaths: generated content never becomes a review target", () => {
  // User screenshot 2026-08-31: the review picked up .deeporca/prototypes
  // artifacts — everything the toolchain generates lives under dot-dirs, so
  // the host-side filter is the enforcement that survives OCR-side drift.
  const files = [
    { path: "src/auth.ts", status: "modified" },
    { path: ".deeporca/prototypes/arch-gvgl.architecture.html.receipt.json", status: "added" },
    { path: ".code-review-graph/graph.db", status: "modified" },
    { path: ".env.local", status: "added" },
    { path: "docs/notes/.hidden.md", status: "added" },
  ];
  assert.deepEqual(
    filterDotPaths(files).map((f) => f.path),
    ["src/auth.ts"],
    "any dot segment (file or directory, at any depth) drops out"
  );
  assert.deepEqual(filterDotPaths([]), []);
});
