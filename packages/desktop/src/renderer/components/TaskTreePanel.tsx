/**
 * TaskTreePanel — the HUMAN-facing view of the agent's task trajectory
 * (specs/task-tree P0, minimal list-style panel).
 *
 * Design rule from the trajectory exploration: this tree is FOR PEOPLE. Every
 * node renders its `why` — a branch without a story is structure without
 * meaning. Simplified git-graph: indented nodes, branch color bars, abandoned
 * branches greyed out, memory-spawn nodes get a ✦ badge. No DAG canvas (P2).
 */

import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { api } from "../api";
import type { TaskNode, TaskTreeIndex, TaskTreeSummary } from "@deeporca/core";
import { useI18n } from "../i18n";

/** Stable color per branch name (P0: hash-based palette, no config). */
const BRANCH_COLORS = ["#4f8ef7", "#f7a04f", "#6fcf7c", "#c77fd6", "#ef6f8e", "#f7d24f"];
function branchColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return BRANCH_COLORS[hash % BRANCH_COLORS.length]!;
}

/** Depth of a node in its lineage (for indentation). */
function depthOf(node: TaskNode, byId: Map<string, TaskNode>): number {
  let depth = 0;
  let cur: TaskNode | undefined = node;
  while (cur?.parentId) {
    cur = byId.get(cur.parentId);
    depth += 1;
    if (depth > 32) break; // cycle guard
  }
  return depth;
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

  const byId = new Map((detail?.nodes ?? []).map((n) => [n.id, n]));

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
        <div style={{ width: 220, borderRight: "1px solid var(--ui-border-soft, #333)", overflowY: "auto" }}>
          {trees.length === 0 ? (
            <div style={{ padding: 14, fontSize: 12, color: "var(--ui-text-dim)" }}>{t("tasktree.empty")}</div>
          ) : (
            trees.map((tree) => (
              <button
                key={tree.id}
                onClick={() => setSelected(tree.id)}
                className="ui-side-item"
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

        {/* Tree detail */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
          {!detail ? (
            <div style={{ fontSize: 12, color: "var(--ui-text-dim)" }}>
              {trees.length > 0 ? t("tasktree.selectPrompt") : t("tasktree.empty")}
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 10, fontSize: 13 }}>
                <strong>{detail.index.title}</strong>
                <span style={{ marginLeft: 8, fontSize: 11, color: "var(--ui-text-dim)" }}>
                  {t("tasktree.active")}: {detail.index.activeBranch}
                </span>
              </div>
              {detail.nodes.map((node) => {
                const branchName =
                  Object.entries(detail.index.branches).find(([, b]) => b.headId === node.id)?.[0] ?? null;
                const isHead = branchName != null;
                const depth = depthOf(node, byId);
                const abandoned = branchName != null && detail.index.branches[branchName]?.abandoned;
                return (
                  <div
                    key={node.id}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      marginLeft: depth * 18,
                      marginBottom: 6,
                      padding: "6px 8px",
                      borderRadius: 6,
                      background:
                        branchName === detail.index.activeBranch
                          ? "var(--ui-surface-sunken, rgba(128,128,128,0.08))"
                          : "transparent",
                      opacity: abandoned ? 0.45 : 1,
                    }}
                  >
                    <span
                      style={{
                        marginTop: 3,
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        flexShrink: 0,
                        background: branchColor(branchName ?? node.kind),
                      }}
                      title={branchName ?? node.kind}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>
                        {node.kind === "memory-spawn" ? "✦ " : ""}
                        {node.kind === "root"
                          ? "🌳 "
                          : node.kind === "fork" || node.kind === "memory-spawn"
                            ? "⑂ "
                            : "· "}
                        {node.title}
                        {isHead ? <span style={{ fontSize: 10, color: "var(--ui-accent)" }}> ⎇</span> : null}
                      </div>
                      {/* The story — the reason this panel exists for humans. */}
                      <div style={{ fontSize: 11, color: "var(--ui-text-dim)", marginTop: 2 }}>{node.why}</div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
