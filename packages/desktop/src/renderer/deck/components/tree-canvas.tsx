// Task-tree full-body canvas (E8): branch lanes with why-narratives, node
// detail, and the real tree operations (switch / abandon / merge / fork /
// snapshot restore / archive). The overlay keeps the read-only thumbnail —
// this is the wide stage-tab view. All data is real (taskTree* IPC); no
// decorative mock nodes.
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { api } from "../../api";
import type { TaskNode, TaskReflogEntry, TaskTreeIndex, TaskTreeSummary } from "../../../shared/ipc";
import { useI18n } from "../../i18n";
import { buildTreeLanes } from "../lib/tree-layout";

type TreeData = { index: TaskTreeIndex; nodes: TaskNode[] };

function nodeGlyphClass(node: TaskNode, isHead: boolean): string {
  if (node.status === "abandoned") return "dead";
  if (node.kind === "merge") return "merged";
  if (node.status === "done") return "merged";
  if (node.status === "running" || isHead) return "cur";
  return "open";
}

function LaneNode(props: { node: TaskNode; head: boolean; selected: boolean; onSelect(): void }): JSX.Element {
  return (
    <button
      type="button"
      className={`deck-tnode ${nodeGlyphClass(props.node, props.head)}${props.selected ? " sel" : ""}`}
      title={props.node.why || props.node.title}
      onClick={props.onSelect}
      aria-label={props.node.title}
    />
  );
}

