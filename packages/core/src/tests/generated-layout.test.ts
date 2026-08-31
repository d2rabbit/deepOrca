/**
 * Generated-content centralization — CRG adoption contract (user rule
 * 2026-08-31: everything under `.deeporca/`, generation AND reads). Pins
 * migrateLegacyCrgDir: the legacy wheel-default location is renamed into the
 * canonical one exactly once, and a live canonical graph is never replaced.
 */

import { strict as assert } from "node:assert";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateLegacyCrgDir, CRG_DIR_NAME, CRG_LEGACY_DIR_NAME } from "../common/crg";

async function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "crg-migrate-"));
  try {
    await fn(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

const exists = async (p: string): Promise<boolean> =>
  fsp.stat(p).then(
    () => true,
    () => false
  );

async function writeGraphDb(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "graph.db"), "sqlite");
}

test("migrateLegacyCrgDir renames the legacy graph into .deeporca/crg", async () => {
  await withRoot(async (root) => {
    await writeGraphDb(path.join(root, CRG_LEGACY_DIR_NAME));
    assert.equal(migrateLegacyCrgDir(root), true);
    assert.equal(await exists(path.join(root, CRG_DIR_NAME, "graph.db")), true);
    assert.equal(await exists(path.join(root, CRG_LEGACY_DIR_NAME)), false);
    // Idempotent: nothing left to adopt.
    assert.equal(migrateLegacyCrgDir(root), false);
  });
});

test("migrateLegacyCrgDir never touches a live canonical graph", async () => {
  await withRoot(async (root) => {
    await writeGraphDb(path.join(root, CRG_DIR_NAME));
    await writeGraphDb(path.join(root, CRG_LEGACY_DIR_NAME));
    assert.equal(migrateLegacyCrgDir(root), false);
    // Both survive — the canonical one is authoritative, the legacy one is
    // cleaned up by the next reindex (which deletes both before rebuilding).
    assert.equal(await exists(path.join(root, CRG_DIR_NAME, "graph.db")), true);
    assert.equal(await exists(path.join(root, CRG_LEGACY_DIR_NAME)), true);
  });
});

test("migrateLegacyCrgDir is a no-op without a legacy graph", async () => {
  await withRoot(async (root) => {
    assert.equal(migrateLegacyCrgDir(root), false);
    assert.equal(await exists(path.join(root, CRG_DIR_NAME)), false);
  });
});
