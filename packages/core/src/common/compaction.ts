/**
 * Compaction helpers (dsh P1-2: two-stage compaction).
 *
 * Stage A is model-free: oversized tool results inside the compaction range
 * are deterministically shrunk to head+tail excerpts and persisted, which is
 * free, instant, and often enough by itself to bring the context back under
 * the threshold. Stage B (the LLM summary) only runs when the projection still
 * exceeds the threshold afterwards. A pairing guard refuses to summarize
 * across a broken tool-call/result pairing — providers reject orphaned
 * results and the summary would lose the call context.
 */

import { countConversationTokens } from "./token-counter";

export type CompactionMessage = {
  role: string;
  content: string | null;
  messageParams?: unknown;
};

/** Stage-A thresholds: tool results over this size get truncated. */
export const TOOL_RESULT_TRUNCATION_THRESHOLD_CHARS = 8192;
/** Head and tail excerpt length kept by stage-A truncation. */
export const TOOL_RESULT_TRUNCATION_KEEP_CHARS = 1024;
/**
 * Stage A alone skips the LLM summary only when the projected context sits
 * this far under the threshold — the chars→tokens estimate is approximate, so
 * keep a wide margin (never skip a summary the real context still needs).
 */
export const STAGE_A_SKIP_HEADROOM = 0.7;

/**
 * Pre-flight budget ratio (P1): the main loop counts the exact payload it is
 * about to send and compacts BEFORE the request when that count reaches this
 * fraction of the threshold — the first oversized request no longer has to
 * hit the wall and recover via CONTEXT_WINDOW_EXCEEDED.
 */
export const PRE_COMPACT_RATIO = 0.9;

/**
 * Deterministically shrink an oversized tool result to a head+tail excerpt
 * plus a size marker. Returns null when the content is small enough to keep
 * verbatim (stage A is a no-op for it).
 */
export function truncateToolResultForCompaction(content: string | null): string | null {
  if (content == null || content.length <= TOOL_RESULT_TRUNCATION_THRESHOLD_CHARS) {
    return null;
  }
  const keep = TOOL_RESULT_TRUNCATION_KEEP_CHARS;
  const head = content.slice(0, keep);
  const tail = content.slice(-keep);
  const omitted = content.length - keep * 2;
  return (
    `[tool output truncated for compaction — original ${content.length} chars, kept first/last ${keep}]\n` +
    `${head}\n[… ${omitted} chars omitted …]\n${tail}`
  );
}

/**
 * Rough token projection over persisted conversation messages. Kept as an
 * export for the stage-A tests and any legacy caller; live call sites use
 * countConversationTokens (family-routed, tool-call aware) directly.
 * Delegates to the unified heuristic — see common/token-counter.ts.
 */
export function estimateConversationTokens(messages: CompactionMessage[]): number {
  return countConversationTokens("", messages);
}

/**
 * dsh P1-2 pairing guard: every tool result inside the compaction range must
 * have its calling assistant message (the tool_call_id owner) inside the range
 * too. Cutting half of a pair corrupts the replayed transcript.
 */
export function validateCompactionPairing(
  messages: CompactionMessage[],
  startIndex: number,
  endIndex: number
): boolean {
  const callIds = new Set<string>();
  for (let i = startIndex; i < endIndex && i < messages.length; i += 1) {
    const message = messages[i];
    if (message.role !== "assistant") {
      continue;
    }
    const params = message.messageParams as { tool_calls?: Array<{ id?: unknown }> } | null | undefined;
    for (const call of params?.tool_calls ?? []) {
      if (call && typeof call === "object" && typeof call.id === "string") {
        callIds.add(call.id);
      }
    }
  }
  for (let i = startIndex; i < endIndex && i < messages.length; i += 1) {
    const message = messages[i];
    if (message.role !== "tool") {
      continue;
    }
    const toolCallId = (message.messageParams as { tool_call_id?: unknown } | null | undefined)?.tool_call_id;
    if (typeof toolCallId === "string" && !callIds.has(toolCallId)) {
      return false;
    }
  }
  return true;
}
