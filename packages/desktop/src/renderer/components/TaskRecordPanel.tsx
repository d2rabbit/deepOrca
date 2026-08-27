/**
 * TaskRecordPanel (task-tree R3-7) — the CONTENT-AREA tab body opened from
 * the workspace-dimension task list. Shows the task RECORD (branches, node
 * tree with why/status/artifacts) and the operation TRAJECTORY (the agent's
 * tool-call trace over the task's bound sessions + the tree's own reflog).
 *
 * Deliberately NOT a conversation view: session messages are only read as
 * operation records (tool, outcome, summary, touched files) extracted
 * main-side by knowledge of the task-tree IPC — no chat content is rendered
 * here, per the module's contract.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { api } from "../api";
import { Button, IconUndo } from "../ui/index";
import { useI18n } from "../i18n";
import type { TaskNode, TaskReflogEntry, TaskTreeIndex, TaskTreeSummary } from "@deeporca/core";
import type { TaskTrajectory } from "../../shared/ipc";

type Props = {
  treeId: string;
  workspaceRoot?: string;
};

const KIND_ICON: Record<TaskNode["kind"], string> = {
  root: "◆",
  step: "•",
  fork: "⑂",
  merge: "⑃",
  "memory-spawn": "✦",
};

const STATUS_CLASS: Record<TaskNode["status"], string> = {
  planned: "planned",
  running: "running",
  done: "done",
  abandoned: "abandoned",
};

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function NodeTree({
  nodes,
  parentId,
  depth,
  artifactLabel,
  memoryBranchLabel,
  canRestore,
  onRestoreNode,
}: {
  nodes: TaskNode[];
  parentId: string | null;
  depth: number;
  artifactLabel: (n: number) => string;
  memoryBranchLabel: (similarity: number) => string;
  /** False while any tree op runs (restore itself, or merge/fork/etc.). */
  canRestore: boolean;
  onRestoreNode: (nodeId: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const children = nodes.filter((n) => n.parentId === parentId);
  if (children.length === 0) return <></>;
  return (
    <>
      {children.map((node) => (
        <div key={node.id} className="ui-taskrec-node">
          <div className="ui-taskrec-node-line" style={{ paddingLeft: 8 + depth * 18 }}>
            <span className="ui-taskrec-node-icon">{KIND_ICON[node.kind]}</span>
            <span className={`ui-taskrec-node-status ${STATUS_CLASS[node.status]}`} title={node.status} />
            <span className="ui-taskrec-node-title">{node.title}</span>
            <span className="ui-taskrec-node-meta">
              {formatTime(node.createdAt)}
              {node.artifactRefs.length > 0 ? ` · ${artifactLabel(node.artifactRefs.length)}` : ""}
            </span>
            {node.meta.snapshot && node.status === "done" ? (
              <button
                type="button"
                className="ui-taskrec-restore"
                disabled={!canRestore}
                title={t("tasktree.restoreSnapshot", { count: node.meta.snapshot.files })}
                onClick={() => onRestoreNode(node.id)}
              >
                <IconUndo />
              </button>
            ) : null}
          </div>
          {node.why ? (
            <div className="ui-taskrec-node-why" style={{ paddingLeft: 26 + depth * 18 }}>
              {node.why}
            </div>
          ) : null}
          {node.meta.memorySeed ? (
            <div className="ui-taskrec-node-why" style={{ paddingLeft: 26 + depth * 18 }}>
              ✦ {memoryBranchLabel(node.meta.memorySeed.similarity)}
            </div>
          ) : null}
          <NodeTree
            nodes={nodes}
            parentId={node.id}
            depth={depth + 1}
            artifactLabel={artifactLabel}
            memoryBranchLabel={memoryBranchLabel}
            canRestore={canRestore}
            onRestoreNode={onRestoreNode}
          />
        </div>
      ))}
    </>
  );
}

