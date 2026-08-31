/**
 * Generated-content layout for a project — the ONE place that names where the
 * toolchain parks its output inside a target repository.
 *
 * User rule 2026-08-31: EVERYTHING DeepOrca generates in a project — code
 * graph, CRG risk graph + visualization, wiki, arch maps, prototypes, review
 * reports — lives under `<project>/.deeporca/`, never in top-level/
 * tool-default directories of the repo. Rationale: one directory to inspect
 * and clean, and the review pipeline's dot-segment exclusion (any path
 * segment starting with `.` is out of review scope) covers the whole tree by
 * construction, so the review can never end up "reviewing its own output".
 *
 * Migration policy: legacy layouts (`.codegraph/`, `.code-review-graph/`,
 * `deepwiki/`) are adopted in place on the next touching operation — moved
 * under `.deeporca/` — not silently abandoned (users keep their indexes).
 */

/** The project-scoped DeepOrca config + generated-content root. */
export const DEEPORCA_PROJECT_DIR = ".deeporca";

// ── CRG risk graph ───────────────────────────────────────────────────────────

/** Canonical CRG data dir (graph.db, graph.html) — passed to the wheel via
 *  `--data-dir` on every spawn (2.3.7+ wheels both accept it). */
export const CRG_DATA_DIR = `${DEEPORCA_PROJECT_DIR}/crg`;
/** Pre-centralization location; adopted (renamed) on the next build/update. */
export const CRG_LEGACY_DIR = ".code-review-graph";

// ── CodeGraph symbol index ──────────────────────────────────────────────────

/** Physical store for the CodeGraph index. The npm SDK resolves its data dir
 *  as `<root>/<CODEGRAPH_DIR>` with a SINGLE-SEGMENT override only (env
 *  `CODEGRAPH_DIR`), so it cannot be pointed into a subdirectory — the host
 *  keeps `<root>/.codegraph` as a symlink to this store instead (see desktop's
 *  codegraph-sdk.ts). Every path built as `<root>/.codegraph/...` resolves
 *  through the link, so readers need no changes. */
export const CODEGRAPH_STORE_DIR = `${DEEPORCA_PROJECT_DIR}/codegraph`;
/** The SDK-facing directory name (symlink → CODEGRAPH_STORE_DIR; a real dir
 *  only when symlink creation is unavailable, e.g. unprivileged Windows). */
export const CODEGRAPH_LINK_DIR = ".codegraph";

// ── OpenWiki ────────────────────────────────────────────────────────────────

/** Canonical wiki store. `openwiki/` stays the vendored CLI's transient stage
 *  (hardcoded there; promoted into this store by desktop's staging). */
export const WIKI_STORE_DIR = `${DEEPORCA_PROJECT_DIR}/deepwiki`;
/** Pre-centralization canonical store; adopted (renamed) on first wiki touch. */
export const WIKI_LEGACY_STORE_DIR = "deepwiki";
