import { useCallback, useEffect, useState, type JSX } from "react";
import type { WorkspaceGroup, WorkspaceTaskHub } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton } from "../ui/index";
import { formatRelative } from "./task-hub-format";

/**
 * Task hub sidebar (task-tree-hub design §6.1) — the 左侧工作区列表 half of
 * the review/knowledge interaction paradigm: one row per workspace (status
 * dot, name, latest-activity meta, task count), an 打开任务树 button that
 * opens the per-root TaskHubWorkspace tab in the main area. Rows replace the
 * retired TaskTreePanel rail (whose data scope — sessions only — never
 * matched the module's name).
 */

export function TaskHubPanel({ onOpenTaskHub }: { onOpenTaskHub: (root: string) => void }): JSX.Element {
  const { t } = useI18n();
  const [workspaces, setWorkspaces] = useState<WorkspaceGroup[]>([]);
  const [hubs, setHubs] = useState<Record<string, WorkspaceTaskHub>>({});
  const [activeRoot, setActiveRoot] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [ws, root] = await Promise.all([api.listWorkspaceSessions(), api.getProjectRoot()]);
      setActiveRoot(root);
      setWorkspaces(ws.workspaces);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => api.onProjectRootChanged(() => void reload()), [reload]);

  // Per-workspace aggregated counts (meta JSON only — cheap even ×N rows).
  useEffect(() => {
    let alive = true;
    (async () => {
      const next: Record<string, WorkspaceTaskHub> = {};
      await Promise.all(
        workspaces.map(async (w) => {
          try {
            next[w.root] = await api.taskHubList(w.root);
          } catch {
            // row falls back to "0 tasks"
          }
        })
      );
      if (alive) setHubs(next);
    })();
    return () => {
      alive = false;
    };
  }, [workspaces]);

  const latestOf = (hub: WorkspaceTaskHub | undefined): { at: string; label: string } | null => {
    if (!hub) return null;
    const nodes = hub.groups.flatMap((g) => g.nodes).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const top = nodes[0];
    if (!top) return null;
    return { at: top.startedAt, label: domainLabel(top.domain) };
    function domainLabel(d: string): string {
      return t(`taskhub.domain.${d}` as never);
    }
  };

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("taskhub.title")}</span>
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
            const hub = hubs[w.root];
            const count = hub ? hub.groups.reduce((s, g) => s + g.nodes.length, 0) : null;
            const latest = latestOf(hub);
            return (
              <div key={w.root} className="ui-ik-rowwrap">
                <div
                  className="ui-ik-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenTaskHub(w.root)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenTaskHub(w.root);
                    }
                  }}
                >
                  <span className={`ui-ik-dot ${count ? "on" : "off"}`} aria-hidden />
                  <div className="ui-ik-row-main">
                    <div className="ui-ik-name">{w.label}</div>
                    <div className="ui-ik-meta">
                      {count
                        ? `${t("taskhub.count", { n: count })}${latest ? ` · ${formatRelative(latest.at, t("index.freshness.justNow"), t("review.lastReviewNever"))}` : ""}`
                        : t("taskhub.empty")}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="subtle"
                    className="ui-ik-build"
                    title={t("taskhub.open")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenTaskHub(w.root);
                    }}
                  >
                    {t("taskhub.open")}
                  </Button>
                </div>
                {w.root === activeRoot ? <div className="ui-taskhub-active" aria-hidden /> : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
