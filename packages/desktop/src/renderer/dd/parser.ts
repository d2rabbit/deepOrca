/**
 * OrcaDesign (.dd) format parser.
 *
 * A .dd file has two parts:
 * 1. YAML front-matter (between `---` delimiters) — metadata, tokens, section manifest
 * 2. HTML body — section content wrapped in `<!-- dd:section xxx -->` markers
 *
 * This parser splits the file and extracts structured data without a full YAML
 * dependency — it reads the flat key-value structure that DeepDesign produces.
 */

/** Design tokens (maps to CSS `:root` custom properties). */
export interface DdTokens {
  [key: string]: string;
}

/** Section manifest entry from the YAML front-matter. */
export interface DdSectionMeta {
  id: string;
  type: string;
}

/** Parsed metadata from the YAML front-matter. */
export interface DdMeta {
  name: string;
  system: string;
  style: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  tokens: DdTokens;
  sections: DdSectionMeta[];
  /** Any extra YAML keys not in the standard schema. */
  extra: Record<string, string>;
}

/** A section extracted from the HTML body. */
export interface DdSection {
  id: string;
  /** Raw HTML content between the section markers. */
  html: string;
}

/** Result of parsing a .dd file. */
export interface DdDocument {
  meta: DdMeta;
  sections: DdSection[];
  /** The full HTML body (all sections concatenated, markers stripped). */
  body: string;
  /** True if the front-matter was present and parseable. */
  hasFrontMatter: boolean;
}

/**
 * Parse a .dd file content into structured data.
 * Does NOT use a YAML library — reads the flat key-value + nested tokens/sections
 * structure that DeepDesign produces. For arbitrary YAML, use a proper parser.
 */
export function parseDdFile(content: string): DdDocument {
  const { yaml, body, hasFrontMatter } = splitFrontMatter(content);
  const meta = hasFrontMatter ? parseYamlFrontMatter(yaml) : createEmptyMeta();
  const { sections, cleanBody } = extractSections(body);

  return {
    meta,
    sections,
    body: cleanBody,
    hasFrontMatter,
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function splitFrontMatter(content: string): { yaml: string; body: string; hasFrontMatter: boolean } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return { yaml: "", body: content, hasFrontMatter: false };
  }
  // Find the closing `---` on its own line.
  const endMatch = trimmed.slice(3).match(/\n---\s*\n/);
  if (!endMatch) {
    return { yaml: "", body: content, hasFrontMatter: false };
  }
  const yamlEnd = 3 + endMatch.index! + endMatch[0].length;
  const yaml = trimmed.slice(3, 3 + endMatch.index!).trim();
  const body = trimmed.slice(yamlEnd).trim();
  return { yaml, body, hasFrontMatter: true };
}

function parseYamlFrontMatter(yaml: string): DdMeta {
  const lines = yaml.split("\n");
  const meta = createEmptyMeta();
  let currentSection: "tokens" | "sections" | "extra" | null = null;
  const rawSections: DdSectionMeta[] = [];

  for (const line of lines) {
    // Section list entries: `  - id: hero` / `  - id: hero\n    type: hero`
    if (currentSection === "sections") {
      const idMatch = line.match(/^\s+-\s+id:\s*(.+)/);
      if (idMatch) {
        rawSections.push({ id: idMatch[1].trim(), type: "" });
        continue;
      }
      const typeMatch = line.match(/^\s+type:\s*(.+)/);
      if (typeMatch && rawSections.length > 0) {
        rawSections[rawSections.length - 1].type = typeMatch[1].trim();
        continue;
      }
      // Exit sections block
      if (line && !line.startsWith(" ") && !line.startsWith("-")) {
        currentSection = null;
      } else {
        continue;
      }
    }

    // Token entries: `  bg: "#0a0a0a"` (keys may contain hyphens, e.g. `font-display`)
    if (currentSection === "tokens") {
      const tokenMatch = line.match(/^\s+([\w-]+):\s*(.+)/);
      if (tokenMatch) {
        meta.tokens[tokenMatch[1]] = stripQuotes(tokenMatch[2].trim());
        continue;
      }
      if (line && !line.startsWith(" ")) {
        currentSection = null;
      } else {
        continue;
      }
    }

    // Top-level keys (allow hyphens in keys for robustness)
    const kvMatch = line.match(/^([\w-]+):\s*(.*)/);
    if (!kvMatch) continue;
    const key = kvMatch[1];
    const value = kvMatch[2].trim();

    if (value === "") {
      // Block start
      if (key === "tokens") currentSection = "tokens";
      else if (key === "sections") currentSection = "sections";
      else currentSection = "extra";
    } else {
      // Inline value
      const v = stripQuotes(value);
      switch (key) {
        case "name":
          meta.name = v;
          break;
        case "system":
          meta.system = v;
          break;
        case "style":
          meta.style = v;
          break;
        case "version":
          meta.version = v;
          break;
        case "createdAt":
          meta.createdAt = v;
          break;
        case "updatedAt":
          meta.updatedAt = v;
          break;
        default:
          meta.extra[key] = v;
          break;
      }
    }
  }

  meta.sections = rawSections;
  return meta;
}

function extractSections(body: string): { sections: DdSection[]; cleanBody: string } {
  const sections: DdSection[] = [];
  // Match `<!-- dd:section xxx -->` ... `<!-- /dd:section -->`
  const sectionRegex = /<!--\s*dd:section\s+(\S+)\s*-->([\s\S]*?)<!--\s*\/dd:section\s*-->/g;
  let match;
  let cleanBody = body;
  while ((match = sectionRegex.exec(body)) !== null) {
    const id = match[1];
    const html = match[2].trim();
    sections.push({ id, html });
  }
  // Strip section markers from body for clean HTML output.
  cleanBody = body
    .replace(/<!--\s*dd:section\s+\S+\s*-->/g, "")
    .replace(/<!--\s*\/dd:section\s*-->/g, "")
    .trim();
  return { sections, cleanBody };
}

function createEmptyMeta(): DdMeta {
  return {
    name: "",
    system: "",
    style: "",
    version: "1.0",
    createdAt: "",
    updatedAt: "",
    tokens: {},
    sections: [],
    extra: {},
  };
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
