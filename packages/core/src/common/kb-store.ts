/**
 * KB store readers — the agent-facing read surface over a project's generated
 * knowledge base. Pure filesystem + JSON/markdown parsing; no Electron, no
 * MCP, no subprocess (the MCP shell that exposes these to agents lives in
 * desktop's kb-mcp.ts — core stays testable).
 *
 * Two sources, per the knowledge dashboard's own probes (knowledge-ipc.ts):
 *  - OpenWiki: markdown pages with OKF frontmatter under the canonical
 *    `.deeporca/deepwiki/` store (modules/ and workflows/ subdirs included —
 *    the store is walked recursively, unlike the flat wiki.list-pages action).
 *  - Architecture maps: archify typed-IR `*.<type>.json` artifacts under
 *    `.deeporca/prototypes/` (conventionally `arch-*`, but the suffix is the
 *    contract — same as the vendored CLI's archifyTypeOf) with their delivered
 *    `.html` siblings (archify era: 摒弃自有 mermaid 方案, the IR JSON — not
 *    the HTML — is the agent-readable knowledge).
 *
 * Everything is read-only and escape-guarded; absent stores resolve to empty
 * results so a project without a wiki never errors an agent's exploration.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import matter from "gray-matter";
import { WIKI_STORE_DIR, DEEPORCA_PROJECT_DIR } from "./generated-dirs";
import { isWikiVariantFile } from "../actions/wiki-variants";

/**
 * Wiki page guards — the SAME lines the knowledge dashboard's probes enforce
 * (knowledge-ipc.ts) and the codebase invariant "same 512B line everywhere"
 * (wiki-cli): (1) the removed bilingual stage's legacy `*.zh.md` / `*.en.md`
 * siblings stay on disk but are not pages; (2) a bare root `index.md`
 * skeleton (failed-init leftover, <512B real-world) must not read as a
 * generated page. `readWikiPage` still serves explicit requests — only
 * list/overview parity is guarded here.
 */
const SKELETON_PAGE_BYTES = 512;

const PROTOTYPES_DIR = `${DEEPORCA_PROJECT_DIR}/prototypes`;

/** Archify diagram types — mirrors the vendored CLI's file-suffix contract
 *  (`*.architecture.json` etc.; see archify-cli archifyTypeOf). */
const ARCH_TYPES = ["architecture", "workflow", "sequence", "dataflow", "lifecycle"] as const;
export type ArchDiagramType = (typeof ARCH_TYPES)[number];

/** OKF frontmatter fields parsed from each wiki page. */
export interface KbWikiMeta {
  title?: string;
  type?: string;
  description?: string;
  tags?: string[];
}

export interface KbWikiPage {
  /** Page name relative to the wiki store, without `.md` (e.g. "modules/auth"). */
  readonly name: string;
  /** Store-relative path with `.md` (for kb_read_page). */
  readonly path: string;
  readonly title?: string;
  readonly type?: string;
  readonly description?: string;
  readonly tags?: string[];
  readonly sizeBytes: number;
  readonly modifiedAt: string;
}

export interface KbWikiPageRead {
  readonly name: string;
  readonly path: string;
  readonly meta: KbWikiMeta;
  /** Body with frontmatter stripped (chars, from `offset`, at most `limit`). */
  readonly body: string;
  readonly totalChars: number;
  readonly offset: number;
  readonly truncated: boolean;
}

export interface KbSearchHit {
  readonly page: string;
  readonly path: string;
  readonly title?: string;
  /** 1-based line number in the raw page file. */
  readonly line: number;
  /** The matched line, trimmed to ~200 chars. */
  readonly text: string;
}

export interface KbDiagramSummary {
  /** Artifact base name without `.json` (e.g. "arch-auth.architecture"). */
  readonly name: string;
  readonly type: ArchDiagramType;
  /** `meta.title` from the IR when present. */
  readonly title?: string;
  readonly components: number;
  readonly connections: number;
  /** Delivered interactive HTML sibling exists (the human-facing view). */
  readonly htmlDelivered: boolean;
  readonly modifiedAt: string;
}

export interface KbDiagramRead {
  readonly name: string;
  readonly type: ArchDiagramType;
  readonly title?: string;
  /** Named focus views from the IR meta (author-curated reading paths). */
  readonly views?: Array<{ id: string; label: string; focus?: string[]; note?: string }>;
  readonly components: unknown[];
  readonly boundaries: unknown[];
  readonly connections: unknown[];
  readonly cards?: unknown[];
}