export function TaskRecordPanel({ treeId, workspaceRoot }: Props): JSX.Element {
  const { t } = useI18n();
  const [summary, setSummary] = useState<TaskTreeSummary | null>(null);
  const [detail, setDetail] = useState<{ index: TaskTreeIndex; nodes: TaskNode[] } | null>(null);
  const [reflog, setReflog] = useState<TaskReflogEntry[]>([]);
  const [trajectory, setTrajectory] = useState<TaskTrajectory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [section, setSection] = useState<"record" | "trajectory">("record");
  const [forkWhy, setForkWhy] = useState("");
  // In-flight guard: without it a double-click fired the merge/switch twice.
  const [acting, setActing] = useState<string | null>(null);
  // Two-step confirm for the irreversible branch ops (merge/abandon).
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  // Snapshot restore is its own in-flight op (confirm dialog + file rewrite).
  const [restoring, setRestoring] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    },
    []
  );

  const reload = useCallback(async () => {
    try {
      const [list, tree, rl, tj] = await Promise.all([
        api.taskTreeList(workspaceRoot),
        api.taskTreeGet(treeId, workspaceRoot),
        api.taskTreeReflog(treeId, workspaceRoot),
        api.taskTreeTrajectory(treeId, workspaceRoot),
      ]);
      setSummary(list.find((s) => s.id === treeId) ?? null);
      setDetail(tree);
      setReflog(rl);
      setTrajectory(tj);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [treeId, workspaceRoot]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 15_000);
    return () => clearInterval(timer);
  }, [reload]);

  /** Run one tree op. Returns true on success — callers gate input cleanup
   *  (e.g. fork reason) on it, and the notice auto-expires instead of
   *  lingering over the next operation's result. */
  const run = useCallback(
    async (
      label: string,
      fn: () => Promise<{ ok?: boolean; error?: string } | boolean | string | null>
    ): Promise<boolean> => {
      if (acting) return false;
      setActing(label);
      try {
        const result = await fn();
        const bad =
          result === false || (typeof result === "object" && result !== null && "error" in result && result.error);
        setNotice(bad ? String((result as { error?: string }).error ?? label) : t("taskrec.done", { label }));
        await reload();
        return !bad;
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setActing(null);
        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = setTimeout(() => setNotice(null), 5000);
      }
    },
    [acting, reload, t]
  );

  /** First click arms the destructive op; a second click within 3s fires it. */
  const armOrRun = useCallback(
    (key: string, label: string, fn: () => Promise<{ ok?: boolean; error?: string } | boolean | string | null>) => {
      if (confirmKey === key) {
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
        setConfirmKey(null);
        void run(label, fn);
        return;
      }
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmKey(key);
      confirmTimerRef.current = setTimeout(() => setConfirmKey(null), 3000);
    },
    [confirmKey, run]
  );

  /** Explicit snapshot restore (panel rewind): put the workspace's artifact
   *  files back to a node's checkpoint. Confirmation first — it rewrites
   *  working files. Notice plumbing mirrors run() without hijacking its
   *  generic success text (restored count matters here). */
  const handleRestoreSnapshot = useCallback(
    async (nodeId: string) => {
      if (restoring || acting !== null) return;
      if (!window.confirm(t("tasktree.snapshotConfirm"))) return;
      setRestoring(true);
      try {
        const result = await api.taskTreeSnapshotRestore(treeId, nodeId, workspaceRoot);
        setNotice(
          result.ok
            ? t("tasktree.snapshotRestored", { count: result.restored ?? 0 })
            : t("tasktree.snapshotFailed", { error: result.error ?? "" })
        );
        await reload();
      } catch (err) {
        setNotice(t("tasktree.snapshotFailed", { error: err instanceof Error ? err.message : String(err) }));
      } finally {
        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = setTimeout(() => setNotice(null), 5000);
        setRestoring(false);
      }
    },
    [acting, noticeTimerRef, reload, restoring, t, treeId, workspaceRoot]
  );

  if (error) return <div className="ui-side-panel-empty">{error}</div>;
  if (!detail) {
    return (
      <div className="ui-side-panel-empty">
        <span className="ui-spinner" />
      </div>
    );
  }

  const index = detail.index;
  const branches = Object.values(index.branches);
  const root = detail.nodes.find((n) => n.parentId === null) ?? detail.nodes[0];
  const activeBranch = index.activeBranch;
  const workspaceLabel = (workspaceRoot ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
  const busy = acting !== null;

  return (
    <div className="ui-taskrec">
      <div className="ui-taskrec-head">
        <div className="ui-taskrec-title-block">
          <span className="ui-taskrec-title">{index.title}</span>
          {summary?.archived ? <span className="ui-taskrec-badge archived">{t("taskrec.archivedBadge")}</span> : null}
          {workspaceLabel ? <span className="ui-taskrec-badge">{workspaceLabel}</span> : null}
        </div>
        <div className="ui-taskrec-subtitle">
          {t("taskrec.created")} {formatTime(index.createdAt)} · {t("taskrec.updated")} {formatTime(index.updatedAt)} ·{" "}
          {index.branches ? Object.keys(index.branches).length : 0} {t("taskrec.branches")} · {detail.nodes.length}{" "}
          {t("taskrec.nodes")} · {summary?.sessionIds.length ?? 0} {t("taskrec.sessions")}
        </div>
        <div className="ui-taskrec-section-tabs">
          <button type="button" className={section === "record" ? "active" : ""} onClick={() => setSection("record")}>
            {t("taskrec.tabRecord")}
          </button>
          <button
            type="button"
            className={section === "trajectory" ? "active" : ""}
            onClick={() => setSection("trajectory")}
          >
            {t("taskrec.tabTrajectory")}
            {trajectory ? ` · ${trajectory.operations.length}` : ""}
          </button>
        </div>
      </div>

      {notice ? <div className="ui-taskrec-notice">{notice}</div> : null}

      {section === "record" ? (
        <div className="ui-taskrec-body">
          <div className="ui-taskrec-section">
            <div className="ui-taskrec-section-label">{t("taskrec.section.branches")}</div>
            <div className="ui-taskrec-branches">
              {branches.map((b) => {
                const mergeKey = `merge:${b.name}`;
                const abandonKey = `abandon:${b.name}`;
                return (
                  <div
                    key={b.name}
                    className={`ui-taskrec-branch${b.abandoned ? " abandoned" : ""}${b.name === activeBranch ? " active" : ""}`}
                  >
                    <span className="ui-taskrec-branch-name">
                      {b.name === activeBranch ? "● " : b.abandoned ? "○ " : "◦ "}
                      {b.name}
                    </span>
                    <span className="ui-taskrec-branch-meta">{formatTime(b.createdAt)}</span>
                    {!b.abandoned && b.name !== activeBranch ? (
                      <Button
                        size="sm"
                        variant="subtle"
                        disabled={busy}
                        onClick={() =>
                          void run(t("taskrec.switch"), () => api.taskTreeSwitch(treeId, b.name, workspaceRoot))
                        }
                      >
                        {t("taskrec.switch")}
                      </Button>
                    ) : null}
                    {!b.abandoned && b.name !== activeBranch ? (
                      <Button
                        size="sm"
                        variant="subtle"
                        disabled={busy}
                        title={confirmKey === mergeKey ? t("taskrec.confirmMerge") : undefined}
                        onClick={() =>
                          armOrRun(mergeKey, t("taskrec.merge"), () => api.taskTreeMerge(treeId, b.name, workspaceRoot))
                        }
                      >
                        {confirmKey === mergeKey ? t("taskrec.confirmMerge") : t("taskrec.merge")}
                      </Button>
                    ) : null}
                    {!b.abandoned ? (
                      <Button
                        size="sm"
                        variant="subtle"
                        disabled={busy}
                        title={confirmKey === abandonKey ? t("taskrec.confirmAbandon") : undefined}
                        onClick={() =>
                          armOrRun(abandonKey, t("taskrec.abandon"), () =>
                            api.taskTreeAbandon(treeId, b.name, workspaceRoot)
                          )
                        }
                      >
                        {confirmKey === abandonKey ? t("taskrec.confirmAbandon") : t("taskrec.abandon")}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="ui-taskrec-section">
            <div className="ui-taskrec-section-label">{t("taskrec.section.nodes")}</div>
            <div className="ui-taskrec-nodes">
              {root ? (
                <NodeTree
                  nodes={detail.nodes}
                  parentId={root.parentId}
                  depth={0}
                  artifactLabel={(n) => t("taskrec.artifacts", { n })}
                  memoryBranchLabel={(similarity) => t("taskrec.memoryBranch", { pct: (similarity * 100).toFixed(0) })}
                  canRestore={!restoring && !busy}
                  onRestoreNode={(nodeId) => void handleRestoreSnapshot(nodeId)}
                />
              ) : null}
            </div>
          </div>

          <div className="ui-taskrec-section">
            <div className="ui-taskrec-section-label">{t("taskrec.section.ops")}</div>
            <div className="ui-taskrec-ops">
              <div className="ui-taskrec-fork">
                <input
                  type="text"
                  value={forkWhy}
                  placeholder={t("taskrec.forkPlaceholder")}
                  onChange={(e) => setForkWhy(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={!forkWhy.trim() || busy}
                  onClick={() => {
                    void run("Fork", async () => {
                      const r = await api.taskTreeFork(treeId, forkWhy.trim(), undefined, workspaceRoot);
                      return r as unknown as { ok?: boolean; error?: string };
                    }).then((ok) => {
                      // Keep the user's reason on failure — it was lost before.
                      if (ok) setForkWhy("");
                    });
                  }}
                >
                  ⑂ Fork
                </Button>
              </div>
              {summary?.archived ? (
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={busy}
                  onClick={() => void run(t("taskrec.unarchive"), () => api.taskTreeUnarchive(treeId, workspaceRoot))}
                >
                  {t("taskrec.unarchive")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={busy}
                  onClick={() => void run(t("taskrec.archive"), () => api.taskTreeArchive(treeId, workspaceRoot))}
                >
                  {t("taskrec.archive")}
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="ui-taskrec-body">
          {trajectory ? (
            <>
              <div className="ui-taskrec-stats">
                <span className="ui-taskrec-stat">
                  <strong>{trajectory.operations.length}</strong> {t("taskrec.statOps")}
                </span>
                <span className="ui-taskrec-stat">
                  <strong>{trajectory.sessionCount}</strong> {t("taskrec.statSessions")}
                </span>
                <span className="ui-taskrec-stat">
                  <strong>{trajectory.filesTouched.length}</strong> {t("taskrec.statFiles")}
                </span>
                {Object.entries(trajectory.toolCounts)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([tool, count]) => (
                    <span key={tool} className="ui-taskrec-tool-chip">
                      {tool.replace(/^mcp__/, "")} ×{count}
                    </span>
                  ))}
              </div>

              {trajectory.filesTouched.length > 0 ? (
                <div className="ui-taskrec-section">
                  <div className="ui-taskrec-section-label">{t("taskrec.section.files")}</div>
                  <div className="ui-taskrec-files">
                    {trajectory.filesTouched.slice(0, 30).map((f) => (
                      <span key={f} className="ui-taskrec-file" title={f}>
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="ui-taskrec-section">
                <div className="ui-taskrec-section-label">{t("taskrec.section.trajectory")}</div>
                <div className="ui-taskrec-ops-timeline">
                  {trajectory.operations.map((op, i) => (
                    <div key={i} className="ui-taskrec-op">
                      <span className="ui-taskrec-op-time">{formatTime(op.at)}</span>
                      <span className={`ui-taskrec-op-tool${op.ok ? "" : " fail"}`}>{op.tool}</span>
                      {op.summary ? <span className="ui-taskrec-op-summary">{op.summary}</span> : null}
                    </div>
                  ))}
                  {trajectory.operations.length === 0 ? (
                    <div className="ui-side-panel-empty">{t("taskrec.noOps")}</div>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <div className="ui-side-panel-empty">{t("taskrec.noTrajectory")}</div>
          )}

          <div className="ui-taskrec-section">
            <div className="ui-taskrec-section-label">{t("taskrec.reflog")}</div>
            <div className="ui-taskrec-ops-timeline">
              {reflog.map((entry, i) => (
                <div key={i} className="ui-taskrec-op dim">
                  <span className="ui-taskrec-op-time">{formatTime(entry.at)}</span>
                  <span className="ui-taskrec-op-tool">{entry.op}</span>
                  <span className="ui-taskrec-op-summary">
                    {entry.branch}
                    {entry.detail ? ` · ${entry.detail}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
