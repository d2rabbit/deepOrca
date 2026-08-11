import { useCallback, useEffect, useState, type JSX } from "react";
import type { ActionListItem, ActionProgressEvent, ActionRunResult } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button } from "../ui/index";

/**
 * defineAction surface — the renderer/UI leg of "define once, surface
 * everywhere" (spec §六). Lists every registered action and lets the user
 * invoke any of them directly (the same actions the agent reaches as LLM
 * tools and external MCP clients reach via the mcp__ namespace).
 *
 * Phase 0-3 actions appear here automatically once registered in the
 * SessionManager's ActionRegistry: system.ping (health check), review.run /
 * review.check-available (ocr), crg.* (code-review-graph), codegraph.* /
 * wiki.* / index.build-all (knowledge index), arch-scan.run (architecture).
 *
 * This is the user-visible proof that one registration reaches the UI.
 */
export function ActionsPanel(): JSX.Element {
  const { t } = useI18n();
  const [actions, setActions] = useState<ActionListItem[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [result, setResult] = useState<{ id: string; res: ActionRunResult } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refresh the action list on mount (and when the panel re-mounts).
  useEffect(() => {
    let cancelled = false;
    api
      .actionList()
      .then((list) => {
        if (!cancelled) setActions(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to the unified progress stream while an action is running.
  useEffect(() => {
    if (!running) {
      setProgress("");
      return;
    }
    const unsub = api.onActionProgress((evt: ActionProgressEvent) => {
      if (evt.actionId === running) {
        setProgress(evt.percent != null ? `${evt.percent}% — ${evt.message}` : evt.message);
      }
    });
    return unsub;
  }, [running]);

  const run = useCallback(async (id: string) => {
    setRunning(id);
    setResult(null);
    setError(null);
    setProgress("");
    try {
      const res = await api.actionRun(id, {});
      setResult({ id, res });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
    }
  }, []);

  return (
    <div className="ui-side-panel" style={{ gap: 8, padding: 12 }}>
      <div className="ui-side-panel-header">
        <h3>{t("actions.title")}</h3>
        <span className="ui-muted">{actions.length}</span>
      </div>
      <p className="ui-muted" style={{ fontSize: 12 }}>
        {t("actions.subtitle")}
      </p>
      {error ? <div className="ui-error">{error}</div> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
        {actions.length === 0 && !error ? (
          <div className="ui-muted">{t("actions.empty")}</div>
        ) : (
          actions.map((a) => (
            <div
              key={a.id}
              style={{
                border: "1px solid var(--ui-border, #333)",
                borderRadius: 6,
                padding: 8,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <code style={{ fontSize: 12 }}>{a.id}</code>
                {a.category ? (
                  <span className="ui-muted" style={{ fontSize: 10 }}>
                    {a.category}
                  </span>
                ) : null}
              </div>
              <p className="ui-muted" style={{ fontSize: 11, margin: 0 }}>
                {a.description.slice(0, 140)}
                {a.description.length > 140 ? "…" : ""}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Button onClick={() => void run(a.id)} disabled={running !== null}>
                  {running === a.id ? t("actions.running") : t("actions.run")}
                </Button>
                {running === a.id && progress ? (
                  <span className="ui-muted" style={{ fontSize: 11 }}>
                    {progress}
                  </span>
                ) : null}
              </div>
              {result && result.id === a.id ? (
                <pre
                  className="ui-muted"
                  style={{
                    fontSize: 10,
                    margin: 0,
                    maxHeight: 160,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {JSON.stringify(result.res, null, 2)}
                </pre>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
