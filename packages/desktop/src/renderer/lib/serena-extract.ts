/**
 * Serena result extraction (specs/index-knowledge-rework R3-6).
 *
 * Serena MCP tools answer with semi-structured text that mixes XML-ish
 * location markers (`<file>…</file>`, `<line>…</line>`, `<body>…</body>`)
 * with human-readable formatting. These parsers turn a tool result into a
 * structured VIEW model for the right-side Serena panel — targeted per
 * tool BEHAVIOR (symbol lookup → code panel, overview → tree, references →
 * grouped list, pattern search → match list).
 *
 * Pure display-layer: the raw tool result still reaches the agent verbatim;
 * nothing here feeds back into MCP or the conversation content.
 */

import type { SessionMessage } from "@deeporca/core";

export type SerenaSymbol = {
  name: string;
  kind?: string;
  filePath?: string;
  line?: number;
  body?: string;
};

export type SerenaOverviewFile = {
  filePath: string;
  symbols: Array<{ name: string; kind?: string; line?: number }>;
};

export type SerenaReference = {
  filePath: string;
  line?: number;
  snippet?: string;
  column?: number;
};

export type SerenaMatch = {
  filePath: string;
  line?: number;
  snippet: string;
};

export type SerenaView =
  | { kind: "symbols"; title: string; symbols: SerenaSymbol[] }
  | { kind: "overview"; title: string; files: SerenaOverviewFile[] }
  | { kind: "references"; title: string; references: SerenaReference[] }
  | { kind: "matches"; title: string; matches: SerenaMatch[] }
  | { kind: "raw"; title: string; text: string };

export type SerenaEvent = {
  /** Stable id (message id) for "new event" detection. */
  id: string;
  /** Short tool name (after the mcp__serena__ namespace). */
  tool: string;
  ok: boolean;
  output: string;
  view: SerenaView;
};

const FILE_TAG = /<file>([^<]+)<\/file>/g;
const LINE_TAG = /<line>(\d+)<\/line>/g;
const COL_TAG = /<col>(\d+)<\/col>/g;
const BODY_TAG = /<body>([\s\S]*?)<\/body>/g;
const SYMBOL_HEADER =
  /(?:^|\n)\s*(?:=+\s*\[\d+\/\d+\]\s*)?([A-Za-z_$][\w$]*)\s*(?:•|·|\()\s*([a-z_ ]+)\)?\s*(?:=+)?(?:\n|$)/g;
/** Generic `path/file.ext:line` location fallback for plain-text outputs. */
const PATH_LINE = /([\w./\\-]+\.[A-Za-z]{1,5}):(\d+)/g;

/** First capture group of the FIRST match. Clones the regex without the
 * global flag — String.match on a /g regex returns full-match strings with
 * no capture groups, which silently broke every tagged-field read. */
function firstMatch(re: RegExp, text: string): string | undefined {
  const clone = new RegExp(re.source, re.flags.replace("g", ""));
  const m = text.match(clone);
  return m?.[1]?.trim() || undefined;
}

/** Numeric <line> tag value of the first match, if present. */
function lineOf(text: string): number | undefined {
  const v = firstMatch(LINE_TAG, text);
  return v ? Number(v) : undefined;
}

/** Short tool name from the fully-qualified MCP name (`mcp__serena__find_symbol`). */
export function serenaShortTool(name: string): string {
  const idx = name.lastIndexOf("__");
  return idx >= 0 ? name.slice(idx + 2) : name;
}

/** Parse one symbol block (serena marks location with file/line/body tags). */
function parseSymbolBlock(text: string, fallbackName: string): SerenaSymbol {
  return {
    name: fallbackName || firstMatch(/(?:^|\n)\s*([A-Za-z_$][\w$]*)/, text) || "(symbol)",
    kind: firstMatch(/\(([a-z_ ]+)\)/, text),
    filePath: firstMatch(FILE_TAG, text),
    line: lineOf(text),
    body: text.match(new RegExp(BODY_TAG.source))?.[1]?.slice(1, -1),
  };
}

/** find_symbol — N symbol blocks separated by `====` headers with the name. */
function extractSymbols(output: string): SerenaSymbol[] {
  const blocks = output.split(/=+\s*\[\d+\/\d+\]\s*[^=]*=+/).filter((b) => b.trim());
  if (blocks.length > 0 && /<file>|<body>/.test(output)) {
    return blocks.map((b) => parseSymbolBlock(b, firstMatch(SYMBOL_HEADER, b) ?? ""));
  }
  // Tolerant fallback: sequential file/line/body tag triplets without headers.
  const syms: SerenaSymbol[] = [];
  const files = [...output.matchAll(FILE_TAG)];
  const lines = [...output.matchAll(LINE_TAG)];
  const bodies = [...output.matchAll(BODY_TAG)];
  if (files.length > 0) {
    files.forEach((f, i) => {
      syms.push({
        name: firstMatch(/([A-Za-z_$][\w$]*)/, bodies[i]?.[1] ?? "") ?? `(block ${i + 1})`,
        filePath: f[1]?.trim(),
        line: lines[i] ? Number(lines[i][1]) : undefined,
        body: bodies[i]?.[1]?.slice(1, -1),
      });
    });
    return syms;
  }
  return [];
}

