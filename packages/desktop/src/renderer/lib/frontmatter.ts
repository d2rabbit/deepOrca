/**
 * Leading YAML frontmatter block matcher (`---\n…\n---` plus a trailing
 * newline or EOF). Shared by StreamdownView (strip before render) and
 * KnowledgePanel (title extraction + H1 dedup) so the boundary rule lives
 * in exactly one place — group 1 captures the YAML body.
 */
export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:[ \t]*(?:\r?\n|$))/;

/**
 * Strip a leading YAML frontmatter block (openwiki pages, some skills and
 * specs carry one). Neither remark nor marked parses frontmatter: without
 * stripping, `---\nkey: value\n---` renders as an <hr> plus a giant heading
 * of raw YAML at the top of every wiki page.
 */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return text;
  const match = text.match(FRONTMATTER_RE);
  return match ? text.slice(match[0].length) : text;
}
