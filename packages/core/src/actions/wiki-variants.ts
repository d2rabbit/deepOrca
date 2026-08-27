/**
 * Wiki variant-file predicate — the one survivor of the removed bilingual
 * translation stage (wiki.translate, dropped 2026-08-27: the 原文/译文 toggle
 * and its build stage went away). Workspaces that ran a translated build still
 * carry `*.zh.md` / `*.en.md` siblings under openwiki/; every listing surface
 * (page list, page counts) keeps filtering them so the legacy artifacts stay
 * hidden instead of surfacing as duplicate pages.
 */

/** True for generated variant files (`*.zh.md` / `*.en.md`) — hidden from listings. */
export function isWikiVariantFile(fileName: string): boolean {
  return /\.(zh|en)\.md$/i.test(fileName);
}
