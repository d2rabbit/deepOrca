import { useCallback, useEffect, useState, type JSX } from "react";
import type { ActionProgressEvent, ReviewReportMeta } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";

/**
 * Review workspace surface — the main-area tab for ONE workspace (the review
 * module's counterpart of the knowledge tab). PURE reading surface: report
 * history (left rail) + a structured native report view (right), and the
 * simplified risk map. All run controls live on the panel's workspace list
 * (scope selector above the list — user ask 2026-09-01).
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

interface Finding {
  path: string;
  startLine: number;
  endLine?: number;
  severity?: string;
  content: string;
  existingCode?: string;
  suggestionCode?: string;
  crgRisk?: string;
}

const SEV_CLASS: Record<string, string> = {
  critical: "sev-critical",
  high: "sev-high",
  medium: "sev-medium",
  low: "sev-low",
};

/** Split the delegation `[SEVERITY] rest` content prefix. */
function parseFinding(f: Record<string, unknown>): Finding {
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

export function ReviewWorkspace({ root, initialReportId }: { root: string; initialReportId?: string }): JSX.Element {
  const { t, locale } = useI18n();
  const label = root.split(/[\\/]/).pop() ?? root;
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
  const [graphHtml, setGraphHtml] = useState<string | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

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

  // Keep the history rail fresh when a run settles (panel-initiated or ours).
  useEffect(() => {
    return api.onActionProgress((evt: ActionProgressEvent) => {
      if (evt.actionId === "review.full" && evt.percent === 100) void loadReports();
    });
  }, [loadReports]);

  // Active root (informational badge) — reviews run against it from the panel.
  const [activeRoot, setActiveRoot] = useState<string>("");
  useEffect(() => {
    void api.getProjectRoot().then(setActiveRoot);
    return api.onProjectRootChanged(setActiveRoot);
  }, []);

  const selectedMeta = reports.find((r) => r.id === selected) ?? null;

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

  // Group findings by path for the native report body.
  const findings: Finding[] = (selectedMeta?.findings ?? []).map(parseFinding);
  const byPath = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byPath.get(f.path) ?? [];
    list.push(f);
    byPath.set(f.path, list);
  }

  return (
    <div className="ui-review-tab">
      <div className="ui-review-tab-head">
        <div className="ui-review-tab-tabs">
          {pill("reports", t("review.reportsTitle"))}
          {pill("graph", t("review.riskGraph"))}
        </div>
        {root === activeRoot ? <span className="ui-review-tab-active">{t("review.activeBadge")}</span> : null}
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
            {selectedMeta ? (
              <div className="ui-report-doc">
                <h1>
                  {t("review.title")} — {label}
                </h1>
                <div className="ui-report-meta">
                  {t("review.rpScope")}: {selectedMeta.scopeLabel} · {t("review.rpGenerated")}:{" "}
                  {timeLabel(selectedMeta.generatedAt)} · {t("review.rpStatus")}: {statusLabel(selectedMeta.status)}
                </div>
                <div className="ui-report-cards">
                  <div className="ui-report-card">
                    <div className="num">{selectedMeta.filesReviewed}</div>
                    <div className="lbl">{t("review.rpFiles")}</div>
                  </div>
                  <div className="ui-report-card">
                    <div className="num">{selectedMeta.comments}</div>
                    <div className="lbl">{t("review.rpFindings")}</div>
                  </div>
                </div>
                {findings.length === 0 ? (
                  <div className="ui-report-empty">{t("review.rpNoFindings")}</div>
                ) : (
                  [...byPath.entries()].map(([path, list]) => (
                    <section key={path} className="ui-report-file">
                      <h2>
                        <code>{path}</code> <span className="cnt">{list.length}</span>
                      </h2>
                      {list.map((f, i) => (
                        <div key={i} className="ui-report-finding">
                          <div className="head">
                            {f.severity ? (
                              <span className={`chip ${SEV_CLASS[f.severity] ?? ""}`}>{f.severity.toUpperCase()}</span>
                            ) : null}
                            {f.crgRisk ? <span className="chip crg">CRG: {f.crgRisk}</span> : null}
                            <span className="loc">
                              {f.path}
                              {f.startLine > 0 ? `:${f.startLine}` : ""}
                              {f.endLine != null && f.endLine > f.startLine ? `-${f.endLine}` : ""}
                            </span>
                          </div>
                          <div className="body">{f.content}</div>
                          {f.existingCode ? <pre className="code existing">{f.existingCode}</pre> : null}
                          {f.suggestionCode ? (
                            <>
                              <div className="sug-label">{t("review.rpSuggestion")}</div>
                              <pre className="code suggestion">{f.suggestionCode}</pre>
                            </>
                          ) : null}
                        </div>
                      ))}
                    </section>
                  ))
                )}
                <p className="ui-report-footer">{selectedMeta.statusNote}</p>
              </div>
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
