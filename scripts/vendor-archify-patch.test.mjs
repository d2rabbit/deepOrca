/**
 * Regression anchor for the archify carry-patches applied by
 * scripts/vendor-archify.js (macOS pipe diagnostics truncation, real-machine
 * 2026-09-18: libuv keeps stdio pipes non-blocking, so one fs.writeSync can
 * partially write / EAGAIN and a trailing process.exit() dropped the tail —
 * 18KB of renderer diagnostics arrived as 8KB of unparseable JSON that the
 * CLI's fail-closed wrapper reported as `internal/unclassified`).
 *
 * The vendored tree is gitignored, so nothing else would catch a silent
 * regression: a hand-copied tree, a ref bump that re-anchors the patches, or
 * an upstream import without running the vendor script would all ship the
 * truncation again. These checks pin the patched markers in the live tree.
 * Missing tree entirely is a SKIP (fresh checkout before first vendor run),
 * not a failure.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const vendorRoot = join(__dirname, "..", "packages", "desktop", "vendor", "archify");

function readVendored(relativePath) {
  const file = join(vendorRoot, relativePath);
  return existsSync(file) ? readFileSync(file, "utf-8") : null;
}

function hasTree() {
  return existsSync(join(vendorRoot, "bin", "archify.mjs"));
}

test(
  "vendored archify diagnostics boundary drains stderr fully",
  { skip: !hasTree() && "archify not vendored yet" },
  () => {
    const source = readVendored("renderers/shared/diagnostics.mjs");
    assert.ok(source.includes("export function writeAllSync"), "writeAllSync helper missing — carry-patch lost?");
    assert.ok(
      !source.includes("fs.writeSync(process.stderr.fd, payload)"),
      "single-shot fs.writeSync is back — the EAGAIN/partial-write truncation bug has regressed"
    );
    assert.ok(
      source.includes("writeAllSync(process.stderr.fd, Buffer.from(payload, 'utf8'))"),
      "diagnostic boundary does not call writeAllSync"
    );
  }
);

test(
  "vendored archify layout-json report is written synchronously",
  { skip: !hasTree() && "archify not vendored yet" },
  () => {
    const source = readVendored("renderers/architecture/render-architecture.mjs");
    assert.ok(
      !source.includes("console.log(JSON.stringify(buildLayoutReport(), null, 2));"),
      "async console.log before exit(0) is back — --layout-json can truncate on macOS pipes"
    );
    assert.ok(source.includes("writeAllSync(process.stdout.fd,"), "layout-json mode does not use writeAllSync");
  }
);

test(
  "vendored archify CLI fail() writes stderr before exiting",
  { skip: !hasTree() && "archify not vendored yet" },
  () => {
    const source = readVendored("bin/archify.mjs");
    assert.ok(
      source.includes("writeAllSync(process.stderr.fd, Buffer.from(`${message}\\n`, 'utf8'))"),
      "fail() no longer drains stderr synchronously"
    );
  }
);
