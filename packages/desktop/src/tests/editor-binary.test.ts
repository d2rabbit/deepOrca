/**
 * Editor binary fallback preview (main editor-handlers.ts) — specs/artifact-
 * landing 链路 A. Pins the fail-closed contract (A2):
 *   - whitelisted extension within the size cap → ok + exact bytes,
 *   - path escape / missing file / non-whitelisted extension / oversize all
 *     return {ok:false, reason} without reading bytes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleEditorReadBinary, handleEditorReadFile } from "../main/editor-handlers";

test("editor-read-binary: whitelisted file returns exact bytes", async () => {
  const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "deeporca-bin-")).replace(/\\/g, "/");
  try {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]); // %PDF-1.7
    await fsSync.writeFileSync(path.join(root, "report.pdf"), bytes);
    const res = await handleEditorReadBinary(root, "report.pdf");
    assert.equal(res.ok, true);
    assert.equal(res.ext, "pdf");
    assert.equal(res.name, "report.pdf");
    assert.equal(res.size, bytes.byteLength);
    assert.deepEqual([...res.bytes!], [...bytes]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("editor-read-binary: nested relative path and case-insensitive extension", async () => {
  const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "deeporca-bin-")).replace(/\\/g, "/");
  try {
    await fsSync.mkdirSync(path.join(root, "docs"));
    await fsSync.writeFileSync(path.join(root, "docs", "table.XLSX"), Buffer.from("PK"));
    const res = await handleEditorReadBinary(root, "docs/table.XLSX");
    assert.equal(res.ok, true);
    assert.equal(res.ext, "xlsx");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("editor-read-binary: escaped path, missing file, unsupported ext fail closed", async () => {
  const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "deeporca-bin-")).replace(/\\/g, "/");
  try {
    const escaped = await handleEditorReadBinary(root, "../outside.pdf");
    assert.equal(escaped.ok, false);
    assert.equal(escaped.reason, "escaped");
    assert.equal(escaped.bytes, undefined);

    const ghost = await handleEditorReadBinary(root, "ghost.pdf");
    assert.equal(ghost.ok, false);
    assert.equal(ghost.reason, "not-file");

    const media = await handleEditorReadBinary(root, "movie.mp4");
    assert.equal(media.ok, false);
    assert.equal(media.reason, "extension-unsupported");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("editor-read-binary: oversize file → too-large without reading bytes", async () => {
  const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "deeporca-bin-")).replace(/\\/g, "/");
  try {
    const big = path.join(root, "huge.zip");
    // Sparse file — create then truncate to 64MB+1 without writing real bytes.
    fsSync.writeFileSync(big, "");
    fsSync.truncateSync(big, 64 * 1024 * 1024 + 1);
    const res = await handleEditorReadBinary(root, "huge.zip");
    assert.equal(res.ok, false);
    assert.equal(res.reason, "too-large");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("editor-read-file: binary verdict precedes the 2MB text cap — large binaries reach the preview path (A1, user ask 2026-09-08)", async () => {
  const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "deeporca-bin-")).replace(/\\/g, "/");
  try {
    const big = path.join(root, "report.pdf");
    fsSync.writeFileSync(big, "%PDF-1.7");
    // Sparse truncate past the 2MB text-reader cap, inside the 64MB preview cap.
    fsSync.truncateSync(big, 3 * 1024 * 1024);
    const res = await handleEditorReadFile(root, "report.pdf");
    assert.equal(res.ok, true);
    assert.equal(res.binary, true);
    assert.equal(res.content, undefined);
    assert.equal(res.error, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
