import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton } from "../ui/index";
import type { ActionProgressEvent, KnowledgeStatusResponse, WorkspaceGroup } from "../../shared/ipc";

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

type RowState = {
  busy: boolean;
  percent: number | null;
  error: string | null;
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
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
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
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // R2-1: rows are a read-only subscription over the main-process job map —
  // ActionProgress (data.root tagged) for instant updates, plus a 2s poll of
  // knowledgeBuildStatus so remounting picks up live jobs it didn't start.
  useEffect(() => {
    const off = api.onActionProgress((event: ActionProgressEvent) => {
      if (event.actionId !== "index.build-all") return;
      const root = (event.data as { root?: string } | undefined)?.root;
      if (!root) return;
      setRows((prev) => {
        const row = prev[root] ?? { busy: false, percent: null, error: null };
        return { ...prev, [root]: { busy: true, percent: event.percent ?? row.percent, error: null } };
      });
    });
    const timer = setInterval(async () => {
      try {
        const jobs = await api.knowledgeBuildStatus();
        setRows((prev) => {
          const next = { ...prev };
          for (const job of jobs) {
            next[job.root] = { busy: job.running, percent: job.percent, error: job.error };
          }
          return next;
        });
        if (jobs.some((job) => !job.running && job.percent === 100)) {
          void reload();
        }
      } catch {
        // status poll failure is non-fatal
      }
    }, 2000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [reload]);

  /** Build one workspace: serial symbols → Wiki → arch-map; failure stops. */
  const build = useCallback(
    async (root: string) => {
      // R2-1: fire the MAIN-PROCESS build job and let the subscription render
      // progress — this handler returns immediately; switching rows/tabs never
      // cancels the job and re-mounting re-reads live status. Mode selection
      // (init vs update) lives in the manager.
      const job = await api.knowledgeBuild(root);
      setRows((prev) => ({
        ...prev,
        [root]: { busy: job.running, percent: job.percent, error: job.error },
      }));
      if (!job.running) {
        await reload();
      }
    },
    [reload]
  );

  const stateDot = (status: KnowledgeStatusResponse | undefined): string => {
    if (!status) return "";
    const states = [status.codegraph.state, status.openwiki.state, status.archmaps.state];
    if (states.includes("indexed")) return states.includes("stale") || states.includes("empty") ? "partial" : "on";
    return "off";
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
        {workspaces.length === 0 ? (
          <div className="ui-side-panel-empty">{t("index.empty")}</div>
        ) : (
          workspaces.map((w) => {
            const row = rows[w.root] ?? { busy: false, percent: null, error: null };
            const status = statuses[w.root];
            const lastBuild = status?.openwiki.lastSync ?? status?.codegraph.lastSync ?? undefined;
            return (
              <div key={w.root} className="ui-ik-row" onClick={() => onOpenWorkspace(w.root)}>
                <span className={`ui-ik-dot ${stateDot(status)}`} aria-hidden />
                <div className="ui-ik-row-main">
                  <div className="ui-ik-name">{w.label}</div>
                  <div className="ui-ik-meta">
                    {row.busy
                      ? `${t("index.building")}${row.percent != null ? ` ${row.percent}%` : ""}`
                      : row.error
                        ? row.error.slice(0, 60)
                        : `${formatRelative(lastBuild, t("index.freshness.justNow"), t("index.freshness.never"))}`}
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
            );
          })
        )}
      </div>
    </div>
  );
}
