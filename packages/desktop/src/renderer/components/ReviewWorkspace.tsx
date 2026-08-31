import { useCallback, useEffect, useState, type JSX } from "react";
import type { ActionProgressEvent, ActionRunResult, ReviewReportMeta } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";

/**
 * Review workspace surface — the main-area tab for ONE workspace (the review
 * module's counterpart of the knowledge tab; user ask 2026-08-31: the review
 * surface must follow the index-module pattern, never pop out).
 *
 * Header carries the review CONTROLS for this workspace: scope selector
 * (uncommitted / single commit / ref range / whole repository) + run button
 * (active workspace only — the action registry is bound to it). Two views:
 *   审查报告 — persisted report history (left rail) rendered as a
 *             self-contained page inside a sandboxed iframe;
 *   风险图谱 — the simplified in-app risk map, loaded on first open.
 */

type SubView = "reports" | "graph";
type Scope = "workspace" | "commit" | "range" | "all";

const STATUS_LABELS: Record<string, Record<string, string>> = {
  zh: {
    success: "成功",
    completed_with_warnings: "完成（有警告）",
    completed_with_errors: "完成（有错误）",
    skipped: "已跳过",
  },
  ja: {
    success: "成功",
    completed_with_warnings: "完了（警告あり）",
    completed_with_errors: "完了（エラーあり）",
    skipped: "スキップ",
  },
  ko: {
    success: "성공",
    completed_with_warnings: "완료(경고)",
    completed_with_errors: "완료(오류)",
    skipped: "건너뜀",
  },
};

