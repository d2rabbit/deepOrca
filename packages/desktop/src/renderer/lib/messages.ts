// Ported from the CLI's MessageView utils so the desktop UI renders tool calls,
// diffs, plans and thinking exactly like the terminal client.

import type { SessionMessage } from "../../shared/ipc";

export type ToolSummary = {
  name: string;
  params: string;
  ok: boolean;
  metadata: Record<string, unknown> | null;
};

export type DiffLine = { marker: string; content: string; kind: "added" | "removed" | "context" };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function formatStatusName(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "Tool";
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/** First non-blank line, whitespace-collapsed — the one-line preview shape
 *  shared by message previews and the message/ tool ResultHint. */
export function firstNonEmptyLine(value: string): string {
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/\s+/g, " ");
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

export function buildThinkingSummary(content: string, messageParams: unknown): string {
  if (content) {
    const normalized = content.replace(/\r?\n/g, " ").replace(/\s+/g, " ");
    let result = truncate(normalized, 120);
    if (result.endsWith(":") || result.endsWith("：")) {
      result = result.slice(0, -1);
    }
    return result;
  }
  const params = messageParams as { reasoning_content?: unknown } | null | undefined;
  if (typeof params?.reasoning_content === "string" && params.reasoning_content.trim()) {
    return params.reasoning_content;
  }
  return "";
}

function parseToolPayload(content: string | null): {
  name: string | null;
  ok: boolean;
  metadata: Record<string, unknown> | null;
} {
  if (!content) {
    return { name: null, ok: true, metadata: null };
  }
  try {
    const parsed = JSON.parse(content) as { name?: unknown; ok?: unknown; metadata?: unknown };
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : null,
      ok: parsed.ok !== false,
      metadata: isPlainRecord(parsed.metadata) ? parsed.metadata : null,
    };
  } catch {
    return { name: null, ok: true, metadata: null };
  }
}

function getMetaParams(message: SessionMessage): string {
  return typeof message.meta?.paramsMd === "string" ? message.meta.paramsMd.trim() : "";
}

export function buildToolSummary(message: SessionMessage): ToolSummary {
  const payload = parseToolPayload(message.content);
  const metaFn = message.meta?.function as { name?: unknown } | undefined;
  const metaFunctionName = typeof metaFn?.name === "string" ? metaFn.name : null;
  const name = payload.name || metaFunctionName || "tool";
  return { name, params: getMetaParams(message), ok: payload.ok !== false, metadata: payload.metadata };
}

export function formatToolParams(summary: ToolSummary): string {
  if (summary.name.toLowerCase() === "bash") {
    const value = summary.params.trim();
    const lines = value.split(/\r?\n/);
    if (lines.length <= 1) {
      return value;
    }
    return `${lines[0]} … ${lines[lines.length - 1]?.trimStart() ?? ""}`;
  }
  return truncate(firstNonEmptyLine(summary.params), 200);
}

export function getResultMd(message: SessionMessage): string {
  const raw = typeof message.meta?.resultMd === "string" ? message.meta.resultMd.trim() : "";
  if (!raw) return "";
  return wrapPlainStructured(raw);
}

/**
 * Detect bare structured payloads (JSON / HTML) that arrived without a fenced
 * code block, and wrap them so the markdown renderer pretty-prints them and
 * styles them with the per-language accent (amber for JSON, pink for HTML).
 * MCP tool results frequently arrive as raw JSON without a code fence;
 * web-fetch and similar tools return raw HTML. The result is the difference
 * between a wall of single-line text and a readable indented document.
 */
function wrapPlainStructured(value: string): string {
  if (value.includes("```")) return value; // already wrapped / multi-block
  return wrapPlainJson(value) ?? wrapPlainHtml(value) ?? value;
}

function wrapPlainJson(value: string): string | null {
  const first = value[0];
  if (first !== "{" && first !== "[") return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") return null;
    return "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
  } catch {
    return null;
  }
}

function wrapPlainHtml(value: string): string | null {
  // Only treat clearly-HTML payloads as HTML source (otherwise the markdown
  // renderer's inline-HTML pass might mis-render e.g. a leading "<" in some
  // other format). Heuristic: DOCTYPE, <html …>, or a balanced root tag.
  const head = value.slice(0, 200).toLowerCase();
  const looksLikeDoc = head.startsWith("<!doctype html") || head.startsWith("<html");
  const looksLikeRoot = /^<([a-z][\w-]*)(?:\s[^>]*)?>[\s\S]*<\/\1>/i.test(value.slice(0, 4096));
  if (!looksLikeDoc && !looksLikeRoot) return null;
  return "```html\n" + value + "\n```";
}

export function getDiffLines(summary: ToolSummary): DiffLine[] {
  if (!summary.ok || !["edit", "write"].includes(summary.name.toLowerCase())) {
    return [];
  }
  const diffPreview = summary.metadata?.["diff_preview"];
  if (typeof diffPreview !== "string" || !diffPreview.trim()) {
    return [];
  }
  return diffPreview
    .split("\n")
    .filter((line) => line && !line.startsWith("--- ") && !line.startsWith("+++ ") && !line.startsWith("@@ "))
    .map((line): DiffLine => {
      if (line.startsWith("+")) {
        return { marker: "+", content: line.slice(1), kind: "added" };
      }
      if (line.startsWith("-")) {
        return { marker: "-", content: line.slice(1), kind: "removed" };
      }
      return { marker: " ", content: line.startsWith(" ") ? line.slice(1) : line, kind: "context" };
    });
}

export function getPlanLines(summary: ToolSummary): string[] {
  // Case-insensitive like every other tool-name comparison in this tree —
  // an exact `!== "UpdatePlan"` silently dropped plans from any caller that
  // spelled the name differently (empty plan card, vanished task list).
  if (!summary.ok || summary.name.toLowerCase() !== "updateplan") {
    return [];
  }
  const plan = summary.metadata?.["plan"];
  if (typeof plan !== "string" || !plan.trim()) {
    return [];
  }
  return plan
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

/**
 * Port of CLI's findExpandedThinkingId — at most one thinking block is expanded,
 * and it resets when a non-thinking assistant message arrives.
 */
export function findExpandedThinkingId(messages: SessionMessage[]): string | null {
  let expanded: string | null = null;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (message.meta?.asThinking) {
      expanded = message.id;
    } else {
      expanded = null;
    }
  }
  return expanded;
}
