// File-level tree diff (design §8.2, R29). Pure function over two tree
// snapshots — no git CLI, millisecond cost (two key-set comparisons). Rename
// detection pairs removed paths with added paths carrying the identical blob
// cid + mode, so a moved file shows up as a rename, not delete+add.

import type { Tree, TreeEntry } from "./tree.js";

export interface TreeDiff {
  added: string[];
  removed: string[];
  modified: string[];
  renamed: { from: string; to: string }[];
  unchanged: number;
}

export function diffTrees(oldTree: Tree | null, newTree: Tree | null): TreeDiff {
  const oldEntries = oldTree?.entries ?? {};
  const newEntries = newTree?.entries ?? {};
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  let unchanged = 0;

  for (const [path, entry] of Object.entries(oldEntries)) {
    const next = newEntries[path];
    if (next === undefined) {
      removed.push(path);
    } else if (next.blob === entry.blob && next.mode === entry.mode) {
      unchanged++;
    } else {
      modified.push(path);
    }
  }
  for (const path of Object.keys(newEntries)) {
    if (oldEntries[path] === undefined) {
      added.push(path);
    }
  }

  const renamed: { from: string; to: string }[] = [];
  const remainingRemoved = new Map<string, TreeEntry>(removed.map((path) => [path, oldEntries[path]]));
  const remainingAdded = new Set(added);
  for (const to of added) {
    const entry = newEntries[to];
    let matchedFrom: string | undefined;
    for (const [from, removedEntry] of remainingRemoved) {
      if (removedEntry.blob === entry.blob && removedEntry.mode === entry.mode) {
        matchedFrom = from;
        break;
      }
    }
    if (matchedFrom !== undefined) {
      remainingRemoved.delete(matchedFrom);
      remainingAdded.delete(to);
      renamed.push({ from: matchedFrom, to });
    }
  }

  return {
    added: [...remainingAdded].sort(),
    removed: [...remainingRemoved.keys()].sort(),
    modified: modified.sort(),
    renamed,
    unchanged,
  };
}
