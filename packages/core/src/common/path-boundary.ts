import * as fs from "fs";
import * as path from "path";
import type { PermissionScope } from "../settings";
import { isAbsoluteFilePath, normalizeFilePath } from "./state";

// Pure path-boundary primitives with no permission semantics, so tool
// handlers can enforce the execution-time boundary gate without importing
// the permission engine (specs/sandbox/design.md §4.1). isPathInProject /
// safeRealPath / isPathInAnyDirectory moved verbatim from permissions.ts.

export function isPathInProject(projectRoot: string, filePath: string): boolean {
  const normalized = normalizeFilePath(filePath);
  const absolutePath = isAbsoluteFilePath(normalized) ? normalized : path.resolve(projectRoot, normalized);
  // Hardening (deep review 2026-08-15, B3): a symlink planted INSIDE the
  // project could point at /etc while lexical resolution still classifies the
  // target as in-project (and thus pre-allowed). When both ends exist, prefer
  // the real paths; fall back to the lexical answer when realpath fails
  // (file not created yet / permissions), preserving prior behavior.
  const realPath = safeRealPath(absolutePath);
  const realRoot = safeRealPath(projectRoot);
  if (realPath && realRoot) {
    const realRelative = path.relative(realRoot, realPath);
    if (realRelative === "" || (!realRelative.startsWith("..") && !path.isAbsolute(realRelative))) {
      return true;
    }
    // realpath resolved and clearly escapes — trust it over the lexical answer.
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      return false;
    }
  }
  const relative = path.relative(path.resolve(projectRoot), path.resolve(absolutePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function safeRealPath(target: string): string | null {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

export function isPathInAnyDirectory(
  projectRoot: string,
  filePath: string,
  directories: string[] | undefined
): boolean {
  if (!directories?.length) {
    return false;
  }

  const normalized = normalizeFilePath(filePath);
  const absolutePath = isAbsoluteFilePath(normalized) ? normalized : path.resolve(projectRoot, normalized);
  for (const directory of directories) {
    const normalizedDirectory = normalizeFilePath(directory);
    const absoluteDirectory = isAbsoluteFilePath(normalizedDirectory)
      ? normalizedDirectory
      : path.resolve(projectRoot, normalizedDirectory);
    const relative = path.relative(path.resolve(absoluteDirectory), path.resolve(absolutePath));
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Execution-time path boundary gate (P0, specs/sandbox/design.md §4.1).
//
// The permission layer already classifies paths as in/out-of-cwd, but that
// decision never reached the handlers — after a pass they ran with full host
// authority (gap G1/G2). PathGrant is the capability handed down per tool
// call; the gates enforce it right before any fs mutation/read.

export type PathGrant = {
  /** Allowed write roots (realpath-normalized). Always contains realpath(projectRoot). */
  readonly writeRoots: readonly string[];
  /** Allowed read roots: realpath(projectRoot) + readPermissionExemptPaths. */
  readonly readRoots: readonly string[];
  /**
   * This call's write-out-cwd scope resolved to "allow" (explicit user grant
   * or one-time approval). Roots are the static boundary; the booleans are
   * the dynamic per-call authorization — a one-time approval cannot be
   * expressed as a root list ("the whole disk"), hence the orthogonal flag.
   */
  readonly allowWriteOutsideRoots: boolean;
  /** This call's read-out-cwd scope resolved to "allow". */
  readonly allowReadOutsideRoots: boolean;
};

export type GateVerdict = { ok: true } | { ok: false; reason: string; scope: PermissionScope };

/**
 * Write boundary gate. `projectRoot` is only consulted when `grant` is
 * undefined (direct handler invocations without the session plumbing): the
 * grant then degenerates to projectRoot-only with both outside-roots flags
 * false — fail-closed for out-of-project writes, ordinary in-project work
 * unaffected. Without any root at all, everything is denied.
 */
export function gateWrite(grant: PathGrant | undefined, filePath: string, projectRoot?: string): GateVerdict {
  const candidate = resolveGateCandidate(filePath);
  const roots = grant ? grant.writeRoots : projectRoot ? [projectRoot] : [];
  if (isPathInRoots(roots, candidate)) {
    return { ok: true };
  }
  if (grant?.allowWriteOutsideRoots) {
    return { ok: true };
  }
  return {
    ok: false,
    scope: "write-out-cwd",
    reason: `Write target is outside the allowed write boundary: ${filePath}. This path was not authorized for out-of-project writes. If writing there is genuinely required, ask the user to grant the "write-out-cwd" permission.`,
  };
}

/** Read boundary gate, mirror semantics of {@link gateWrite}. */
export function gateRead(grant: PathGrant | undefined, filePath: string, projectRoot?: string): GateVerdict {
  const candidate = resolveGateCandidate(filePath);
  const roots = grant ? grant.readRoots : projectRoot ? [projectRoot] : [];
  if (isPathInRoots(roots, candidate)) {
    return { ok: true };
  }
  if (grant?.allowReadOutsideRoots) {
    return { ok: true };
  }
  return {
    ok: false,
    scope: "read-out-cwd",
    reason: `Read target is outside the allowed read boundary: ${filePath}. This path was not authorized for out-of-project reads. If reading there is genuinely required, ask the user to grant the "read-out-cwd" permission.`,
  };
}

const MAX_SYMLINK_DEPTH = 10;

/**
 * Chase the final symlink chain manually (realpath would fail on a dangling
 * link and drop us back to the lexical link path, which would let a
 * `<root>/link -> /etc/new-file` write escape the boundary). Depth-capped to
 * break cycles; a chain over the cap keeps its lexical tail and simply fails
 * containment against outside roots.
 */
function followSymlinkChain(target: string, depth: number): string {
  if (depth >= MAX_SYMLINK_DEPTH) {
    return target;
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return target;
  }
  if (!stat.isSymbolicLink()) {
    return safeRealPath(target) ?? target;
  }
  let linkTarget: string;
  try {
    linkTarget = fs.readlinkSync(target);
  } catch {
    return target;
  }
  return followSymlinkChain(path.resolve(path.dirname(target), linkTarget), depth + 1);
}

/**
 * Canonical comparison candidate for a gate verdict. The target file may not
 * exist yet (write creates it), so resolution goes through the PARENT
 * directory's realpath and re-attaches the basename — same TOCTOU strategy
 * as isPathInProject's fallback, no new semantics. Intermediate-directory
 * symlinks are resolved by the parent realpath; final-component symlinks
 * (including dangling ones) by followSymlinkChain.
 */
function resolveGateCandidate(filePath: string): string {
  const normalized = normalizeFilePath(filePath);
  const resolved = followSymlinkChain(normalized, 0);
  const realParent = safeRealPath(path.dirname(resolved));
  return realParent ? path.join(realParent, path.basename(resolved)) : resolved;
}

function isWithinRoot(root: string, candidate: string): boolean {
  // The root must be realpath-normalized too: on macOS a lexical
  // /var/folders/... root never contains a /private/var/folders/... candidate.
  const realRoot = safeRealPath(root) ?? path.resolve(root);
  const relative = path.relative(realRoot, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isPathInRoots(roots: readonly string[], candidate: string): boolean {
  return roots.some((root) => isWithinRoot(root, candidate));
}