export function ReviewWorkspace({ root, initialReportId }: { root: string; initialReportId?: string }): JSX.Element {
  const { t, locale } = useI18n();
  const statusLabel = (status: string): string =>
    STATUS_LABELS[locale === "zh-TW" || locale === "zh-HK" ? "zh" : locale]?.[status] ?? status;
  const timeLabel = (iso: string): string =>
    new Date(iso).toLocaleString(
      locale === "zh" || locale === "zh-TW" || locale === "zh-HK"
        ? "zh-CN"
        : locale === "ja"
          ? "ja-JP"
          : locale === "ko"
            ? "ko-KR"
            : "en-US",
      { hour12: false }
    );

  const [subView, setSubView] = useState<SubView>("reports");
  const [reports, setReports] = useState<ReviewReportMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(initialReportId ?? null);
  const [html, setHtml] = useState<string | null>(null);
  const [graphHtml, setGraphHtml] = useState<string | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Review controls (this tab's own run channel).
  const [activeRoot, setActiveRoot] = useState<string>("");
  const [scope, setScope] = useState<Scope>("workspace");
  const [commitRef, setCommitRef] = useState("HEAD");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("HEAD");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [runError, setRunError] = useState<string | null>(null);

  const isActiveRoot = root === activeRoot;

  const loadReports = useCallback(async (): Promise<ReviewReportMeta[]> => {
    try {
      const list = await api.reviewListReports(root);
      setReports(list);
      return list;
    } catch {
      setReports([]);
      return [];
    }
  }, [root]);

  // Report history + initial selection.
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await loadReports();
      if (!alive) return;
      const want =
        initialReportId && list.some((r) => r.id === initialReportId) ? initialReportId : (list[0]?.id ?? null);
      setSelected(want);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [root, initialReportId, loadReports]);

  // Active root (gates the run controls) + progress stream while running.
  useEffect(() => {
    void api.getProjectRoot().then(setActiveRoot);
    return api.onProjectRootChanged(setActiveRoot);
  }, []);

  useEffect(() => {
    if (!running) {
      setProgress("");
      return;
    }
    const unsub = api.onActionProgress((evt: ActionProgressEvent) => {
      if (evt.actionId === "review.full") {
        setProgress(evt.percent != null ? `${evt.percent}% — ${evt.message}` : evt.message);
      }
    });
    return unsub;
  }, [running]);

  // Read the selected report's HTML whenever the selection moves.
  useEffect(() => {
    if (!selected) {
      setHtml(null);
      return;
    }
    let alive = true;
    (async () => {
      const res = await api.reviewReadReport(root, selected);
      if (alive && res.ok) setHtml(res.html ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [root, selected]);

  const runReview = useCallback(async () => {
    if (!isActiveRoot || running) return;
    setRunning(true);
    setRunError(null);
    try {
      const params =
        scope === "all"
          ? { all: true }
          : scope === "commit"
            ? { commit: commitRef.trim() || "HEAD" }
            : scope === "range" && rangeFrom.trim() && rangeTo.trim()
              ? { from: rangeFrom.trim(), to: rangeTo.trim() }
              : {};
      const res: ActionRunResult = await api.actionRun("review.full", params);
      if (!res.ok) setRunError(`${res.code}: ${res.error}`);
      const list = await loadReports();
      setSelected(list[0]?.id ?? null);
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [isActiveRoot, running, scope, commitRef, rangeFrom, rangeTo, loadReports]);

  const openGraph = useCallback(async () => {
    if (graphHtml || graphError) return;
    const res = await api.reviewRiskGraph(root);
    if (res.html) setGraphHtml(res.html);
    else setGraphError(res.error ?? t("app.requestFailed"));
  }, [root, graphHtml, graphError, t]);

  useEffect(() => {
    if (subView === "graph") void openGraph();
  }, [subView, openGraph]);

  const pill = (view: SubView, label: string): JSX.Element => (
    <button
      type="button"
      className={`ui-review-tab-pill${subView === view ? " active" : ""}`}
      onClick={() => setSubView(view)}
    >
      {label}
    </button>
  );

  return (
    <div className="ui-review-tab">
      <div className="ui-review-tab-head">
        <div className="ui-review-tab-tabs">
          {pill("reports", t("review.reportsTitle"))}
          {pill("graph", t("review.riskGraph"))}
        </div>
        <div className="ui-review-tab-controls">
          <select
            className="ui-review-scope-select"
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            title={t("review.scope.title")}
            disabled={running || !isActiveRoot}
          >
            <option value="workspace">{t("review.scope.workspace")}</option>
            <option value="commit">{t("review.scope.commit")}</option>
            <option value="range">{t("review.scope.range")}</option>
            <option value="all">{t("review.scope.all")}</option>
          </select>
          {scope === "commit" ? (
            <input
              className="ui-review-scope-input"
              value={commitRef}
              onChange={(e) => setCommitRef(e.target.value)}
              placeholder="HEAD"
              spellCheck={false}
            />
          ) : null}
          {scope === "range" ? (
            <>
              <input
                className="ui-review-scope-input"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                placeholder={t("review.scope.from")}
                spellCheck={false}
              />
              <input
                className="ui-review-scope-input"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                placeholder={t("review.scope.to")}
                spellCheck={false}
              />
            </>
          ) : null}
          <button
            type="button"
            className="ui-review-run-btn"
            disabled={running || !isActiveRoot}
            title={isActiveRoot ? t("review.action.full.hint") : t("review.runActiveOnly")}
            onClick={() => void runReview()}
          >
            {running ? "…" : t("review.startRun")}
          </button>
        </div>
      </div>
      {running && progress ? <div className="ui-review-run-progress">{progress}</div> : null}
      {runError ? <div className="ui-error" style={{ margin: "0 12px 8px" }}>{`✗ ${runError}`}</div> : null}

      {subView === "reports" ? (
        <div className="ui-review-tab-body">
          <div className="ui-review-history">
            {loaded && reports.length === 0 ? (
              <div className="ui-review-history-empty">{t("review.noReports")}</div>
            ) : (
              reports.map((r) => (
                <div
                  key={r.id}
                  className={`ui-review-history-item${selected === r.id ? " active" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setSelected(r.id);
                  }}
                >
                  <div className="ui-review-history-time">{timeLabel(r.generatedAt)}</div>
                  <div className="ui-review-history-meta">
                    {statusLabel(r.status)} · {t("review.metaFiles", { n: r.filesReviewed })} ·{" "}
                    {t("review.metaFindings", { n: r.comments })}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="ui-review-tab-content">
            {html ? (
              <iframe
                className="ui-review-frame"
                srcDoc={html}
                sandbox="allow-scripts"
                title={t("review.reportsTitle")}
              />
            ) : (
              <div className="ui-review-history-empty">{selected ? t("actions.running") : t("review.noReports")}</div>
            )}
          </div>
        </div>
      ) : (
        <div className="ui-review-tab-content ui-review-tab-graph">
          {graphHtml ? (
            <iframe
              className="ui-review-frame"
              srcDoc={graphHtml}
              sandbox="allow-scripts"
              title={t("review.riskGraph")}
            />
          ) : graphError ? (
            <div className="ui-review-history-empty">{graphError}</div>
          ) : (
            <div className="ui-review-history-empty">{t("actions.running")}</div>
          )}
        </div>
      )}
    </div>
  );
}
