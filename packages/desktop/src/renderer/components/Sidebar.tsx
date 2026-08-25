import { memo, useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { SerializableSessionEntry, WorkspaceSessions } from "../../shared/ipc";
import { api } from "../api";
import { useI18n, type MessageKey, type Translate } from "../i18n";
import { IconButton, Input, StatusDot, IconChat } from "../ui/index";
import { aggregateByWorkspace, aggregateUsage, formatTokens } from "../lib/token-usage";

type Props = {
  activeId: string | null;
  currentRoot: string;
  /** Bumped by the parent to force a reload of the workspace tree. */
  refreshKey: number;
  /** Current workspace sessions (used for the token summary footer). */
  sessions: SerializableSessionEntry[];
  /** treeId → {title, archived} for the current workspace (task badges). */
  treeTitles: Record<string, { title: string; archived: boolean }>;
  onSelectSession: (root: string, id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, summary: string) => void;
  onArchive: (id: string, workspaceRoot?: string) => void;
  onUnarchive: (id: string) => void;
  /** Open the session's bound task tree as a workspace tab (specs/task-tree). */
  onCollapse: () => void;
  onNewWorkspace: () => void;
  onNewSessionInWorkspace: (root: string) => void;
  onOpenTokens: () => void;
};

const KNOWN_STATUSES = new Set([
  "running",
  "completed",
  "error",
  "interrupted",
  "paused",
  "ask_permission",
  "waiting_for_user",
  "compacting",
  "idle",
]);

/** Compact relative-time string (e.g. "3m", "2h", "5d"). */
function relativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

function statusLabel(status: string, t: Translate): string {
  return KNOWN_STATUSES.has(status) ? t(`status.${status}` as MessageKey) : status;
}

const EMPTY: WorkspaceSessions = { workspaces: [], archived: [] };

function matchesQuery(entry: SerializableSessionEntry, q: string): boolean {
  if (!q) return true;
  return (
    (entry.summary ?? "").toLowerCase().includes(q) ||
    entry.id.toLowerCase().includes(q) ||
    entry.status.toLowerCase().includes(q)
  );
}

// Memoized: props are stable references from App; busy/stream ticks skip the tree.
export const Sidebar = memo(function Sidebar({
  activeId,
  currentRoot,
  refreshKey,
  sessions,
  treeTitles,
  onSelectSession,
  onDelete,
  onRename,
  onArchive,
  onUnarchive,
  onCollapse,
  onNewWorkspace,
  onNewSessionInWorkspace,
  onOpenTokens,
}: Props): JSX.Element {
  const { t } = useI18n();
  const [tree, setTree] = useState<WorkspaceSessions>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [archivedOpen, setArchivedOpen] = useState(false);
  // Delete needs a second click to actually fire: sessions are unrecoverable,
  // so a single stray ✕ must not wipe a conversation. The armed state resets
  // itself after a few seconds or when another row is armed.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarmDeleteConfirm = useCallback(() => {
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setConfirmDeleteId(null);
  }, []);

  useEffect(() => disarmDeleteConfirm, [disarmDeleteConfirm]);

  const handleDeleteClick = useCallback(
    (id: string) => {
      if (confirmDeleteId === id) {
        disarmDeleteConfirm();
        onDelete(id);
        return;
      }
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmDeleteId(id);
      confirmTimerRef.current = setTimeout(disarmDeleteConfirm, 3000);
    },
    [confirmDeleteId, disarmDeleteConfirm, onDelete]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.listWorkspaceSessions();
        if (!cancelled) setTree(data);
      } catch (error) {
        // Keep the previous tree on failure — an empty flash is worse than stale data.
        console.error("[sidebar] workspace tree load failed:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const q = searchQuery.trim().toLowerCase();

  const toggleCollapse = useCallback((root: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(root)) next.delete(root);
      else next.add(root);
      return next;
    });
  }, []);

  function beginRename(entry: SerializableSessionEntry): void {
    setEditingId(entry.id);
    setDraft(entry.summary ?? "");
  }

  function commitRename(id: string): void {
    const value = draft.trim();
    if (value) {
      onRename(id, value);
    }
    setEditingId(null);
  }

  const workspaces = useMemo(
    () =>
      tree.workspaces
        .map((w) => ({ ...w, sessions: w.sessions.filter((s) => matchesQuery(s, q)) }))
        .filter((w) => !q || w.sessions.length > 0),
    [tree.workspaces, q]
  );

  const archived = useMemo(() => tree.archived.filter((a) => matchesQuery(a.session, q)), [tree.archived, q]);

  // Token summary footer figures: current workspace total + all workspaces.
  const currentTotal = useMemo(() => aggregateUsage(sessions).totals.total, [sessions]);
  const overallTotal = useMemo(() => aggregateByWorkspace(tree).reduce((sum, row) => sum + row.total, 0), [tree]);

  /**
   * Task badge on a session row — the session↔task cross-reference entry.
   * Clicking goes STRAIGHT to that conversation's workspace (💬) tab: the
   * user asked for the chat, not a detour into the task record — the task
   * history remains reachable from the 任务树 rail (R3-8).
   */
  function renderTaskBadge(entry: SerializableSessionEntry, root: string): JSX.Element | null {
    const treeId = entry.taskRef?.treeId;
    if (!treeId) return null;
    const title = treeTitles[treeId]?.title ?? t("tasktree.taskFallback");
    return (
      <button
        type="button"
        className={`ui-session-task${treeTitles[treeId]?.archived ? " archived" : ""}`}
        title={t("tasktree.sessionTask", { title })}
        onClick={(e) => {
          e.stopPropagation();
          onSelectSession(entry.workspaceRoot ?? root, entry.id);
        }}
      >
        🌳 {title}
      </button>
    );
  }

  function renderSession(root: string, entry: SerializableSessionEntry): JSX.Element {
    const isActive = entry.id === activeId;
    return (
      <div
        key={entry.id}
        className={`ui-session-item ui-tree-session${isActive ? " active" : ""}`}
        onClick={() => onSelectSession(root, entry.id)}
      >
        {editingId === entry.id ? (
          <Input
            type="text"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => commitRename(entry.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename(entry.id);
              if (e.key === "Escape") setEditingId(null);
            }}
          />
        ) : (
          <div className="ui-session-title">
            <span className="ui-tree-icon">
              <IconChat />
            </span>
            {entry.summary || t("sidebar.untitled")}
          </div>
        )}
        <div className="ui-session-meta">
          <StatusDot status={entry.status} />
          <span>{statusLabel(entry.status, t)}</span>
          {renderTaskBadge(entry, root)}
          {entry.activeTokens > 0 ? (
            <span className="ui-session-tokens-badge">{formatTokens(entry.activeTokens)}</span>
          ) : null}
          {entry.updateTime ? <span className="ui-session-time">{relativeTime(entry.updateTime)}</span> : null}
        </div>
        {editingId !== entry.id ? (
          <div className="ui-session-actions" onClick={(e) => e.stopPropagation()}>
            <IconButton
              className="ui-icon-btn--sm"
              data-tip={t("sidebar.rename")}
              aria-label={t("sidebar.rename")}
              onClick={() => beginRename(entry)}
            >
              ✎
            </IconButton>
            <IconButton
              className="ui-icon-btn--sm"
              data-tip={t("sidebar.export")}
              aria-label={t("sidebar.export")}
              onClick={() => void api.exportSession(entry.id)}
            >
              ⤓
            </IconButton>
            <IconButton
              className="ui-icon-btn--sm"
              data-tip={t("workspace.archive")}
              aria-label={t("workspace.archive")}
              onClick={() => onArchive(entry.id, root)}
            >
              ▣
            </IconButton>
            <IconButton
              className={`ui-icon-btn--sm ui-delete-btn${confirmDeleteId === entry.id ? " armed" : ""}`}
              data-tip={confirmDeleteId === entry.id ? t("sidebar.confirmDelete") : t("sidebar.delete")}
              aria-label={confirmDeleteId === entry.id ? t("sidebar.confirmDelete") : t("sidebar.delete")}
              onClick={() => handleDeleteClick(entry.id)}
            >
              ✕
            </IconButton>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ui-session-panel">
      <div className="ui-session-panel-head">
        <span>
          {t("sidebar.sessions")}
          {sessions.length > 0 ? <span className="ui-session-count-badge">{sessions.length}</span> : null}
        </span>
        <div className="ui-session-panel-head-actions">
          <IconButton onClick={onNewWorkspace} title={t("sidebar.newWorkspace")} aria-label={t("sidebar.newWorkspace")}>
            ＋
          </IconButton>
          <IconButton onClick={onCollapse} title={t("sessionPanel.collapse")} aria-label={t("sessionPanel.collapse")}>
            ⟨
          </IconButton>
        </div>
      </div>

      <div className="ui-session-search">
        <Input
          type="text"
          placeholder={t("sidebar.search")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery ? (
          <button className="ui-search-clear" onClick={() => setSearchQuery("")} aria-label={t("common.clear")}>
            ✕
          </button>
        ) : null}
      </div>

      <div className="ui-session-list">
        {workspaces.length === 0 && archived.length === 0 ? (
          <div className="ui-session-empty">{searchQuery ? t("sidebar.noResults") : t("sidebar.none")}</div>
        ) : null}

        {workspaces.map((w) => {
          const isOpen = q ? true : !collapsed.has(w.root);
          const isCurrent = w.root === currentRoot;
          return (
            <div key={w.root} className="ui-tree-workspace">
              <div
                className={`ui-tree-ws-head${isCurrent ? " current" : ""}`}
                onClick={() => toggleCollapse(w.root)}
                title={w.root}
              >
                <span className="ui-tree-caret">{isOpen ? "▾" : "▸"}</span>
                <span className="ui-tree-icon ui-tree-icon-folder" />
                <span className="ui-tree-ws-label">{w.label}</span>
                <span className="ui-tree-count">{w.sessions.length}</span>
                <IconButton
                  className="ui-tree-ws-new"
                  title={t("workspace.newSession")}
                  aria-label={t("workspace.newSession")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNewSessionInWorkspace(w.root);
                  }}
                >
                  ＋
                </IconButton>
              </div>
              {isOpen ? (
                <div className="ui-tree-children">
                  {w.sessions.length === 0 ? (
                    <div className="ui-session-empty">{t("workspace.empty")}</div>
                  ) : (
                    w.sessions.map((s) => renderSession(w.root, s))
                  )}
                </div>
              ) : null}
            </div>
          );
        })}

        {archived.length > 0 ? (
          <div className="ui-tree-workspace ui-tree-archived">
            <div className="ui-tree-ws-head" onClick={() => setArchivedOpen((v) => !v)}>
              <span className="ui-tree-caret">{archivedOpen || q ? "▾" : "▸"}</span>
              <span className="ui-tree-icon ui-tree-icon-archive" />
              <span className="ui-tree-ws-label">{t("workspace.archivedGroup")}</span>
              <span className="ui-tree-count">{archived.length}</span>
            </div>
            {archivedOpen || q ? (
              <div className="ui-tree-children">
                {archived.map(({ root, session }) => (
                  <div key={session.id} className="ui-session-item ui-tree-session archived">
                    <div className="ui-session-title">
                      <span className="ui-tree-icon">
                        <IconChat />
                      </span>
                      {session.summary || t("sidebar.untitled")}
                    </div>
                    {renderTaskBadge(session, root)}
                    <div className="ui-session-actions" onClick={(e) => e.stopPropagation()}>
                      <IconButton
                        className="ui-icon-btn--sm"
                        data-tip={t("workspace.unarchive")}
                        aria-label={t("workspace.unarchive")}
                        onClick={() => onUnarchive(session.id)}
                      >
                        ▣
                      </IconButton>
                      <IconButton
                        className={`ui-icon-btn--sm ui-delete-btn${confirmDeleteId === session.id ? " armed" : ""}`}
                        data-tip={confirmDeleteId === session.id ? t("sidebar.confirmDelete") : t("sidebar.delete")}
                        aria-label={confirmDeleteId === session.id ? t("sidebar.confirmDelete") : t("sidebar.delete")}
                        onClick={() => handleDeleteClick(session.id)}
                      >
                        ✕
                      </IconButton>
                    </div>
                    <div className="ui-tree-ws-path" title={root}>
                      {root}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <button className="ui-session-tokens" onClick={onOpenTokens} title={t("topbar.tokenPanelTitle")}>
        <span className="ui-session-tokens-part">
          <span className="ui-session-tokens-label">{t("tokens.workspaceTotal")}</span>
          <span className="ui-session-tokens-value">{formatTokens(currentTotal)}</span>
        </span>
        <span className="ui-session-tokens-part">
          <span className="ui-session-tokens-label">{t("tokens.overall")}</span>
          <span className="ui-session-tokens-value">{formatTokens(overallTotal)}</span>
        </span>
      </button>
    </div>
  );
});
