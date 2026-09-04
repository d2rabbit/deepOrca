// Store-reference chip parsing (renderer/lib/store-refs.ts) — regression
// pins for the 2026-09 review findings: "reviews" substring must not flip a
// wiki page to a review chip; a sentence period after a skill reference must
// not kill the chip; "$ …" prose must not become a command chip. Pure lib —
// no DOM or api stub needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractStoreReferences, splitStoreRefSegments } from "../renderer/lib/store-refs";

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
