/**
 * TaskTreePanel — the HUMAN-facing view of the agent's task trajectory
 * (specs/task-tree, P2 swimlane upgrade).
 *
 * Design rule from the trajectory exploration: this tree is FOR PEOPLE. Every
 * node renders its `why` — a branch without a story is structure without
 * meaning. Layout: one swimlane column per branch (the "simplified DAG
 * canvas" of spec §九 P2 — lineage flows top-to-bottom inside a lane), active
 * lane highlighted, abandoned lanes greyed, merge nodes carry their conflict
 * confirmation list (⚠, reported-not-resolved), memory-spawn nodes get ✦.
 */

import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
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

export function TaskTreePanel(): JSX.Element {
  const { t } = useI18n();
  const [trees, setTrees] = useState<TaskTreeSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ index: TaskTreeIndex; nodes: TaskNode[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.taskTreeList();
      setTrees(list);
      setError(null);
      if (!selected && list.length > 0) {
        setSelected(list[0]!.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const branches = detail ? Object.keys(detail.index.branches) : [];

  return (
    <div className="ui-panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }}>
        <span style={{ fontSize: 16 }}>🌳</span>
        <strong style={{ fontSize: 13 }}>{t("tasktree.title")}</strong>
        <button className="ui-btn ui-btn-sm" onClick={() => void refresh()} title={t("tasktree.refresh")}>
          ⟳
        </button>
      </div>

      {error ? <div style={{ padding: "0 14px 8px", color: "#f87171", fontSize: 12 }}>{error}</div> : null}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Tree list */}
        <div style={{ width: 200, borderRight: "1px solid var(--ui-border-soft, #333)", overflowY: "auto" }}>
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

        {/* Swimlane tree canvas */}
        <div style={{ flex: 1, overflow: "auto", padding: "10px 14px" }}>
          {!detail ? (
            <div style={{ fontSize: 12, color: "var(--ui-text-dim)" }}>
              {trees.length > 0 ? t("tasktree.selectPrompt") : t("tasktree.empty")}
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 10, fontSize: 13 }}>
                <strong>{detail.index.title}</strong>
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
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>⎇ {branch}</span>
                        <span style={{ fontSize: 9, color: "var(--ui-text-dim)" }}>
                          {abandoned ? t("tasktree.abandoned") : `${lane.length}n`}
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
