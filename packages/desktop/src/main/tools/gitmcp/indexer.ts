import type { DocChunk, GitmcpStore } from "./store";
import type { DocSource, FetchLike, RepoDocument, RepoTreeEntry } from "./github";
import { assertRepoRelativePath, fetchRawText, fetchRepoDocumentation, fetchRepoTree, RAW_FILE_LIMIT } from "./github";

/**
 * Markdown chunking + indexing for the gitmcp store. Chunks target 500–1500
 * characters: sections are split on headings, oversized sections are packed
 * paragraph-by-paragraph, undersized fragments merge with their successor
 * inside the same section.
 */

const MAX_CHUNK = 1500;
const MIN_CHUNK = 500;

type Section = {
  /** Heading path, e.g. "Install > macOS". Empty for pre-heading content. */
  heading: string;
  body: string;
};

/** Split markdown into sections along ATX headings, tracking the title path. */
function splitSections(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const sections: Section[] = [];
  const headingStack: Array<{ level: number; text: string }> = [];
  let buffer: string[] = [];
  let inFence = false;

  const flush = (): void => {
    const body = buffer.join("\n").trim();
    buffer = [];
    if (body) {
      sections.push({ heading: headingStack.map((h) => h.text).join(" > "), body });
    }
  };

  for (const line of lines) {
    if (/^(```|~~~)/.test(line.trim())) {
      inFence = !inFence;
      buffer.push(line);
      continue;
    }
    const heading = !inFence ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (heading) {
      flush();
      const level = heading[1].length;
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text: heading[2].trim() });
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/** Pack one section's body into chunks within the size window. */
function packSection(section: Section): DocChunk[] {
  const chunks: DocChunk[] = [];
  const paragraphs = section.body.split(/\n{2,}/);
  let current = "";

  const emit = (): void => {
    const content = current.trim();
    current = "";
    if (content) {
      chunks.push({ heading: section.heading, content });
    }
  };

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > MAX_CHUNK && current.length >= MIN_CHUNK) {
      emit();
      current = paragraph;
    } else {
      current = next;
    }
    // A single paragraph can exceed the cap (long lists, code) — hard-split it.
    while (current.length > MAX_CHUNK) {
      const head = current.slice(0, MAX_CHUNK);
      const cut = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(" "));
      const at = cut > MIN_CHUNK ? cut : MAX_CHUNK;
      chunks.push({ heading: section.heading, content: current.slice(0, at).trim() });
      current = current.slice(at).trim();
    }
  }
  emit();
  return chunks;
}

/** Chunk a markdown document into indexable pieces with heading paths. */
export function chunkMarkdown(markdown: string): DocChunk[] {
  return splitSections(markdown).flatMap(packSection);
}

export type IndexResult = {
  docSource: DocSource;
  chunkCount: number;
  /**
   * Source files whose chunks are in the store, in index order. Present only
   * for multi-file (docs/) indexing; single-source indexes keep the legacy
   * shape so old callers and cached stores are unaffected.
   */
  files?: string[];
};

/** Upper bound on extra doc files pulled from docs/ and llms.txt links. */
const MAX_DOCS_FILES = 30;

type ExtraDocFile = { path: string; chunks: DocChunk[] };

/**
 * Fetch a repository's documentation, chunk it, and replace its index in the
 * store. When extra documentation files are discoverable (a `docs/` directory
 * via the trees API, or local `.md` links from llms.txt), they are indexed
 * alongside the primary document with their path prefixed onto each chunk
 * heading (`docs/guide.md > Install`). Throws when the primary fetch fails
 * (callers decide how to fall back).
 */
export async function indexRepository(
  slug: string,
  store: GitmcpStore,
  fetchImpl: FetchLike = fetch
): Promise<IndexResult> {
  const doc = await fetchRepoDocumentation(slug, fetchImpl);
  const primaryChunks = chunkMarkdown(doc.content);
  const extras = await fetchExtraDocFiles(slug, doc, fetchImpl);
  if (extras.length === 0) {
    store.upsertRepoDocument(slug, doc.source, primaryChunks);
    return { docSource: doc.source, chunkCount: primaryChunks.length };
  }
  const withSource = (file: string, chunks: DocChunk[]): DocChunk[] =>
    chunks.map((chunk) => ({
      heading: chunk.heading ? `${file} > ${chunk.heading}` : file,
      content: chunk.content,
    }));
  const all = [...withSource(doc.file, primaryChunks), ...extras.flatMap((e) => withSource(e.path, e.chunks))];
  store.upsertRepoDocument(slug, `${doc.source} + ${extras.length} docs file(s)`, all);
  return { docSource: doc.source, chunkCount: all.length, files: [doc.file, ...extras.map((e) => e.path)] };
}

/** Discover, fetch, and chunk extra documentation files. Best-effort: → []. */
async function fetchExtraDocFiles(slug: string, doc: RepoDocument, fetchImpl: FetchLike): Promise<ExtraDocFile[]> {
  const candidates = await discoverDocFiles(slug, doc, fetchImpl);
  const results: ExtraDocFile[] = [];
  for (const path of candidates) {
    if (path === doc.file) {
      continue;
    }
    try {
      const { content } = await fetchRawText(slug, path, { refHint: doc.ref }, fetchImpl);
      if (content.trim()) {
        results.push({ path, chunks: chunkMarkdown(content) });
      }
    } catch {
      // Unreachable or binary doc file — per-file indexing stays best-effort.
    }
    if (results.length >= MAX_DOCS_FILES) {
      break;
    }
  }
  return results;
}

/**
 * Candidate extra doc files: markdown under `docs/` (listed via the trees API,
 * shallower paths first) plus local `.md` links when the primary source is
 * llms.txt. Tree unavailability degrades to llms.txt links only.
 */
async function discoverDocFiles(slug: string, doc: RepoDocument, fetchImpl: FetchLike): Promise<string[]> {
  const linked = doc.source === "llms.txt" ? parseLocalDocLinks(doc.content) : [];
  let entries: RepoTreeEntry[] = [];
  try {
    entries = (await fetchRepoTree(slug, fetchImpl)).entries;
  } catch {
    // Trees API unreachable — llms.txt links may still resolve via raw fetches.
  }
  const isIndexable = (entry: RepoTreeEntry): boolean => entry.type === "blob" && (entry.size ?? 0) <= RAW_FILE_LIMIT;
  const docsDir = entries
    .filter((e) => isIndexable(e) && /^docs\/.*\.md$/i.test(e.path))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path))
    .map((e) => e.path);
  const known = new Set(entries.filter(isIndexable).map((e) => e.path));
  const linkedKnown = linked.filter((p) => known.size === 0 || known.has(p));
  return [...new Set([...docsDir, ...linkedKnown])].filter((p) => p !== doc.file).slice(0, MAX_DOCS_FILES);
}

/** Local `.md` links from an llms.txt index — remote/anchored links are ignored. */
function parseLocalDocLinks(markdown: string): string[] {
  const paths: string[] = [];
  for (const match of markdown.matchAll(/\]\(\s*([^)\s]+)\s*\)/g)) {
    const href = match[1];
    if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href) || !/\.mdx?$/i.test(href)) {
      continue;
    }
    try {
      paths.push(assertRepoRelativePath(href));
    } catch {
      // `../` escapes and the like are not repository files.
    }
  }
  return [...new Set(paths)];
}
