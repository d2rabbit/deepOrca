/**
 * Shared filesystem containment helpers for privileged main-process handlers.
 *
 * Two surfaces consume this:
 *  - Editor read/write/list (`editor-handlers.ts`) — containment root is the
 *    project root.
 *  - Wiki read/list (`main/index.ts`) — containment root is
 *    `<project>/deepwiki`, and only `.md` files are readable.
 *
 * Why this exists separately from `editor-handlers.ts`:
 *  - Wiki previously used a string-only `normalize + regex strip ../` guard,
 *    which is defeated by absolute paths, Windows drive letters, UNC paths,
 *    mixed separators, and symlinks/junctions inside `deepwiki/`. Editor had a
 *    proper lexical + realpath guard but it was module-private. Extracting the
 *    guard into a shared, tested module closes the gap without forcing one
 *    handler to import the other.
 *
 * Defence layers (matching editor's original implementation):
 *   1. Lexical containment under the resolved root (catches `..`).
 *   2. `realpathSync` on the root (root itself may be a symlink).
 *   3. For an existing target, `realpathSync` the target and compare against
 *      the real root — catches symlinks (Unix) and junctions/reparse points
 *      (Windows) that point outside the root.
 *   4. For a not-yet-existing target (write path), walk up to the nearest
 *      existing ancestor, realpath it, verify it stays inside the root. The
 *      non-existent suffix segments are under our control (no symlink yet).
 *
 * Known limitation: like all `realpath`-based checks there is a TOCTOU window
 * between the check and the subsequent read/write. A local attacker that can
 * replace a path with a symlink in that window could escape. The desktop
 * threat model assumes no hostile local process; if that changes, the handlers
 * need to operate on opened file descriptors rather than paths.
 */

import * as fsSync from "node:fs";
import * as path from "node:path";

/**
 * Resolve a user-supplied path safely within `root`.
 * Returns the absolute path if it is contained, or `null` if it escapes.
 *
 * `relPath` may be relative (resolved against `root`) or absolute (must already
 * be inside `root`). Both existing and not-yet-existing paths are handled.
 */
export function safePathWithinRoot(root: string, relPath: string): string | null {
  const resolved = path.resolve(root, relPath);
  const normalizedRoot = path.resolve(root);
  // Step 1: lexical guard first (cheap, catches ".." traversals).
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    return null;
  }

  // Step 2: resolve the physical root (root itself may be a symlink).
  let realRoot: string;
  try {
    realRoot = fsSync.realpathSync(normalizedRoot);
  } catch {
    return null;
  }

  // Step 3: for a path that already exists, realpath and compare directly.
  try {
    const realTarget = fsSync.realpathSync(resolved);
    if (realTarget === realRoot || realTarget.startsWith(realRoot + path.sep)) {
      return resolved;
    }
    return null;
  } catch {
    // Target doesn't exist yet (write path) — handled below.
  }

  // Step 4: find the deepest existing ancestor and verify it stays inside the
  // root. The non-existent suffix segments are under our control (no symlink
  // yet), so a clean ancestor is sufficient.
  let probe = resolved;
  while (probe !== realRoot && !fsSync.existsSync(probe)) {
    probe = path.dirname(probe);
  }
  try {
    const realAncestor = fsSync.realpathSync(probe);
    if (realAncestor !== realRoot && !realAncestor.startsWith(realRoot + path.sep)) {
      return null;
    }
  } catch {
    return null;
  }
  return resolved;
}

/**
 * Is `relPath` a strictly relative path (no leading `/`, no drive letter, no
 * UNC `\\host`)? Used to reject absolute paths early for Wiki reads, where an
 * absolute path would be meaningless under the wiki root anyway.
 */
export function isStrictlyRelative(relPath: string): boolean {
  if (!relPath) return false;
  // Reject POSIX absolute.
  if (relPath.startsWith("/")) return false;
  // Reject Windows drive letters (C:\, C:/, and bare C:).
  if (/^[a-zA-Z]:[\\/]/.test(relPath) || /^[a-zA-Z]:$/.test(relPath)) return false;
  // Reject UNC (\\host\share, //host/share).
  if (relPath.startsWith("\\\\") || relPath.startsWith("//")) return false;
  return true;
}

/** Result of a Wiki path containment check. */
export type WikiPathCheck =
  | { ok: true; absPath: string }
  | { ok: false; reason: "non-relative" | "non-markdown" | "escapes-root" };

/**
 * Validate a Wiki page path against the `<project>/deepwiki` root.
 *
 * Wiki pages must be:
 *  - strictly relative (no `/`, drive letter, or UNC prefix);
 *  - end in `.md`;
 *  - lexically and physically contained under the wiki root (no symlink /
 *    junction escape).
 *
 * Returns the absolute path on success, or a structured reason for failure so
 * callers can distinguish "page not found" from "illegal path" without parsing
 * a string.
 */
export function safeWikiPath(wikiRoot: string, relPath: string): WikiPathCheck {
  if (!isStrictlyRelative(relPath)) {
    return { ok: false, reason: "non-relative" };
  }
  if (!relPath.endsWith(".md")) {
    return { ok: false, reason: "non-markdown" };
  }
  const absPath = safePathWithinRoot(wikiRoot, relPath);
  if (!absPath) {
    return { ok: false, reason: "escapes-root" };
  }
  return { ok: true, absPath };
}

/**
 * Architecture-map artifact guard (audit 2026-08-25 lineage; now guards the archify
 * to readFileSync() whatever path the renderer passed — unlike editor/wiki it
 * had NO containment, so a compromised renderer had an arbitrary-file-read
 * primitive (~/.ssh, .env). Same contract as safeWikiPath, but the renderer
 * legitimately sends ABSOLUTE paths (from the status file list), so instead
 * of strict-relativity we require: basename matches the archmap naming
 * (arch-*.md|json|html — .html is archify's delivered render, joined 2026-08-29) AND the
 * target stays contained under the prototypes root (lexical + realpath, via
 * safePathWithinRoot).
 */
export type ArchmapPathCheck = { ok: true; absPath: string } | { ok: false; reason: "non-archmap" | "escapes-root" };

export function safeArchmapPath(prototypesRoot: string, targetPath: string): ArchmapPathCheck {
  const base = path.basename(targetPath);
  // `.html` joined when archify renders `arch-*.<type>.json` (2026-08-29);
  // legacy `.md` accepted for reading pre-archify leftovers.
  if (!/^arch-.+\.(md|json|html)$/.test(base)) {
    return { ok: false, reason: "non-archmap" };
  }
  const absPath = safePathWithinRoot(prototypesRoot, targetPath);
  if (!absPath) {
    return { ok: false, reason: "escapes-root" };
  }
  return { ok: true, absPath };
}
