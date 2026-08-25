import { useCallback, useEffect, useState, type JSX } from "react";
import type { ActionProgressEvent, ActionRunResult, CrgIndexEntry } from "../../shared/ipc";
import { api } from "../api";
import { useI18n, type MessageKey } from "../i18n";
import { Button } from "../ui/index";
import { extractReviewFindings, type ReviewFinding } from "../lib/review-fix";

/**
 * Code Review panel — Phase 4 rework (spec §六/§十二).
 *
 * Replaces the legacy 3-tab (Quality/Risk/Architecture) + Smart-Review structure
 * with an IndexLibraryPanel-style workspace-partitioned layout: a single
 * workspace card + one-click action buttons that route through the unified
 * ActionRegistry (the same actions the agent reaches as LLM tools):
 *   - 审查 (review.run/review.full) → OCR semantic review + CRG risk analysis
 *
 * Pure code review — the brand drift gate (design.drift) moved to DesignPanel
 * (specs/ui-domain-regroup, 2026-08-21).
 *
 * Panel-derived state (workspace from api.crgList(), progress via the unified
 * onActionProgress event); `onShowGraph` hands the CRG architecture-graph
 * HTML up to the shared right dock, and `onOneClickFix` receives the CURRENT
 * findings so App can inject the fix plan into session mode (一键修复).
 */

type ReviewActionId = "review.full";

