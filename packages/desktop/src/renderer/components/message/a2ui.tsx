/**
 * a2ui — 拆分自 Message.tsx（落地实施方案 §八）。
 */
import type { SessionMessage } from "../../../shared/ipc";

export function extractA2uiPayload(message: SessionMessage): string | null {
  try {
    const parsed = JSON.parse(message.content || "{}");
    // The MCP executor (mcp-manager.ts) lifts any resource with
    // mimeType `application/a2ui+json` into `metadata.a2ui` — this is the
    // only path the built-in a2ui server produces, and it is always set
    // when an A2UI surface is returned. The previous regex fallback that
    // tried to scrape the payload out of `output` was unreachable in
    // practice and corrupted escaped JSON; removed.
    const meta = parsed.metadata ?? {};
    // metadata.a2ui is already a JSON string (mcp-manager lifts the
    // `application/a2ui+json` resource's `.text`, which itself is
    // JSON.stringify(messages) from a2ui-mcp.ts). Stringifying it again would
    // double-encode and break processor.ts's JSON.parse. Mirror App.tsx's
    // typeof check. Only stringify if it somehow arrives as an object.
    if (meta.a2ui) return typeof meta.a2ui === "string" ? meta.a2ui : JSON.stringify(meta.a2ui);
    return null;
  } catch {
    return null;
  }
}

/** Extract the text summary from an A2UI tool result. */
export function extractA2uiSummary(message: SessionMessage): string | undefined {
  try {
    const parsed = JSON.parse(message.content || "{}");
    return typeof parsed.output === "string" ? parsed.output.split("\n")[0] : undefined;
  } catch {
    return undefined;
  }
}
