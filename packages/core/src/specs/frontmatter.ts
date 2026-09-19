/**
 * Spec frontmatter parsing (specs/spec-graph-adoption §1.1).
 *
 * The spec domain is `<workspaceRoot>/.deeporca/specs/`; every spec node is a
 * markdown file whose LEADING `---` fenced YAML block carries the machine-read
 * fields. This parser deliberately implements a tiny YAML subset — scalars and
 * block/inline string lists — because the schema is closed and small
 * (id/type/status/parent/depends-on/covers/tags/artifacts). A full YAML
 * engine would be a new exact-pin dependency for zero schema benefit.
 *
 * Tolerance contract (design §1.2): a missing block or an unparseable block
 * degrades to `null` — the caller treats the file as loose prose, never a
 * hard failure. Bad values inside a valid block degrade per-key (a scalar
 * key carrying a list yields its joined string; unknown keys are kept as-is).
 */

export type SpecFrontmatterValue = string | string[];

export type SpecFrontmatter = Record<string, SpecFrontmatterValue>;

/** Known scalar keys; every other key parses the same way but is not schema-checked. */
const LIST_KEYS = new Set(["depends-on", "covers", "tags", "artifacts"]);

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.at(-1) === trimmed[0]) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** `[a, b]` → ["a","b"]; plain scalar → [scalar]; empty → []. */
function parseInlineList(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const body = trimmed.slice(1, -1).trim();
    if (!body) return [];
    return body
      .split(",")
      .map(stripQuotes)
      .filter((item) => item.length > 0);
  }
  return trimmed ? [stripQuotes(trimmed)] : [];
}

/**
 * Extract and parse the leading frontmatter block. Returns null when the
 * document has no frontmatter or the block is malformed (unclosed fence).
 */
export function parseFrontmatter(text: string): SpecFrontmatter | null {
  if (!text.startsWith("---")) return null;
  const firstLineEnd = text.indexOf("\n");
  if (firstLineEnd === -1 || text.slice(0, firstLineEnd).trim() !== "---") return null;
  const closeFence = text.indexOf("\n---", firstLineEnd);
  if (closeFence === -1) return null;
  // The closing fence must be its own line (optionally followed by \n or EOF).
  const afterFence = text.slice(closeFence + 4);
  if (afterFence && !afterFence.startsWith("\n")) return null;

  const block = text.slice(firstLineEnd + 1, closeFence);
  const data: SpecFrontmatter = {};
  let currentListKey: string | null = null;
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const listItem = line.trimStart().startsWith("- ") ? line.trimStart().slice(2) : null;
    if (listItem !== null && currentListKey) {
      const item = stripQuotes(listItem);
      if (item) {
        const existing = data[currentListKey];
        data[currentListKey] = Array.isArray(existing) ? [...existing, item] : [item];
      }
      continue;
    }
    currentListKey = null;
    const colon = line.indexOf(":");
    if (colon <= 0) return null; // malformed line → whole block degrades
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1);
    if (!key) return null;
    if (value.trim() === "") {
      if (LIST_KEYS.has(key)) {
        data[key] = [];
        currentListKey = key;
      } else {
        data[key] = "";
      }
      continue;
    }
    if (LIST_KEYS.has(key)) {
      // `key: a` is a one-element list; `key: [a, b]` parses inline.
      data[key] = value.trim().startsWith("[") ? parseInlineList(value) : [stripQuotes(value)];
    } else {
      data[key] = stripQuotes(value);
    }
  }
  return data;
}

/** First `# ` heading of the markdown body, for display; falls back to the file name. */
export function firstHeading(text: string): string | null {
  const body = text.startsWith("---") ? text.slice(text.indexOf("\n---", 3) + 4) : text;
  const match = body.match(/^#{1,2} (.+)$/m);
  return match ? match[1].trim() : null;
}