/** get_symbols_overview — per-file sections with symbol bullet lists. */
function extractOverview(output: string): SerenaOverviewFile[] {
  const files: SerenaOverviewFile[] = [];
  // Sections start with a path on its own line (ending in .ts/.tsx/…).
  const sections = output.split(/(?=^[\w./\\-]+\.[A-Za-z]{1,5}\s*$)/m);
  for (const section of sections) {
    const filePath = firstMatch(/^([\w./\\-]+\.[A-Za-z]{1,5})\s*$/m, section);
    if (!filePath) continue;
    const symbols: SerenaOverviewFile["symbols"] = [];
    // Skip line 0 (the file path itself) — path words must not leak into the
    // symbol list. Anchored per-line parse rejects prose lines.
    for (const line of section.split("\n").slice(1)) {
      const m = line.match(/^\s*[-•*]?\s*([A-Za-z_$][\w$]*)\s*(?:[(•·]\s*([a-z_]+)\s*[)•·])?\s*(?::\s*(\d+))?\s*$/);
      if (!m) continue;
      const name = m[1];
      if (!name || RESERVED_WORDS.has(name)) continue;
      if (symbols.some((x) => x.name === name)) continue;
      symbols.push({ name, kind: m[2], line: m[3] ? Number(m[3]) : undefined });
    }
    if (symbols.length > 0) files.push({ filePath, symbols: symbols.slice(0, 120) });
  }
  return files;
}

/** Words that appear in serena's formatting but are never symbol names. */
const RESERVED_WORDS = new Set([
  "function",
  "method",
  "class",
  "interface",
  "variable",
  "constant",
  "property",
  "the",
  "and",
  "for",
]);

/** find_referencing_symbols / get_references_overview — location-tagged refs. */
function extractReferences(output: string): SerenaReference[] {
  const refs: SerenaReference[] = [];
  const fileMatches = [...output.matchAll(FILE_TAG)];
  const lineMatches = [...output.matchAll(LINE_TAG)];
  const colMatches = [...output.matchAll(COL_TAG)];
  if (fileMatches.length > 0) {
    fileMatches.forEach((f, i) => {
      refs.push({
        filePath: f[1].trim(),
        line: lineMatches[i] ? Number(lineMatches[i][1]) : undefined,
        column: colMatches[i] ? Number(colMatches[i][1]) : undefined,
      });
    });
    return refs;
  }
  for (const m of output.matchAll(PATH_LINE)) {
    refs.push({ filePath: m[1], line: Number(m[2]) });
  }
  return refs;
}

/** search_for_pattern — match blocks with `path:line` headers + excerpts. */
function extractMatches(output: string): SerenaMatch[] {
  const out: SerenaMatch[] = [];
  const blocks = output.split(/(?=^[\w./\\-]+\.[A-Za-z]{1,5}:\d+)/m);
  for (const block of blocks) {
    const head = block.match(PATH_LINE);
    if (!head) continue;
    const snippet = block.split("\n").slice(1).join("\n").trim().slice(0, 400);
    out.push({ filePath: head[1], line: Number(head[2]), snippet });
  }
  if (out.length > 0) return out;
  const fallback: SerenaMatch[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(PATH_LINE);
    if (m) fallback.push({ filePath: m[1], line: Number(m[2]), snippet: line.trim().slice(0, 300) });
  }
  return fallback;
}

/** Build the targeted view for a serena tool result. */
export function extractSerenaView(tool: string, output: string): SerenaView {
  const title = tool;
  switch (tool) {
    case "find_symbol": {
      const symbols = extractSymbols(output);
      return symbols.length > 0 ? { kind: "symbols", title, symbols } : { kind: "raw", title, text: output };
    }
    case "get_symbols_overview": {
      const files = extractOverview(output);
      return files.length > 0 ? { kind: "overview", title, files } : { kind: "raw", title, text: output };
    }
    case "find_referencing_symbols":
    case "get_references_overview": {
      const references = extractReferences(output);
      return references.length > 0 ? { kind: "references", title, references } : { kind: "raw", title, text: output };
    }
    case "search_for_pattern": {
      const matches = extractMatches(output);
      return matches.length > 0 ? { kind: "matches", title, matches } : { kind: "raw", title, text: output };
    }
    default:
      return { kind: "raw", title, text: output };
  }
}

/** Scan the conversation's tool messages for serena results (newest last). */
export function scanSerenaEvents(messages: SessionMessage[]): SerenaEvent[] {
  const events: SerenaEvent[] = [];
  for (const message of messages) {
    if (message.role !== "tool" || typeof message.content !== "string") continue;
    let name = "";
    try {
      const parsed = JSON.parse(message.content) as { name?: unknown; ok?: unknown; output?: unknown };
      name = typeof parsed.name === "string" ? parsed.name : "";
      if (!name) {
        const metaFn = message.meta?.function as { name?: unknown } | undefined;
        name = typeof metaFn?.name === "string" ? metaFn.name : "";
      }
      if (!name.startsWith("mcp__serena__")) continue;
      const output = typeof parsed.output === "string" ? parsed.output : "";
      if (!output.trim()) continue;
      const tool = serenaShortTool(name);
      events.push({
        id: message.id || `${message.createTime ?? ""}-${events.length}`,
        tool,
        ok: parsed.ok !== false,
        output,
        view: extractSerenaView(tool, output),
      });
    } catch {
      // non-JSON tool content — not a serena structured result
    }
  }
  return events.slice(-12);
}
