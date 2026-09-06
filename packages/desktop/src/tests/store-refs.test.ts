// Store-reference chip parsing (renderer/lib/store-refs.ts) — regression
// pins for the 2026-09 review findings: "reviews" substring must not flip a
// wiki page to a review chip; a sentence period after a skill reference must
// not kill the chip; "$ …" prose must not become a command chip. Pure lib —
// no DOM or api stub needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractStoreReferences,
  isCompleteStoreRef,
  splitStoreRefSegments,
  storeRefPath,
} from "../renderer/lib/store-refs";

test("deepwiki page whose filename contains 'reviews' stays a wiki chip", () => {
  const text = "see @D:\\repo\\.deeporca\\deepwiki\\reviews-guide.md for context";
  const { refs } = extractStoreReferences(text);
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "wiki");
  assert.equal(refs[0]?.label, "reviews-guide");
});

test("reports under the reviews DIRECTORY keep the review chip + timestamp label", () => {
  const text = "报告 @D:\\repo\\.deeporca\\reviews\\review-2026-08-30T10-30-abc.json 已生成";
  const { refs } = extractStoreReferences(text);
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "review");
  assert.equal(refs[0]?.label, "2026/08/30 10:30");
});

test("a skill reference followed by an ASCII sentence period still chips", () => {
  const text = "try @frontend-review. then report back";
  const segments = splitStoreRefSegments(text);
  const ref = segments.find((s) => s.kind === "ref");
  assert.ok(ref && ref.kind === "ref");
  if (ref.kind === "ref") {
    assert.equal(ref.ref.kind, "skill");
    assert.equal(ref.ref.raw, "@frontend-review", "the period stays outside the chip");
  }
  assert.ok(
    segments.some((s) => s.kind === "text" && s.text.startsWith(". then report")),
    "period remains text"
  );
});

test("a root-level file with an extension now chips as file (2026-09-05 fix 3)", () => {
  // "@frontend-review.md" reads like a file — since root-level files are
  // recognized, it is a FILE chip (the skill shape's extension lookahead
  // already yields disambiguation: @x.md → file, @x → skill).
  const { refs } = extractStoreReferences("open @frontend-review.md please");
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "file");
  assert.equal(refs[0]?.label, "frontend-review.md");
});

test("relative .deeporca forms keep their wiki/review semantics (2026-09-05 fix 2)", () => {
  const { refs } = extractStoreReferences(
    "see @.deeporca/deepwiki/roadmap.md and @.deeporca/reviews/review-2026-09-05T10-00.json"
  );
  assert.equal(refs.length, 2);
  assert.equal(refs[0]?.kind, "wiki");
  assert.equal(refs[0]?.label, "roadmap");
  assert.equal(refs[1]?.kind, "review");
});

test("root-level plain file chips as file (2026-09-05 fix 3)", () => {
  const { refs } = extractStoreReferences("check @README.md first");
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "file");
  assert.equal(refs[0]?.label, "README.md");
});

test("prose containing '$ ' does not become a command chip", () => {
  const text = "it costs $ a month after the trial";
  const { refs } = extractStoreReferences(text);
  assert.equal(refs.length, 0, "stopword-first prose is not a command");
  assert.equal(
    splitStoreRefSegments(text).every((s) => s.kind === "text"),
    true,
    "text preserved verbatim"
  );
});

test("real command lines still chip with the command as label", () => {
  const { refs } = extractStoreReferences("run $ npm test --watch");
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "cmd");
  assert.equal(refs[0]?.label, "npm test --watch");
});

// ── 2026-09-06: quoted form (whitespace paths) + root-level regression guards ──

test("a QUOTED wiki path containing spaces chips as wiki (2026-09-06 quoted form)", () => {
  const text = '参考 @"My Drive/My Project/.deeporca/deepwiki/road map.md" 再动手';
  const { refs } = extractStoreReferences(text);
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "wiki");
  assert.equal(refs[0]?.label, "road map", "label drops quotes and the .md suffix");
  assert.equal(refs[0]?.raw, '@"My Drive/My Project/.deeporca/deepwiki/road map.md"');
});

test("a QUOTED plain file path containing spaces chips as file", () => {
  const { refs } = extractStoreReferences('看下 @"docs/My Notes.txt" 谢谢');
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "file");
  assert.equal(refs[0]?.label, "My Notes.txt");
});

test("a QUOTED review path containing spaces chips as review with timestamp label", () => {
  const { refs } = extractStoreReferences('报告 @"My Project/.deeporca/reviews/review-2026-09-05T10-00-x.json" 已生成');
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "review");
  assert.equal(refs[0]?.label, "2026/09/05 10:00");
});

test("an email address in prose does NOT become a file chip (2026-09-06 guard)", () => {
  // Root-level files were legalized on 2026-09-05, which let the bare
  // "@gmail.com" tail of "someone@gmail.com" chip as a file — the lookbehind
  // now refuses an @ directly attached to a word character.
  const { refs } = extractStoreReferences("联系 someone@gmail.com 或者 dev@team.org 问问");
  assert.equal(refs.length, 0);
});

test("prose like '@e.g.' does NOT become a file chip (2026-09-06 guard)", () => {
  // Single-character basenames ("e" before the dot) are prose, not files.
  const { refs } = extractStoreReferences("如 @e.g. 与 @i.e. 所说");
  assert.equal(refs.length, 0);
});

test("single-character root-level basenames stay plain text (documented trade-off)", () => {
  // \S{2,}? requires a ≥2-char basename — real files that short at the repo
  // root are vanishingly rare, and prose forms are not.
  const { refs } = extractStoreReferences("open @a.ts now");
  assert.equal(refs.length, 0);
});

test("storeRefPath unwraps @-prefix and quotes for filesystem consumers", () => {
  assert.equal(storeRefPath("@.deeporca/deepwiki/roadmap.md"), ".deeporca/deepwiki/roadmap.md");
  assert.equal(storeRefPath('@"My Project/.deeporca/deepwiki/a.md"'), "My Project/.deeporca/deepwiki/a.md");
  assert.equal(storeRefPath("@README.md"), "README.md");
});

test("quoted refs count as COMPLETE (menu suppression over finished references)", () => {
  assert.equal(isCompleteStoreRef('@"My Project/.deeporca/deepwiki/a.md"'), true);
  assert.equal(isCompleteStoreRef('@"half typed'), false);
});
