/**
 * Wiki page-list ordering (user ask 2026-08-30: 每个 wiki 小节的 Index 排第
 * 一). Pure — extracted from the WikiListPages handler so the rule is
 * unit-testable and main/index.ts stays under its line budget.
 *
 * Path slugs sort alphabetically, so a section's index.md lands mid-list
 * (client/: gvgl_query-py < index.md; gvgllc-core/: id-stabilizer < index <
 * indexing). Stable per-directory partition: basename "index.md"
 * (case-insensitive — titles localize, file names don't) leads its section,
 * everything else keeps the path order. This is the ONE ordering point: the
 * sidebar tree, the reading order, and the prev/next pager all derive from
 * the list this returns.
 */

import type { WikiPageEntry } from "../shared/ipc.js";

export function orderWikiPagesIndexFirst(entries: WikiPageEntry[]): WikiPageEntry[] {
  const sectionOf = (p: string): string => {
    const i = p.lastIndexOf("/");
    return i < 0 ? "" : p.slice(0, i);
  };
  const bySection = new Map<string, WikiPageEntry[]>();
  for (const e of entries) {
    const key = sectionOf(e.path);
    const list = bySection.get(key);
    if (list) list.push(e);
    else bySection.set(key, [e]);
  }
  const ordered: WikiPageEntry[] = [];
  for (const list of bySection.values()) {
    const idx = list.filter((e) => e.path.split("/").pop()?.toLowerCase() === "index.md");
    if (idx.length > 0 && list[0] !== idx[0]) {
      ordered.push(idx[0], ...list.filter((e) => e !== idx[0]));
    } else {
      ordered.push(...list);
    }
  }
  return ordered;
}
