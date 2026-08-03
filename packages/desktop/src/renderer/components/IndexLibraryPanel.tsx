import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { CodegraphProgressEvent, WikiProgressEvent } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton } from "../ui/index";

/**
 * Unified Index & Knowledge panel. Single view — no tabs, no tool names.
 *
 * Two knowledge layers execute in sequence behind the scenes:
 * 1. Code symbol index (auto-syncs via file watcher + post-turn hook)
 * 2. Project documentation wiki (manual sync)
 *
 * The user sees only: project name, single status dot, one button, and a
 * progress bar during build/update. No internal tool names are exposed.
 *
 * All operations are scoped to the current workspace/project root.
 */
export function IndexLibraryPanel(): JSX.Element {
  const { t } = useI18n();
  const [cgInitialized, setCgInitialized] = useState<boolean | null>(null);
  const [wikiExists, setWikiExists] = useState(false);
  const [wikiAvailable, setWikiAvailable] = useState(false);
  const [projectRoot, setProjectRoot] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    };
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

  // Progress handlers — update the bar only, no text output.
  const onCodegraphDone = useRef<(() => void) | null>(null);
  useEffect(() => {
    const off = api.onCodegraphProgress((event: CodegraphProgressEvent) => {
      if (event.done) {
        if (event.exitCode === 0) void reload();
        onCodegraphDone.current?.();
        return;
      }
      const pctMatch = event.chunk.match(/(\d{1,3})(?:\.\d+)?\s*%/g);
      if (pctMatch && pctMatch.length > 0) {
        const last = pctMatch[pctMatch.length - 1] ?? "";
        const value = Math.min(50, parseInt(last, 10) / 2); // first half
        if (!Number.isNaN(value)) setPercent(value);
      }
    });
    return off;
  }, [reload]);

  const onWikiDone = useRef<(() => void) | null>(null);
  useEffect(() => {
    const off = api.onWikiProgress((event: WikiProgressEvent) => {
      if (event.done) {
        if (event.exitCode === 0) void reload();
        onWikiDone.current?.();
        return;
      }
      // Wiki is second half of progress (50-100%).
      setPercent((prev) => Math.max(prev ?? 50, 50));
    });
    return off;
  }, [reload]);

  const runSequential = useCallback(
    async (mode: "init" | "update") => {
      if (!projectRoot) return;
      if (autoCloseRef.current) {
        clearTimeout(autoCloseRef.current);
        autoCloseRef.current = null;
      }
      setBusy(true);
      setPercent(null);

      // Phase 1: symbol index
      await new Promise<void>((resolve) => {
        onCodegraphDone.current = () => resolve();
        void api.codegraphReindex(projectRoot);
      });

      // Phase 2: wiki (only if available)
      if (wikiAvailable) {
        setPercent(50);
        await new Promise<void>((resolve) => {
          onWikiDone.current = () => resolve();
          if (mode === "init") {
            void api.wikiInit();
          } else {
            void api.wikiUpdate();
          }
        });
      }

      setBusy(false);
      setPercent(100);
      void reload();

      autoCloseRef.current = setTimeout(() => {
        autoCloseRef.current = null;
        setPercent(null);
      }, 2500);
    },
    [projectRoot, wikiAvailable, reload]
  );

  const projectLabel = projectRoot ? projectRoot.split("/").pop() || projectRoot : "";
  const indexReady = cgInitialized && (!wikiAvailable || wikiExists);
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
          <div className="ui-index-current">
            <div className="ui-index-current-info">
              <div className="ui-index-name">{projectLabel}</div>
              <div className="ui-index-path" title={projectRoot}>
                {projectRoot}
              </div>
              <div className={`ui-index-state${indexReady ? " on" : ""}`}>
                {indexReady ? t("index.indexed") : t("index.uninitialized")}
              </div>
            </div>

            {/* Progress bar — only visible during build/update */}
            {busy || percent !== null ? (
              <div className="ui-index-progress">
                <div
                  className={`ui-index-progress-fill${busy && percent === null ? " indeterminate" : ""}`}
                  style={percent !== null ? { width: `${percent}%` } : undefined}
                />
              </div>
            ) : null}

            <Button
              size="sm"
              variant="subtle"
              disabled={!canBuild}
              onClick={() => void runSequential(indexReady ? "update" : "init")}
            >
              {busy ? t("index.building") : indexReady ? t("index.updateAll") : t("index.buildIndex")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
