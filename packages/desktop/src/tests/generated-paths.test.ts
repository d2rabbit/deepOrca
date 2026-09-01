/**
 * Canonical generated-content paths (renderer mirror of core's
 * generated-dirs.ts) — the @-mention quote bridges (wiki page / review
 * report → chat) build absolute mention paths here. Pins:
 *   - POSIX separators on every OS (the mention is model-facing text — a
 *     backslash on Windows breaks the path contract),
 *   - the wiki store segment stays `.deeporca/deepwiki` (centralization),
 *   - a review quote points at the STRUCTURED `.json` (model-readable),
 *     never the self-contained `.html` reading page.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEWS_STORE_POSIX, WIKI_STORE_POSIX, reviewStorePath, wikiStorePath } from "../renderer/lib/generated-paths";

test("generated paths: POSIX separators and canonical store segments", () => {
  assert.equal(WIKI_STORE_POSIX, ".deeporca/deepwiki");
  assert.equal(REVIEWS_STORE_POSIX, ".deeporca/reviews");
  const wiki = wikiStorePath("/repo/root", "architecture/overview.md");
  assert.equal(wiki, "/repo/root/.deeporca/deepwiki/architecture/overview.md");
  assert.ok(!wiki.includes("\\"), "wiki mention path must be POSIX on every OS");
});

test("generated paths: review quote targets the structured JSON, not the HTML page", () => {
  const id = "review-2026-09-01T10-11-12-123";
  const mention = reviewStorePath("/repo/root", id);
  assert.equal(mention, `/repo/root/.deeporca/reviews/${id}.json`);
  assert.ok(!mention.includes("\\"), "review mention path must be POSIX on every OS");
  assert.ok(!mention.endsWith(".html"), "the .html sibling is a reading page — the model needs the JSON");
});
