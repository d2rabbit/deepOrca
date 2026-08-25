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
  const content = message.content || "";

  // CodeGraph explore results — contain symbol/file/call info
  if (name.includes("codegraph") && name.includes("explore")) return "symbol-tree";

  // Code review (ocr) results — contain ReviewComment array
  if (name === "review" || (name.includes("ocr") && summary.ok)) return "review-comments";

  // WebSearch results — contain search result links
  if (name === "websearch" || name.includes("web_search")) return "search-results";

  // Git diff/status results — contain file changes
  if ((name === "gitdiff" || name === "git_diff" || name.includes("git_status")) && content.includes("{"))
    return "git-changes";

  // CRG detect_changes results — contain risk scores
  if ((name.includes("detect_changes") || name.includes("crg")) && content.includes("risk")) return "risk-analysis";

  // GitMCP/wiki search results — contain page entries
  if ((name.includes("search_documentation") || name.includes("wiki")) && content.includes("{")) return "wiki-pages";

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
    case "git-changes":
      return <GitChangesResult message={message} />;
    case "risk-analysis":
      return <RiskAnalysisResult message={message} />;
    case "wiki-pages":
      return <WikiPagesResult message={message} />;
    default:
      return null;
  }
}

/** Parse-failure fallback for the rich renderers: a tool was routed here by
 *  name, but its content isn't the expected JSON shape. Returning null would
 *  leave the message row EMPTY (Message drops the plain ToolCard once a rich
 *  type matches) — the raw result must stay visible. */
function RichFallback({ message }: { message: SessionMessage }): JSX.Element {
  return (
    <div className="ui-rich-result ui-rich-fallback">
      <pre>{message.content || ""}</pre>
    </div>
  );
}

/** Only http(s) URLs become links — model-provided strings (or the "#"
 *  parse fallback) must never yield a clickable javascript:/data: href. */
function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// #11 — CodeGraph Symbol Tree (collapsible)
// ═══════════════════════════════════════════════════════════════════════════════

