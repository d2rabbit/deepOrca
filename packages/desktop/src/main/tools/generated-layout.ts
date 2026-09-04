/**
 * Generated-content layout sweep — the ONE entry point that guarantees a
 * project root is fully on the centralized layout (user rule 2026-08-31:
 * everything the toolchain generates lives under `.deeporca/`, and both
 * GENERATION and READS hit the new paths).
 *
 * Runs the three adoptions (idempotent, best-effort, cheap existsSync checks):
 *   - CRG:      `.code-review-graph/` → `.deeporca/crg/`
 *   - CodeGraph: `.codegraph/` real dir → `.deeporca/codegraph/` + symlink
 *   - Wiki:      `deepwiki/` → `.deeporca/deepwiki/`
 *
 * Call sites: app boot, workspace switch (SetProjectRoot), and the knowledge
 * status handler — so by the time anything generates or reads, the legacy
 * locations are already empty and every path in play is the canonical one.
 */

import { migrateLegacyCrgDir } from "@deeporca/core";
import { ensureCodegraphStoreLayout } from "./codegraph-sdk.js";
import { migrateLegacyWikiStore } from "./wiki-staging.js";

export function ensureGeneratedLayout(root: string | undefined | null): void {
  if (!root) return;
  try {
    migrateLegacyCrgDir(root);
  } catch {
    // best-effort — both layouts keep working when an adopt fails
  }
  try {
    ensureCodegraphStoreLayout(root);
  } catch {
    // best-effort — see ensureCodegraphStoreLayout's degraded mode
  }
  try {
    migrateLegacyWikiStore(root);
  } catch {
    // best-effort — the next wiki touch re-runs the adoption
  }
}
