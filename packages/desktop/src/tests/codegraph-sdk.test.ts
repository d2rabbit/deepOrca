/**
 * SdkCodegraphController reindex branching — REAL SDK integration (skipped
 * where the platform bundle is unavailable).
 *
 * Regression (real-machine 2026-08-30, GVGL first build): the adapter called
 * CodeGraph.recreate() on EVERY reindex, but the SDK's recreate() refuses a
 * never-initialized project ("CodeGraph not initialized … Run init() first")
 * — a brand-new workspace's first build failed at stage 1/3 and the whole
 * knowledge build reported "FAILED — codegraph: …". init() and recreate()
 * are exact complements (each throws on the other's state), so the adapter
 * must branch on isInitialized.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SdkCodegraphController } from "../main/tools/codegraph-sdk";

test("reindex: fresh root takes init(), initialized root takes recreate() (GVGL regression)", async (t) => {
  let mod: { SdkCodegraphController: typeof SdkCodegraphController };
  try {
    mod = await import("../main/tools/codegraph-sdk");
  } catch (err) {
    t.skip(`CodeGraph SDK unavailable in this environment: ${err}`);
    return;
  }
  const ctrl = new mod.SdkCodegraphController();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-sdk-"));
  try {
    fs.writeFileSync(path.join(root, "app.ts"), "export function main(): number { return 42; }\n");
    // Branch 1 — THE regression: a never-initialized root must reindex via
    // init() instead of throwing "CodeGraph not initialized … Run init()
    // first." (the exact error the GVGL first build died on).
    await ctrl.reindex(root);
    assert.equal(ctrl.hasProject(root), true, "fresh-root reindex produces a usable index");

    // Branch 2 — an initialized root (incl. this now-indexed one) rebuilds
    // via recreate(): the O(1) discard path that replaced init() after the
    // 2026-08-28 "already initialized" audit.
    await ctrl.reindex(root);
    assert.equal(ctrl.hasProject(root), true, "initialized-root reindex still rebuilds");

    // sync() opens the (now-initialized) project without throwing.
    await ctrl.sync(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
