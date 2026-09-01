import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { ActionProgressEvent, ActionRunResult, GitLogEntry, WorkspaceGroup } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton, IconMagicWand, IconChat, IconReview } from "../ui/index";
import { extractReviewFindings, type ReviewFinding } from "../lib/review-fix";
import {
  isReviewRunning,
  getReviewPercent,
  getReviewProgress,
  markReviewProgress,
  markReviewRunning,
  markReviewSettled,
} from "../lib/review-run-state";

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

/** Refs the scope dropdowns offer (user ask 2026-09-01: 不能让用户自己填 —
 *  refs must be PICKED, not typed): branch names + the recent commits of the
 *  ACTIVE workspace (the git bridge is bound to it, same as the review). */
interface ScopeRefs {
  branches: string[];
  commits: GitLogEntry[];
}
const EMPTY_REFS: ScopeRefs = { branches: [], commits: [] };
/** Recent-commit dropdown depth. */
const REFS_COMMIT_LIMIT = 50;

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
  // Per-workspace run state (user ask 2026-09-01: 一个审查不能影响其他项目):
  // keyed by root so two concurrent reviews never cross-write each other's
  // progress — a global `running` once disabled every other row and let
  // workspace A's 100% bar leak onto workspace B's.
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});
  const [progressMap, setProgressMap] = useState<Record<string, string>>({});
  const [percentMap, setPercentMap] = useState<Record<string, number | null>>({});
  const [lastRun, setLastRun] = useState<{ root: string; res: ActionRunResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Scope follows the workspace: one remembered setting per root (design
  // spec §4.4 — in-memory for now; persisted with the settings if it earns
  // its keep). The selector renders under the ACTIVE row and loads whatever
  // that workspace last used.
  const [scopes, setScopes] = useState<Record<string, ReviewScope>>({});
  // Pickable refs for the commit/range dropdowns — PER WORKSPACE (on-demand
  // review: git reads take an explicit root, so every row gets its OWN
  // branch/commit lists regardless of which workspace is active).
  const [refsByRoot, setRefsByRoot] = useState<Record<string, ScopeRefs>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      await Promise.all(
        workspaces.map(async (w) => {
          try {
            const [branches, commits] = await Promise.all([
              api.gitListBranches(w.root),
              api.gitLog(REFS_COMMIT_LIMIT, w.root),
            ]);
            if (alive) {
              setRefsByRoot((prev) => ({ ...prev, [w.root]: { branches: branches ?? [], commits: commits ?? [] } }));
            }
          } catch {
            if (alive) setRefsByRoot((prev) => ({ ...prev, [w.root]: EMPTY_REFS }));
          }
        })
      );
    })();
    return () => {
      alive = false;
    };
  }, [workspaces]);

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

  // Restore per-root run state after remounts (user report 2026-09-01):
  // review.full keeps running across sidebar switches / panel unmounts; the
  // module-level store survives the mount cycle so the row shows its status
  // IMMEDIATELY instead of waiting for the next heartbeat.
  useEffect(() => {
    const running: Record<string, boolean> = {};
    const progress: Record<string, string> = {};
    const percent: Record<string, number | null> = {};
    for (const w of workspaces) {
      running[w.root] = isReviewRunning(w.root);
      progress[w.root] = getReviewProgress(w.root);
      percent[w.root] = getReviewPercent(w.root);
    }
    setRunningMap(running);
    setProgressMap(progress);
    setPercentMap(percent);
  }, [workspaces]);

  // Live progress — ONE always-on subscription (not keyed to `running`): the
  // terminal `data.done` event is the ONLY reliable run-end signal, and it
  // must land even when this panel never fired the run (remount race: the
  // old instance's `finally` clears the STORE but cannot reset a new
  // instance's React state — that stuck "100% — done" bar). Events carry the
  // root they ran against; unknown-root events without a live run are
  // ignored so the wrapper's post-save 100% echo can't resurrect a settled
  // bar.
  const activeRootRef = useRef(activeRoot);
  activeRootRef.current = activeRoot;
  useEffect(() => {
    return api.onActionProgress((evt: ActionProgressEvent) => {
      if (evt.actionId !== "review.full") return;
      const root = evt.root ?? activeRootRef.current;
      if (!root) return;
      if (evt.data && typeof evt.data === "object" && (evt.data as { done?: unknown }).done === true) {
        markReviewSettled(root);
        setRunningMap((p) => ({ ...p, [root]: false }));
        setProgressMap((p) => ({ ...p, [root]: "" }));
        setPercentMap((p) => ({ ...p, [root]: null }));
        return;
      }
      // Heartbeat/stage events only matter for runs we know are live.
      if (!isReviewRunning(root)) return;
      if (evt.percent != null) setPercentMap((p) => ({ ...p, [root]: evt.percent! }));
      const text = evt.percent != null ? `${evt.percent}% — ${evt.message}` : evt.message;
      setProgressMap((p) => ({ ...p, [root]: text }));
      markReviewProgress(root, text, evt.percent);
    });
  }, []);

  const runReview = useCallback(
    async (root: string) => {
      if (runningMap[root]) return;
      const scope = scopes[root] ?? DEFAULT_SCOPE;
      // A half-filled range previously fell through to `{}` — a silent
      // WORKSPACE run wearing the user's range intent (review round
      // 2026-09-01). Surface it instead of re-scoping behind their back.
      if (scope.mode === "range" && (!scope.from.trim() || !scope.to.trim())) {
        setError(t("review.scope.rangeIncomplete"));
        return;
      }
      // ON-DEMAND review (user ask 2026-09-01 round 2: 审查与活动区无关):
      // review.full takes the target root directly — no workspace switch.
      setRunningMap((p) => ({ ...p, [root]: true }));
      markReviewRunning(root);
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
        const res = await api.actionRun("review.full", { ...params, root });
        setLastRun({ root, res });
        void reload();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        // Settles even when the panel unmounted mid-run: this closure keeps
        // executing, and the store outlives the component. The terminal
        // `data.done` event mirrors this for OTHER live panels.
        markReviewSettled(root);
        setRunningMap((p) => ({ ...p, [root]: false }));
        setPercentMap((p) => ({ ...p, [root]: null }));
        setProgressMap((p) => ({ ...p, [root]: "" }));
      }
    },
    [runningMap, reload, scopes, t]
  );

  // Graph-state dot refreshes after out-of-band CRG rebuilds too.
  useEffect(() => {
    return api.onCrgProgress((evt: { done?: boolean }) => {
      if (evt.done) void reload();
    });
  }, [reload]);

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
            const running = runningMap[w.root] ?? false;
            const percent = percentMap[w.root] ?? null;
            const rowRefs = refsByRoot[w.root] ?? EMPTY_REFS;
            const scopeControls = (
              <>
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
                  <select
                    className="ui-review-scope-select"
                    value={scope.commit}
                    onChange={(e) => updateScope({ commit: e.target.value })}
                    title={t("review.scope.commit")}
                  >
                    <option value="HEAD">HEAD</option>
                    {rowRefs.commits.map((c) => (
                      <option key={c.hash} value={c.hash}>
                        {c.shortHash} · {c.subject}
                      </option>
                    ))}
                  </select>
                ) : null}
                {scope.mode === "range" ? (
                  <>
                    <select
                      className="ui-review-scope-select"
                      value={scope.from}
                      onChange={(e) => updateScope({ from: e.target.value })}
                      title={t("review.scope.from")}
                    >
                      <option value="">{t("review.scope.pickRef")}</option>
                      <optgroup label={t("review.rgScopeBranches")}>
                        {rowRefs.branches.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label={t("review.rgScopeCommits")}>
                        {rowRefs.commits.map((c) => (
                          <option key={c.hash} value={c.hash}>
                            {c.shortHash} · {c.subject}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    <span aria-hidden className="ui-review-scope-sep">
                      →
                    </span>
                    <select
                      className="ui-review-scope-select"
                      value={scope.to}
                      onChange={(e) => updateScope({ to: e.target.value })}
                      title={t("review.scope.to")}
                    >
                      <option value="HEAD">HEAD</option>
                      <optgroup label={t("review.rgScopeBranches")}>
                        {rowRefs.branches.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label={t("review.rgScopeCommits")}>
                        {rowRefs.commits.map((c) => (
                          <option key={c.hash} value={c.hash}>
                            {c.shortHash} · {c.subject}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </>
                ) : null}
              </>
            );
            return (
              <div key={w.root} className="ui-ik-rowwrap">
                <div
                  className={`ui-ik-row${isActive ? " active" : ""}`}
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
                    <div className="ui-ik-name">
                      {w.label}
                      {isActive ? <span className="ui-review-active-chip">{t("review.activeChip")}</span> : null}
                    </div>
                    <div className="ui-ik-meta">
                      {running
                        ? (progressMap[w.root] ?? "")
                        : formatRelative(lastReview[w.root], t("index.freshness.justNow"), t("review.lastReviewNever"))}
                    </div>
                  </div>
                  {/* Scope IN the row (user ask 2026-09-01: 范围与 item 集成) —
                      every row carries its own remembered scope; the ref
                      dropdowns (branch/commit lists come from the git bridge,
                      which is bound to the ACTIVE root) appear once the row is
                      active — running a review on another row switches there
                      first, so they are never wrong. */}
                  <div className="ui-review-row-scope" onClick={(e) => e.stopPropagation()}>
                    {scopeControls}
                  </div>
                  {/* SVG-icon run button (user ask 2026-09-01: 一键审查 → icon).
                      Available on EVERY row: a non-active row switches the
                      workspace first (action registry is root-bound), then
                      runs. */}
                  <IconButton
                    className={`ui-ik-runbtn${running ? " running" : ""}`}
                    disabled={running}
                    title={t("review.action.full.hint")}
                    aria-label={t("review.action.full")}
                    onClick={(e) => {
                      e.stopPropagation();
                      void runReview(w.root);
                    }}
                  >
                    {running ? (
                      percent != null ? (
                        <span className="ui-ik-runbtn-pct">{percent}%</span>
                      ) : (
                        <span className="ui-spinner" />
                      )
                    ) : (
                      <IconReview />
                    )}
                  </IconButton>
                </div>

                {/* Determinate progress bar — per-root; any running row shows its own. */}
                {running ? (
                  <div
                    className="ui-review-progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(percent ?? 0)}
                  >
                    <div className="fill" style={{ width: `${Math.min(100, Math.max(3, percent ?? 0))}%` }} />
                  </div>
                ) : null}

                {run && run.res.ok && runFindings.length > 0 ? (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "0 10px 6px" }}
                  >
                    <Button
                      size="sm"
                      variant="subtle"
                      disabled={runningMap[lastRun!.root] ?? false}
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
                        disabled={runningMap[lastRun!.root] ?? false}
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
