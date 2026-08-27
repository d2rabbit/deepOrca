// Portions Copyright (c) 2026 lessweb — engine code adapted from Deep Code
// (deepcode-cli, MIT); see the repository NOTICE for the preserved MIT grant.
import * as fs from "fs";
import * as path from "path";
import ignore from "ignore";
import type { ToolExecutionContext, ToolExecutionFollowUpMessage, ToolExecutionResult } from "./executor";
import { readTextFileWithMetadata, MAX_READ_FILE_BYTES, detectEncoding } from "../common/file-utils";
import { StringDecoder } from "node:string_decoder";
import { gateRead } from "../common/path-boundary";
import {
  createFullFileSnippet,
  createSnippet,
  isAbsoluteFilePath,
  markFileRead,
  normalizeFilePath,
} from "../common/state";

const DEFAULT_LINE_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const LINE_NUMBER_WIDTH = 6;

/** Above this size, an offset/limit read switches to the streamed slice path. */
const STREAM_SLICE_THRESHOLD_BYTES = 2 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 512 * 1024;

/**
 * Single-pass streamed equivalent of the full readTextFile for paged views:
 * walks the file in fixed-size chunks, decodes incrementally (multi-byte-safe
 * via StringDecoder), and keeps only lines inside [startLine0, startLine0 +
 * limit) while still counting totalLines — the semantics of
 * `fullRaw.split("\n")` (elements = newline count + 1, including a trailing
 * empty element) are preserved exactly. CRLF pairs are normalized per line
 * and reported as lineEndings "CRLF", matching normalizeContent/detect-
 * LineEndings on the legacy path.
 * Content lines are kept full; only the rendered output truncates
 * (same split of concerns as the legacy path).
 */
function streamSliceTextFile(filePath: string, startLine0: number, limit: number, st: fs.Stats): TextReadResult {
  const fd = fs.openSync(filePath, "r");
  try {
    // BOM sniff mirrors file-utils detectEncoding (utf16le BOM → utf16le,
    // else utf8) but reads only the first two bytes of the already-open fd.
    const probe = Buffer.alloc(2);
    const probed = fs.readSync(fd, probe, 0, 2, 0);
    const encoding = detectEncoding(probe.subarray(0, probed));
    const decoder = new StringDecoder(encoding === "utf16le" ? "utf16le" : "utf8");
    const chunk = Buffer.alloc(STREAM_CHUNK_BYTES);
    let carry = ""; // current line's decoded prefix, spanning chunk boundaries
    let newlines = 0; // committed line terminators over the whole raw stream
    let sawCrlf = false;
    const selected: string[] = [];
    /** Handle one newline-terminated segment: normalize CRLF, count it. */
    const emitLine = (segment: string): void => {
      let line = segment;
      if (line.endsWith("\r")) {
        sawCrlf = true;
        line = line.slice(0, -1);
      }
      collectIfSelected(selected, line, newlines, startLine0, limit);
      newlines += 1;
    };
    let position = 0;
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, chunk, 0, STREAM_CHUNK_BYTES, position)) > 0) {
      position += bytesRead;
      const text = carry + decoder.write(chunk.subarray(0, bytesRead));
      carry = "";
      let searchFrom = 0;
      for (;;) {
        const nl = text.indexOf("\n", searchFrom);
        if (nl === -1) {
          carry = text.slice(searchFrom);
          break;
        }
        emitLine(text.slice(searchFrom, nl));
        searchFrom = nl + 1;
      }
    }
    // EOF: decoder remainder may complete `carry`; whatever remains is the
    // final split element — emitted at index `newlines` exactly when
    // raw.split("\n") would have it as element #newlines+1 with no trailing
    // \n. A file ending in "\n" leaves carry === "" and adds nothing, which
    // is also correct: that phantom trailing "" element exists purely via
    // totalLines = newlines + 1.
    carry += decoder.end();
    let finalLine = carry;
    if (finalLine.endsWith("\r")) {
      sawCrlf = true;
      finalLine = finalLine.slice(0, -1);
    }
    collectIfSelected(selected, finalLine, newlines, startLine0, limit);
    return buildStreamedResult(
      selected,
      newlines,
      startLine0,
      st,
      encoding === "utf16le" ? "utf16le" : "utf8",
      sawCrlf ? "CRLF" : "LF"
    );
  } finally {
    fs.closeSync(fd);
  }
}

