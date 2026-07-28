import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { CrgIndexEntry, CrgProgressEvent, ReviewComment, ReviewProgressEvent } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton } from "../ui/index";
import { MermaidDiagram } from "./MermaidDiagram";

type ReviewTab = "quality" | "risk" | "architecture";

/**
 * Left-panel code review: three complementary tabs.
 *
 * - **Quality** (Tab 1): OCR (Alibaba Open Code Review) — LLM-based code
 *   quality, security, and correctness review of uncommitted changes.
 * - **Risk** (Tab 2): CRG (code-review-graph) — algorithm-driven structural
 *   impact analysis: risk scoring, blast radius, test gaps, affected flows.
 * - **Architecture** (Tab 3): CRG — community detection (Mermaid flow graph),
 *   hub/bridge nodes, surprising cross-module couplings.
 *
 * OCR answers "is this code written well?" (LLM judgment).
 * CRG answers "what does this change affect?" (graph algorithms).
 * They are complementary, not redundant.
 */
export function CodeReviewPanel(): JSX.Element {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<ReviewTab>("quality");

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("review.title")}</span>
      </div>
      <div className="ui-review-tabs">
        <button
          className={`ui-review-tab ${activeTab === "quality" ? "active" : ""}`}
          onClick={() => setActiveTab("quality")}
        >
          {t("review.tabQuality")}
        </button>
        <button
          className={`ui-review-tab ${activeTab === "risk" ? "active" : ""}`}
          onClick={() => setActiveTab("risk")}
        >
          {t("review.tabRisk")}
        </button>
        <button
          className={`ui-review-tab ${activeTab === "architecture" ? "active" : ""}`}
          onClick={() => setActiveTab("architecture")}
        >
          {t("review.tabArchitecture")}
        </button>
      </div>
      <div className="ui-side-panel-body">
        {activeTab === "quality" && <QualityReviewTab />}
        {activeTab === "risk" && <RiskAnalysisTab />}
        {activeTab === "architecture" && <ArchitectureTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab 1: Quality Review (OCR — LLM-based)
// ═══════════════════════════════════════════════════════════════════════════════

function QualityReviewTab(): JSX.Element {
  const { t } = useI18n();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [summary, setSummary] = useState<string>("");
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const rawOutputRef = useRef("");

  useEffect(() => {
    void api.reviewCheckAvailable().then((res) => {
      setAvailable(res.available);
      setVersion(res.version ?? "");
    });
  }, []);

  const parseReviewOutput = useCallback((raw: string) => {
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try {
        const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
          comments?: ReviewComment[];
          summary?: string;
        };
        if (Array.isArray(parsed.comments)) {
          setComments(parsed.comments);
          setSummary(parsed.summary ?? "");
          return;
        }
      } catch {
        // Fall through.
      }
    }
    const arrStart = raw.indexOf("[");
    const arrEnd = raw.lastIndexOf("]");
    if (arrStart >= 0 && arrEnd > arrStart) {
      try {
        const parsed = JSON.parse(raw.slice(arrStart, arrEnd + 1)) as ReviewComment[];
        if (Array.isArray(parsed)) {
          setComments(parsed);
          setSummary(`${parsed.length} comments`);
          return;
        }
      } catch {
        // Fall through.
      }
    }
    setComments([]);
    setSummary("");
  }, []);

  useEffect(() => {
    const off = api.onReviewProgress((event: ReviewProgressEvent) => {
      if (event.done) {
        setBusy(false);
        parseReviewOutput(rawOutputRef.current);
        return;
      }
      if (event.stream === "stdout") {
        rawOutputRef.current += event.chunk;
      }
      setLogLines((prev) => {
        const text = event.chunk.replace(/\n$/, "");
        if (!text) return prev;
        const lines = text.split("\n");
        const next = [...prev, ...lines];
        return next.length > 300 ? next.slice(next.length - 300) : next;
      });
    });
    return off;
  }, [parseReviewOutput]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  const runReview = useCallback(async () => {
    setBusy(true);
    setComments([]);
    setSummary("");
    rawOutputRef.current = "";
    setLogLines(["$ ocr review --format json"]);
    await api.reviewRun();
  }, []);

  const severityColor = (sev: string): string => {
    switch (sev) {
      case "critical":
        return "var(--ui-danger, #ef4444)";
      case "warning":
        return "var(--ui-warning, #f59e0b)";
      default:
        return "var(--ui-text-tertiary, #888)";
    }
  };

  if (available === null) {
    return <div className="ui-side-panel-empty">{t("review.checking")}</div>;
  }

  if (!available) {
    return (
      <div className="ui-review-unavailable">
        <p>{t("review.notInstalled")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="ui-review-controls">
        <div className="ui-review-scope">{t("review.scope")}</div>
        <Button size="sm" onClick={() => void runReview()} disabled={busy}>
          {busy ? t("review.running") : t("review.run")}
        </Button>
      </div>
      {version ? <div className="ui-review-version">{version}</div> : null}
      {summary ? <div className="ui-review-summary">{summary}</div> : null}
      {comments.length > 0 ? (
        <div className="ui-review-comments">
          {comments.map((c, i) => (
            <div key={i} className="ui-review-comment">
              <div className="ui-review-comment-head">
                <span className="ui-review-severity" style={{ color: severityColor(c.severity) }}>
                  {c.severity}
                </span>
                <span className="ui-review-file">
                  {c.file}:{c.line}
                </span>
              </div>
              <div className="ui-review-message">{c.message}</div>
              {c.suggestion ? <div className="ui-review-suggestion">{c.suggestion}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
      {logLines.length > 0 ? (
        <ReviewLog
          lines={logLines}
          logEndRef={logEndRef}
          onClear={() => {
            setLogLines([]);
            setComments([]);
            setSummary("");
          }}
        />
      ) : null}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab 2: Risk Analysis (CRG — detect_changes + impact)
// ═══════════════════════════════════════════════════════════════════════════════

function RiskAnalysisTab(): JSX.Element {
  const { t } = useI18n();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [hasGraph, setHasGraph] = useState<boolean>(false);
  const [entries, setEntries] = useState<CrgIndexEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // CRG analysis results — fetched from the MCP server via the agent.
  // Since CRG runs as an MCP server, the agent calls detect_changes_tool etc.
  // directly. This tab provides the graph management UI (build/rebuild) and
  // surfaces the risk analysis the agent already has access to.
  // For direct UI integration, the results would be populated by calling
  // the CRG CLI's `detect-changes` subcommand. For now this tab focuses on
  // graph lifecycle + instructions to ask the agent.

  useEffect(() => {
    void api.crgCheckAvailable().then((res) => setAvailable(res.available));
    void api.crgList().then((res) => {
      setEntries(res);
      const current = res.find((e) => e.hasGraph);
      setHasGraph(!!current);
    });
  }, []);

  useEffect(() => {
    const off = api.onCrgProgress((event: CrgProgressEvent) => {
      if (event.done) {
        setBusy(false);
        void api.crgList().then((res) => {
          setEntries(res);
          setHasGraph(res.some((e) => e.hasGraph));
        });
        return;
      }
      setLogLines((prev) => {
        const text = event.chunk.replace(/\n$/, "");
        if (!text) return prev;
        const lines = text.split("\n");
        const next = [...prev, ...lines];
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
    });
    return off;
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  const buildGraph = useCallback(async () => {
    const currentEntry = entries.find((e) => e.hasGraph);
    const root = currentEntry?.root || entries[0]?.root;
    if (!root) return;
    setBusy(true);
    setLogLines([`$ uvx code-review-graph build`]);
    await api.crgReindex(root);
  }, [entries]);

  if (available === null) {
    return <div className="ui-side-panel-empty">{t("review.checking")}</div>;
  }

  if (!available) {
    return (
      <div className="ui-review-unavailable">
        <p>{t("crg.notInstalled")}</p>
        <p className="ui-review-hint">{t("crg.installHint")}</p>
      </div>
    );
  }

  return (
    <>
      {/* Graph status + build button */}
      <div className="ui-review-controls">
        <div className="ui-review-scope">{hasGraph ? t("crg.graphReady") : t("crg.noGraph")}</div>
        <Button size="sm" onClick={() => void buildGraph()} disabled={busy}>
          {busy ? t("crg.building") : hasGraph ? t("crg.rebuild") : t("crg.build")}
        </Button>
      </div>

      {/* When graph is ready, show analysis guidance */}
      {hasGraph ? (
        <div className="ui-crg-analysis-guide">
          <p className="ui-crg-hint">{t("crg.askAgent")}</p>
          <ul className="ui-crg-examples">
            <li>{t("crg.exampleRisk")}</li>
            <li>{t("crg.exampleImpact")}</li>
            <li>{t("crg.exampleGaps")}</li>
          </ul>
        </div>
      ) : null}

      {/* Build log */}
      {logLines.length > 0 ? (
        <ReviewLog lines={logLines} logEndRef={logEndRef} onClear={() => setLogLines([])} />
      ) : null}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab 3: Architecture Overview (CRG — communities + hub/bridge)
// ═══════════════════════════════════════════════════════════════════════════════

function ArchitectureTab(): JSX.Element {
  const { t } = useI18n();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [hasGraph, setHasGraph] = useState<boolean>(false);

  useEffect(() => {
    void api.crgCheckAvailable().then((res) => setAvailable(res.available));
    void api.crgList().then((res) => {
      setHasGraph(res.some((e) => e.hasGraph));
    });
  }, []);

  if (available === null) {
    return <div className="ui-side-panel-empty">{t("review.checking")}</div>;
  }

  if (!available) {
    return (
      <div className="ui-review-unavailable">
        <p>{t("crg.notInstalled")}</p>
      </div>
    );
  }

  if (!hasGraph) {
    return (
      <div className="ui-review-unavailable">
        <p>{t("crg.noGraph")}</p>
        <p className="ui-review-hint">{t("crg.switchToRisk")}</p>
      </div>
    );
  }

  return (
    <div className="ui-crg-architecture-guide">
      <p className="ui-crg-hint">{t("crg.askAgentArchitecture")}</p>
      <ul className="ui-crg-examples">
        <li>{t("crg.exampleArchitecture")}</li>
        <li>{t("crg.exampleCommunities")}</li>
        <li>{t("crg.exampleHubBridge")}</li>
        <li>{t("crg.exampleSurprise")}</li>
      </ul>

      {/* Preview placeholder for Mermaid diagram.
          The agent generates the Mermaid graph text via the CRG MCP server's
          get_architecture_overview_tool, then renders it in chat. When we add
          direct CLI integration, this panel will render the graph inline. */}
      <div className="ui-crg-mermaid-placeholder">
        <MermaidDiagram
          chart={
            'graph TD\n  subgraph "Module A"\n    A1[Function 1]\n    A2[Function 2]\n  end\n  subgraph "Module B"\n    B1[Handler]\n  end\n  A1 -->|calls| A2\n  A2 -.->|depends| B1'
          }
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared: scrollable log pane
// ═══════════════════════════════════════════════════════════════════════════════

function ReviewLog({
  lines,
  logEndRef,
  onClear,
}: {
  lines: string[];
  logEndRef: React.RefObject<HTMLDivElement | null>;
  onClear: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ui-index-log">
      <div className="ui-index-log-head">
        <span>{t("review.log")}</span>
        <IconButton onClick={onClear} title="✕" aria-label="close">
          ✕
        </IconButton>
      </div>
      <pre className="ui-index-log-body">
        {lines.join("\n")}
        <div ref={logEndRef} />
      </pre>
    </div>
  );
}
