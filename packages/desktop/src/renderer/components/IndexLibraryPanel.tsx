import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { useI18n } from "../i18n";
import { formatBuildError } from "../lib/build-error";
import { Button, IconButton } from "../ui/index";
import { useBuildJobs } from "../hooks/useBuildJobs";
import { buildStageVerb, KnowledgeBuildProgress } from "./KnowledgeBuildProgress";
import type { KnowledgeStatusResponse, WorkspaceGroup } from "../../shared/ipc";

/**
 * Index & Knowledge — left rail view (specs/index-knowledge-rework T3).
 *
 * A WORKSPACE LIST, nothing else: each row = status dot + name + last build +
 * its own inline "build" button (per-workspace, independent progress; rows
 * don't block each other). Clicking a row's body opens/focuses the knowledge
 * TAB in the content area (App owns the tab strip — this panel only emits
 * onOpenWorkspace); clicking the build button builds that row without
 * switching tabs. Engine names never surface: the UI says Wiki / symbol
 * index, never OpenWiki/CodeGraph (naming redline).
 */

type Props = {
  /** Open (or focus) the knowledge tab for a workspace root. */
  onOpenWorkspace: (root: string) => void;
};

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

export function IndexLibraryPanel({ onOpenWorkspace }: Props): JSX.Element {
  const { t } = useI18n();
  const [workspaces, setWorkspaces] = useState<WorkspaceGroup[]>([]);
  const [statuses, setStatuses] = useState<Record<string, KnowledgeStatusResponse>>({});
  const mountedRef = useRef(true);

  // R3-5: shared build-job store (one app-wide poller + instant event
  // refresh) — replacing the panel-local polling/effects duplicate.
  const buildJobs = useBuildJobs();
  const jobByRoot = new Map(buildJobs.map((j) => [j.root, j]));

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const ws = await api.listWorkspaceSessions();
      if (!mountedRef.current) return;
      setWorkspaces(ws.workspaces);
      // Per-root knowledge status (the handler accepts an optional root).
      const next: Record<string, KnowledgeStatusResponse> = {};
      await Promise.all(
        ws.workspaces.map(async (w) => {
          try {
            next[w.root] = await api.knowledgeStatus(w.root);
          } catch {
            // Status failures leave the row status-less; the row still lists.
          }
        })
      );
      if (mountedRef.current) {
        setStatuses(next);
        setPanelError(null);
      }
    } catch (err) {
      // A failed list must surface — the old path rendered the "no
      // workspaces" empty state, indistinguishable from a real empty list.
      if (mountedRef.current) setPanelError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Reload statuses once per settled build (the job map retains finished
  // snapshots, so an unconditional effect would loop every poll tick).
  const settledReloaded = useRef(new Set<string>());
  useEffect(() => {
    let needsReload = false;
    for (const job of buildJobs) {
      const key = `${job.root}@${job.startedAt}`;
      if (job.running) {
        settledReloaded.current.delete(key);
      } else if (!settledReloaded.current.has(key)) {
        settledReloaded.current.add(key);
        needsReload = true;
      }
    }
    if (needsReload) void reload();
  }, [buildJobs, reload]);

  /** Build one workspace: serial symbols → Wiki → arch-map; failure stops. */
  const [panelError, setPanelError] = useState<string | null>(null);
  const [buildErrors, setBuildErrors] = useState<Record<string, string>>({});
  // Git preflight ask (2026-08-28): the wiki generator leans on commit
  // history, so a non-repo / zero-commit root gets ONE explicit question
  // before the build — never a silent skeleton-only "success".
  const [gitAsk, setGitAsk] = useState<{
    root: string;
    kind: "no-repo" | "no-commits";
    busy: boolean;
    error: string | null;
  } | null>(null);

  const startBuild = useCallback(
    async (root: string) => {
      // R2-1: fire the MAIN-PROCESS build job and let the shared store render
      // progress — this handler returns immediately; switching rows/tabs never
      // cancels the job and re-mounting re-reads live state. Mode selection
      // (init vs update) lives in the manager.
      try {
        setBuildErrors((prev) => {
          if (!(root in prev)) return prev;
          const next = { ...prev };
          delete next[root];
          return next;
        });
        const job = await api.knowledgeBuild(root);
        if (!job.running) {
          await reload();
        }
      } catch (err) {
        // A rejected start used to look like a dead button — surface it on
        // the row that was clicked.
        setBuildErrors((prev) => ({ ...prev, [root]: err instanceof Error ? err.message : String(err) }));
      }
    },
    [reload]
  );

  const build = useCallback(
    async (root: string) => {
      try {
        const pre = await api.knowledgeGitPreflight(root);
        if (pre.isRepo && pre.hasCommits) {
          await startBuild(root);
          return;
        }
        setGitAsk({ root, kind: pre.isRepo ? "no-commits" : "no-repo", busy: false, error: null });
      } catch {
        // Preflight itself failed (git missing / IPC down) — never block the
        // build on it; the wiki stage's zero-pages guard still catches a
        // dead run with an actionable hint.
        await startBuild(root);
      }
    },
    [startBuild]
  );

  const confirmGitBootstrap = useCallback(async () => {
    if (!gitAsk || gitAsk.busy) return;
    setGitAsk({ ...gitAsk, busy: true, error: null });
    try {
      const res = await api.knowledgeGitBootstrap(gitAsk.root);
      if (!res.ok) {
        setGitAsk({ ...gitAsk, busy: false, error: res.error });
        return;
      }
      setGitAsk(null);
      await startBuild(gitAsk.root);
    } catch (err) {
      setGitAsk({ ...gitAsk, busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  }, [gitAsk, startBuild]);

  const stateDot = (status: KnowledgeStatusResponse | undefined): string => {
    if (!status) return "";
    const states = [status.codegraph.state, status.openwiki.state, status.archmaps.state];
    if (states.includes("indexed")) return states.includes("stale") || states.includes("empty") ? "partial" : "on";
    return "off";
  };

  /** Stage-aware progress text — mode-aware verb (生成/更新索引 → 构建 Wiki →
   * 架构图) + elapsed; the wiki stage has no percent stream, so rows show the
   * running stage instead of a frozen number. */
  const rowProgress = (root: string): { busy: boolean; text: string; error: string | null } => {
    const job = jobByRoot.get(root);
    if (!job) return { busy: false, text: "", error: null };
    if (job.running) {
      const running = job.stages.find((s) => s.status === "running");
      const label = running ? buildStageVerb(running, job.mode, t) : t("index.building");
      const elapsed = Math.max(0, Math.round((Date.now() - new Date(job.startedAt).getTime()) / 1000));
      const mm = Math.floor(elapsed / 60);
      const ss = String(elapsed % 60).padStart(2, "0");
      return { busy: true, text: `${label} · ${mm}:${ss}`, error: null };
    }
    return { busy: false, text: "", error: job.error };
  };

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("index.title")}</span>
        <IconButton onClick={() => void reload()} title={t("scm.refresh")} aria-label={t("scm.refresh")}>
          ⟳
        </IconButton>
      </div>
      <div className="ui-side-panel-body">
        {panelError ? <div className="ui-scm-error">{panelError}</div> : null}
        {workspaces.length === 0 && !panelError ? (
          <div className="ui-side-panel-empty">{t("index.empty")}</div>
        ) : (
          workspaces.map((w) => {
            const row = rowProgress(w.root);
            const status = statuses[w.root];
            const buildError = buildErrors[w.root];
            const lastBuild = status?.openwiki.lastSync ?? status?.codegraph.lastSync ?? undefined;
            const runningJob = jobByRoot.get(w.root);
            return (
              <div key={w.root} className="ui-ik-rowwrap">
                <div
                  className="ui-ik-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenWorkspace(w.root)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenWorkspace(w.root);
                    }
                  }}
                >
                  <span className={`ui-ik-dot ${stateDot(status)}`} aria-hidden />
                  <div className="ui-ik-row-main">
                    <div className="ui-ik-name">{w.label}</div>
                    <div className="ui-ik-meta">
                      {row.busy
                        ? row.text
                        : buildError
                          ? formatBuildError(buildError, t, 60)
                          : row.error
                            ? formatBuildError(row.error, t, 60)
                            : formatRelative(lastBuild, t("index.freshness.justNow"), t("index.freshness.never"))}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="subtle"
                    className="ui-ik-build"
                    disabled={row.busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void build(w.root);
                    }}
                    title={t("index.buildKnowledge")}
                  >
                    {row.busy ? "…" : t("index.build")}
                  </Button>
                </div>
                {/* Real-machine feedback: progress lives UNDER the workspace's
                    row — next to the thing being built, not inside the tab. */}
                {row.busy && runningJob ? <KnowledgeBuildProgress job={runningJob} variant="compact" /> : null}
              </div>
            );
          })
        )}
      </div>
      {gitAsk
        ? // Portaled to <body> (same pattern as the arch lightbox and the
          // symbol-graph popover): the panel tree sits under transform/containment
          // ancestors that CAPTURE position:fixed — rendered inline, this dialog
          // anchored inside the side panel instead of covering the window.
          createPortal(
            <div className="ui-modal-overlay" role="dialog" aria-modal="true">
              <div className="ui-modal" onClick={(e) => e.stopPropagation()}>
                <h2>{t(gitAsk.kind === "no-repo" ? "index.gitNoRepoTitle" : "index.gitNoCommitsTitle")}</h2>
                <div className="ui-modal-sub">
                  {t(gitAsk.kind === "no-repo" ? "index.gitNoRepoBody" : "index.gitNoCommitsBody")}
                  {gitAsk.error ? <div className="ui-scm-error">{gitAsk.error}</div> : null}
                </div>
                <div className="ui-modal-actions">
                  <Button variant="subtle" disabled={gitAsk.busy} onClick={() => setGitAsk(null)}>
                    {t("common.cancel")}
                  </Button>
                  <Button disabled={gitAsk.busy} onClick={() => void confirmGitBootstrap()}>
                    {gitAsk.busy ? "…" : t("index.gitBootstrapConfirm")}
                  </Button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
