/**
 * PrototypeDesignPanel — the prototype module's left-sidebar workspace
 * (design-module split, real-machine feedback: "一句话需求生成原型" mashed
 * two disciplines into one auto-routed flow).
 *
 * Prototype design is a TWO-STEP methodology, explicit in the UI:
 *   ① prototype.spec        需求（一句话即可）→ 结构化需求文档（spec artifact）
 *   ② prototype.materialize 需求文档 → 原型图（OpenUI Lang）
 * Step ② is disabled until a spec exists and always designs against the
 * selected document — never against a bare one-liner.
 *
 * Chain integrity: live progress lines while the actions run (the terminal
 * data.done event is guaranteed by the action IPC), and the artifact list
 * refreshes from design-store change events — artifacts land mid-run, not on
 * the next manual reload.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { IconButton, IconFile, IconPalette, IconTrash } from "../ui/index";
import type { ActionProgressEvent, DesignArtifactMeta } from "../../shared/ipc";

type Props = {
  /** Open an artifact in the preview panel (spec → reading view, openui → prototype). */
  onOpenArtifact: (artifact: DesignArtifactMeta) => void;
};

function timeAgo(iso: string, t: ReturnType<typeof useI18n>["t"]): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t("index.freshness.justNow");
  if (mins < 60) return t("index.freshness.minutes", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("index.freshness.hours", { n: hours });
  return t("index.freshness.days", { n: Math.floor(hours / 24) });
}

