/**
 * Wiki staging lifecycle — the transactional wrapper around openwiki runs.
 *
 * The vendored openwiki CLI hardcodes its output directory as `openwiki/`
 * (OPEN_WIKI_DIR constant; the agent prompt, the write-confinement "runs may
 * only write under /openwiki" and the backend's virtual /openwiki root all
 * bake the name in — no env or flag can point it elsewhere). DeepOrca's
 * CANONICAL wiki store is `deepwiki/` instead; `openwiki/` exists only as
 * the CLI's stage:
 *
 *   init   : rm stage → CLI --init writes stage → validate → PROMOTE
 *   update : rm stage → copy deepwiki→stage → CLI --update mutates stage →
 *            validate → PROMOTE (bad run: DISCARD stage, deepwiki untouched)
 *
 * This is the answer to the recurring "wiki × LLM 配合" failures
 * (real-machine 2026-08-28..29): hollow exits, /responses dialect drops,
 * moderation-interrupted runs — a bad or half-dead run can never damage the
 * last-known-good wiki, because the CLI never touches deepwiki/ and only a
 * validated stage replaces it. The completion marker lives INSIDE the
 * directory (openwiki/.last-update.json), so the copy carries the git
 * baseline and the promote keeps the new one — no marker surgery needed.
 *
 * No production data predates this layout (user decision 2026-08-29:
 * "当前没有真正的生产数据，所以没有历史包袱") — legacy `openwiki/`
 * directories are recovered as the canonical store on the next build
 * rather than migrated in place.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** The CLI's hardcoded stage directory (vendored constant OPEN_WIKI_DIR). */
export const WIKI_STAGE_DIR = "openwiki";
/** DeepOrca's canonical, always-valid wiki store. */
export const WIKI_STORE_DIR = "deepwiki";

const stageDir = (root: string): string => path.join(root, WIKI_STAGE_DIR);
const storeDir = (root: string): string => path.join(root, WIKI_STORE_DIR);

/** Substantial-page threshold, same 512B line as wiki-cli's guards. */
const SUBSTANTIAL_PAGE_BYTES = 512;

/** Count substantial (>512B, index.md excluded) topic pages under a wiki
 *  directory — the "is this wiki real" check, shared by validation and
 *  orphan recovery. Returns 0 when the directory is absent/unreadable. */
export function countSubstantialPagesIn(dir: string): number {
  let count = 0;
  const stack = [dir];
  try {
    for (let guard = 0; stack.length > 0 && guard < 2000; guard++) {
      const d = stack.pop();
      if (!d) break;
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) stack.push(p);
        else if (ent.isFile() && ent.name.endsWith(".md") && ent.name !== "index.md") {
          try {
            if (fs.statSync(p).size > SUBSTANTIAL_PAGE_BYTES) count++;
          } catch {
            // raced away — skip
          }
        }
      }
    }
  } catch {
    return count;
  }
  return count;
}

/** True when the canonical deepwiki/ store exists and holds real content. */
export function hasWikiStore(root: string): boolean {
  return countSubstantialPagesIn(storeDir(root)) > 0;
}

/** Remove a stale/poisoned stage. Never throws — staging is disposable. */
export function discardStage(root: string): void {
  fs.rmSync(stageDir(root), { recursive: true, force: true });
}

/** Seed the stage from the canonical store before an incremental run. */
export function copyStoreToStage(root: string): void {
  fs.cpSync(storeDir(root), stageDir(root), { recursive: true, preserveTimestamps: true });
}

/** Replace the canonical store with the validated stage. The brief window
 *  between rm and rename is acceptable: the stage still holds the full new
 *  copy, and recoverOrphanedStage() re-promotes it if we crash inside it.
 *  CRASH-WINDOW NOTE (review round 6): a crash mid-`rmSync(store)` can leave
 *  a gutted store HUSK — countSubstantialPagesIn treats it as absent so the
 *  orphan recovery below re-promotes the intact stage instead of honoring
 *  the husk (see hasWikiStore). Callers must NOT discard the stage when
 *  promote itself throws — the stage is then the ONLY copy. */
export function promoteStage(root: string): void {
  // Swap-aside (review round 7): rm-then-rename left a crash window where the
  // store was gone and the rename failed (ENOTEMPTY on a leftover husk /
  // EBUSY on Windows), and NON-ATOMIC readers could see a missing store
  // mid-promote. Rename the old store aside, rename the stage into place
  // (atomic), THEN delete the aside copy.
  const aside = `${storeDir(root)}.trash-${Date.now()}`;
  try {
    fs.renameSync(storeDir(root), aside);
  } catch {
    // no store yet (first promote) — fine
  }
  try {
    fs.renameSync(stageDir(root), storeDir(root));
  } catch (err) {
    // Restore the aside copy — never leave the user storeless because the
    // stage rename failed (the stage still exists for a retry).
    try {
      fs.renameSync(aside, storeDir(root));
    } catch {
      // aside rename failed too — nothing more we can do here
    }
    throw err;
  }
  fs.rmSync(aside, { recursive: true, force: true });
}

/**
 * Adopt a legacy or orphaned stage as the canonical store when NO deepwiki/
 * exists: a pre-staging-era project's only wiki IS its openwiki/ directory,
 * and a stage orphaned by a crash mid-promote holds the newest good copy.
 * Only adopts stages with real content — hollow skeletons stay disposable.
 * Returns true when an adoption happened.
 */
export function recoverOrphanedStage(root: string): boolean {
  // A HOLLOW store (crash mid-promote left a partially-deleted husk) counts
  // as absent — honoring it would make init discard the intact stage (review
  // round 6's crash-window enumeration) or seed updates from the husk.
  if (fs.existsSync(storeDir(root)) && countSubstantialPagesIn(storeDir(root)) > 0) return false;
  if (countSubstantialPagesIn(stageDir(root)) === 0) return false;
  fs.mkdirSync(path.dirname(storeDir(root)), { recursive: true });
  // Clear a husk first (review round 7): a crash mid-promote can leave a
  // non-empty husk dir — rename(2) onto it throws ENOTEMPTY (and ALWAYS
  // throws on Windows), wedging every later init on a raw fs error.
  fs.rmSync(storeDir(root), { recursive: true, force: true });
  fs.renameSync(stageDir(root), storeDir(root));
  return true;
}
