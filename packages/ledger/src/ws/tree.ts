// Chain workspace tree object (design §8.1, R27).
//
// A tree is a full-snapshot manifest: path → {blob cid, mode}, same shape as
// GitFileHistory's manifest in packages/core (deliberately isomorphic so the
// session change-set pipeline feeds it directly). treeCid = SHA-256 over the
// canonical JSON of the tree.

import { sha256Hex } from "../cid/cid.js";
import { jcsBytes, type JsonValue } from "../encode/jcs.js";

export type FileMode = "100644" | "100755";

export interface TreeEntry {
  /** Manifest CID of the file blob (from cid/buildBlob). */
  blob: string;
  mode: FileMode;
}

export interface Tree {
  version: 1;
  entries: Record<string, TreeEntry>;
}

export function emptyTree(): Tree {
  return { version: 1, entries: {} };
}

export function treeCidOf(tree: Tree): string {
  return sha256Hex(jcsBytes(tree as unknown as JsonValue));
}

export function setTreeEntry(tree: Tree, path: string, entry: TreeEntry): Tree {
  assertValidPath(path);
  const entries = { ...tree.entries, [path]: entry };
  return { version: 1, entries };
}

export function removeTreeEntry(tree: Tree, path: string): Tree {
  const entries = { ...tree.entries };
  delete entries[path];
  return { version: 1, entries };
}

/**
 * Overlay a change-set (path → entry-or-null) onto a base tree — the direct
 * shape of a session's changedFilePaths checkpoint (R28).
 */
export function applyChangesToTree(base: Tree, changes: Record<string, TreeEntry | null>): Tree {
  let tree = { version: 1, entries: { ...base.entries } } as Tree;
  for (const [path, entry] of Object.entries(changes)) {
    tree = entry === null ? removeTreeEntry(tree, path) : setTreeEntry(tree, path, entry);
  }
  return tree;
}

/** POSIX-relative safety: no absolute, no traversal, no empty/double segments (R29). */
export function assertValidPath(path: string): void {
  if (!isSafeWorkspacePath(path)) {
    throw new Error(`unsafe workspace path: ${path}`);
  }
}

export function isSafeWorkspacePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\")) {
    return false;
  }
  const segments = path.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
