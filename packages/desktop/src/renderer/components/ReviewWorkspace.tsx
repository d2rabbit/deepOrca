import { useCallback, useEffect, useState, type JSX } from "react";
import type { ReviewReportMeta } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";

/**
 * Review workspace surface — the main-area tab for ONE workspace (the review
 * module's counterpart of the knowledge tab; user ask 2026-08-31: the review
 * surface must follow the index-module pattern, never pop out).
 *
 * Two sub-views:
 *   审查报告 — persisted report history (left rail) rendered as a
 *             self-contained page inside a sandboxed iframe;
 *   风险图谱 — the simplified in-app risk map (crg-risk-graph.ts), same
 *             iframe, loaded on first open.
 */

type SubView = "reports" | "graph";

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

  // Report history + initial selection.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await api.reviewListReports(root);
        if (!alive) return;
        setReports(list);
        const want =
          initialReportId && list.some((r) => r.id === initialReportId) ? initialReportId : (list[0]?.id ?? null);
        setSelected(want);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [root, initialReportId]);

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
      <div className="ui-review-tab-tabs">
        {pill("reports", t("review.reportsTitle"))}
        {pill("graph", t("review.riskGraph"))}
      </div>

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
