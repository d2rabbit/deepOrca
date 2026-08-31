import { useCallback, useEffect, useState, type JSX } from "react";
import type { ActionProgressEvent, ActionRunResult, ReviewReportMeta, WorkspaceGroup } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton, IconMagicWand, IconChat } from "../ui/index";
import { extractReviewFindings, type ReviewFinding } from "../lib/review-fix";

/**
 * Code review panel — workspace-list interaction (user ask 2026-08-31:
 * "交互模式和索引库应当保持一致，只不过要保留审查历史").
 *
 * One row per workspace (status dot = risk graph built?, name, last review)
 * with an inline 审查 button — exactly the index library's row anatomy.
 * Clicking a row opens the workspace's REVIEW TAB in the main content area
 * (report history + simplified risk map render in-app; nothing pops out).
 *
 * A review only ever runs against the ACTIVE workspace (the action registry
 * is bound to it); other rows' buttons stay disabled with a hint.
 */

function formatRelative(iso: string | undefined, justNow: string, never: string): string {
  if (!iso) return never;
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta) || delta < 0) return never;
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return justNow;
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function CodeReviewPanel({
  onOpenReviewTab,
  onOneClickFix,
  onAskInChat,
}: {
  /** Open (or focus) the review tab for a workspace root in the main area. */
  onOpenReviewTab: (root: string, reportId?: string) => void;
  /** One-click fix: hand the current findings to App (plan → session → fix). */
  onOneClickFix: (findings: ReviewFinding[]) => void;
  /** Flow bridge: quote the findings into the chat composer for follow-up. */
  onAskInChat?: (findings: ReviewFinding[]) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [workspaces, setWorkspaces] = useState<WorkspaceGroup[]>([]);
  const [activeRoot, setActiveRoot] = useState<string>("");
  const [hasGraph, setHasGraph] = useState<Record<string, boolean>>({});
  const [lastReview, setLastReview] = useState<Record<string, string | undefined>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [lastRun, setLastRun] = useState<{ root: string; res: ActionRunResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, ReviewReportMeta[]>>({});
  const [scope, setScope] = useState<"workspace" | "commit" | "range" | "all">("workspace");
  const [commitRef, setCommitRef] = useState("HEAD");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("HEAD");

  const loadReports = useCallback(async (root: string) => {
    try {
      const list = await api.reviewListReports(root);
      setReports((prev) => ({ ...prev, [root]: list }));
    } catch {
      setReports((prev) => ({ ...prev, [root]: prev[root] ?? [] }));
    }
  }, []);

  const toggleHistory = useCallback(
    (root: string) => {
      const next = expanded === root ? null : root;
      setExpanded(next);
      if (next) void loadReports(next);
    },
    [expanded, loadReports]
  );

  const reload = useCallback(async () => {
    try {
      const [ws, root, crg] = await Promise.all([api.listWorkspaceSessions(), api.getProjectRoot(), api.crgList()]);
      setActiveRoot(root);
      setWorkspaces(ws.workspaces);
      const graphState: Record<string, boolean> = {};
      for (const e of crg) graphState[e.root] = e.hasGraph;
      setHasGraph(graphState);
      setError(null);
      if (expanded) void loadReports(expanded);
      // Last-review freshness per row (cheap meta reads, failures tolerated).
      await Promise.all(
        ws.workspaces.map(async (w) => {
          try {
            const list = await api.reviewListReports(w.root);
            setLastReview((prev) => ({ ...prev, [w.root]: list[0]?.generatedAt }));
          } catch {
            // leave the row without freshness
          }
        })
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [expanded, loadReports]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Active-workspace switches re-bind which row's review button is live.
  useEffect(() => api.onProjectRootChanged(() => void reload()), [reload]);

  // Graph-state dot refreshes after out-of-band CRG rebuilds too.
  useEffect(() => {
    return api.onCrgProgress((evt: { done?: boolean }) => {
      if (evt.done) void reload();
    });
  }, [reload]);

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

  const runReview = useCallback(
    async (root: string) => {
      if (root !== activeRoot || running) return;
      setRunning(true);
      setLastRun(null);
      setError(null);
      try {
        const params =
          scope === "all"
            ? { all: true }
            : scope === "commit"
              ? { commit: commitRef.trim() || "HEAD" }
              : scope === "range" && rangeFrom.trim() && rangeTo.trim()
                ? { from: rangeFrom.trim(), to: rangeTo.trim() }
                : {};
        const res = await api.actionRun("review.full", params);
        setLastRun({ root, res });
        void reload();
        void loadReports(root);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    },
    [activeRoot, running, reload, loadReports, scope, commitRef, rangeFrom, rangeTo]
  );

  const runFindings: ReviewFinding[] = lastRun && lastRun.res.ok ? extractReviewFindings(lastRun.res.output) : [];

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("review.title")}</span>
        <IconButton onClick={() => void reload()} title={t("scm.refresh")} aria-label={t("scm.refresh")}>
          ⟳
        </IconButton>
      </div>
      <div className="ui-side-panel-body">
        {error ? <div className="ui-error">{error}</div> : null}
        {workspaces.length === 0 ? (
          <div className="ui-side-panel-empty">{t("review.noWorkspace")}</div>
        ) : (
          workspaces.map((w) => {
            const graph = hasGraph[w.root] ?? false;
            const isActive = w.root === activeRoot;
            const run = lastRun && lastRun.root === w.root ? lastRun : null;
            return (
              <div key={w.root} className="ui-ik-rowwrap">
                <div
                  className="ui-ik-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenReviewTab(w.root)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenReviewTab(w.root);
                    }
                  }}
                >
                  <span className={`ui-ik-dot ${graph ? "on" : "off"}`} aria-hidden />
                  <div className="ui-ik-row-main">
                    <div className="ui-ik-name">{w.label}</div>
                    <div className="ui-ik-meta">
                      {running && isActive
                        ? progress
                        : formatRelative(lastReview[w.root], t("index.freshness.justNow"), t("review.lastReviewNever"))}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`ui-review-history-toggle${expanded === w.root ? " open" : ""}`}
                    title={t("review.reportsTitle")}
                    aria-label={t("review.reportsTitle")}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleHistory(w.root);
                    }}
                  >
                    ▸
                  </button>
                  <Button
                    size="sm"
                    variant="subtle"
                    className="ui-ik-build"
                    disabled={running || !isActive}
                    title={isActive ? t("review.action.full.hint") : t("review.runActiveOnly")}
                    onClick={(e) => {
                      e.stopPropagation();
                      void runReview(w.root);
                    }}
                  >
                    {running && isActive ? "…" : t("review.action.full")}
                  </Button>
                </div>

                {expanded === w.root ? (
                  <div className="ui-review-inline-history">
                    {(reports[w.root] ?? []).length === 0 ? (
                      <div className="ui-review-inline-empty">{t("review.noReports")}</div>
                    ) : (
                      (reports[w.root] ?? []).map((r) => (
                        <div
                          key={r.id}
                          className="ui-review-inline-item"
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenReviewTab(w.root, r.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              onOpenReviewTab(w.root, r.id);
                            }
                          }}
                        >
                          <span className="ui-review-inline-time">
                            {formatRelative(r.generatedAt, t("index.freshness.justNow"), r.generatedAt)}
                          </span>
                          <span className="ui-review-inline-meta">
                            {r.filesReviewed} · {r.comments}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}

                {isActive ? (
                  <div className="ui-review-scope">
                    <select
                      className="ui-review-scope-select"
                      value={scope}
                      onChange={(e) => setScope(e.target.value as typeof scope)}
                      onClick={(e) => e.stopPropagation()}
                      title={t("review.scope.title")}
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
                        onClick={(e) => e.stopPropagation()}
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
                          onClick={(e) => e.stopPropagation()}
                          placeholder={t("review.scope.from")}
                          spellCheck={false}
                        />
                        <input
                          className="ui-review-scope-input"
                          value={rangeTo}
                          onChange={(e) => setRangeTo(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          placeholder={t("review.scope.to")}
                          spellCheck={false}
                        />
                      </>
                    ) : null}
                  </div>
                ) : null}

                {run && run.res.ok && runFindings.length > 0 ? (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "0 10px 6px" }}
                  >
                    <Button
                      size="sm"
                      variant="subtle"
                      disabled={running}
                      title={t("review.fixHint")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOneClickFix(runFindings);
                      }}
                    >
                      <IconMagicWand /> {t("review.oneClickFix")}
                    </Button>
                    {onAskInChat ? (
                      <Button
                        size="sm"
                        variant="subtle"
                        disabled={running}
                        title={t("review.askInChat")}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAskInChat(runFindings);
                        }}
                      >
                        <IconChat /> {t("review.askInChat")}
                      </Button>
                    ) : null}
                    <span className="ui-muted" style={{ fontSize: 10 }}>
                      {t("review.findingsCount", { n: runFindings.length })}
                    </span>
                  </div>
                ) : null}
                {run && !run.res.ok ? (
                  <div className="ui-error" style={{ margin: "0 10px 6px" }}>
                    {`✗ ${run.res.code}: ${run.res.error}`}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
