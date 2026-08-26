/**
 * DesignPanel — the UI-DESIGN module's left-sidebar workspace (design-module
 * split: prototype design is its own module now, see PrototypeDesignPanel).
 *
 * UI/UX design takes a requirement — a single sentence is fine — and/or an
 * existing PROTOTYPE artifact as the interaction basis, and produces a .dd
 * design document (design.materialize → deep-design skill → render_design).
 * The list shows design artifacts only; prototype/spec artifacts live in the
 * prototype module.
 *
 * Also hosts the brand-contract loop (specs/ui-domain-regroup): the drift
 * gate (design.drift — deterministic dembrandt --compare) pairs with the
 * agent-side design.extract ingestion. CodeReviewPanel stays pure code review.
 *
 * Chain integrity: live progress while materializing (terminal data.done is
 * guaranteed by the action IPC) and the list refreshes from design-store
 * change events — artifacts land mid-run, not on the next manual reload.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconCheck, IconDesign, IconTrash, IconWarn, Input, IconButton } from "../ui/index";
import type { ActionProgressEvent, ActionRunResult, DesignArtifactMeta } from "../../shared/ipc";

type Props = {
  /** Open an artifact in the preview panel (mode: "openui" | "design"). */
  onOpenArtifact: (artifact: DesignArtifactMeta) => void;
};

/** Prototype artifacts offered as the design basis ("无" = requirement only). */
type PrototypeOption = { id: string; title: string };

/** Shape of the design.drift action output (deterministic, zero LLM). */
type DriftOutput = {
  driftDetected?: boolean;
  score?: number;
  summary?: string;
  driftJson?: string;
};

function timeAgo(iso: string, t: ReturnType<typeof useI18n>["t"]): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t("index.freshness.justNow");
  if (mins < 60) return t("index.freshness.minutes", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("index.freshness.hours", { n: hours });
  return t("index.freshness.days", { n: Math.floor(hours / 24) });
}

