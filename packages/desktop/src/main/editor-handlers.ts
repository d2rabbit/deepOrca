import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import type { EditorFileEntry } from "../shared/ipc";

/** Max file size we'll read into the editor (2 MB). */
const MAX_FILE_SIZE = 2 * 1024 * 1024;

/** Extensions we treat as binary without inspecting content. */
const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "icns",
  "bmp",
  "tiff",
  "tif",
  "mp3",
  "mp4",
  "wav",
  "ogg",
  "flac",
  "aac",
  "avi",
  "mov",
  "mkv",
  "webm",
  "zip",
  "tar",
  "gz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "jar",
  "war",
  "exe",
  "dll",
  "so",
  "dylib",
  "app",
  "dmg",
  "pkg",
  "deb",
  "rpm",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "db",
  "sqlite",
  "sqlite3",
  "mdb",
  "class",
  "pyc",
  "pyo",
  "o",
  "a",
  "lib",
]);

/**
 * Resolve a user-supplied path safely within the project root.
 * Returns the absolute path or null if it escapes the root.
 *
 * Defends against symlink/junction escapes: a lexical `startsWith` check alone
 * is insufficient because `path.resolve` does not follow symlinks. We resolve
 * the real (physical) root and, for the target, walk up to the nearest existing
 * ancestor, realpath it, and verify the resolved physical path stays inside the
 * root. This catches symlinks (Unix), junctions/reparse points (Windows), and
 * relative-path traversals alike.
 */
function safePath(projectRoot: string, relPath: string): string | null {
  const resolved = path.resolve(projectRoot, relPath);
  const normalizedRoot = path.resolve(projectRoot);
  // Lexical guard first (cheap, catches ".." traversals).
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    return null;
  }

  // Resolve the physical root (root itself may be a symlink).
  let realRoot: string;
  try {
    realRoot = fsSync.realpathSync(normalizedRoot);
  } catch {
    return null;
  }

  // For a path that already exists, realpath and compare directly.
  try {
    const realTarget = fsSync.realpathSync(resolved);
    if (realTarget === realRoot || realTarget.startsWith(realRoot + path.sep)) {
      return resolved;
    }
    return null;
  } catch {
    // Target doesn't exist yet (write path) — walk up to the nearest existing
    // ancestor, realpath it, and check that the remaining suffix can't escape.
  }

  // Find the deepest existing ancestor and verify it stays inside the root.
  let probe = resolved;
  const suffixParts: string[] = [];
  while (probe !== realRoot && !fsSync.existsSync(probe)) {
    suffixParts.unshift(path.basename(probe));
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
  // The non-existent suffix segments are under our control (no symlink yet),
  // so a clean ancestor is sufficient.
  return resolved;
}

/** Check if a file is likely binary by extension or content sniffing. */
async function isBinaryFile(absPath: string): Promise<boolean> {
  const ext = path.extname(absPath).slice(1).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;

  // Sniff first 512 bytes for null bytes (strong binary indicator)
  try {
    const fd = await fs.open(absPath, "r");
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fd.read(buf, 0, 512, 0);
    await fd.close();
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
  } catch {
    return true; // Can't read → treat as binary
  }
  return false;
}

// ── Individual handler functions (called from main/index.ts) ──────────────

/** Read a file's text content from the project root. */
export async function handleEditorReadFile(
  projectRoot: string,
  filePath: string
): Promise<{ ok: boolean; content?: string; error?: string; binary?: boolean }> {
  const absPath = safePath(projectRoot, filePath);
  if (!absPath) return { ok: false, error: "Path escapes project root" };

  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) return { ok: false, error: "Not a file" };
    if (stat.size > MAX_FILE_SIZE) return { ok: false, error: "File too large" };

    if (await isBinaryFile(absPath)) {
      return { ok: true, binary: true };
    }

    const content = await fs.readFile(absPath, "utf-8");
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Write text content to a file within the project root. */
export async function handleEditorWriteFile(
  projectRoot: string,
  filePath: string,
  content: string
): Promise<{ ok: boolean; error?: string }> {
  const absPath = safePath(projectRoot, filePath);
  if (!absPath) return { ok: false, error: "Path escapes project root" };

  try {
    await fs.writeFile(absPath, content, "utf-8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** List files and directories under a path within the project root. */
export async function handleEditorListFiles(
  projectRoot: string,
  dirPath: string
): Promise<{ ok: boolean; entries?: EditorFileEntry[]; error?: string }> {
  const absPath = safePath(projectRoot, dirPath || ".");
  if (!absPath) return { ok: false, error: "Path escapes project root" };

  try {
    const dirents = await fs.readdir(absPath, { withFileTypes: true });
    const entries: EditorFileEntry[] = [];

    for (const d of dirents) {
      // Skip hidden files and common noise directories
      if (d.name.startsWith(".")) continue;
      if (d.name === "node_modules" || d.name === "dist" || d.name === "out") continue;

      const entryPath = dirPath ? `${dirPath}/${d.name}` : d.name;
      if (d.isDirectory()) {
        entries.push({ name: d.name, path: entryPath, type: "directory", size: 0 });
      } else if (d.isFile()) {
        try {
          const stat = await fs.stat(path.join(absPath, d.name));
          entries.push({ name: d.name, path: entryPath, type: "file", size: stat.size });
        } catch {
          entries.push({ name: d.name, path: entryPath, type: "file", size: 0 });
        }
      }
    }

    // Directories first, then files, both alphabetical
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { ok: true, entries };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