export interface KbOverview {
  wiki: {
    /** False when the deepwiki store has not been generated. */
    present: boolean;
    pageCount: number;
    pages: Array<Pick<KbWikiPage, "name" | "title" | "type">>;
  };
  diagrams: {
    present: boolean;
    count: number;
    items: Array<Pick<KbDiagramSummary, "name" | "type" | "title" | "htmlDelivered">>;
  };
}

// ── wiki helpers ─────────────────────────────────────────────────────────────

function parseFrontmatter(content: string): KbWikiMeta {
  try {
    const data = matter(content).data;
    if (typeof data !== "object" || data === null) return {};
    const meta: KbWikiMeta = {};
    if (typeof data.title === "string") meta.title = data.title;
    if (typeof data.type === "string") meta.type = data.type;
    if (typeof data.description === "string") meta.description = data.description;
    if (Array.isArray(data.tags) && data.tags.every((t: unknown) => typeof t === "string")) {
      meta.tags = data.tags as string[];
    }
    return meta;
  } catch {
    return {};
  }
}

function walkWikiPages(dir: string, relPrefix: string, out: KbWikiPage[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walkWikiPages(full, rel, out);
    } else if (entry.isFile() && entry.name.endsWith(".md") && !isWikiVariantFile(entry.name)) {
      try {
        const stat = fs.statSync(full);
        const raw = fs.readFileSync(full, "utf8");
        const meta = parseFrontmatter(raw);
        out.push({
          name: rel.replace(/\.md$/, ""),
          path: `${WIKI_STORE_DIR}/${rel}`,
          ...meta,
          sizeBytes: Buffer.byteLength(raw),
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch {
        // raced away / unreadable — skip the page, keep the walk alive
      }
    }
  }
}

/** List every wiki page (recursive) with frontmatter metadata. Empty when the
 *  store has not been generated. */
export function listWikiPages(root: string): KbWikiPage[] {
  const dir = path.join(root, WIKI_STORE_DIR);
  if (!fs.existsSync(dir)) return [];
  const pages: KbWikiPage[] = [];
  walkWikiPages(dir, "", pages);
  const counted = pages.filter(
    (page) => !(page.path === `${WIKI_STORE_DIR}/index.md` && page.sizeBytes <= SKELETON_PAGE_BYTES)
  );
  return counted.sort((a, b) => (a.title ?? a.name).localeCompare(b.title ?? b.name));
}

/** Read one wiki page by store-relative name ("architecture", "modules/auth").
 *  `offset`/`limit` page through long bodies (chars). Throws on escape attempts
 *  or missing pages. */
export function readWikiPage(root: string, name: string, opts?: { offset?: number; limit?: number }): KbWikiPageRead {
  const dir = path.resolve(root, WIKI_STORE_DIR);
  const suffix = name.endsWith(".md") ? name : `${name}.md`;
  const resolved = path.resolve(dir, suffix);
  const rel = path.relative(dir, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") {
    throw new Error(`kb_read_page: "${name}" escapes the ${WIKI_STORE_DIR}/ store`);
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`kb_read_page: no such page "${name}"`);
  }
  const raw = fs.readFileSync(resolved, "utf8");
  const offset = Math.max(0, Math.floor(opts?.offset ?? 0));
  const limit = Math.max(1, Math.floor(opts?.limit ?? 60_000));
  const body = matter(raw).content;
  const sliced = body.slice(offset, offset + limit);
  return {
    name: rel.replace(/\.md$/, ""),
    path: `${WIKI_STORE_DIR}/${suffix}`,
    meta: parseFrontmatter(raw),
    body: sliced,
    totalChars: body.length,
    offset,
    truncated: offset + sliced.length < body.length,
  };
}

/** Case-insensitive substring search across all wiki pages (titles and every
 *  raw line). Hits are capped (default 40) and ordered page-by-page. */
export function searchWikiPages(root: string, query: string, opts?: { maxHits?: number }): KbSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const maxHits = Math.max(1, Math.floor(opts?.maxHits ?? 40));
  const hits: KbSearchHit[] = [];
  for (const page of listWikiPages(root)) {
    const full = path.join(root, `${page.path}`);
    let raw: string;
    try {
      raw = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (!raw.toLowerCase().includes(needle)) continue;
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length && hits.length < maxHits; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        hits.push({
          page: page.name,
          path: page.path,
          ...(page.title ? { title: page.title } : {}),
          line: i + 1,
          text: lines[i].trim().slice(0, 200),
        });
      }
    }
    if (hits.length >= maxHits) break;
  }
  return hits;
}

