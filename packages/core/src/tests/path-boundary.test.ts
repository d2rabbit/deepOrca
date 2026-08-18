import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { gateRead, gateWrite, isPathInProject, isPathWithinRoots, type PathGrant } from "../common/path-boundary";
import {
  configureFileUtilsWriteBoundary,
  ensureParentDirectory,
  PathBoundaryError,
  writeTextFile,
} from "../common/file-utils";
import { ToolExecutor } from "../tools/executor";

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

/**
 * Cross-platform link fixture, capability-probed: create a native symlink
 * first; only when Windows refuses for lack of SeCreateSymbolicLinkPrivilege
 * (non-admin, no Developer Mode → EPERM) fall back to a junction, which needs
 * no privilege and behaves identically for everything the gate inspects
 * (lstat().isSymbolicLink(), readlinkSync, realpathSync). Privileged Windows
 * and all POSIX systems therefore exercise REAL symlinks; junctions are used
 * exactly where they are the only option. Junction targets must be absolute —
 * all fixtures are. The junction fallback is DIRECTORY-target-only: junctions
 * are directory reparse points, so a junction planted on a file target is not
 * a faithful fixture — file-target tests skip instead (skipWithoutFileSymlinks).
 */
function createLink(target: string, dest: string): void {
  try {
    fs.symlinkSync(target, dest);
    return;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    let targetIsDir = false;
    try {
      targetIsDir = fs.statSync(target).isDirectory();
    } catch {
      // Dangling target — not a directory.
    }
    if (process.platform === "win32" && e.code === "EPERM" && path.isAbsolute(target) && targetIsDir) {
      fs.symlinkSync(target, dest, "junction");
      return;
    }
    throw err;
  }
}

/**
 * Can THIS process create a symlink whose target is a FILE? Probed once with
 * a throwaway temp fixture and cached. On unprivileged Windows (EPERM) the
 * answer is false and the file-target tests below skip with a reason instead
 * of asserting against a junction, whose file-target semantics we cannot
 * verify from the fixture side.
 */
