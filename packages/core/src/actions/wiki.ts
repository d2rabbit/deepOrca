/**
 * OpenWiki actions — wiki.init / wiki.update / wiki.list-pages / wiki.read-page.
 *
 * init/update delegate to the host-injected WikiController (desktop's
 * WikiCliController spawns the vendored openwiki CLI). list-pages/read-page
 * are pure filesystem reads of the project's openwiki/ directory.
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

const OPENWIKI_DIR = "openwiki";

export type WikiInitOutput = WikiResult;

// ── wiki.init / wiki.update ──────────────────────────────────────────────────

export const wikiInitDefinition: ActionDefinition = {
  id: "wiki.init",
  description:
    "Generate the project wiki (openwiki/ directory) — a structured, cross-referenced knowledge graph of the codebase (architecture, modules, workflows). First run does a full scan. Streams build output. The wiki is version-controlled and dramatically reduces agent token usage.",
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
    "Incrementally update the project wiki (openwiki/) — regenerates only pages affected by git changes. Safe to run frequently.",
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

// ── wiki.list-pages / wiki.read-page (pure fs) ───────────────────────────────

export interface WikiPage {
  readonly name: string;
  readonly path: string;
}

export const wikiListPagesDefinition: ActionDefinition = {
  id: "wiki.list-pages",
  description:
    "List the wiki pages (markdown files) in the project's openwiki/ directory. Returns [] if no wiki has been generated.",
  category: "index",
  parameters: { type: "object", properties: {}, additionalProperties: false },
};

export const wikiListPagesRun: ActionRun<unknown, WikiPage[]> = async (_input, ctx) => {
  const dir = path.join(ctx.projectRoot, OPENWIKI_DIR);
  if (!fs.existsSync(dir)) return [];
  const pages: WikiPage[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      pages.push({ name: entry.name.replace(/\.md$/, ""), path: `${OPENWIKI_DIR}/${entry.name}` });
    }
  }
  return pages.sort((a, b) => a.name.localeCompare(b.name));
};

export const wikiReadPageDefinition: ActionDefinition<{ name: string }> = {
  id: "wiki.read-page",
  description:
    "Read a wiki page's markdown content by name (e.g. 'architecture', 'modules/auth'). Confined to the project's openwiki/ directory.",
  category: "index",
  parameters: {
    type: "object",
    properties: { name: { type: "string", description: "Page name (without .md) or relative path within openwiki/." } },
    required: ["name"],
    additionalProperties: false,
  },
};

export const wikiReadPageRun: ActionRun<{ name: string }, { name: string; content: string }> = async (input, ctx) => {
  const dir = path.resolve(ctx.projectRoot, OPENWIKI_DIR);
  const raw = input.name.endsWith(".md") ? input.name : `${input.name}.md`;
  const resolved = path.resolve(dir, raw);
  const rel = path.relative(dir, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`wiki.read-page: "${input.name}" escapes the openwiki/ directory`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`wiki.read-page: no such page "${input.name}"`);
  }
  return { name: input.name, content: fs.readFileSync(resolved, "utf8") };
};
