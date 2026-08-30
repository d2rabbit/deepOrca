/**
 * OpenWiki actions — wiki.init / wiki.update / wiki.list-pages / wiki.read-page.
 *
 * init/update delegate to the host-injected WikiController (desktop's
 * WikiCliController spawns the vendored openwiki CLI against a disposable
 * openwiki/ STAGE and promotes validated output into the canonical deepwiki/
 * store — see desktop main/tools/wiki-staging.ts). list-pages/read-page are
 * pure filesystem reads of the project's deepwiki/ directory (the canonical
 * store; openwiki/ only exists mid-run).
 *
 * All spawn logic has migrated to desktop — core has zero wiki-CLI code.
 */

import type { ActionDefinition, ActionRun } from "./types";
import type { ControllerProgress } from "./codegraph-controller";
import { getWikiController } from "./wiki-controller";
import type { WikiResult } from "./wiki-controller";
export type { WikiController, WikiResult } from "./wiki-controller";
export { configureWikiController, getWikiController } from "./wiki-controller";
import * as fs from "node:fs";
import * as path from "node:path";

/** Canonical wiki store (desktop's staging promotes into it; the CLI's
 *  hardcoded openwiki/ dir is a run-local stage, not the read surface). */
const OPENWIKI_DIR = "deepwiki";

export type WikiInitOutput = WikiResult;

// ── wiki.init / wiki.update ──────────────────────────────────────────────────

export const wikiInitDefinition: ActionDefinition = {
  id: "wiki.init",
  description:
    "Generate the project wiki (deepwiki/ store) — a structured, cross-referenced knowledge graph of the codebase (architecture, modules, workflows). First run does a full scan. Streams build output. The wiki is version-controlled and dramatically reduces agent token usage.",
  category: "index",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  sideEffects: ["spawn-subprocess", "write-in-cwd", "network"],
};

export const wikiInitRun: ActionRun<unknown, WikiInitOutput> = async (_input, ctx) => {
  const wc = getWikiController();
  if (!wc) {
    throw new Error("wiki.init: no WikiController configured (host must call configureWikiController at boot)");
  }
  return wc.init(ctx.projectRoot, (p: ControllerProgress) => ctx.emit(p));
};

export const wikiUpdateDefinition: ActionDefinition = {
  id: "wiki.update",
  description:
    "Incrementally update the project wiki (deepwiki/) — regenerates only pages affected by git changes. Safe to run frequently.",
  category: "index",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  sideEffects: ["spawn-subprocess", "write-in-cwd", "network"],
};

export const wikiUpdateRun: ActionRun<unknown, WikiInitOutput> = async (_input, ctx) => {
  const wc = getWikiController();
  if (!wc) {
    throw new Error("wiki.update: no WikiController configured (host must call configureWikiController at boot)");
  }
  return wc.update(ctx.projectRoot, (p: ControllerProgress) => ctx.emit(p));
};

// ── wiki.list-pages / wiki.read-page (pure fs + OKF frontmatter) ─────────────

import matter from "gray-matter";

/** OKF frontmatter fields parsed from each wiki page. */
export interface WikiFrontmatter {
  type?: string;
  title?: string;
  description?: string;
  tags?: string[];
}

export interface WikiPage {
  readonly name: string;
  readonly path: string;
  readonly title?: string;
  readonly type?: string;
}

/** Parse OKF frontmatter from markdown content. Returns null when absent/invalid. */
function parseFrontmatter(content: string): WikiFrontmatter | null {
  try {
    const parsed = matter(content);
    const d = parsed.data;
    if (typeof d !== "object" || d === null) return null;
    const fm: WikiFrontmatter = {};
    if (typeof d.type === "string") fm.type = d.type;
    if (typeof d.title === "string") fm.title = d.title;
    if (typeof d.description === "string") fm.description = d.description;
    if (Array.isArray(d.tags) && d.tags.every((t: unknown) => typeof t === "string")) {
      fm.tags = d.tags as string[];
    }
    return Object.keys(fm).length > 0 ? fm : null;
  } catch {
    return null;
  }
}

export const wikiListPagesDefinition: ActionDefinition = {
  id: "wiki.list-pages",
  description:
    "List the wiki pages (markdown files) in the project's deepwiki/ store, with OKF frontmatter metadata (title, type). Returns [] if no wiki has been generated.",
  category: "index",
  parameters: { type: "object", properties: {}, additionalProperties: false },
};

export const wikiListPagesRun: ActionRun<unknown, WikiPage[]> = async (_input, ctx) => {
  const dir = path.join(ctx.projectRoot, OPENWIKI_DIR);
  if (!fs.existsSync(dir)) return [];
  const pages: WikiPage[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      const fullPath = path.join(dir, entry.name);
      let title: string | undefined;
      let type: string | undefined;
      try {
        const fm = parseFrontmatter(fs.readFileSync(fullPath, "utf8"));
        title = fm?.title;
        type = fm?.type;
      } catch {
        // Read error — skip metadata.
      }
      pages.push({
        name: entry.name.replace(/\.md$/, ""),
        path: `${OPENWIKI_DIR}/${entry.name}`,
        title,
        type,
      });
    }
  }
  return pages.sort((a, b) => (a.title ?? a.name).localeCompare(b.title ?? b.name));
};

export interface WikiPageDetail {
  readonly name: string;
  readonly path: string;
  readonly frontmatter: WikiFrontmatter | null;
  readonly body: string;
  readonly raw: string;
}

export const wikiReadPageDefinition: ActionDefinition<{ name: string }> = {
  id: "wiki.read-page",
  description:
    "Read a wiki page by name (e.g. 'architecture', 'modules/auth'). Returns structured OKF frontmatter (type/title/description/tags) + body + raw markdown. Confined to the project's deepwiki/ store.",
  category: "index",
  parameters: {
    type: "object",
    properties: { name: { type: "string", description: "Page name (without .md) or relative path within deepwiki/." } },
    required: ["name"],
    additionalProperties: false,
  },
};

export const wikiReadPageRun: ActionRun<{ name: string }, WikiPageDetail> = async (input, ctx) => {
  const dir = path.resolve(ctx.projectRoot, OPENWIKI_DIR);
  const raw = input.name.endsWith(".md") ? input.name : `${input.name}.md`;
  const resolved = path.resolve(dir, raw);
  const rel = path.relative(dir, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`wiki.read-page: "${input.name}" escapes the deepwiki/ store`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`wiki.read-page: no such page "${input.name}"`);
  }
  const rawContent = fs.readFileSync(resolved, "utf8");
  const parsed = matter(rawContent);
  return {
    name: input.name,
    path: `${OPENWIKI_DIR}/${raw}`,
    frontmatter: parseFrontmatter(rawContent),
    body: parsed.content,
    raw: rawContent,
  };
};
