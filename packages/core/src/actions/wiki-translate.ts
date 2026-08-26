/**
 * wiki.translate — bilingual-ize the generated wiki (backend translation).
 *
 * The openwiki CLI writes pages in ONE language (the app locale's, via
 * --language). This action gives every page a sibling translation in the
 * OTHER language (en→zh, zh→auto-detect→en), so the Knowledge module's wiki
 * tab can offer a 原文/译文 toggle. "Backend agent" by design: it runs in the
 * build pipeline with zero session residue and zero conversation-view impact,
 * same contract as index.build-all's other stages.
 *
 * Deterministic orchestration, LLM only for the per-page translation itself:
 * the action enumerates pages, detects each page's language, skips variants
 * that are already newer than their source (mtime), and writes
 * `<page>.<lang>.md` siblings. An agentic tool-loop was considered and
 * rejected: the background-task channel's narrow tool surface has no write
 * tool, its 80-iteration cap is too small for page-count×(read+write), and a
 * file list the orchestrator cannot verify would make "did every page get
 * translated?" unanswerable.
 *
 * Best-effort per page: a failed translation is counted and logged, never
 * fails the build stage. Only a missing LLM client or a fully unreadable
 * openwiki tree degrades the whole stage.
 */

import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import type { ActionDefinition, ActionRun } from "./types";

export interface WikiTranslateInput {
  /** Workspace root whose openwiki/ tree to translate. Defaults to ctx root. */
  readonly root?: string;
  /** Cap on pages translated per run (cost guard for very large wikis). */
  readonly limit?: number;
}

export interface WikiTranslateOutput {
  total: number;
  translated: number;
  /** Already up to date (variant newer than or equal to source mtime). */
  upToDate: number;
  /** Skipped: undetectable language, oversized, or past the limit. */
  skipped: number;
  failed: number;
  /** True when no LLM client was available (stage should report skipped). */
  noLlm: boolean;
  /** True when the run was cut short by cancellation. */
  aborted: boolean;
}

/** Pages larger than this are skipped — one completion must fit the answer. */
const MAX_PAGE_BYTES = 96 * 1024;

/** Language-detection minimum signal: CJK+latin letters after code stripping. */
const MIN_SIGNAL_CHARS = 40;

/** CJK share above which a page reads as Chinese (english identifiers remain). */
const CJK_RATIO_THRESHOLD = 0.25;

/**
 * Detect a wiki page's language: "zh" or "en". Code fences and frontmatter
 * are stripped first so identifiers/comments don't skew the ratio. Returns
 * null when there is too little prose signal to judge (the page is skipped).
 */
export function detectWikiLanguage(content: string): "zh" | "en" | null {
  const prose = content
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
  const cjk = (prose.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) ?? []).length;
  const latin = (prose.match(/[A-Za-z]/g) ?? []).length;
  if (cjk + latin < MIN_SIGNAL_CHARS) return null;
  return cjk / (cjk + latin) > CJK_RATIO_THRESHOLD ? "zh" : "en";
}

/** Sibling-variant naming convention: `a/b.md` → `a/b.<lang>.md`. */
export function wikiVariantPath(pageRel: string, lang: "zh" | "en"): string {
  return pageRel.replace(/\.md$/, `.${lang}.md`);
}

/** True for generated variant files (`*.zh.md` / `*.en.md`) — hidden from listings. */
export function isWikiVariantFile(fileName: string): boolean {
  return /\.(zh|en)\.md$/i.test(fileName);
}

/**
 * Lexical containment guard for every path derived from an enumeration entry
 * (defense in depth — `rel` comes from our own readdir walk, but the write
 * side must be able to PROVE it can never escape openwiki/).
 */