let fileSymlinkCapable: boolean | undefined;
function canCreateFileSymlink(): boolean {
  if (fileSymlinkCapable === undefined) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-link-probe-"));
    try {
      const target = path.join(dir, "target.txt");
      fs.writeFileSync(target, "x");
      fs.symlinkSync(target, path.join(dir, "link.txt"));
      fileSymlinkCapable = true;
    } catch {
      fileSymlinkCapable = false;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return fileSymlinkCapable;
}

/** Skip option for tests whose fixture requires a symlink to a FILE. */
const skipWithoutFileSymlinks = canCreateFileSymlink()
  ? false
  : "unprivileged Windows: file symlinks unavailable (junction fallback is directory-only)";

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

test("symlink planted inside the root pointing outside is rejected (write)", { skip: skipWithoutFileSymlinks }, () => {
  const root = createWorkspace();
  const outsideDir = createWorkspace();
  const outsideTarget = path.join(outsideDir, "payload.txt");
  fs.writeFileSync(outsideTarget, "x");
  const linkPath = path.join(root, "innocent-link.txt");
  createLink(outsideTarget, linkPath);

  const grant = makeGrant({ writeRoots: [root] });
  assert.equal(gateWrite(grant, linkPath).ok, false);
  // Read side too.
  assert.equal(gateRead(makeGrant({ readRoots: [root] }), linkPath).ok, false);
});

test("dangling symlink inside the root pointing outside is rejected", { skip: skipWithoutFileSymlinks }, () => {
  const root = createWorkspace();
  const outsideDir = createWorkspace();
  const danglingTarget = path.join(outsideDir, "not-created-yet.txt");
  const linkPath = path.join(root, "dangling-link.txt");
  createLink(danglingTarget, linkPath);

  const grant = makeGrant({ writeRoots: [root] });
  // realpath would fail on the dangling link; the gate must still judge the
  // write against the link TARGET's parent, not the link's lexical position.
  assert.equal(gateWrite(grant, linkPath).ok, false);
});

test("symlinked directory inside the root routing outside is rejected", () => {
  const root = createWorkspace();
  const outsideDir = createWorkspace();
  const linkDir = path.join(root, "assets");
  createLink(outsideDir, linkDir);

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
  createLink(realRoot, alias);

  const grant = makeGrant({ writeRoots: [alias] });
  assert.equal(gateWrite(grant, path.join(realRoot, "file.txt")).ok, true);
});

test("moved primitives behave identically: isPathInProject still classifies via realpath", () => {
  const root = createWorkspace();
  assert.equal(isPathInProject(root, path.join(root, "a.ts")), true);
  assert.equal(isPathInProject(root, path.join(os.tmpdir(), "elsewhere.ts")), false);
});

// --- file-utils bottom-line boundary (task 5) -------------------------------

test("file-utils write boundary is dormant until configured", () => {
  const root = createWorkspace();
  configureFileUtilsWriteBoundary(null);
  const outside = path.join(createWorkspace(), "direct-write.txt");
  // No boundary configured: direct writes anywhere behave exactly as before.
  assert.doesNotThrow(() => writeTextFile(outside, "x", "utf8", "LF"));
  assert.equal(fs.readFileSync(outside, "utf8"), "x");
});

test("file-utils write boundary throws outside configured roots after initialization", () => {
  const root = createWorkspace();
  configureFileUtilsWriteBoundary([root]);
  try {
    const outside = path.join(createWorkspace(), "escape.txt");
    assert.throws(() => writeTextFile(outside, "x", "utf8", "LF"), PathBoundaryError);
    assert.throws(() => ensureParentDirectory(path.join(outside, "child", "file.txt")), PathBoundaryError);
    assert.equal(fs.existsSync(outside), false);
    // In-root writes keep working without a grant.
    const inside = path.join(root, "ok.txt");
    assert.doesNotThrow(() => writeTextFile(inside, "x", "utf8", "LF"));
  } finally {
    configureFileUtilsWriteBoundary(null);
  }
});

test("file-utils write boundary honors the per-call grant (R1 not broken)", () => {
  const root = createWorkspace();
  configureFileUtilsWriteBoundary([root]);
  try {
    const outside = path.join(createWorkspace(), "authorized.txt");
    // An authorized out-of-roots write must pass the bottom line too —
    // otherwise the R1 one-time-approval semantics would be killed here.
    const grant = makeGrant({ writeRoots: [root], allowWriteOutsideRoots: true });
    assert.doesNotThrow(() => writeTextFile(outside, "x", "utf8", "LF", { pathGrant: grant }));
    // Same path WITHOUT the dynamic authorization is still blocked.
    const unauthorized = makeGrant({ writeRoots: [root], allowWriteOutsideRoots: false });
    assert.throws(
      () =>
        writeTextFile(path.join(createWorkspace(), "blocked.txt"), "x", "utf8", "LF", {
          pathGrant: unauthorized,
        }),
      PathBoundaryError
    );
  } finally {
    configureFileUtilsWriteBoundary(null);
  }
});

test("isPathWithinRoots checks every configured root", () => {
  const rootA = createWorkspace();
  const rootB = createWorkspace();
  assert.equal(isPathWithinRoots([rootA, rootB], path.join(rootB, "file.txt")), true);
  assert.equal(isPathWithinRoots([rootA, rootB], path.join(rootA, "file.txt")), true);
  assert.equal(isPathWithinRoots([rootA, rootB], path.join(createWorkspace(), "file.txt")), false);
});

test("executor threads extras.pathGrant into the handler context end-to-end", async () => {
  const workspace = createWorkspace();
  const outside = createWorkspace();
  const executor = new ToolExecutor(workspace);
  const toolCall = {
    id: "gate-exec-1",
    type: "function",
    function: {
      name: "write",
      arguments: JSON.stringify({ file_path: path.join(outside, "exec-write.txt"), content: "x" }),
    },
  };

  const denied = await executor.executeToolCalls("gate-exec-session", [toolCall], undefined, {
    pathGrant: makeGrant({ writeRoots: [workspace], readRoots: [workspace] }),
  });
  assert.equal(denied.length, 1);
  assert.equal(denied[0].result.ok, false);
  assert.equal(denied[0].result.errorType, "PERMISSION_DENIED");
  assert.equal(fs.existsSync(path.join(outside, "exec-write.txt")), false);

  const approved = await executor.executeToolCalls(
    "gate-exec-session",
    [{ ...toolCall, id: "gate-exec-2" }],
    undefined,
    { pathGrant: makeGrant({ writeRoots: [workspace], readRoots: [workspace], allowWriteOutsideRoots: true }) }
  );
  assert.equal(approved[0].result.ok, true);
  assert.equal(fs.readFileSync(path.join(outside, "exec-write.txt"), "utf8"), "x");
});
