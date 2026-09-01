import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { ActionProgressEvent, FindingBinding, ReviewReportMeta } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button } from "../ui/index";
import { RiskGraphView, type RiskFocusRequest } from "./RiskGraphView";

/**
 * Review workspace surface — the main-area tab for ONE workspace (the review
 * module's counterpart of the knowledge tab). PURE reading surface: report
 * history (left rail) + a structured native report view (right), and the
 * simplified risk map. All run controls live on the panel's workspace list
 * (scope selector above the list — user ask 2026-09-01).
 *
 * Data flow (review round 2026-09-01): the history rail carries LIGHT metas
 * (no findings — a KB-scale suggestion corpus per report made every refresh
 * ship the whole archive over IPC); the selected report is read through
 * review:readReport. A run's synthetic post-save progress event carries the
 * new report's id, so the rail refreshes once and auto-selects the fresh
 * report instead of only re-listing.
 */

type SubView = "reports" | "graph";

const STATUS_LABELS: Record<string, Record<string, string>> = {
  en: {
    success: "Success",
    completed_with_warnings: "Completed (warnings)",
    completed_with_errors: "Completed (errors)",
    skipped: "Skipped",
  },
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

/** Inline `code` spans inside a text segment (theme-aware chip). */
function BodyText({ text }: { text: string }): JSX.Element {
  const pieces = text.split(/`([^`\n]+)`/g);
  return (
    <div className="body">
      {pieces.map((piece, i) =>
        i % 2 === 1 ? (
          <code key={i} className="inline">
            {piece}
          </code>
        ) : (
          <span key={i}>{piece}</span>
        )
      )}
    </div>
  );
}

/**
 * Finding body renderer (user ask 2026-09-01): the model writes markdown —
 * fenced ``` blocks inside the finding text used to render as literal fence
 * soup. Fenced blocks become real, theme-aware code blocks; everything else
 * keeps its pre-wrap text flow with inline `code` spans. An unmatched fence
 * (model truncation) still renders — the trailing block runs to the end of
 * the content.
 */
function FindingBody({ content }: { content: string }): JSX.Element {
  const parts: JSX.Element[] = [];
  const fence = /```[ \t]*[A-Za-z0-9+#_-]*[ \t]*\r?\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let key = 0;
  for (const m of content.matchAll(fence)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(<BodyText key={key++} text={content.slice(last, start)} />);
    const code = m[1].replace(/\n$/, "");
    if (code.trim().length > 0) {
      parts.push(
        <pre key={key++} className="code fenced">
          <code>{code}</code>
        </pre>
      );
    }
    last = start + m[0].length;
  }
  if (last < content.length) parts.push(<BodyText key={key++} text={content.slice(last)} />);
  return <>{parts}</>;
}

function hasReportId(data: unknown): string | undefined {
  if (data == null || typeof data !== "object") return undefined;
  const id = (data as { reportId?: unknown }).reportId;
  return typeof id === "string" ? id : undefined;
}

export function ReviewWorkspace({
  root,
  initialReportId,
  onQuoteToChat,
}: {
  root: string;
  initialReportId?: string;
  /** Quote one report into the chat composer as an @-mention of its stored
   *  JSON (wiki parity — the agent reads the exact run in-session). */
  onQuoteToChat?: (root: string, reportId: string) => void;
}): JSX.Element {
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
  const [selectedMeta, setSelectedMeta] = useState<ReviewReportMeta | null>(null);
  const [loaded, setLoaded] = useState(false);
  const lastRefreshAt = useRef(0);
  // Finding → node bindings ride the selected report's read (design §3.3);
  // the native board consumes them as popover opinions.
  const [bindingsByIndex, setBindingsByIndex] = useState<Record<number, FindingBinding>>({});
  // Report → board locate request (seq re-fires repeated targets).
  const [focusReq, setFocusReq] = useState<RiskFocusRequest | null>(null);
  const locateSeqRef = useRef(0);

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

  // The selected report's FULL meta (with findings) — read on demand, the
  // rail list itself is light.
  useEffect(() => {
    let alive = true;
    setSelectedMeta(null);
    setBindingsByIndex({});
    if (!selected) return;
    (async () => {
      try {
        const res = await api.reviewReadReport(root, selected);
        if (alive && res.ok && res.meta) {
          setSelectedMeta(res.meta);
          const bindings: Record<number, FindingBinding> = {};
          for (const b of res.bindings ?? []) bindings[b.index] = b;
          setBindingsByIndex(bindings);
          return;
        }
      } catch {
        // fall through — pruned/racing read, re-select below
      }
      if (alive) {
        // Selected report vanished (pruned/failed read) — fall back to the
        // newest one so the pane never sticks empty.
        const fallback = reports.find((r) => r.id === selected) ? null : (reports[0]?.id ?? null);
        setSelected(fallback);
      }
    })();
    return () => {
      alive = false;
    };
    // `reports` deliberately excluded: only selection changes drive reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, selected]);

  // Keep the history rail fresh when a run settles (panel-initiated or ours).
  // The synthetic post-save event carries the fresh report's id — refresh AND
  // select it (cb4486e's "select the newest report", actually delivered).
  useEffect(() => {
    return api.onActionProgress(async (evt: ActionProgressEvent) => {
      if (evt.actionId !== "review.full" || evt.percent !== 100) return;
      // action-ipc's generic terminal marker fires right after the wrapper's
      // report event — don't refresh twice within the same settle.
      const now = Date.now();
      if (now - lastRefreshAt.current < 800) return;
      lastRefreshAt.current = now;
      const list = await loadReports();
      const fresh = hasReportId(evt.data);
      if (fresh && list.some((r) => r.id === fresh)) setSelected(fresh);
    });
  }, [loadReports]);

  /** Report → board locate: switch to the board and select the node (the
   *  board scrolls its chip into view and opens the popover at it). */
  const locateNode = useCallback((qn: string) => {
    locateSeqRef.current += 1;
    setFocusReq({ qn, seq: locateSeqRef.current });
    setSubView("graph");
  }, []);

  /** Board popover → report: jump back to the exact finding in the report
   *  view. Bindings belong to the currently selected report by construction,
   *  so the jump target always exists. */
  const jumpToFinding = useCallback((findex: number) => {
    setSubView("reports");
    // The reports view mounts on the state flip above — query inside a frame
    // so the finding element exists before scrolling/flashing it.
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-findex="${findex}"]`);
      if (!(el instanceof HTMLElement)) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("flash");
      void el.offsetWidth; /* restart the animation */
      el.classList.add("flash");
    });
  }, []);

  // Sub-tab pills — the SAME classes as the knowledge sheet's bar
  // (ui-knowledge-subtab, per-tab --tab-hue dot): one visual language across
  // the two sheet surfaces (user ask 2026-09-01).
  const pill = (view: SubView, pillLabel: string): JSX.Element => (
    <button
      type="button"
      className={`ui-knowledge-subtab subtab-${view}${subView === view ? " active" : ""}`}
      onClick={() => setSubView(view)}
    >
      {pillLabel}
    </button>
  );

  // Group findings by path for the native report body. The GLOBAL index is
  // kept — it is the binding key for the graph locate (review-bind returns
  // positions in the report's findings array; the DOM carries data-findex).
  const findings: Finding[] = (selectedMeta?.findings ?? []).map(parseFinding);
  const byPath = new Map<string, { f: Finding; index: number }[]>();
  findings.forEach((f, index) => {
    const list = byPath.get(f.path) ?? [];
    list.push({ f, index });
    byPath.set(f.path, list);
  });
  // Exclusion accounting (P2-5, review round 2026-09-01): a 0-finding run
  // must say WHY when policy ate every change — unsupportedFiles is a subset
  // of excludedByPolicy, so only the total is shown.
  const excluded = selectedMeta?.excludedByPolicy ?? 0;

  return (
    <div className="ui-review-tab">
      <div className="ui-review-tab-head">
        <div className="ui-review-tab-tabs ui-knowledge-subtabs ui-review-subtabs">
          {pill("reports", t("review.reportsTitle"))}
          {pill("graph", t("review.riskGraph"))}
        </div>
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
                <div className="ui-report-doc-head">
                  <h1>
                    {t("review.title")} — {label}
                  </h1>
                  {onQuoteToChat && selected ? (
                    <Button
                      size="sm"
                      variant="primary"
                      className="ui-report-quote"
                      onClick={() => onQuoteToChat(root, selected)}
                      title={t("review.quoteHint")}
                    >
                      {t("review.quote")}
                    </Button>
                  ) : null}
                </div>
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
                  {excluded > 0 ? (
                    <div className="ui-report-card excluded">
                      <div className="num">{excluded}</div>
                      <div className="lbl">{t("review.rpExcluded")}</div>
                    </div>
                  ) : null}
                </div>
                {excluded > 0 && selectedMeta.filesReviewed === 0 ? (
                  <div className="ui-report-note">{t("review.rpExcludedNote")}</div>
                ) : null}
                {findings.length === 0 ? (
                  <div className="ui-report-empty">{t("review.rpNoFindings")}</div>
                ) : (
                  [...byPath.entries()].map(([path, list]) => (
                    <section key={path} className="ui-report-file">
                      <h2>
                        <code>{path}</code> <span className="cnt">{list.length}</span>
                      </h2>
                      {list.map(({ f, index }) => {
                        const binding = bindingsByIndex[index];
                        return (
                          <div key={index} className="ui-report-finding" data-findex={index}>
                            <div className="head">
                              {f.severity ? (
                                <span className={`chip ${SEV_CLASS[f.severity] ?? ""}`}>
                                  {f.severity.toUpperCase()}
                                </span>
                              ) : null}
                              {binding ? (
                                <button
                                  type="button"
                                  className="chip crg locate"
                                  onClick={() => locateNode(binding.qn)}
                                  title={t("review.locateHint")}
                                >
                                  {f.crgRisk ? (
                                    <>
                                      CRG: {f.crgRisk}
                                      <span className="lnk"> · {t("review.locate")} ◎</span>
                                    </>
                                  ) : (
                                    <>{t("review.locate")} ◎</>
                                  )}
                                </button>
                              ) : f.crgRisk ? (
                                <span className="chip crg">CRG: {f.crgRisk}</span>
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
                        );
                      })}
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
          <RiskGraphView
            root={root}
            findings={findings}
            bindingsByIndex={bindingsByIndex}
            focusReq={focusReq}
            onJumpToFinding={jumpToFinding}
          />
        </div>
      )}
    </div>
  );
}