export function CodeReviewPanel({
  onShowGraph,
  onOneClickFix,
  onAskInChat,
}: {
  onShowGraph: (html: string) => void;
  /** One-click fix: hand the current findings to App (plan → session → fix). */
  onOneClickFix: (findings: ReviewFinding[]) => void;
  /** Flow bridge: quote the findings into the chat composer for follow-up. */
  onAskInChat?: (findings: ReviewFinding[]) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [entry, setEntry] = useState<CrgIndexEntry | null>(null);
  const [running, setRunning] = useState<ReviewActionId | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [result, setResult] = useState<{ id: ReviewActionId; res: ActionRunResult } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve the current workspace + CRG graph state (mirrors IndexLibraryPanel).
  const reload = useCallback(async () => {
    try {
      const entries = await api.crgList();
      setEntry(entries.length > 0 ? entries[0] : null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Refresh the graph-state dot whenever a CRG rebuild settles — including
  // out-of-band builds (agent-driven crg.reindex, post-turn auto sync). The
  // dot used to load once and only refresh after THIS panel's own actions,
  // so graphs built elsewhere left it stale (index-module stuck-state class).
  useEffect(() => {
    const unsub = api.onCrgProgress((evt: { done?: boolean }) => {
      if (evt.done) void reload();
    });
    return unsub;
  }, [reload]);

  // Subscribe to the unified action progress stream while an action runs.
  useEffect(() => {
    if (!running) {
      setProgress("");
      return;
    }
    const unsub = api.onActionProgress((evt: ActionProgressEvent) => {
      if (evt.actionId === running) {
        setProgress(evt.percent != null ? `${evt.percent}% — ${evt.message}` : evt.message);
      }
    });
    return unsub;
  }, [running]);

  const run = useCallback(
    async (id: ReviewActionId, params: Record<string, unknown> = {}) => {
      setRunning(id);
      setResult(null);
      setError(null);
      setProgress("");
      try {
        const res = await api.actionRun(id, params);
        setResult({ id, res });
        // Refresh the graph-state dot after a completed review (review.full
        // may have built/enriched via CRG).
        void reload();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(null);
      }
    },
    [reload]
  );

  // CRG architecture graph: visualize emits a self-contained D3 HTML page that
  // renders in the shared right dock — App owns the single-slot mutex with the
  // design preview. Lost in the Phase-4 rework, restored 2026-08-19.
  const [graphLoading, setGraphLoading] = useState(false);
  const viewGraph = useCallback(async () => {
    setGraphLoading(true);
    try {
      const res = await api.crgVisualize();
      if (res.html) onShowGraph(res.html);
      else setError(res.error ?? t("app.requestFailed"));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGraphLoading(false);
    }
  }, [onShowGraph, t]);

  // Findings from the LATEST result drive the one-click fix button.
  const currentFindings: ReviewFinding[] = result && result.res.ok ? extractReviewFindings(result.res.output) : [];

  const projectLabel = entry?.label ?? entry?.root ?? "";
  const hasGraph = entry?.hasGraph ?? false;

  const buttons: { id: ReviewActionId; labelKey: MessageKey; hintKey: MessageKey }[] = [
    { id: "review.full", labelKey: "review.action.full", hintKey: "review.action.full.hint" },
  ];

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("review.title")}</span>
      </div>
      <div className="ui-side-panel-body">
        {!projectLabel ? (
          <div className="ui-side-panel-empty">{t("review.noWorkspace")}</div>
        ) : (
          <div className="ui-index-current">
            <div className="ui-index-current-info">
              <div className="ui-index-name">{projectLabel}</div>
              <div className="ui-index-path">{entry?.root}</div>
              <div className={`ui-index-state${hasGraph ? " on" : ""}`}>
                {hasGraph ? t("review.graphReady") : t("review.graphUnbuilt")}
              </div>
            </div>

            {/* Architecture graph — always mounted, gated on graph state (same
                stability rule as the rail buttons). Opens in the right dock. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Button size="sm" variant="subtle" disabled={!hasGraph || graphLoading} onClick={() => void viewGraph()}>
                {graphLoading ? t("actions.running") : t("crg.viewGraph")}
              </Button>
            </div>

            {error ? <div className="ui-error">{error}</div> : null}

            {buttons.map((b) => (
              <div key={b.id} style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Button size="sm" variant="subtle" onClick={() => void run(b.id)} disabled={running !== null}>
                    {running === b.id ? t("actions.running") : t(b.labelKey)}
                  </Button>
                  {running === b.id && progress ? (
                    <span className="ui-muted" style={{ fontSize: 11 }}>
                      {progress}
                    </span>
                  ) : null}
                </div>
                <p className="ui-muted" style={{ fontSize: 10, margin: 0 }}>
                  {t(b.hintKey)}
                </p>
                {result && result.id === b.id ? (
                  <>
                    <pre
                      className="ui-muted"
                      style={{
                        fontSize: 10,
                        margin: 0,
                        maxHeight: 200,
                        overflow: "auto",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {formatResult(result.res)}
                    </pre>
                    {currentFindings.length > 0 ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                        <Button
                          size="sm"
                          variant="subtle"
                          disabled={running !== null}
                          title={t("review.fixHint")}
                          onClick={() => onOneClickFix(currentFindings)}
                        >
                          🔧 {t("review.oneClickFix")}
                        </Button>
                        {onAskInChat ? (
                          <Button
                            size="sm"
                            variant="subtle"
                            disabled={running !== null}
                            title={t("review.askInChat")}
                            onClick={() => onAskInChat(currentFindings)}
                          >
                            💬 {t("review.askInChat")}
                          </Button>
                        ) : null}
                        <span className="ui-muted" style={{ fontSize: 10 }}>
                          {t("review.findingsCount", { n: currentFindings.length })}
                        </span>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Render an ActionRunResult as readable text for the in-panel result area. */
function formatResult(res: ActionRunResult): string {
  if (!res.ok) return `✗ ${res.code}: ${res.error}`;
  const out = res.output;
  if (typeof out === "string") return out;
  const findings = extractReviewFindings(out);
  if (findings.length > 0) {
    return findings
      .map(
        (c) =>
          `${c.crgRisk ? `[${c.crgRisk}] ` : ""}${c.path}:${c.startLine} — ${c.content.replace(/\s+/g, " ").trim()}`
      )
      .join("\n");
  }
  try {
    return JSON.stringify(out, null, 2);
  } catch {
    return String(out);
  }
}
