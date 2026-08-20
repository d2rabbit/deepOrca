// Session-centric deck panels: floor wall (all sessions), checkpoints (undo),
// ledger (token accounting per session), task trees. Functional layer (E2) —
// data and primary actions are real, visuals stay minimal.
import { useEffect, useState, type JSX } from "react";
import { api } from "../../api";
import type { SerializableSessionEntry, TaskTreeSummary, UndoTarget, WorkspaceSessions } from "../../../shared/ipc";
import { aggregateUsage, formatTokens } from "../../lib/token-usage";
import { useI18n } from "../../i18n";
import type { DeckEngine } from "../hooks/use-deck-engine";

/** Semantic tag class per session status (E6.2 card wall) — no emoji. */
function statusTagClass(status: string): string {
  switch (status) {
    case "processing":
    case "pending":
      return "b";
    case "completed":
      return "g";
    case "failed":
    case "permission_denied":
      return "r";
    case "ask_permission":
    case "paused":
      return "a";
    default:
      return "";
  }
}

// ── 车间墙：全部工作区的会话总览（3 列工单卡片），点击切换当前目标 ────────
export function FloorPanel(props: { engine: DeckEngine; onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const [data, setData] = useState<WorkspaceSessions | null>(null);

  useEffect(() => {
    void api
      .listWorkspaceSessions()
      .then(setData)
      .catch(() => {});
  }, []);

  const pick = (id: string) => {
    void props.engine.selectSession(id);
    props.onClose();
  };

  if (!data) return <div className="deck-empty">{t("deck.loading")}</div>;

  return (
    <div className="deck-panel">
      {data.workspaces.map((ws) => (
        <div key={ws.root} className="deck-panel-group">
          <div className="deck-panel-group-title">{ws.label}</div>
          {ws.sessions.length === 0 ? <div className="deck-empty">{t("deck.floor.empty")}</div> : null}
          <div className="deck-floor-grid">
            {ws.sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={`deck-wo-card sh-card${session.id === props.engine.activeId ? " active" : ""}`}
                onClick={() => pick(session.id)}
              >
                <span className={`deck-wo-tag ${statusTagClass(session.status)}`}>{session.status}</span>
                <span className="deck-wo-title">{session.summary ?? session.id.slice(0, 8)}</span>
                <span className="deck-wo-meta">{session.updateTime.slice(0, 16).replace("T", " ")}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 检查点：当前会话的撤销目标，一键恢复 ───────────────────────────────────
export function CheckpointsPanel(props: { engine: DeckEngine }): JSX.Element {
  const { t } = useI18n();
  const [targets, setTargets] = useState<UndoTarget[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.engine.activeId) {
      setTargets([]);
      return;
    }
    void api
      .listUndoTargets(props.engine.activeId)
      .then(setTargets)
      .catch(() => setTargets([]));
  }, [props.engine.activeId]);

  if (!props.engine.activeId) return <div className="deck-empty">{t("deck.noSession")}</div>;
  if (!targets) return <div className="deck-empty">{t("deck.loading")}</div>;
  if (targets.length === 0) return <div className="deck-empty">{t("deck.checkpoints.empty")}</div>;

  const restore = (messageId: string, mode: "code-and-conversation" | "conversation") => {
    if (!props.engine.activeId || busy) return;
    setBusy(true);
    void api
      .restoreUndo(props.engine.activeId, messageId, mode)
      .then(() => props.engine.selectSession(props.engine.activeId))
      .finally(() => setBusy(false));
  };

  return (
    <div className="deck-panel">
      {targets.map((target) => (
        <div key={target.message.id} className="deck-row static">
          <span className="deck-row-main">
            #{(target.index + 1).toString()} {(target.message.content ?? "").slice(0, 60)}
          </span>
          <span className="deck-row-ops">
            {target.canRestoreCode ? (
              <button
                type="button"
                className="deck-op"
                disabled={busy}
                onClick={() => restore(target.message.id, "code-and-conversation")}
              >
                {t("deck.checkpoints.restoreCode")}
              </button>
            ) : null}
            <button
              type="button"
              className="deck-op"
              disabled={busy}
              onClick={() => restore(target.message.id, "conversation")}
            >
              {t("deck.checkpoints.restoreChat")}
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── 账本：按会话归账的 token 消耗 + 全工作区汇总 ───────────────────────────
export function LedgerPanel(): JSX.Element {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<SerializableSessionEntry[] | null>(null);

  useEffect(() => {
    void api
      .listSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  if (!sessions) return <div className="deck-empty">{t("deck.loading")}</div>;

  const aggregate = aggregateUsage(sessions);
  const rows = sessions
    .filter((s) => s.usage && s.usage.total_tokens > 0)
    .sort((a, b) => (b.usage?.total_tokens ?? 0) - (a.usage?.total_tokens ?? 0))
    .slice(0, 50);

  return (
    <div className="deck-panel">
      <div className="deck-ledger-total deck-gc">
        <div className="deck-meter">
          <div className="k">{t("deck.ledger.total")}</div>
          <div className="v">{formatTokens(aggregate.totals.total)}</div>
        </div>
        <div className="deck-meter">
          <div className="k">{t("deck.ledger.cacheHit")}</div>
          <div className="v">
            {aggregate.totals.cacheHit + aggregate.totals.cacheMiss > 0
              ? `${Math.round((aggregate.totals.cacheHit / (aggregate.totals.cacheHit + aggregate.totals.cacheMiss)) * 100)}%`
              : "—"}
          </div>
        </div>
        <div className="deck-meter">
          <div className="k">{t("deck.ledger.sessions")}</div>
          <div className="v">{aggregate.sessionCount}</div>
        </div>
      </div>
      {rows.map((session) => (
        <div key={session.id} className="deck-row static">
          <span className="deck-row-main">{session.summary ?? session.id.slice(0, 8)}</span>
          <span className="deck-row-meta">{formatTokens(session.usage?.total_tokens ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

// ── 任务树：树列表 + 分支概览（只读，分叉/合并走经典层） ───────────────────
export function TreePanel(): JSX.Element {
  const { t } = useI18n();
  const [trees, setTrees] = useState<TaskTreeSummary[] | null>(null);

  useEffect(() => {
    void api
      .taskTreeList()
      .then(setTrees)
      .catch(() => setTrees([]));
  }, []);

  if (!trees) return <div className="deck-empty">{t("deck.loading")}</div>;
  if (trees.length === 0) return <div className="deck-empty">{t("deck.tree.empty")}</div>;

  return (
    <div className="deck-panel">
      {trees.map((tree) => (
        <div key={tree.id} className="deck-row static">
          <span className="deck-row-main">{tree.title}</span>
          <span className="deck-row-meta">
            {tree.activeBranch} · {t("deck.tree.nodes", { count: String(tree.nodeCount) })}
          </span>
        </div>
      ))}
    </div>
  );
}
