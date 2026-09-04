/**
 * WikiCliController.update() no-store contract (review round 4, critical):
 * update() must FAIL FAST when no canonical deepwiki/ store exists — the old
 * init fallback turned the auto-sync hook (update() fire-and-forget after
 * every file-mutating agent turn) into a silent full LLM generation on any
 * wiki-less project. The build flow routes init itself (index-build).
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WikiCliController } from "../main/tools/wiki-cli";

test("update() over a store-less root throws instead of initializing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-update-guard-"));
  // A vendor entry file so isAvailable() passes — update must throw BEFORE
  // any spawn happens (no CLI run, no LLM burn).
  const vendorEntry = path.join(root, "fake-cli.js");
  fs.writeFileSync(vendorEntry, "// fake", "utf8");
  const controller = new WikiCliController({
    vendorEntry,
    nodeRunner: process.execPath,
    getLlmCreds: () => ({}),
  });
  try {
    await controller.update(root);
    assert.fail("update() must throw without a canonical store");
  } catch (err) {
    assert.match(err instanceof Error ? err.message : String(err), /no canonical deepwiki\/ store/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
