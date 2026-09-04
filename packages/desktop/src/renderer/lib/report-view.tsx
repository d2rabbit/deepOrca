/**
 * Review-report finding parsing + rendering helpers, shared by the main-area
 * review workbench (ReviewWorkspace) and the task hub's quick report sheet
 * (QuickReportSheet). Extracted from ReviewWorkspace so the quick sheet can
 * reuse the exact same finding markup without pulling the whole workbench
 * (and its risk graph) into its import chain.
 */

import type { JSX } from "react";

export const SEV_CLASS: Record<string, string> = {
  critical: "sev-critical",
  high: "sev-high",
  medium: "sev-medium",
  low: "sev-low",
};

export interface ReportFinding {
  path: string;
  startLine: number;
  endLine?: number;
  severity?: string;
  content: string;
  existingCode?: string;
  suggestionCode?: string;
  crgRisk?: string;
}

/** Split the delegation `[SEVERITY] rest` content prefix. */
export function parseFinding(f: Record<string, unknown>): ReportFinding {
  const content = String(f.content ?? "");
  const m = content.match(/^\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s*([\s\S]*)$/);
  const str = (k: string): string | undefined => (typeof f[k] === "string" ? (f[k] as string) : undefined);
  return {
    path: String(f.path ?? ""),
    startLine: Number(f.startLine ?? f.start_line ?? 0) || 0,
    endLine: f.endLine != null || f.end_line != null ? Number(f.endLine ?? f.end_line) : undefined,
    severity: m ? m[1].toLowerCase() : (str("severity") ?? undefined),
    content: m ? m[2] : content,
    existingCode: str("existingCode") ?? str("existing_code"),
    suggestionCode: str("suggestionCode") ?? str("suggestion_code"),
    crgRisk: str("crgRisk"),
  };
}

/** Inline `code` spans inside a text segment (theme-aware chip). */
export function BodyText({ text }: { text: string }): JSX.Element {
  const pieces = text.split(/`([^`\n]+)`/g);
  return (
    <div className="body">
      {pieces.map((piece, i) =>
        i % 2 === 1 ? (
          <code key={i} className="inline">
            {piece}
          </code>
        ) : (
          <span key={i}>{piece}</span>
        )
      )}
    </div>
  );
}

/**
 * Finding body renderer (user ask 2026-09-01): the model writes markdown —
 * fenced ``` blocks inside the finding text used to render as literal fence
 * soup. Fenced blocks become real, theme-aware code blocks; everything else
 * keeps its pre-wrap text flow with inline `code` spans. An unmatched fence
 * (model truncation) still renders — the trailing block runs to the end of
 * the content.
 */
export function FindingBody({ content }: { content: string }): JSX.Element {
  const parts: JSX.Element[] = [];
  const fence = /```[ \t]*[A-Za-z0-9+#_-]*[ \t]*\r?\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let key = 0;
  for (const m of content.matchAll(fence)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(<BodyText key={key++} text={content.slice(last, start)} />);
    const code = m[1].replace(/\n$/, "");
    if (code.trim().length > 0) {
      parts.push(
        <pre key={key++} className="code fenced">
          <code>{code}</code>
        </pre>
      );
    }
    last = start + m[0].length;
  }
  if (last < content.length) parts.push(<BodyText key={key++} text={content.slice(last)} />);
  return <>{parts}</>;
}
