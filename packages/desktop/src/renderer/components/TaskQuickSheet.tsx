/**
 * TaskQuickSheet — the task hub's right-side floating QUICK view (user ask
 * 2026-09-02: 任务树里打开产物一律走右侧悬浮窗). Read-only condensed content
 * per artifact kind:
 *   - report  → one persisted review report (findings, no locate workbench)
 *   - build   → one settled index/knowledge build job (stage list)
 * The session-tree timeline embeds the existing lazy TaskRecordPanel directly
 * as this sheet's children (wired in App.tsx).
 *
 * Reuses the design preview sheet's shell classes (`ui-preview-panel*`) so
 * the right slot looks identical; single-right-slot arbitration lives in
 * App.tsx (opening either side closes the other).
 */

import { useCallback, useEffect, useState, type JSX, type ReactNode } from "react";
import type { ReviewReportMeta } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { FindingBody, parseFinding, SEV_CLASS, type ReportFinding } from "../lib/report-view";
import { formatAbsolute } from "./task-hub-format";

export function TaskQuickSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ui-preview-panel ui-task-quick" role="dialog">
      <div className="ui-preview-panel-head">
        <div className="ui-preview-tabs">
          <button type="button" className="ui-preview-tab active">
            ✦ {title}
          </button>
        </div>
        <button type="button" className="ui-preview-close" onClick={onClose} title={t("common.close")}>
          ✕
        </button>
      </div>
      <div className="ui-preview-panel-body">{children}</div>
    </div>
  );
}

/** One persisted review report, condensed: findings grouped by file — the
 *  history rail, risk map, and locate workbench stay in the main-area tab. */
export function ReportQuickContent({ root, reportId }: { root: string; reportId: string }): JSX.Element {
  const { t } = useI18n();
  const [meta, setMeta] = useState<ReviewReportMeta | null>(null);
  const [findings, setFindings] = useState<ReportFinding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await api.reviewReadReport(root, reportId);
      if (res.ok && res.meta) {
        setMeta(res.meta);
        setFindings((res.meta.findings ?? []).map((f) => parseFinding(f)));
        setError(null);
      } else {
        setError(res.error ?? t("app.requestFailed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [root, reportId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const byPath = new Map<string, ReportFinding[]>();
  for (const f of findings) {
    const list = byPath.get(f.path);
    if (list) list.push(f);
    else byPath.set(f.path, [f]);
  }

  return (
    <div className="ui-quick-report">
      {loading ? (
        <div className="ui-risk-board-state">
          <span className="ui-spinner" />
        </div>
      ) : error ? (
        <div className="ui-risk-board-state">{error}</div>
      ) : (
        <>
          <div className="ui-quick-report-head">
            <span className="ui-quick-report-title">{meta?.scopeLabel ?? ""}</span>
            <span className="ui-quick-report-time">{formatAbsolute(meta?.generatedAt)}</span>
          </div>
          {findings.length === 0 ? (
            <div className="ui-quick-report-empty">{t("review.rpNoFindings")}</div>
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
                      <span className="loc">
                        {f.path}
                        {f.startLine > 0 ? `:${f.startLine}` : ""}
                        {f.endLine != null && f.endLine > f.startLine ? `-${f.endLine}` : ""}
                      </span>
                    </div>
                    <FindingBody content={f.content} />
                    {f.existingCode ? (
                      <div className="ui-report-codeblock kind-existing">
                        <div className="cb-head">
                          <span className="cb-kind">{t("review.rpExisting")}</span>
                          <span className="cb-file">{f.path}</span>
                        </div>
                        <pre className="code">
                          <code>{f.existingCode}</code>
                        </pre>
                      </div>
                    ) : null}
                    {f.suggestionCode ? (
                      <div className="ui-report-codeblock kind-suggestion">
                        <div className="cb-head">
                          <span className="cb-kind">{t("review.rpSuggestion")}</span>
                        </div>
                        <pre className="code">
                          <code>{f.suggestionCode}</code>
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ))}
              </section>
            ))
          )}
          {meta?.statusNote ? <p className="ui-report-footer">{meta.statusNote}</p> : null}
        </>
      )}
    </div>
  );
}

/** One settled build job: stage list with per-stage status (from the hub
 *  node's own meta — no extra fetch). */
export function BuildQuickContent({
  stages,
  error,
}: {
  stages: Array<{ id: string; status: string; error?: string }>;
  error?: string;
}): JSX.Element {
  return (
    <div className="ui-quick-report">
      {error ? <div className="ui-quick-report-error">{error}</div> : null}
      <div className="ui-quick-build-stages">
        {stages.length === 0 ? <div className="ui-quick-report-empty">—</div> : null}
        {stages.map((s) => (
          <div key={s.id} className={`ui-quick-build-stage ${s.status}`}>
            <span className={`rb-dot ${s.status === "done" ? "tier-lo" : "tier-hi"}`} aria-hidden />
            <span className="name">{s.id}</span>
            <span className="status">{s.status}</span>
            {s.error ? <span className="err">{s.error}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
