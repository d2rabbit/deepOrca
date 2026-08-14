import { test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pullProfilesToLocal } from "../tdai/core/profile/profile-sync";

/**
 * Security regression tests (audit 2026-08-12 §5.1): remote profile filenames
 * are untrusted — traversal, absolute paths, separators, and duplicates must
 * be rejected instead of written into (and later renamed into the live)
 * scene_blocks.
 */

function tempDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "profile-sync-security-"));
}

function record(
  id: string,
  filename: string,
  content = "# ok\n"
): {
  id: string;
  type: "l2";
  version: number;
  filename: string;
  content: string;
  contentMd5: string;
} {
  return {
    id,
    type: "l2",
    version: 1,
    filename,
    content,
    contentMd5: crypto.createHash("md5").update(content).digest("hex"),
  };
}

test("traversal / absolute / separator filenames are rejected, safe ones land inside scene_blocks", async () => {
  const dataDir = tempDataDir();
  const outsideSentinel = path.join(dataDir, "outside.txt");
  const records = [
    record("safe", "2026-08-15-hello.md"),
    record("traversal", "../../outside.txt"),
    record("absolute", path.join(dataDir, "evil-absolute.md")),
    record("separator", "sub/dir/file.md"),
    record("backslash", "win\\\\evil.md"),
    record("dotdot-basename", ".."),
    record("dup", "2026-08-15-hello.md"),
  ];
  const store = {
    pullProfiles: async () => records,
  };

  const baseline = await pullProfilesToLocal(
    dataDir,
    store as never,
    {
      debug: () => {},
    } as never
  );

  // The safe record is pulled; every unsafe one is skipped (no baseline gap
  // for the malicious entries themselves — they were never written).
  assert.equal(baseline.size, records.length, "baseline still tracks every record id");

  const blocksDir = path.join(dataDir, "scene_blocks");
  const written = fs.existsSync(blocksDir) ? fs.readdirSync(blocksDir) : [];
  assert.deepEqual(written, ["2026-08-15-hello.md"], `only the safe basename written (got ${written})`);
  assert.equal(fs.existsSync(outsideSentinel), false, "traversal target must not exist");
  assert.equal(fs.existsSync(path.join(dataDir, "evil-absolute.md")), false, "absolute-path target must not exist");

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("an empty filename is rejected without throwing", async () => {
  const dataDir = tempDataDir();
  const store = { pullProfiles: async () => [record("empty", "")] };
  await pullProfilesToLocal(dataDir, store as never, { debug: () => {} } as never);
  const blocksDir = path.join(dataDir, "scene_blocks");
  const written = fs.existsSync(blocksDir) ? fs.readdirSync(blocksDir) : [];
  assert.deepEqual(written, []);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
