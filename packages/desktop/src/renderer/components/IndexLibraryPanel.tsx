import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton, Input } from "../ui/index";
import type { KnowledgeSourceStatus, KnowledgeStatusResponse, MemoryPipelineStats } from "../../shared/ipc";

/**
 * Knowledge dashboard — the unified view over every knowledge source.
 *
 * Five sources are surfaced as independent cards, each with its own state,
 * content count, freshness, and action:
 *   1. CodeGraph  — symbol-level call graph (.codegraph/)
 *   2. OpenWiki   — structured project docs (openwiki/)
 *   3. Serena     — project memories (.serena/memories/)
 *   4. AGENTS.md  — coding guidelines
 *   5. Memory     — cross-session L0-L3 pipeline
 *
 * The composite "build all" button still orchestrates CodeGraph → OpenWiki →
 * arch-scan via index.build-all; individual cards trigger single-source actions.
 *
 * All operations are scoped to the current workspace/project root.
 */

type SourceKey = keyof KnowledgeStatusResponse;

const SOURCE_ICONS: Record<SourceKey, string> = {
  codegraph: "📊",
  openwiki: "📚",
  memory: "🧠",
  serena: "🔍",
  agents: "📋",
};

/** Card render order — primary indices first, then supplementary sources. */
const SOURCE_ORDER: SourceKey[] = ["codegraph", "openwiki", "memory", "serena", "agents"];