export function PrototypeDesignPanel({ onOpenArtifact }: Props): JSX.Element {
  const { t } = useI18n();
  const [artifacts, setArtifacts] = useState<DesignArtifactMeta[]>([]);
  // Step ①: requirement → spec document.
  const [requirement, setRequirement] = useState("");
  const [specRunning, setSpecRunning] = useState(false);
  const [specProgress, setSpecProgress] = useState("");
  // Step ②: spec document → prototype.
  const [specId, setSpecId] = useState("");
  const [protoRunning, setProtoRunning] = useState(false);
  const [protoProgress, setProtoProgress] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setArtifacts(await api.designList());
    } catch {
      setArtifacts([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Live refresh: artifacts are written by the a2ui tools mid-run.
  useEffect(() => api.onDesignChanged(() => void reload()), [reload]);

  // Progress lines while either step runs (terminal event guaranteed by the
  // action IPC; the awaited promise clears the busy state regardless).
  useEffect(() => {
    if (!specRunning && !protoRunning) return;
    const unsub = api.onActionProgress((evt: ActionProgressEvent) => {
      if (evt.actionId === "prototype.spec" && specRunning) {
        setSpecProgress(evt.percent != null ? `${evt.percent}% — ${evt.message}` : evt.message);
      } else if (evt.actionId === "prototype.materialize" && protoRunning) {
        setProtoProgress(evt.percent != null ? `${evt.percent}% — ${evt.message}` : evt.message);
      }
    });
    return unsub;
  }, [specRunning, protoRunning]);

  const specs = useMemo(() => artifacts.filter((a) => a.pipeline === "spec"), [artifacts]);
  const prototypes = useMemo(() => artifacts.filter((a) => a.pipeline === "openui"), [artifacts]);

  // Default step ② to the newest spec; deleting every spec must clear the
  // selection too — a stale id left the button enabled and materialize then
  // failed against a nonexistent artifact.
  useEffect(() => {
    if (specs.length === 0) {
      if (specId) setSpecId("");
      return;
    }
    if (!specId || !specs.some((s) => s.id === specId)) {
      setSpecId(specs[0].id);
    }
  }, [specs, specId]);

  const runSpec = useCallback(async () => {
    const text = requirement.trim();
    if (!text || specRunning) return;
    setSpecRunning(true);
    setNote(null);
    setSpecProgress("");
    try {
      const result = await api.actionRun("prototype.spec", { requirement: text });
      const output = (result as { output?: { ok?: boolean; error?: string } }).output;
      if (output && output.ok !== true) {
        setNote(output.error ?? t("app.requestFailed"));
      } else {
        setRequirement("");
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setSpecRunning(false);
      setSpecProgress("");
    }
  }, [requirement, specRunning, t]);

  const runPrototype = useCallback(async () => {
    if (!specId || protoRunning) return;
    setProtoRunning(true);
    setNote(null);
    setProtoProgress("");
    try {
      const result = await api.actionRun("prototype.materialize", { specArtifactId: specId });
      const output = (result as { output?: { ok?: boolean; error?: string } }).output;
      if (output && output.ok !== true) {
        setNote(output.error ?? t("app.requestFailed"));
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setProtoRunning(false);
      setProtoProgress("");
    }
  }, [specId, protoRunning, t]);

  // Armed two-step delete (irreversible), matching the sidebar/SCM pattern;
  // the old window.confirm also hid delete failures entirely.
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
        setNote(err instanceof Error ? err.message : String(err));
        return;
      }
      void reload();
    },
    [confirmDeleteId, reload]
  );

  const artifactRow = (a: DesignArtifactMeta, icon: JSX.Element, kindLabel: string): JSX.Element => (
    <div key={a.id} className="ui-proto-artifact" onClick={() => onOpenArtifact(a)}>
      <span className="ui-proto-artifact-icon" aria-hidden>
        {icon}
      </span>
      <div className="ui-proto-artifact-main">
        <div className="ui-proto-artifact-title">{a.title}</div>
        <div className="ui-proto-artifact-meta">
          {kindLabel} · {timeAgo(a.updatedAt, t)}
        </div>
      </div>
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
  );

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("proto.title")}</span>
        <IconButton onClick={() => void reload()} title={t("scm.refresh")} aria-label={t("scm.refresh")}>
          ⟳
        </IconButton>
      </div>
      <div className="ui-side-panel-body">
        {/* Step ①: requirement → requirements document. */}
        <div className="ui-proto-step">
          <div className="ui-proto-step-label">① {t("proto.stepSpec")}</div>
          <textarea
            className="ui-proto-input"
            rows={2}
            placeholder={t("proto.requirementPrompt")}
            value={requirement}
            disabled={specRunning}
            onChange={(e) => setRequirement(e.target.value)}
          />
          <div className="ui-proto-step-actions">
            <button
              type="button"
              className="ui-proto-step-btn"
              disabled={specRunning || !requirement.trim()}
              onClick={() => void runSpec()}
            >
              <IconFile /> {t("proto.specBtn")}
            </button>
            {specRunning && specProgress ? <span className="ui-proto-progress">{specProgress}</span> : null}
            {specRunning && !specProgress ? <span className="ui-proto-progress">{t("proto.running")}</span> : null}
          </div>
        </div>
        {/* Step ②: requirements document → prototype. */}
        <div className="ui-proto-step">
          <div className="ui-proto-step-label">② {t("proto.stepPrototype")}</div>
          {specs.length === 0 ? (
            <div className="ui-proto-hint">{t("proto.noSpecHint")}</div>
          ) : (
            <select
              className="ui-proto-select"
              value={specId}
              disabled={protoRunning}
              onChange={(e) => setSpecId(e.target.value)}
            >
              {specs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          )}
          <div className="ui-proto-step-actions">
            <button
              type="button"
              className="ui-proto-step-btn"
              disabled={protoRunning || !specId}
              onClick={() => void runPrototype()}
            >
              <IconPalette /> {t("proto.prototypeBtn")}
            </button>
            {protoRunning && protoProgress ? <span className="ui-proto-progress">{protoProgress}</span> : null}
            {protoRunning && !protoProgress ? <span className="ui-proto-progress">{t("proto.running")}</span> : null}
          </div>
        </div>
        {note ? <div className="ui-proto-note">{note}</div> : null}
        {/* Artifacts: spec documents + prototypes. */}
        {specs.length === 0 && prototypes.length === 0 ? (
          <div className="ui-side-panel-empty">{t("proto.empty")}</div>
        ) : (
          <div className="ui-proto-list">
            {prototypes.map((a) => artifactRow(a, <IconPalette />, t("proto.kindPrototype")))}
            {specs.map((a) => artifactRow(a, <IconFile />, t("proto.kindSpec")))}
          </div>
        )}
      </div>
    </div>
  );
}
