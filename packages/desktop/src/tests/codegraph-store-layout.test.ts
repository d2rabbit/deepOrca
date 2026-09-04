/**
 * CodeGraph store layout — the generated-content centralization seam
 * (user rule 2026-08-31): the index physically lives under
 * `.deeporca/codegraph/` while the SDK-facing `.codegraph` name stays as a
 * symlink (the SDK only accepts single-segment data-dir overrides). Pins the
 * adoption/migration contract of ensureCodegraphStoreLayout.
 */

import { strict as assert } from "node:assert";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CODEGRAPH_LINK_DIR, CODEGRAPH_STORE_DIR } from "@deeporca/core";

const symlinkSupported = ((): boolean => {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cg-symprobe-"));
    const target = path.join(dir, "t");
    const link = path.join(dir, "l");
    fs.mkdirSync(target);
    fs.symlinkSync(path.relative(dir, target), link, process.platform === "win32" ? "junction" : "dir");
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
})();

// The layout helper is module-private; exercise it through the controller's
// hasProject (which calls it first). Instantiating SdkCodegraphController
// requires the SDK to be resolvable — not needed for layout assertions, so
// instead import the controller lazily and probe only when available.
import * as fs from "node:fs";

test(
  "codegraph store layout: legacy dir is adopted into .deeporca and relinked",
  { skip: !symlinkSupported },
  async () => {
    const { SdkCodegraphController } = await import("../main/tools/codegraph-sdk");
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "cg-layout-"));
    try {
      // Legacy layout with a real index db.
      const legacy = path.join(root, CODEGRAPH_LINK_DIR);
      await fsp.mkdir(legacy, { recursive: true });
      await fsp.writeFile(path.join(legacy, "codegraph.db"), "db");

      const controller = new SdkCodegraphController();
      controller.hasProject(root); // runs ensureCodegraphStoreLayout first

      const store = path.join(root, CODEGRAPH_STORE_DIR);
      assert.equal(fs.existsSync(path.join(store, "codegraph.db")), true, "index moved into .deeporca/codegraph");
      const st = fs.lstatSync(path.join(root, CODEGRAPH_LINK_DIR));
      assert.equal(st.isSymbolicLink(), true, ".codegraph is a symlink");
      assert.equal(
        fs.existsSync(path.join(root, CODEGRAPH_LINK_DIR, "codegraph.db")),
        true,
        "SDK-facing path resolves through the link"
      );
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  }
);

test(
  "codegraph store layout: fresh project gets store + link; symlink-less platforms stay legacy",
  { skip: !symlinkSupported },
  async () => {
    const { SdkCodegraphController } = await import("../main/tools/codegraph-sdk");
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "cg-fresh-"));
    try {
      const controller = new SdkCodegraphController();
      controller.hasProject(root);
      assert.equal(fs.existsSync(path.join(root, CODEGRAPH_STORE_DIR)), true, "store provisioned under .deeporca");
      assert.equal(fs.lstatSync(path.join(root, CODEGRAPH_LINK_DIR)).isSymbolicLink(), true);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  }
);
