import { useCallback, useEffect, useRef, useState, type JSX } from "react";
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
  const [error, setError] = useState<string | null>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRunRef = useRef(false);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
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

  // Progress from the unified action stream — index.build-all emits
  // ActionProgress {actionId, message, percent?}. Replaces the legacy
  // per-tool onCodegraphProgress / onWikiProgress subscriptions now that the
  // build is orchestrated by the composite action in core.
  useEffect(() => {
    const off = api.onActionProgress((event: { actionId: string; percent?: number; message?: string }) => {
      if (event.actionId !== "index.build-all") return;
      if (typeof event.percent === "number") setPercent(event.percent);
    });
    return off;
  }, []);

  const runSequential = useCallback(
    async (mode: "init" | "update") => {
      if (!projectRoot || activeRunRef.current) return;
      activeRunRef.current = true;
      const runId = ++runIdRef.current;
      const isCurrentRun = () => mountedRef.current && runIdRef.current === runId;

      if (autoCloseRef.current) {
        clearTimeout(autoCloseRef.current);
        autoCloseRef.current = null;
      }
      setBusy(true);
      setPercent(5);
      setError(null);

      try {
        // The composite index.build-all action orchestrates CodeGraph → OpenWiki
        // → arch-scan in core (replacing the renderer's per-phase IPC chain).
        const res = await api.actionRun("index.build-all", { mode });
        if (!res.ok) {
          throw new Error(res.error || "Index build failed");
        }
        if (!isCurrentRun()) return;

        setPercent(100);
        void reload();
        autoCloseRef.current = setTimeout(() => {
          autoCloseRef.current = null;
          if (isCurrentRun()) setPercent(null);
        }, 2500);
      } catch (cause) {
        if (!isCurrentRun()) return;
        setPercent(null);
        setError(cause instanceof Error ? cause.message : String(cause));
        void reload();
      } finally {
        if (isCurrentRun()) {
          activeRunRef.current = false;
          setBusy(false);
        }
      }
    },
    [projectRoot, reload]
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

            {/* Error from the last build/update. */}
            {error ? <div className="ui-field-hint ui-index-error">{error}</div> : null}

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
