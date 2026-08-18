/**
 * TaskTreePanel — the HUMAN-facing view of the agent's task trajectory
 * (specs/task-tree), presented as TASK HISTORY (git-log style):
 *
 *   left  — the task (tree) list; each task is one unit of history,
 *   right — branch chips + a newest-first vertical timeline for the selected
 *           branch (every node with its `why` narrative) + the append-only
 *           reflog (the operation journal — what happened, in order).
 *
 * Mutations stay operational from the UI: create / fork / switch / abandon /
 * merge — every mutation requires the human-facing `why`.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { api } from "../api";
import type { TaskNode, TaskReflogEntry, TaskTreeIndex, TaskTreeSummary } from "@deeporca/core";
import { useI18n, type MessageKey } from "../i18n";

/** Stable color per branch name (hash-based palette, no config). */
const BRANCH_COLORS = ["#4f8ef7", "#f7a04f", "#6fcf7c", "#c77fd6", "#ef6f8e", "#f7d24f"];
function branchColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return BRANCH_COLORS[hash % BRANCH_COLORS.length]!;
}

/** Node lineage of a branch: root → … → head (chronological order). */
function laneNodes(index: TaskTreeIndex, nodes: TaskNode[], branch: string): TaskNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const headId = index.branches[branch]?.headId;
  const lane: TaskNode[] = [];
  let cursor = headId ? byId.get(headId) : undefined;
  let guard = 0;
  while (cursor && guard < 512) {
    lane.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    guard += 1;
  }
  return lane;
}

function NodeIcon({ kind }: { kind: TaskNode["kind"] }): JSX.Element {
  const glyph =
    kind === "root" ? "🌳" : kind === "fork" || kind === "memory-spawn" ? "⑂" : kind === "merge" ? "⇄" : "·";
  return kind === "memory-spawn" ? <span title="memory-spawn">✦</span> : <span>{glyph}</span>;
}

/** ISO timestamp → compact "MM-DD HH:mm" for history rows. */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const btnStyle: React.CSSProperties = {
  fontSize: 10,
  padding: "2px 7px",
  borderRadius: 4,
  border: "1px solid var(--ui-border-soft, #444)",
  background: "transparent",
  color: "var(--ui-text-dim)",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "4px 6px",
  borderRadius: 4,
  border: "1px solid var(--ui-border-soft, #444)",
  background: "var(--ui-input-bg, rgba(0,0,0,0.15))",
  color: "var(--ui-text)",
  width: "100%",
};

