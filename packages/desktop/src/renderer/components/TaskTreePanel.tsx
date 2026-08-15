/**
 * TaskTreePanel — the HUMAN-facing view of the agent's task trajectory
 * (specs/task-tree). Its OWN full panel: workspace-bound (refreshes when the
 * workspace root changes — trees live in <workspace>/.deeporca/task-trees/),
 * and operational (create / fork / switch / abandon / merge from the UI —
 * every mutation requires the human-facing `why`).
 *
 * Layout: tree list (left) + swimlane canvas (one column per branch, lineage
 * top-to-bottom, active highlighted, abandoned greyed, merge conflicts ⚠,
 * memory-spawn ✦).
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { api } from "../api";
import type { TaskNode, TaskTreeIndex, TaskTreeSummary } from "@deeporca/core";
import { useI18n } from "../i18n";

/** Stable color per branch name (hash-based palette, no config). */
const BRANCH_COLORS = ["#4f8ef7", "#f7a04f", "#6fcf7c", "#c77fd6", "#ef6f8e", "#f7d24f"];
function branchColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return BRANCH_COLORS[hash % BRANCH_COLORS.length]!;
}

/** Node lineage of a branch: root → … → head (top-to-bottom). */
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

export function TaskTreePanel(): JSX.Element {
  const { t } = useI18n();
  const [trees, setTrees] = useState<TaskTreeSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ index: TaskTreeIndex; nodes: TaskNode[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string>("");
  // Create-tree form
  const [newPrompt, setNewPrompt] = useState("");
  const [newWhy, setNewWhy] = useState("");
  // Fork form (per tree)
  const [forkWhy, setForkWhy] = useState("");
  // Mirror of `selected` for stable callbacks — the 15s poll and the workspace
  // listener must read the CURRENT selection, not the one captured at mount
  // (a stale closure here resets the user's selection back to the first tree).
  const selectedRef = useRef<string | null>(null);

  const refresh = useCallback(async (keepSelection?: string | null) => {
    try {
      const list = await api.taskTreeList();
      setTrees(list);
      setError(null);
      const current = keepSelection ?? selectedRef.current;
      if (current && list.some((tr) => tr.id === current)) {
        setSelected(current);
      } else {
        setSelected(list.length > 0 ? list[0]!.id : null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    api
      .taskTreeGet(selected)
      .then((tree) => {
        if (!cancelled) setDetail(tree);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const reloadDetail = useCallback(
    async (treeId: string) => {
      const tree = await api.taskTreeGet(treeId).catch((err: Error) => {
        setError(err.message);
        return null;
      });
      setDetail(tree);
      await refresh(treeId);
    },
    [refresh]
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

      {/* Create-tree form — every tree starts with a story. */}
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

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Tree list */}
        <div style={{ width: 190, borderRight: "1px solid var(--ui-border-soft, #333)", overflowY: "auto" }}>
          {trees.length === 0 ? (
            <div style={{ padding: 14, fontSize: 12, color: "var(--ui-text-dim)" }}>{t("tasktree.empty")}</div>
          ) : (
            trees.map((tree) => (
              <button
                key={tree.id}
                onClick={() => setSelected(tree.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  fontSize: 12,
                  background: selected === tree.id ? "var(--ui-surface-sunken, rgba(128,128,128,0.1))" : "transparent",
                  border: "none",
                  color: "var(--ui-text)",
                  cursor: "pointer",
                }}
              >
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tree.title}</div>
                <div style={{ fontSize: 10, color: "var(--ui-text-dim)" }}>
                  ⎇ {tree.activeBranch} · {tree.branchCount}b/{tree.nodeCount}n
                </div>
              </button>
            ))
          )}
        </div>

        {/* Swimlane canvas + per-tree operations */}
        <div style={{ flex: 1, overflow: "auto", padding: "10px 14px" }}>
          {!detail ? (
            <div style={{ fontSize: 12, color: "var(--ui-text-dim)" }}>
              {trees.length > 0 ? t("tasktree.selectPrompt") : t("tasktree.empty")}
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 6, fontSize: 13 }}>
                <strong>{detail.index.title}</strong>
              </div>
              {/* Fork form — the panel's own fork entry point. */}
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
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
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: "max-content" }}>
                {branches.map((branch) => {
                  const branchEntry = detail.index.branches[branch]!;
                  const lane = laneNodes(detail.index, detail.nodes, branch);
                  const isActive = branch === detail.index.activeBranch;
                  const abandoned = branchEntry.abandoned === true;
                  const color = branchColor(branch);
                  return (
                    <div
                      key={branch}
                      style={{
                        width: 210,
                        borderRadius: 8,
                        border: `1px solid ${isActive ? color : "var(--ui-border-soft, #333)"}`,
                        opacity: abandoned ? 0.45 : 1,
                        background: isActive ? "var(--ui-surface-sunken, rgba(128,128,128,0.06))" : "transparent",
                      }}
                    >
                      <div
                        style={{
                          padding: "6px 8px",
                          fontSize: 11,
                          fontWeight: 600,
                          color,
                          borderBottom: `2px solid ${color}`,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>⎇ {branch}</span>
                        <span style={{ display: "flex", gap: 3 }}>
                          {!isActive && !abandoned ? (
                            <>
                              <button
                                style={btnStyle}
                                onClick={() => void branchAction("switch", branch)}
                                title={t("tasktree.switchTo")}
                              >
                                ⇄
                              </button>
                              <button
                                style={btnStyle}
                                onClick={() => void branchAction("merge", branch)}
                                title={t("tasktree.mergeFrom")}
                              >
                                ⇦
                              </button>
                              <button
                                style={btnStyle}
                                onClick={() => void branchAction("abandon", branch)}
                                title={t("tasktree.abandonAction")}
                              >
                                ✕
                              </button>
                            </>
                          ) : null}
                          {abandoned ? (
                            <span style={{ fontSize: 9, color: "var(--ui-text-dim)" }}>{t("tasktree.abandoned")}</span>
                          ) : (
                            <span style={{ fontSize: 9, color: "var(--ui-text-dim)" }}>{lane.length}n</span>
                          )}
                        </span>
                      </div>
                      <div style={{ padding: 6 }}>
                        {lane.map((node) => {
                          const conflicts = node.meta?.mergeConflicts ?? [];
                          return (
                            <div
                              key={node.id}
                              style={{
                                padding: "5px 6px",
                                marginBottom: 4,
                                borderRadius: 6,
                                background: "var(--ui-surface, rgba(128,128,128,0.08))",
                                fontSize: 11,
                              }}
                            >
                              <div style={{ fontWeight: 500, display: "flex", gap: 4 }}>
                                <NodeIcon kind={node.kind} />
                                <span style={{ wordBreak: "break-word" }}>{node.title}</span>
                              </div>
                              <div style={{ color: "var(--ui-text-dim)", marginTop: 2, wordBreak: "break-word" }}>
                                {node.why}
                              </div>
                              {conflicts.length > 0 ? (
                                <div
                                  style={{
                                    marginTop: 4,
                                    padding: "3px 5px",
                                    borderRadius: 4,
                                    background: "rgba(251,191,36,0.12)",
                                    color: "#fbbf24",
                                    fontSize: 10,
                                  }}
                                  title={t("tasktree.conflictHint")}
                                >
                                  ⚠ {t("tasktree.conflicts", { count: conflicts.length })}:{" "}
                                  {conflicts.map((c) => c.artifactRef).join(", ")}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
