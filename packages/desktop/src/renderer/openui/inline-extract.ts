/**
 * Inline-mode extraction for OpenUI Lang (plan Batch 8, M6).
 *
 * Extracts the last ```openui-lang fenced code block from assistant text —
 * the channel the OpenUI docs call inlineMode: the model embeds the program
 * in its reply and the preview renders it without waiting for a tool call.
 *
 * Pure function; deduplication against the render_openui tool channel is the
 * caller's invariant (same code already delivered by the tool ⇒ skip).
 */

export type InlineOpenuiBlock = {
  code: string;
  /** Whether the closing fence has arrived yet (false ⇒ still streaming). */
  complete: boolean;
};

const FENCE_OPEN = /```openui-lang[^\S\n]*\n?/gi;

export function extractOpenuiFence(text: string): InlineOpenuiBlock | null {
  if (!text) return null;
  // Find the LAST opening fence; inline blocks replace each other.
  let openIndex = -1;
  let openLength = 0;
  for (const match of text.matchAll(FENCE_OPEN)) {
    openIndex = match.index ?? -1;
    openLength = match[0].length;
  }
  if (openIndex < 0) return null;

  const body = text.slice(openIndex + openLength);
  const closeIndex = body.indexOf("```");
  if (closeIndex >= 0) {
    return { code: body.slice(0, closeIndex).trim(), complete: true };
  }
  return { code: body.trim(), complete: false };
}
