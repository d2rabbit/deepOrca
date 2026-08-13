/**
 * File Collector — scans project directories for file access patterns and hotspots.
 *
 * Uses mtime/atime to determine recently active files and directories.
 * Cross-platform, zero external dependencies.
 */

import { readdirSync, lstatSync } from "node:fs";
import { join, relative } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FileActivity {
  path: string;
  mtime: number;
  sizeKB: number;
}

export interface DirHotspot {
  dir: string;
  fileCount: number;
  totalSizeKB: number;
  lastModified: number;
}

export interface FileProfile {
  recentFiles: FileActivity[];
  dirHotspots: DirHotspot[];
  totalFiles: number;
  totalSizeMB: number;
  languages: Record<string, number>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  ".next",
  ".cache",
  "vendor",
  "vendor-src",
  ".deeporca",
  ".deepcode",
  "__pycache__",
  ".DS_Store",
]);

const EXT_LANGUAGES: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".swift": "Swift",
  ".c": "C",
  ".cpp": "C++",
  ".h": "C/C++ Header",
  ".css": "CSS",
  ".scss": "SCSS",
  ".html": "HTML",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".md": "Markdown",
  ".sh": "Shell",
  ".sql": "SQL",
  ".vue": "Vue",
  ".svelte": "Svelte",
};

function scanDir(dir: string, projectRoot: string, depth: number, maxDepth: number): FileActivity[] {
  if (depth > maxDepth) return [];
  const results: FileActivity[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    let stat;
    try {
      // Use lstatSync to NOT follow symlinks (prevents cycles + out-of-tree scans).
      stat = lstatSync(fullPath);
    } catch {
      continue;
    }

    // Skip symlinks entirely.
    if (stat.isSymbolicLink()) continue;

    if (stat.isDirectory()) {
      results.push(...scanDir(fullPath, projectRoot, depth + 1, maxDepth));
    } else {
      results.push({
        path: relative(projectRoot, fullPath),
        mtime: stat.mtimeMs,
        sizeKB: Math.round(stat.size / 1024),
      });
    }
  }

  return results;
}

// ── Main collector ───────────────────────────────────────────────────────────

/**
 * Build a file activity profile for a project.
 *
 * @param projectRoot — The project root path.
 * @param maxDepth — Max directory depth to scan (default: 5).
 */
export function collectFileProfile(projectRoot: string, maxDepth = 5): FileProfile {
  const files = scanDir(projectRoot, projectRoot, 0, maxDepth);

  if (files.length === 0) {
    return { recentFiles: [], dirHotspots: [], totalFiles: 0, totalSizeMB: 0, languages: {} };
  }

  const now = Date.now();

  // Recent files (modified in last 7 days).
  const recentFiles = files
    .filter((f) => now - f.mtime < 7 * 24 * 3600 * 1000)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 30);

  // Directory hotspots.
  const dirStats = new Map<string, { fileCount: number; totalSizeKB: number; lastModified: number }>();
  for (const f of files) {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ".";
    if (!dirStats.has(dir)) {
      dirStats.set(dir, { fileCount: 0, totalSizeKB: 0, lastModified: 0 });
    }
    const ds = dirStats.get(dir)!;
    ds.fileCount++;
    ds.totalSizeKB += f.sizeKB;
    if (f.mtime > ds.lastModified) ds.lastModified = f.mtime;
  }

  const dirHotspots = Array.from(dirStats.entries())
    .map(([dir, v]) => ({ dir, ...v }))
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, 15);

  // Language distribution.
  const languages: Record<string, number> = {};
  for (const f of files) {
    const ext = f.path.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? "";
    const lang = EXT_LANGUAGES[ext];
    if (lang) languages[lang] = (languages[lang] ?? 0) + 1;
  }

  const totalSizeMB = Math.round((files.reduce((s, f) => s + f.sizeKB, 0) / 1024) * 10) / 10;

  return {
    recentFiles: recentFiles.map((f) => ({
      ...f,
      mtime: Math.round(f.mtime),
    })),
    dirHotspots,
    totalFiles: files.length,
    totalSizeMB,
    languages,
  };
}