export function TreeCanvas(): JSX.Element {
  const { t } = useI18n();
  const [trees, setTrees] = useState<TaskTreeSummary[] | null>(null);
  const [treeId, setTreeId] = useState<string | null>(null);
  const [data, setData] = useState<TreeData | null>(null);
  const [reflog, setReflog] = useState<TaskReflogEntry[] | null>(null);
  const [showReflog, setShowReflog] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [forkWhy, setForkWhy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // E21: abandoning a lane drops its ongoing work — two-step confirmation
  // keyed by `${treeId}:${branch}`, same rule as discard / floor delete.
  const [armedAbandon, setArmedAbandon] = useState<string | null>(null);

  useEffect(() => {
    void api
      .taskTreeList()
      .then(setTrees)
      .catch(() => setTrees([]));
  }, []);

  const load = useCallback((id: string) => {
    setTreeId(id);
    setSelected(null);
    setError(null);
    void api
      .taskTreeGet(id)
      .then(setData)
      .catch(() => setData(null));
    void api
      .taskTreeReflog(id)
      .then(setReflog)
      .catch(() => setReflog([]));
  }, []);

  // Auto-open the first tree — an empty "pick one" prompt is a dead end.
  useEffect(() => {
    if (!treeId && trees && trees.length > 0) load(trees[0].id);
  }, [trees, treeId, load]);

  const lanes = useMemo(() => (data ? buildTreeLanes(data.index, data.nodes) : []), [data]);
  const selectedNode = selected && data ? (data.nodes.find((n) => n.id === selected) ?? null) : null;

  const operate = (run: () => Promise<unknown>) => {
    if (!treeId || busy) return;
    setBusy(true);
    setError(null);
    void run()
      .then((result) => {
        if (result && typeof result === "object" && "error" in result && typeof result.error === "string") {
          setError(result.error);
        }
        load(treeId);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const fork = () => {
    const why = forkWhy.trim();
    if (!treeId || !why) return;
    setForkWhy("");
    operate(() => api.taskTreeFork(treeId, why));
  };

  // ── 树列表（左栏） ──────────────────────────────────────────────────────
  if (trees === null) return <div className="deck-empty">{t("deck.loading")}</div>;
  if (trees.length === 0) return <div className="deck-empty">{t("deck.tree.empty")}</div>;

  return (
    <div className="deck-tree-canvas">
      <aside className="deck-tree-side">
        <div className="deck-panel-group-title">{t("deck.dock.tree")}</div>
        {trees.map((tree) => (
          <button
            key={tree.id}
            type="button"
            className={`deck-row linked${tree.id === treeId ? " active" : ""}`}
            onClick={() => load(tree.id)}
          >
            <span className="deck-row-main">
              {tree.title}
              {tree.archived ? <span className="deck-wo-tag">{t("deck.tree.archived")}</span> : null}
            </span>
            <span className="deck-row-meta">
              {tree.activeBranch} · {t("deck.tree.nodes", { count: String(tree.nodeCount) })}
            </span>
          </button>
        ))}
      </aside>

      <section className="deck-tree-main">
        {!data ? (
          <div className="deck-empty">{treeId ? t("deck.loading") : t("deck.tree.pick")}</div>
        ) : (
          <>
            <div className="deck-tree-head">
              <b>{data.index.title}</b>
              <span className="deck-row-meta">
                {t("deck.tree.branches", { count: String(Object.keys(data.index.branches).length) })}
              </span>
              <span className="deck-tree-head-ops">
                <button type="button" className="deck-op" onClick={() => setShowReflog((v) => !v)}>
                  {t("deck.tree.reflog")}
                </button>
                {data.index.archived ? (
                  <button
                    type="button"
                    className="deck-op"
                    disabled={busy}
                    onClick={() => operate(() => api.taskTreeUnarchive(data.index.id))}
                  >
                    {t("deck.tree.unarchive")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="deck-op"
                    disabled={busy}
                    onClick={() => operate(() => api.taskTreeArchive(data.index.id))}
                  >
                    {t("deck.tree.archive")}
                  </button>
                )}
              </span>
            </div>

            {error ? <div className="deck-tree-error">{t("deck.opFailed", { error })}</div> : null}

            <div className="deck-treegraph">
              {lanes.map((lane) => {
                const forkNode = lane.nodes.find((n) => n.kind === "fork");
                return (
                  <div key={lane.branch} className="deck-tlane" style={{ paddingLeft: lane.forkDepth * 26 }}>
                    {lane.forkDepth > 0 ? <span className="deck-tlane-bend">╲</span> : null}
                    {lane.nodes.length === 0 ? (
                      <span className="deck-tlane-empty">{t("deck.tree.emptyBranch")}</span>
                    ) : (
                      lane.nodes.map((node, i) => (
                        <span key={node.id} className="deck-tlane-seq">
                          {i > 0 ? <span className="deck-tlane-link">──</span> : null}
                          <LaneNode
                            node={node}
                            head={i === lane.nodes.length - 1}
                            selected={node.id === selected}
                            onSelect={() => setSelected(node.id === selected ? null : node.id)}
                          />
                        </span>
                      ))
                    )}
                    <span className={`deck-tlane-name${lane.active ? " cur" : ""}${lane.abandoned ? " dead" : ""}`}>
                      {lane.branch}
                      {lane.active ? ` · ${t("deck.tree.active")}` : ""}
                      {lane.abandoned ? ` ✕ ${t("deck.tree.abandoned")}` : ""}
                    </span>
                    {forkNode?.why ? <span className="deck-tlane-why">why: {forkNode.why}</span> : null}
                    {!lane.active ? (
                      <span className="deck-tlane-ops">
                        <button
                          type="button"
                          className="deck-op"
                          disabled={busy}
                          onClick={() => operate(() => api.taskTreeSwitch(data.index.id, lane.branch))}
                        >
                          {t("deck.tree.switch")}
                        </button>
                        <button
                          type="button"
                          className="deck-op"
                          disabled={busy}
                          onClick={() => operate(() => api.taskTreeMerge(data.index.id, lane.branch))}
                        >
                          {t("deck.tree.merge")}
                        </button>
                        {!lane.abandoned
                          ? (() => {
                              const key = `${data.index.id}:${lane.branch}`;
                              const armed = armedAbandon === key;
                              return (
                                <button
                                  type="button"
                                  className={`deck-op${armed ? " danger armed" : ""}`}
                                  disabled={busy}
                                  title={armed ? t("deck.tree.abandonConfirm") : undefined}
                                  onClick={() => {
                                    if (!armed) {
                                      setArmedAbandon(key);
                                      return;
                                    }
                                    setArmedAbandon(null);
                                    operate(() => api.taskTreeAbandon(data.index.id, lane.branch));
                                  }}
                                >
                                  {t("deck.tree.abandon")}
                                </button>
                              );
                            })()
                          : null}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="deck-tree-foot">
              <input
                value={forkWhy}
                placeholder={t("deck.tree.forkWhy")}
                onChange={(e) => setForkWhy(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") fork();
                }}
              />
              <button type="button" className="deck-op" disabled={busy || !forkWhy.trim()} onClick={fork}>
                {t("deck.tree.fork")}
              </button>
              <span className="deck-row-meta">{t("deck.tree.selectNode")}</span>
            </div>

            {selectedNode ? (
              <div className="deck-tree-detail deck-gc">
                <div className="deck-tree-detail-title">
                  {selectedNode.title}
                  <span
                    className={`deck-wo-tag ${selectedNode.status === "done" ? "g" : selectedNode.status === "abandoned" ? "r" : "b"}`}
                  >
                    {selectedNode.status}
                  </span>
                  <span className="deck-wo-tag">{selectedNode.kind}</span>
                </div>
                {selectedNode.why ? <p className="deck-tree-detail-why">{selectedNode.why}</p> : null}
                <div className="deck-row-meta">
                  {selectedNode.createdAt.slice(0, 16).replace("T", " ")} ·{" "}
                  {t("deck.tree.artifacts", {
                    count: String(selectedNode.artifactRefs.length),
                  })}
                </div>
                {selectedNode.meta.snapshot ? (
                  <div className="deck-panel-ops">
                    <button
                      type="button"
                      className="deck-op"
                      disabled={busy}
                      onClick={() => operate(() => api.taskTreeSnapshotRestore(data.index.id, selectedNode.id))}
                    >
                      {t("deck.tree.snapshot", { count: String(selectedNode.meta.snapshot.files) })}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {showReflog && reflog ? (
              <div className="deck-tree-reflog">
                {reflog.length === 0 ? <div className="deck-empty">—</div> : null}
                {[...reflog].reverse().map((entry, i) => (
                  <div key={`${entry.at}-${i}`} className="deck-tree-reflog-row">
                    <span className="deck-row-meta">{entry.at.slice(5, 16).replace("T", " ")}</span>
                    <span className="deck-wo-tag">{entry.op}</span>
                    <span>{entry.branch}</span>
                    {entry.detail ? <span className="deck-row-meta">{entry.detail}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