/** Push a line into the selection window when its global index qualifies. */
function collectIfSelected(out: string[], line: string, index: number, startLine0: number, limit: number): void {
  // Lines are stored FULL — `content` feeds markFileRead's file state and
  // must match disk byte-for-byte (a truncated copy false-positives the
  // "modified since read" guard). Only `output` truncates, in
  // formatWithLineNumbers, exactly like the full-read path.
  if (index >= startLine0 && index < startLine0 + limit) {
    out.push(line);
  }
}

function buildStreamedResult(
  selected: string[],
  newlines: number,
  startLine0: number,
  st: fs.Stats,
  encoding: BufferEncoding,
  lineEndings: "LF" | "CRLF"
): TextReadResult {
  const totalLines = newlines + 1;
  const startLine = startLine0 + 1;
  const endLine = selected.length > 0 ? startLine0 + selected.length : startLine;
  return {
    content: selected.join("\n"),
    output: formatWithLineNumbers(selected, startLine),
    startLine,
    endLine,
    totalLines,
    isPartialView: startLine !== 1 || endLine < totalLines,
    encoding,
    lineEndings,
    timestamp: Math.floor(st.mtimeMs),
  };
}
const DEFAULT_GITIGNORE = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  "out/",
  ".next/",
  ".nuxt/",
  ".venv/",
  "venv/",
  "__pycache__/",
  "*.pyc",
  "*.pyo",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
  ".gradle/",
  ".idea/",
  ".vscode/",
  "*.class",
  "*.jar",
  "*.war",
  "target/",
];

type TextReadResult = {
  content: string;
  output: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  isPartialView: boolean;
  encoding: BufferEncoding;
  lineEndings: "LF" | "CRLF";
  timestamp: number;
};

