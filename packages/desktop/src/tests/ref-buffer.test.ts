// ref-buffer (renderer/lib/ref-buffer.ts) — the reference BUFFER LAYER:
// display form (compact tokens in the draft) vs transport form (real path +
// inlined content at send). Pure lib — no DOM or api stub needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendDraftToken,
  buildRefToken,
  expandDraftRefs,
  refKindFromToken,
  refTokenSlug,
  splitReferenceBlocks,
  type RefEntry,
} from "../renderer/lib/ref-buffer";

function entry(overrides: Partial<RefEntry> & { token: string }): RefEntry {
  return { kind: "wiki", label: "标题", path: "D:/repo/.deeporca/deepwiki/x.md", root: "D:/repo", ...overrides };
}

// ── slug / token generation ───────────────────────────────────────────────────

test("slug keeps CJK and hyphenates whitespace/unsafe chars", () => {
  assert.equal(refTokenSlug("架构设计"), "架构设计");
  assert.equal(refTokenSlug("Login Flow demo"), "Login-Flow-demo");
  assert.equal(refTokenSlug("2026/09/02 15:49"), "2026-09-02-15-49");
  assert.equal(refTokenSlug('a"b@c[d]'), "a-b-c-d");
  assert.equal(refTokenSlug("---"), "ref", "degenerate labels fall back");
});

test("buildRefToken suffixes on collision", () => {
  const taken = new Set(["@wiki/架构设计"]);
  assert.equal(buildRefToken("wiki", "架构设计", taken), "@wiki/架构设计-2");
  const open = new Set<string>();
  assert.equal(buildRefToken("wiki", "架构设计", open), "@wiki/架构设计");
});

test("refKindFromToken maps prefixes and rejects strangers", () => {
  assert.equal(refKindFromToken("@prototype/demo"), "prototype");
  assert.equal(refKindFromToken("@design/demo"), "design");
  assert.equal(refKindFromToken("@README.md"), null);
});

// ── draft insertion convention ────────────────────────────────────────────────

test("appendDraftToken appends on its own line after a blank line", () => {
  assert.equal(appendDraftToken("", "", "@wiki/a"), "@wiki/a\n");
  assert.equal(appendDraftToken("先看这个", "请结合:", "@wiki/a"), "先看这个\n\n请结合:\n@wiki/a\n");
});

// ── expansion: display form → transport form ─────────────────────────────────

test("expansion replaces tokens with real paths and inlines content", async () => {
  const registry = new Map([
    [
      "@wiki/架构设计",
      entry({ token: "@wiki/架构设计", label: "架构设计", path: "D:/repo/.deeporca/deepwiki/arch.md" }),
    ],
  ]);
  const res = await expandDraftRefs("请结合 @wiki/架构设计 回答", registry, {
    resolveContent: async () => "# 架构\n正文内容",
  });
  assert.match(res.text, /请结合 @D:\/repo\/\.deeporca\/deepwiki\/arch\.md 回答/);
  assert.match(res.text, /<reference kind="wiki" path="D:\/repo\/\.deeporca\/deepwiki\/arch\.md" title="架构设计">/);
  assert.match(res.text, /# 架构\n正文内容/);
  assert.equal(res.attached, 1);
  assert.equal(res.pathOnly, 0);
  assert.equal(res.unresolved.length, 0);
});

test("paths with whitespace travel in the quoted form", async () => {
  const registry = new Map([
    ["@review/r1", entry({ token: "@review/r1", kind: "review", path: "D:/My Repo/.deeporca/reviews/r.json" })],
  ]);
  const res = await expandDraftRefs("看 @review/r1", registry, { resolveContent: async () => null });
  assert.ok(res.text.includes('@"D:/My Repo/.deeporca/reviews/r.json"'));
  assert.equal(res.pathOnly, 1, "null content degrades to path-only");
});

test("unregistered tokens degrade to plain text (no chip, no dangling)", async () => {
  const res = await expandDraftRefs("看 @wiki/未知 与正文", new Map(), { resolveContent: async () => "x" });
  assert.equal(res.text, "看 @wiki/未知 与正文");
  assert.deepEqual(res.unresolved, [], "registry resolver downgrades unknown tokens before segmentation");
});

test("per-ref content is truncated at the cap with an honest note", async () => {
  const registry = new Map([["@wiki/big", entry({ token: "@wiki/big" })]]);
  const res = await expandDraftRefs("@wiki/big", registry, {
    resolveContent: async () => "x".repeat(100),
    maxPerRefChars: 10,
  });
  assert.match(res.text, /x{10}\n…\(content truncated\)/);
  assert.equal(res.attached, 1);
});

test("total budget is respected across refs", async () => {
  const registry = new Map([
    ["@wiki/a", entry({ token: "@wiki/a", path: "D:/r/a.md" })],
    ["@wiki/b", entry({ token: "@wiki/b", path: "D:/r/b.md" })],
  ]);
  const res = await expandDraftRefs("@wiki/a 和 @wiki/b", registry, {
    resolveContent: async () => "1234567890",
    maxPerRefChars: 10,
    maxTotalChars: 14,
    minTotalRemainingChars: 5,
  });
  assert.equal(res.attached, 1, "second ref exceeds the total budget → path-only");
  assert.equal(res.pathOnly, 1);
});

test("fetch failure/timeout degrades to path-only instead of blocking", async () => {
  const registry = new Map([["@wiki/a", entry({ token: "@wiki/a" })]]);
  const res = await expandDraftRefs("@wiki/a", registry, {
    resolveContent: async () => {
      throw new Error("IPC gone");
    },
    perRefTimeoutMs: 200,
  });
  assert.equal(res.pathOnly, 1);
  assert.equal(res.attached, 0);
  assert.ok(res.text.includes("@D:/repo/.deeporca/deepwiki/x.md"), "real path still travels");
});

// ── session replay: transport-form <reference> blocks fold back to chips ─────

test("splitReferenceBlocks extracts block metadata and strips content", () => {
  const transport = [
    "请结合 @D:/r/.deeporca/reviews/r.json 回答",
    "",
    '<reference kind="review" path="D:/r/.deeporca/reviews/r.json" title="2026/09/02 15:49">',
    '{"findings": []}',
    "</reference>",
  ].join("\n");
  const { text, blocks } = splitReferenceBlocks(transport);
  assert.deepEqual(blocks, [{ kind: "review", path: "D:/r/.deeporca/reviews/r.json", title: "2026/09/02 15:49" }]);
  assert.equal(text, "请结合 @D:/r/.deeporca/reviews/r.json 回答");
});

test("splitReferenceBlocks leaves plain drafts untouched", () => {
  const { text, blocks } = splitReferenceBlocks("普通提问 @wiki/架构设计");
  assert.equal(text, "普通提问 @wiki/架构设计");
  assert.equal(blocks.length, 0);
});
