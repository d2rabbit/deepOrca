/**
 * Skill document sharding — G3 (specs/skill-routing 目标表): large SKILL.md
 * documents are split into heading-based shards; only the shards recalled for
 * the CURRENT user prompt are injected, plus a full section index so the agent
 * can ask for missing sections by name in a later turn.
 *
 * Pure string logic only — no embedding, no I/O, no LLM. The recall side
 * lives in skill-shard-recaller.ts; the injection decision in session.ts.
 *
 * Fail-open contract: `shardSkillDocument` returns null for documents below
 * the threshold (caller injects the full content — pre-G3 behavior), and
 * renderShardedContent is only called with a successfully sharded document.
 */

/** One recalled/injectable unit: a markdown section (heading + body). */
export interface SkillShard {
  /** 1-based ordinal, stable across renders (used by the index and requests). */
  id: number;
  heading: string;
  text: string;
}

/** A large SKILL.md split for recall-based injection. */
export interface ShardedSkillDocument {
  /** Everything before the first markdown heading (frontmatter block + intro). */
  header: string;
  shards: SkillShard[];
  totalChars: number;
}

export interface ShardOptions {
  /** Documents below this size are NOT sharded (null) — inject in full. */
  minChars: number;
  /** Hard cap per shard; oversized sections are split with (continued) markers. */
  maxShardChars: number;
}

export const DEFAULT_SHARD_MIN_CHARS = 6000;
export const DEFAULT_SHARD_MAX_SHARD_CHARS = 4000;

const HEADING_RE = /^#{1,3} +(.*)$/;

/**
 * Split a SKILL.md into heading-based shards. Returns null when the document
 * is below `minChars` (small skills keep the full-injection behavior) or has
 * no headings to split on (a single monolithic block stays whole).
 */
export function shardSkillDocument(content: string, opts: Partial<ShardOptions> = {}): ShardedSkillDocument | null {
  const minChars = opts.minChars ?? DEFAULT_SHARD_MIN_CHARS;
  const maxShardChars = opts.maxShardChars ?? DEFAULT_SHARD_MAX_SHARD_CHARS;
  if (content.length < minChars) return null;

  const lines = content.split("\n");
  const sections: Array<{ heading: string; body: string[] }> = [];
  const header: string[] = [];
  let current: { heading: string; body: string[] } | null = null;
  let sawHeading = false;

  for (const line of lines) {
    const match = line.match(HEADING_RE);
    if (match) {
      sawHeading = true;
      if (current) sections.push(current);
      current = { heading: match[1]!.trim(), body: [line] };
    } else if (current) {
      current.body.push(line);
    } else {
      header.push(line);
    }
  }
  if (current) sections.push(current);
  if (!sawHeading) return null; // monolithic — nothing to shard on

  // Hard-split any section exceeding maxShardChars at line boundaries. A
  // single line longer than the cap stays whole (splitting mid-line would
  // corrupt code blocks/tables); empty trailing parts are dropped.
  const shards: SkillShard[] = [];
  for (const section of sections) {
    const whole = section.body.join("\n");
    if (whole.length <= maxShardChars) {
      shards.push({ id: shards.length + 1, heading: section.heading, text: whole });
      continue;
    }
    let part = 0;
    let buffer: string[] = [];
    let buffered = 0;
    const flush = () => {
      const text = buffer.join("\n");
      buffer = [];
      buffered = 0;
      if (text.trim().length === 0) return;
      part += 1;
      shards.push({
        id: shards.length + 1,
        heading: part > 1 ? `${section.heading} (continued ${part})` : section.heading,
        text,
      });
    };
    for (const line of section.body) {
      // +1 for the "\n" join; keep at least one line even if it alone overflows.
      if (buffered > 0 && buffered + line.length + 1 > maxShardChars) {
        flush();
      }
      buffer.push(line);
      buffered += line.length + 1;
    }
    flush();
  }

  return { header: header.join("\n").trim(), shards, totalChars: content.length };
}

/**
 * Render the injected content for a sharded skill: header + full section
 * index + the recalled shards verbatim + a retrieval note for the rest.
 * The caller wraps this in the standard `<name-skill>` block.
 */
export function renderShardedContent(doc: ShardedSkillDocument, picked: SkillShard[]): string {
  const pickedIds = new Set(picked.map((s) => s.id));
  const index = doc.shards.map((s) => `${s.id}. ${s.heading}`).join("\n");
  const sections = picked
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((s) => s.text.trim())
    .join("\n\n");
  const missing = doc.shards.filter((s) => !pickedIds.has(s.id));
  const note =
    missing.length > 0
      ? `\n<!-- ${missing.length} more section(s) omitted for brevity (full index above). Ask the user to re-run with the section number or heading in the prompt to load them. -->`
      : "";

  return `${doc.header ? `${doc.header}\n\n` : ""}## Section index\n\n${index}\n\n## Recalled sections (matched to the current request)\n\n${sections}${note}`;
}
