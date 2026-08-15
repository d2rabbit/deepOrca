import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { gateRead, gateWrite, isPathInProject, type PathGrant } from "../common/path-boundary";

// Gate semantics tests for the P0 execution-time path boundary
// (specs/sandbox/design.md §4.1, acceptance table). All filesystem fixtures
// live under os.tmpdir(); both gate candidates and grant roots are
// realpath-normalized by the gate itself, so macOS /var → /private/var is
// never an issue.

const tempDirs: string[] = [];

function createWorkspace(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-path-boundary-")));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeGrant(overrides: Partial<PathGrant> = {}): PathGrant {
  return {
    writeRoots: [],
    readRoots: [],
    allowWriteOutsideRoots: false,
    allowReadOutsideRoots: false,
    ...overrides,
  };
}

test("gateWrite allows paths inside writeRoots and rejects paths outside", () => {
  const root = createWorkspace();
  const grant = makeGrant({ writeRoots: [root] });
  assert.deepEqual(gateWrite(grant, path.join(root, "src", "main.ts")), { ok: true });
  assert.equal(gateWrite(grant, path.join(root, "notes.txt"))!.ok, true);

  const verdict = gateWrite(grant, path.join(os.tmpdir(), "evil-target.txt"));
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.scope, "write-out-cwd");
    assert.ok(verdict.reason.includes("write boundary"));
  }
});

test("gateRead allows paths inside readRoots and rejects paths outside", () => {
  const root = createWorkspace();
  const grant = makeGrant({ readRoots: [root] });
  assert.equal(gateRead(grant, path.join(root, "config.json")).ok, true);

  const verdict = gateRead(grant, path.join(os.tmpdir(), "secret.txt"));
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.scope, "read-out-cwd");
  }
});

test("outside-roots booleans express the per-call dynamic authorization (R1)", () => {
  const root = createWorkspace();
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.txt`);

  const writeGrant = makeGrant({ writeRoots: [root], allowWriteOutsideRoots: true });
  assert.equal(gateWrite(writeGrant, outside).ok, true);

  const readGrant = makeGrant({ readRoots: [root], allowReadOutsideRoots: true });
  assert.equal(gateRead(readGrant, outside).ok, true);

  // Flags are orthogonal: a read flag must not open the write gate.
  const readOnlyFlag = makeGrant({ writeRoots: [root], allowReadOutsideRoots: true });
  assert.equal(gateWrite(readOnlyFlag, outside).ok, false);
});

test("undefined grant degrades to projectRoot-only, fail-closed (G2 default)", () => {
  const root = createWorkspace();
  // In-project work continues without the session plumbing…
  assert.equal(gateWrite(undefined, path.join(root, "file.txt"), root).ok, true);
  assert.equal(gateRead(undefined, path.join(root, "file.txt"), root).ok, true);
  // …while out-of-project writes/reads are denied.
  assert.equal(gateWrite(undefined, path.join(os.tmpdir(), "evil.txt"), root).ok, false);
  assert.equal(gateRead(undefined, path.join(os.tmpdir(), "evil.txt"), root).ok, false);
  // No root at all: deny everything.
  assert.equal(gateWrite(undefined, path.join(root, "file.txt")).ok, false);
  assert.equal(gateRead(undefined, path.join(root, "file.txt")).ok, false);
});

test("TOCTOU: a not-yet-existing target escapes via .. and is judged by its parent", () => {
  const root = createWorkspace();
  const grant = makeGrant({ writeRoots: [root] });
  const escape = path.join(root, "sub", "..", "..", `${path.basename(root)}-escape.txt`);
  // Lexically normalize first, mirroring how handlers pass real paths.
  const normalized = path.normalize(escape);
  const verdict = gateWrite(grant, normalized);
  assert.equal(verdict.ok, false, `escape path ${normalized} must be rejected`);
  if (!verdict.ok) {
    assert.equal(verdict.scope, "write-out-cwd");
  }
  // A genuinely new file under the root (parent exists, target does not) passes.
  assert.equal(gateWrite(grant, path.join(root, "brand-new", "..", "fresh.txt")).ok, true);
});

test("symlink planted inside the root pointing outside is rejected (write)", () => {
  const root = createWorkspace();
  const outsideDir = createWorkspace();
  const outsideTarget = path.join(outsideDir, "payload.txt");
  fs.writeFileSync(outsideTarget, "x");
  const linkPath = path.join(root, "innocent-link.txt");
  fs.symlinkSync(outsideTarget, linkPath);

  const grant = makeGrant({ writeRoots: [root] });
  assert.equal(gateWrite(grant, linkPath).ok, false);
  // Read side too.
  assert.equal(gateRead(makeGrant({ readRoots: [root] }), linkPath).ok, false);
});

test("dangling symlink inside the root pointing outside is rejected", () => {
  const root = createWorkspace();
  const outsideDir = createWorkspace();
  const danglingTarget = path.join(outsideDir, "not-created-yet.txt");
  const linkPath = path.join(root, "dangling-link.txt");
  fs.symlinkSync(danglingTarget, linkPath);

  const grant = makeGrant({ writeRoots: [root] });
  // realpath would fail on the dangling link; the gate must still judge the
  // write against the link TARGET's parent, not the link's lexical position.
  assert.equal(gateWrite(grant, linkPath).ok, false);
});

test("symlinked directory inside the root routing outside is rejected", () => {
  const root = createWorkspace();
  const outsideDir = createWorkspace();
  const linkDir = path.join(root, "assets");
  fs.symlinkSync(outsideDir, linkDir);

  const grant = makeGrant({ writeRoots: [root] });
  assert.equal(gateWrite(grant, path.join(linkDir, "new-file.txt")).ok, false);
  assert.equal(gateRead(makeGrant({ readRoots: [root] }), path.join(linkDir, "new-file.txt")).ok, false);
});

test("multiple roots: exempt paths extend the read boundary", () => {
  const root = createWorkspace();
  const exempt = createWorkspace();
  const grant = makeGrant({ writeRoots: [root], readRoots: [root, exempt] });

  assert.equal(gateRead(grant, path.join(exempt, "global-skill.md")).ok, true);
  // Read grant does not open the write gate for the same path.
  assert.equal(gateWrite(grant, path.join(exempt, "global-skill.md")).ok, false);
  // A third location is still denied for both.
  const third = createWorkspace();
  assert.equal(gateRead(grant, path.join(third, "x")).ok, false);
  assert.equal(gateWrite(grant, path.join(third, "x")).ok, false);
});

test("grant root given as a symlink alias still contains its real target", () => {
  const realRoot = createWorkspace();
  const aliasParent = createWorkspace();
  const alias = path.join(aliasParent, "alias-root");
  fs.symlinkSync(realRoot, alias);

  const grant = makeGrant({ writeRoots: [alias] });
  assert.equal(gateWrite(grant, path.join(realRoot, "file.txt")).ok, true);
});

test("moved primitives behave identically: isPathInProject still classifies via realpath", () => {
  const root = createWorkspace();
  assert.equal(isPathInProject(root, path.join(root, "a.ts")), true);
  assert.equal(isPathInProject(root, path.join(os.tmpdir(), "elsewhere.ts")), false);
});
