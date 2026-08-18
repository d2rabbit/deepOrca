// Cross-workspace session enumeration for the desktop client. Reads every
// `<config root>/projects/*/sessions-index.json` written by core's SessionManager,
// groups sessions by their originating workspace, and merges the desktop-only
// archive sidecar so the renderer can render a VSCode-style workspace tree.

import { getUserConfigRoot, type SessionsIndex } from "@deeporca/core";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { WorkspaceGroup, WorkspaceSessions } from "../shared/ipc.js";
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

/**
 * Canonical comparison key for workspace roots. Windows paths are case-blind:
 * `D:\Others\deepOrca` and `D:\others\deeporca` are the same directory, and the
 * same physical dir can end up recorded under several project codes when the
 * root string's spelling drifted between opens. Comparing raw strings splits
 * one workspace into two tree rows (or silently hides one code dir's sessions),
 * so every identity check goes through this key: resolve + realpath, lowercased
 * on win32. Falls back to `path.resolve` when the path can't be stat'ed.
 */
function rootKey(root: string): string {
  let resolved = path.resolve(root);
  try {
    resolved = realpathSync(resolved);
  } catch {
    // Unresolvable (deleted/moved) roots keep the resolved spelling.
  }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
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
  const currentKey = currentRoot ? rootKey(currentRoot) : null;
  // Groups keyed by canonical root so index files recorded under different
  // spellings of the same directory merge into a single tree row.
  const groupByKey = new Map<string, WorkspaceGroup>();
  const homeKey = rootKey(homedir());

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
    if (rootKey(root) === homeKey) {
      continue;
    }
    // Skip stale roots (deleted/moved) — their sessions are unreadable anyway,
    // and test suites leave hundreds of dead temp-workspace indexes behind.
    if (isStaleRoot(root)) {
      continue;
    }
    // Skip throwaway temp-dir workspaces (test artifacts) — but never filter
    // out the workspace the user is actively looking at right now.
    if (currentKey === null || rootKey(root) !== currentKey) {
      if (isTempRoot(root, tmp)) {
        continue;
      }
    }
    // Merge indexes that resolve to the same directory (casing drift, /var vs
    // /private/var aliases recorded under different project codes) instead of
    // hiding all but the first behind a silent skip. When this row is the
    // current workspace, adopt the live spelling so exact-match comparisons
    // downstream (sort pin, renderer isCurrent) keep working.
    const key = rootKey(root);
    let group = groupByKey.get(key);
    if (!group) {
      const displayRoot = key === currentKey && currentRoot ? currentRoot : root;
      group = {
        root: displayRoot,
        label: path.basename(displayRoot) || displayRoot,
        projectCode: code,
        sessions: [],
      };
      groupByKey.set(key, group);
      workspaces.push(group);
    } else if (key === currentKey && currentRoot && group.root !== currentRoot) {
      group.root = currentRoot;
      group.label = path.basename(currentRoot) || currentRoot;
    }
    for (const entry of index.entries) {
      const serialized = toSerializableEntry(entry);
      serialized.workspaceRoot = group.root;
      if (archivedIds.has(entry.id)) {
        serialized.archived = true;
        archived.push({ root: group.root, session: serialized });
      } else {
        group.sessions.push(serialized);
      }
    }
  }

  // Ensure the current workspace always appears in the tree, even if it has no
  // sessions-index.json yet (e.g. a freshly opened project). This gives the user
  // a visual anchor and a "+" button to start their first conversation. The
  // user's home directory is deliberately excluded — it must never show up as a
  // workspace, even while it serves as the engine's fallback root.
  if (currentRoot && rootKey(currentRoot) !== homeKey && !groupByKey.has(rootKey(currentRoot))) {
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
