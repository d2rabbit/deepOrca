import { useCallback, useEffect, useState, type JSX } from "react";
import type { ActionProgressEvent, ActionRunResult, CrgIndexEntry } from "../../shared/ipc";
import { api } from "../api";
import { useI18n, type MessageKey } from "../i18n";
import { Button, Input } from "../ui/index";

/**
 * Code Review panel — Phase 4 rework (spec §六/§十二).
 *
 * Replaces the legacy 3-tab (Quality/Risk/Architecture) + Smart-Review structure
 * with an IndexLibraryPanel-style workspace-partitioned layout: a single
 * workspace card + one-click action buttons that route through the unified
 * ActionRegistry (the same actions the agent reaches as LLM tools):
 *   - 审查 (review.run)         → ocr AI semantic review of uncommitted changes
 *   - 品牌漂移闸门 (design.drift) → E1d: deterministic dembrandt --compare gate
 *
 * Panel-derived state (workspace from api.crgList(), progress via the unified
 * onActionProgress event); the one prop, `onShowGraph`, hands the CRG
 * architecture-graph HTML up to the shared right dock in App.tsx.
 */

type ReviewActionId = "review.full" | "design.drift";

/** Shape of the design.drift action output (deterministic, zero LLM). */
type DriftOutput = {
  driftDetected?: boolean;
  score?: number;
  summary?: string;
  driftJson?: string;
};

export function CodeReviewPanel({ onShowGraph }: { onShowGraph: (html: string) => void }): JSX.Element {
  const { t } = useI18n();
  const [entry, setEntry] = useState<CrgIndexEntry | null>(null);
  const [running, setRunning] = useState<ReviewActionId | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [result, setResult] = useState<{ id: ReviewActionId; res: ActionRunResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Brand drift gate inputs (E1d). The baseline defaults to the conventional
  // location written by design.extract's persist instruction.
  const [driftBaseline, setDriftBaseline] = useState(".deeporca/design-baseline.json");
  const [driftCurrent, setDriftCurrent] = useState("");

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

  const runDrift = useCallback(() => {
    const baseline = driftBaseline.trim();
    const current = driftCurrent.trim();
    if (!baseline || !current) {
      setError(t("review.drift.hint"));
      return;
    }
    void run("design.drift", { baseline, current });
  }, [driftBaseline, driftCurrent, run, t]);

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

  const projectLabel = entry?.label ?? entry?.root ?? "";
  const hasGraph = entry?.hasGraph ?? false;

  const buttons: { id: ReviewActionId; labelKey: MessageKey; hintKey: MessageKey }[] = [
    { id: "review.full", labelKey: "review.action.full", hintKey: "review.action.full.hint" },
  ];

  const driftResult =
    result && result.id === "design.drift" && result.res.ok ? (result.res.output as DriftOutput) : null;

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
                ) : null}
              </div>
            ))}

            {/* E1d — brand drift gate: a deterministic review dimension (specs
                pre-production E1d). Inputs are the action's two required args. */}
            <div className="ui-review-drift">
              <div className="ui-review-drift-title">{t("review.drift.title")}</div>
              <p className="ui-muted" style={{ fontSize: 10, margin: "2px 0 6px" }}>
                {t("review.drift.hint")}
              </p>
              <Input
                type="text"
                value={driftBaseline}
                placeholder={t("review.drift.baseline")}
                onChange={(e) => setDriftBaseline(e.target.value)}
              />
              <Input
                type="text"
                value={driftCurrent}
                placeholder={t("review.drift.current")}
                onChange={(e) => setDriftCurrent(e.target.value)}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <Button size="sm" variant="subtle" onClick={runDrift} disabled={running !== null}>
                  {running === "design.drift" ? t("actions.running") : t("review.drift.run")}
                </Button>
                {running === "design.drift" && progress ? (
                  <span className="ui-muted" style={{ fontSize: 11 }}>
                    {progress}
                  </span>
                ) : null}
              </div>
              {result && result.id === "design.drift" ? (
                !result.res.ok ? (
                  <pre className="ui-muted" style={{ fontSize: 10, margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
                    {`✗ ${result.res.code}: ${result.res.error}`}
                  </pre>
                ) : driftResult ? (
                  <div className="ui-review-drift-result">
                    <div className={`ui-review-drift-badge${driftResult.driftDetected ? " bad" : " good"}`}>
                      {driftResult.driftDetected ? `⚠ ${t("review.drift.detected")}` : `✅ ${t("review.drift.pass")}`}
                      {typeof driftResult.score === "number"
                        ? ` · ${t("review.drift.score", { score: driftResult.score })}`
                        : ""}
                    </div>
                    {driftResult.summary ? (
                      <div className="ui-muted" style={{ fontSize: 11 }}>
                        {driftResult.summary}
                      </div>
                    ) : null}
                    {driftResult.driftJson ? (
                      <details>
                        <summary className="ui-muted" style={{ fontSize: 10.5, cursor: "pointer" }}>
                          {t("review.drift.details")}
                        </summary>
                        <pre
                          className="ui-muted"
                          style={{
                            fontSize: 10,
                            margin: "4px 0 0",
                            maxHeight: 220,
                            overflow: "auto",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {prettyJson(driftResult.driftJson)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                ) : null
              ) : null}
            </div>
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
  if (out && typeof out === "object" && "comments" in out) {
    const comments = (out as { comments: { file: string; line: number; severity: string; message: string }[] })
      .comments;
    if (Array.isArray(comments) && comments.length > 0) {
      return comments.map((c) => `[${c.severity}] ${c.file}:${c.line} — ${c.message}`).join("\n");
    }
  }
  try {
    return JSON.stringify(out, null, 2);
  } catch {
    return String(out);
  }
}

/** Pretty-print a raw JSON payload string (best effort, raw on parse failure). */
function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
