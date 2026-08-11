import { useCallback, useEffect, useState, type JSX } from "react";
import type { ActionProgressEvent, ActionRunResult, CrgIndexEntry } from "../../shared/ipc";
import { api } from "../api";
import { useI18n, type MessageKey } from "../i18n";
import { Button } from "../ui/index";

/**
 * Code Review panel — Phase 4 rework (spec §六/§十二).
 *
 * Replaces the legacy 3-tab (Quality/Risk/Architecture) + Smart-Review structure
 * with an IndexLibraryPanel-style workspace-partitioned layout: a single
 * workspace card + three one-click action buttons that route through the unified
 * ActionRegistry (the same actions the agent reaches as LLM tools):
 *   - 审查 (review.run)         → ocr AI semantic review of uncommitted changes
 *   - 风险图谱构建 (crg.reindex) → build/rebuild the code-review-graph
 *   - 架构生成 (arch-scan.run)  → architecture map via subagent
 *
 * Zero props — derives the current workspace from api.crgList() (mirroring
 * IndexLibraryPanel's api.codegraphList() pattern). Progress streams via the
 * unified onActionProgress event; results render in-panel.
 */

type ReviewActionId = "review.full";

export function CodeReviewPanel(): JSX.Element {
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
    async (id: ReviewActionId) => {
      setRunning(id);
      setResult(null);
      setError(null);
      setProgress("");
      try {
        const res = await api.actionRun(id, {});
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
