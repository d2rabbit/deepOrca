/**
 * TaskTreePanel — left-rail module (task-tree R3-7): the WORKSPACE-dimension
 * task history. Every known workspace expands to its task trees (title,
 * branch/node counts, freshness, archived collapsed); clicking a tree opens
 * the task RECORD tab in the content area (TaskRecordPanel) — task records
 * and operation trajectories, never conversation content.
 *
 * Mutations live in the record tab now; this rail is navigation + history.
 * A quick-create form remains for the ACTIVE workspace.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton } from "../ui/index";
import type { TaskTreeSummary } from "@deeporca/core";
import type { WorkspaceGroup } from "../../shared/ipc";

type Props = {
  /** Open the task record tab in the content area. */
  onOpenTask: (treeId: string, title: string, root: string) => void;
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

export function TaskTreePanel({ onOpenTask }: Props): JSX.Element {
  const { t } = useI18n();
  const [workspaces, setWorkspaces] = useState<WorkspaceGroup[]>([]);
  const [treesByRoot, setTreesByRoot] = useState<Record<string, TaskTreeSummary[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [projectRoot, setProjectRoot] = useState("");
  // Quick-create form (active workspace only)
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [newWhy, setNewWhy] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadRoot = useCallback(async (root: string) => {
    try {
      const trees = await api.taskTreeList(root);
      if (mountedRef.current) {
        setTreesByRoot((prev) => ({ ...prev, [root]: trees }));
      }
    } catch {
      if (mountedRef.current) setTreesByRoot((prev) => ({ ...prev, [root]: [] }));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [ws, root] = await Promise.all([api.listWorkspaceSessions(), api.getProjectRoot()]);
      if (!mountedRef.current) return;
      setWorkspaces(ws.workspaces);
      setProjectRoot(root ?? "");
      const next: Record<string, TaskTreeSummary[]> = {};
      await Promise.all(
        ws.workspaces.map(async (w) => {
          try {
            next[w.root] = await api.taskTreeList(w.root);
          } catch {
            next[w.root] = [];
          }
        })
      );
      if (mountedRef.current) {
        setTreesByRoot(next);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Agent-side task.* mutations have no push channel — 15s keeps history
    // eventually-consistent without a server round-trip per keystroke.
    const timer = setInterval(() => void refresh(), 15_000);
    const off = api.onProjectRootChanged(() => void refresh());
    return () => {
      clearInterval(timer);
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    const p = newPrompt.trim();
    const w = newWhy.trim();
    if (!p || !w) return;
    const result = await api.taskTreeCreate(p, w).catch((err: Error) => ({ error: err.message }));
    if ("error" in result && result.error) {
      setNotice(result.error);
      return;
    }
    setNewPrompt("");
    setNewWhy("");
    setCreateFormOpen(false);
    setNotice(t("tasktree.created"));
    setExpanded(projectRoot);
    void loadRoot(projectRoot);
  };

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("tasktree.title")}</span>
        <IconButton onClick={() => void refresh()} title={t("scm.refresh")} aria-label={t("scm.refresh")}>
          ⟳
        </IconButton>
      </div>
      <div className="ui-side-panel-body">
        {error ? <div className="ui-side-panel-empty">{error}</div> : null}
        {workspaces.length === 0 && !error ? <div className="ui-side-panel-empty">{t("tasktree.empty")}</div> : null}

        {workspaces.map((w) => {
          const trees = treesByRoot[w.root] ?? [];
          const active = trees.filter((tr) => !tr.archived);
          const archived = trees.filter((tr) => tr.archived);
          const open = expanded === w.root;
          return (
            <div key={w.root} className="ui-tasktree-ws">
              <button
                type="button"
                className="ui-tasktree-ws-row"
                onClick={() => {
                  setExpanded(open ? null : w.root);
                  if (!open && !treesByRoot[w.root]) void loadRoot(w.root);
                }}
              >
                <span className={`ui-wiki-tree-chevron${open ? " open" : ""}`}>▸</span>
                <span className="ui-tasktree-ws-name">{w.label}</span>
                <span className="ui-tasktree-ws-count">{active.length}</span>
              </button>
              {open ? (
                <div className="ui-tasktree-ws-body">
                  {active.length === 0 ? (
                    <div className="ui-tasktree-empty-hint">暂无任务记录</div>
                  ) : (
                    active.map((tr) => (
                      <button
                        key={tr.id}
                        type="button"
                        className="ui-tasktree-task"
                        onClick={() => onOpenTask(tr.id, tr.title, w.root)}
                        title={tr.title}
                      >
                        <span className="ui-tasktree-task-title">{tr.title}</span>
                        <span className="ui-tasktree-task-meta">
                          {tr.branchCount} 分支 · {tr.nodeCount} 节点 ·{" "}
                          {formatRelative(tr.updatedAt, t("index.freshness.justNow"), t("index.freshness.never"))}
                        </span>
                      </button>
                    ))
                  )}
                  {archived.length > 0 ? (
                    <div className="ui-tasktree-archived">
                      <button
                        type="button"
                        className="ui-tasktree-archived-toggle"
                        onClick={() => setArchivedOpen((v) => !v)}
                      >
                        {archivedOpen ? "▾" : "▸"} 已归档 · {archived.length}
                      </button>
                      {archivedOpen
                        ? archived.map((tr) => (
                            <button
                              key={tr.id}
                              type="button"
                              className="ui-tasktree-task archived"
                              onClick={() => onOpenTask(tr.id, tr.title, w.root)}
                              title={tr.title}
                            >
                              <span className="ui-tasktree-task-title">{tr.title}</span>
                              <span className="ui-tasktree-task-meta">
                                {formatRelative(tr.updatedAt, t("index.freshness.justNow"), t("index.freshness.never"))}
                              </span>
                            </button>
                          ))
                        : null}
                    </div>
                  ) : null}
                  {w.root === projectRoot ? (
                    <button
                      type="button"
                      className="ui-tasktree-create-toggle"
                      onClick={() => setCreateFormOpen((v) => !v)}
                    >
                      + 新建任务
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {createFormOpen ? (
          <div className="ui-tasktree-create">
            <input
              type="text"
              value={newPrompt}
              placeholder={t("tasktree.newPrompt")}
              onChange={(e) => setNewPrompt(e.target.value)}
            />
            <input
              type="text"
              value={newWhy}
              placeholder={t("tasktree.newWhy")}
              onChange={(e) => setNewWhy(e.target.value)}
            />
            <Button size="sm" disabled={!newPrompt.trim() || !newWhy.trim()} onClick={() => void create()}>
              {t("tasktree.create")}
            </Button>
          </div>
        ) : null}
        {notice ? <div className="ui-tasktree-notice">{notice}</div> : null}
      </div>
    </div>
  );
}
