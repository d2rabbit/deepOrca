import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { CodegraphProgressEvent } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton } from "../ui/index";

/**
 * Left-panel index library: shows CodeGraph index status for the CURRENT
 * workspace only. Not a multi-workspace list — just the current project's
 * state with an init/reindex button and live output.
 */
export function IndexLibraryPanel(): JSX.Element {
  const { t } = useI18n();
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [projectRoot, setProjectRoot] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeLog = useCallback(() => {
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
    setShowLog(false);
    setLogLines([]);
    setPercent(null);
  }, []);

  useEffect(() => {
    return () => {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    };
  }, []);

  const reload = useCallback(async () => {
    const entries = await api.codegraphList();
    if (entries.length > 0) {
      setInitialized(entries[0].initialized);
      setProjectRoot(entries[0].root);
    } else {
      setInitialized(null);
      setProjectRoot("");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Subscribe to streaming codegraph progress events.
  useEffect(() => {
    const off = api.onCodegraphProgress((event: CodegraphProgressEvent) => {
      if (event.done) {
        setBusy(false);
        setPercent(100);
        setLogLines((prev) => {
          const suffix = event.exitCode === 0 ? t("index.done") : `${t("index.failed")} (exit ${event.exitCode})`;
          return [...prev, `\n✓ ${suffix}`];
        });
        void reload();
        if (event.exitCode === 0) {
          if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
          autoCloseRef.current = setTimeout(() => {
            autoCloseRef.current = null;
            setShowLog(false);
            setLogLines([]);
            setPercent(null);
          }, 2500);
        }
        return;
      }
      setShowLog(true);
      const pctMatch = event.chunk.match(/(\d{1,3})(?:\.\d+)?\s*%/g);
      if (pctMatch && pctMatch.length > 0) {
        const last = pctMatch[pctMatch.length - 1] ?? "";
        const value = Math.min(100, parseInt(last, 10));
        if (!Number.isNaN(value)) setPercent(value);
      }
      setLogLines((prev) => {
        const text = event.chunk.replace(/\n$/, "");
        if (!text) return prev;
        const lines = text.split("\n");
        const next = [...prev, ...lines];
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
    });
    return off;
  }, [reload, t]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  const reindex = useCallback(async () => {
    if (!projectRoot) return;
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
    setBusy(true);
    setShowLog(true);
    setLogLines([`$ codegraph init ${projectRoot}`]);
    setPercent(null);
    try {
      await api.codegraphReindex(projectRoot);
    } finally {
      // busy is cleared by the progress event handler (done=true)
    }
  }, [projectRoot]);

  const projectLabel = projectRoot ? projectRoot.split("/").pop() || projectRoot : "";

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("index.title")}</span>
        <IconButton onClick={() => void reload()} title={t("scm.refresh")} aria-label={t("scm.refresh")}>
          ⟳
        </IconButton>
      </div>
      <div className="ui-side-panel-body">
        {!projectRoot ? (
          <div className="ui-side-panel-empty">{t("index.empty")}</div>
        ) : (
          <div className="ui-index-current">
            <div className="ui-index-current-info">
              <div className="ui-index-name">{projectLabel}</div>
              <div className="ui-index-path" title={projectRoot}>
                {projectRoot}
              </div>
              <div className={`ui-index-state${initialized ? " on" : ""}`}>
                {initialized ? t("index.indexed") : t("index.uninitialized")}
              </div>
            </div>
            <Button size="sm" variant="subtle" disabled={busy} onClick={() => void reindex()}>
              {busy ? t("index.reindexing") : initialized ? t("index.reindex") : t("index.init")}
            </Button>
          </div>
        )}

        {showLog && (
          <div className="ui-index-log">
            <div className="ui-index-log-head">
              <span>{projectLabel}</span>
              <IconButton onClick={closeLog} title={t("common.close")} aria-label={t("common.close")}>
                ✕
              </IconButton>
            </div>
            {busy || percent !== null ? (
              <div className="ui-index-progress">
                <div
                  className={`ui-index-progress-fill${busy && percent === null ? " indeterminate" : ""}`}
                  style={percent !== null ? { width: `${percent}%` } : undefined}
                />
              </div>
            ) : null}
            <pre className="ui-index-log-body">
              {logLines.join("\n")}
              <div ref={logEndRef} />
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
