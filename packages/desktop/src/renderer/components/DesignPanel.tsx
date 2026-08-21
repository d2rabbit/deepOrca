/**
 * DesignPanel — the Designer module's left-sidebar workspace.
 *
 * Lists all design artifacts from `.deeporca/designs/` (persisted by
 * design-store), grouped by pipeline:
 *   - PM-Design prototypes (pipeline="openui")
 *   - UI-Design documents (pipeline="design", .dd format)
 *
 * Also hosts the brand-contract loop (specs/ui-domain-regroup): the drift
 * gate (design.drift — deterministic dembrandt --compare) pairs with the
 * agent-side design.extract ingestion, keeping "摄取基线 → 检测漂移" in the
 * design domain. CodeReviewPanel stays pure code review.
 *
 * Clicking an artifact opens it in the right-side preview panel.
 * Mirrors the IndexLibraryPanel pattern (workspace panel + artifact list).
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton, Input } from "../ui/index";
import type { ActionProgressEvent, ActionRunResult, DesignArtifactMeta } from "../../shared/ipc";

type Props = {
  /** Open an artifact in the preview panel (mode: "openui" | "design"). */
  onOpenArtifact: (artifact: DesignArtifactMeta) => void;
};

type FilterTab = "all" | "openui" | "design";

/** Shape of the design.drift action output (deterministic, zero LLM). */
type DriftOutput = {
  driftDetected?: boolean;
  score?: number;
  summary?: string;
  driftJson?: string;
};

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function DesignPanel({ onOpenArtifact }: Props): JSX.Element {
  const { t } = useI18n();
  const [artifacts, setArtifacts] = useState<DesignArtifactMeta[]>([]);
  const [filter, setFilter] = useState<FilterTab>("all");
  // One-click materialize (specs/pm-design-v2 P0): requirement in, artifact out.
  const [requirement, setRequirement] = useState("");
  const [materializing, setMaterializing] = useState(false);
  const [materializeNote, setMaterializeNote] = useState<string | null>(null);
  // Brand drift gate (design.drift) — migrated from CodeReviewPanel per
  // specs/ui-domain-regroup. The baseline defaults to the conventional
  // location written by design.extract's persist instruction.
  const [driftBaseline, setDriftBaseline] = useState(".deeporca/design-baseline.json");
  const [driftCurrent, setDriftCurrent] = useState("");
  const [driftRunning, setDriftRunning] = useState(false);
  const [driftProgress, setDriftProgress] = useState("");
  const [driftResult, setDriftResult] = useState<ActionRunResult | null>(null);
  const [driftError, setDriftError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = await api.designList();
      setArtifacts(list);
    } catch {
      setArtifacts([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Subscribe to the unified action progress stream while the drift gate runs.
  useEffect(() => {
    if (!driftRunning) {
      setDriftProgress("");
      return;
    }
    const unsub = api.onActionProgress((evt: ActionProgressEvent) => {
      if (evt.actionId === "design.drift") {
        setDriftProgress(evt.percent != null ? `${evt.percent}% — ${evt.message}` : evt.message);
      }
    });
    return unsub;
  }, [driftRunning]);

  const runDrift = useCallback(async () => {
    const baseline = driftBaseline.trim();
    const current = driftCurrent.trim();
    if (!baseline || !current || driftRunning) {
      setDriftError(t("design.drift.hint"));
      return;
    }
    setDriftRunning(true);
    setDriftResult(null);
    setDriftError(null);
    setDriftProgress("");
    try {
      const res = await api.actionRun("design.drift", { baseline, current });
      setDriftResult(res);
    } catch (err) {
      setDriftError(err instanceof Error ? err.message : String(err));
    } finally {
      setDriftRunning(false);
    }
  }, [driftBaseline, driftCurrent, driftRunning, t]);

  const driftOutput = driftResult && driftResult.ok ? (driftResult.output as DriftOutput) : null;

  const handleMaterialize = useCallback(async () => {
    const text = requirement.trim();
    if (!text || materializing) return;
    setMaterializing(true);
    setMaterializeNote(t("design.materializing"));
    try {
      const result = await api.actionRun("design.materialize", { requirement: text });
      const output = (result as { output?: { ok?: boolean; error?: string; pipeline?: string } }).output;
      if (output && "ok" in output && output.ok !== true) {
        setMaterializeNote(output.error ?? "failed");
      } else {
        setMaterializeNote(t("design.materialized"));
        setRequirement("");
        await reload();
      }
    } catch (err) {
      setMaterializeNote(err instanceof Error ? err.message : String(err));
    } finally {
      setMaterializing(false);
    }
  }, [requirement, materializing, reload, t]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm(t("design.deleteConfirm"))) return;
      await api.designDelete(id);
      void reload();
    },
    [reload, t]
  );

  // P4-1 package export: main builds a .ddp (pm-design) or .ddu (ui-design)
  // ZIP archive and writes a user-chosen file. Cancel surfaces as a quiet
  // no-op rather than an error.
  const handleExportPackage = useCallback(
    async (id: string) => {
      const result = await api.designExportPackage(id);
      setMaterializeNote(
        result.ok && result.path
          ? t("design.exported", { path: result.path })
          : result.error
            ? t("design.exportFailed", { error: result.error })
            : ""
      );
    },
    [t]
  );

  const filtered = filter === "all" ? artifacts : artifacts.filter((a) => a.pipeline === filter);
  const prototypes = artifacts.filter((a) => a.pipeline === "openui");
  const documents = artifacts.filter((a) => a.pipeline === "design");

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("design.title")}</span>
        <IconButton onClick={() => void reload()} title={t("scm.refresh")} aria-label={t("scm.refresh")}>
          ⟳
        </IconButton>
      </div>
      <div className="ui-side-panel-body">
        {/* One-click materialize (specs/pm-design-v2 P0): requirement → routed pipeline → artifact. */}
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "8px 12px",
            borderBottom: "1px solid var(--ui-border-soft, #333)",
          }}
        >
          <input
            style={{
              flex: 1,
              fontSize: 11,
              padding: "4px 6px",
              borderRadius: 4,
              border: "1px solid var(--ui-border-soft, #444)",
              background: "var(--ui-input-bg, rgba(0,0,0,0.15))",
              color: "var(--ui-text)",
            }}
            placeholder={t("design.materializePrompt")}
            value={requirement}
            disabled={materializing}
            onChange={(e) => setRequirement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleMaterialize();
              }
            }}
          />
          <button
            style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer" }}
            disabled={materializing || !requirement.trim()}
            onClick={() => void handleMaterialize()}
          >
            🎯 {t("design.materializeBtn")}
          </button>
        </div>
        {materializeNote ? (
          <div style={{ padding: "2px 12px 6px", fontSize: 10, color: "var(--ui-accent)" }}>{materializeNote}</div>
        ) : null}
        {/* Brand drift gate (design.drift) — deterministic dembrandt --compare,
            zero LLM. Pairs with the agent-side design.extract ingestion
            (摄取基线 → 检测漂移) per specs/ui-domain-regroup. */}
        <div className="ui-review-drift">
          <div className="ui-review-drift-title">{t("design.drift.title")}</div>
          <p className="ui-muted" style={{ fontSize: 10, margin: "2px 0 6px" }}>
            {t("design.drift.hint")}
          </p>
          <Input
            type="text"
            value={driftBaseline}
            placeholder={t("design.drift.baseline")}
            onChange={(e) => setDriftBaseline(e.target.value)}
          />
          <Input
            type="text"
            value={driftCurrent}
            placeholder={t("design.drift.current")}
            onChange={(e) => setDriftCurrent(e.target.value)}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <Button size="sm" variant="subtle" onClick={() => void runDrift()} disabled={driftRunning}>
              {driftRunning ? t("actions.running") : t("design.drift.run")}
            </Button>
            {driftRunning && driftProgress ? (
              <span className="ui-muted" style={{ fontSize: 11 }}>
                {driftProgress}
              </span>
            ) : null}
          </div>
          {driftError ? (
            <div className="ui-error" style={{ marginTop: 6 }}>
              {driftError}
            </div>
          ) : null}
          {driftResult ? (
            !driftResult.ok ? (
              <pre className="ui-muted" style={{ fontSize: 10, margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
                {`✗ ${driftResult.code}: ${driftResult.error}`}
              </pre>
            ) : driftOutput ? (
              <div className="ui-review-drift-result">
                <div className={`ui-review-drift-badge${driftOutput.driftDetected ? " bad" : " good"}`}>
                  {driftOutput.driftDetected ? `⚠ ${t("design.drift.detected")}` : `✅ ${t("design.drift.pass")}`}
                  {typeof driftOutput.score === "number"
                    ? ` · ${t("design.drift.score", { score: driftOutput.score })}`
                    : ""}
                </div>
                {driftOutput.summary ? (
                  <div className="ui-muted" style={{ fontSize: 11 }}>
                    {driftOutput.summary}
                  </div>
                ) : null}
                {driftOutput.driftJson ? (
                  <details>
                    <summary className="ui-muted" style={{ fontSize: 10.5, cursor: "pointer" }}>
                      {t("design.drift.details")}
                    </summary>
                    <pre
                      className="ui-muted"
                      style={{
                        fontSize: 10,
                        margin: "4px 0 0",
                        maxHeight: 220,
                        overflow: "auto",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {prettyJson(driftOutput.driftJson)}
                    </pre>
                  </details>
                ) : null}
              </div>
            ) : null
          ) : null}
        </div>
        {artifacts.length === 0 ? (
          <div className="ui-side-panel-empty">{t("design.empty")}</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, padding: "8px 12px", fontSize: 12 }}>
              <button
                type="button"
                onClick={() => setFilter("all")}
                style={{
                  padding: "3px 10px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  background: filter === "all" ? "var(--ui-accent, #3b82f6)" : "var(--ui-surface-hover, transparent)",
                  color: filter === "all" ? "#fff" : "var(--ui-text, inherit)",
                }}
              >
                {t("design.filter.all")} ({artifacts.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("openui")}
                style={{
                  padding: "3px 10px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  background:
                    filter === "openui" ? "var(--ui-accent, #3b82f6)" : "var(--ui-surface-hover, transparent)",
                  color: filter === "openui" ? "#fff" : "var(--ui-text, inherit)",
                }}
              >
                {t("design.filter.prototypes")} ({prototypes.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("design")}
                style={{
                  padding: "3px 10px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  background:
                    filter === "design" ? "var(--ui-accent, #3b82f6)" : "var(--ui-surface-hover, transparent)",
                  color: filter === "design" ? "#fff" : "var(--ui-text, inherit)",
                }}
              >
                {t("design.filter.documents")} ({documents.length})
              </button>
            </div>
            <div style={{ padding: "4px 8px" }}>
              {filtered.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    marginBottom: 4,
                    borderRadius: 8,
                    border: "1px solid var(--ui-border-soft, #333)",
                    cursor: "pointer",
                  }}
                  onClick={() => onOpenArtifact(a)}
                >
                  <span style={{ fontSize: 16 }}>{a.pipeline === "openui" ? "🎯" : "📐"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--ui-text, inherit)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.title}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ui-text-dim, #888)" }}>
                      {a.pipeline === "openui" ? "PM-Design" : "UI-Design"} · {timeAgo(a.updatedAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleExportPackage(a.id);
                    }}
                    style={{
                      padding: "2px 6px",
                      fontSize: 11,
                      background: "transparent",
                      border: "none",
                      color: "var(--ui-text-dim, #888)",
                      cursor: "pointer",
                    }}
                    title={t("design.exportPackage")}
                  >
                    ⬇
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(a.id);
                    }}
                    style={{
                      padding: "2px 6px",
                      fontSize: 11,
                      background: "transparent",
                      border: "none",
                      color: "var(--ui-text-dim, #888)",
                      cursor: "pointer",
                    }}
                    title={t("design.delete")}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Pretty-print a raw JSON payload string (best effort, raw on parse failure). */
function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