/** Relative "N ago" label from an ISO timestamp. */
function formatRelative(iso: string | undefined, justNow: string, never: string): string {
  if (!iso) return never;
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta) || delta < 0) return never;
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return justNow;
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function IndexLibraryPanel(): JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<KnowledgeStatusResponse | null>(null);
  const [projectRoot, setProjectRoot] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [busySource, setBusySource] = useState<SourceKey | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryResult, setMemoryResult] = useState<string | null>(null);
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
    const [cgEntries, knowledge] = await Promise.all([api.codegraphList(), api.knowledgeStatus()]);
    if (!mountedRef.current) return;
    setProjectRoot(cgEntries.length > 0 ? cgEntries[0].root : "");
    setStatus(knowledge);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Progress from the unified action stream — index.build-all and the
  // single-source actions all emit ActionProgress {actionId, message, percent?}.
  useEffect(() => {
    const off = api.onActionProgress((event: { actionId: string; percent?: number; message?: string }) => {
      if (
        !event.actionId.startsWith("index.") &&
        !event.actionId.startsWith("codegraph.") &&
        !event.actionId.startsWith("wiki.")
      ) {
        return;
      }
      if (typeof event.percent === "number") setPercent(event.percent);
    });
    return off;
  }, []);

  /** Run an action and refresh the dashboard. `source` scopes the busy state. */
  const runAction = useCallback(
    async (actionId: string, input: Record<string, unknown>, source: SourceKey | null) => {
      if (!projectRoot || activeRunRef.current) return;
      activeRunRef.current = true;
      const runId = ++runIdRef.current;
      const isCurrentRun = () => mountedRef.current && runIdRef.current === runId;

      if (autoCloseRef.current) {
        clearTimeout(autoCloseRef.current);
        autoCloseRef.current = null;
      }
      setBusy(true);
      setBusySource(source);
      setPercent(5);
      setError(null);

      try {
        const res = await api.actionRun(actionId, input);
        if (!res.ok) throw new Error(res.error || "Action failed");
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
          setBusySource(null);
        }
      }
    },
    [projectRoot, reload]
  );

  const enableMemory = useCallback(async () => {
    setBusySource("memory");
    try {
      await api.memorySetEnabled(true);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusySource(null);
    }
  }, [reload]);

  const searchMemory = useCallback(async () => {
    const q = memoryQuery.trim();
    if (!q) return;
    try {
      const res = await api.memorySearch(q, 5);
      setMemoryResult(res.total > 0 ? res.text : null);
    } catch {
      setMemoryResult(null);
    }
  }, [memoryQuery]);

  const projectLabel = projectRoot ? projectRoot.split("/").pop() || projectRoot : "";
  /** Composite readiness — drives the "build all" vs "update all" label. */
  const allReady = useMemo(() => status?.codegraph.state === "indexed" && status?.openwiki.state !== "empty", [status]);
  const canBuild = !!projectRoot && !busy;

  /** State label + CSS modifier for a source card. */
  const stateInfo = (s: KnowledgeSourceStatus): { label: string; cls: string } => {
    switch (s.state) {
      case "indexed":
        return { label: t("index.indexed"), cls: " on" };
      case "stale":
        return { label: t("index.state.stale"), cls: " stale" };
      case "disabled":
        return { label: t("index.state.disabled"), cls: "" };
      default:
        return { label: t("index.state.empty"), cls: "" };
    }
  };

  /** Per-source action button — null when the source has no direct action. */
  const sourceAction = (key: SourceKey): JSX.Element | null => {
    if (key === "codegraph") {
      return (
        <Button
          size="sm"
          variant="subtle"
          disabled={!canBuild}
          onClick={() => void runAction("codegraph.reindex", {}, key)}
        >
          {t("index.rebuild")}
        </Button>
      );
    }
    if (key === "openwiki") {
      return (
        <Button size="sm" variant="subtle" disabled={!canBuild} onClick={() => void runAction("wiki.update", {}, key)}>
          {t("index.update")}
        </Button>
      );
    }
    if (key === "memory" && status?.memory.state === "disabled") {
      return (
        <Button size="sm" variant="subtle" disabled={busySource === "memory"} onClick={() => void enableMemory()}>
          {t("index.enable")}
        </Button>
      );
    }
    return null;
  };

  /** L0-L3 breakdown, rendered inside the memory card. */
  const memoryBreakdown = (stats: MemoryPipelineStats): JSX.Element => (
    <div className="ui-knowledge-stats">
      <span>
        {t("index.memory.l0")}: {stats.l0}
      </span>
      <span>
        {t("index.memory.l1")}: {stats.l1}
      </span>
      <span>
        {t("index.memory.l2")}: {stats.l2}
      </span>
      <span>
        {t("index.memory.l3")}: {stats.l3 ? "✓" : "—"}
      </span>
    </div>
  );

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
            </div>

            {/* Composite build — orchestrates CodeGraph → OpenWiki → arch-scan. */}
            <Button
              size="sm"
              variant="subtle"
              disabled={!canBuild}
              onClick={() => void runAction("index.build-all", { mode: allReady ? "update" : "init" }, null)}
            >
              {busy && busySource === null
                ? t("index.building")
                : allReady
                  ? t("index.updateAll")
                  : t("index.buildIndex")}
            </Button>

            {/* Progress bar — only visible during build/update */}
            {busy || percent !== null ? (
              <div className="ui-index-progress">
                <div
                  className={`ui-index-progress-fill${busy && percent === null ? " indeterminate" : ""}`}
                  style={percent !== null ? { width: `${percent}%` } : undefined}
                />
              </div>
            ) : null}

            {error ? <div className="ui-field-hint ui-index-error">{error}</div> : null}

            {/* Per-source knowledge cards. */}
            {status ? (
              <div className="ui-knowledge-grid">
                {SOURCE_ORDER.map((key) => {
                  const src = status[key];
                  const info = stateInfo(src);
                  const isBusy = busySource === key;
                  return (
                    <div key={key} className="ui-knowledge-card">
                      <div className="ui-knowledge-card-head">
                        <span className="ui-knowledge-icon">{SOURCE_ICONS[key]}</span>
                        <span className="ui-knowledge-title">{t(`index.source.${key}`)}</span>
                      </div>
                      <div className={`ui-index-state${info.cls}`}>{isBusy ? t("index.building") : info.label}</div>
                      {typeof src.count === "number" && src.count > 0 ? (
                        <div className="ui-knowledge-count">
                          {src.count} {src.unit ?? ""}
                        </div>
                      ) : null}
                      {src.detail ? <div className="ui-knowledge-detail">{src.detail}</div> : null}
                      {src.lastSync ? (
                        <div className="ui-knowledge-freshness">
                          {formatRelative(src.lastSync, t("index.freshness.justNow"), t("index.freshness.never"))}
                        </div>
                      ) : null}
                      {key === "memory" && status.memory.stats ? memoryBreakdown(status.memory.stats) : null}
                      {sourceAction(key)}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* Memory search — only when the pipeline is live. */}
            {status?.memory.state !== "disabled" ? (
              <div className="ui-knowledge-search">
                <Input
                  type="text"
                  value={memoryQuery}
                  placeholder={t("index.memory.searchPlaceholder")}
                  onChange={(e) => setMemoryQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void searchMemory();
                  }}
                />
                {memoryResult !== null ? (
                  <pre className="ui-knowledge-search-result">{memoryResult}</pre>
                ) : memoryQuery.trim() ? (
                  <div className="ui-field-hint">{t("index.memory.noResults")}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
