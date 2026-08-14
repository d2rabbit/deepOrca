import * as fs from "fs";
import * as path from "path";
import type { FileState, FileLineEnding } from "./state";

export type FileReadMetadata = {
  content: string;
  encoding: BufferEncoding;
  lineEndings: FileLineEnding;
  timestamp: number;
};

export function normalizeContent(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

export function detectLineEndings(value: string): FileLineEnding {
  return value.includes("\r\n") ? "CRLF" : "LF";
}

export function detectEncoding(buffer: Buffer): BufferEncoding {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return "utf16le";
  }

  return "utf8";
}

/**
 * Hard cap on single-file reads (deep review 2026-08-15, B4): the read tool
 * applies offset/limit AFTER loading, so without this a multi-GB file would
 * be fully materialized in memory (and images base64-expanded further).
 */
export const MAX_READ_FILE_BYTES = 128 * 1024 * 1024;

export function readTextFileWithMetadata(filePath: string): FileReadMetadata {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_READ_FILE_BYTES) {
    throw new Error(
      `File is too large to read (${(stat.size / 1024 / 1024).toFixed(1)}MB, cap ${MAX_READ_FILE_BYTES / 1024 / 1024}MB)`
    );
  }
  const buffer = fs.readFileSync(filePath);
  const encoding = detectEncoding(buffer);
  const raw = buffer.toString(encoding);

  return {
    content: normalizeContent(raw),
    encoding,
    lineEndings: detectLineEndings(raw),
    timestamp: Math.floor(stat.mtimeMs),
  };
}

export function writeTextFile(
  filePath: string,
  content: string,
  encoding: BufferEncoding,
  lineEndings: FileLineEnding
): number {
  const normalized = normalizeContent(content);
  const toWrite = lineEndings === "CRLF" ? normalized.replace(/\n/g, "\r\n") : normalized;
  fs.writeFileSync(filePath, toWrite, { encoding });
  return Buffer.byteLength(toWrite, encoding === "utf16le" ? "utf16le" : "utf8");
}

export function ensureParentDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function hasFileChangedSinceState(filePath: string, state: FileState): boolean {
  const current = readTextFileWithMetadata(filePath);
  // Timestamp strictly increased → definitely changed (fast path, no content
  // comparison). This is the common case and has zero extra cost.
  if (current.timestamp > state.timestamp) {
    const isFullRead =
      !state.isPartialView && typeof state.offset === "undefined" && typeof state.limit === "undefined";
    return !(isFullRead && current.content === state.content);
  }

  // Timestamp did not advance (same ms, rolled back, or low-resolution FS).
  // Previously this returned false unconditionally, silently dropping external
  // edits that didn't bump the mtime. Fall back to a content comparison when we
  // have the full prior content; otherwise treat as changed (safer).
  const isFullRead = !state.isPartialView && typeof state.offset === "undefined" && typeof state.limit === "undefined";
  if (isFullRead) {
    return current.content !== state.content;
  }
  // Partial view — can't compare content reliably, and timestamp didn't move,
  // so conservatively report unchanged to avoid false-positive edit/write loops.
  return false;
}

export function buildDiffPreview(
  filePath: string,
  originalContent: string | null,
  updatedContent: string,
  maxLines = 40
): string | null {
  const original = originalContent === null ? null : normalizeContent(originalContent);
  const updated = normalizeContent(updatedContent);

  if (original !== null && original === updated) {
    return null;
  }

  const oldLines = toDiffLines(original);
  const newLines = toDiffLines(updated);

  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldChanged = oldLines.slice(prefix, oldLines.length - suffix);
  const newChanged = newLines.slice(prefix, newLines.length - suffix);
  const oldStart = original === null ? 0 : prefix + 1;
  const newStart = prefix + 1;

  const previewLines = [
    `--- ${original === null ? "/dev/null" : `a/${filePath}`}`,
    `+++ b/${filePath}`,
    `@@ -${oldStart},${oldChanged.length} +${newStart},${newChanged.length} @@`,
  ];

  if (prefix > 0) {
    previewLines.push(` ${oldLines[prefix - 1]}`);
  }

  for (const line of oldChanged) {
    previewLines.push(`-${line}`);
  }

  for (const line of newChanged) {
    previewLines.push(`+${line}`);
  }

  if (suffix > 0) {
    previewLines.push(` ${oldLines[oldLines.length - suffix]}`);
  }

  if (previewLines.length > maxLines) {
    return `${previewLines.slice(0, maxLines).join("\n")}\n...`;
  }

  return previewLines.join("\n");
}

function toDiffLines(content: string | null): string[] {
  if (!content) {
    return [];
  }

  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}