export async function handleReadTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  let filePath = typeof args.file_path === "string" ? normalizeFilePath(args.file_path) : "";
  if (!filePath.trim()) {
    return {
      ok: false,
      name: "read",
      error: 'Missing required "file_path" string.',
    };
  }

  if (!isAbsoluteFilePath(filePath)) {
    if (filePath.startsWith("../") || filePath.startsWith("..\\")) {
      return {
        ok: false,
        name: "read",
        error: "file_path must be an absolute path.",
      };
    }
    // Fast path first: a relative path that resolves directly against the
    // project root (the overwhelmingly common case, e.g. "src/foo.ts") needs
    // NO ambiguity scan. findSuffixMatches BFS-walks the whole tree
    // synchronously — seconds on large monorepos — so paying that cost even
    // when the direct hit exists was pure latency on the model's hot loop.
    const resolvedPath = path.resolve(context.projectRoot, filePath);
    if (fs.existsSync(resolvedPath)) {
      filePath = resolvedPath;
    } else {
      const normalizedSuffix = normalizeRelativeSuffix(filePath);
      const isIgnored = loadGitignoreMatcher(context.projectRoot);
      const matches = normalizedSuffix ? findSuffixMatches(context.projectRoot, normalizedSuffix, isIgnored) : [];
      if (matches.length > 1) {
        return {
          ok: false,
          name: "read",
          error:
            "file_path must be an absolute path. " +
            `The file_path is ambiguous and may refer to multiple files:\n${matches.slice(0, 3).join("\n")}` +
            (matches.length > 3 ? `\n...and ${matches.length - 3} more.` : ""),
        };
      }
      if (!fs.existsSync(resolvedPath)) {
        if (matches.length > 0) {
          return {
            ok: false,
            name: "read",
            error: "file_path must be an absolute path. " + `The file_path "${filePath}" is ambiguous.`,
          };
        }
        return {
          ok: false,
          name: "read",
          error: `File not found: ${filePath}`,
        };
      }
      filePath = resolvedPath;
    }
  }

  // Execution-time read boundary (P0, specs/sandbox/design.md §4.1): single
  // gate once the final absolute path is known, before the first fs touch.
  // Every downstream branch (text/notebook/pdf/image) shares this filePath,
  // so one checkpoint covers them all (R5).
  const gate = gateRead(context.pathGrant, filePath, context.projectRoot);
  context.onPathGateVerdict?.({ tool: "read", verdict: gate, filePath });
  if (!gate.ok) {
    return {
      ok: false,
      name: "read",
      error: gate.reason,
      errorType: "PERMISSION_DENIED",
      retryable: false,
    };
  }

  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      name: "read",
      error: `File not found: ${filePath}`,
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "read",
      error: `Failed to stat file: ${message}`,
    };
  }

  if (stat.isDirectory()) {
    return {
      ok: false,
      name: "read",
      error: "file_path points to a directory. Use bash ls for directories.",
    };
  }

  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === ".ipynb") {
      const output = readNotebook(filePath);
      markFileRead(context.sessionId, filePath, {
        content: "",
        timestamp: Math.floor(stat.mtimeMs),
        isPartialView: true,
      });
      return {
        ok: true,
        name: "read",
        output,
      };
    }

    if (ext === ".pdf") {
      if (stat.size > MAX_READ_FILE_BYTES) {
        return {
          ok: false,
          name: "read",
          error: `File is too large to read (${(stat.size / 1024 / 1024).toFixed(1)}MB, cap ${MAX_READ_FILE_BYTES / 1024 / 1024}MB)`,
        };
      }
      const buffer = fs.readFileSync(filePath);
      const pageCount = countPdfPages(buffer);
      markFileRead(context.sessionId, filePath, {
        content: "",
        timestamp: Math.floor(stat.mtimeMs),
        isPartialView: true,
      });
      return {
        ok: true,
        name: "read",
        output: "WARNING: File is binary.",
        metadata: {
          mime: "application/pdf",
          encoding: "base64",
          bytes: buffer.length,
          pageCount,
        },
      };
    }

    if (isImageExtension(ext)) {
      if (stat.size > MAX_READ_FILE_BYTES) {
        return {
          ok: false,
          name: "read",
          error: `File is too large to read (${(stat.size / 1024 / 1024).toFixed(1)}MB, cap ${MAX_READ_FILE_BYTES / 1024 / 1024}MB)`,
        };
      }
      const buffer = fs.readFileSync(filePath);
      const mime = getImageMimeType(ext);
      markFileRead(context.sessionId, filePath, {
        content: "",
        timestamp: Math.floor(stat.mtimeMs),
        isPartialView: true,
      });
      return {
        ok: true,
        name: "read",
        output: "File loaded.",
        metadata: {
          mime,
          bytes: buffer.length,
        },
        followUpMessages: [buildImageFollowUpMessage(filePath, mime, buffer)],
      };
    }

    const offset = parseLineNumber(args.offset, "offset");
    const limit = parseLineLimit(args.limit);
    if (!offset.ok) {
      return {
        ok: false,
        name: "read",
        error: offset.error,
      };
    }
    if (!limit.ok) {
      return {
        ok: false,
        name: "read",
        error: limit.error,
      };
    }

    const textResult = readTextFile(filePath, offset.value, limit.value);
    markFileRead(context.sessionId, filePath, {
      content: textResult.content,
      timestamp: textResult.timestamp,
      offset: textResult.isPartialView ? textResult.startLine : undefined,
      limit: textResult.isPartialView ? Math.max(1, textResult.endLine - textResult.startLine + 1) : undefined,
      isPartialView: textResult.isPartialView,
      encoding: textResult.encoding,
      lineEndings: textResult.lineEndings,
    });
    const snippet = textResult.isPartialView
      ? createSnippet(context.sessionId, filePath, textResult.startLine, textResult.endLine, textResult.output)
      : createFullFileSnippet(context.sessionId, filePath, textResult.startLine, textResult.endLine, textResult.output);
    return {
      ok: true,
      name: "read",
      output: textResult.output,
      metadata: snippet
        ? {
            snippet: {
              id: snippet.id,
              filePath: snippet.filePath,
              startLine: snippet.startLine,
              endLine: snippet.endLine,
            },
          }
        : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "read",
      error: message,
    };
  }
}

