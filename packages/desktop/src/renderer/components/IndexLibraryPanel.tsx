import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { CodegraphProgressEvent, WikiProgressEvent } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton } from "../ui/index";

type IndexPhase = "codegraph" | "wiki" | null;

/**
 * Unified Index & Knowledge panel. Single view — no tabs.
 *
 * Two knowledge layers, executed in sequence:
 * 1. CodeGraph — Agent's code symbol index (invisible to humans, powers symbol
 *    navigation via MCP). Auto-syncs via file watcher + post-turn hook.
 * 2. OpenWiki — Human + Agent project documentation (visible markdown wiki).
 *    Manual sync only.
 *
 * The "Build Index" button runs both in sequence: CodeGraph init → OpenWiki init.
 * The "Update" button runs incremental sync for both: CodeGraph sync → OpenWiki update.
 */
export function IndexLibraryPanel(): JSX.Element {
  const { t } = useI18n();
  const [cgInitialized, setCgInitialized] = useState<boolean | null>(null);
  const [wikiExists, setWikiExists] = useState(false);
  const [wikiAvailable, setWikiAvailable] = useState(false);
  const [projectRoot, setProjectRoot] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<IndexPhase>(null);
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

  const appendLog = useCallback((text: string) => {
    setLogLines((prev) => {
      const next = [...prev, ...text.split("\n")];
      return next.length > 300 ? next.slice(next.length - 300) : next;
    });
  }, []);

  const appendLogRaw = useCallback((chunk: string) => {
    const text = chunk.replace(/\n$/, "");
    if (!text) return;
    setLogLines((prev) => {
      const next = [...prev, ...text.split("\n")];
      return next.length > 300 ? next.slice(next.length - 300) : next;
    });
  }, []);

  const reload = useCallback(async () => {
    const [cgEntries, availInfo, pages] = await Promise.all([
      api.codegraphList(),
      api.wikiCheckAvailable(),
      api.wikiListPages(),
    ]);
    if (cgEntries.length > 0) {
      setCgInitialized(cgEntries[0].initialized);
      setProjectRoot(cgEntries[0].root);
    } else {
      setCgInitialized(null);
      setProjectRoot("");
    }
    setWikiAvailable(availInfo.available);
    setWikiExists(pages.length > 0);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // CodeGraph progress handler.
  const onCodegraphDone = useRef<((exitCode: number) => void) | null>(null);
  useEffect(() => {
    const off = api.onCodegraphProgress((event: CodegraphProgressEvent) => {
      if (event.done) {
        setPercent(100);
        appendLog(
          `\n✓ CodeGraph: ${event.exitCode === 0 ? t("index.done") : `${t("index.failed")} (exit ${event.exitCode})`}`
        );
        if (event.exitCode === 0) void reload();
        onCodegraphDone.current?.(event.exitCode ?? 1);
        return;
      }
      setShowLog(true);
      const pctMatch = event.chunk.match(/(\d{1,3})(?:\.\d+)?\s*%/g);
      if (pctMatch && pctMatch.length > 0) {
        const last = pctMatch[pctMatch.length - 1] ?? "";
        const value = Math.min(100, parseInt(last, 10));
        if (!Number.isNaN(value)) setPercent(value);
      }
      appendLogRaw(event.chunk);
    });
    return off;
  }, [reload, t, appendLog, appendLogRaw]);

  // OpenWiki progress handler.
  const onWikiDone = useRef<((exitCode: number) => void) | null>(null);
  useEffect(() => {
    const off = api.onWikiProgress((event: WikiProgressEvent) => {
      if (event.done) {
        appendLog(
          `\n✓ OpenWiki: ${event.exitCode === 0 ? t("index.done") : `${t("index.failed")} (exit ${event.exitCode})`}`
        );
        if (event.exitCode === 0) void reload();
        onWikiDone.current?.(event.exitCode ?? 1);
        return;
      }
      setShowLog(true);
      appendLogRaw(event.chunk);
    });
    return off;
  }, [reload, t, appendLog, appendLogRaw]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  /**
   * Full build: CodeGraph init → OpenWiki init (sequential).
   * Incremental update: CodeGraph reindex → OpenWiki update (sequential).
   */
  const runSequential = useCallback(
    async (mode: "init" | "update") => {
      if (!projectRoot) return;
      if (autoCloseRef.current) {
        clearTimeout(autoCloseRef.current);
        autoCloseRef.current = null;
      }
      setBusy(true);
      setShowLog(true);
      setLogLines([]);
      setPercent(null);

      // Phase 1: CodeGraph
      setPhase("codegraph");
      appendLog(`=== CodeGraph ${mode === "init" ? "Init" : "Reindex"} ===`);
      await new Promise<void>((resolve) => {
        onCodegraphDone.current = () => resolve();
        void api.codegraphReindex(projectRoot);
      });

      // Phase 2: OpenWiki (only if available)
      if (wikiAvailable) {
        setPhase("wiki");
        setPercent(null);
        appendLog(`\n=== OpenWiki ${mode === "init" ? "Init" : "Update"} ===`);
        await new Promise<void>((resolve) => {
          onWikiDone.current = () => resolve();
          if (mode === "init") {
            void api.wikiInit();
          } else {
            void api.wikiUpdate();
          }
        });
      }

      setPhase(null);
      setBusy(false);
      setPercent(100);
      appendLog(`\n✓ ${t("index.allDone")}`);
      void reload();

      // Auto-close log after success.
      autoCloseRef.current = setTimeout(() => {
        autoCloseRef.current = null;
        setShowLog(false);
        setLogLines([]);
        setPercent(null);
      }, 3000);
    },
    [projectRoot, wikiAvailable, appendLog, reload, t]
  );

  const projectLabel = projectRoot ? projectRoot.split("/").pop() || projectRoot : "";
  const bothReady = cgInitialized && wikiExists;
  const canBuild = !!projectRoot && !busy;

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
          <>
            {/* Status overview */}
            <div className="ui-index-status-grid">
              <div className="ui-index-status-item">
                <div className="ui-index-status-label">CodeGraph</div>
                <div className={`ui-index-status-dot${cgInitialized ? " on" : ""}`} />
                <div className="ui-index-status-text">
                  {cgInitialized ? t("index.indexed") : t("index.uninitialized")}
                </div>
              </div>
              {wikiAvailable ? (
                <div className="ui-index-status-item">
                  <div className="ui-index-status-label">OpenWiki</div>
                  <div className={`ui-index-status-dot${wikiExists ? " on" : ""}`} />
                  <div className="ui-index-status-text">{wikiExists ? t("index.wikiReady") : t("index.wikiEmpty")}</div>
                </div>
              ) : null}
            </div>

            {/* Sync info */}
            {cgInitialized ? <div className="ui-index-hint">{t("index.codegraphAutoSync")}</div> : null}
            {wikiExists ? <div className="ui-index-hint">{t("index.wikiManualSync")}</div> : null}

            {/* Action buttons */}
            <div className="ui-index-actions">
              <Button
                size="sm"
                variant="primary"
                disabled={!canBuild}
                onClick={() => void runSequential(bothReady ? "update" : "init")}
              >
                {busy
                  ? phase === "codegraph"
                    ? t("index.reindexing")
                    : phase === "wiki"
                      ? t("index.updating")
                      : t("index.processing")
                  : bothReady
                    ? t("index.updateAll")
                    : t("index.buildIndex")}
              </Button>
            </div>

            {/* Progress log */}
            {showLog ? (
              <div className="ui-index-log">
                <div className="ui-index-log-head">
                  <span>
                    {projectLabel}
                    {phase ? ` · ${phase}` : ""}
                  </span>
                  {!busy ? (
                    <IconButton onClick={closeLog} title={t("common.close")} aria-label={t("common.close")}>
                      ✕
                    </IconButton>
                  ) : null}
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
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
