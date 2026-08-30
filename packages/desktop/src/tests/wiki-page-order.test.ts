/**
 * orderWikiPagesIndexFirst — the ONE wiki ordering rule (user ask 2026-08-30:
 * 每个 wiki 小节的 Index 排第一). Fixture mirrors the real GVGL deepwiki
 * layout that exposed the bug: `client/index.md` sorted LAST (g < i slugs)
 * and `gvgllc-core/index.md` stuck mid-list between id-stabilizer and
 * indexing.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { orderWikiPagesIndexFirst } from "../main/wiki-page-order";
import type { WikiPageEntry } from "../shared/ipc";

const page = (path: string): WikiPageEntry => ({ path, title: path, mtime: new Date(0).toISOString() });

test("index.md leads its section (client case: g-slugs used to win)", () => {
  // Input is the handler's post-sort list (path localeCompare): client/ slugs
  // come before root files.
  const out = orderWikiPagesIndexFirst([
    page("client/gvgl_query-py.md"),
    page("client/gvgl_query-scoring.md"),
    page("client/index.md"),
    page("index.md"),
    page("quickstart.md"),
  ]);
  assert.deepEqual(
    out.map((e) => e.path),
    [
      "client/index.md", // promoted within its section
      "client/gvgl_query-py.md",
      "client/gvgl_query-scoring.md",
      "index.md", // root section keeps its (already-first) order
      "quickstart.md",
    ]
  );
});

test("gvgllc-core case: index promoted from mid-list, siblings keep path order", () => {
  const out = orderWikiPagesIndexFirst([
    page("gvgllc-core/capture.md"),
    page("gvgllc-core/data-model.md"),
    page("gvgllc-core/geometry.md"),
    page("gvgllc-core/id-stabilizer.md"),
    page("gvgllc-core/index.md"),
    page("gvgllc-core/indexing.md"),
    page("gvgllc-core/pipeline.md"),
  ]);
  assert.equal(out[0].path, "gvgllc-core/index.md", "index leads its section");
  assert.deepEqual(
    out.slice(1).map((e) => e.path),
    [
      "gvgllc-core/capture.md",
      "gvgllc-core/data-model.md",
      "gvgllc-core/geometry.md",
      "gvgllc-core/id-stabilizer.md",
      "gvgllc-core/indexing.md",
      "gvgllc-core/pipeline.md",
    ],
    "the rest keeps the incoming path order"
  );
});

test("case-insensitive match; sections without index are untouched", () => {
  const out = orderWikiPagesIndexFirst([
    page("ops/a.md"),
    page("ops/Index.md"),
    page("ops/b.md"),
    page("solo/only.md"),
  ]);
  assert.equal(out[0].path, "ops/Index.md");
  assert.deepEqual(
    out.slice(1).map((e) => e.path),
    ["ops/a.md", "ops/b.md", "solo/only.md"]
  );
});

test("empty input → empty output", () => {
  assert.deepEqual(orderWikiPagesIndexFirst([]), []);
});