export function containedUnderWiki(wikiDir: string, target: string): boolean {
  const root = path.resolve(wikiDir);
  const resolved = path.resolve(wikiDir, target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/** Enumerate base wiki pages under `wikiDir` (relative POSIX paths, variants excluded). */
export async function listWikiBasePages(wikiDir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    let items: Dirent[];
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (item.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        await walk(path.join(dir, item.name), rel);
      } else if (item.isFile() && item.name.endsWith(".md") && !isWikiVariantFile(item.name)) {
        out.push(rel);
      }
    }
  };
  await walk(wikiDir, "");
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

const TRANSLATION_SYSTEM_PROMPT =
  "You are a professional technical-documentation translator. Translate the Markdown page the " +
  "user sends into the requested language. Rules:\n" +
  "- Output ONLY the translated Markdown document. No preamble, no explanation, and do NOT wrap " +
  "the whole output in a code fence.\n" +
  "- Preserve the structure exactly: heading levels, lists, tables, blockquotes, links, frontmatter keys.\n" +
  "- Translate frontmatter VALUES (title/description) but keep the keys unchanged.\n" +
  "- NEVER translate code inside code fences (code comments may be translated), file paths, URLs, " +
  "command names, identifiers, or HTML tags.\n" +
  "- Keep technical terms, product names and proper nouns as-is. Match the source's tone and precision.";

export const wikiTranslateDefinition: ActionDefinition<WikiTranslateInput> = {
  id: "wiki.translate",
  description:
    "Bilingual-ize the workspace wiki: translate every openwiki/ page into the OTHER language " +
    "(en→zh, zh→en) via the backend LLM, writing sibling <page>.<lang>.md variants. Skips variants " +
    "already newer than their source (mtime) so update builds only pay for changed pages. Best-effort " +
    "per page — individual failures are counted, not fatal.",
  category: "index",
  parameters: {
    type: "object",
    properties: {
      root: { type: "string", description: "Workspace root to translate. Defaults to the action context root." },
      limit: { type: "number", description: "Maximum pages to translate this run (cost guard)." },
    },
    additionalProperties: false,
  },
  sideEffects: ["network", "write-in-cwd"],
};

const LANG_LABEL: Record<"zh" | "en", string> = { zh: "中文", en: "English" };

export const wikiTranslateRun: ActionRun<WikiTranslateInput, WikiTranslateOutput> = async (input, ctx) => {
  const root = input?.root || ctx.projectRoot;
  const wikiDir = path.join(root, "openwiki");
  const stats: WikiTranslateOutput = {
    total: 0,
    translated: 0,
    upToDate: 0,
    skipped: 0,
    failed: 0,
    noLlm: false,
    aborted: false,
  };
  const pages = await listWikiBasePages(wikiDir);
  stats.total = pages.length;

  const complete = ctx.completeViaLlm;
  if (!complete) {
    stats.noLlm = true;
    stats.skipped = pages.length;
    ctx.emit({ message: `wiki 翻译跳过 · 无可用 LLM / translation skipped · no LLM client` });
    return stats;
  }

  const limit = input?.limit && input.limit > 0 ? input.limit : pages.length;
  for (let i = 0; i < pages.length; i++) {
    if (ctx.signal.aborted) {
      stats.aborted = true;
      ctx.emit({ message: `wiki 翻译已取消 / translation cancelled (${stats.translated} done)` });
      break;
    }
    const rel = pages[i];
    if (!containedUnderWiki(wikiDir, rel)) {
      stats.failed++;
      continue;
    }
    const srcAbs = path.join(wikiDir, rel);
    if (stats.translated >= limit) {
      stats.skipped++;
      continue;
    }
    let content: string;
    let srcMtimeMs: number;
    try {
      content = await fs.readFile(srcAbs, "utf8");
      srcMtimeMs = (await fs.stat(srcAbs)).mtimeMs;
    } catch {
      stats.failed++;
      continue;
    }
    if (Buffer.byteLength(content, "utf8") > MAX_PAGE_BYTES) {
      stats.skipped++;
      ctx.emit({ message: `wiki 翻译跳过（过大） / skipped (oversized): ${rel}` });
      continue;
    }
    const lang = detectWikiLanguage(content);
    if (!lang) {
      stats.skipped++;
      continue;
    }
    const target: "zh" | "en" = lang === "zh" ? "en" : "zh";
    const variantRel = wikiVariantPath(rel, target);
    if (!containedUnderWiki(wikiDir, variantRel)) {
      stats.failed++;
      continue;
    }
    const variantAbs = path.join(wikiDir, variantRel);
    try {
      const vStat = await fs.stat(variantAbs);
      if (vStat.mtimeMs >= srcMtimeMs) {
        stats.upToDate++;
        continue;
      }
    } catch {
      // No variant yet — translate.
    }
    ctx.emit({
      message: `wiki 翻译 ${i + 1}/${pages.length} · translating (${LANG_LABEL[lang]}→${LANG_LABEL[target]}): ${rel}`,
    });
    const translated = await complete(
      [
        {
          role: "system",
          content: TRANSLATION_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `Translate the following Markdown page into ${LANG_LABEL[target]} (${target}):\n\n${content}`,
        },
      ],
      { signal: ctx.signal }
    );
    const text = translated?.trim();
    if (!text) {
      stats.failed++;
      ctx.emit({ message: `wiki 翻译失败 / translation failed: ${rel}` });
      continue;
    }
    try {
      await fs.mkdir(path.dirname(variantAbs), { recursive: true });
      await fs.writeFile(variantAbs, text.endsWith("\n") ? text : `${text}\n`, "utf8");
      stats.translated++;
    } catch {
      stats.failed++;
    }
  }
  ctx.emit({
    message:
      `wiki 翻译完成 / translation complete — 共 ${stats.total} 页：译 ${stats.translated} · 最新 ${stats.upToDate} · ` +
      `跳过 ${stats.skipped} · 失败 ${stats.failed} / pages: ${stats.total}, translated ${stats.translated}, ` +
      `up-to-date ${stats.upToDate}, skipped ${stats.skipped}, failed ${stats.failed}`,
  });
  return stats;
};
