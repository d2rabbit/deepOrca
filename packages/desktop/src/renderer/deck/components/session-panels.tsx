// Session-centric deck panels: floor wall (all sessions), checkpoints (undo),
// ledger (token accounting per session), task trees. Functional layer (E2) —
// data and primary actions are real, visuals stay minimal.
import { useCallback, useEffect, useState, type JSX } from "react";
import { api } from "../../api";
import type { SerializableSessionEntry, TaskTreeSummary, UndoTarget, WorkspaceSessions } from "../../../shared/ipc";
import { aggregateUsage, compactTokenThreshold, formatTokens } from "../../lib/token-usage";
import { useI18n } from "../../i18n";
import type { DeckEngine } from "../hooks/use-deck-engine";
import { useDeckSettings } from "../hooks/use-deck-settings";
import { DeckIcon } from "../icons";

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

/** Localized status label for the floor card tag (raw engine enums read as noise). */
function statusLabelKey(
  status: string
): "deck.floor.status.live" | "deck.floor.status.done" | "deck.floor.status.failed" | "deck.floor.status.attention" {
  switch (statusTagClass(status)) {
    case "b":
      return "deck.floor.status.live";
    case "g":
      return "deck.floor.status.done";
    case "r":
      return "deck.floor.status.failed";
    default:
      return "deck.floor.status.attention";
  }
}