function SymbolTreeResult({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  const text = message.content || "";

  // Parse codegraph output into a tree structure.
  // Output typically contains file paths, symbols, and call relationships.
  const tree = useMemo(() => parseSymbolTree(text), [text]);

  if (tree.length === 0) return <RichFallback message={message} />;

  return (
    <div className="ui-rich-result ui-symbol-tree">
      <div className="ui-rich-result-label">📁 {t("rich.symbols")}</div>
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

function ReviewCommentsResult({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  const comments = useMemo(() => parseReviewComments(message.content || ""), [message.content]);

  if (comments.length === 0) return <RichFallback message={message} />;

  const critical = comments.filter((c) => c.severity === "critical");
  const warnings = comments.filter((c) => c.severity === "warning");
  const info = comments.filter((c) => c.severity === "info" || !c.severity);

  return (
    <div className="ui-rich-result ui-review-grouped">
      <div className="ui-rich-result-label">🔍 {t("rich.codeReview")}</div>
      {critical.length > 0 ? (
        <ReviewGroup title={t("rich.critical")} color="var(--ui-danger, #ef4444)" items={critical} />
      ) : null}
      {warnings.length > 0 ? (
        <ReviewGroup title={t("rich.warnings")} color="var(--ui-warning, #f59e0b)" items={warnings} />
      ) : null}
      {info.length > 0 ? (
        <ReviewGroup title={t("rich.info")} color="var(--ui-text-tertiary, #888)" items={info} />
      ) : null}
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

function SearchResultsResult({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  const results = useMemo(() => parseSearchResults(message.content || ""), [message.content]);

  if (results.length === 0) return <RichFallback message={message} />;

  return (
    <div className="ui-rich-result ui-search-cards">
      <div className="ui-rich-result-label">🔎 {t("rich.searchResults", { n: results.length })}</div>
      {results.map((r, i) => {
        const href = safeHref(r.url);
        return (
          <div key={i} className="ui-search-card">
            {href ? (
              <a className="ui-search-card-title" href={href} target="_blank" rel="noopener noreferrer">
                {r.title}
              </a>
            ) : (
              <span className="ui-search-card-title">{r.title}</span>
            )}
            <div className="ui-search-card-url">{r.url}</div>
            {r.snippet ? <div className="ui-search-card-snippet">{r.snippet}</div> : null}
          </div>
        );
      })}
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

// ═══════════════════════════════════════════════════════════════════════════════
// #12 — Git Changes (file list with status badges)
// ═══════════════════════════════════════════════════════════════════════════════

type GitChange = { file: string; status: string; insertions?: number; deletions?: number };

function GitChangesResult({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  const changes = useMemo(() => parseGitChanges(message.content || ""), [message.content]);
  if (changes.length === 0) return <RichFallback message={message} />;
  return (
    <div className="ui-rich-result ui-git-changes">
      <div className="ui-rich-result-label">📂 {t("rich.gitChanges", { n: changes.length })}</div>
      <div className="ui-git-changes-body">
        {changes.map((c, i) => (
          <div key={i} className="ui-git-change-row">
            <span className={`ui-git-status-badge ui-git-status-${c.status}`}>
              {c.status === "added"
                ? "A"
                : c.status === "modified"
                  ? "M"
                  : c.status === "deleted"
                    ? "D"
                    : c.status === "renamed"
                      ? "R"
                      : "?"}
            </span>
            <span className="ui-git-change-file">{c.file}</span>
            {c.insertions !== undefined || c.deletions !== undefined ? (
              <span className="ui-git-change-stats">
                {c.insertions ? <span className="ui-git-add">+{c.insertions}</span> : null}
                {c.deletions ? <span className="ui-git-del">-{c.deletions}</span> : null}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function parseGitChanges(text: string): GitChange[] {
  try {
    const parsed = JSON.parse(text);
    const items = parsed.changes ?? parsed.files ?? parsed ?? [];
    if (!Array.isArray(items)) return [];
    return items.slice(0, 50).map((item: Record<string, unknown>) => ({
      file: String(item.file ?? item.path ?? item.filename ?? ""),
      status: String(item.status ?? item.change ?? "modified"),
      insertions: typeof item.insertions === "number" ? item.insertions : undefined,
      deletions: typeof item.deletions === "number" ? item.deletions : undefined,
    }));
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// #14 — CRG Risk Analysis (risk score heatmap)
// ═══════════════════════════════════════════════════════════════════════════════

type RiskItem = { name: string; riskScore: number; testCoverage?: boolean; securityRelevant?: boolean };

function RiskAnalysisResult({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  const data = useMemo(() => parseRiskAnalysis(message.content || ""), [message.content]);
  if (!data) return <RichFallback message={message} />;
  const riskColor = (score: number): string =>
    score >= 0.85 ? "var(--ui-danger, #ef4444)" : score >= 0.7 ? "var(--ui-warning, #f59e0b)" : "#3fb950";
  return (
    <div className="ui-rich-result ui-risk-analysis">
      <div className="ui-rich-result-label">
        🔥 {t("rich.riskAnalysis")}
        <span className="ui-risk-overall" style={{ color: riskColor(data.overallRisk) }}>
          {t("rich.riskOverall")}: {Math.round(data.overallRisk * 100)}%
        </span>
      </div>
      <div className="ui-risk-body">
        {data.items.slice(0, 20).map((item, i) => (
          <div key={i} className="ui-risk-item">
            <div className="ui-risk-item-header">
              <span className="ui-risk-item-name">{item.name}</span>
              <div className="ui-risk-item-badges">
                {item.securityRelevant ? <span className="ui-risk-badge sec">🔒 {t("rich.riskSec")}</span> : null}
                {item.testCoverage === false ? (
                  <span className="ui-risk-badge no-test">⚠ {t("rich.riskNoTest")}</span>
                ) : null}
                <span className="ui-risk-score" style={{ color: riskColor(item.riskScore) }}>
                  {Math.round(item.riskScore * 100)}%
                </span>
              </div>
            </div>
            <div className="ui-risk-bar">
              <div
                className="ui-risk-bar-fill"
                style={{ width: `${item.riskScore * 100}%`, background: riskColor(item.riskScore) }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function parseRiskAnalysis(text: string): { overallRisk: number; items: RiskItem[] } | null {
  try {
    const parsed = JSON.parse(text);
    const overall =
      typeof parsed.overallRisk === "number"
        ? parsed.overallRisk
        : typeof parsed.risk_score === "number"
          ? parsed.risk_score
          : 0;
    const functions = parsed.changedFunctions ?? parsed.functions ?? [];
    const items: RiskItem[] = (Array.isArray(functions) ? functions : []).map((f: Record<string, unknown>) => ({
      name: String(f.name ?? f.function ?? ""),
      riskScore: typeof f.riskScore === "number" ? f.riskScore : typeof f.risk_score === "number" ? f.risk_score : 0,
      testCoverage:
        typeof f.testCoverage === "boolean"
          ? f.testCoverage
          : typeof f.test_coverage === "boolean"
            ? f.test_coverage
            : undefined,
      securityRelevant:
        typeof f.securityRelevant === "boolean"
          ? f.securityRelevant
          : typeof f.security_relevant === "boolean"
            ? f.security_relevant
            : undefined,
    }));
    return { overallRisk: overall, items };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// #16 — Wiki/Page Navigation (page list with titles)
// ═══════════════════════════════════════════════════════════════════════════════

type WikiPage = { path: string; title: string };

function WikiPagesResult({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  const pages = useMemo(() => parseWikiPages(message.content || ""), [message.content]);
  if (pages.length === 0) return <RichFallback message={message} />;
  return (
    <div className="ui-rich-result ui-wiki-pages">
      <div className="ui-rich-result-label">📖 {t("rich.documentation", { n: pages.length })}</div>
      <div className="ui-wiki-pages-body">
        {pages.map((p, i) => (
          <div key={i} className="ui-wiki-page-row">
            <span className="ui-wiki-page-icon">📄</span>
            <span className="ui-wiki-page-title">{p.title}</span>
            <span className="ui-wiki-page-path">{p.path}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function parseWikiPages(text: string): WikiPage[] {
  try {
    const parsed = JSON.parse(text);
    const items = parsed.pages ?? parsed.results ?? parsed.items ?? parsed ?? [];
    if (!Array.isArray(items)) return [];
    return items.slice(0, 30).map((item: Record<string, unknown>) => ({
      path: String(item.path ?? item.url ?? item.href ?? ""),
      title: String(item.title ?? item.name ?? item.path ?? ""),
    }));
  } catch {
    return [];
  }
}
