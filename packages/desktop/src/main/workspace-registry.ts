// Cross-workspace session enumeration for the desktop client. Reads every
// `<config root>/projects/*/sessions-index.json` written by core's SessionManager,
// groups sessions by their originating workspace, and merges the desktop-only
// archive sidecar so the renderer can render a VSCode-style workspace tree.

import { getUserConfigRoot, type SessionsIndex } from "@deeporca/core";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { SerializableSessionEntry, WorkspaceGroup, WorkspaceSessions } from "../shared/ipc.js";
import { toSerializableEntry } from "./session-bridge.js";
import { readArchivedIds } from "./archive-store.js";

/** Root directory holding every project's session index. */
function projectsDir(): string {
  return path.join(getUserConfigRoot(), "projects");
}

/**
 * Canonicalized OS temp dir. Test suites create throwaway workspaces under
 * `$TMPDIR` (e.g. `/var/folders/.../deepcode-*-workspace-*`); those must never
 * surface in the sidebar tree or win the initial-root pick. Returns null when
 * the temp dir itself can't be resolved.
 */
function canonicalTmpdir(): string | null {
  try {
    return realpathSync(tmpdir());
  } catch {
    return null;
  }
}

/** True when `root` lives inside the OS temp directory. */
function isTempRoot(root: string, canonicalTmp: string | null): boolean {
  if (!canonicalTmp) {
    return false;
  }
  let real: string;
  try {
    real = realpathSync(root);
  } catch {
    return false; // unresolvable roots are handled by the existence check
  }
  return real === canonicalTmp || real.startsWith(canonicalTmp + path.sep);
}

/** True when the workspace root no longer exists on disk (moved/deleted). */
function isStaleRoot(root: string): boolean {
  try {
    return !statSync(root).isDirectory();
  } catch {
    return true;
  }
}

/** Read and parse a single `sessions-index.json`, tolerating malformed files. */
function readSessionsIndex(indexPath: string): SessionsIndex | null {
  try {
    const raw = readFileSync(indexPath, "utf8");
    const parsed = JSON.parse(raw) as SessionsIndex;
    if (!parsed || !Array.isArray(parsed.entries) || typeof parsed.originalPath !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Most recent `updateTime` across a group's entries (ISO strings sort lexically). */
function latestUpdate(entries: Array<{ updateTime: string }>): string {
  let latest = "";
  for (const entry of entries) {
    if (entry.updateTime > latest) {
      latest = entry.updateTime;
    }
  }
  return latest;
}

/**
 * Enumerate every workspace's sessions, splitting archived sessions into a flat
 * bucket. The `currentRoot` workspace is pinned to the top; the rest are sorted
 * by most recent activity (descending).
 */
export function listWorkspaceSessions(currentRoot: string): WorkspaceSessions {
  const dir = projectsDir();
  const archivedIds = new Set(readArchivedIds());
  const workspaces: WorkspaceGroup[] = [];
  const archived: WorkspaceSessions["archived"] = [];
  const tmp = canonicalTmpdir();
  const seenRoots = new Set<string>();

  let projectDirs: string[] = [];
  if (existsSync(dir)) {
    try {
      projectDirs = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      projectDirs = [];
    }
  }

  for (const code of projectDirs) {
    const indexPath = path.join(dir, code, "sessions-index.json");
    const index = readSessionsIndex(indexPath);
    if (!index) {
      continue;
    }
    const root = index.originalPath;
    // Skip the user's home directory — it should never appear as a workspace.
    if (root === homedir() || root === homedir() + "/" || root === homedir() + "\\") {
      continue;
    }
    // Skip stale roots (deleted/moved) — their sessions are unreadable anyway,
    // and test suites leave hundreds of dead temp-workspace indexes behind.
    if (isStaleRoot(root)) {
      continue;
    }
    // Skip throwaway temp-dir workspaces (test artifacts) — but never filter
    // out the workspace the user is actively looking at right now.
    if (root !== currentRoot && isTempRoot(root, tmp)) {
      continue;
    }
    // Dedupe roots that resolve to the same directory (e.g. /var vs
    // /private/var aliases recorded under different project codes).
    let canonicalRoot: string;
    try {
      canonicalRoot = realpathSync(root);
    } catch {
      canonicalRoot = root;
    }
    if (seenRoots.has(canonicalRoot)) {
      continue;
    }
    seenRoots.add(canonicalRoot);
    const label = path.basename(root) || root;
    const sessions: SerializableSessionEntry[] = [];
    for (const entry of index.entries) {
      const serialized = toSerializableEntry(entry);
      serialized.workspaceRoot = root;
      if (archivedIds.has(entry.id)) {
        serialized.archived = true;
        archived.push({ root, session: serialized });
      } else {
        sessions.push(serialized);
      }
    }
    workspaces.push({ root, label, projectCode: code, sessions });
  }

  // Ensure the current workspace always appears in the tree, even if it has no
  // sessions-index.json yet (e.g. a freshly opened project). This gives the user
  // a visual anchor and a "+" button to start their first conversation. The
  // user's home directory is deliberately excluded — it must never show up as a
  // workspace, even while it serves as the engine's fallback root.
  const home = homedir();
  if (
    currentRoot &&
    currentRoot !== home &&
    path.resolve(currentRoot) !== home &&
    !workspaces.some((w) => w.root === currentRoot)
  ) {
    const label = path.basename(currentRoot) || currentRoot;
    // Derive a stable project code from the root path (same logic as core).
    const code = currentRoot.replace(/[/\\]/g, "-").replace(/^-/, "");
    workspaces.push({ root: currentRoot, label, projectCode: code, sessions: [] });
  }

  workspaces.sort((a, b) => {
    if (a.root === currentRoot) {
      return -1;
    }
    if (b.root === currentRoot) {
      return 1;
    }
    return latestUpdate(b.sessions) > latestUpdate(a.sessions) ? 1 : -1;
  });

  archived.sort((a, b) => (b.session.updateTime > a.session.updateTime ? 1 : -1));

  return { workspaces, archived };
}
