/**
 * Background-task path grant (backgroundTaskPathGrant).
 *
 * The sessionless arch task runs on the ACTIVE session's executor while
 * targeting ANY registered workspace root — without an explicit grant the
 * write/read gates fall back to the active projectRoot and deny everything
 * under the target (regression class found in audit round 2, 2026-08-29).
 * The grant is least-privilege: whole target readable, only
 * `.deeporca/prototypes` writable.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { backgroundTaskPathGrant, ensureBackgroundTaskArtifactDir } from "../session-manager-tasks";
import { gateWrite, gateRead } from "../common/path-boundary";
import { normalizeFilePath } from "../common/state";

function withRoot(fn: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bg-grant-"));
  try {
    // Production parity: the task ensures its writable boundary exists BEFORE
    // the grant is used (creation-time candidates then canonicalize through
    // existing parents — see the canonicalization note in the helper).
    ensureBackgroundTaskArtifactDir(root);
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("writes allowed only under the target's prototypes dir", () => {
  withRoot((root) => {
    const grant = backgroundTaskPathGrant(root);
    assert.equal(gateWrite(grant, path.join(root, ".deeporca", "prototypes", "arch-x.architecture.json")).ok, true);
    assert.equal(
      gateWrite(grant, path.join(root, "src", "main.ts")).ok,
      false,
      "source tree is read-only for the task"
    );
    assert.equal(gateWrite(grant, path.join(os.tmpdir(), "escape.txt")).ok, false, "outside the target is denied");
    assert.equal(
      gateWrite(grant, path.join(root, ".deeporca", "prototypes", "sub", "..", "..", "..", "evil.txt")).ok,
      false,
      "traversal out of prototypes is denied"
    );
  });
});

test("reads allowed across the whole target repo, denied outside", () => {
  withRoot((root) => {
    const grant = backgroundTaskPathGrant(root);
    const deepFile = path.join(root, "src", "deep", "file.ts");
    fs.mkdirSync(path.dirname(deepFile), { recursive: true });
    fs.writeFileSync(deepFile, "x");
    assert.equal(gateRead(grant, deepFile).ok, true);
    assert.equal(gateRead(grant, path.join(os.tmpdir(), "elsewhere.md")).ok, false);
  });
});

test("unresolvable root falls back to the lexical path (fail-closed against reality)", () => {
  const root = "/nonexistent/should/not/exist";
  const grant = backgroundTaskPathGrant(root);
  // The fallback preserves the input's PLATFORM-NORMALIZED spelling, not the
  // raw string: on Windows a POSIX-absolute input canonicalizes to the
  // driveless form ("\nonexistent\…"), so the expectation must be computed
  // via the same normalization primitive — a literal POSIX string failed
  // every Windows run (real machine 2026-08-31).
  assert.deepEqual(grant.readRoots, [normalizeFilePath(root)]);
  assert.equal(gateWrite(grant, root + "/src/x.ts").ok, false, "writes still scoped to prototypes");
});
