/**
 * Tests for readWikiCompletionMarker — the authoritative "wiki run finished"
 * signal. openwiki writes openwiki/.last-update.json (status "complete") as
 * its final act; the marker must be trusted even when the CLI process hangs
 * on exit (pipe-inherited MCP connector children delaying Node's `close` —
 * the real-machine "wiki finished but the status never changed" report).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readWikiCompletionMarker } from "../main/tools/wiki-marker";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-wiki-marker-"));
}

function writeMarker(root: string, body: string, mtimeMs?: number): void {
  fs.mkdirSync(path.join(root, "openwiki"), { recursive: true });
  const p = path.join(root, "openwiki", ".last-update.json");
  fs.writeFileSync(p, body, "utf-8");
  if (mtimeMs !== undefined) fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
}

test("no openwiki dir / no marker → null", () => {
  const root = tmpRoot();
  assert.equal(readWikiCompletionMarker(root, 0), null);
});

test("stale marker from a previous run (mtime before sinceMs) → null", () => {
  const root = tmpRoot();
  const old = Date.now() - 3600_000;
  writeMarker(root, JSON.stringify({ status: "complete", model: "m" }), old);
  assert.equal(readWikiCompletionMarker(root, Date.now() - 1000), null);
});

test("fresh complete marker parses status + model", () => {
  const root = tmpRoot();
  writeMarker(root, JSON.stringify({ status: "complete", model: "deepseek-v4-flash", command: "update" }));
  const marker = readWikiCompletionMarker(root, Date.now() - 60_000);
  assert.ok(marker, "fresh marker should parse");
  assert.equal(marker.status, "complete");
  assert.equal(marker.model, "deepseek-v4-flash");
});

test("non-complete status is reported as-is (caller decides)", () => {
  const root = tmpRoot();
  writeMarker(root, JSON.stringify({ status: "running" }));
  const marker = readWikiCompletionMarker(root, Date.now() - 60_000);
  assert.ok(marker);
  assert.equal(marker.status, "running");
});

test("partially-written or invalid marker → null (next poll retries)", () => {
  const root = tmpRoot();
  writeMarker(root, '{"status": "comp'); // mid-write
  assert.equal(readWikiCompletionMarker(root, Date.now() - 60_000), null);

  const root2 = tmpRoot();
  writeMarker(root2, JSON.stringify({ model: "m" })); // no status field
  assert.equal(readWikiCompletionMarker(root2, Date.now() - 60_000), null);
});