// ── architecture-map helpers ────────────────────────────────────────────────

function archTypeOf(fileName: string): ArchDiagramType | null {
  const m = fileName.match(new RegExp(`\\.(${ARCH_TYPES.join("|")})\\.json$`));
  return (m?.[1] as ArchDiagramType) ?? null;
}

function readIrMeta(jsonPath: string): { title?: string; components: number; connections: number } {
  try {
    const ir = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
    const meta = ir.meta as { title?: unknown } | undefined;
    return {
      ...(meta && typeof meta.title === "string" ? { title: meta.title } : {}),
      components: Array.isArray(ir.components) ? ir.components.length : 0,
      connections: Array.isArray(ir.connections) ? ir.connections.length : 0,
    };
  } catch {
    return { components: 0, connections: 0 };
  }
}

/** List archify typed-IR artifacts (content-weighted: hollow leftovers under
 *  256B are skipped, same rule as the desktop archify runner). */
export function listArchDiagrams(root: string): KbDiagramSummary[] {
  const dir = path.join(root, PROTOTYPES_DIR);
  const out: KbDiagramSummary[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const type = archTypeOf(entry.name);
    if (!type) continue;
    const jsonPath = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(jsonPath);
      if (stat.size <= 256) continue;
      const meta = readIrMeta(jsonPath);
      out.push({
        name: entry.name.replace(/\.json$/, ""),
        type,
        ...meta,
        htmlDelivered: fs.existsSync(jsonPath.replace(/\.json$/, ".html")),
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch {
      // raced away — skip
    }
  }
  return out.sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt));
}

/** Read one architecture diagram's IR — the knowledge-dense fields (meta
 *  views/components/boundaries/connections/cards); pixel `layout` is render
 *  detail and is excluded. Throws on escape attempts or missing artifacts. */
export function readArchDiagram(root: string, name: string): KbDiagramRead {
  const dir = path.resolve(root, PROTOTYPES_DIR);
  const resolved = path.resolve(dir, `${name}.json`);
  const rel = path.relative(dir, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") {
    throw new Error(`kb_read_diagram: "${name}" escapes the ${PROTOTYPES_DIR}/ store`);
  }
  const type = archTypeOf(path.basename(resolved));
  if (!type) {
    throw new Error(`kb_read_diagram: "${name}" is not an archify typed-IR artifact (*.<type>.json)`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`kb_read_diagram: no such diagram "${name}"`);
  }
  // 与 listArchDiagrams 同一条内容重量线(≤256B = 空心残留):list 不收、
  // read 拒读,两侧契约一致。
  if (fs.statSync(resolved).size <= 256) {
    throw new Error(`kb_read_diagram: "${name}" is a hollow leftover (≤256B) — regenerate the diagram`);
  }
  const ir = JSON.parse(fs.readFileSync(resolved, "utf8")) as Record<string, unknown>;
  const meta = ir.meta as { title?: unknown; views?: unknown } | undefined;
  return {
    // 与 listArchDiagrams 同规:返回无 .json 后缀的 base name,agent 拿
    // read 的 name 可直接回传 list/read 对照(评审 H)。
    name: rel.replace(/\.json$/, ""),
    type,
    ...(meta && typeof meta.title === "string" ? { title: meta.title } : {}),
    ...(meta && Array.isArray(meta.views) ? { views: meta.views as KbDiagramRead["views"] } : {}),
    components: Array.isArray(ir.components) ? ir.components : [],
    boundaries: Array.isArray(ir.boundaries) ? ir.boundaries : [],
    connections: Array.isArray(ir.connections) ? ir.connections : [],
    ...(Array.isArray(ir.cards) ? { cards: ir.cards as unknown[] } : {}),
  };
}

/** One-shot inventory for exploration entry points ("what knowledge exists?"). */
export function kbOverview(root: string): KbOverview {
  const pages = listWikiPages(root);
  const diagrams = listArchDiagrams(root);
  return {
    wiki: {
      present: pages.length > 0,
      pageCount: pages.length,
      pages: pages.map(({ name, title, type }) => ({ name, ...(title ? { title } : {}), ...(type ? { type } : {}) })),
    },
    diagrams: {
      present: diagrams.length > 0,
      count: diagrams.length,
      items: diagrams.map(({ name, type, title, htmlDelivered }) => ({
        name,
        type,
        ...(title ? { title } : {}),
        htmlDelivered,
      })),
    },
  };
}