// ── 车间墙：全部工作区的会话总览（3 列工单卡片），点击切换当前目标 ────────
// E13: live refresh on engine entry updates + hover archive op (real
// archiveSession IPC), so the wall never shows stale状态.
// E16: hover op cluster — rename (inline edit), archive, delete. Delete is
// destructive and goes through a two-step in-place confirmation (mirrors the
// classic layer's confirm-on-delete UX rule); refresh re-runs after every op.
// E17: export joins the cluster — unlike the silent best-effort ops it
// produces a result the user must see, so outcomes surface through the
// app-owned toast relay (onNotify) instead of staying quiet.
export function FloorPanel(props: {
  engine: DeckEngine;
  onClose: () => void;
  /** App-owned toast push (E17) — export feedback and future loud ops. */
  onNotify?: (text: string, kind: "info" | "ok" | "warn" | "bad") => void;
}): JSX.Element {
  const { t } = useI18n();
  const [data, setData] = useState<WorkspaceSessions | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void api
      .listWorkspaceSessions()
      .then(setData)
      .catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  // Session entries churn while the engine runs — keep the wall current.
  useEffect(() => api.onSessionEntryUpdated(() => refresh()), [refresh]);

  const pick = (id: string) => {
    void props.engine.selectSession(id);
    props.onClose();
  };

  const commitRename = () => {
    const id = renamingId;
    const summary = renameDraft.trim();
    setRenamingId(null);
    if (!id || !summary) return;
    void api
      .renameSession(id, summary)
      .then(refresh)
      .catch(() => {});
  };

  const remove = (id: string) => {
    if (confirmDeleteId !== id) {
      // First click arms the confirm; clicking elsewhere or re-running an
      // operation resets it via state below.
      setConfirmDeleteId(id);
      return;
    }
    setConfirmDeleteId(null);
    void api
      .deleteSession(id)
      .then((deleted) => {
        if (deleted) refresh();
      })
      .catch(() => {});
  };

  const exportSession = (id: string, summary: string | null) => {
    void api
      .exportSession(id)
      .then((result) => {
        if (result.ok && result.path) {
          props.onNotify?.(t("deck.floor.exported", { path: result.path }), "ok");
        } else if (!result.ok) {
          props.onNotify?.(t("deck.opFailed", { error: result.error ?? "export" }), "bad");
        }
        // Canceled save dialog (ok without path): nothing to say.
      })
      .catch(() => {
        props.onNotify?.(t("deck.opFailed", { error: "exportSession" }), "bad");
      });
  };

  if (!data) return <div className="deck-empty">{t("deck.loading")}</div>;

  return (
    <div className="deck-panel" onClick={() => setConfirmDeleteId(null)}>
      {data.workspaces.map((ws) => (
        <div key={ws.root} className="deck-panel-group">
          <div className="deck-panel-group-title">{ws.label}</div>
          {ws.sessions.length === 0 ? <div className="deck-empty">{t("deck.floor.empty")}</div> : null}
          <div className="deck-floor-grid">
            {ws.sessions.map((session) => (
              <div
                key={session.id}
                className={`deck-wo-card sh-card deck-wo-card-wrap${session.id === props.engine.activeId ? " active" : ""}`}
                onClick={() => setConfirmDeleteId(null)}
              >
                <button type="button" className="deck-wo-card-hit" onClick={() => pick(session.id)}>
                  <span className={`deck-wo-tag ${statusTagClass(session.status)}`}>
                    {t(statusLabelKey(session.status))}
                  </span>
                  <span className="deck-wo-title">{session.summary ?? session.id.slice(0, 8)}</span>
                  <span className="deck-wo-meta">{session.updateTime.slice(0, 16).replace("T", " ")}</span>
                </button>
                {session.id !== props.engine.activeId ? (
                  <span className="deck-wo-ops" onClick={(e) => e.stopPropagation()}>
                    <span
                      role="button"
                      tabIndex={0}
                      className="deck-wo-op"
                      title={t("deck.floor.rename")}
                      onClick={() => {
                        setConfirmDeleteId(null);
                        setRenamingId(session.id);
                        setRenameDraft(session.summary ?? "");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setRenamingId(session.id);
                          setRenameDraft(session.summary ?? "");
                        }
                      }}
                    >
                      <DeckIcon id="edit" />
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      className="deck-wo-op"
                      title={t("deck.floor.export")}
                      onClick={() => {
                        setConfirmDeleteId(null);
                        exportSession(session.id, session.summary);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          exportSession(session.id, session.summary);
                        }
                      }}
                    >
                      <DeckIcon id="export" />
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      className="deck-wo-op"
                      title={t("deck.floor.archive")}
                      onClick={() => {
                        setConfirmDeleteId(null);
                        void api
                          .archiveSession(session.id)
                          .then(refresh)
                          .catch(() => {});
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void api
                            .archiveSession(session.id)
                            .then(refresh)
                            .catch(() => {});
                        }
                      }}
                    >
                      ✕
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      className={`deck-wo-op${confirmDeleteId === session.id ? " armed" : ""}`}
                      title={confirmDeleteId === session.id ? t("deck.floor.deleteConfirm") : t("deck.floor.delete")}
                      onClick={() => remove(session.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          remove(session.id);
                        }
                      }}
                    >
                      <DeckIcon id="trash" />
                    </span>
                  </span>
                ) : null}
                {renamingId === session.id ? (
                  <form
                    className="deck-wo-rename"
                    onClick={(e) => e.stopPropagation()}
                    onSubmit={(e) => {
                      e.preventDefault();
                      commitRename();
                    }}
                  >
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setRenamingId(null);
                        }
                      }}
                    />
                  </form>
                ) : null}
              </div>
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

// ── 账本：按会话归账的 token 消耗 + 全工作区汇总 + 按模型分段（meter 条） ──
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
  const maxRow = rows[0]?.usage?.total_tokens ?? 0;
  const maxModel = aggregate.perModel[0]?.total ?? 0;

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

      {aggregate.perModel.length > 0 ? (
        <>
          <div className="deck-panel-group-title">{t("deck.ledger.byModel")}</div>
          {aggregate.perModel.map((model) => (
            <div key={model.model} className="deck-ledger-row">
              <div className="deck-ledger-row-head">
                <span className="deck-row-main">{model.model}</span>
                <span className="deck-row-meta">
                  {formatTokens(model.total)} · {t("deck.ledger.reqs", { count: String(model.reqs) })}
                </span>
              </div>
              <div className="deck-meter-bar">
                <i style={{ width: `${maxModel > 0 ? Math.max(2, (model.total / maxModel) * 100) : 0}%` }} />
              </div>
            </div>
          ))}
        </>
      ) : null}

      <div className="deck-panel-group-title">{t("deck.ledger.bySession")}</div>
      {rows.map((session) => (
        <div key={session.id} className="deck-ledger-row">
          <div className="deck-ledger-row-head">
            <span className="deck-row-main">{session.summary ?? session.id.slice(0, 8)}</span>
            <span className="deck-row-meta">{formatTokens(session.usage?.total_tokens ?? 0)}</span>
          </div>
          <div className="deck-meter-bar">
            <i
              style={{ width: `${maxRow > 0 ? Math.max(2, ((session.usage?.total_tokens ?? 0) / maxRow) * 100) : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 上下文焦点卡（设计稿 ctx focus card）：当前会话的上下文拆解 —────────────
// 全部真实数据：activeTokens（当前上下文）、usage 累计 prompt/completion、
// 缓存命中/未命中，以及相对压缩阈值的水位（阈值按本会话用量最大的模型取）。
export function ContextPanel(props: { engine: DeckEngine }): JSX.Element {
  const { t } = useI18n();
  const entry = props.engine.entry;
  // 用户自定义压缩阈值（设置里可改）优先于模型家族默认值 —— 与经典层
  // ContextProgress 的 override 口径一致，否则 deck 的水位会虚高/虚低。
  const { settings } = useDeckSettings();

  if (!entry) return <div className="deck-empty">{t("deck.noSession")}</div>;

  const usage = entry.usage;
  const heaviestModel = entry.usagePerModel
    ? Object.entries(entry.usagePerModel).sort(
        ([, a], [, b]) => (b?.total_tokens ?? 0) - (a?.total_tokens ?? 0)
      )[0]?.[0]
    : undefined;
  const threshold = compactTokenThreshold(heaviestModel ?? "", settings?.compactTokenThreshold);
  const active = entry.activeTokens ?? 0;
  const activePct = Math.min(100, Math.round((active / threshold) * 100));
  const cacheHit = usage?.prompt_cache_hit_tokens ?? 0;
  const cacheMiss = usage?.prompt_cache_miss_tokens ?? 0;
  const cacheRate = cacheHit + cacheMiss > 0 ? Math.round((cacheHit / (cacheHit + cacheMiss)) * 100) : 0;

  return (
    <div className="deck-panel">
      <div className="deck-kv-grid">
        <div className="deck-kv">
          <span className="k">{t("deck.context.active")}</span>
          <span className="v">{formatTokens(active)}</span>
        </div>
        <div className="deck-kv">
          <span className="k">{t("deck.context.threshold")}</span>
          <span className="v">{formatTokens(threshold)}</span>
        </div>
        <div className="deck-kv">
          <span className="k">{t("deck.context.prompt")}</span>
          <span className="v">{usage ? formatTokens(usage.prompt_tokens) : "—"}</span>
        </div>
        <div className="deck-kv">
          <span className="k">{t("deck.context.completion")}</span>
          <span className="v">{usage ? formatTokens(usage.completion_tokens) : "—"}</span>
        </div>
      </div>

      <div className="deck-panel-group-title">{t("deck.context.watermark", { pct: String(activePct) })}</div>
      <div className="deck-meter-bar">
        <i style={{ width: `${Math.max(2, activePct)}%` }} />
      </div>
      <div className="deck-row-sub">
        {t("deck.context.watermarkHint", { model: heaviestModel ?? "—", threshold: formatTokens(threshold) })}
      </div>

      <div className="deck-panel-group-title">{t("deck.context.cache", { pct: String(cacheRate) })}</div>
      <div className="deck-meter-bar">
        <i style={{ width: `${Math.max(cacheHit + cacheMiss > 0 ? 2 : 0, cacheRate)}%` }} />
      </div>
      <div className="deck-row-sub">
        {t("deck.context.cacheHint", { hit: formatTokens(cacheHit), miss: formatTokens(cacheMiss) })}
      </div>

      {entry.usagePerModel && Object.keys(entry.usagePerModel).length > 0 ? (
        <>
          <div className="deck-panel-group-title">{t("deck.ledger.byModel")}</div>
          {Object.entries(entry.usagePerModel)
            .sort(([, a], [, b]) => (b?.total_tokens ?? 0) - (a?.total_tokens ?? 0))
            .map(([model, mu]) => (
              <div key={model} className="deck-row static">
                <span className="deck-row-main">{model}</span>
                <span className="deck-row-meta">
                  {formatTokens(mu?.total_tokens ?? 0)} · {mu?.total_reqs ?? 0} req
                </span>
              </div>
            ))}
        </>
      ) : null}
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
