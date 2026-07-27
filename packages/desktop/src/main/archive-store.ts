// Desktop-only archive sidecar. Session archive state is a client concern that
// must never leak into core's `SessionEntry` persistence, so it lives in a
// standalone JSON file: `<config root>/desktop/archive.json`.

import { getUserConfigRoot } from "@deeporca/core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type ArchiveFile = { archived: string[] };

/** Path to the archive sidecar file. */
function archivePath(): string {
  return path.join(getUserConfigRoot(), "desktop", "archive.json");
}

/** Read the raw archive file, tolerating a missing/corrupt file. */
function read(): ArchiveFile {
  try {
    const raw = readFileSync(archivePath(), "utf8");
    const parsed = JSON.parse(raw) as ArchiveFile;
    if (parsed && Array.isArray(parsed.archived)) {
      return { archived: parsed.archived.filter((id): id is string => typeof id === "string") };
    }
  } catch {
    // Missing or invalid file → treat as empty archive.
  }
  return { archived: [] };
}

/** Persist the archive file, creating the parent directory as needed. */
function write(data: ArchiveFile): void {
  const file = archivePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

/** Return the set of archived session ids. */
export function readArchivedIds(): string[] {
  return read().archived;
}

/** Add a session id to the archive (idempotent). */
export function archiveSession(id: string): void {
  const data = read();
  if (!data.archived.includes(id)) {
    data.archived.push(id);
    write(data);
  }
}

/** Remove a session id from the archive (idempotent). */
export function unarchiveSession(id: string): void {
  const data = read();
  const next = data.archived.filter((existing) => existing !== id);
  if (next.length !== data.archived.length) {
    write({ archived: next });
  }
}

/** Purge a deleted session id from the archive so it never lingers. */
export function purgeArchivedId(id: string): void {
  unarchiveSession(id);
}
