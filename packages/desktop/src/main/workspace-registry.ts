// Cross-workspace session enumeration for the desktop client. Reads every
// `<config root>/projects/*/sessions-index.json` written by core's SessionManager,
// groups sessions by their originating workspace, and merges the desktop-only
// archive sidecar so the renderer can render a VSCode-style workspace tree.

import { getUserConfigRoot, type SessionsIndex } from "@deeporca/core";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { SerializableSessionEntry, WorkspaceGroup, WorkspaceSessions } from "../shared/ipc.js";
import { toSerializableEntry } from "./session-bridge.js";
import { readArchivedIds } from "./archive-store.js";

/** Root directory holding every project's session index. */
function projectsDir(): string {
  return path.join(getUserConfigRoot(), "projects");
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
