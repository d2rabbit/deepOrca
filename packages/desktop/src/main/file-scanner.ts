// Lightweight file scanner used for @file mention autocomplete.
// Mirrors the CLI's file-mentions.ts but simplified for Electron main process use.

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const NOISY_DIRS = new Set([
  ".git",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  "__pycache__",
  "build",
  "dist",
  "node_modules",
  "out",
  "target",
  ".svn",
  ".hg",
  ".deepcode",
  ".deeporca",
  ".husky",
  ".github",
]);

const MAX_DEPTH = 6;
const MAX_RESULTS = 30;

export type FileScanItem = {
  path: string;
  type: "file" | "directory";
};

export function scanFiles(root: string, query: string): FileScanItem[] {
  if (!query.trim()) return [];
  const lowerQuery = query.toLowerCase();
  const results: FileScanItem[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > MAX_DEPTH || results.length >= MAX_RESULTS) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const name of entries) {
      if (results.length >= MAX_RESULTS) return;
      if (NOISY_DIRS.has(name)) continue;

      const fullPath = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(fullPath).isDirectory();
      } catch {
        continue;
      }

      const relPath = relative(root, fullPath);
      if (relPath.toLowerCase().includes(lowerQuery)) {
        results.push({ path: relPath, type: isDir ? "directory" : "file" });
      }

      if (isDir) {
        walk(fullPath, depth + 1);
      }
    }
  }

  walk(root, 0);
  return results.slice(0, MAX_RESULTS);
}