function normalizeRelativeSuffix(relativePath: string): string | null {
  const normalized = path.normalize(relativePath).replace(/^(\.\/|\\)+/, "");
  return normalized.trim() ? path.sep + normalized : null;
}

function findSuffixMatches(
  root: string,
  suffix: string,
  isIgnored: ((relPath: string, isDir: boolean) => boolean) | null
): string[] {
  const matches: string[] = [];
  const queue: string[] = [root];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = path.relative(root, fullPath).replace(/\\/g, "/");
      if (isIgnored && isIgnored(relPath, entry.isDirectory())) {
        continue;
      }
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && fullPath.endsWith(suffix)) {
        matches.push(fullPath);
      }
    }
  }

  return matches;
}

function loadGitignoreMatcher(projectRoot: string): ((relPath: string, isDir: boolean) => boolean) | null {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    const ig = ignore();
    ig.add(DEFAULT_GITIGNORE);
    return (relPath: string, isDir: boolean) => {
      if (!relPath) {
        return false;
      }
      const candidate = isDir ? `${relPath}/` : relPath;
      return ig.ignores(candidate);
    };
  }

  let content = "";
  try {
    content = fs.readFileSync(gitignorePath, "utf8");
  } catch {
    const ig = ignore();
    ig.add(DEFAULT_GITIGNORE);
    return (relPath: string, isDir: boolean) => {
      if (!relPath) {
        return false;
      }
      const candidate = isDir ? `${relPath}/` : relPath;
      return ig.ignores(candidate);
    };
  }

  const ig = ignore();
  ig.add(DEFAULT_GITIGNORE);
  ig.add(content);
  return (relPath: string, isDir: boolean) => {
    if (!relPath) {
      return false;
    }
    const candidate = isDir ? `${relPath}/` : relPath;
    return ig.ignores(candidate);
  };
}

function parseLineNumber(
  value: unknown,
  label: string
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return { ok: false, error: `${label} must be a number.` };
  }
  const integer = Math.trunc(numeric);
  if (integer < 1) {
    return { ok: false, error: `${label} must be >= 1.` };
  }
  return { ok: true, value: integer };
}

function parseLineLimit(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: DEFAULT_LINE_LIMIT };
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return { ok: false, error: "limit must be a number." };
  }
  const integer = Math.trunc(numeric);
  if (integer <= 0) {
    return { ok: false, error: "limit must be > 0." };
  }
  return { ok: true, value: integer };
}

function readTextFile(filePath: string, offset: number | null, limit: number): TextReadResult {
  // Paged reads over big files skip the whole-file materialization below
  // (buffer + full string + full line array = three copies just to throw
  // most of them away) in favour of a single-pass streamed slice.
  if (offset !== null) {
    const st = fs.statSync(filePath);
    if (st.isFile() && st.size > STREAM_SLICE_THRESHOLD_BYTES) {
      return streamSliceTextFile(filePath, offset - 1, limit, st);
    }
  }
  const metadata = readTextFileWithMetadata(filePath);
  const raw = metadata.content;
  if (!raw) {
    return {
      content: "",
      output: "WARNING: File is empty.",
      startLine: offset ?? 1,
      endLine: offset ?? 1,
      totalLines: 0,
      isPartialView: false,
      encoding: metadata.encoding,
      lineEndings: metadata.lineEndings,
      timestamp: metadata.timestamp,
    };
  }

  const lines = raw.split("\n");
  if (lines.length === 1 && lines[0] === "") {
    return {
      content: "",
      output: "WARNING: File is empty.",
      startLine: offset ?? 1,
      endLine: offset ?? 1,
      totalLines: 0,
      isPartialView: false,
      encoding: metadata.encoding,
      lineEndings: metadata.lineEndings,
      timestamp: metadata.timestamp,
    };
  }

  const startIndex = offset ? offset - 1 : 0;
  const endIndex = startIndex + limit;
  const selected = lines.slice(startIndex, endIndex);
  const startLine = startIndex + 1;
  const endLine = selected.length > 0 ? startIndex + selected.length : startLine;
  const isPartialView = startLine !== 1 || endLine < lines.length;
  return {
    content: selected.join("\n"),
    output: formatWithLineNumbers(selected, startLine),
    startLine,
    endLine,
    totalLines: lines.length,
    isPartialView,
    encoding: metadata.encoding,
    lineEndings: metadata.lineEndings,
    timestamp: metadata.timestamp,
  };
}

