import type { DocChunk, GitmcpStore } from "./store";
import type { DocSource, FetchLike } from "./github";
import { fetchRepoDocumentation } from "./github";

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
};

/**
 * Fetch a repository's documentation, chunk it, and replace its index in the
 * store. Throws when the network fetch fails (callers decide how to fall back).
 */
export async function indexRepository(
  slug: string,
  store: GitmcpStore,
  fetchImpl: FetchLike = fetch
): Promise<IndexResult> {
  const doc = await fetchRepoDocumentation(slug, fetchImpl);
  const chunks = chunkMarkdown(doc.content);
  store.upsertRepoDocument(slug, doc.source, chunks);
  return { docSource: doc.source, chunkCount: chunks.length };
}
