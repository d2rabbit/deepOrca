/**
 * Persistence race regression (a2ui-mcp): the dispose-time FULL flush must
 * never delete prototypes files this process never managed. Locks the boot
 * race where SessionManager.dispose() → persistSurfaces(root) ran while the
 * async restoreSurfaces had not yet populated the surfaces Map — the sweep
 * deleted every .json (including the committed arch-root.json) and the
 * empty Map rewrote nothing.
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildA2uiServer, persistSurfaces, restoreSurfaces, surfaceVersionStamp } from "../main/tools/a2ui/a2ui-mcp";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-persist-race-"));
});

test("full flush with an unrestored (empty) Map leaves unknown files intact", () => {
  // A file persisted by an EARLIER process — this process's Map is empty
  // (restore not run / still in flight) and knows nothing about it.
  fs.mkdirSync(path.join(dir, ".deeporca", "prototypes"), { recursive: true });
  const artifact = path.join(dir, ".deeporca", "prototypes", "arch-root.json");
  fs.writeFileSync(artifact, '{"surfaceId":"arch-root"}', "utf8");

  persistSurfaces(dir); // dispose-time full flush — must NOT sweep the unknown file

  assert.ok(fs.existsSync(artifact), "unknown persisted artifact survives an empty-Map flush");
});

test("restore-then-dispose round-trips files (known ids are swept and rewritten)", () => {
  fs.mkdirSync(path.join(dir, ".deeporca", "prototypes"), { recursive: true });
  const artifact = path.join(dir, ".deeporca", "prototypes", "arch-root.json");
  fs.writeFileSync(
    artifact,
    JSON.stringify({
      surfaceId: "arch-root",
      title: "T",
      messages: [],
      dataModel: {},
      components: [],
    }),
    "utf8"
  );

  // Fresh module state per process — simulate by building a server (which
  // clears the Map) then restoring, the exact boot sequence of manager B.
  buildA2uiServer(dir);
  restoreSurfaces(dir);
  persistSurfaces(dir); // dispose-time full flush

  assert.ok(fs.existsSync(artifact), "restored artifact round-trips through dispose");
  const round = JSON.parse(fs.readFileSync(artifact, "utf8")) as { surfaceId: string };
  assert.equal(round.surfaceId, "arch-root");
});

test("arch-prefixed flush keeps its scope: non-arch files untouched, stale arch swept", () => {
  const protos = path.join(dir, ".deeporca", "prototypes");
  fs.mkdirSync(protos, { recursive: true });
  fs.writeFileSync(path.join(protos, "proto-user.json"), "{}", "utf8");
  fs.writeFileSync(path.join(protos, "arch-stale.json"), "{}", "utf8");

  const stampBefore = surfaceVersionStamp();
  void stampBefore;
  persistSurfaces(dir, "arch-", stampBefore);

  assert.ok(fs.existsSync(path.join(protos, "proto-user.json")), "non-arch file survives");
  assert.ok(!fs.existsSync(path.join(protos, "arch-stale.json")), "stale arch file swept by the scoped flush");
});