export function DesignPanel({ onOpenArtifact }: Props): JSX.Element {
  const { t } = useI18n();
  const [artifacts, setArtifacts] = useState<DesignArtifactMeta[]>([]);
  // One-click materialize: requirement (a single sentence is fine) and/or an
  // existing prototype as the interaction basis.
  const [requirement, setRequirement] = useState("");
  const [prototypeId, setPrototypeId] = useState("");
  const [materializing, setMaterializing] = useState(false);
  const [materializeProgress, setMaterializeProgress] = useState("");
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

  // Live refresh: artifacts are written by the a2ui tools mid-run.
  useEffect(() => api.onDesignChanged(() => void reload()), [reload]);

  // Progress lines while materialize / drift run (terminal data.done is
  // guaranteed by the action IPC; the awaited promise clears busy state).
  useEffect(() => {
    if (!materializing && !driftRunning) return;
    const unsub = api.onActionProgress((evt: ActionProgressEvent) => {
      if (evt.actionId === "design.materialize" && materializing) {
        setMaterializeProgress(evt.percent != null ? `${evt.percent}% — ${evt.message}` : evt.message);
      } else if (evt.actionId === "design.drift" && driftRunning) {
        setDriftProgress(evt.percent != null ? `${evt.percent}% — ${evt.message}` : evt.message);
      }
    });
    return unsub;
  }, [materializing, driftRunning]);

  const prototypes: PrototypeOption[] = artifacts
    .filter((a) => a.pipeline === "openui")
    .map((a) => ({ id: a.id, title: a.title }));
  const designs = artifacts.filter((a) => a.pipeline === "design");

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
    const basis = prototypeId.trim();
    if ((!text && !basis) || materializing) return;
    setMaterializing(true);
    setMaterializeNote(null);
    setMaterializeProgress("");
    try {
      const result = await api.actionRun("design.materialize", {
        ...(text ? { requirement: text } : {}),
        ...(basis ? { prototypeArtifactId: basis } : {}),
      });
      const output = (result as { output?: { ok?: boolean; error?: string } }).output;
      if (output && "ok" in output && output.ok !== true) {
        setMaterializeNote(output.error ?? "failed");
      } else {
        setMaterializeNote(t("design.materialized"));
        setRequirement("");
      }
    } catch (err) {
      setMaterializeNote(err instanceof Error ? err.message : String(err));
    } finally {
      setMaterializing(false);
      setMaterializeProgress("");
    }
  }, [requirement, prototypeId, materializing, t]);

  // Artifact delete is irreversible: armed two-step (same pattern as session
  // delete), replacing the native window.confirm; failures surface in note.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
    },
    []
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (confirmDeleteId !== id) {
        if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
        setConfirmDeleteId(id);
        confirmDeleteTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 3000);
        return;
      }
      if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
      setConfirmDeleteId(null);
      try {
        await api.designDelete(id);
      } catch (err) {
        setMaterializeNote(err instanceof Error ? err.message : String(err));
        return;
      }
      void reload();
    },
    [confirmDeleteId, reload]
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

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("design.title")}</span>
        <IconButton onClick={() => void reload()} title={t("scm.refresh")} aria-label={t("scm.refresh")}>
          ⟳
        </IconButton>
      </div>
      <div className="ui-side-panel-body">
        {/* UI-design entry: requirement (a single sentence is fine) and/or an
            existing prototype as the interaction basis (module split). */}
        <div className="ui-proto-step">
          <textarea
            className="ui-proto-input"
            rows={2}
            placeholder={t("design.materializePrompt")}
            value={requirement}
            disabled={materializing}
            onChange={(e) => setRequirement(e.target.value)}
          />
          {prototypes.length > 0 ? (
            <select
              className="ui-proto-select"
              value={prototypeId}
              disabled={materializing}
              onChange={(e) => setPrototypeId(e.target.value)}
            >
              <option value="">{t("design.noPrototypeBasis")}</option>
              {prototypes.map((p) => (
                <option key={p.id} value={p.id}>
                  {t("design.fromPrototype", { title: p.title })}
                </option>
              ))}
            </select>
          ) : null}
          <div className="ui-proto-step-actions">
            <button
              type="button"
              className="ui-proto-step-btn"
              disabled={materializing || (!requirement.trim() && !prototypeId.trim())}
              onClick={() => void handleMaterialize()}
            >
              <IconDesign /> {t("design.materializeBtn")}
            </button>
            {materializing && materializeProgress ? (
              <span className="ui-proto-progress">{materializeProgress}</span>
            ) : null}
            {materializing && !materializeProgress ? (
              <span className="ui-proto-progress">{t("proto.running")}</span>
            ) : null}
          </div>
        </div>
        {materializeNote ? <div className="ui-proto-note">{materializeNote}</div> : null}
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
                  {driftOutput.driftDetected ? (
                    <>
                      <IconWarn /> {t("design.drift.detected")}
                    </>
                  ) : (
                    <>
                      <IconCheck /> {t("design.drift.pass")}
                    </>
                  )}
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
        {designs.length === 0 ? (
          <div className="ui-side-panel-empty">{t("design.empty")}</div>
        ) : (
          <div className="ui-proto-list">
            {designs.map((a) => (
              <div key={a.id} className="ui-proto-artifact" onClick={() => onOpenArtifact(a)}>
                <span className="ui-proto-artifact-icon" aria-hidden>
                  <IconDesign />
                </span>
                <div className="ui-proto-artifact-main">
                  <div className="ui-proto-artifact-title">{a.title}</div>
                  <div className="ui-proto-artifact-meta">UI-Design · {timeAgo(a.updatedAt, t)}</div>
                </div>
                <button
                  type="button"
                  className="ui-proto-artifact-btn"
                  title={t("design.exportPackage")}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleExportPackage(a.id);
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={`ui-proto-artifact-btn${confirmDeleteId === a.id ? " armed" : ""}`}
                  title={confirmDeleteId === a.id ? t("design.deleteConfirm") : t("design.delete")}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDelete(a.id);
                  }}
                >
                  {confirmDeleteId === a.id ? "!" : <IconTrash />}
                </button>
              </div>
            ))}
          </div>
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