function formatWithLineNumbers(lines: string[], startLineNumber: number): string {
  return lines
    .map((line, index) => {
      const lineNumber = startLineNumber + index;
      const trimmedLine = line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line;
      return `${String(lineNumber).padStart(LINE_NUMBER_WIDTH, " ")}\t${trimmedLine}`;
    })
    .join("\n");
}

function isImageExtension(ext: string): boolean {
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".svg", ".ico", ".avif"].includes(ext);
}

function getImageMimeType(ext: string): string {
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".avif":
      return "image/avif";
    case ".png":
    default:
      return "image/png";
  }
}

function buildImageFollowUpMessage(filePath: string, mime: string, buffer: Buffer): ToolExecutionFollowUpMessage {
  const fileName = path.basename(filePath);
  return {
    role: "system",
    content:
      `The read tool has loaded \`${fileName}\`. ` + "Use the attached image content to answer the original request.",
    contentParams: [
      {
        type: "image_url",
        image_url: {
          url: `data:${mime};base64,${buffer.toString("base64")}`,
        },
      },
    ],
  };
}

function countPdfPages(buffer: Buffer): number | null {
  try {
    const content = buffer.toString("latin1");
    const matches = content.match(/\/Type\s*\/Page\b(?!s)/g);
    return matches ? matches.length : 0;
  } catch {
    return null;
  }
}

function readNotebook(filePath: string): string {
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw) {
    return "WARNING: File is empty.";
  }

  const parsed = JSON.parse(raw) as {
    cells?: Array<{
      cell_type?: string;
      source?: string[] | string;
      outputs?: Array<Record<string, unknown>>;
    }>;
  };

  const lines: string[] = [];
  const cells = Array.isArray(parsed.cells) ? parsed.cells : [];
  cells.forEach((cell, index) => {
    const cellType = cell.cell_type ?? "unknown";
    lines.push(`# Cell ${index + 1} (${cellType})`);

    const source = normalizeNotebookField(cell.source);
    if (source.length > 0) {
      lines.push(...source);
    }

    const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
    outputs.forEach((output, outputIndex) => {
      const outputType = typeof output.output_type === "string" ? output.output_type : "output";
      lines.push(`# Output ${outputIndex + 1} (${outputType})`);
      lines.push(...formatNotebookOutput(output));
    });
  });

  if (lines.length === 0) {
    return "WARNING: Notebook has no cells.";
  }

  return formatWithLineNumbers(lines, 1);
}

function normalizeNotebookField(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).replace(/\r?\n$/, ""));
  }
  if (typeof value === "string") {
    return value.split(/\r?\n/);
  }
  return [];
}

function formatNotebookOutput(output: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const text = output.text;
  if (Array.isArray(text)) {
    lines.push(...text.map((item) => String(item).replace(/\r?\n$/, "")));
  } else if (typeof text === "string") {
    lines.push(...text.split(/\r?\n/));
  }

  const data = output.data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const textPlain = record["text/plain"];
    if (Array.isArray(textPlain)) {
      lines.push(...textPlain.map((item) => String(item).replace(/\r?\n$/, "")));
    } else if (typeof textPlain === "string") {
      lines.push(...textPlain.split(/\r?\n/));
    }

    const imagePng = record["image/png"];
    if (typeof imagePng === "string") {
      lines.push(`[image/png ${imagePng.length} chars]`);
    }

    const imageJpeg = record["image/jpeg"];
    if (typeof imageJpeg === "string") {
      lines.push(`[image/jpeg ${imageJpeg.length} chars]`);
    }
  }

  const trace = output.traceback;
  if (Array.isArray(trace)) {
    lines.push(...trace.map((item) => String(item).replace(/\r?\n$/, "")));
  }

  if (lines.length === 0) {
    lines.push("[output omitted]");
  }

  return lines;
}
