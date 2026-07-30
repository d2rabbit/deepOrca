/**
 * RichToolResult — structured rendering for specific tool types.
 *
 * When a tool result matches a known pattern (codegraph symbol tree,
 * code review comments, web search results), this component renders
 * a richer UI instead of plain text/markdown.
 *
 * Detection happens by inspecting the tool name + result metadata.
 */

import { useMemo, useState, type JSX } from "react";
import type { SessionMessage } from "../../shared/ipc";
import { buildToolSummary } from "../lib/messages";
import { useI18n } from "../i18n";

type Props = {
  message: SessionMessage;
};

/** Check if a tool result can be rich-rendered. Returns the rich type or null. */
export function getRichToolType(message: SessionMessage): string | null {
  const summary = buildToolSummary(message);
  const name = summary.name.toLowerCase();

  // CodeGraph explore results — contain symbol/file/call info
  if (name.includes("codegraph") && name.includes("explore")) return "symbol-tree";

  // Code review (ocr) results — contain ReviewComment array
  if (name === "review" || (name.includes("ocr") && summary.ok)) return "review-comments";

  // WebSearch results — contain search result links
  if (name === "websearch" || name.includes("web_search")) return "search-results";

  return null;
}

export function RichToolResult({ message }: Props): JSX.Element | null {
  const richType = getRichToolType(message);
  if (!richType) return null;

  switch (richType) {
    case "symbol-tree":
      return <SymbolTreeResult message={message} />;
    case "review-comments":
      return <ReviewCommentsResult message={message} />;
    case "search-results":
      return <SearchResultsResult message={message} />;
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// #11 — CodeGraph Symbol Tree (collapsible)
// ═══════════════════════════════════════════════════════════════════════════════

function SymbolTreeResult({ message }: { message: SessionMessage }): JSX.Element | null {
  const { t } = useI18n();
  const text = message.content || "";

  // Parse codegraph output into a tree structure.
  // Output typically contains file paths, symbols, and call relationships.
  const tree = useMemo(() => parseSymbolTree(text), [text]);

  if (tree.length === 0) return null;

  return (
    <div className="ui-rich-result ui-symbol-tree">
      <div className="ui-rich-result-label">📁 Symbols</div>
      <div className="ui-symbol-tree-body">
        {tree.map((node, i) => (
          <SymbolNode key={i} node={node} depth={0} />
        ))}
      </div>
    </div>
  );
}

type SymbolNode = { label: string; children?: SymbolNode[]; kind?: string };

function SymbolNode({ node, depth }: { node: SymbolNode; depth: number }): JSX.Element {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const icon = node.kind === "file" ? "📄" : node.kind === "function" ? "ƒ" : node.kind === "class" ? "C" : "•";

  return (
    <div className="ui-symbol-node" style={{ paddingLeft: `${depth * 12}px` }}>
      <div
        className={`ui-symbol-node-label${hasChildren ? " clickable" : ""}`}
        onClick={() => hasChildren && setOpen((v) => !v)}
      >
        {hasChildren ? (
          <span className="ui-symbol-chevron">{open ? "▾" : "▸"}</span>
        ) : (
          <span className="ui-symbol-chevron" />
        )}
        <span className="ui-symbol-icon">{icon}</span>
        <span className="ui-symbol-text">{node.label}</span>
      </div>
      {hasChildren && open ? (
        <div className="ui-symbol-children">
          {node.children!.map((child, i) => (
            <SymbolNode key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function parseSymbolTree(text: string): SymbolNode[] {
  const lines = text.split("\n").filter((l) => l.trim());
  const roots: SymbolNode[] = [];
  const stack: Array<{ node: SymbolNode; depth: number }> = [];

  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    const depth = Math.floor(indent / 2);

    // Detect kind from content
    let kind: string | undefined;
    if (trimmed.match(/\.(ts|js|tsx|jsx|py|rs|go|java|kt|swift|c|cpp)$/)) kind = "file";
    else if (trimmed.match(/^(function|def|fn|func|method)\s/i)) kind = "function";
    else if (trimmed.match(/^(class|struct|interface|type|enum)\s/i)) kind = "class";

    const node: SymbolNode = { label: trimmed.replace(/^[├└│─\s]+/, ""), kind };

    while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      const parent = stack[stack.length - 1]!.node;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    }
    stack.push({ node, depth });
  }

  return roots.slice(0, 50); // Limit to prevent huge trees
}

// ═══════════════════════════════════════════════════════════════════════════════
// #13 — Code Review Comments (severity grouped)
// ═══════════════════════════════════════════════════════════════════════════════

type ReviewItem = { file: string; line: number; severity: string; message: string; suggestion?: string };

function ReviewCommentsResult({ message }: { message: SessionMessage }): JSX.Element | null {
  const { t } = useI18n();
  const comments = useMemo(() => parseReviewComments(message.content || ""), [message.content]);

  if (comments.length === 0) return null;

  const critical = comments.filter((c) => c.severity === "critical");
  const warnings = comments.filter((c) => c.severity === "warning");
  const info = comments.filter((c) => c.severity === "info" || !c.severity);

  return (
    <div className="ui-rich-result ui-review-grouped">
      <div className="ui-rich-result-label">🔍 Code Review</div>
      {critical.length > 0 ? <ReviewGroup title="Critical" color="var(--ui-danger, #ef4444)" items={critical} /> : null}
      {warnings.length > 0 ? (
        <ReviewGroup title="Warnings" color="var(--ui-warning, #f59e0b)" items={warnings} />
      ) : null}
      {info.length > 0 ? <ReviewGroup title="Info" color="var(--ui-text-tertiary, #888)" items={info} /> : null}
    </div>
  );
}

function ReviewGroup({ title, color, items }: { title: string; color: string; items: ReviewItem[] }): JSX.Element {
  return (
    <div className="ui-review-group">
      <div className="ui-review-group-header" style={{ color }}>
        <span className="ui-review-group-dot" style={{ background: color }} />
        {title} ({items.length})
      </div>
      {items.map((item, i) => (
        <div key={i} className="ui-review-item">
          <span className="ui-review-item-file">
            {item.file}:{item.line}
          </span>
          <div className="ui-review-item-msg">{item.message}</div>
          {item.suggestion ? <div className="ui-review-item-sug">{item.suggestion}</div> : null}
        </div>
      ))}
    </div>
  );
}

function parseReviewComments(text: string): ReviewItem[] {
  try {
    const parsed = JSON.parse(text);
    const comments = parsed.comments ?? parsed ?? [];
    if (!Array.isArray(comments)) return [];
    return comments.map((c: Record<string, unknown>) => ({
      file: String(c.file ?? ""),
      line: Number(c.line ?? 0),
      severity: String(c.severity ?? "info"),
      message: String(c.message ?? ""),
      suggestion: c.suggestion ? String(c.suggestion) : undefined,
    }));
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// #15 — Web Search Results (card layout)
// ═══════════════════════════════════════════════════════════════════════════════

type SearchResult = { title: string; url: string; snippet: string };

function SearchResultsResult({ message }: { message: SessionMessage }): JSX.Element | null {
  const results = useMemo(() => parseSearchResults(message.content || ""), [message.content]);

  if (results.length === 0) return null;

  return (
    <div className="ui-rich-result ui-search-cards">
      <div className="ui-rich-result-label">🔎 Search Results ({results.length})</div>
      {results.map((r, i) => (
        <div key={i} className="ui-search-card">
          <a className="ui-search-card-title" href={r.url} target="_blank" rel="noopener noreferrer">
            {r.title}
          </a>
          <div className="ui-search-card-url">{r.url}</div>
          {r.snippet ? <div className="ui-search-card-snippet">{r.snippet}</div> : null}
        </div>
      ))}
    </div>
  );
}

function parseSearchResults(text: string): SearchResult[] {
  try {
    const parsed = JSON.parse(text);
    const results = parsed.results ?? parsed.items ?? parsed ?? [];
    if (!Array.isArray(results)) return [];
    return results.slice(0, 10).map((r: Record<string, unknown>) => ({
      title: String(r.title ?? r.name ?? ""),
      url: String(r.url ?? r.link ?? r.href ?? "#"),
      snippet: String(r.snippet ?? r.description ?? r.summary ?? ""),
    }));
  } catch {
    return [];
  }
}
