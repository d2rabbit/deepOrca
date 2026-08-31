/**
 * Wiki staging lifecycle (wiki-staging.ts).
 *
 * deepwiki/ is the canonical, always-valid store; openwiki/ is the CLI's
 * hardcoded run-local stage. These tests pin the transactional contract:
 * a validated stage promotes, a discarded stage never touches the store,
 * and a legacy/orphaned stage is adopted only when it holds real content.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  WIKI_STAGE_DIR,
  WIKI_STORE_DIR,
  WIKI_LEGACY_STORE_DIR,
  migrateLegacyWikiStore,
  countSubstantialPagesIn,
  hasWikiStore,
  discardStage,
  copyStoreToStage,
  promoteStage,
  recoverOrphanedStage,
} from "../main/tools/wiki-staging";

function withRoot(fn: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-staging-"));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const stage = (root: string): string => path.join(root, WIKI_STAGE_DIR);
const store = (root: string): string => path.join(root, WIKI_STORE_DIR);

/** A substantial page (over the 512B line) under a wiki dir. */
function writePage(dir: string, rel: string, size = 1024): void {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `# ${rel}\n\n${"x".repeat(size)}`, "utf8");
}

test("layout constants pin the contract", () => {
  assert.equal(WIKI_STAGE_DIR, "openwiki", "the stage must keep the CLI's hardcoded dir name");
  // Generated-content centralization (user rule 2026-08-31): the canonical
  // store lives under .deeporca/.
  assert.equal(WIKI_STORE_DIR, ".deeporca/deepwiki");
  assert.equal(WIKI_LEGACY_STORE_DIR, "deepwiki");
});

test("copyStoreToStage + promoteStage round-trip content and the marker", () => {
  withRoot((root) => {
    writePage(store(root), "architecture/overview.md");
    fs.writeFileSync(
      path.join(store(root), ".last-update.json"),
      JSON.stringify({ gitHead: "de4e8f887850440df71f47fb999cb1162ad98e80", status: "complete" }),
      "utf8"
    );
    assert.equal(hasWikiStore(root), true);

    copyStoreToStage(root);
    assert.equal(countSubstantialPagesIn(stage(root)), 1, "stage seeded from store");
    // Mutate the stage like a CLI update would.
    writePage(stage(root), "billing/engine.md");
    promoteStage(root);

    assert.equal(fs.existsSync(stage(root)), false, "stage consumed by promote");
    assert.equal(countSubstantialPagesIn(store(root)), 2, "store holds old + new pages");
    const marker = JSON.parse(fs.readFileSync(path.join(store(root), ".last-update.json"), "utf8"));
    assert.equal(marker.gitHead, "de4e8f887850440df71f47fb999cb1162ad98e80", "marker travels with the dir");
  });
});

test("discardStage throws away a poisoned run; the store is untouched", () => {
  withRoot((root) => {
    writePage(store(root), "architecture/overview.md");
    copyStoreToStage(root);
    // A bad run hollows the stage.
    fs.rmSync(path.join(stage(root), "architecture"), { recursive: true, force: true });
    fs.writeFileSync(path.join(stage(root), "index.md"), "---\ntitle: Index\n---\n# Index\n");

    discardStage(root);
    assert.equal(fs.existsSync(stage(root)), false);
    assert.equal(countSubstantialPagesIn(store(root)), 1, "last-known-good wiki intact");
  });
});

test("recoverOrphanedStage adopts a substantial legacy stage, never a hollow one", () => {
  withRoot((root) => {
    // Hollow: not adopted.
    fs.mkdirSync(stage(root), { recursive: true });
    fs.writeFileSync(path.join(stage(root), "index.md"), "---\ntitle: Index\n---\n");
    assert.equal(recoverOrphanedStage(root), false);
    assert.equal(fs.existsSync(stage(root)), true, "hollow stage left for discardStage");

    // Substantial: adopted as the store.
    writePage(stage(root), "quickstart.md");
    assert.equal(recoverOrphanedStage(root), true);
    assert.equal(fs.existsSync(stage(root)), false);
    assert.equal(hasWikiStore(root), true);

    // Store already present: stage is never adopted over it.
    writePage(stage(root), "orphan.md");
    assert.equal(recoverOrphanedStage(root), false);
    discardStage(root);
  });
});

test("countSubstantialPagesIn excludes index.md and thin files", () => {
  withRoot((root) => {
    fs.mkdirSync(stage(root), { recursive: true });
    fs.writeFileSync(path.join(stage(root), "index.md"), "x".repeat(2000), "utf8");
    fs.writeFileSync(path.join(stage(root), "stub.md"), "x".repeat(100), "utf8");
    writePage(stage(root), "real.md", 600);
    assert.equal(countSubstantialPagesIn(stage(root)), 1);
  });
});

test("migrateLegacyWikiStore adopts a pre-centralization top-level deepwiki/", () => {
  withRoot((root) => {
    // Generated-content centralization (user rule 2026-08-31): the old
    // top-level canonical store moves under .deeporca/ on the first touch.
    const legacy = path.join(root, WIKI_LEGACY_STORE_DIR);
    fs.mkdirSync(legacy, { recursive: true });
    writePage(legacy, "architecture.md");
    assert.equal(hasWikiStore(root), true, "legacy content is found via adoption");
    assert.equal(fs.existsSync(legacy), false, "legacy dir is gone (renamed)");
    assert.equal(countSubstantialPagesIn(store(root)), 1);

    // A live canonical store is never replaced by a legacy leftover.
    const staleLegacy = path.join(root, WIKI_LEGACY_STORE_DIR);
    fs.mkdirSync(staleLegacy, { recursive: true });
    writePage(staleLegacy, "stale.md");
    assert.equal(migrateLegacyWikiStore(root), false);
    assert.equal(fs.existsSync(staleLegacy), true, "legacy leftover untouched");
  });
});
