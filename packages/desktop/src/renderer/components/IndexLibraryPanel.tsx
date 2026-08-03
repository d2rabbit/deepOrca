import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { CodegraphProgressEvent, WikiProgressEvent } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton } from "../ui/index";

type IndexTab = "codegraph" | "wiki";

/**
 * Unified index & knowledge panel. Two tabs:
 *  - CodeGraph: Agent's code symbol index (init/reindex + auto-sync status)
 *  - OpenWiki:  Human + Agent project documentation index (init/update)
 *
 * Both tools digest the codebase into queryable knowledge structures.
 * CodeGraph serves Agent symbol navigation; OpenWiki serves shared docs.
 */
export function IndexLibraryPanel(): JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<IndexTab>("codegraph");

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("index.title")}</span>
        <IconButton onClick={() => void {}} title={t("scm.refresh")} aria-label={t("scm.refresh")}>
          ⟳
        </IconButton>
      </div>
      <div className="ui-tabs">
        <button className={`ui-tab${tab === "codegraph" ? " active" : ""}`} onClick={() => setTab("codegraph")}>
          {t("index.codegraphTab")}
        </button>
        <button className={`ui-tab${tab === "wiki" ? " active" : ""}`} onClick={() => setTab("wiki")}>
          {t("index.wikiTab")}
        </button>
      </div>
      <div className="ui-side-panel-body">{tab === "codegraph" ? <CodeGraphTab /> : <WikiTab />}</div>
    </div>
  );
}

// ── CodeGraph tab ────────────────────────────────────────────────────────────

function CodeGraphTab(): JSX.Element {
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
    <>
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
            {initialized ? <div className="ui-index-hint">{t("index.codegraphAutoSync")}</div> : null}
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
    </>
  );
}

// ── OpenWiki tab ─────────────────────────────────────────────────────────────

function WikiTab(): JSX.Element {
  const { t } = useI18n();
  const [available, setAvailable] = useState(false);
  const [wikiExists, setWikiExists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeLog = useCallback(() => {
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
    setShowLog(false);
    setLogLines([]);
  }, []);

  useEffect(() => {
    return () => {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    };
  }, []);

  const reload = useCallback(async () => {
    const [availInfo, pages] = await Promise.all([api.wikiCheckAvailable(), api.wikiListPages()]);
    setAvailable(availInfo.available);
    setWikiExists(pages.length > 0);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const off = api.onWikiProgress((event: WikiProgressEvent) => {
      if (event.done) {
        setBusy(false);
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
          }, 2500);
        }
        return;
      }
      setShowLog(true);
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

  const initWiki = useCallback(async () => {
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
    setBusy(true);
    setShowLog(true);
    setLogLines([`$ openwiki --init`]);
    try {
      await api.wikiInit();
    } finally {
      // busy is cleared by the progress event handler
    }
  }, []);

  const updateWiki = useCallback(async () => {
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
    setBusy(true);
    setShowLog(true);
    setLogLines([`$ openwiki --update`]);
    try {
      await api.wikiUpdate();
    } finally {
      // busy is cleared by the progress event handler
    }
  }, []);

  return (
    <>
      {!available ? (
        <div className="ui-side-panel-empty">{t("index.wikiUnavailable")}</div>
      ) : (
        <div className="ui-index-current">
          <div className="ui-index-current-info">
            <div className="ui-index-name">OpenWiki</div>
            <div className={`ui-index-state${wikiExists ? " on" : ""}`}>
              {wikiExists ? t("index.wikiReady") : t("index.wikiEmpty")}
            </div>
            {wikiExists ? <div className="ui-index-hint">{t("index.wikiManualSync")}</div> : null}
          </div>
          {wikiExists ? (
            <Button size="sm" variant="subtle" disabled={busy} onClick={() => void updateWiki()}>
              {busy ? t("index.updating") : t("index.update")}
            </Button>
          ) : (
            <Button size="sm" variant="subtle" disabled={busy} onClick={() => void initWiki()}>
              {busy ? t("index.initializing") : t("index.init")}
            </Button>
          )}
        </div>
      )}

      {showLog && (
        <div className="ui-index-log">
          <div className="ui-index-log-head">
            <span>OpenWiki</span>
            <IconButton onClick={closeLog} title={t("common.close")} aria-label={t("common.close")}>
              ✕
            </IconButton>
          </div>
          {busy ? (
            <div className="ui-index-progress">
              <div className="ui-index-progress-fill indeterminate" />
            </div>
          ) : null}
          <pre className="ui-index-log-body">
            {logLines.join("\n")}
            <div ref={logEndRef} />
          </pre>
        </div>
      )}
    </>
  );
}
