/**
 * Canonical generated-content paths, renderer-side mirror of core's
 * `common/generated-dirs.ts` (the browser bundle cannot import core).
 * MUST stay in sync — generated-content centralization (user rule
 * 2026-08-31). The main process adopts the legacy top-level locations at
 * boot/workspace-switch (`ensureGeneratedLayout`), so reads can target the
 * canonical store unconditionally.
 *
 * Review round 2026-09-01: the wiki panel still read the PRE-centralization
 * `<root>/deepwiki/…` — listing (root-pinned IPC) showed pages, clicking one
 * failed with 读取页面失败, because the file only exists under
 * `<root>/.deeporca/deepwiki/…` now.
 */

export const WIKI_STORE_POSIX = ".deeporca/deepwiki";

/** Absolute editor/mention path to one wiki page of `root`. */
export function wikiStorePath(root: string, pageRelPath: string): string {
  return `${root}/${WIKI_STORE_POSIX}/${pageRelPath}`;
}

/** Canonical review-report store (renderer mirror of core's review-store). */
export const REVIEWS_STORE_POSIX = ".deeporca/reviews";

/**
 * Absolute mention path to one report's STRUCTURED JSON (`<id>.json` — the
 * `.html` sibling is a self-contained reading page; the JSON is what an
 * @-mention should feed the model).
 */
export function reviewStorePath(root: string, reportId: string): string {
  return `${root}/${REVIEWS_STORE_POSIX}/${reportId}.json`;
}

/** Canonical design-suite store (renderer mirror of main's tools/design-store). */
export const DESIGNS_STORE_POSIX = ".deeporca/designs";

/**
 * Absolute path to one design-suite VERSION snapshot (`versions/<id>.json` —
 * the version JSON embeds the content incl. quality/verification datasets, so
 * it is what a design/prototype @-reference feeds the model). Layout per
 * tools/design-store.ts §Layout.
 */
export function designSuiteVersionPath(root: string, suiteId: string, versionId: string): string {
  return `${root}/${DESIGNS_STORE_POSIX}/${suiteId}/versions/${versionId}.json`;
}