export function TaskTreePanel({ treeId }: { treeId?: string }): JSX.Element {
  const { t } = useI18n();
  const [trees, setTrees] = useState<TaskTreeSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ index: TaskTreeIndex; nodes: TaskNode[] } | null>(null);
  const [reflog, setReflog] = useState<TaskReflogEntry[]>([]);
  const [reflogOpen, setReflogOpen] = useState(false);
  const [archivedTreesOpen, setArchivedTreesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string>("");
  // Branch whose history the timeline shows. null → follow the active branch.
  const [viewBranch, setViewBranch] = useState<string | null>(null);
  // Create-tree form
  const [newPrompt, setNewPrompt] = useState("");
  const [newWhy, setNewWhy] = useState("");
  // Fork form (per tree)
  const [forkWhy, setForkWhy] = useState("");
  // Mirror of `selected` for stable callbacks — the 15s poll and the workspace
  // listener must read the CURRENT selection, not the one captured at mount
  // (a stale closure here resets the user's selection back to the first tree).
  const selectedRef = useRef<string | null>(null);
  // Single-tree mode: embedded as a workspace tab opened from a session badge
  // — the tree list and create form are hidden; only this tree is shown.
  const singleTree = typeof treeId === "string" && treeId.length > 0;

  const refresh = useCallback(
    async (keepSelection?: string | null) => {
      try {
        const list = await api.taskTreeList();
        setTrees(list);
        setError(null);
        if (singleTree && treeId) {
          setSelected(treeId);
          return;
        }
        const current = keepSelection ?? selectedRef.current;
        if (current && list.some((tr) => tr.id === current)) {
          setSelected(current);
        } else {
          // Default selection prefers an active tree; archived ones live in
          // the collapsed archive section at the bottom of the list.
          const firstActive = list.find((tr) => !tr.archived) ?? list[0];
          setSelected(firstActive ? firstActive.id : null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [singleTree, treeId]
  );

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Workspace binding: resolve the current root once, then follow changes —
  // the tree store is per-workspace, so a root switch resets the view.
  useEffect(() => {
    void api
      .getProjectRoot()
      .then((root) => setWorkspaceRoot(root ?? ""))
      .catch(() => {});
    const off = api.onProjectRootChanged((root) => {
      setWorkspaceRoot(root);
      setSelected(null);
      setDetail(null);
      setReflog([]);
      setViewBranch(null);
      setNotice(t("tasktree.workspaceSwitched"));
      void refresh(null);
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
    // Gentle polling: tree mutations also arrive from agent-side task.*
    // actions (plan materialization, LLM-driven forks) which have no push
    // channel — 15s polling keeps the human view eventually-consistent.
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching task resets the viewed branch (follow the new tree's active).
  useEffect(() => {
    setViewBranch(null);
  }, [selected]);

  // Single-tree mode: the embedded tab follows its tree prop.
  useEffect(() => {
    if (singleTree && treeId) setSelected(treeId);
  }, [singleTree, treeId]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setReflog([]);
      return;
    }
    let cancelled = false;
    void api
      .taskTreeGet(selected)
      .then((tree) => {
        if (!cancelled) setDetail(tree);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    void api
      .taskTreeReflog(selected)
      .then((entries) => {
        if (!cancelled) setReflog(entries);
      })
      .catch(() => {
        if (!cancelled) setReflog([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const reloadDetail = useCallback(
    async (treeId: string) => {
      const [tree, entries] = await Promise.all([
        api.taskTreeGet(treeId).catch((err: Error) => {
          setError(err.message);
          return null;
        }),
        api.taskTreeReflog(treeId).catch(() => [] as TaskReflogEntry[]),
      ]);
      setDetail(tree);
      setReflog(entries);
      await refresh(treeId);
    },
    [refresh]
  );

  const handleUnarchive = useCallback(
    async (id: string) => {
      await api.taskTreeUnarchive(id);
      await reloadDetail(id);
    },
    [reloadDetail]
  );

  const handleCreate = useCallback(async () => {
    const prompt = newPrompt.trim();
    const why = newWhy.trim();
    if (!prompt || !why) {
      setError(t("tasktree.needPromptWhy"));
      return;
    }
    const result = await api.taskTreeCreate(prompt, why).catch((err: Error) => ({ error: err.message }));
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setNewPrompt("");
    setNewWhy("");
    setError(null);
    setNotice(t("tasktree.created"));
    await refresh(result.treeId);
  }, [newPrompt, newWhy, refresh, t]);

  const handleFork = useCallback(async () => {
    if (!selected) return;
    const why = forkWhy.trim();
    if (!why) {
      setError(t("tasktree.needWhy"));
      return;
    }
    const result = await api.taskTreeFork(selected, why).catch((err: Error) => ({ error: err.message }));
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setForkWhy("");
    setError(null);
    setNotice(`${t("tasktree.forked")}: ${result.branch}`);
    setViewBranch(result.branch);
    await reloadDetail(selected);
  }, [selected, forkWhy, reloadDetail, t]);

  const branchAction = useCallback(
    async (action: "switch" | "abandon" | "merge", branch: string) => {
      if (!selected) return;
      if (action === "abandon" && !window.confirm(t("tasktree.confirmAbandon", { branch }))) return;
      const result =
        action === "switch"
          ? await api.taskTreeSwitch(selected, branch).catch((err: Error) => ({ ok: false, error: err.message }))
          : action === "abandon"
            ? await api.taskTreeAbandon(selected, branch).catch((err: Error) => ({ ok: false, error: err.message }))
            : await api.taskTreeMerge(selected, branch).catch((err: Error) => ({ ok: false, error: err.message }));
      if (!("ok" in result) || !result.ok) {
        setError("error" in result ? (result.error ?? "failed") : "failed");
        return;
      }
      setError(null);
      if (action === "merge" && "conflicts" in result && result.conflicts.length > 0) {
        setNotice(
          t("tasktree.mergedWithConflicts", {
            count: result.conflicts.length,
            refs: result.conflicts.map((c) => c.artifactRef).join(", "),
          })
        );
      } else {
        setNotice(action === "switch" ? t("tasktree.switched") : t("tasktree.done"));
      }
      await reloadDetail(selected);
    },
    [selected, reloadDetail, t]
  );

  const branches = detail ? Object.keys(detail.index.branches) : [];
  const workspaceLabel = workspaceRoot ? (workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? workspaceRoot) : "";
  const activeBranch = detail?.index.activeBranch ?? "";
  const shownBranch = viewBranch && branches.includes(viewBranch) ? viewBranch : activeBranch || (branches[0] ?? "");
  const lane = detail ? laneNodes(detail.index, detail.nodes, shownBranch) : [];
  const shownColor = branchColor(shownBranch);
  const activeTrees = trees.filter((tr) => !tr.archived);
  const archivedTrees = trees.filter((tr) => tr.archived);

  const statusLabel = (s: TaskNode["status"]): string => t(`tasktree.status.${s}` as MessageKey);
  const opLabel = (op: TaskReflogEntry["op"]): string => t(`tasktree.op.${op}` as MessageKey);

  return (
    <div className="ui-panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }}>
        <span style={{ fontSize: 16 }}>🌳</span>
        <strong style={{ fontSize: 13 }}>{t("tasktree.title")}</strong>
        {workspaceLabel ? (
          <span
            style={{
              fontSize: 10,
              color: "var(--ui-text-dim)",
              maxWidth: 140,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={workspaceRoot}
          >
            📂 {workspaceLabel}
          </span>
        ) : null}
        <button className="ui-btn ui-btn-sm" onClick={() => void refresh()} title={t("tasktree.refresh")}>
          ⟳
        </button>
      </div>

      {error ? <div style={{ padding: "0 14px 6px", color: "#f87171", fontSize: 11 }}>{error}</div> : null}
      {notice ? <div style={{ padding: "0 14px 6px", color: "var(--ui-accent)", fontSize: 11 }}>{notice}</div> : null}

      {/* Create-tree form — every tree starts with a story (sidebar mode only). */}
      {singleTree ? null : (
        <div style={{ padding: "0 14px 10px", borderBottom: "1px solid var(--ui-border-soft, #333)" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              style={inputStyle}
              placeholder={t("tasktree.newPrompt")}
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
            />
            <input
              style={inputStyle}
              placeholder={t("tasktree.newWhy")}
              value={newWhy}
              onChange={(e) => setNewWhy(e.target.value)}
            />
            <button style={{ ...btnStyle, flexShrink: 0 }} onClick={() => void handleCreate()}>
              + {t("tasktree.create")}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Task list — each tree is one unit of history (sidebar mode only). */}
        {singleTree ? null : (
          <div style={{ width: 190, borderRight: "1px solid var(--ui-border-soft, #333)", overflowY: "auto" }}>
            {trees.length === 0 ? (
              <div style={{ padding: 14, fontSize: 12, color: "var(--ui-text-dim)" }}>{t("tasktree.empty")}</div>
            ) : (
              <>
                {activeTrees.map((tree) => (
                  <button
                    key={tree.id}
                    onClick={() => setSelected(tree.id)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "7px 12px",
                      fontSize: 12,
                      background:
                        selected === tree.id ? "var(--ui-surface-sunken, rgba(128,128,128,0.1))" : "transparent",
                      border: "none",
                      color: "var(--ui-text)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {tree.title}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--ui-text-dim)", display: "flex", gap: 6 }}>
                      <span>
                        ⎇ {tree.activeBranch} · {tree.branchCount}b/{tree.nodeCount}n
                      </span>
                      <span style={{ marginLeft: "auto", opacity: 0.8 }}>{fmtTime(tree.updatedAt)}</span>
                    </div>
                  </button>
                ))}
                {/* Archived trees — never deleted, hidden from the active list. */}
                {archivedTrees.length > 0 ? (
                  <div style={{ borderTop: "1px solid var(--ui-border-soft, #333)", marginTop: 6, paddingTop: 2 }}>
                    <button className="ui-tt-reflog-toggle" onClick={() => setArchivedTreesOpen((v) => !v)}>
                      {archivedTreesOpen ? "▾" : "▸"} {t("tasktree.archivedSection")}
                      <span className="ui-tt-chip-count">{archivedTrees.length}</span>
                    </button>
                    {archivedTreesOpen
                      ? archivedTrees.map((tree) => (
                          <div
                            key={tree.id}
                            className={`ui-tt-archived-row${selected === tree.id ? " selected" : ""}`}
                            onClick={() => setSelected(tree.id)}
                          >
                            <span className="ui-tt-archived-title" title={tree.title}>
                              {tree.title}
                            </span>
                            <button
                              className="ui-tt-act"
                              title={t("tasktree.unarchive")}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleUnarchive(tree.id);
                              }}
                            >
                              ⤺
                            </button>
                          </div>
                        ))
                      : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}

        {/* History view: branch chips + timeline + reflog. */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", minWidth: 0 }}>
          {!detail ? (
            <div style={{ fontSize: 12, color: "var(--ui-text-dim)" }}>
              {trees.length > 0 ? t("tasktree.selectPrompt") : t("tasktree.empty")}
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 6, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                <strong>{detail.index.title}</strong>
                {detail.index.archived ? (
                  <span className="ui-tt-archived-banner">
                    📦 {t("tasktree.archivedBanner")}
                    <button
                      className="ui-tt-act"
                      title={t("tasktree.unarchive")}
                      onClick={() => void handleUnarchive(detail.index.id)}
                    >
                      ⤺ {t("tasktree.unarchive")}
                    </button>
                  </span>
                ) : null}
              </div>

              {/* Branch chips — pick which branch's history the timeline shows. */}
              <div className="ui-tt-branches">
                {branches.map((branch) => {
                  const entry = detail.index.branches[branch]!;
                  const isActive = branch === detail.index.activeBranch;
                  const abandoned = entry.abandoned === true;
                  const viewing = branch === shownBranch;
                  const color = branchColor(branch);
                  const count = laneNodes(detail.index, detail.nodes, branch).length;
                  return (
                    <span
                      key={branch}
                      className={`ui-tt-chip${viewing ? " viewing" : ""}${abandoned ? " abandoned" : ""}`}
                      style={{ borderColor: viewing ? color : undefined }}
                      onClick={() => setViewBranch(branch)}
                      title={isActive ? t("tasktree.active") : branch}
                    >
                      <span className="ui-tt-dot" style={{ background: color }} />
                      {branch}
                      <span className="ui-tt-chip-count">{count}</span>
                      {!isActive && !abandoned ? (
                        <span className="ui-tt-chip-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="ui-tt-act"
                            onClick={() => void branchAction("switch", branch)}
                            title={t("tasktree.switchTo")}
                          >
                            ⇄
                          </button>
                          <button
                            className="ui-tt-act"
                            onClick={() => void branchAction("merge", branch)}
                            title={t("tasktree.mergeFrom")}
                          >
                            ⇦
                          </button>
                          <button
                            className="ui-tt-act ui-tt-act--danger"
                            onClick={() => void branchAction("abandon", branch)}
                            title={t("tasktree.abandonAction")}
                          >
                            ✕
                          </button>
                        </span>
                      ) : null}
                      {abandoned ? <span className="ui-tt-chip-flag">{t("tasktree.abandoned")}</span> : null}
                    </span>
                  );
                })}
              </div>

              {/* Fork form — the panel's own fork entry point. */}
              <div style={{ display: "flex", gap: 6, margin: "8px 0 10px" }}>
                <input
                  style={inputStyle}
                  placeholder={t("tasktree.forkWhy")}
                  value={forkWhy}
                  onChange={(e) => setForkWhy(e.target.value)}
                />
                <button style={{ ...btnStyle, flexShrink: 0 }} onClick={() => void handleFork()}>
                  ⑂ {t("tasktree.fork")}
                </button>
              </div>

              {/* Timeline — newest first, like git log. */}
              <div className="ui-tt-section">{t("tasktree.history")}</div>
              <div className="ui-tt-timeline">
                {lane.length === 0 ? (
                  <div className="ui-tt-empty">{t("tasktree.noHistory")}</div>
                ) : (
                  lane
                    .slice()
                    .reverse()
                    .map((node) => {
                      const conflicts = node.meta?.mergeConflicts ?? [];
                      return (
                        <div key={node.id} className="ui-tt-item">
                          <span className="ui-tt-rail-dot" style={{ borderColor: shownColor }} />
                          <div className="ui-tt-item-body">
                            <div className="ui-tt-item-head">
                              <NodeIcon kind={node.kind} />
                              <span className="ui-tt-item-title" title={node.title}>
                                {node.title}
                              </span>
                              <span className={`ui-tt-status ${node.status}`}>{statusLabel(node.status)}</span>
                              <span className="ui-tt-item-time">{fmtTime(node.createdAt)}</span>
                            </div>
                            <div className="ui-tt-why">{node.why}</div>
                            {node.artifactRefs.length > 0 ? (
                              <div className="ui-tt-artifacts">
                                {t("tasktree.artifacts", { count: node.artifactRefs.length })}
                              </div>
                            ) : null}
                            {conflicts.length > 0 ? (
                              <div className="ui-tt-conflicts" title={t("tasktree.conflictHint")}>
                                ⚠ {t("tasktree.conflicts", { count: conflicts.length })}:{" "}
                                {conflicts.map((c) => c.artifactRef).join(", ")}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                )}
              </div>

              {/* Reflog — the append-only operation journal. */}
              <button className="ui-tt-reflog-toggle" onClick={() => setReflogOpen((v) => !v)}>
                {reflogOpen ? "▾" : "▸"} {t("tasktree.reflog")}
                <span className="ui-tt-chip-count">{reflog.length}</span>
              </button>
              {reflogOpen ? (
                <div className="ui-tt-reflog">
                  {reflog.length === 0 ? (
                    <div className="ui-tt-empty">{t("tasktree.reflogEmpty")}</div>
                  ) : (
                    reflog
                      .slice()
                      .reverse()
                      .map((entry, i) => (
                        <div key={`${entry.at}:${entry.op}:${i}`} className="ui-tt-reflog-row">
                          <span className="ui-tt-item-time">{fmtTime(entry.at)}</span>
                          <span className={`ui-tt-op ${entry.op}`}>{opLabel(entry.op)}</span>
                          <span className="ui-tt-reflog-branch">⎇ {entry.branch}</span>
                          {entry.detail ? <span className="ui-tt-reflog-detail">{entry.detail}</span> : null}
                        </div>
                      ))
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
