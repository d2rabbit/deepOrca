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

import { useCallback, useEffect, useState, type JSX } from "react";
import { api } from "../api";
import { Button } from "../ui/index";
import type { TaskNode, TaskReflogEntry, TaskTreeIndex, TaskTreeSummary } from "@deeporca/core";
import type { TaskTrajectory } from "../../shared/ipc";

type Props = {
  treeId: string;
  workspaceRoot?: string;
};

const KIND_ICON: Record<TaskNode["kind"], string> = {
  root: "◆",
  step: "▪",
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
}: {
  nodes: TaskNode[];
  parentId: string | null;
  depth: number;
}): JSX.Element {
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
              {node.artifactRefs.length > 0 ? ` · ${node.artifactRefs.length} 产物` : ""}
            </span>
          </div>
          {node.why ? (
            <div className="ui-taskrec-node-why" style={{ paddingLeft: 26 + depth * 18 }}>
              {node.why}
            </div>
          ) : null}
          {node.meta.memorySeed ? (
            <div className="ui-taskrec-node-why" style={{ paddingLeft: 26 + depth * 18 }}>
              ✦ 记忆驱动分支 · 相似度 {(node.meta.memorySeed.similarity * 100).toFixed(0)}%
            </div>
          ) : null}
          <NodeTree nodes={nodes} parentId={node.id} depth={depth + 1} />
        </div>
      ))}
    </>
  );
}

export function TaskRecordPanel({ treeId, workspaceRoot }: Props): JSX.Element {
  const [summary, setSummary] = useState<TaskTreeSummary | null>(null);
  const [detail, setDetail] = useState<{ index: TaskTreeIndex; nodes: TaskNode[] } | null>(null);
  const [reflog, setReflog] = useState<TaskReflogEntry[]>([]);
  const [trajectory, setTrajectory] = useState<TaskTrajectory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [section, setSection] = useState<"record" | "trajectory">("record");
  const [forkWhy, setForkWhy] = useState("");

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

  const run = async (label: string, fn: () => Promise<{ ok?: boolean; error?: string } | boolean | string | null>) => {
    try {
      const result = await fn();
      const bad =
        result === false || (typeof result === "object" && result !== null && "error" in result && result.error);
      setNotice(bad ? String((result as { error?: string }).error ?? label) : `${label} 完成`);
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

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
  const workspaceLabel = (workspaceRoot ?? "").split("/").filter(Boolean).pop() ?? "";

  return (
    <div className="ui-taskrec">
      <div className="ui-taskrec-head">
        <div className="ui-taskrec-title-block">
          <span className="ui-taskrec-title">{index.title}</span>
          {summary?.archived ? <span className="ui-taskrec-badge archived">已归档</span> : null}
          {workspaceLabel ? <span className="ui-taskrec-badge">{workspaceLabel}</span> : null}
        </div>
        <div className="ui-taskrec-subtitle">
          创建 {formatTime(index.createdAt)} · 更新 {formatTime(index.updatedAt)} ·{" "}
          {index.branches ? Object.keys(index.branches).length : 0} 分支 · {detail.nodes.length} 节点 ·{" "}
          {summary?.sessionIds.length ?? 0} 会话
        </div>
        <div className="ui-taskrec-section-tabs">
          <button type="button" className={section === "record" ? "active" : ""} onClick={() => setSection("record")}>
            任务记录
          </button>
          <button
            type="button"
            className={section === "trajectory" ? "active" : ""}
            onClick={() => setSection("trajectory")}
          >
            操作轨迹{trajectory ? ` · ${trajectory.operations.length}` : ""}
          </button>
        </div>
      </div>

      {notice ? <div className="ui-taskrec-notice">{notice}</div> : null}

      {section === "record" ? (
        <div className="ui-taskrec-body">
          <div className="ui-taskrec-section">
            <div className="ui-taskrec-section-label">分支</div>
            <div className="ui-taskrec-branches">
              {branches.map((b) => (
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
                      onClick={() => void run("切换分支", () => api.taskTreeSwitch(treeId, b.name, workspaceRoot))}
                    >
                      切换
                    </Button>
                  ) : null}
                  {!b.abandoned && b.name !== activeBranch ? (
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={() => void run("合并分支", () => api.taskTreeMerge(treeId, b.name, workspaceRoot))}
                    >
                      合并
                    </Button>
                  ) : null}
                  {!b.abandoned ? (
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={() => void run("废弃分支", () => api.taskTreeAbandon(treeId, b.name, workspaceRoot))}
                    >
                      废弃
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="ui-taskrec-section">
            <div className="ui-taskrec-section-label">节点树</div>
            <div className="ui-taskrec-nodes">
              {root ? <NodeTree nodes={detail.nodes} parentId={root.parentId} depth={0} /> : null}
            </div>
          </div>

          <div className="ui-taskrec-section">
            <div className="ui-taskrec-section-label">操作</div>
            <div className="ui-taskrec-ops">
              <div className="ui-taskrec-fork">
                <input
                  type="text"
                  value={forkWhy}
                  placeholder="fork 理由（为什么从这里分叉）"
                  onChange={(e) => setForkWhy(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={!forkWhy.trim()}
                  onClick={() =>
                    void run("Fork", async () => {
                      const r = await api.taskTreeFork(treeId, forkWhy.trim(), undefined, workspaceRoot);
                      return r as unknown as { ok?: boolean; error?: string };
                    }).then(() => setForkWhy(""))
                  }
                >
                  ⑂ Fork
                </Button>
              </div>
              {summary?.archived ? (
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => void run("取消归档", () => api.taskTreeUnarchive(treeId, workspaceRoot))}
                >
                  取消归档
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => void run("归档", () => api.taskTreeArchive(treeId, workspaceRoot))}
                >
                  归档任务
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
                  <strong>{trajectory.operations.length}</strong> 操作
                </span>
                <span className="ui-taskrec-stat">
                  <strong>{trajectory.sessionCount}</strong> 会话
                </span>
                <span className="ui-taskrec-stat">
                  <strong>{trajectory.filesTouched.length}</strong> 触碰文件
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
                  <div className="ui-taskrec-section-label">触碰文件</div>
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
                <div className="ui-taskrec-section-label">操作轨迹</div>
                <div className="ui-taskrec-ops-timeline">
                  {trajectory.operations.map((op, i) => (
                    <div key={i} className="ui-taskrec-op">
                      <span className="ui-taskrec-op-time">{formatTime(op.at)}</span>
                      <span className={`ui-taskrec-op-tool${op.ok ? "" : " fail"}`}>{op.tool}</span>
                      {op.summary ? <span className="ui-taskrec-op-summary">{op.summary}</span> : null}
                    </div>
                  ))}
                  {trajectory.operations.length === 0 ? (
                    <div className="ui-side-panel-empty">该任务绑定的会话暂无操作记录</div>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <div className="ui-side-panel-empty">暂无轨迹数据</div>
          )}

          <div className="ui-taskrec-section">
            <div className="ui-taskrec-section-label">任务操作日志(reflog)</div>
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
