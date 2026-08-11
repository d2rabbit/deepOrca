/**
 * Phase 2 OpenWiki actions (spec §四). The document-level index.
 *
 * init/update spawn the vendored `openwiki` CLI (LangChain) — like ocr, the
 * command resolution (npm package path + LLM creds + model fallback) lives in
 * desktop, injected here via the {@link WikiResolver} seam. listPages/readPage
 * are pure filesystem reads of the project's `openwiki/` directory (no spawn).
 *
 * Once registered, the agent can generate/refresh/query the project wiki as a
 * first-class tool (MCP/LLM surface) — previously it was desktop-IPC-only.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { ActionDefinition, ActionRun } from "./types";

/** Launch spec for the openwiki CLI (parallel to OcrCommand). */
export interface WikiCommand {
  readonly command: string;
  readonly prefixArgs: readonly string[];
  readonly env?: Record<string, string>;
}

/** Resolver the desktop host injects: given a mode, returns the launch spec or
 * null when openwiki isn't bundled. Desktop owns the npm dep + LLM creds. */
export type WikiResolver = (mode: "init" | "update") => WikiCommand | null;

let wikiResolver: WikiResolver | null = null;

export function configureWikiResolver(resolver: WikiResolver | null): void {
  wikiResolver = resolver;
}

export function getWikiResolver(): WikiResolver | null {
  return wikiResolver;
}

const OPENWIKI_DIR = "openwiki";

export interface WikiInitOutput {
  readonly ok: boolean;
}

export const wikiInitDefinition: ActionDefinition = {
  id: "wiki.init",
  description:
    "Generate the project wiki (openwiki/ directory) — a structured, cross-referenced knowledge graph of the codebase (architecture, modules, workflows). First run does a full scan. Streams build output. The wiki is version-controlled and dramatically reduces agent token usage.",
  category: "index",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  sideEffects: ["spawn-subprocess", "write-in-cwd", "network"],
};

export const wikiInitRun: ActionRun<unknown, WikiInitOutput> = async (_input, ctx) => runWikiMode("init", ctx);

export const wikiUpdateDefinition: ActionDefinition = {
  id: "wiki.update",
  description:
    "Incrementally update the project wiki (openwiki/) — regenerates only pages affected by git changes since the last generation. Safe to run frequently.",
  category: "index",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  sideEffects: ["spawn-subprocess", "write-in-cwd", "network"],
};

export const wikiUpdateRun: ActionRun<unknown, WikiInitOutput> = async (_input, ctx) => runWikiMode("update", ctx);

async function runWikiMode(
  mode: "init" | "update",
  ctx: {
    projectRoot: string;
    emit: (e: { message: string; percent?: number }) => void;
    spawner: {
      spawn: (
        cmd: string,
        args: readonly string[],
        opts?: { cwd?: string; env?: Record<string, string> }
      ) => { stdout: AsyncIterable<string>; stderr: AsyncIterable<string>; exited: Promise<{ code: number }> };
    };
  }
): Promise<WikiInitOutput> {
  const resolver = getWikiResolver();
  if (!resolver) {
    throw new Error(`wiki.${mode}: no wiki resolver configured (host must call configureWikiResolver at boot)`);
  }
  const resolved = resolver(mode);
  if (!resolved) {
    throw new Error(`wiki.${mode}: openwiki is not bundled with this build`);
  }
  ctx.emit({ message: `running openwiki --${mode}`, percent: 10 });
  const flag = mode === "init" ? "--init" : "--update";
  const proc = ctx.spawner.spawn(resolved.command, [...resolved.prefixArgs, flag], {
    cwd: ctx.projectRoot,
    env: resolved.env,
  });
  const stderrLines: string[] = [];
  const drainStderr = (async () => {
    for await (const line of proc.stderr) stderrLines.push(line);
  })();
  for await (const _line of proc.stdout) {
    ctx.emit({ message: `wiki: progress` });
  }
  const { code } = await proc.exited;
  await drainStderr;
  if (code !== 0) {
    throw new Error(
      `wiki.${mode}: openwiki exited ${code}${stderrLines.length ? `: ${stderrLines.join("").slice(0, 500)}` : ""}`
    );
  }
  ctx.emit({ message: `wiki ${mode} complete`, percent: 100 });
  return { ok: true };
}

// --- pure-filesystem reads (no spawn) ----------------------------------------

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
  // Sandbox: resolve the requested name under openwiki/ and confirm it stays within.
  const raw = input.name.endsWith(".md") ? input.name : `${input.name}.md`;
  const resolved = path.resolve(dir, raw);
  const rel = path.relative(dir, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`wiki.readPage: "${input.name}" escapes the openwiki/ directory`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`wiki.readPage: no such page "${input.name}"`);
  }
  return { name: input.name, content: fs.readFileSync(resolved, "utf8") };
};
