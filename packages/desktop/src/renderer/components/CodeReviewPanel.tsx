import { useCallback, useEffect, useState, type JSX } from "react";
import type { ActionProgressEvent, ActionRunResult, WorkspaceGroup } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton, IconMagicWand, IconChat } from "../ui/index";
import { extractReviewFindings, type ReviewFinding } from "../lib/review-fix";

/**
 * Code review panel — pure workspace list (user ask 2026-09-01: keep the
 * index-library interaction, drop the inline folding).
 *
 * One row per workspace: status dot (risk graph built?) + name + last review
 * + an inline 审查 button (workspace scope with automatic HEAD fallback).
 * Clicking a row opens the workspace's REVIEW TAB in the main content area —
 * report history and risk map live in that tab.
 *
 * The scope selector FOLLOWS the active workspace (user ask 2026-09-01 round
 * 2: 审查范围追随工作区): it renders under the active row — the
 * `ui-review-scope` "slim controls under the active workspace row" form —
 * and every workspace remembers its own scope. A review only ever runs
 * against the ACTIVE workspace (the action registry is bound to it); other
 * rows' buttons stay disabled with a hint.
 */

type ReviewScope = { mode: "workspace" | "commit" | "range" | "all"; commit: string; from: string; to: string };

const DEFAULT_SCOPE: ReviewScope = { mode: "workspace", commit: "HEAD", from: "", to: "HEAD" };

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
  // Scope follows the workspace: one remembered setting per root (design
  // spec §4.4 — in-memory for now; persisted with the settings if it earns
  // its keep). The selector renders under the ACTIVE row and loads whatever
  // that workspace last used.
  const [scopes, setScopes] = useState<Record<string, ReviewScope>>({});

  const updateScope = useCallback(
    (patch: Partial<ReviewScope>) => {
      setScopes((prev) => ({ ...prev, [activeRoot]: { ...(prev[activeRoot] ?? DEFAULT_SCOPE), ...patch } }));
    },
    [activeRoot]
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
  }, []);

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
      const scope = scopes[root] ?? DEFAULT_SCOPE;
      // A half-filled range previously fell through to `{}` — a silent
      // WORKSPACE run wearing the user's range intent (review round
      // 2026-09-01). Surface it instead of re-scoping behind their back.
      if (scope.mode === "range" && (!scope.from.trim() || !scope.to.trim())) {
        setError(t("review.scope.rangeIncomplete"));
        return;
      }
      setRunning(true);
      setLastRun(null);
      setError(null);
      try {
        const params =
          scope.mode === "all"
            ? { all: true }
            : scope.mode === "commit"
              ? { commit: scope.commit.trim() || "HEAD" }
              : scope.mode === "range"
                ? { from: scope.from.trim(), to: scope.to.trim() }
                : {};
        const res = await api.actionRun("review.full", params);
        setLastRun({ root, res });
        void reload();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    },
    [activeRoot, running, reload, scopes, t]
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
            const scope = scopes[w.root] ?? DEFAULT_SCOPE;
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

                {/* Scope selector — UNDER the ACTIVE workspace row, following
                    the workspace and remembering each root's own setting
                    (design spec §3.1 / §4.4). Non-active rows have no scope
                    controls: they cannot run a review anyway. */}
                {isActive ? (
                  <div className="ui-review-scope" data-review-scope>
                    <span className="ui-review-scope-label">
                      {t("review.scope.title")} · <span className="owner">{w.label}</span>
                    </span>
                    <select
                      className="ui-review-scope-select"
                      value={scope.mode}
                      onChange={(e) => updateScope({ mode: e.target.value as ReviewScope["mode"] })}
                      title={t("review.scope.title")}
                    >
                      <option value="workspace">{t("review.scope.workspace")}</option>
                      <option value="commit">{t("review.scope.commit")}</option>
                      <option value="range">{t("review.scope.range")}</option>
                      <option value="all">{t("review.scope.all")}</option>
                    </select>
                    {scope.mode === "commit" ? (
                      <input
                        className="ui-review-scope-input"
                        value={scope.commit}
                        onChange={(e) => updateScope({ commit: e.target.value })}
                        placeholder="HEAD"
                        spellCheck={false}
                      />
                    ) : null}
                    {scope.mode === "range" ? (
                      <>
                        <input
                          className="ui-review-scope-input"
                          value={scope.from}
                          onChange={(e) => updateScope({ from: e.target.value })}
                          placeholder={t("review.scope.from")}
                          spellCheck={false}
                        />
                        <input
                          className="ui-review-scope-input"
                          value={scope.to}
                          onChange={(e) => updateScope({ to: e.target.value })}
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
